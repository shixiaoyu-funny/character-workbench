import base64
import json
import unittest

from server.app import (
    HOST,
    PORT,
    build_payload,
    calc_size,
    chibi_style_images,
    dispatch,
    handle_generate,
    mock_png_data_url,
    resolve_static,
)


PNG_SIGNATURE = b"\x89PNG"


class PayloadTests(unittest.TestCase):
    def test_payload_uses_the_sync_image_model(self):
        body = {
            "prompt": "a character",
            "negativePrompt": "blurry",
            "aspectRatio": "3:4",
            "seed": 123,
            "referenceImages": ["data:image/png;base64,QQ=="],
        }
        payload = build_payload(body, "sk-test-do-not-log")
        self.assertEqual(payload["model"], "qwen-image-3.0")
        self.assertEqual(payload["parameters"]["negative_prompt"], "blurry")
        self.assertEqual(payload["parameters"]["seed"], 123)
        self.assertIs(payload["parameters"]["prompt_extend"], False)
        self.assertEqual(payload["parameters"]["n"], 1)
        self.assertEqual(payload["parameters"]["size"], "768*1024")
        content = payload["input"]["messages"][0]["content"]
        self.assertEqual(content[0], {"image": "data:image/png;base64,QQ=="})
        self.assertEqual(content[-1], {"text": "a character"})
        self.assertNotIn("sk-test-do-not-log", json.dumps(payload))

    def test_empty_references_leave_only_the_prompt(self):
        payload = build_payload(
            {"prompt": "solo", "negativePrompt": "", "aspectRatio": "1:1", "seed": 1, "referenceImages": []},
            "sk-test-do-not-log",
        )
        content = payload["input"]["messages"][0]["content"]
        self.assertEqual(content, [{"text": "solo"}])

    def test_sizes_follow_the_1k_long_edge(self):
        self.assertEqual(calc_size("1:1"), "1024*1024")
        self.assertEqual(calc_size("3:4"), "768*1024")
        self.assertEqual(calc_size("4:3"), "1024*768")
        self.assertEqual(calc_size("9:16"), "576*1024")
        self.assertEqual(calc_size("16:9"), "1024*576")
        self.assertEqual(calc_size("3:2"), "1024*683")
        for size in ("1024*1024", "768*1024", "576*1024", "1024*683"):
            width, height = (int(part) for part in size.split("*"))
            self.assertGreaterEqual(width, 512)
            self.assertGreaterEqual(height, 512)
            self.assertLessEqual(width, 2048)
            self.assertLessEqual(height, 2048)


class GenerateHandlerTests(unittest.TestCase):
    def test_mock_png_is_a_data_url(self):
        url = mock_png_data_url()
        self.assertTrue(url.startswith("data:image/png;base64,"))
        raw = base64.b64decode(url.split(",", 1)[1])
        self.assertTrue(raw.startswith(PNG_SIGNATURE))

    def test_mock_response_returns_the_png_and_the_original_seed(self):
        def explode(req, timeout=None):
            raise AssertionError("mock must not touch the network")

        status, data = handle_generate(
            {"prompt": "p", "negativePrompt": "n", "aspectRatio": "1:1", "seed": 9},
            api_key=None,
            mock=True,
            urlopen=explode,
        )
        self.assertEqual(status, 200)
        self.assertTrue(data["dataUrl"].startswith("data:image/png;base64,"))
        self.assertEqual(data["seed"], 9)

    def test_missing_key_returns_503(self):
        def explode(req, timeout=None):
            raise AssertionError("missing key must not touch the network")

        status, data = handle_generate(
            {"prompt": "p", "aspectRatio": "1:1", "seed": 1},
            api_key="",
            mock=False,
            urlopen=explode,
        )
        self.assertEqual(status, 503)
        self.assertEqual(data, {"error": "未配置 DASHSCOPE_API_KEY"})

    def test_unknown_aspect_returns_400(self):
        status, data = handle_generate(
            {"prompt": "p", "aspectRatio": "2:1", "seed": 1},
            api_key="sk-test-do-not-log",
            mock=False,
            urlopen=lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("bad aspect must not call the network")),
        )
        self.assertEqual(status, 400)
        self.assertEqual(data, {"error": "不支持的比例"})

    def test_live_call_downloads_the_image_without_putting_the_key_in_the_body(self):
        png = base64.b64decode(mock_png_data_url().split(",", 1)[1])
        seen = []

        class FakeResponse:
            def __init__(self, payload, content_type):
                self.payload = payload
                self.headers = {"Content-Type": content_type}

            def read(self):
                if isinstance(self.payload, bytes):
                    return self.payload
                return json.dumps(self.payload).encode("utf-8")

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        def urlopen(req, timeout=None):
            seen.append(req)
            url = req.full_url
            if url.endswith("/generation"):
                raw = req.data.decode("utf-8")
                self.assertNotIn("sk-test-do-not-log", raw)
                self.assertEqual(req.get_header("Authorization"), "Bearer sk-test-do-not-log")
                return FakeResponse(
                    {"output": {"choices": [{"message": {"content": [{"image": "https://example.test/a.png"}]}}]}},
                    "application/json",
                )
            self.assertEqual(url, "https://example.test/a.png")
            return FakeResponse(png, "image/png")

        status, data = handle_generate(
            {
                "prompt": "hero",
                "negativePrompt": "blurry",
                "aspectRatio": "1:1",
                "seed": 4,
                "referenceImages": [],
            },
            api_key="sk-test-do-not-log",
            mock=False,
            urlopen=urlopen,
        )
        self.assertEqual(status, 200)
        self.assertTrue(data["dataUrl"].startswith("data:image/png;base64,"))
        self.assertEqual(data["seed"], 4)
        self.assertEqual(len(seen), 2)
        self.assertTrue(seen[0].full_url.endswith("/services/aigc/multimodal-generation/generation"))


class StaticAndRouteTests(unittest.TestCase):
    def test_bind_address_is_loopback(self):
        self.assertEqual(HOST, "127.0.0.1")
        self.assertEqual(PORT, 8765)

    def test_static_allows_the_workbench_and_blocks_secrets(self):
        self.assertIsNotNone(resolve_static("/"))
        self.assertIsNotNone(resolve_static("/index.html"))
        self.assertIsNotNone(resolve_static("/src/main.js"))
        self.assertIsNotNone(resolve_static("/styles/app.css"))
        self.assertIsNotNone(resolve_static("/assets/chibi-style/.gitkeep"))
        for blocked in ("/.env", "/.git/config", "/tests/dom.test.js", "/server/app.py", "/package.json"):
            self.assertIsNone(resolve_static(blocked), blocked)

    def test_empty_chibi_directory_returns_no_images(self):
        self.assertEqual(chibi_style_images(), {"images": []})

    def test_dispatch_mock_and_chibi_do_not_listen(self):
        status, headers, raw = dispatch(
            "POST",
            "/api/generate",
            {"prompt": "p", "negativePrompt": "n", "aspectRatio": "3:4", "seed": 6, "referenceImages": []},
            {"GENERATE_MOCK": "1"},
        )
        self.assertEqual(status, 200)
        self.assertIn("application/json", headers["Content-Type"])
        data = json.loads(raw.decode("utf-8"))
        self.assertTrue(data["dataUrl"].startswith("data:image/png;base64,"))
        self.assertEqual(data["seed"], 6)

        status, headers, raw = dispatch("GET", "/api/chibi-style", None, {})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw.decode("utf-8")), {"images": []})

        status, headers, raw = dispatch("GET", "/.env", None, {})
        self.assertEqual(status, 404)

        status, headers, raw = dispatch("GET", "/index.html", None, {})
        self.assertEqual(status, 200)
        self.assertIn("角色工作台", raw.decode("utf-8"))
