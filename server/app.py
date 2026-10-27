# 本地工作台：只绑定 127.0.0.1，提供静态页和生图接口。
# API Key 只从环境变量读取，不写入响应、仓库或日志。

from __future__ import annotations

import base64
import json
import mimetypes
import os
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8765
ROOT = Path(__file__).resolve().parent.parent
API_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
ALLOWED_ASPECTS = ("1:1", "3:4", "4:3", "9:16", "16:9", "3:2")
STATIC_PREFIXES = ("styles/", "src/", "assets/")
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

# 1x1 PNG。mock 模式直接返回它，不访问网络。
_PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def calc_size(aspect: str) -> str:
    """1k：长边 1024，单边夹在 512 和 2048 之间。"""
    if aspect not in ALLOWED_ASPECTS:
        raise ValueError("不支持的比例")
    w_ratio, h_ratio = (int(part) for part in aspect.split(":"))
    long_side = 1024
    if w_ratio >= h_ratio:
        width = long_side
        height = int(round(width * h_ratio / w_ratio))
    else:
        height = long_side
        width = int(round(height * w_ratio / h_ratio))
    width = min(2048, max(512, width))
    height = min(2048, max(512, height))
    return f"{width}*{height}"


def build_payload(body: dict, api_key: str) -> dict:
    """百炼同步接口的 JSON。api_key 只用于调用方的请求头，不能出现在 body 里。"""
    if not isinstance(api_key, str):
        raise ValueError("api_key")
    content = [{"image": image} for image in (body.get("referenceImages") or [])]
    content.append({"text": body.get("prompt") or ""})
    parameters = {
        "size": calc_size(body.get("aspectRatio")),
        "n": 1,
        "prompt_extend": False,
        "seed": body.get("seed"),
    }
    negative = body.get("negativePrompt") or ""
    if negative:
        parameters["negative_prompt"] = negative
    return {
        "model": "qwen-image-3.0",
        "input": {"messages": [{"role": "user", "content": content}]},
        "parameters": parameters,
    }


def mock_png_data_url() -> str:
    return "data:image/png;base64," + base64.b64encode(_PNG_BYTES).decode("ascii")


def _image_from_output(data: dict) -> str:
    choices = (data.get("output") or {}).get("choices") or []
    if not choices:
        raise RuntimeError(data.get("message") or "响应中无图片")
    content = (choices[0].get("message") or {}).get("content") or []
    for item in content:
        if isinstance(item, dict) and item.get("image"):
            return item["image"]
    raise RuntimeError("响应中未找到图片")


def _public_error(exc: Exception, api_key: str) -> str:
    message = str(exc) or "生成失败"
    if api_key:
        message = message.replace(api_key, "[redacted]")
    return message


def fetch_image(payload: dict, api_key: str, urlopen) -> str:
    request = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=180) as response:
        data = json.loads(response.read().decode("utf-8"))
    image = _image_from_output(data)
    if image.startswith("data:"):
        return image
    download = urllib.request.Request(image, method="GET")
    with urlopen(download, timeout=120) as response:
        raw = response.read()
        content_type = "image/png"
        headers = getattr(response, "headers", None)
        if headers is not None:
            content_type = (headers.get("Content-Type") or content_type).split(";", 1)[0].strip() or "image/png"
    return f"data:{content_type};base64,{base64.b64encode(raw).decode('ascii')}"


def handle_generate(body, api_key=None, mock=False, urlopen=None):
    try:
        calc_size(body.get("aspectRatio"))
    except ValueError:
        return 400, {"error": "不支持的比例"}
    if mock:
        return 200, {"dataUrl": mock_png_data_url(), "seed": body.get("seed")}
    if not api_key:
        return 503, {"error": "未配置 DASHSCOPE_API_KEY"}
    opener = urlopen or urllib.request.urlopen
    try:
        payload = build_payload(body, api_key)
        data_url = fetch_image(payload, api_key, opener)
    except Exception as exc:
        return 502, {"error": _public_error(exc, api_key)}
    return 200, {"dataUrl": data_url, "seed": body.get("seed")}


def chibi_style_images() -> dict:
    folder = ROOT / "assets" / "chibi-style"
    images = []
    if folder.is_dir():
        for path in sorted(folder.iterdir()):
            if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
                continue
            mime = mimetypes.guess_type(path.name)[0] or "image/png"
            encoded = base64.b64encode(path.read_bytes()).decode("ascii")
            images.append(f"data:{mime};base64,{encoded}")
    return {"images": images}


def resolve_static(path: str):
    raw = (path or "").split("?", 1)[0]
    if raw in ("/", "/index.html"):
        candidate = (ROOT / "index.html").resolve()
        return candidate if candidate.is_file() else None
    if not raw.startswith("/") or "\\" in raw:
        return None
    rel = raw[1:]
    parts = Path(rel).parts
    if not parts or ".." in parts:
        return None
    if any(part == ".git" or part == "tests" or part.startswith(".env") for part in parts):
        return None
    if rel != "index.html" and not rel.startswith(STATIC_PREFIXES):
        return None
    candidate = (ROOT / rel).resolve()
    try:
        candidate.relative_to(ROOT)
    except ValueError:
        return None
    if candidate.is_file():
        return candidate
    return None


def _json(status: int, data: dict):
    raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
    return status, {"Content-Type": "application/json; charset=utf-8"}, raw


def dispatch(method, path, body=None, environ=None, urlopen=None):
    environ = os.environ if environ is None else environ
    method = (method or "GET").upper()
    route = (path or "").split("?", 1)[0]
    if method == "POST" and route == "/api/generate":
        status, data = handle_generate(
            body or {},
            api_key=environ.get("DASHSCOPE_API_KEY") or "",
            mock=environ.get("GENERATE_MOCK") == "1",
            urlopen=urlopen,
        )
        return _json(status, data)
    if method == "GET" and route == "/api/chibi-style":
        return _json(200, chibi_style_images())
    if method == "GET":
        file = resolve_static(route)
        if file is None:
            return 404, {"Content-Type": "text/plain; charset=utf-8"}, "not found".encode("utf-8")
        mime = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        return 200, {"Content-Type": mime}, file.read_bytes()
    return 404, {"Content-Type": "text/plain; charset=utf-8"}, "not found".encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self._respond("GET", None)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw.decode("utf-8")) if raw else {}
        except json.JSONDecodeError:
            self._send(*_json(400, {"error": "无法解析请求"}))
            return
        if not isinstance(body, dict):
            self._send(*_json(400, {"error": "无法解析请求"}))
            return
        self._respond("POST", body)

    def _respond(self, method, body):
        self._send(*dispatch(method, self.path, body, os.environ))

    def _send(self, status, headers, raw):
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt, *args):
        # 默认只写请求行。不要把正文、参考图或密钥打出来。
        super().log_message(fmt, *args)


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
