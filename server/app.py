# 本地工作台：只绑定 127.0.0.1，提供静态页和生图接口。
# API Key 只从环境变量读取，不写入响应、仓库或日志。

from __future__ import annotations

import asyncio
import base64
import importlib
import json
import math
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import uuid
import zipfile
from urllib.parse import parse_qs, urlsplit
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# 直接运行 python server/app.py 时（脚本模式），server 不在包路径里；
# 用 from server import ... 导入时（unittest），走包内相对导入。
if __package__ in (None, ""):
    import db as gallery_db
    import oss as oss_client
    import progress as _progress
    import tasks as task_queue
else:
    from . import db as gallery_db
    from . import oss as oss_client
    from . import progress as _progress
    from . import tasks as task_queue

HOST = "127.0.0.1"
PORT = 8765
ROOT = Path(__file__).resolve().parent.parent
API_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
TRANSLATE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
# 颜色翻译模型链路：按顺序尝试，任一响应即返回，保证服务可用性。
TRANSLATE_MODELS = ("qwen3.8-flash", "deepseek-v4.1-flash", "qwen3.7-flash")
TRANSLATE_SYSTEM = (
    "你是一位顶级的二次元原画师和色彩美学专家。你的任务是将用户输入的 HEX 色值（或渐变），翻译成最适合用于 AI 绘画提示词（Prompt）的英文颜色描述。\n"
    "\n"
    "严格遵循以下规则：\n"
    "简短优先：输出必须是 1~3 个英文单词组成的短语，不要任何标点符号，不要任何解释。\n"
    "拒绝干瘪的基础词：不要只输出 blue、red、green。必须根据色值明暗与饱和度，加上精确的修饰词（如 pastel 柔和、vibrant 鲜艳、pale 苍白、neon 荧光、deep 深邃、crimson 绯红）。\n"
    "契合二次元审美：优先使用 AI 绘画模型极度敏感的二次元色名。例如 mint green、peach pink、navy blue、lavender、crimson、cyan、rose gold 等。\n"
    "渐变描述：如果是双色，严格按照 gradient from [颜色A] to [颜色B] 的格式输出。\n"
    "\n"
    "示例参考：\n"
    "输入 #FFB6C1 -> 输出 pastel pink\n"
    "输入 #00008B -> 输出 deep navy blue\n"
    "输入 #8A2BE2 -> 输出 vibrant violet\n"
    "输入 #7FFFD4 -> 输出 pale aquamarine\n"
    "输入 #FF4500 -> 输出 vibrant orange red"
)
ALLOWED_ASPECTS = ("1:1", "3:4", "4:3", "9:16", "16:9", "3:2")
DEFAULT_IMAGE_MODEL = "qwen-image-3.0"
# 千问走百炼。2.1 没有反向提示词参数，超上限的参考图会被接口拒绝。
QWEN_MODELS = {
    "qwen-image-3.0": {"negative": True, "max_refs": 3},
    "qwen-image-2.1-pro": {"negative": False, "max_refs": 10},
    "qwen-image-2.1-turbo": {"negative": False, "max_refs": 10},
}
GEMINI_MODELS = {
    "gemini-3-pro-image-c",
    "gemini-nano-banana-2.1-c",
    "gemini-3.1-flash-image-c",
}
GEMINI_URL = "https://4sapi.org/v1/chat/completions"
GEMINI_MAX_REFS = 10
# 动态壁纸2：通义万相 wan3.0 首尾帧视频生成。
# 2026 年的新接口文档给的是业务空间专属域名（{WorkspaceId}.{region}.maas.aliyuncs.com/api/v1），
# 而经典 dashscope.aliyuncs.com/api/v1 仍覆盖大多数账号。这里把 base 做成可配置：
# 设 DASHSCOPE_VIDEO_BASE 即可整段替换（含 /api/v1），不设就用经典域名。
DASHSCOPE_API_BASE = "https://dashscope.aliyuncs.com/api/v1"
VIDEO_BASE_ENV = "DASHSCOPE_VIDEO_BASE"
VIDEO_GEN_PATH = "/services/aigc/video-generation/video-synthesis"
VIDEO_TASK_PATH = "/tasks/"


def video_api_base(environ=None) -> str:
    env = os.environ if environ is None else environ
    base = (env.get(VIDEO_BASE_ENV) or "").strip() or DASHSCOPE_API_BASE
    return base.rstrip("/")


def video_gen_url(environ=None) -> str:
    return video_api_base(environ) + VIDEO_GEN_PATH


def video_task_url(environ=None) -> str:
    return video_api_base(environ) + VIDEO_TASK_PATH


# 兼容旧引用：默认地域下创建任务 / 查询任务的地址。
VIDEO_GEN_URL = video_gen_url()
VIDEO_TASK_URL = video_task_url()
STATIC_PREFIXES = ("styles/", "src/", "assets/")
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

# 1x1 PNG。mock 模式直接返回它，不访问网络。
_PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def calc_size(aspect: str, resolution: str = "1k") -> str:
    """按目标分辨率算长边：2k 长边 2048，1k 长边 1024。单边夹在 512 和 2048 之间。"""
    if aspect not in ALLOWED_ASPECTS:
        raise ValueError("不支持的比例")
    w_ratio, h_ratio = (int(part) for part in aspect.split(":"))
    long_side = 2048 if resolution == "2k" else 1024
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
    model = body.get("model") or DEFAULT_IMAGE_MODEL
    spec = QWEN_MODELS.get(model)
    if spec is None:
        raise ValueError("不支持的模型")
    refs = [image for image in (body.get("referenceImages") or []) if image][: spec["max_refs"]]
    text = body.get("prompt") or ""
    negative = body.get("negativePrompt") or ""
    # 2.1 不接受 negative_prompt，反向词写进正向提示词，否则会被丢掉。
    if negative and not spec["negative"]:
        text = f"{text}\nAvoid: {negative}"
        negative = ""
    content = [{"image": image} for image in refs]
    content.append({"text": text})
    parameters = {
        "size": calc_size(body.get("aspectRatio"), body.get("resolution") or "1k"),
        "n": 1,
        "prompt_extend": False,
        "seed": body.get("seed"),
    }
    if negative:
        parameters["negative_prompt"] = negative
    return {
        "model": model,
        "input": {"messages": [{"role": "user", "content": content}]},
        "parameters": parameters,
    }


# SD 风格的 (词:1.4) 权重写法服务端要留着（百炼的 negative_prompt 认），
# 但 Gemini 的图片模型只吃自然语言：权重括号会被当成字面文本，反而稀释约束。
# 所以发给 Gemini 前把权重语法脱掉，只保留词本身。
_WEIGHT_RE = re.compile(r"\(([^()]*?):\s*\d+(?:\.\d+)?\)")


def strip_weights(text: str) -> str:
    """把 (tail:1.5) 变成 tail，供 Gemini 一类不吃权重的模型使用。"""
    if not text:
        return text
    previous = None
    while previous != text:  # 嵌套括号逐层剥
        previous = text
        text = _WEIGHT_RE.sub(r"\1", text)
    return text


def build_gemini_payload(body: dict) -> dict:
    """4sapi 的 OpenAI 兼容生图请求。图片用 data URL 放进 content，不传种子。"""
    model = body.get("model") or ""
    if model not in GEMINI_MODELS:
        raise ValueError("不支持的模型")
    text = strip_weights(body.get("prompt") or "")
    negative = strip_weights(body.get("negativePrompt") or "")
    if negative:
        text = f"{text}\nAvoid: {negative}"
    refs = [image for image in (body.get("referenceImages") or []) if image][:GEMINI_MAX_REFS]
    if refs:
        content = [{"type": "text", "text": text}]
        content.extend(
            {"type": "image_url", "image_url": {"url": image}}
            for image in refs
        )
    else:
        content = text
    resolution = body.get("resolution") or "1k"
    return {
        "model": model,
        "stream": False,
        "messages": [{"role": "user", "content": content}],
        "extra_body": {
            "google": {
                "image_config": {
                    "aspect_ratio": body.get("aspectRatio"),
                    "image_size": "2K" if resolution == "2k" else "1K",
                    "generation_config": {"responseModalities": ["IMAGE"]},
                }
            }
        },
    }


def mock_png_data_url() -> str:
    return "data:image/png;base64," + base64.b64encode(_PNG_BYTES).decode("ascii")


def split_data_url(data_url: str):
    """把 data URL 拆成 (原始字节, content_type)。非 data URL 原样返回字节为空。"""
    if not isinstance(data_url, str) or "," not in data_url:
        return b"", "application/octet-stream"
    meta, payload = data_url.split(",", 1)
    content_type = "image/png"
    if ":" in meta:
        content_type = meta.split(";", 1)[0].split(":", 1)[1] or content_type
    if ";base64" in meta:
        return base64.b64decode(payload), content_type
    return payload.encode("utf-8"), content_type


# 参考图 URL 下载缓存：同一张历史基准会被设定集里多张图反复引用，下载一次就够。
_REF_CACHE: dict = {}
_REF_CACHE_LOCK = threading.Lock()


def _download_to_data_url(url: str, opener) -> str:
    """把 http(s) URL 下载成 data URL。失败时原样返回 URL（保留旧行为，不因下载失败报错）。"""
    try:
        request = urllib.request.Request(url, method="GET")
        with opener(request, timeout=60) as response:
            raw = response.read()
        content_type = "image/png"
        headers = getattr(response, "headers", None)
        if headers is not None:
            content_type = (headers.get("Content-Type") or content_type).split(";", 1)[0].strip() or "image/png"
        return f"data:{content_type};base64,{base64.b64encode(raw).decode('ascii')}"
    except Exception:
        return url


def _materialize_references(refs, opener):
    """把参考图里的 http(s) URL 先下载成本地 data URL 再交给生图服务。

    下载页「基准立绘」「服饰基准」选定历史批次时，参考图拿到的是 OSS 公开 URL；
    第三方生图服务端（Gemini 走 4sapi、千问走百炼）未必拉得到本机网络里的 OSS 地址
    （海外线路、防盗链、IP 白名单等）。参考图一旦拉空就会静默退化成纯文字出图，
    结果生成出「另一个角色」。所以凡是 URL 一律在本进程先落成 data URL。
    data URL 原样返回；下载失败也原样返回，不阻断生图。
    """
    if not refs:
        return refs
    out = []
    for ref in refs:
        if not isinstance(ref, str) or not ref.startswith(("http://", "https://")):
            out.append(ref)
            continue
        with _REF_CACHE_LOCK:
            cached = _REF_CACHE.get(ref)
        if cached:
            out.append(cached)
            continue
        data_url = _download_to_data_url(ref, opener)
        if isinstance(data_url, str) and data_url.startswith("data:"):
            with _REF_CACHE_LOCK:
                _REF_CACHE[ref] = data_url
        out.append(data_url)
    return out


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


def _log(message: str):
    """统一日志出口：带时间戳打到 stdout，方便跑 python server/app.py 时观察。"""
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}", flush=True)


def _brief(text, limit: int = 60) -> str:
    """日志里截断长文本（提示词等），避免刷屏。"""
    value = str(text or "").strip().replace("\n", " ")
    if not value:
        return "(空)"
    return value if len(value) <= limit else f"{value[:limit]}…"


def _data_url_summary(data_url) -> str:
    """给日志用的图片摘要：只报 MIME 和估算体积，绝不打印 base64 正文。"""
    if not isinstance(data_url, str) or not data_url:
        return "(无图片)"
    if not data_url.startswith("data:"):
        return _brief(data_url, 80)
    meta, _, payload = data_url.partition(",")
    approx = len(payload) * 3 // 4
    return f"{meta.split(';', 1)[0]} 约 {approx} 字节"


def _redact_for_log(message, environ):
    """日志里抹掉密钥，避免误打印 ACCESS_KEY / API Key。"""
    text = str(message)
    if environ:
        for secret in (
            environ.get("DASHSCOPE_API_KEY") or "",
            environ.get("4S_API_KEY") or "",
            environ.get("ACCESS_KEY_ID") or "",
            environ.get("ACCESS_KEY_SECRET") or "",
            environ.get("OSS_ACCESS_KEY_ID") or "",
            environ.get("OSS_ACCESS_KEY_SECRET") or "",
        ):
            if secret:
                text = text.replace(secret, "[redacted]")
    return text


def fetch_image(payload: dict, api_key: str, urlopen) -> str:
    """调用百炼同步生图接口并下载图片，返回 data URL。全程记录模型与耗时。"""
    parameters = payload.get("parameters") or {}
    content = ((payload.get("input") or {}).get("messages") or [{}])[0].get("content") or []
    references = max(0, len(content) - 1)
    model = payload.get("model")
    _log(
        f"[生图] 调用模型 {model} | 尺寸={parameters.get('size')} "
        f"seed={parameters.get('seed')} 参考图={references}张 "
        f"负向词={'有' if parameters.get('negative_prompt') else '无'}"
    )
    started = time.perf_counter()
    request = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=180) as response:
            data = json.loads(response.read().decode("utf-8"))
        image = _image_from_output(data)
    except Exception as exc:
        _log(f"[生图] 模型 {model} 调用失败（耗时 {time.perf_counter() - started:.1f}s）：{_public_error(exc, api_key)}")
        raise
    _log(f"[生图] 模型 {model} 返回结果（耗时 {time.perf_counter() - started:.1f}s）：{_brief(image, 90)}")
    if image.startswith("data:"):
        return image
    started = time.perf_counter()
    download = urllib.request.Request(image, method="GET")
    try:
        with urlopen(download, timeout=120) as response:
            raw = response.read()
            content_type = "image/png"
            headers = getattr(response, "headers", None)
            if headers is not None:
                content_type = (headers.get("Content-Type") or content_type).split(";", 1)[0].strip() or "image/png"
    except Exception as exc:
        _log(f"[生图] 下载生成结果失败（耗时 {time.perf_counter() - started:.1f}s）：{_public_error(exc, api_key)}")
        raise
    _log(f"[生图] 下载图片完成（耗时 {time.perf_counter() - started:.1f}s）：{len(raw)} 字节 {content_type}")
    return f"data:{content_type};base64,{base64.b64encode(raw).decode('ascii')}"


def _coerce_image(content):
    """从 Gemini 的 message.content 里取出图片。可能是 data URL、裸 base64、网址或分段列表。"""
    if isinstance(content, list):
        for part in content:
            if not isinstance(part, dict):
                continue
            image_url = part.get("image_url")
            if isinstance(image_url, dict) and image_url.get("url"):
                return image_url["url"]
            if part.get("url"):
                return part["url"]
            inline = part.get("inline_data") or part.get("inlineData") or {}
            if isinstance(inline, dict) and inline.get("data"):
                mime = inline.get("mime_type") or inline.get("mimeType") or "image/png"
                return f"data:{mime};base64,{inline['data']}"
            found = _coerce_image(part.get("text"))
            if found:
                return found
        return None
    if not isinstance(content, str):
        return None
    text = content.strip()
    if not text:
        return None
    if text.startswith(("data:image", "http://", "https://")):
        return text.split()[0]
    marker = "data:image"
    index = text.find(marker)
    if index >= 0:
        snippet = text[index:]
        end = len(snippet)
        for stop in (" ", ")", '"', "'", "\n"):
            pos = snippet.find(stop)
            if pos > 0:
                end = min(end, pos)
        return snippet[:end]
    compact = "".join(text.split())
    if len(compact) > 80 and all(char.isalnum() or char in "+/=" for char in compact):
        mime = "image/jpeg" if compact.startswith("/9j/") else "image/png"
        return f"data:{mime};base64,{compact}"
    return None


def _gemini_image_from_output(data: dict) -> str:
    for item in data.get("data") or []:
        if isinstance(item, dict) and item.get("url"):
            return item["url"]
    choices = data.get("choices") or []
    if not choices:
        error = data.get("error") if isinstance(data.get("error"), dict) else {}
        raise RuntimeError(error.get("message") or data.get("message") or "响应中无图片")
    found = _coerce_image((choices[0].get("message") or {}).get("content"))
    if not found:
        raise RuntimeError("响应中未找到图片")
    return found


def _error_detail(exc: Exception) -> str:
    """HTTP 错误尽量读出接口返回的 message，而不是只留状态码。"""
    read = getattr(exc, "read", None)
    if read is None:
        return str(exc) or "生成失败"
    try:
        raw = read()
    except Exception:
        return str(exc) or "生成失败"
    text = raw.decode("utf-8", "replace") if isinstance(raw, (bytes, bytearray)) else str(raw)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return (text or str(exc) or "生成失败")[:400]
    error = parsed.get("error")
    if isinstance(error, dict) and error.get("message"):
        return str(error["message"])
    if parsed.get("message"):
        return str(parsed["message"])
    return (text or str(exc) or "生成失败")[:400]


def fetch_gemini(payload: dict, api_key: str, urlopen) -> str:
    """调用 4sapi 的 Gemini 生图接口，把返回的 base64 或临时链接收成 data URL。"""
    image_config = (((payload.get("extra_body") or {}).get("google") or {}).get("image_config") or {})
    content = ((payload.get("messages") or [{}])[0].get("content"))
    references = len(content) - 1 if isinstance(content, list) else 0
    model = payload.get("model")
    _log(
        f"[生图] 调用模型 {model} | 比例={image_config.get('aspect_ratio')} "
        f"尺寸={image_config.get('image_size')} 参考图={references}张"
    )
    started = time.perf_counter()
    request = urllib.request.Request(
        GEMINI_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=180) as response:
            data = json.loads(response.read().decode("utf-8"))
        image = _gemini_image_from_output(data)
    except Exception as exc:
        detail = _error_detail(exc)
        _log(f"[生图] 模型 {model} 调用失败（耗时 {time.perf_counter() - started:.1f}s）：{_public_error(RuntimeError(detail), api_key)}")
        raise RuntimeError(detail) from exc
    _log(f"[生图] 模型 {model} 返回结果（耗时 {time.perf_counter() - started:.1f}s）：{_brief(image, 90)}")
    if image.startswith("data:"):
        return image
    started = time.perf_counter()
    download = urllib.request.Request(image, method="GET")
    try:
        with urlopen(download, timeout=120) as response:
            raw = response.read()
            content_type = "image/png"
            headers = getattr(response, "headers", None)
            if headers is not None:
                content_type = (headers.get("Content-Type") or content_type).split(";", 1)[0].strip() or "image/png"
    except Exception as exc:
        _log(f"[生图] 下载生成结果失败（耗时 {time.perf_counter() - started:.1f}s）：{_public_error(exc, api_key)}")
        raise
    _log(f"[生图] 下载图片完成（耗时 {time.perf_counter() - started:.1f}s）：{len(raw)} 字节 {content_type}")
    return f"data:{content_type};base64,{base64.b64encode(raw).decode('ascii')}"


def handle_generate(body, api_key=None, mock=False, urlopen=None, environ=None, db_path=None, upload=None):
    kind = body.get("kind") or "(未指定图种)"
    seed = body.get("seed")
    model = body.get("model") or DEFAULT_IMAGE_MODEL
    started = time.perf_counter()
    _log(
        f"[生图] 开始 | 模型={model} 图种={kind} 比例={body.get('aspectRatio')} "
        f"分辨率={body.get('resolution') or '1k'} seed={seed} "
        f"参考图={len(body.get('referenceImages') or [])}张 提示词={_brief(body.get('prompt'))}"
    )
    try:
        calc_size(body.get("aspectRatio"))
    except ValueError:
        _log(f"[生图] 失败 | 图种={kind} 原因=不支持的比例 {body.get('aspectRatio')}")
        return 400, {"error": "不支持的比例"}
    if model not in QWEN_MODELS and model not in GEMINI_MODELS:
        _log(f"[生图] 失败 | 图种={kind} 原因=不支持的模型 {model}")
        return 400, {"error": "不支持的模型"}
    if mock:
        _log(f"[生图] 成功（mock 模式，未调用真实模型） | 图种={kind} 模型={model} seed={seed}")
        return 200, {"dataUrl": mock_png_data_url(), "seed": seed}
    gemini = model in GEMINI_MODELS
    env = environ or {}
    if gemini:
        api_key = (env.get("4S_API_KEY") or "").strip()
        missing = "" if api_key else "未配置 4S_API_KEY"
    elif not api_key:
        missing = "未配置 DASHSCOPE_API_KEY"
    else:
        missing = ""
    if missing:
        _log(f"[生图] 失败 | 图种={kind} 模型={model} 原因={missing}")
        return 503, {"error": missing}
    opener = urlopen or urllib.request.urlopen
    body["referenceImages"] = _materialize_references(body.get("referenceImages") or [], opener)
    try:
        if gemini:
            payload = build_gemini_payload(body)
            data_url = fetch_gemini(payload, api_key, opener)
        else:
            payload = build_payload(body, api_key)
            data_url = fetch_image(payload, api_key, opener)
    except Exception as exc:
        message = _public_error(exc, api_key)
        _log(f"[生图] 失败 | 图种={kind} 模型={model} 耗时={time.perf_counter() - started:.1f}s 原因={message}")
        return 502, {"error": message}
    _log(f"[生图] 成功 | 图种={kind} seed={seed} 耗时={time.perf_counter() - started:.1f}s 图片={_data_url_summary(data_url)}")

    # OSS + SQLite 持久化（可选）：上传到 OSS 得到公开 URL，再把 URL 写入本地 SQLite。
    url = None
    image_id = None
    env = os.environ if environ is None else environ
    settings = oss_client.oss_settings(env)
    if oss_client.oss_enabled(settings):
        try:
            raw, content_type = split_data_url(data_url)
            key = oss_client.new_object_key(body.get("kind") or "")
            uploader = upload or oss_client.upload_bytes
            _log(f"[OSS] 上传开始 | 图种={kind} 对象={key} 大小={len(raw)}字节 {content_type}")
            upload_started = time.perf_counter()
            url = uploader(settings, key, raw, content_type)
            _log(f"[OSS] 上传成功（耗时 {time.perf_counter() - upload_started:.1f}s）| {url}")
            path = gallery_db.init_db(db_path)
            image_id = gallery_db.insert_image(path, _record_from(body, url))
            _log(f"[SQLite] 写入成功 | id={image_id} 图种={kind} 批次={body.get('batchId') or '(无)'} 库={path}")
        except Exception as exc:
            # 上传/落库失败不阻断生图：仍返回 dataUrl 供本次会话使用，但要在日志里显式报出。
            url = None
            image_id = None
            if isinstance(exc, ImportError):
                _log("[OSS] 上传失败 | 原因=未安装 oss2 SDK（请执行 pip install oss2）")
            else:
                _log(f"[OSS/SQLite] 持久化失败（本次会话仍可用 dataUrl，但下载页跨会话找不回）：{_redact_for_log(exc, env)}")
    else:
        _log("[OSS] 未配置（缺 ACCESS_KEY_ID/ACCESS_KEY_SECRET/OSS_ENDPOINT/OSS_BUCKET），图片仅本次会话可用")
    return 200, {"dataUrl": data_url, "url": url, "id": image_id, "seed": seed}


def _record_from(body, url):
    base = body.get("base") or {}
    return {
        "url": url,
        "kind": body.get("kind"),
        "aspect": body.get("aspectRatio"),
        "seed": body.get("seed"),
        "positive": body.get("prompt"),
        "negative": body.get("negativePrompt"),
        "batch_id": body.get("batchId"),
        "base_url": (base.get("url") or None),
        "base_seed": (base.get("seed") if base.get("url") else None),
        "state": body.get("state"),
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def sse_event(obj: dict) -> str:
    return "data: " + json.dumps(obj, ensure_ascii=False) + "\n\n"


# 一次最多几路并行。上限 4：再多就是给出图服务限流，不会更快。
STREAM_MAX_WORKERS = 4


def stream_workers(remaining: int) -> int:
    """按剩余张数决定并发路数：剩 1 张就 1 路，剩 3 张就 3 路，最多 4 路。

    一次性开满 4 条线程去抢 1 张图没有意义，还会白占内存和线程；
    真正影响速度的是「在跑的同时还有多少张没发」，所以按剩余量自适应。
    """
    return max(1, min(STREAM_MAX_WORKERS, remaining))


def generate_stream_events(jobs, api_key=None, mock=False, urlopen=None, environ=None, db_path=None, upload=None):
    """按任务列表并发生成，每完成一张产出一条 SSE data 帧，最后发 done。

    每帧成功为 {"index", "seed", "dataUrl", "url", "id"}，失败为 {"index", "error"}。
    index 对应 jobs 下标，保证前端能按原顺序放回批次；错误帧后仍继续回传其余结果。
    """
    if not isinstance(jobs, list) or not jobs:
        _log("[流式生图] 失败 | 原因=请求里没有生成任务")
        yield sse_event({"error": "缺少生成任务"})
        return
    kinds = [job.get("kind") or "(未指定)" for job in jobs]
    _log(f"[流式生图] 开始 | 共 {len(jobs)} 张，并发 {stream_workers(len(jobs))} 路（上限 {STREAM_MAX_WORKERS}）| 图种={','.join(kinds)}")
    stream_started = time.perf_counter()
    finished = 0
    failed = 0

    def run(index, job):
        started = time.perf_counter()
        try:
            status, data = handle_generate(
                job,
                api_key=api_key or "",
                mock=mock,
                urlopen=urlopen,
                environ=environ,
                db_path=db_path,
                upload=upload,
            )
        except Exception as exc:  # handle_generate 之外的意外错误也转成错误帧
            message = _public_error(exc, api_key or "")
            _log(f"[流式生图] 第 {index + 1}/{len(jobs)} 张异常（耗时 {time.perf_counter() - started:.1f}s）：{_redact_for_log(message, environ)}")
            return index, None, message
        if status != 200:
            message = (data or {}).get("error") or "生成失败"
            _log(f"[流式生图] 第 {index + 1}/{len(jobs)} 张失败（耗时 {time.perf_counter() - started:.1f}s）：{_redact_for_log(message, environ)}")
            return index, None, message
        return index, data, None

    # 只按并发上限提交任务：前端点「停止生成」断开连接后，还没提交的任务直接丢弃。
    executor = ThreadPoolExecutor(max_workers=STREAM_MAX_WORKERS)
    pending = {}
    queue = list(enumerate(jobs))
    try:
        while queue or pending:
            # 每轮按剩余量重算并发上限：剩余越少并行越少，一路递减到 1。
            limit = stream_workers(len(queue) + len(pending))
            while queue and len(pending) < limit:
                index, job = queue.pop(0)
                pending[executor.submit(run, index, job)] = index
            if not pending:
                break
            done, _ = wait(list(pending), return_when=FIRST_COMPLETED)
            for future in done:
                index = pending.pop(future)
                _, data, error = future.result()
                if error is not None:
                    failed += 1
                    yield sse_event({"index": index, "error": error})
                else:
                    finished += 1
                    _log(
                        f"[流式生图] 已推送第 {index + 1}/{len(jobs)} 张给前端 "
                        f"（{finished} 张成功 / {failed} 张失败）"
                    )
                    yield sse_event({
                        "index": index,
                        "seed": data.get("seed"),
                        "dataUrl": data.get("dataUrl"),
                        "url": data.get("url"),
                        "id": data.get("id"),
                    })
    except GeneratorExit:
        # 前端停止：取消排队任务，正在跑的那两张结果不再推送（urllib 无法中断，只能等它返回后丢弃）。
        for future in list(pending):
            future.cancel()
        executor.shutdown(wait=False, cancel_futures=True)
        _log(
            f"[流式生图] 前端停止生成 | 已丢弃 {len(queue) + len(pending)} 个未完成任务，"
            f"成功 {finished} 张 / 失败 {failed} 张"
        )
        raise
    executor.shutdown(wait=True)
    _log(
        f"[流式生图] 结束 | 成功 {finished} 张 / 失败 {failed} 张 "
        f"总耗时 {time.perf_counter() - stream_started:.1f}s，发送 done"
    )
    yield sse_event({"done": True})


def _image_ids(raw):
    if not isinstance(raw, list) or not raw or len(raw) > 500:
        return None
    ids = []
    for item in raw:
        if isinstance(item, bool) or not isinstance(item, int) or item <= 0:
            return None
        ids.append(item)
    return ids


def handle_delete_images(body, db_path=None):
    ids = _image_ids((body or {}).get("ids"))
    if ids is None:
        return 400, {"error": "缺少要删除的图片"}
    path = gallery_db.init_db(db_path)
    deleted = gallery_db.delete_images(path, ids)
    _log(f"[图库] 删除 | 请求 {len(ids)} 张，实际删除 {deleted} 张 库={path}")
    return 200, {"deleted": deleted}


def handle_gallery(db_path=None):
    gallery_db.init_db(db_path)
    records = gallery_db.list_images(db_path)
    images = []
    for row in records:
        base = {"url": row["base_url"], "seed": row["base_seed"]} if row["base_url"] else None
        images.append({
            "id": row["id"],
            "url": row["url"],
            "kind": row["kind"],
            "aspect": row["aspect"],
            "seed": row["seed"],
            "positive": row["positive"],
            "negative": row["negative"],
            "batch_id": row["batch_id"],
            "base": base,
            "state": row.get("state"),
            "createdAt": row["created_at"],
        })
    paths = gallery_db.default_db_path() if db_path is None else db_path
    if images:
        _log(f"[图库] 查询成功 | 返回 {len(images)} 张历史图片 库={paths}")
    else:
        _log(f"[图库] 查询完成 | 没有历史图片 库={paths}（未生成过或 SQLite 里没数据）")
    return 200, {"images": images}


_IMAGE_PROXY_LIMIT = 25 * 1024 * 1024


def _image_mime(content_type, raw):
    mime = (content_type or "").split(";")[0].strip().lower()
    if mime.startswith("image/"):
        return mime
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(raw) >= 12 and raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
        return "image/webp"
    return ""


def handle_remote_image(path, db_path=None, urlopen=None, environ=None):
    """浏览器打包时不能直接读 OSS（没有跨域头）。只代理图库里已有的地址。"""
    query = path.split("?", 1)[1] if "?" in (path or "") else ""
    url = (parse_qs(query).get("url") or [""])[0].strip()
    parsed = urlsplit(url)
    plain = {"Content-Type": "text/plain; charset=utf-8"}
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return 400, plain, "bad url".encode("utf-8")
    if url not in gallery_db.known_urls(db_path):
        return 404, plain, "not found".encode("utf-8")
    opener = urlopen or urllib.request.urlopen
    request = urllib.request.Request(url, headers={"User-Agent": "ai-role-gen"})
    try:
        with opener(request, timeout=60) as response:
            headers = getattr(response, "headers", None) or {}
            content_type = headers.get("Content-Type") or headers.get("content-type") or ""
            raw = response.read(_IMAGE_PROXY_LIMIT + 1)
    except Exception as exc:
        _log(f"[图库] 拉取远程图片失败 | {_redact_for_log(exc, environ)}")
        return 502, plain, "fetch failed".encode("utf-8")
    if len(raw) > _IMAGE_PROXY_LIMIT:
        return 413, plain, "too large".encode("utf-8")
    mime = _image_mime(content_type, raw)
    if not mime:
        return 502, plain, "not an image".encode("utf-8")
    return 200, {"Content-Type": mime, "Cache-Control": "private, max-age=3600"}, raw


def _extract_translation(data: dict) -> str:
    choices = (data.get("choices") or [])
    if not choices:
        raise RuntimeError(data.get("message") or "翻译响应为空")
    content = (choices[0].get("message") or {}).get("content") or ""
    text = str(content).strip()
    if not text:
        raise RuntimeError("翻译结果为空")
    return text


def translate_color(text: str, api_key: str, urlopen) -> str:
    """按 TRANSLATE_MODELS 顺序调用，返回首个成功结果；全失败抛出最后一个异常。"""
    last_error = None
    for model in TRANSLATE_MODELS:
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": TRANSLATE_SYSTEM},
                {"role": "user", "content": text},
            ],
            "temperature": 0,
        }
        request = urllib.request.Request(
            TRANSLATE_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        started = time.perf_counter()
        try:
            with urlopen(request, timeout=30) as response:
                data = json.loads(response.read().decode("utf-8"))
            name = _extract_translation(data)
            _log(
                f"[颜色翻译] 成功 | 模型={model} 输入={text} 输出={name} "
                f"耗时={time.perf_counter() - started:.1f}s"
            )
            return name
        except Exception as exc:
            last_error = exc
            _log(
                f"[颜色翻译] 该模型失败，继续下一个 | 模型={model} 输入={text} "
                f"耗时={time.perf_counter() - started:.1f}s 原因={_public_error(exc, api_key)}"
            )
    raise (last_error or RuntimeError("翻译失败"))


def mock_translate(text: str) -> str:
    """无密钥/离线时的本地兜底，输出 color #HEX 形式，保证永远有值。"""
    return f"color {text.strip()}"


def handle_translate(body, api_key=None, mock=False, urlopen=None):
    text = str(body.get("input") or "").strip()
    if not text:
        _log("[颜色翻译] 失败 | 原因=请求里没有颜色值")
        return 400, {"error": "缺少颜色值"}
    _log(f"[颜色翻译] 开始 | 输入={text} 模型链={' -> '.join(TRANSLATE_MODELS)}")
    if mock:
        name = mock_translate(text)
        _log(f"[颜色翻译] 成功（mock 模式，未调用真实模型） | 输入={text} 输出={name}")
        return 200, {"englishName": name}
    if not api_key:
        _log(f"[颜色翻译] 失败 | 输入={text} 原因=未配置 DASHSCOPE_API_KEY")
        return 503, {"error": "未配置 DASHSCOPE_API_KEY"}
    opener = urlopen or urllib.request.urlopen
    try:
        name = translate_color(text, api_key, opener)
    except Exception as exc:
        message = _public_error(exc, api_key)
        _log(f"[颜色翻译] 全部模型失败 | 输入={text} 原因={message}")
        return 502, {"error": message}
    return 200, {"englishName": name}


def chibi_style_images() -> dict:
    folder = ROOT / "assets" / "q_photos_reference"
    images = []
    if folder.is_dir():
        for path in sorted(folder.iterdir()):
            if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
                continue
            mime = mimetypes.guess_type(path.name)[0] or "image/png"
            encoded = base64.b64encode(path.read_bytes()).decode("ascii")
            images.append(f"data:{mime};base64,{encoded}")
    if images:
        _log(f"[Q版风格图] 读取成功 | 目录={folder} 共 {len(images)} 张")
    else:
        _log(f"[Q版风格图] 读取完成 | 目录={folder} 没有可用图片（Q版将不传风格参考图）")
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


# ---------------- 4K 超分（壁纸导出） ----------------

_UPSCALE_TASKS: dict = {}
_UPSCALE_LOCK = threading.Lock()

UPSCALE_MODELS = ("animevideov3", "general-x4v3", "x4plus")
# 8GB 显存下单张 1080p→4K 峰值约 1.7GB，但每个超分进程还有 ~1GB 的 CUDA
# context/cuDNN 固定开销，3 路并发会打爆 8GB（实测 7857/8188 MiB 卡死）。
# 安全并行 2 路；超出的任务在队列里等待，不会同时挤爆显存。
UPSCALE_MAX_WORKERS = 2
_UPSCALE_SLOTS = threading.BoundedSemaphore(UPSCALE_MAX_WORKERS)


def upscale_script_path(environ=None):
    """找到 super-resolution-service 的 upscale_video.py；找不到返回 None。

    显式设置了 UPSCALE_SCRIPT 时不再回退到默认路径：找不到就视为未安装。
    """
    env = os.environ if environ is None else environ
    override = env.get("UPSCALE_SCRIPT")
    if override:
        return override if os.path.isfile(override) else None
    home = env.get("USERPROFILE") or os.path.expanduser("~")
    path = os.path.join(home, ".cursor", "skills", "super-resolution-service", "scripts", "upscale_video.py")
    return path if os.path.isfile(path) else None


def _terminate_tree(proc):
    """终止超分子进程（含 ffmpeg 等子进程），Windows 用 taskkill 杀整棵树。"""
    if proc is None or proc.poll() is not None:
        return
    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                capture_output=True, timeout=10,
            )
            return
        except Exception:  # noqa: BLE001
            pass
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except Exception:  # noqa: BLE001
        proc.kill()


def _run_upscale_task(task_id, script, in_path, out_path, model, scale, denoise, run=None, store=None):
    """后台线程执行体。run 可注入以便测试。"""
    runner = run or subprocess.run
    store = store if store is not None else _UPSCALE_TASKS
    # 显存安全闸：最多 UPSCALE_MAX_WORKERS 个超分进程同时跑，其余在此排队。
    with _UPSCALE_SLOTS:
        proc = None
        try:
            cmd = [
                sys.executable, script,
                "--input", str(in_path),
                "--output", str(out_path),
                "--scale", str(scale),
                "--model", model,
            ]
            if denoise is not None and model == "general-x4v3":
                cmd += ["--denoise", str(denoise)]
            attempts = FFMPEG_MAX_ATTEMPTS if run is None else 1
            last_exc = None
            for attempt in range(1, attempts + 1):
                # 排队期间可能已被取消，每轮都检查一次。
                with _UPSCALE_LOCK:
                    if store.get(task_id, {}).get("status") == "cancelled":
                        return
                _log(f"[超分] {task_id} 开始执行 scale={scale} model={model}"
                     + (f"（第 {attempt} 次）" if attempt > 1 else ""))
                try:
                    if run is not None:
                        # 测试注入的假 runner：无法真正中断，直接跑。
                        runner(cmd, check=True)
                    else:
                        proc = subprocess.Popen(cmd)
                        with _UPSCALE_LOCK:
                            store[task_id]["proc"] = proc
                        proc.wait()
                        if proc.returncode != 0:
                            raise RuntimeError(f"超分脚本退出码 {proc.returncode}")
                    if not os.path.isfile(out_path):
                        raise RuntimeError("超分脚本未产出结果文件")
                    break
                except Exception as exc:  # noqa: BLE001
                    last_exc = exc
                    if attempt < attempts:
                        _log(f"[超分] {task_id} 第 {attempt} 次失败，{FFMPEG_RETRY_DELAY:.1f}s 后重试: {exc}")
                        time.sleep(FFMPEG_RETRY_DELAY)
                        if os.path.isfile(out_path):
                            try:
                                os.remove(out_path)
                            except OSError:
                                pass
            else:
                raise last_exc
            with _UPSCALE_LOCK:
                if store.get(task_id, {}).get("status") == "cancelled":
                    return
                store[task_id]["status"] = "done"
            _log(f"[超分] {task_id} 完成")
        except Exception as exc:  # noqa: BLE001
            with _UPSCALE_LOCK:
                if store.get(task_id, {}).get("status") != "cancelled":
                    store[task_id]["status"] = "error"
                    store[task_id]["error"] = str(exc)
            _log(f"[超分] {task_id} 失败: {exc}")
        finally:
            with _UPSCALE_LOCK:
                store.get(task_id, {}).pop("proc", None)


def _upscale_bad_request(reason: str):
    _log(f"[超分] 参数不合法：{reason}")
    return 400, {"error": reason}


def handle_upscale(body, environ=None, run=None, task_store=None, make_id=None):
    if not isinstance(body, dict):
        return _upscale_bad_request("请求体必须是 JSON 对象")
    data_url = body.get("videoDataUrl")
    if not isinstance(data_url, str) or not data_url.startswith("data:"):
        return _upscale_bad_request("缺少 videoDataUrl")
    raw, _content_type = split_data_url(data_url)
    if not raw:
        return _upscale_bad_request("无法解析视频数据")
    model = body.get("model") or "animevideov3"
    if model not in UPSCALE_MODELS:
        return _upscale_bad_request(f"不支持的模型：{model}")
    script = upscale_script_path(environ)
    if not script:
        return 503, {"error": "未找到 super-resolution-service 超分脚本"}
    raw_scale = body.get("scale")
    if raw_scale is None or raw_scale == "":
        scale = 2.0
    else:
        try:
            scale = float(raw_scale)
        except (TypeError, ValueError):
            return _upscale_bad_request("scale 必须是数字")
    if not (0 < scale <= 8):
        return _upscale_bad_request("scale 需在 (0, 8] 范围内")
    denoise = body.get("denoise")
    if denoise is not None:
        try:
            denoise = float(denoise)
        except (TypeError, ValueError):
            return _upscale_bad_request("denoise 必须是数字")
        if not (0 <= denoise <= 1):
            return _upscale_bad_request("denoise 需在 [0, 1] 范围内")
        if model != "general-x4v3":
            return _upscale_bad_request("denoise 仅用于 general-x4v3 模型")
    store = task_store if task_store is not None else _UPSCALE_TASKS
    gen_id = make_id or (lambda: uuid.uuid4().hex[:12])
    task_id = gen_id()
    work_dir = Path(tempfile.gettempdir()) / f"wallpaper_upscale_{task_id}"
    work_dir.mkdir(parents=True, exist_ok=True)
    in_path = work_dir / "in.webm"
    out_path = work_dir / "out.mp4"
    in_path.write_bytes(raw)
    with _UPSCALE_LOCK:
        store[task_id] = {"status": "running", "error": None, "result_path": str(out_path), "progress": 0.0}
    thread = threading.Thread(
        target=_run_upscale_task,
        args=(task_id, script, in_path, out_path, model, scale, denoise, run, store),
        daemon=True,
    )
    thread.start()
    _log(f"[超分] 任务启动 taskId={task_id} model={model} 输入={len(raw)}字节")
    return 200, {"taskId": task_id}


def handle_upscale_cancel(path, task_store=None):
    """取消一个运行中的超分任务：标记 cancelled 并终止其子进程（含 ffmpeg）。"""
    store = task_store if task_store is not None else _UPSCALE_TASKS
    task_id = _query_param(path, "taskId")
    task = store.get(task_id)
    if not task:
        return 404, {"error": "任务不存在"}
    with _UPSCALE_LOCK:
        if task["status"] in ("done", "error", "cancelled"):
            return 200, {"status": task["status"]}
        task["status"] = "cancelled"
        proc = task.get("proc")
    if proc is not None:
        _terminate_tree(proc)
    _log(f"[超分] {task_id} 已取消")
    return 200, {"status": "cancelled"}


def _query_param(path, key):
    value = parse_qs(urlsplit(path or "").query).get(key)
    return value[0] if value else None


def handle_upscale_status(path, task_store=None):
    store = task_store if task_store is not None else _UPSCALE_TASKS
    task_id = _query_param(path, "taskId")
    task = store.get(task_id)
    if not task:
        return 404, {"error": "任务不存在"}
    return 200, {"status": task["status"],
                  "progress": 100.0 if task["status"] == "done" else task.get("progress", 0.0),
                  "error": task.get("error")}


def handle_upscale_result(path, task_store=None):
    store = task_store if task_store is not None else _UPSCALE_TASKS
    task_id = _query_param(path, "taskId")
    task = store.get(task_id)
    if not task:
        return 404, {"Content-Type": "text/plain; charset=utf-8"}, b"task not found"
    if task["status"] != "done":
        return 409, {"Content-Type": "text/plain; charset=utf-8"}, b"not ready"
    result = Path(task["result_path"])
    if not result.is_file():
        return 404, {"Content-Type": "text/plain; charset=utf-8"}, b"result missing"
    return 200, {
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="wallpaper-4k.mp4"',
    }, result.read_bytes()


# ---------------- 动态壁纸2：首尾帧视频生成（通义万相 wan3.0） ----------------

_VIDEO_TASKS: dict = {}
_VIDEO_LOCK = threading.Lock()

# 万相 3.0 是 All-in-One 模型：同一个 ID 覆盖文生视频 / 首帧 / 首尾帧。
# 首尾帧靠 input.media 里同时给 first_frame 和 last_frame 实现，首尾同图即无缝循环。
# 注意不能用 *-turbo 那批老 ID：它们的请求体是 input.first_frame + parameters.size，和新接口不兼容。
VIDEO_MODELS = {
    "wan3.0-video-prime": {"first_last": True},
    "wan3.0-video": {"first_last": True},
}
DEFAULT_VIDEO_MODEL = "wan3.0-video-prime"
VIDEO_RESOLUTIONS = ("480P", "720P", "1080P")
VIDEO_RATIOS = ("adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16")
DEFAULT_VIDEO_RESOLUTION = "720P"
DEFAULT_VIDEO_RATIO = "adaptive"
VIDEO_DURATION_MIN = 2
VIDEO_DURATION_MAX = 30
# 6 秒：全身重心左右交替的一个来回 ≈ 6~10 秒，静息呼吸 ≈ 4~5 秒；
# 周期越接近自然频率，同样的位移需要的速度越慢，看起来越「柔」。
# 2 秒会把呼吸压成 30 次/分的急促节拍，这是旧版机械感的来源。
DEFAULT_VIDEO_DURATION = 6
VIDEO_POLL_INTERVAL = 5
VIDEO_TIMEOUT = 900


def _pick_choice(value, allowed, default):
    """把请求里的枚举值洗一遍：大小写不敏感，非法值退回默认，不抛错。"""
    if not isinstance(value, str):
        return default
    text = value.strip()
    for item in allowed:
        if item.lower() == text.lower():
            return item
    return default


def _pick_duration(value):
    try:
        duration = int(value)
    except (TypeError, ValueError):
        return DEFAULT_VIDEO_DURATION
    return min(VIDEO_DURATION_MAX, max(VIDEO_DURATION_MIN, duration))


def build_video_payload(body: dict) -> dict:
    """把动态壁纸2 的请求拼成百炼 wan3.0 video-synthesis 的 JSON（纯函数，便于单测）。

    正向词放 input.prompt；负向词折叠进 prompt 尾部（视频接口没有独立的 negative_prompt 字段，
    与生图 2.1 的「Avoid:」处理保持一致）。首尾帧都用同一张图，保证首尾画面一致、循环闭合。
    """
    model = body.get("model") or DEFAULT_VIDEO_MODEL
    spec = VIDEO_MODELS.get(model)
    if spec is None:
        raise ValueError(f"不支持的模型：{model}")
    prompt = body.get("prompt") or ""
    negative = body.get("negativePrompt") or ""
    if negative:
        # 万相 3.0 官方提示词公式把负向写成单独的【负向清单】段落，而不是英文
        # "Negative prompt:" 前缀。拼成一段比塞进 parameters 更贴合它的训练分布。
        prompt = f"{prompt}\n\n【负向清单】不要出现以下内容：{negative}"
    first = body.get("imageDataUrl")
    if not isinstance(first, str) or not first.startswith("data:image"):
        raise ValueError("缺少图片")
    media = [{"type": "first_frame", "url": first}]
    if spec["first_last"]:
        media.append({"type": "last_frame", "url": first})
    return {
        "model": model,
        "input": {"prompt": prompt, "media": media},
        "parameters": {
            "resolution": _pick_choice(body.get("resolution"), VIDEO_RESOLUTIONS, DEFAULT_VIDEO_RESOLUTION),
            "ratio": _pick_choice(body.get("ratio"), VIDEO_RATIOS, DEFAULT_VIDEO_RATIO),
            "duration": _pick_duration(body.get("duration")),
            # 壁纸不要音轨：显式关掉，文件更小、播放器也不出声。
            "audio": False,
            # 关闭智能改写：用户给的待机动画 + 四维防御负向词要原样生效。
            "prompt_extend": False,
            "watermark": False,
        },
    }


def _extract_video_url(data: dict):
    out = data.get("output") or {}
    url = out.get("video_url")
    if url:
        return url
    results = out.get("results")
    if isinstance(results, list) and results:
        url = (results[0].get("url") or results[0].get("video_url")) if isinstance(results[0], dict) else None
        if url:
            return url
    return None


def _create_dashscope_task(payload: dict, api_key: str, urlopen, gen_url: str = None) -> str:
    request = urllib.request.Request(
        gen_url or VIDEO_GEN_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
        },
        method="POST",
    )
    with urlopen(request, timeout=120) as response:
        data = json.loads(response.read().decode("utf-8"))
    out = data.get("output") or {}
    task_id = out.get("task_id")
    if not task_id:
        raise RuntimeError(data.get("message") or _error_detail(data) or "响应中无 task_id")
    return task_id


def _poll_dashscope_task(dash_id: str, api_key: str, urlopen, task_url: str = None):
    request = urllib.request.Request(
        (task_url or VIDEO_TASK_URL) + dash_id,
        headers={"Authorization": f"Bearer {api_key}"},
        method="GET",
    )
    with urlopen(request, timeout=60) as response:
        data = json.loads(response.read().decode("utf-8"))
    out = data.get("output") or {}
    status = out.get("task_status") or data.get("task_status") or "UNKNOWN"
    return status, _extract_video_url(data)


def _download_video(video_url: str, urlopen) -> bytes:
    request = urllib.request.Request(video_url, method="GET")
    with urlopen(request, timeout=180) as response:
        return response.read()


def _run_video_task(task_id, payload, api_key, out_path, urlopen, sleep_fn, store, environ=None):
    try:
        gen_url = video_gen_url(environ)
        task_url = video_task_url(environ)
        dash_id = _create_dashscope_task(payload, api_key, urlopen, gen_url)
        _log(f"[视频] {task_id} 百炼任务 {dash_id} 已创建，开始轮询")
        deadline = time.monotonic() + VIDEO_TIMEOUT
        video_url = None
        while True:
            with _VIDEO_LOCK:
                if store.get(task_id, {}).get("status") == "cancelled":
                    return
            sleep_fn(VIDEO_POLL_INTERVAL)
            status, video_url = _poll_dashscope_task(dash_id, api_key, urlopen, task_url)
            if status == "SUCCEEDED":
                break
            if status in ("FAILED", "CANCELED", "UNKNOWN"):
                raise RuntimeError(f"百炼视频任务失败（{status}）")
            if time.monotonic() > deadline:
                raise RuntimeError("视频生成超时")
        if not video_url:
            raise RuntimeError("百炼返回中没有 video_url")
        raw = _download_video(video_url, urlopen)
        # 这里只落原始模型输出：色彩锁定和补帧/超分一起放在前端「一键处理」里，
        # 让用户先看到未经处理的原片、确认动作没问题，再决定花时间走完整条流水线。
        out_path.write_bytes(raw)
        with _VIDEO_LOCK:
            if store.get(task_id, {}).get("status") == "cancelled":
                return
            store[task_id]["status"] = "done"
        _log(f"[视频] {task_id} 完成 {len(raw)} 字节")
    except Exception as exc:  # noqa: BLE001
        message = _error_detail(exc)
        if api_key:
            message = message.replace(api_key, "[redacted]")
        with _VIDEO_LOCK:
            if store.get(task_id, {}).get("status") != "cancelled":
                store[task_id]["status"] = "error"
                store[task_id]["error"] = message
        _log(f"[视频] {task_id} 失败: {message}")


def handle_video_gen(body, environ=None, urlopen=None, task_store=None, make_id=None, sleep_fn=None):
    if not isinstance(body, dict):
        return 400, {"error": "请求体必须是 JSON 对象"}
    try:
        payload = build_video_payload(body)
    except ValueError as exc:
        _log(f"[视频] 参数不合法：{exc}")
        return 400, {"error": str(exc)}
    env = os.environ if environ is None else environ
    api_key = (env.get("DASHSCOPE_API_KEY") or "").strip()
    if not api_key:
        return 503, {"error": "未配置 DASHSCOPE_API_KEY"}
    store = task_store if task_store is not None else _VIDEO_TASKS
    gen_id = make_id or (lambda: uuid.uuid4().hex[:12])
    task_id = gen_id()
    work_dir = Path(tempfile.gettempdir()) / f"wallpaper_video_{task_id}"
    work_dir.mkdir(parents=True, exist_ok=True)
    out_path = work_dir / "out.mp4"
    with _VIDEO_LOCK:
        store[task_id] = {"status": "running", "error": None, "result_path": str(out_path), "progress": 0.0}
    thread = threading.Thread(
        target=_run_video_task,
        args=(task_id, payload, api_key, out_path, urlopen or urllib.request.urlopen, sleep_fn or time.sleep, store, env),
        daemon=True,
    )
    thread.start()
    _log(f"[视频] 任务启动 taskId={task_id} model={payload.get('model')} 图片={_data_url_summary(body.get('imageDataUrl'))}")
    return 200, {"taskId": task_id}


def handle_video_status(path, task_store=None):
    store = task_store if task_store is not None else _VIDEO_TASKS
    task = store.get(_query_param(path, "taskId"))
    if not task:
        return 404, {"error": "任务不存在"}
    return 200, {"status": task["status"],
                  "progress": 100.0 if task["status"] == "done" else task.get("progress", 0.0),
                  "error": task.get("error")}


def handle_video_result(path, task_store=None):
    store = task_store if task_store is not None else _VIDEO_TASKS
    task = store.get(_query_param(path, "taskId"))
    if not task:
        return 404, {"Content-Type": "text/plain; charset=utf-8"}, b"task not found"
    if task["status"] != "done":
        return 409, {"Content-Type": "text/plain; charset=utf-8"}, b"not ready"
    result = Path(task["result_path"])
    if not result.is_file():
        return 404, {"Content-Type": "text/plain; charset=utf-8"}, b"result missing"
    return 200, {
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="wallpaper2.mp4"',
    }, result.read_bytes()


def handle_video_cancel(path, task_store=None):
    store = task_store if task_store is not None else _VIDEO_TASKS
    task = store.get(_query_param(path, "taskId"))
    if not task:
        return 404, {"error": "任务不存在"}
    with _VIDEO_LOCK:
        if task["status"] in ("done", "error", "cancelled"):
            return 200, {"status": task["status"]}
        task["status"] = "cancelled"
    _log(f"[视频] {_query_param(path, 'taskId')} 已取消")
    return 200, {"status": "cancelled"}


# ---------------- 动态壁纸2：逐帧色彩锁定（消除明暗呼吸与色温漂移） ----------------
# 极静画面里模型的头号破绽不是动作，而是「整段在极缓慢地一明一暗」，或者色温
# 从头到尾轻轻漂移。动作再柔，只要整体明暗在动，眼睛立刻判定为假。
# 做法：以整段帧均值的中位数为基准，逐帧算增益把画面拉平；增益曲线先做 0.4 秒
# 滑动平均再施加——要消除的是低频漂移，而不是「袖子摆动导致的真实明暗变化」，
# 逐帧硬对齐反而会制造出新的抖。全流程失败都返回原视频：这是兜底增强，
# 绝不能拖垮生成。

COLOR_LOCK_DEFAULT_ENABLED = True
COLOR_LOCK_SMOOTH_SECONDS = 0.4
COLOR_LOCK_MIN_GAIN = 0.8
COLOR_LOCK_MAX_GAIN = 1.2
COLOR_LOCK_TIMEOUT = 300


def color_lock_enabled(environ=None) -> bool:
    """WALLPAPER_COLOR_LOCK=0/false/off 可整段关掉这道后处理。"""
    env = os.environ if environ is None else environ
    value = (env.get("WALLPAPER_COLOR_LOCK") or "").strip().lower()
    if value in ("0", "false", "off", "no"):
        return False
    return COLOR_LOCK_DEFAULT_ENABLED


def _smooth_gain_curve(gains, window: int):
    """逐通道滑动平均，边界用端点值填充，保证输出长度不变。"""
    import numpy as np

    if window <= 1 or len(gains) <= 1:
        return gains
    half = window // 2
    out = np.empty_like(gains)
    kernel = np.ones(window, dtype=gains.dtype) / float(window)
    for channel in range(gains.shape[1]):
        padded = np.pad(gains[:, channel], half, mode="edge")
        out[:, channel] = np.convolve(padded, kernel, mode="valid")[: len(gains)]
    return out


def color_lock_gains(frame_means, fps: float = 30.0):
    """由每帧 RGB 均值算出逐帧增益：target/current，限幅后做时间平滑。

    target 取整段的**中位数**而不是首帧：首帧万一是从黑场淡入、或者模型第一帧
    有瞬时瑕疵，拿它当基准会把整段拉黑。中位数对个别异常帧免疫，同时仍能保证
    「整段色调统一」——我们要消的是段内漂移，不是把成片硬拉回立绘的色值。
    """
    import numpy as np

    means = np.asarray(frame_means, dtype=np.float64)
    if means.ndim != 2 or means.shape[0] < 2:
        return np.ones_like(means)
    target = np.median(means, axis=0)
    safe = np.maximum(means, 1e-6)
    gains = np.clip(target / safe, COLOR_LOCK_MIN_GAIN, COLOR_LOCK_MAX_GAIN)
    window = int(round(max(1.0, fps) * COLOR_LOCK_SMOOTH_SECONDS))
    if window % 2 == 0:
        window += 1
    return _smooth_gain_curve(gains, window)


def _read_exact(stream, size: int):
    """管道 read 可能短读，必须循环凑满一整帧，否则画面会斜切。"""
    chunks = []
    remaining = size
    while remaining > 0:
        chunk = stream.read(remaining)
        if not chunk:
            return None
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def _probe_video_stream(path):
    probe = shutil.which("ffprobe")
    if not probe:
        return None
    try:
        proc = subprocess.run(
            [
                probe, "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=width,height,avg_frame_rate",
                "-of", "json", str(path),
            ],
            capture_output=True,
            timeout=60,
        )
        data = json.loads(proc.stdout.decode("utf-8", "replace") or "{}")
        stream = (data.get("streams") or [{}])[0]
        width = int(stream.get("width") or 0)
        height = int(stream.get("height") or 0)
        if width <= 0 or height <= 0:
            return None
        rate = str(stream.get("avg_frame_rate") or "30/1")
        if rate in ("0/0", "N/A", ""):
            rate = "30/1"
        return {"width": width, "height": height, "rate": rate}
    except Exception:  # noqa: BLE001
        return None


def _rate_to_fps(rate: str) -> float:
    try:
        num, _, den = rate.partition("/")
        value = float(num) / float(den or 1)
        return value if value > 0 else 30.0
    except Exception:  # noqa: BLE001
        return 30.0


def _iter_rgb_frames(path, width: int, height: int):
    """把视频逐帧解成 RGB24 的 numpy 数组，流式 yield，不占大内存。"""
    import numpy as np

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return
    frame_size = width * height * 3
    proc = subprocess.Popen(
        [ffmpeg, "-v", "error", "-i", str(path), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    try:
        while True:
            buf = _read_exact(proc.stdout, frame_size)
            if buf is None:
                break
            yield np.frombuffer(buf, dtype=np.uint8).reshape(height, width, 3)
    finally:
        try:
            proc.stdout.close()
        except Exception:  # noqa: BLE001
            pass
        if proc.poll() is None:
            proc.kill()
        try:
            proc.wait(timeout=10)
        except Exception:  # noqa: BLE001
            pass


def _encode_locked_frames(src, dst, info, gains) -> bool:
    """第二次解码时顺手施加增益并重编码；CRF16 + veryfast，肉眼无损且够快。"""
    import numpy as np

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return False
    width, height = info["width"], info["height"]
    cmd = [
        ffmpeg, "-y", "-v", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{width}x{height}", "-r", info["rate"], "-i", "-",
        "-an",
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "16",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        str(dst),
    ]
    encoder = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    written = 0
    try:
        for index, frame in enumerate(_iter_rgb_frames(src, width, height)):
            gain = gains[index] if index < len(gains) else gains[-1]
            corrected = np.clip(
                frame.astype(np.float32) * gain.reshape(1, 1, 3).astype(np.float32),
                0.0,
                255.0,
            ).astype(np.uint8)
            encoder.stdin.write(corrected.tobytes())
            written += 1
    finally:
        try:
            encoder.stdin.close()
        except Exception:  # noqa: BLE001
            pass
        encoder.wait(timeout=COLOR_LOCK_TIMEOUT)
    return written > 0 and dst.is_file() and dst.stat().st_size > 0


def lock_video_colors(video_bytes: bytes, environ=None, log=None) -> bytes:
    """把每一帧的 RGB 均值对齐首帧，消除明暗呼吸与色温漂移。失败即返回原视频。"""
    emit = log or _log
    if not video_bytes:
        return video_bytes
    try:
        np = importlib.import_module("numpy")
    except Exception:  # noqa: BLE001
        emit("[色彩锁定] 缺少 numpy，跳过")
        return video_bytes
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        emit("[色彩锁定] 缺少 ffmpeg/ffprobe，跳过")
        return video_bytes

    work_dir = Path(tempfile.mkdtemp(prefix="wallpaper_colorlock_"))
    try:
        src = work_dir / "in.mp4"
        dst = work_dir / "out.mp4"
        src.write_bytes(video_bytes)
        info = _probe_video_stream(src)
        if not info:
            return video_bytes
        means = []
        for frame in _iter_rgb_frames(src, info["width"], info["height"]):
            means.append(frame.reshape(-1, 3).mean(axis=0))
        if len(means) < 2:
            emit("[色彩锁定] 帧数不足，跳过")
            return video_bytes
        fps = _rate_to_fps(info["rate"])
        gains = color_lock_gains(np.asarray(means), fps)
        if not _encode_locked_frames(src, dst, info, gains):
            emit("[色彩锁定] 重编码失败，返回原视频")
            return video_bytes
        spread = (
            f"{float(np.min(gains)):.3f}~{float(np.max(gains)):.3f}"
        )
        emit(f"[色彩锁定] 完成，{len(means)} 帧，增益 {spread}")
        return dst.read_bytes()
    except Exception as exc:  # noqa: BLE001
        emit(f"[色彩锁定] 失败，返回原视频：{exc}")
        return video_bytes
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def handle_color_lock(body, environ=None, run=None, log=None):
    """POST /api/color-lock：同步跑一次逐帧色彩锁定，直接返回 mp4 字节。

    同步是刻意的：6 秒 720P 实测约 5 秒，比再加一套任务/轮询的状态机简单得多。
    用 X-Color-Locked 告诉前端这次到底改没改（缺 numpy / 缺 ffmpeg / 帧数不足都会
    原样返回），前端据此在流水线里显示「已完成」还是「跳过」，不谎报。
    """
    if not isinstance(body, dict):
        return _json(400, {"error": "请求体必须是 JSON 对象"})
    data_url = body.get("videoDataUrl")
    if not isinstance(data_url, str) or not data_url.startswith("data:"):
        return _json(400, {"error": "缺少 videoDataUrl"})
    raw, _content_type = split_data_url(data_url)
    if not raw:
        return _json(400, {"error": "无法解析视频数据"})
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        return _json(503, {"error": "未找到 ffmpeg/ffprobe，无法做色彩锁定"})
    locked = lock_video_colors(raw, environ=environ, log=log)
    changed = locked is not raw
    return 200, {
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="wallpaper2-locked.mp4"',
        "X-Color-Locked": "1" if changed else "0",
    }, locked


# ---------------- 动态壁纸2：补帧到 60FPS（RIFE） ----------------

_INTERP_TASKS: dict = {}
_INTERP_LOCK = threading.Lock()

# 同时跑几路补帧任务。RIFE 对显存敏感，仍限 1 路任务，避免和超分抢爆 8GB 显存；
# 单路任务内部是多 stream 并行的（见 rife_parallel.py）：720P 实测 4 路是拐点，
# 1 路 73.9ms/对 -> 4 路 49.3ms/对（约 1.5x），显存 827MB -> 2950MB。
INTERP_MAX_WORKERS = 1
_INTERP_SLOTS = threading.BoundedSemaphore(INTERP_MAX_WORKERS)

INTERP_WORKERS = 4
INTERP_IO_WORKERS = 6


def interpolate_parallel_script_path():
    """项目自带的并行补帧驱动（多 stream + 线程池 IO），找不到则返回 None。"""
    path = os.path.join(str(ROOT), "server", "rife_parallel.py")
    return path if os.path.isfile(path) else None


def interpolate_parallel_enabled(environ=None) -> bool:
    """INTERPOLATE_PARALLEL 显式开关优先；没显式指定就默认走并行驱动。

    显式给了 INTERPOLATE_SCRIPT（用户自己指了别的补帧脚本）时不要偷偷换成并行驱动。
    """
    env = os.environ if environ is None else environ
    value = (env.get("INTERPOLATE_PARALLEL") or "").strip().lower()
    if value in ("1", "true", "on", "yes"):
        return interpolate_parallel_script_path() is not None
    if value in ("0", "false", "off", "no"):
        return False
    if (env.get("INTERPOLATE_SCRIPT") or "").strip():
        return False
    return interpolate_parallel_script_path() is not None


def interp_settings(environ=None) -> dict:
    """并行度：环境变量可覆盖，方便按显存临时调小。

    rife_parallel.py 自己还会按空闲显存和分辨率再收窄一次，这里给的只是上限。
    """
    env = os.environ if environ is None else environ

    def _int(name, default, high=16):
        try:
            return max(1, min(high, int((env.get(name) or "").strip())))
        except (TypeError, ValueError):
            return default

    return {
        "workers": _int("RIFE_WORKERS", INTERP_WORKERS, high=6),
        "io_workers": _int("RIFE_IO_WORKERS", INTERP_IO_WORKERS),
    }


def interpolate_script_path(environ=None):
    """找到 frame-interpolation-service 的 interpolate_video.py；找不到返回 None。"""
    env = os.environ if environ is None else environ
    override = env.get("INTERPOLATE_SCRIPT")
    if override:
        return override if os.path.isfile(override) else None
    home = env.get("USERPROFILE") or os.path.expanduser("~")
    path = os.path.join(home, ".cursor", "skills", "frame-interpolation-service", "scripts", "interpolate_video.py")
    return path if os.path.isfile(path) else None


def _run_interp_task(task_id, script, in_path, out_path, target_fps, run, store, interp_extra=None):
    runner = run or subprocess.run
    with _INTERP_SLOTS:
        proc = None
        try:
            cmd = [
                sys.executable, script,
                "--input", str(in_path),
                "--output", str(out_path),
                "--target-fps", str(target_fps),
            ]
            if interp_extra:
                cmd += interp_extra
            attempts = FFMPEG_MAX_ATTEMPTS if run is None else 1
            last_exc = None
            for attempt in range(1, attempts + 1):
                with _INTERP_LOCK:
                    if store.get(task_id, {}).get("status") == "cancelled":
                        return
                _log(f"[补帧] {task_id} 开始 target-fps={target_fps} {' '.join(interp_extra or [])}".strip()
                     + (f"（第 {attempt} 次）" if attempt > 1 else ""))
                try:
                    if run is not None:
                        runner(cmd, check=True)
                    else:
                        proc = subprocess.Popen(cmd)
                        with _INTERP_LOCK:
                            store[task_id]["proc"] = proc
                        proc.wait()
                        if proc.returncode != 0:
                            raise RuntimeError(f"补帧脚本退出码 {proc.returncode}")
                    if not os.path.isfile(out_path):
                        raise RuntimeError("补帧脚本未产出结果文件")
                    break
                except Exception as exc:  # noqa: BLE001
                    last_exc = exc
                    if attempt < attempts:
                        _log(f"[补帧] {task_id} 第 {attempt} 次失败，{FFMPEG_RETRY_DELAY:.1f}s 后重试: {exc}")
                        time.sleep(FFMPEG_RETRY_DELAY)
                        if os.path.isfile(out_path):
                            try:
                                os.remove(out_path)
                            except OSError:
                                pass
            else:
                raise last_exc
            with _INTERP_LOCK:
                if store.get(task_id, {}).get("status") == "cancelled":
                    return
                store[task_id]["status"] = "done"
            _log(f"[补帧] {task_id} 完成")
        except Exception as exc:  # noqa: BLE001
            with _INTERP_LOCK:
                if store.get(task_id, {}).get("status") != "cancelled":
                    store[task_id]["status"] = "error"
                    store[task_id]["error"] = str(exc)
            _log(f"[补帧] {task_id} 失败: {exc}")
        finally:
            with _INTERP_LOCK:
                store.get(task_id, {}).pop("proc", None)


def handle_interpolate(body, environ=None, run=None, task_store=None, make_id=None):
    if not isinstance(body, dict):
        return 400, {"error": "请求体必须是 JSON 对象"}
    data_url = body.get("videoDataUrl")
    if not isinstance(data_url, str) or not data_url.startswith("data:"):
        return 400, {"error": "缺少 videoDataUrl"}
    raw, _content_type = split_data_url(data_url)
    if not raw:
        return 400, {"error": "无法解析视频数据"}
    script = interpolate_script_path(environ)
    if not script:
        return 503, {"error": "未找到 frame-interpolation-service 补帧脚本"}
    # 默认走项目自带的并行驱动（多 stream + 线程池 IO）；
    # 它依赖 skill 的模型与权重，脚本缺失时退回 skill 的单对串行版本。
    parallel = interpolate_parallel_enabled(environ)
    if parallel:
        script = interpolate_parallel_script_path()
    settings = interp_settings(environ)
    raw_fps = body.get("targetFps")
    target_fps = 60.0 if raw_fps is None or raw_fps == "" else raw_fps
    try:
        target_fps = float(target_fps)
    except (TypeError, ValueError):
        return 400, {"error": "targetFps 必须是数字"}
    if not (30 < target_fps <= 120):
        return 400, {"error": "targetFps 需在 (30, 120] 范围内"}
    store = task_store if task_store is not None else _INTERP_TASKS
    gen_id = make_id or (lambda: uuid.uuid4().hex[:12])
    task_id = gen_id()
    work_dir = Path(tempfile.gettempdir()) / f"wallpaper_interp_{task_id}"
    work_dir.mkdir(parents=True, exist_ok=True)
    in_path = work_dir / "in.mp4"
    out_path = work_dir / "out.mp4"
    in_path.write_bytes(raw)
    interp_extra = None
    if parallel:
        # 工作目录用任务自己的：两路并发出问题时不会互相踩掉 frames_in。
        interp_extra = [
            "--workers", str(settings["workers"]),
            "--io-workers", str(settings["io_workers"]),
            "--work", str(work_dir / "rife"),
        ]
    with _INTERP_LOCK:
        store[task_id] = {"status": "running", "error": None, "result_path": str(out_path), "progress": 0.0}
    thread = threading.Thread(
        target=_run_interp_task,
        args=(task_id, script, in_path, out_path, target_fps, run, store, interp_extra),
        daemon=True,
    )
    thread.start()
    _log(f"[补帧] 任务启动 taskId={task_id} 输入={len(raw)}字节 targetFps={target_fps} "
         f"{'并行 workers=' + str(settings['workers']) if parallel else '串行'}")
    return 200, {"taskId": task_id}


def handle_interpolate_status(path, task_store=None):
    store = task_store if task_store is not None else _INTERP_TASKS
    task = store.get(_query_param(path, "taskId"))
    if not task:
        return 404, {"error": "任务不存在"}
    return 200, {"status": task["status"],
                  "progress": 100.0 if task["status"] == "done" else task.get("progress", 0.0),
                  "error": task.get("error")}


def handle_interpolate_result(path, task_store=None):
    store = task_store if task_store is not None else _INTERP_TASKS
    task = store.get(_query_param(path, "taskId"))
    if not task:
        return 404, {"Content-Type": "text/plain; charset=utf-8"}, b"task not found"
    if task["status"] != "done":
        return 409, {"Content-Type": "text/plain; charset=utf-8"}, b"not ready"
    result = Path(task["result_path"])
    if not result.is_file():
        return 404, {"Content-Type": "text/plain; charset=utf-8"}, b"result missing"
    return 200, {
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="wallpaper2-60fps.mp4"',
    }, result.read_bytes()


def handle_interpolate_cancel(path, task_store=None):
    store = task_store if task_store is not None else _INTERP_TASKS
    task_id = _query_param(path, "taskId")
    task = store.get(task_id)
    if not task:
        return 404, {"error": "任务不存在"}
    with _INTERP_LOCK:
        if task["status"] in ("done", "error", "cancelled"):
            return 200, {"status": task["status"]}
        task["status"] = "cancelled"
        proc = task.get("proc")
    if proc is not None:
        _terminate_tree(proc)
    _log(f"[补帧] {task_id} 已取消")
    return 200, {"status": "cancelled"}


# ---------------- 批量水印：webm -> mp4 转码（ffmpeg） ----------------

# 转码是纯 CPU 活，水印导出前端本来就逐个串行，这里再上一把锁防止和超分/补帧的
# ffmpeg 同时开跑互相拖慢。同步执行：ThreadingHTTPServer 每请求一线程，不会卡住别的请求。
_TRANSCODE_LOCK = threading.Lock()

# ffmpeg / 超分 / 补帧脚本偶发崩溃（进程异常退出，而非「干净地拒绝」），是间歇性的，
# 自动重试这几轮几乎都能过。只对真实 subprocess 重试；测试注入的假 runner 保持单次。
FFMPEG_MAX_ATTEMPTS = 3
FFMPEG_RETRY_DELAY = 0.5

# .cube 只接受「我们自己导出的那张表」这个形状：一条 LUT_3D_SIZE、两条 DOMAIN、
# 其余全是三个 0~1 的浮点数。任何多余的东西都拒绝，避免把任意字符串拼进滤镜串。
_CUBE_SIZE_RE = re.compile(r"^LUT_3D_SIZE\s+(\d{1,2})$")
_CUBE_DOMAIN_RE = re.compile(r"^DOMAIN_(MIN|MAX)\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+$")
_CUBE_ROW_RE = re.compile(r"^(0(\.\d+)?|1(\.0+)?)(\s+(0(\.\d+)?|1(\.0+)?)){2}$")

MAX_CUBE_BYTES = 8 * 1024 * 1024


def parse_cube_lut(text):
    """校验并返回 .cube 文本；不合法就抛 ValueError。"""
    if not isinstance(text, str) or not text.strip():
        raise ValueError("LUT 为空")
    if len(text.encode("utf-8")) > MAX_CUBE_BYTES:
        raise ValueError("LUT 过大")
    size = None
    rows = 0
    domains = 0
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = _CUBE_SIZE_RE.match(line)
        if match:
            if size is not None:
                raise ValueError("LUT_3D_SIZE 重复")
            size = int(match.group(1))
            if not 2 <= size <= 65:
                raise ValueError("LUT_3D_SIZE 需在 2~65")
            continue
        if _CUBE_DOMAIN_RE.match(line):
            domains += 1
            continue
        if _CUBE_ROW_RE.match(line):
            rows += 1
            continue
        raise ValueError(f"LUT 含非法行：{line[:40]}")
    if size is None:
        raise ValueError("缺少 LUT_3D_SIZE")
    if rows != size ** 3:
        raise ValueError(f"LUT 行数不对：{rows} != {size ** 3}")
    return text


def _clamp_number(value, low, high, default=0.0):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(number):
        return default
    return max(low, min(high, number))


def build_grade_filters(grade):
    """把 4 个空间参数翻译成 ffmpeg 滤镜（顺序：锐化 → 清晰 → 颗粒 → 暗角）。

    没进 LUT 的这四个参数依赖位置（暗角、颗粒）或邻域（锐化、清晰），所以留在这里。
    数值映射对着 colorGrade.js：锐化 = unsharp r=1 amount=1.2s，清晰 = unsharp r=3
    amount=0.9c，颗粒 = ±40g 的均匀噪声，暗角 = 1-0.55v 的边缘压暗/提亮。
    """
    if not isinstance(grade, dict):
        return []
    filters = []
    sharpen = _clamp_number(grade.get("sharpen"), -1.0, 1.0)
    clarity = _clamp_number(grade.get("clarity"), -1.0, 1.0)
    grain = _clamp_number(grade.get("grain"), -1.0, 1.0)
    vignette = _clamp_number(grade.get("vignette"), -1.0, 1.0)
    if abs(sharpen) > 0.001:
        filters.append(f"unsharp=luma_msize_x=3:luma_msize_y=3:luma_amount={1.2 * sharpen:.3f}")
    if abs(clarity) > 0.001:
        filters.append(f"unsharp=luma_msize_x=7:luma_msize_y=7:luma_amount={0.9 * clarity:.3f}")
    if abs(grain) > 0.001:
        # uniform 噪声：JS 里是 ±40g 的均匀分布，ffmpeg 的 alls 是标准差量级，取绝对值即可。
        filters.append(f"noise=alls={abs(40 * grain):.1f}:allf=t+u")
    if abs(vignette) > 0.001:
        angle = max(0.1, min(1.5, (math.pi / 5) * (0.35 + abs(vignette) * 1.6)))
        mode = "forward" if vignette > 0 else "backward"
        filters.append(f"vignette=angle={angle:.3f}:mode={mode}")
    return filters


def handle_transcode(body, environ=None, run=None):
    """把前端编出的视频（H.264 裸流或 MediaRecorder 的 webm）转成 CFR 的 H.264/mp4，顺便把调色做完。

    输入有两种：
    - `inputFormat="h264"`：前端 WebCodecs 逐帧编码出的 Annex-B 裸流。裸流没有时间戳，
      用 `-f h264 -r fps` 按帧序铺成严格 CFR，帧数即时长，一帧不多一帧不少。
    - 其它（webm）：MediaRecorder 的墙钟时间戳，靠 `-fps_mode cfr -r fps` 按时间戳重采样。
      不加这两项，ffmpeg 会照抄 webm 的不均匀时间戳，出来的 mp4 可能是 2000fps 时基、
      平均 11fps，播放器卡成一团（这就是「导出后卡到爆炸」的根因）。

    动态壁纸把「调色」也放在这一步：`lut`（.cube 文本）负责 12 个逐像素参数，
    `grade`（4 个数字）负责锐化/清晰/颗粒/暗角。这样浏览器录制循环里不需要
    逐帧调色——1080P 上那一圈逐像素运算要 60~160ms/帧，60FPS 根本录不动。

    成功返回原始 mp4 字节，失败返回 JSON 错误。
    """
    if not isinstance(body, dict):
        return _json(400, {"error": "请求体必须是 JSON 对象"})
    data_url = body.get("videoDataUrl")
    if not isinstance(data_url, str) or not data_url.startswith("data:"):
        return _json(400, {"error": "缺少 videoDataUrl"})
    raw, _content_type = split_data_url(data_url)
    if not raw:
        return _json(400, {"error": "无法解析视频数据"})
    if not shutil.which("ffmpeg"):
        return _json(503, {"error": "未找到 ffmpeg，无法转码为 mp4"})

    input_format = (body.get("inputFormat") or "webm")
    if not isinstance(input_format, str) or input_format not in ("webm", "h264"):
        return _json(400, {"error": "inputFormat 只能是 h264 或 webm"})
    fps = _clamp_number(body.get("fps"), 1, 120, 60)

    lut_text = body.get("lut") or ""
    if lut_text:
        try:
            lut_text = parse_cube_lut(lut_text)
        except ValueError as exc:
            return _json(400, {"error": f"LUT 不合法：{exc}"})
    filters = build_grade_filters(body.get("grade"))
    if lut_text:
        # lut3d 放在所有空间滤镜之前：先定色调，再锐化/加颗粒/压暗角。
        filters.insert(0, "lut3d=file=grade.cube:interp=tetrahedral")
    crf = _clamp_number(body.get("crf"), 10, 28, 18)

    work_dir = Path(tempfile.gettempdir()) / f"wallpaper_transcode_{uuid.uuid4().hex[:12]}"
    work_dir.mkdir(parents=True, exist_ok=True)
    in_path = work_dir / ("in.h264" if input_format == "h264" else "in.webm")
    out_path = work_dir / "out.mp4"
    in_path.write_bytes(raw)
    if lut_text:
        (work_dir / "grade.cube").write_text(lut_text, encoding="utf-8")
    # 画布录制无音轨，显式 -an 丢弃，避免未知编码器报错；faststart 让 mp4 可边下边播。
    cmd = ["ffmpeg", "-y"]
    if input_format == "h264":
        # 裸流必须自己喂帧率，否则 h264 解复用器会报「找不到时间戳」。
        cmd += ["-f", "h264", "-r", f"{fps:g}"]
    cmd += ["-i", str(in_path)]
    if filters:
        cmd += ["-vf", ",".join(filters)]
    cmd += [
        # 无论输入是什么容器，输出一律锁定 CFR：时基整齐，播放器才不会一顿一顿。
        "-fps_mode", "cfr", "-r", f"{fps:g}",
        "-c:v", "libx264", "-crf", f"{crf:g}", "-preset", "veryfast",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        "-an",
        str(out_path),
    ]
    runner = run or subprocess.run
    # MediaRecorder 实时录出的 vp8/vp9 webm 时间戳不干净，个别输入会让 ffmpeg 7.x
    # 异常崩溃（退出码异常大），而非「干净地拒绝」。这种崩溃是间歇性的，重跑通常就成功。
    # 只对真实 subprocess.run 重试；测试注入的假 runner 保持单次语义。
    attempts = FFMPEG_MAX_ATTEMPTS if run is None else 1
    last_exc = None
    try:
        for attempt in range(1, attempts + 1):
            try:
                # cwd 指到工作目录：LUT 用相对文件名，省掉 Windows 盘符在滤镜串里的转义麻烦。
                with _TRANSCODE_LOCK:
                    runner(cmd, check=True, capture_output=True, cwd=str(work_dir))
                if not out_path.is_file() or out_path.stat().st_size == 0:
                    raise RuntimeError("转码未产出文件")
                break
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if attempt < attempts:
                    _log(f"[转码] 第 {attempt} 次失败，{FFMPEG_RETRY_DELAY:.1f}s 后重试: {exc}")
                    time.sleep(FFMPEG_RETRY_DELAY)
                    if out_path.is_file():
                        try:
                            out_path.unlink()
                        except OSError:
                            pass
        else:
            raise last_exc
    except Exception as exc:  # noqa: BLE001
        _log(f"[转码] 失败: {exc}")
        return _json(500, {"error": f"转码失败：{exc}"})
    raw_out = out_path.read_bytes()
    shutil.rmtree(work_dir, ignore_errors=True)
    _log(f"[转码] 完成 {len(raw)}字节 -> {len(raw_out)}字节 mp4 filters={len(filters)}")
    return 200, {
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="wallpaper.mp4"',
    }, raw_out


# ---------------- 壁纸导出（后端确定性渲染：裁剪 + 粒子 + 调色） ----------------
# 浏览器只产参数（母版/裁剪/调色/粒子配置），后端用 ffmpeg 一条 filter 链确定性渲染，
# 彻底摆脱「录制 Canvas」这条会掉帧/回绕/黑帧的路径。

_WP_SOURCES: dict = {}
_WP_SOURCE_LOCK = threading.Lock()
_WP_EXPORT_TASKS: dict = {}
_WP_EXPORT_LOCK = threading.Lock()
_WALLPAPER_MEDIA_DIR = ROOT / "server" / "media" / "wallpaper_sources"
# 四端并行导出的 ffmpeg 并发数。x264 是 CPU 编码，多开能榨满多核；按机器核数可调。
# 4K 下单个 x264 进程要吃 300~500MB（rgb24 中间帧 3840×2880×3 ≈ 33MB/帧），
# 4 路并行峰值能到 2GB 上下，16GB 机器没问题；小内存机器设 WALLPAPER_EXPORT_WORKERS=2。
_WALLPAPER_EXPORT_WORKERS = max(1, int((os.environ.get("WALLPAPER_EXPORT_WORKERS") or "2")))
# 每个 ffmpeg 的编码线程数：4 路并行时如果每路都开满核数线程，会出现 N×N 线程争抢，
# 实际吞吐反而下降，4K 下还更容易把内存顶爆。按「核数 / 并行路数」分，至少留 1。
_WALLPAPER_EXPORT_THREADS = max(1, (os.cpu_count() or 4) // _WALLPAPER_EXPORT_WORKERS)
_WP_EXPORT_SLOTS = threading.BoundedSemaphore(_WALLPAPER_EXPORT_WORKERS)
WALLPAPER_EXPORT_CRF = 16
# 4K 分辨率下 veryfast 会把码率抬得很高（细节多、压缩差），换成 slower 一档仍是纯 CPU 编码，
# 但同 CRF 下体积和块效应都明显更好；可用环境变量改回去。
WALLPAPER_EXPORT_PRESET = os.environ.get("WALLPAPER_EXPORT_PRESET") or "fast"

# H.264 level 上限表：(level, MaxFS 宏块数, MaxMBPS 宏块/秒)。
# 不显式给 -level 时，x264 的自动推导在 4K 上偶尔会给出编不过的档位；
# 而 4K60 的 3840×2160 正好卡在 5.2 的边界上，3840×2880 与 2160×4800 必须上 6.0。
_X264_LEVELS = (
    ("4.1", 8192, 245760),
    ("4.2", 8704, 522240),
    ("5.0", 22080, 589824),
    ("5.1", 36864, 983040),
    ("5.2", 36864, 2073600),
    ("6.0", 139264, 4177920),
    ("6.1", 139264, 8355840),
    ("6.2", 139264, 16711680),
)


def x264_level(width: int, height: int, fps: int) -> str:
    """按宏块数与宏块率挑一个能容纳这段流的 H.264 level。

    3840×2160@60 → 5.2（32400 宏块 / 1.94M 宏块每秒，正好在 5.2 的 2.07M 以内）
    3840×2880@60 / 2160×4800@60 → 6.0
    """
    mb_w = math.ceil(max(1, width) / 16)
    mb_h = math.ceil(max(1, height) / 16)
    fs = mb_w * mb_h
    mbps = fs * max(1, fps)
    for level, max_fs, max_mbps in _X264_LEVELS:
        if fs <= max_fs and mbps <= max_mbps:
            return level
    return "6.2"


def handle_wallpaper_source(body, environ=None):
    """POST /api/wallpaper/source：把母版（或直接上传的图片/视频）上传一次落盘。

    之后反复导出只传 sourceId，不再重传母版字节。
    """
    if not isinstance(body, dict):
        return _json(400, {"error": "请求体必须是 JSON 对象"})
    data_url = body.get("videoDataUrl")
    if not isinstance(data_url, str) or not data_url.startswith("data:"):
        return _json(400, {"error": "缺少 videoDataUrl"})
    raw, _ct = split_data_url(data_url)
    if not raw:
        return _json(400, {"error": "无法解析数据"})
    kind = body.get("kind") or "video"
    if kind not in ("video", "image"):
        return _json(400, {"error": "kind 只能是 video 或 image"})
    ext = "mp4" if kind == "video" else "png"
    source_id = uuid.uuid4().hex[:12]
    _WALLPAPER_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    out_path = _WALLPAPER_MEDIA_DIR / f"{source_id}.{ext}"
    out_path.write_bytes(raw)
    with _WP_SOURCE_LOCK:
        _WP_SOURCES[source_id] = {"path": str(out_path), "kind": kind}
    _log(f"[壁纸源] {source_id} 已上传 {len(raw)} 字节 kind={kind}")
    return 200, {"sourceId": source_id}


def _wallpaper_export_cfg(body):
    """校验导出请求体，返回 (cfg, meta)。cfg 供 run_wallpaper_export 消费。"""
    if not isinstance(body, dict):
        raise ValueError("请求体必须是 JSON 对象")
    source_id = body.get("sourceId")
    with _WP_SOURCE_LOCK:
        src = _WP_SOURCES.get(source_id)
    if not src:
        raise ValueError("母版尚未上传，请先就位「重处理母版」再导出")
    crop = body.get("crop")
    if not isinstance(crop, dict) or not all(
        isinstance(crop.get(k), (int, float)) for k in ("sx", "sy", "sw", "sh")
    ):
        raise ValueError("crop 参数不完整（需 sx/sy/sw/sh 归一化值）")
    try:
        source_w = int(body.get("sourceW") or 0)
        source_h = int(body.get("sourceH") or 0)
        out_w = int(body.get("outW") or 0)
        out_h = int(body.get("outH") or 0)
        fps = int(body.get("fps") or 60)
        duration = float(body.get("duration") or 0)
    except (TypeError, ValueError):
        raise ValueError("尺寸 / 帧率 / 时长参数不合法")
    if source_w <= 0 or source_h <= 0 or out_w <= 0 or out_h <= 0:
        raise ValueError("sourceW/sourceH/outW/outH 参数不完整")
    # 四端现在按 4K 出（3840×2160 / 2160×4800 / 3840×2400 / 3840×2880）。
    # 上限留到 8K，防止请求体把显存和内存顶爆。
    if out_w > 8192 or out_h > 8192:
        raise ValueError("导出尺寸超出上限（长边最大 8192）")
    if not (1 <= fps <= 120):
        raise ValueError("fps 需在 [1, 120] 内")
    if duration <= 0:
        raise ValueError("duration 需为正数")
    platform = body.get("platform") or "custom"
    return {
        "source_path": src["path"],
        "kind": src["kind"],
        "source_w": source_w,
        "source_h": source_h,
        "out_w": out_w,
        "out_h": out_h,
        "fps": fps,
        "duration": duration,
        "crop": crop,
        "lut": body.get("lut") or "",
        "grade": body.get("grade") or {},
        "particles": body.get("particles") or {},
    }, {"platform": platform}


def _ffmpeg_error_tail(log_path, limit=3, max_chars=600) -> str:
    """从 ffmpeg 的 stderr 日志里捞出最有意义的一行。

    ffmpeg 的报错有两种形态：启动即失败（真正原因在开头，例如 "Unknown encoder"、
    "Error setting option level"、"frame MB size > level limit"），以及编码中途失败
    （原因在结尾，例如 "Conversion failed!"、"No space left on device"）。
    所以取「首个关键词行 + 末尾关键词行」，两头都别丢。
    """
    try:
        text = Path(log_path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return ""
    keywords = ("Error", "error", "Unable", "Invalid", "invalid", "failed", "Failed",
                "not found", "No such", "Unknown", "Conversion failed",
                "limit", "exceed", "too ", "Cannot", "cannot", "Unsupported",
                "Permission denied", "No space")
    picked = [i for i, line in enumerate(lines) if any(k in line for k in keywords)]
    if not picked:
        return " | ".join(lines[-limit:])[:max_chars]
    # 头尾各取几条：启动期报错在头，编码尾期报错在尾。
    chosen = picked if len(picked) <= limit else (picked[:1] + picked[-(limit - 1):])
    message = " | ".join(lines[i] for i in chosen)
    return message[:max_chars]


def run_wallpaper_export(cfg, on_progress=None, on_spawn=None):
    """渲染一个平台的成片（同步阻塞）。on_progress(pct0_100, note)；on_spawn(proc)。

    只做「裁剪 + 缩放 + 调色」，不再叠加粒子。进度来自 ffmpeg 的 `-progress pipe:1`
    输出（按已编码帧数 / 总帧数）。
    """
    work_dir = Path(cfg["work_dir"])
    out_path = Path(cfg["out_path"])
    source_path = cfg["source_path"]
    kind = cfg["kind"]
    out_w = cfg["out_w"]
    out_h = cfg["out_h"]
    fps = cfg["fps"]
    duration = cfg["duration"]
    crop = cfg["crop"]
    source_w = cfg["source_w"]
    source_h = cfg["source_h"]
    lut = cfg.get("lut") or ""
    grade = cfg.get("grade") or {}

    total_frames = max(1, int(round(duration * fps)))

    # 裁剪：归一化 → 源像素，偶数对齐（x264 yuv420p 要求偶数宽高）。
    cw = max(2, int(round(source_w * crop["sw"])) & ~1)
    ch = max(2, int(round(source_h * crop["sh"])) & ~1)
    cx = max(0, min(source_w - cw, int(round(source_w * crop["sx"]))))
    cy = max(0, min(source_h - ch, int(round(source_h * crop["sy"]))))

    grade_chain = build_grade_filters(grade)
    if lut:
        (work_dir / "grade.cube").write_text(lut, encoding="utf-8")
        grade_chain.insert(0, "lut3d=file=grade.cube:interp=tetrahedral")
    # 调色走 rgb24（贴近前端 applyGrading 的 RGBA 空间），再转 yuv420p 编码。
    grade_str = "," + ",".join(grade_chain) if grade_chain else ""
    # flags=lanczos：4K 下四端基本都是从小到大重采样（竖屏手机更明显），
    # 默认 bicubic 会把线条糊掉，lanczos 保留更多边缘锐度，代价可以忽略。
    filter_str = (f"crop={cw}:{ch}:{cx}:{cy},"
                  f"scale={out_w}:{out_h}:flags=lanczos,"
                  f"format=rgb24{grade_str},format=yuv420p")

    cmd = ["ffmpeg", "-y"]
    if kind == "image":
        cmd += ["-loop", "1", "-framerate", f"{fps:g}", "-i", str(source_path)]
    else:
        cmd += ["-i", str(source_path)]
    cmd += [
        "-vf", filter_str,
        "-c:v", "libx264", "-crf", f"{WALLPAPER_EXPORT_CRF:g}", "-preset", WALLPAPER_EXPORT_PRESET,
        # 显式 level：4K60 的 3840×2160 卡在 5.2 边界，更高的画幅必须上 6.0，自动推导不可靠。
        "-level", x264_level(out_w, out_h, fps),
        # 线程数封顶：多路并行时每路都开满核数会互相争抢，吞吐反而更差。
        "-threads", str(_WALLPAPER_EXPORT_THREADS),
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        "-fps_mode", "cfr", "-r", f"{fps:g}",
        "-frames:v", str(total_frames),
        "-an", "-nostats", "-progress", "pipe:1",
        str(out_path),
    ]

    last_exc = None
    for attempt in range(1, FFMPEG_MAX_ATTEMPTS + 1):
        # stderr 必须落盘：之前接 DEVNULL，ffmpeg 一失败就只剩一个没意义的退出码，
        # 完全看不出是 level 不合法、LUT 读不了还是内存不够。
        err_log = work_dir / f"ffmpeg-{attempt}.log"
        err_file = open(err_log, "wb")
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                stderr=err_file, cwd=str(work_dir))
        if on_spawn:
            on_spawn(proc)
        try:
            for line in proc.stdout:
                text = line.decode("utf-8", "replace").strip()
                if not text.startswith("frame="):
                    continue
                try:
                    frame = int(text.split("=", 1)[1])
                except ValueError:
                    continue
                if on_progress:
                    on_progress(min(100.0, frame / total_frames * 100.0), f"帧 {frame}/{total_frames}")
        except BrokenPipeError:
            pass  # ffmpeg 已提前退出，交给下面的 returncode 判断
        code = proc.wait()
        err_file.close()
        if code == 0 and out_path.is_file() and out_path.stat().st_size > 0:
            break
        detail = _ffmpeg_error_tail(err_log)
        # Windows 上被杀掉的进程（例如内存不足、被安全软件掐断）退出码是无符号 DWORD，
        # 光看 3752568763 这种数字毫无意义，所以同时给出十六进制，并带上 ffmpeg 自己的原话。
        hex_text = f" / 0x{code & 0xFFFFFFFF:08X}"
        last_exc = RuntimeError(f"ffmpeg 渲染失败（退出码 {code}{hex_text}）"
                                + (f"：{detail}" if detail else ""))
        # 日记里也记一条完整的命令行，方便手工复跑同一段编码。
        _log("[壁纸导出] 失败命令: " + " ".join(cmd))
        if attempt < FFMPEG_MAX_ATTEMPTS:
            _log(f"[壁纸导出] 第 {attempt} 次失败，{FFMPEG_RETRY_DELAY:.1f}s 后重试: {last_exc}")
            time.sleep(FFMPEG_RETRY_DELAY)
            if out_path.is_file():
                try:
                    out_path.unlink()
                except OSError:
                    pass
    else:
        raise last_exc
    return str(out_path)


def handle_wallpaper_export(body, environ=None):
    """POST /api/wallpaper/export：单端导出，同步返回 mp4 字节。"""
    try:
        cfg, meta = _wallpaper_export_cfg(body)
    except ValueError as exc:
        return _json(400, {"error": str(exc)})
    work_dir = Path(tempfile.gettempdir()) / f"wallpaper_export_{uuid.uuid4().hex[:12]}"
    work_dir.mkdir(parents=True, exist_ok=True)
    out_path = work_dir / "out.mp4"
    cfg["work_dir"] = str(work_dir)
    cfg["out_path"] = str(out_path)
    bar = _progress.ConsoleProgress(f"壁纸导出:{meta['platform']}", total=100)
    try:
        run_wallpaper_export(cfg, on_progress=bar.update)
    except Exception as exc:  # noqa: BLE001
        _log(f"[壁纸导出] 失败: {exc}")
        shutil.rmtree(work_dir, ignore_errors=True)
        return _json(500, {"error": f"导出失败：{exc}"})
    bar.done()
    raw_out = out_path.read_bytes()
    shutil.rmtree(work_dir, ignore_errors=True)
    return 200, {
        "Content-Type": "video/mp4",
        "Content-Disposition": f'attachment; filename="wallpaper-{meta["platform"]}-60fps.mp4"',
    }, raw_out


def _run_wallpaper_export_all(task_id, cfgs, zip_path, store):
    """四端导出执行体：asyncio.gather 并行跑 4 个 ffmpeg 渲染，全部完成后打包 zip。

    cfgs 是 [(cfg, meta), ...]，每个 cfg 已带 work_dir/out_path/zip_name/platform。
    """
    n = len(cfgs)
    per = [0.0] * n
    lock = _WP_EXPORT_LOCK

    def make_cb(idx):
        def cb(pct, note):
            per[idx] = pct
            with lock:
                task = store.get(task_id)
                if task is not None:
                    task["progress"] = sum(per) / n
        return cb

    cbs = [make_cb(i) for i in range(n)]

    async def run_all():
        async def one(cfg, idx):
            def runner():
                with _WP_EXPORT_SLOTS:
                    run_wallpaper_export(
                        cfg,
                        on_progress=cbs[idx],
                        on_spawn=lambda p: _register_wp_proc(store, lock, task_id, p),
                    )
            return await asyncio.to_thread(runner)
        results = await asyncio.gather(*(one(cfg, i) for i, cfg in enumerate(cfgs)),
                                       return_exceptions=True)
        failed = [i for i, r in enumerate(results) if isinstance(r, BaseException)]
        # 并行失败 → 逐个串行重试。4 路 4K x264 同时跑时，内存与 CPU 争抢会让 ffmpeg
        # 被系统强杀（退出码是无符号 DWORD），而同一份母版单独跑是稳的。
        # 串行重试慢一些，但比整包失败好得多。
        if failed:
            _log(f"[壁纸导出] {task_id} 并行失败 {len(failed)} 端，改为串行重试："
                 f"{[cfgs[i]['platform'] for i in failed]}")
            for i in failed:
                cfg = cfgs[i]
                try:
                    await asyncio.to_thread(
                        run_wallpaper_export,
                        cfg,
                        on_progress=cbs[i],
                        on_spawn=lambda p: _register_wp_proc(store, lock, task_id, p),
                    )
                except BaseException as exc:  # noqa: BLE001
                    raise RuntimeError(
                        f"平台 {cfg['platform']} 导出失败（并行与串行重试均失败）：{exc}"
                    ) from exc

    try:
        asyncio.run(run_all())
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for cfg in cfgs:
                zf.write(cfg["out_path"], cfg["zip_name"])
        with lock:
            task = store.get(task_id)
            if task is not None:
                task["status"] = "done"
                task["progress"] = 100.0
        _log(f"[壁纸导出] {task_id} 完成 zip={len(cfgs)} 端")
    except Exception as exc:  # noqa: BLE001
        with lock:
            task = store.get(task_id)
            if task is not None and task.get("status") != "cancelled":
                task["status"] = "error"
                task["error"] = str(exc)
        _log(f"[壁纸导出] {task_id} 失败: {exc}")
    finally:
        with lock:
            store.get(task_id, {}).pop("proc", None)


def _register_wp_proc(store, lock, task_id, proc):
    with lock:
        task = store.get(task_id)
        if task is not None:
            task["proc"] = proc


def handle_wallpaper_export_all(body, environ=None):
    """POST /api/wallpaper/export-all：四端并行导出，异步任务，结果打包 zip。"""
    platforms = body.get("platforms") if isinstance(body, dict) else None
    if not isinstance(platforms, list) or not platforms:
        return _json(400, {"error": "缺少 platforms"})
    cfgs = []
    try:
        for p in platforms:
            cfg, meta = _wallpaper_export_cfg(p)
            cfg["platform"] = meta["platform"]
            cfg["zip_name"] = f"wallpaper-{meta['platform']}-60fps.mp4"
            cfgs.append(cfg)
    except ValueError as exc:
        return _json(400, {"error": str(exc)})

    store = _WP_EXPORT_TASKS
    task_id = uuid.uuid4().hex[:12]
    work_dir = Path(tempfile.gettempdir()) / f"wallpaper_export_all_{task_id}"
    work_dir.mkdir(parents=True, exist_ok=True)
    zip_path = work_dir / "wallpaper-60fps.zip"
    for idx, cfg in enumerate(cfgs):
        cfg["work_dir"] = str(work_dir / f"p{idx}")
        Path(cfg["work_dir"]).mkdir(parents=True, exist_ok=True)
        cfg["out_path"] = str(Path(cfg["work_dir"]) / "out.mp4")
    with _WP_EXPORT_LOCK:
        store[task_id] = {"status": "running", "error": None, "progress": 0.0,
                          "result_path": str(zip_path), "proc": None}
    thread = threading.Thread(target=_run_wallpaper_export_all, args=(task_id, cfgs, zip_path, store), daemon=True)
    thread.start()
    _log(f"[壁纸导出] 四端任务启动 taskId={task_id} 平台={[c['platform'] for c in cfgs]}")
    return 200, {"taskId": task_id}


def handle_wallpaper_export_all_status(path, task_store=None):
    store = task_store if task_store is not None else _WP_EXPORT_TASKS
    task = store.get(_query_param(path, "taskId"))
    if not task:
        return _json(404, {"error": "任务不存在"})
    return 200, {"status": task["status"], "progress": task.get("progress", 0.0), "error": task.get("error")}


def handle_wallpaper_export_all_result(path, task_store=None):
    store = task_store if task_store is not None else _WP_EXPORT_TASKS
    task = store.get(_query_param(path, "taskId"))
    if not task:
        return 404, {"Content-Type": "text/plain; charset=utf-8"}, b"task not found"
    if task["status"] != "done":
        return 409, {"Content-Type": "text/plain; charset=utf-8"}, b"not ready"
    result = Path(task["result_path"])
    if not result.is_file():
        return 404, {"Content-Type": "text/plain; charset=utf-8"}, b"result missing"
    return 200, {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="wallpaper-60fps.zip"',
    }, result.read_bytes()


def handle_wallpaper_export_all_cancel(path, task_store=None):
    store = task_store if task_store is not None else _WP_EXPORT_TASKS
    task_id = _query_param(path, "taskId")
    task = store.get(task_id)
    if not task:
        return _json(404, {"error": "任务不存在"})
    with _WP_EXPORT_LOCK:
        if task["status"] in ("done", "error", "cancelled"):
            return 200, {"status": task["status"]}
        task["status"] = "cancelled"
        proc = task.get("proc")
    if proc is not None:
        _terminate_tree(proc)
    _log(f"[壁纸导出] {task_id} 已取消")
    return 200, {"status": "cancelled"}


# ---------------- 任务队列：执行器 + 接口 ----------------
# 两个池：main（动态壁纸以外）与 wallpaper（动态壁纸）。每个池一条 worker 线程，
# 队列上限 64（见 server/tasks.py）。执行方在服务端，浏览器刷新/关页不影响任务。

_TASK_MANAGER = None


def _max_refs_for(model: str) -> int:
    spec = QWEN_MODELS.get(model)
    if spec is not None:
        return int(spec["max_refs"])
    return GEMINI_MAX_REFS


def _resolve_step_refs(step, named, results, limit):
    """把 step.ref 里的记号解析成参考图 dataUrl 列表。

    "turnaround" -> payload.refs["turnaround"]
    "#3"         -> 第 3 个 step 刚生成的那张图

    引用的上游没出图时返回 None：这一步不该硬跑（拿不到参考图就等于无参考出图）。
    """
    out = []
    for token in step.get("ref") or []:
        if not isinstance(token, str):
            continue
        if token.startswith("#"):
            try:
                index = int(token[1:])
            except ValueError:
                continue
            entry = results.get(index)
            if not entry or not entry.get("dataUrl"):
                return None
            out.append(entry["dataUrl"])
        else:
            value = named.get(token)
            if value:
                out.append(value)
    return out[:limit] if limit > 0 else out


def _run_image_task(task, report, *, environ=None, urlopen=None, db_path=None):
    """池 A：按 step 计划逐张出图（每张一次 handle_generate，天然串行）。

    单张失败不掐断整批（微调与设定集本来就是单张容错），最后按成功/失败数收成
    done / partial / failed。
    """
    payload = report.payload()
    steps = payload.get("steps") or []
    named = payload.get("refs") or {}
    env = environ if environ is not None else os.environ
    mock = env.get("GENERATE_MOCK") == "1"
    # 每次都要重新取一遍 key：环境变量可能在长时间运行中被改。
    results = {}
    for index, step in enumerate(steps):
        if report.cancelled():
            raise task_queue.TaskCancelled()
        body = dict(step.get("body") or {})
        model = body.get("model") or DEFAULT_IMAGE_MODEL
        refs = _resolve_step_refs(step, named, results, _max_refs_for(model))
        if refs is None:
            report.step(index, status="skipped", message="上游未出图，已跳过")
            continue
        body["referenceImages"] = refs
        if step.get("kind"):
            body.setdefault("kind", step["kind"])
        report.step(index, status="running")
        report.message(f"{step.get('title') or body.get('kind') or '生成'}…")
        try:
            status, data = handle_generate(
                body,
                api_key=env.get("DASHSCOPE_API_KEY") or "",
                mock=mock,
                urlopen=urlopen,
                environ=env,
                db_path=db_path,
            )
        except Exception as exc:  # noqa: BLE001
            report.step(index, status="failed", error=_public_error(exc, ""))
            continue
        if status != 200:
            report.step(index, status="failed", error=(data or {}).get("error") or "生成失败")
            continue
        data_url = (data or {}).get("dataUrl") or ""
        results[index] = {
            "dataUrl": data_url,
            "url": (data or {}).get("url"),
            "id": (data or {}).get("id"),
        }
        raw, _content_type = split_data_url(data_url)
        if raw:
            report.write_result(index, raw, "png")
        report.step(
            index,
            status="done",
            url=(data or {}).get("url"),
            record_id=(data or {}).get("id"),
        )


def _blob_to_data_url(raw: bytes) -> str:
    return "data:video/mp4;base64," + base64.b64encode(raw).decode("ascii")


def _await_internal_task(created, store, label, report, cancel_fn=None):
    """等一个既有的后台子任务（视频/补帧/超分）跑完，返回产物字节。

    这些子任务本身已经在服务端跑，这里只是同步等它，顺带把取消信号传下去。
    """
    status, data = created
    if status != 200:
        raise RuntimeError((data or {}).get("error") or f"{label}启动失败")
    sub_id = (data or {}).get("taskId")
    if not sub_id:
        raise RuntimeError(f"{label}没有返回 taskId")
    if cancel_fn:
        report.on_cancel(lambda: cancel_fn(sub_id))
    while True:
        if report.cancelled():
            if cancel_fn:
                try:
                    cancel_fn(sub_id)
                except Exception:  # noqa: BLE001
                    pass
            raise task_queue.TaskCancelled()
        entry = store.get(sub_id) or {}
        sub_status = entry.get("status")
        if sub_status == "done":
            report.set_fraction(100.0)
            return Path(entry["result_path"]).read_bytes()
        if sub_status in ("error", "cancelled"):
            raise RuntimeError(entry.get("error") or f"{label}失败")
        report.message(f"{label}处理中…")
        time.sleep(1.0)


def _cancel_video_task(task_id):
    handle_video_cancel(f"/api/video-gen/cancel?taskId={task_id}")


def _cancel_interp_task(task_id):
    handle_interpolate_cancel(f"/api/interpolate/cancel?taskId={task_id}")


def _cancel_upscale_task(task_id):
    handle_upscale_cancel(f"/api/upscale/cancel?taskId={task_id}")


def _run_wallpaper_batch_task(task, report, *, environ=None, urlopen=None):
    """池 B：每张立绘跑完整条链：万相待机循环 → 色彩锁定 → 补帧 60FPS → 4K 超分。"""
    payload = report.payload()
    # 前端把每张图的参数放在 steps 里（units 是旧字段别名），两个都认。
    units = payload.get("units") or payload.get("steps") or []
    if not units:
        raise RuntimeError("没有可处理的图片（steps/units 为空）")
    env = environ if environ is not None else os.environ
    for index, unit in enumerate(units):
        if report.cancelled():
            raise task_queue.TaskCancelled()
        report.step(index, status="running")
        report.message("万相待机循环原片…")
        report.set_fraction(5.0)
        created = handle_video_gen(
            {
                "imageDataUrl": unit.get("imageDataUrl"),
                "model": unit.get("model") or DEFAULT_VIDEO_MODEL,
                "duration": unit.get("duration") or DEFAULT_VIDEO_DURATION,
                "prompt": unit.get("prompt") or "",
                "negativePrompt": unit.get("negativePrompt") or "",
                "resolution": unit.get("resolution") or DEFAULT_VIDEO_RESOLUTION,
                "ratio": unit.get("ratio") or DEFAULT_VIDEO_RATIO,
            },
            environ=env,
            urlopen=urlopen,
        )
        raw = _await_internal_task(
            created, _VIDEO_TASKS, "万相生成", report, cancel_fn=_cancel_video_task,
        )
        report.set_fraction(45.0)

        report.message("色彩锁定…")
        raw = lock_video_colors(raw, environ=env, log=_log)
        report.set_fraction(55.0)

        report.message("补帧 60FPS…")
        raw = _await_internal_task(
            handle_interpolate(
                {"videoDataUrl": _blob_to_data_url(raw),
                 "targetFps": unit.get("targetFps") or 60},
                environ=env,
            ),
            _INTERP_TASKS, "补帧", report, cancel_fn=_cancel_interp_task,
        )
        report.set_fraction(85.0)

        report.message("4K 超分…")
        raw = _await_internal_task(
            handle_upscale(
                {"videoDataUrl": _blob_to_data_url(raw),
                 "model": unit.get("upscaleModel") or "animevideov3",
                 "scale": unit.get("upscaleScale") or 3},
                environ=env,
            ),
            _UPSCALE_TASKS, "超分", report, cancel_fn=_cancel_upscale_task,
        )
        report.set_fraction(100.0)
        report.write_result(index, raw, "mp4")
        report.step(index, status="done")


def _run_wallpaper_export_task(task, report, *, environ=None):
    """池 B：四端（或单端）导出并落产物；四端额外打包 zip。"""
    payload = report.payload()
    env = environ if environ is not None else os.environ
    source_data_url = payload.get("sourceDataUrl")
    if not isinstance(source_data_url, str) or not source_data_url.startswith("data:"):
        raise RuntimeError("缺少母版数据")
    status, data = handle_wallpaper_source(
        {"videoDataUrl": source_data_url, "kind": payload.get("sourceKind") or "video"},
        environ=env,
    )
    if status != 200:
        raise RuntimeError((data or {}).get("error") or "母版上传失败")
    source_id = data["sourceId"]

    cfgs = []
    for entry in payload.get("platforms") or []:
        body = dict(entry)
        body["sourceId"] = source_id
        cfg, meta = _wallpaper_export_cfg(body)
        cfg["platform"] = meta["platform"]
        cfg["zip_name"] = f"wallpaper-{meta['platform']}-60fps.mp4"
        cfgs.append(cfg)
    if not cfgs:
        raise RuntimeError("没有要导出的平台")

    work_dir = Path(task["_dir"]) / "export"
    work_dir.mkdir(parents=True, exist_ok=True)
    for idx, cfg in enumerate(cfgs):
        out_dir = work_dir / f"p{idx}"
        out_dir.mkdir(parents=True, exist_ok=True)
        cfg["work_dir"] = str(out_dir)
        cfg["out_path"] = str(out_dir / "out.mp4")

    n = len(cfgs)
    per = [0.0] * n
    for index in range(n):
        report.step(index, status="running", title=cfgs[index]["zip_name"])

    def callback(idx):
        def cb(pct, note=""):
            per[idx] = float(pct or 0.0)
            report.set_fraction(sum(per) / n)
            if note:
                report.message(note)
        return cb

    def one(cfg, idx):
        with _WP_EXPORT_SLOTS:
            run_wallpaper_export(
                cfg,
                on_progress=callback(idx),
                on_spawn=lambda proc: report.on_cancel(lambda: _terminate_tree(proc)),
            )

    async def run_all():
        async def runner(cfg, idx):
            return await asyncio.to_thread(one, cfg, idx)
        results = await asyncio.gather(
            *(runner(cfg, idx) for idx, cfg in enumerate(cfgs)),
            return_exceptions=True,
        )
        failed = [i for i, value in enumerate(results) if isinstance(value, BaseException)]
        # 4 路 4K 并行偶尔会被系统强杀（内存/CPU 争抢），失败的逐个串行重试。
        for idx in failed:
            if report.cancelled():
                raise task_queue.TaskCancelled()
            _log(f"[任务] {task['id']} 第 {idx + 1} 端并行失败，改串行重试：{results[idx]}")
            await asyncio.to_thread(one, cfgs[idx], idx)

    try:
        asyncio.run(run_all())
    except task_queue.TaskCancelled:
        raise
    except Exception as exc:  # noqa: BLE001
        if report.cancelled():
            raise task_queue.TaskCancelled() from exc
        raise

    for index in range(n):
        out_path = Path(cfgs[index]["out_path"])
        if out_path.is_file():
            report.write_result(index, out_path.read_bytes(), "mp4")
            report.step(index, status="done")
        else:
            report.step(index, status="failed", error="导出产物缺失")

    if n > 1:
        zip_path = work_dir / "wallpaper-60fps.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for cfg in cfgs:
                if Path(cfg["out_path"]).is_file():
                    zf.write(cfg["out_path"], cfg["zip_name"])
        report.write_result(n, zip_path.read_bytes(), "zip")


def create_task_manager(*, environ=None, urlopen=None, db_path=None,
                        storage_dir=None, auto_start=True):
    """建一个任务管理器并把两类执行器挂上（测试里可以传自己的 environ/db）。"""
    manager = task_queue.TaskManager(
        db_path=db_path,
        storage_dir=storage_dir,
        log=_log,
        auto_start=False,
    )
    env = environ if environ is not None else os.environ
    manager.register(
        task_queue.TASK_IMAGE,
        lambda task, report: _run_image_task(
            task, report, environ=env, urlopen=urlopen, db_path=db_path,
        ),
    )
    manager.register(
        task_queue.TASK_WALLPAPER_BATCH,
        lambda task, report: _run_wallpaper_batch_task(
            task, report, environ=env, urlopen=urlopen,
        ),
    )
    manager.register(
        task_queue.TASK_WALLPAPER_EXPORT,
        lambda task, report: _run_wallpaper_export_task(task, report, environ=env),
    )
    if auto_start:
        manager.start()
    return manager


def task_manager():
    global _TASK_MANAGER
    if _TASK_MANAGER is None:
        _TASK_MANAGER = create_task_manager()
        _TASK_MANAGER.recover_interrupted()
    return _TASK_MANAGER


def _task_path_parts(path):
    """/api/tasks/<id>/cancel -> ("<id>", "cancel")"""
    rest = (path or "").split("?", 1)[0]
    prefix = "/api/tasks/"
    if not rest.startswith(prefix):
        return None, None
    parts = [part for part in rest[len(prefix):].split("/") if part]
    task_id = parts[0] if parts else ""
    action = parts[1] if len(parts) > 1 else ""
    return task_id, action


def handle_task_submit(body, manager=None):
    if not isinstance(body, dict):
        return _json(400, {"error": "请求体必须是 JSON 对象"})
    kind = body.get("kind")
    if kind not in (task_queue.TASK_IMAGE, task_queue.TASK_WALLPAPER_BATCH,
                    task_queue.TASK_WALLPAPER_EXPORT):
        return _json(400, {"error": f"不支持的任务类型：{kind}"})
    pool = body.get("pool") or task_queue.POOL_MAIN
    if pool not in task_queue.POOLS:
        return _json(400, {"error": f"未知的池：{pool}"})
    payload = {
        key: body.get(key)
        for key in ("steps", "units", "refs", "platforms", "sourceDataUrl", "sourceKind")
        if body.get(key) is not None
    }
    steps = body.get("steps") or body.get("units") or []
    meta = [
        {
            "kind": entry.get("kind") or kind,
            "title": entry.get("title") or entry.get("name") or f"第 {i + 1} 项",
        }
        for i, entry in enumerate(steps)
    ]
    store = manager or task_manager()
    try:
        task = store.submit(
            kind,
            payload,
            pool=pool,
            title=body.get("title") or kind,
            unit=body.get("unit") or "项",
            total=body.get("total"),
            steps=meta,
        )
    except task_queue.TaskQueueFull as exc:
        _log(f"[任务] 提交被拒：{exc}")
        return _json(503, {"error": str(exc), "pool": exc.pool, "limit": exc.limit})
    except ValueError as exc:
        return _json(400, {"error": str(exc)})
    _log(f"[任务] 已接收 {task['id']} pool={pool} | {task['title']}")
    return _json(200, {"task": task})


def handle_task_list(path, manager=None):
    store = manager or task_manager()
    limit = 200
    pool = None
    query = (path or "").split("?", 1)[1] if "?" in (path or "") else ""
    params = parse_qs(query) if query else {}
    if params.get("limit"):
        try:
            limit = max(1, min(500, int(params["limit"][0])))
        except ValueError:
            limit = 200
    if params.get("pool"):
        candidate = params["pool"][0]
        if candidate in task_queue.POOLS:
            pool = candidate
    return _json(200, {"tasks": store.list_tasks(pool=pool, limit=limit)})


def handle_task_detail(path, manager=None):
    store = manager or task_manager()
    task_id, _action = _task_path_parts(path)
    task = store.get(task_id) if task_id else None
    if not task:
        return _json(404, {"error": "任务不存在"})
    return _json(200, {"task": task})


def handle_task_payload(path, manager=None):
    """提交时的原始载荷：前端刷新后重试失败项需要重新拼 step 计划。"""
    store = manager or task_manager()
    task_id, _action = _task_path_parts(path)
    if not task_id:
        return _json(400, {"error": "缺少任务 id"})
    payload = store.payload_of(task_id)
    if payload is None:
        return _json(404, {"error": "任务载荷不存在"})
    return _json(200, {"payload": payload})


def handle_task_cancel(path, manager=None):
    store = manager or task_manager()
    task_id, _action = _task_path_parts(path)
    task = store.cancel(task_id) if task_id else None
    if not task:
        return _json(404, {"error": "任务不存在"})
    return _json(200, {"task": task})


def handle_task_delete(path, manager=None):
    store = manager or task_manager()
    task_id, _action = _task_path_parts(path)
    if not task_id:
        return _json(400, {"error": "缺少任务 id"})
    try:
        store.delete(task_id)
    except RuntimeError as exc:
        return _json(409, {"error": str(exc)})
    return _json(200, {"deleted": task_id})


def handle_task_result(path, manager=None):
    store = manager or task_manager()
    rest = (path or "").split("?", 1)[0]
    prefix = "/api/tasks/"
    parts = [part for part in rest[len(prefix):].split("/") if part] if rest.startswith(prefix) else []
    if len(parts) < 3 or parts[1] != "result":
        return 400, {"Content-Type": "text/plain; charset=utf-8"}, b"bad request"
    try:
        index = int(parts[2])
    except ValueError:
        return 400, {"Content-Type": "text/plain; charset=utf-8"}, b"bad index"
    file_path, ext = store.result_file(parts[0], index)
    if not file_path:
        return 404, {"Content-Type": "text/plain; charset=utf-8"}, b"result missing"
    mime = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    return 200, {"Content-Type": mime}, Path(file_path).read_bytes()


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
        _log(f"[接口] POST {route} -> {status}")
        return _json(status, data)
    if method == "POST" and route == "/api/translate-color":
        status, data = handle_translate(
            body or {},
            api_key=environ.get("DASHSCOPE_API_KEY") or "",
            mock=environ.get("TRANSLATE_MOCK") == "1",
            urlopen=urlopen,
        )
        _log(f"[接口] POST {route} -> {status}")
        return _json(status, data)
    if method == "GET" and route == "/api/chibi-style":
        data = chibi_style_images()
        _log(f"[接口] GET {route} -> 200（{len(data['images'])} 张风格图）")
        return _json(200, data)
    if method == "GET" and route == "/api/gallery":
        status, data = handle_gallery()
        _log(f"[接口] GET {route} -> {status}")
        return _json(status, data)
    if method == "POST" and route == "/api/gallery/delete":
        status, data = handle_delete_images(body or {})
        _log(f"[接口] POST {route} -> {status}")
        return _json(status, data)
    if method == "GET" and route == "/api/image":
        status, headers, raw = handle_remote_image(path, urlopen=urlopen, environ=environ)
        _log(f"[接口] GET {route} -> {status}")
        return status, headers, raw
    if method == "POST" and route == "/api/upscale":
        status, data = handle_upscale(body or {}, environ=environ)
        _log(f"[接口] POST {route} -> {status}")
        return _json(status, data)
    if method == "GET" and route == "/api/upscale/status":
        status, data = handle_upscale_status(path)
        return _json(status, data)
    if method == "POST" and route == "/api/upscale/cancel":
        status, data = handle_upscale_cancel(path)
        _log(f"[接口] POST {route} -> {status}")
        return _json(status, data)
    if method == "GET" and route == "/api/upscale/result":
        return handle_upscale_result(path)
    if method == "POST" and route == "/api/video-gen":
        status, data = handle_video_gen(body or {}, environ=environ)
        _log(f"[接口] POST {route} -> {status}")
        return _json(status, data)
    if method == "GET" and route == "/api/video-gen/status":
        status, data = handle_video_status(path)
        return _json(status, data)
    if method == "POST" and route == "/api/video-gen/cancel":
        status, data = handle_video_cancel(path)
        _log(f"[接口] POST {route} -> {status}")
        return _json(status, data)
    if method == "GET" and route == "/api/video-gen/result":
        return handle_video_result(path)
    if method == "POST" and route == "/api/interpolate":
        status, data = handle_interpolate(body or {}, environ=environ)
        _log(f"[接口] POST {route} -> {status}")
        return _json(status, data)
    if method == "GET" and route == "/api/interpolate/status":
        status, data = handle_interpolate_status(path)
        return _json(status, data)
    if method == "POST" and route == "/api/interpolate/cancel":
        status, data = handle_interpolate_cancel(path)
        _log(f"[接口] POST {route} -> {status}")
        return _json(status, data)
    if method == "GET" and route == "/api/interpolate/result":
        return handle_interpolate_result(path)
    if method == "POST" and route == "/api/color-lock":
        status, headers, raw = handle_color_lock(body or {}, environ=environ)
        _log(f"[接口] POST {route} -> {status}")
        return status, headers, raw
    if method == "POST" and route == "/api/transcode":
        status, headers, raw = handle_transcode(body or {}, environ=environ)
        _log(f"[接口] POST {route} -> {status}")
        return status, headers, raw
    if method == "POST" and route == "/api/wallpaper/source":
        status, data = handle_wallpaper_source(body or {}, environ=environ)
        _log(f"[接口] POST {route} -> {status}")
        return _json(status, data)
    if method == "POST" and route == "/api/wallpaper/export":
        status, headers, raw = handle_wallpaper_export(body or {}, environ=environ)
        _log(f"[接口] POST {route} -> {status}")
        return status, headers, raw
    if method == "POST" and route == "/api/wallpaper/export-all":
        status, data = handle_wallpaper_export_all(body or {}, environ=environ)
        _log(f"[接口] POST {route} -> {status}")
        return _json(status, data)
    if method == "GET" and route == "/api/wallpaper/export-all/status":
        status, data = handle_wallpaper_export_all_status(path)
        return _json(status, data)
    if method == "GET" and route == "/api/wallpaper/export-all/result":
        return handle_wallpaper_export_all_result(path)
    if method == "POST" and route == "/api/wallpaper/export-all/cancel":
        status, data = handle_wallpaper_export_all_cancel(path)
        _log(f"[接口] POST {route} -> {status}")
        return _json(status, data)
    if route == "/api/tasks":
        if method == "POST":
            return handle_task_submit(body or {})
        if method == "GET":
            return handle_task_list(path)
        return _json(405, {"error": "不支持的方法"})
    if route.startswith("/api/tasks/"):
        task_id, action = _task_path_parts(path)
        if method == "GET" and action == "":
            return handle_task_detail(path)
        if method == "GET" and action == "result":
            return handle_task_result(path)
        if method == "GET" and action == "payload":
            return handle_task_payload(path)
        if method == "POST" and action == "cancel":
            return handle_task_cancel(path)
        if method == "DELETE" and action == "":
            return handle_task_delete(path)
        _log(f"[接口] 未知任务路由 {method} {route} -> 404")
        return _json(404, {"error": "未知任务接口"})
    if method == "GET":
        file = resolve_static(route)
        if file is None:
            # 静态资源 404 才记日志，正常页面加载不刷屏。
            _log(f"[静态] 未找到 {route} -> 404")
            return 404, {"Content-Type": "text/plain; charset=utf-8"}, "not found".encode("utf-8")
        mime = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        return 200, {"Content-Type": mime}, file.read_bytes()
    _log(f"[接口] 未知路由 {method} {route} -> 404")
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
            _log(f"[请求] POST {self.path} 失败 | 原因=请求体不是合法 JSON")
            self._send(*_json(400, {"error": "无法解析请求"}))
            return
        if not isinstance(body, dict):
            _log(f"[请求] POST {self.path} 失败 | 原因=请求体不是 JSON 对象")
            self._send(*_json(400, {"error": "无法解析请求"}))
            return
        if (self.path or "").split("?", 1)[0] == "/api/generate-stream":
            self._respond_stream(body)
            return
        self._respond("POST", body)

    def do_DELETE(self):
        self._respond("DELETE", None)

    def _respond_stream(self, body):
        jobs = body.get("jobs")
        if not isinstance(jobs, list):
            _log(f"[流式生图] 失败 | 原因=请求里没有 jobs 数组")
            self._send(*_json(400, {"error": "缺少生成任务"}))
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        # BaseHTTPRequestHandler 默认 HTTP/1.0、无 Content-Length：SSE 流结束时必须
        # 关闭连接，浏览器才能收到 EOF、让 fetch 的 reader 返回 done（否则前端永远等不到结束）。
        self.send_header("Connection", "close")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        environ = os.environ
        api_key = environ.get("DASHSCOPE_API_KEY") or ""
        mock = environ.get("GENERATE_MOCK") == "1"
        closed_early = False
        try:
            for event in generate_stream_events(jobs, api_key=api_key, mock=mock, environ=environ):
                self.wfile.write(event.encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            # 客户端收到错误帧后可能提前断开；忽略写失败，避免打印无意义的堆栈。
            closed_early = True
            _log("[流式生图] 前端提前断开连接，剩余结果不再推送")
        finally:
            self.close_connection = True
        if not closed_early:
            _log(f"[流式生图] SSE 流已正常关闭（{len(jobs)} 个任务）")

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
        # 只写请求行（方法/路径/状态码）。不要把正文、参考图或密钥打出来。
        _log(f"[HTTP] {fmt % args}")


def startup_lines(environ=None):
    """启动提示。只说明密钥在不在，不打印密钥本身。"""
    environ = os.environ if environ is None else environ
    lines = []
    if (environ.get("DASHSCOPE_API_KEY") or "").strip():
        lines.append("API Key 已获取")
    else:
        lines.append("未读取到 API Key，点击生成时会提示未配置 DASHSCOPE_API_KEY")
    settings = oss_client.oss_settings(environ)
    if oss_client.oss_enabled(settings):
        lines.append(f"OSS 已配置：{settings['bucket']}（图片将持久化到 SQLite）")
    else:
        lines.append("未配置 OSS（ACCESS_KEY_ID/ACCESS_KEY_SECRET/OSS_ENDPOINT/OSS_BUCKET），图片仅本次会话可用")
    if (environ.get("4S_API_KEY") or "").strip():
        lines.append("Gemini API Key 已获取")
    else:
        lines.append("未读取到 4S_API_KEY，选择 Gemini 时会提示未配置")
    lines.append(f"服务已启动：http://{HOST}:{PORT}/")
    return lines


def oss_connection_lines(environ=None, test_connection=None):
    """启动时探测 OSS 连通性，返回要打印的日志行（绝不抛异常）。

    这样 region / 凭证 / Bucket 是否配错一启动就能看到，不必等真正上传才报 403。
    """
    environ = os.environ if environ is None else environ
    settings = oss_client.oss_settings(environ)
    if not oss_client.oss_enabled(settings):
        return ["OSS 未配置，跳过连通性测试"]
    probe = test_connection or oss_client.test_connection
    try:
        ok, message = probe(settings)
    except Exception as exc:  # 探测本身出错也不能阻断启动。
        return [f"OSS 连通性测试异常：{_redact_for_log(exc, environ)}"]
    if ok:
        return [f"OSS 连通性测试通过：{message}"]
    return [f"OSS 连通性测试失败：{_redact_for_log(message, environ)}"]


def _configure_console():
    """Windows 控制台默认可能是 cp936，中文日志容易抛 UnicodeEncodeError 或变问号。
    这里把 stdout/stderr 切到 UTF-8，并用 replace 兜底，保证日志永远打得出来。"""
    import sys

    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            # 某些被重定向/包装过的流不支持 reconfigure，忽略即可。
            pass


def main():
    _configure_console()
    _log("=" * 64)
    _log("AI 角色工作台后端启动")
    for line in startup_lines():
        _log(line)
    _log("生图模型由生成页选择：千问走百炼，Gemini 走 4sapi.org")
    _log(f"颜色翻译模型链={' -> '.join(TRANSLATE_MODELS)}")
    _log(f"图库数据库={gallery_db.init_db()}")
    for line in oss_connection_lines():
        _log(line)
    task_manager()
    _log(f"任务队列已启动：池 main / wallpaper 各一条 worker 线程，队列上限 {task_queue.QUEUE_MAX}")
    _log("=" * 64)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        _log("服务已停止")


if __name__ == "__main__":
    main()
