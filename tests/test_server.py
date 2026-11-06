import base64
import json
import time
import unittest
from unittest import mock
from urllib.parse import quote
from pathlib import Path
from tempfile import TemporaryDirectory

from server import app as app_module
from server.app import (
    HOST,
    IMAGE_SUFFIXES,
    PORT,
    ROOT,
    STREAM_MAX_WORKERS,
    TRANSLATE_MODELS,
    TRANSLATE_SYSTEM,
    build_gemini_payload,
    build_payload,
    calc_size,
    chibi_style_images,
    dispatch,
    generate_stream_events,
    handle_delete_images,
    handle_gallery,
    handle_generate,
    handle_remote_image,
    handle_translate,
    handle_upscale,
    handle_upscale_cancel,
    handle_upscale_result,
    handle_upscale_status,
    mock_png_data_url,
    UPSCALE_MAX_WORKERS,
    mock_translate,
    oss_connection_lines,
    resolve_static,
    split_data_url,
    startup_lines,
    stream_workers,
    strip_weights,
    translate_color,
    x264_level,
    _ffmpeg_error_tail,
    _WALLPAPER_EXPORT_WORKERS,
    _WALLPAPER_EXPORT_THREADS,
    VIDEO_MODELS,
    INTERP_MAX_WORKERS,
    build_video_payload,
    handle_video_gen,
    handle_video_status,
    handle_video_result,
    handle_video_cancel,
    interpolate_script_path,
    interpolate_parallel_script_path,
    interpolate_parallel_enabled,
    interp_settings,
    handle_interpolate,
    handle_interpolate_status,
    handle_interpolate_result,
    handle_interpolate_cancel,
    handle_transcode,
    parse_cube_lut,
    build_grade_filters,
    color_lock_enabled,
    color_lock_gains,
    lock_video_colors,
    handle_color_lock,
    COLOR_LOCK_MIN_GAIN,
    COLOR_LOCK_MAX_GAIN,
)
from server.db import init_db, insert_image, list_images
from server.oss import oss_enabled, oss_settings
# 别名导入：直接叫 test_connection 会被 pytest 当成测试用例收集而报 fixture 错误。
from server.oss import test_connection as oss_test_connection


PNG_SIGNATURE = b"\x89PNG"


def parse_sse_events(frames):
    events = []
    for frame in frames:
        for line in frame.split("\n"):
            if line.startswith("data:"):
                events.append(json.loads(line[5:].strip()))
    return events


class StartupTests(unittest.TestCase):
    def test_startup_says_the_key_is_present_without_printing_it(self):
        secret = "sk-test-do-not-log"
        lines = startup_lines({"DASHSCOPE_API_KEY": secret})
        self.assertEqual(lines[0], "API Key 已获取")
        self.assertIn("OSS", lines[1])
        self.assertEqual(lines[-1], f"服务已启动：http://{HOST}:{PORT}/")
        self.assertNotIn(secret, "\n".join(lines))

    def test_startup_says_when_the_key_is_missing(self):
        lines = startup_lines({})
        self.assertIn("未读取到 API Key", lines[0])
        self.assertIn("OSS", lines[1])
        self.assertTrue(lines[-1].startswith("服务已启动："))

    def test_startup_reports_oss_when_configured(self):
        lines = startup_lines({
            "ACCESS_KEY_ID": "id",
            "ACCESS_KEY_SECRET": "secret",
            "OSS_ENDPOINT": "https://oss-cn-hangzhou.aliyuncs.com",
            "OSS_BUCKET": "my-bucket",
        })
        self.assertIn("my-bucket", lines[1])
        self.assertNotIn("secret", "\n".join(lines))
        self.assertNotIn("id", "\n".join(lines))


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

    def test_sizes_follow_the_2k_long_edge(self):
        self.assertEqual(calc_size("1:1", "2k"), "2048*2048")
        self.assertEqual(calc_size("3:4", "2k"), "1536*2048")
        self.assertEqual(calc_size("4:3", "2k"), "2048*1536")
        self.assertEqual(calc_size("9:16", "2k"), "1152*2048")
        self.assertEqual(calc_size("16:9", "2k"), "2048*1152")
        self.assertEqual(calc_size("3:2", "2k"), "2048*1365")
        for size in ("2048*2048", "1536*2048", "2048*1536", "1152*2048", "2048*1152", "2048*1365"):
            width, height = (int(part) for part in size.split("*"))
            self.assertGreaterEqual(width, 512)
            self.assertGreaterEqual(height, 512)
            self.assertLessEqual(width, 2048)
            self.assertLessEqual(height, 2048)

    def test_payload_uses_2k_when_requested(self):
        payload = build_payload(
            {"prompt": "a", "negativePrompt": "", "aspectRatio": "1:1", "seed": 1, "resolution": "2k"},
            "sk-test-do-not-log",
        )
        self.assertEqual(payload["parameters"]["size"], "2048*2048")
        payload = build_payload(
            {"prompt": "a", "negativePrompt": "", "aspectRatio": "16:9", "seed": 1, "resolution": "1k"},
            "sk-test-do-not-log",
        )
        self.assertEqual(payload["parameters"]["size"], "1024*576")

    def test_qwen_21_writes_the_negative_prompt_into_the_text(self):
        payload = build_payload(
            {
                "model": "qwen-image-2.1-turbo",
                "prompt": "a character",
                "negativePrompt": "blurry",
                "aspectRatio": "1:1",
                "seed": 1,
            },
            "sk-test-do-not-log",
        )
        self.assertEqual(payload["model"], "qwen-image-2.1-turbo")
        self.assertNotIn("negative_prompt", payload["parameters"])
        text = payload["input"]["messages"][0]["content"][-1]["text"]
        self.assertEqual(text, "a character\nAvoid: blurry")

    def test_gemini_payload_uses_the_chat_completions_shape(self):
        payload = build_gemini_payload({
            "model": "gemini-3.1-flash-image-c",
            "prompt": "a character",
            "negativePrompt": "blurry",
            "aspectRatio": "3:4",
            "resolution": "2k",
            "seed": 9,
            "referenceImages": ["data:image/png;base64,QQ=="],
        })
        self.assertEqual(payload["model"], "gemini-3.1-flash-image-c")
        self.assertIs(payload["stream"], False)
        self.assertNotIn("seed", json.dumps(payload))
        content = payload["messages"][0]["content"]
        self.assertEqual(content[0], {"type": "text", "text": "a character\nAvoid: blurry"})
        self.assertEqual(content[1]["image_url"]["url"], "data:image/png;base64,QQ==")
        config = payload["extra_body"]["google"]["image_config"]
        self.assertEqual(config["aspect_ratio"], "3:4")
        self.assertEqual(config["image_size"], "2K")
        self.assertEqual(config["generation_config"]["responseModalities"], ["IMAGE"])

    def test_gemini_payload_strips_sd_weight_syntax(self):
        # Gemini 不吃 (词:1.5) 的权重写法，脱掉括号只留词，约束才读得进去。
        self.assertEqual(strip_weights("(tail:1.5), (animal tail:1.4)"), "tail, animal tail")
        self.assertEqual(strip_weights("nested ((extra limb:1.4):1.2)"), "nested extra limb")
        self.assertEqual(strip_weights("no weights here (just text)"), "no weights here (just text)")
        payload = build_gemini_payload({
            "model": "gemini-3.1-flash-image-c",
            "prompt": "(empty hands:1.4), a character",
            "negativePrompt": "(tail:1.5), (animal tail:1.4), blurry",
            "aspectRatio": "1:1",
            "referenceImages": ["data:image/png;base64,QQ=="],
        })
        text = payload["messages"][0]["content"][0]["text"]
        self.assertEqual(text, "empty hands, a character\nAvoid: tail, animal tail, blurry")


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

    def test_unknown_model_returns_400(self):
        status, data = handle_generate(
            {"model": "nope", "prompt": "p", "aspectRatio": "1:1", "seed": 1},
            api_key="sk-test-do-not-log",
            mock=False,
            urlopen=lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("bad model must not call the network")),
        )
        self.assertEqual(status, 400)
        self.assertEqual(data, {"error": "不支持的模型"})

    def test_gemini_missing_key_does_not_use_the_dashscope_key(self):
        status, data = handle_generate(
            {"model": "gemini-3-pro-image-c", "prompt": "p", "aspectRatio": "1:1", "seed": 1},
            api_key="sk-dashscope",
            mock=False,
            environ={},
            urlopen=lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("missing gemini key must not call the network")),
        )
        self.assertEqual(status, 503)
        self.assertEqual(data, {"error": "未配置 4S_API_KEY"})

    def test_gemini_wraps_raw_base64_without_downloading(self):
        raw_b64 = mock_png_data_url().split(",", 1)[1]
        seen = []

        class FakeResponse:
            def __init__(self, payload):
                self.payload = payload
                self.headers = {}

            def read(self):
                return json.dumps(self.payload).encode("utf-8")

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        def urlopen(req, timeout=None):
            seen.append(req)
            body = json.loads(req.data.decode("utf-8"))
            self.assertEqual(req.full_url, "https://4sapi.org/v1/chat/completions")
            self.assertEqual(req.get_header("Authorization"), "Bearer sk-gemini")
            self.assertNotIn("sk-gemini", req.data.decode("utf-8"))
            self.assertNotIn("sk-dashscope-should-not-be-used", req.data.decode("utf-8"))
            self.assertEqual(body["extra_body"]["google"]["image_config"]["image_size"], "1K")
            return FakeResponse({"choices": [{"message": {"content": raw_b64}}]})

        status, data = handle_generate(
            {
                "model": "gemini-nano-banana-2.1-c",
                "prompt": "p",
                "aspectRatio": "3:4",
                "resolution": "1k",
                "seed": 4,
            },
            api_key="sk-dashscope-should-not-be-used",
            mock=False,
            environ={"4S_API_KEY": "sk-gemini"},
            urlopen=urlopen,
        )
        self.assertEqual(status, 200)
        self.assertEqual(data["dataUrl"], f"data:image/png;base64,{raw_b64}")
        self.assertEqual(len(seen), 1)

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

    def test_reference_url_is_downloaded_to_a_data_url_before_generation(self):
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
            if url == "https://oss.example.test/base.png":
                # 参考图：http URL 被下载成 data URL。
                return FakeResponse(png, "image/png")
            if url.endswith("/generation"):
                raw = req.data.decode("utf-8")
                body = json.loads(raw)
                content = body["input"]["messages"][0]["content"]
                # 参考图必须已经是 data URL，而不是原始的 http URL。
                self.assertTrue(content[0]["image"].startswith("data:image/png;base64,"))
                self.assertNotIn("https://oss.example.test", raw)
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
                "referenceImages": ["https://oss.example.test/base.png"],
            },
            api_key="sk-test-do-not-log",
            mock=False,
            urlopen=urlopen,
        )
        self.assertEqual(status, 200)
        self.assertTrue(data["dataUrl"].startswith("data:image/png;base64,"))
        self.assertEqual(len(seen), 3)

    def test_reference_url_download_failure_keeps_the_original_url(self):
        png = base64.b64decode(mock_png_data_url().split(",", 1)[1])

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
            url = req.full_url
            if url == "https://oss-unreachable.example.test/base.png":
                raise RuntimeError("download failed")
            if url.endswith("/generation"):
                raw = req.data.decode("utf-8")
                body = json.loads(raw)
                content = body["input"]["messages"][0]["content"]
                # 下载失败就原样保留 URL，不阻断生图。
                self.assertEqual(content[0]["image"], "https://oss-unreachable.example.test/base.png")
                return FakeResponse(
                    {"output": {"choices": [{"message": {"content": [{"image": "https://example.test/a.png"}]}}]}},
                    "application/json",
                )
            return FakeResponse(png, "image/png")

        status, data = handle_generate(
            {
                "prompt": "hero",
                "negativePrompt": "blurry",
                "aspectRatio": "1:1",
                "seed": 4,
                "referenceImages": ["https://oss-unreachable.example.test/base.png"],
            },
            api_key="sk-test-do-not-log",
            mock=False,
            urlopen=urlopen,
        )
        self.assertEqual(status, 200)
        self.assertTrue(data["dataUrl"].startswith("data:image/png;base64,"))


class StreamGenerationTests(unittest.TestCase):
    def test_concurrency_follows_the_remaining_job_count(self):
        # 剩余越少并行越少：1 张就 1 路，4 张以上封顶 4 路。
        self.assertEqual(stream_workers(0), 1)
        self.assertEqual(stream_workers(1), 1)
        self.assertEqual(stream_workers(2), 2)
        self.assertEqual(stream_workers(3), 3)
        self.assertEqual(stream_workers(4), 4)
        self.assertEqual(stream_workers(9), 4)
        self.assertEqual(STREAM_MAX_WORKERS, 4)

    def test_stream_yields_one_event_per_job_then_done(self):
        jobs = [
            {"prompt": "a", "aspectRatio": "1:1", "seed": 1},
            {"prompt": "b", "aspectRatio": "3:4", "seed": 2},
            {"prompt": "c", "aspectRatio": "16:9", "seed": 3},
        ]
        events = parse_sse_events(generate_stream_events(jobs, mock=True))
        self.assertEqual(events[-1], {"done": True})
        # 并发下回传顺序不保证与提交一致，但每张的 index 必须唯一且正确。
        image_events = sorted(events[:-1], key=lambda event: event["index"])
        self.assertEqual([event["index"] for event in image_events], [0, 1, 2])
        for i, event in enumerate(image_events):
            self.assertEqual(event["seed"], i + 1)
            self.assertTrue(event["dataUrl"].startswith("data:image/png;base64,"))
            self.assertIsNone(event["url"])
            self.assertIsNone(event["id"])

    def test_stream_indexes_are_stable_under_concurrency(self):
        jobs = [{"prompt": str(i), "aspectRatio": "1:1", "seed": i} for i in range(8)]
        events = parse_sse_events(generate_stream_events(jobs, mock=True))
        self.assertEqual(events[-1], {"done": True})
        image_events = events[:-1]
        self.assertEqual(len(image_events), 8)
        # 每张对应一个唯一 index，前端据此按原顺序放回批次。
        self.assertEqual(sorted(event["index"] for event in image_events), list(range(8)))

    def test_stream_emits_error_frames_without_key(self):
        jobs = [{"prompt": "a", "aspectRatio": "1:1", "seed": 1}]
        events = parse_sse_events(generate_stream_events(jobs, api_key="", mock=False))
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]["index"], 0)
        self.assertEqual(events[0]["error"], "未配置 DASHSCOPE_API_KEY")
        self.assertEqual(events[1], {"done": True})

    def test_stream_rejects_missing_jobs(self):
        self.assertEqual(parse_sse_events(generate_stream_events(None, mock=True)), [{"error": "缺少生成任务"}])
        self.assertEqual(parse_sse_events(generate_stream_events([], mock=True)), [{"error": "缺少生成任务"}])

    def test_stopping_the_client_drops_queued_jobs_and_never_sends_done(self):
        # 前端点「停止生成」= 流被关闭。此时只允许已经提交的那两张跑完，其余直接丢弃。
        started = []

        def fake_generate(job, **kwargs):
            started.append(job["prompt"])
            raw = base64.b64encode(PNG_SIGNATURE).decode("utf-8")
            return 200, {"seed": job.get("seed"), "dataUrl": f"data:image/png;base64,{raw}", "url": None, "id": None}

        jobs = [{"prompt": str(i), "aspectRatio": "1:1", "seed": i} for i in range(8)]
        with mock.patch("server.app.handle_generate", side_effect=fake_generate):
            stream = generate_stream_events(jobs, mock=True)
            first = next(stream)
            self.assertIn("data:", first)
            stream.close()  # 模拟浏览器 abort 后 HTTP 流关闭
            with self.assertRaises(StopIteration):
                next(stream)
        # 首轮按剩余量开满上限 4 路，关流后队列里剩下的必须丢弃，不会再多跑。
        self.assertLessEqual(len(started), 4, f"queued jobs should be dropped, ran {started}")


class TranslateHandlerTests(unittest.TestCase):
    def test_models_follow_the_documented_fallback_order(self):
        self.assertEqual(TRANSLATE_MODELS, ("qwen3.8-flash", "deepseek-v4.1-flash", "qwen3.7-flash"))

    def test_translate_system_prompt_targets_anime_gradients(self):
        self.assertIn("二次元", TRANSLATE_SYSTEM)
        self.assertIn("gradient from", TRANSLATE_SYSTEM)
        self.assertIn("pastel pink", TRANSLATE_SYSTEM)
        self.assertIn("deep navy blue", TRANSLATE_SYSTEM)

    def test_missing_input_returns_400(self):
        status, data = handle_translate({}, api_key="sk", mock=False)
        self.assertEqual(status, 400)
        self.assertEqual(data, {"error": "缺少颜色值"})

    def test_missing_key_returns_503(self):
        def explode(req, timeout=None):
            raise AssertionError("missing key must not touch the network")

        status, data = handle_translate({"input": "#dbfff4"}, api_key="", mock=False, urlopen=explode)
        self.assertEqual(status, 503)
        self.assertEqual(data, {"error": "未配置 DASHSCOPE_API_KEY"})

    def test_mock_returns_a_color_hex_phrase(self):
        status, data = handle_translate({"input": "#dbfff4"}, api_key=None, mock=True)
        self.assertEqual(status, 200)
        self.assertEqual(data, {"englishName": "color #dbfff4"})

    def test_translate_color_tries_models_in_order_until_one_succeeds(self):
        requested_models = []

        class FakeResponse:
            def __init__(self, payload):
                self.payload = payload

            def read(self):
                return json.dumps(self.payload).encode("utf-8")

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        def urlopen(req, timeout=None):
            payload = json.loads(req.data.decode("utf-8"))
            requested_models.append(payload["model"])
            # 前两个模型失败，第三个成功。
            if payload["model"] in ("qwen3.8-flash", "deepseek-v4.1-flash"):
                raise RuntimeError(f"{payload['model']} unavailable")
            return FakeResponse({"choices": [{"message": {"content": "pale mint green"}}]})

        name = translate_color("#dbfff4", "sk-test-do-not-log", urlopen)
        self.assertEqual(name, "pale mint green")
        self.assertEqual(requested_models, ["qwen3.8-flash", "deepseek-v4.1-flash", "qwen3.7-flash"])

    def test_dispatch_translate_mock(self):
        status, headers, raw = dispatch(
            "POST",
            "/api/translate-color",
            {"input": "#dbfff4"},
            {"TRANSLATE_MOCK": "1"},
        )
        self.assertEqual(status, 200)
        self.assertIn("application/json", headers["Content-Type"])
        data = json.loads(raw.decode("utf-8"))
        self.assertEqual(data["englishName"], "color #dbfff4")


class StaticAndRouteTests(unittest.TestCase):
    def test_bind_address_is_loopback(self):
        self.assertEqual(HOST, "127.0.0.1")
        self.assertEqual(PORT, 8765)

    def test_static_allows_the_workbench_and_blocks_secrets(self):
        self.assertIsNotNone(resolve_static("/"))
        self.assertIsNotNone(resolve_static("/index.html"))
        self.assertIsNotNone(resolve_static("/src/main.js"))
        self.assertIsNotNone(resolve_static("/styles/app.css"))
        # q_photos_reference 里的风格图也应可被静态访问；文件名不写死，用户可能增删。
        folder = ROOT / "assets" / "q_photos_reference"
        if folder.is_dir():
            for path in folder.iterdir():
                if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES:
                    self.assertIsNotNone(resolve_static(f"/assets/q_photos_reference/{path.name}"))
                    break
        for blocked in ("/.env", "/.git/config", "/tests/dom.test.js", "/server/app.py", "/package.json"):
            self.assertIsNone(resolve_static(blocked), blocked)

    def test_q_photos_reference_directory_returns_data_urls(self):
        data = chibi_style_images()
        self.assertEqual(set(data.keys()), {"images"})
        self.assertGreaterEqual(len(data["images"]), 1)
        for image in data["images"]:
            self.assertTrue(image.startswith("data:image/"))

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
        data = json.loads(raw.decode("utf-8"))
        self.assertIn("images", data)
        self.assertGreaterEqual(len(data["images"]), 1)

        status, headers, raw = dispatch("GET", "/.env", None, {})
        self.assertEqual(status, 404)

        status, headers, raw = dispatch("GET", "/index.html", None, {})
        self.assertEqual(status, 200)
        self.assertIn("角色工作台", raw.decode("utf-8"))


class OssAndGalleryTests(unittest.TestCase):
    def test_oss_settings_read_env_and_prefer_user_names(self):
        settings = oss_settings({
            "ACCESS_KEY_ID": "user-id",
            "ACCESS_KEY_SECRET": "user-secret",
            "OSS_ACCESS_KEY_ID": "oss-id",
            "OSS_ACCESS_KEY_SECRET": "oss-secret",
            "OSS_ENDPOINT": "https://oss-cn-hangzhou.aliyuncs.com",
            "OSS_BUCKET": "my-bucket",
        })
        self.assertEqual(settings["access_key_id"], "user-id")
        self.assertEqual(settings["access_key_secret"], "user-secret")
        self.assertTrue(oss_enabled(settings))

    def test_oss_settings_fall_back_to_oss_names(self):
        settings = oss_settings({
            "OSS_ACCESS_KEY_ID": "oss-id",
            "OSS_ACCESS_KEY_SECRET": "oss-secret",
            "OSS_ENDPOINT": "https://oss-cn-hangzhou.aliyuncs.com",
            "OSS_BUCKET": "b",
        })
        self.assertEqual(settings["access_key_id"], "oss-id")
        self.assertTrue(oss_enabled(settings))

    def test_oss_disabled_when_missing_parts(self):
        self.assertFalse(oss_enabled(oss_settings({})))
        self.assertFalse(oss_enabled(oss_settings({
            "ACCESS_KEY_ID": "id", "ACCESS_KEY_SECRET": "secret",
        })))

    def test_oss_connection_probe_succeeds(self):
        class FakeBucket:
            def get_bucket_info(self):
                class Info:
                    location = "oss-cn-beijing"
                return Info()

        ok, message = oss_test_connection(
            oss_settings({
                "ACCESS_KEY_ID": "id", "ACCESS_KEY_SECRET": "secret",
                "OSS_ENDPOINT": "https://oss-cn-beijing.aliyuncs.com",
                "OSS_BUCKET": "shixiaoyu-funny",
            }),
            get_bucket=lambda: FakeBucket(),
        )
        self.assertTrue(ok)
        self.assertIn("shixiaoyu-funny", message)
        self.assertIn("oss-cn-beijing", message)

    def test_oss_connection_probe_reports_the_correct_endpoint(self):
        class AccessDenied(Exception):
            def __init__(self):
                self.details = {
                    "Code": "AccessDenied",
                    "Message": "The bucket you are attempting to access must be addressed using the specified endpoint.",
                    "Endpoint": "oss-cn-beijing.aliyuncs.com",
                }

        class FakeBucket:
            def get_bucket_info(self):
                raise AccessDenied()

        ok, message = oss_test_connection(
            oss_settings({
                "ACCESS_KEY_ID": "id", "ACCESS_KEY_SECRET": "secret",
                "OSS_ENDPOINT": "https://oss-cn-hangzhou.aliyuncs.com",
                "OSS_BUCKET": "shixiaoyu-funny",
            }),
            get_bucket=lambda: FakeBucket(),
        )
        self.assertFalse(ok)
        self.assertIn("AccessDenied", message)
        self.assertIn("oss-cn-beijing.aliyuncs.com", message)

    def test_oss_connection_probe_reports_region_mismatch(self):
        class FakeBucket:
            def get_bucket_info(self):
                class Info:
                    location = "oss-cn-beijing"
                return Info()

        # endpoint 配了杭州，bucket 实际在北京：get_bucket_info 不抛错，但要主动提示。
        ok, message = oss_test_connection(
            oss_settings({
                "ACCESS_KEY_ID": "id", "ACCESS_KEY_SECRET": "secret",
                "OSS_ENDPOINT": "https://oss-cn-hangzhou.aliyuncs.com",
                "OSS_BUCKET": "shixiaoyu-funny",
            }),
            get_bucket=lambda: FakeBucket(),
        )
        self.assertFalse(ok)
        self.assertIn("oss-cn-hangzhou", message)
        self.assertIn("oss-cn-beijing", message)
        self.assertIn("https://oss-cn-beijing.aliyuncs.com", message)

    def test_oss_connection_probe_reports_missing_sdk(self):
        def no_oss2():
            raise ImportError("No module named 'oss2'")

        ok, message = oss_test_connection(
            oss_settings({
                "ACCESS_KEY_ID": "id", "ACCESS_KEY_SECRET": "secret",
                "OSS_ENDPOINT": "https://oss-cn-beijing.aliyuncs.com",
                "OSS_BUCKET": "b",
            }),
            get_bucket=no_oss2,
        )
        self.assertFalse(ok)
        self.assertIn("oss2", message)

    def test_connection_lines_skip_when_oss_disabled(self):
        lines = oss_connection_lines({}, test_connection=lambda settings: (True, "ok"))
        self.assertEqual(lines, ["OSS 未配置，跳过连通性测试"])

    def test_connection_lines_report_success_and_failure(self):
        env = {
            "ACCESS_KEY_ID": "id", "ACCESS_KEY_SECRET": "secret",
            "OSS_ENDPOINT": "https://oss-cn-beijing.aliyuncs.com",
            "OSS_BUCKET": "shixiaoyu-funny",
        }
        self.assertEqual(
            oss_connection_lines(env, test_connection=lambda settings: (True, "bucket=shixiaoyu-funny（区域 oss-cn-beijing）")),
            ["OSS 连通性测试通过：bucket=shixiaoyu-funny（区域 oss-cn-beijing）"],
        )
        self.assertEqual(
            oss_connection_lines(env, test_connection=lambda settings: (False, "AccessDenied")),
            ["OSS 连通性测试失败：AccessDenied"],
        )

    def test_split_data_url_returns_bytes_and_content_type(self):
        raw, content_type = split_data_url(mock_png_data_url())
        self.assertTrue(raw.startswith(PNG_SIGNATURE))
        self.assertEqual(content_type, "image/png")

    def test_generate_persists_to_oss_and_sqlite_when_configured(self):
        png = base64.b64decode(mock_png_data_url().split(",", 1)[1])

        class FakeResponse:
            def __init__(self, payload, content_type):
                self.payload = payload
                self.headers = {"Content-Type": content_type}

            def read(self):
                return self.payload if isinstance(self.payload, bytes) else json.dumps(self.payload).encode("utf-8")

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        def urlopen(req, timeout=None):
            if req.full_url.endswith("/generation"):
                return FakeResponse(
                    {"output": {"choices": [{"message": {"content": [{"image": "https://example.test/a.png"}]}}]}},
                    "application/json",
                )
            return FakeResponse(png, "image/png")

        uploaded = []
        env = {
            "ACCESS_KEY_ID": "id",
            "ACCESS_KEY_SECRET": "secret",
            "OSS_ENDPOINT": "https://oss-cn-hangzhou.aliyuncs.com",
            "OSS_BUCKET": "my-bucket",
        }
        with TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "gallery.db"
            status, data = handle_generate(
                {
                    "prompt": "hero", "negativePrompt": "blurry", "aspectRatio": "1:1",
                    "seed": 4, "kind": "基准立绘", "batchId": "batch-1",
                    "base": {"url": "https://cdn/base.png", "seed": 9},
                    "state": {"hairColor": "金", "tuneShoes": True},
                },
                api_key="sk-test-do-not-log",
                mock=False,
                urlopen=urlopen,
                environ=env,
                db_path=db_path,
                upload=lambda settings, key, raw, content_type: uploaded.append((key, raw, content_type)) or "https://cdn/a.png",
            )
            self.assertEqual(status, 200)
            self.assertEqual(data["url"], "https://cdn/a.png")
            self.assertIsNotNone(data["id"])
            self.assertEqual(data["seed"], 4)
            self.assertEqual(len(uploaded), 1)
            self.assertEqual(uploaded[0][0].startswith("role-images/base/"), True)
            self.assertEqual(uploaded[0][1], png)

            rows = list_images(db_path)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["url"], "https://cdn/a.png")
            self.assertEqual(rows[0]["kind"], "基准立绘")
            self.assertEqual(rows[0]["batch_id"], "batch-1")
            self.assertEqual(rows[0]["base_url"], "https://cdn/base.png")
            self.assertEqual(rows[0]["base_seed"], 9)
            # 角色配置快照要以 JSON 落库，再读回成原始 dict。
            self.assertEqual(rows[0]["state"], {"hairColor": "金", "tuneShoes": True})

            gallery_status, gallery_data = handle_gallery(db_path)
            self.assertEqual(gallery_status, 200)
            self.assertEqual(gallery_data["images"][0]["state"], {"hairColor": "金", "tuneShoes": True})

    def test_generate_skips_persistence_without_oss(self):
        png = base64.b64decode(mock_png_data_url().split(",", 1)[1])

        class FakeResponse:
            def __init__(self, payload, content_type):
                self.payload = payload
                self.headers = {"Content-Type": content_type}

            def read(self):
                return self.payload if isinstance(self.payload, bytes) else json.dumps(self.payload).encode("utf-8")

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        def urlopen(req, timeout=None):
            if req.full_url.endswith("/generation"):
                return FakeResponse(
                    {"output": {"choices": [{"message": {"content": [{"image": "https://example.test/a.png"}]}}]}},
                    "application/json",
                )
            return FakeResponse(png, "image/png")

        status, data = handle_generate(
            {"prompt": "p", "aspectRatio": "1:1", "seed": 1},
            api_key="sk-test-do-not-log",
            mock=False,
            urlopen=urlopen,
            environ={},
        )
        self.assertEqual(status, 200)
        self.assertTrue(data["dataUrl"].startswith("data:image/png;base64,"))
        self.assertIsNone(data["url"])
        self.assertIsNone(data["id"])

    def test_gallery_returns_persisted_records(self):
        with TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "gallery.db"
            init_db(db_path)
            insert_image(db_path, {
                "url": "https://cdn/a.png", "kind": "三视图", "aspect": "16:9", "seed": 5,
                "positive": "p", "negative": "n", "batch_id": "b1", "base_url": "https://cdn/base.png",
                "base_seed": 9, "created_at": "2026-10-29T06:00:00+00:00",
            })
            status, data = handle_gallery(db_path)
            self.assertEqual(status, 200)
            self.assertEqual(len(data["images"]), 1)
            self.assertEqual(data["images"][0]["url"], "https://cdn/a.png")
            self.assertEqual(data["images"][0]["kind"], "三视图")
            self.assertEqual(data["images"][0]["base"]["url"], "https://cdn/base.png")

    def test_image_proxy_fetches_only_urls_already_in_the_gallery(self):
        png = b"\x89PNG\r\n\x1a\nrest"
        with TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "gallery.db"
            init_db(db_path)
            insert_image(db_path, {
                "url": "https://cdn/a.png", "kind": "基准立绘", "aspect": "3:4", "seed": 1,
                "positive": "p", "negative": "n", "batch_id": "b1", "base_url": None,
                "base_seed": None, "created_at": "2026-10-29T06:00:00+00:00",
            })
            seen = []

            class FakeResponse:
                headers = {"Content-Type": "image/png"}

                def read(self, n=-1):
                    return png if n is None or n < 0 else png[:n]

                def __enter__(self):
                    return self

                def __exit__(self, *args):
                    return False

            def urlopen(req, timeout=None):
                seen.append(req.full_url)
                return FakeResponse()

            status, headers, raw = handle_remote_image(
                "/api/image?url=" + quote("https://cdn/a.png", safe=""),
                db_path=db_path,
                urlopen=urlopen,
            )
            self.assertEqual(status, 200)
            self.assertEqual(headers["Content-Type"], "image/png")
            self.assertEqual(raw, png)
            self.assertEqual(seen, ["https://cdn/a.png"])

            status, _, _ = handle_remote_image(
                "/api/image?url=" + quote("https://evil.test/secret.png", safe=""),
                db_path=db_path,
                urlopen=urlopen,
            )
            self.assertEqual(status, 404)
            self.assertEqual(seen, ["https://cdn/a.png"])

    def test_init_db_adds_created_at_without_dropping_old_rows(self):
        import sqlite3

        with TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "gallery.db"
            conn = sqlite3.connect(db_path)
            conn.execute(
                "CREATE TABLE images (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, "
                "kind TEXT, aspect TEXT, seed INTEGER, positive TEXT, negative TEXT, "
                "batch_id TEXT, base_url TEXT, base_seed INTEGER)"
            )
            conn.execute("INSERT INTO images (url, kind) VALUES ('https://cdn/old.png', '基准立绘')")
            conn.commit()
            conn.close()
            init_db(db_path)
            insert_image(db_path, {
                "url": "https://cdn/new.png", "kind": "三视图", "aspect": "16:9", "seed": 2,
                "positive": "p", "negative": "n", "batch_id": "b", "base_url": None,
                "base_seed": None, "created_at": "2026-10-29T06:00:00+00:00",
            })
            rows = list_images(db_path)
            self.assertEqual(rows[0]["url"], "https://cdn/new.png")
            self.assertEqual(rows[0]["created_at"], "2026-10-29T06:00:00+00:00")
            self.assertEqual(rows[1]["url"], "https://cdn/old.png")
            self.assertIsNone(rows[1]["created_at"])

    def test_delete_images_removes_only_requested_rows(self):
        with TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "gallery.db"
            init_db(db_path)
            record = {
                "kind": "基准立绘", "aspect": "3:4", "seed": 1,
                "positive": "p", "negative": "n", "batch_id": "b1", "base_url": None,
                "base_seed": None, "created_at": "2026-10-29T06:00:00+00:00",
            }
            first = insert_image(db_path, {**record, "url": "https://cdn/a.png"})
            second = insert_image(db_path, {**record, "url": "https://cdn/b.png", "seed": 2})
            status, data = handle_delete_images({"ids": [first]}, db_path)
            self.assertEqual(status, 200)
            self.assertEqual(data["deleted"], 1)
            self.assertEqual([row["id"] for row in list_images(db_path)], [second])
            status, data = handle_delete_images({"ids": []}, db_path)
            self.assertEqual(status, 400)
            self.assertEqual(len(list_images(db_path)), 1)

    def test_gallery_empty_when_db_missing(self):
        with TemporaryDirectory() as tmp:
            status, data = handle_gallery(Path(tmp) / "none.db")
        self.assertEqual(status, 200)
        self.assertEqual(data, {"images": []})


class UpscaleHandlerTests(unittest.TestCase):
    def test_requires_video_data_url(self):
        status, data = handle_upscale({})
        self.assertEqual(status, 400)
        self.assertEqual(data, {"error": "缺少 videoDataUrl"})

    def test_rejects_unknown_model(self):
        status, data = handle_upscale({"videoDataUrl": "data:video/webm;base64,AAAA", "model": "nope"})
        self.assertEqual(status, 400)
        self.assertEqual(data, {"error": "不支持的模型：nope"})

    def test_rejects_non_dict_body(self):
        status, data = handle_upscale(None)
        self.assertEqual(status, 400)
        self.assertEqual(data, {"error": "请求体必须是 JSON 对象"})

    def test_rejects_bad_scale_without_crashing(self):
        status, data = handle_upscale({"videoDataUrl": "data:video/webm;base64,AAAA", "scale": "abc"})
        self.assertEqual(status, 400)
        self.assertEqual(data, {"error": "scale 必须是数字"})

    def test_rejects_out_of_range_scale(self):
        status, data = handle_upscale({"videoDataUrl": "data:video/webm;base64,AAAA", "scale": 0})
        self.assertEqual(status, 400)
        self.assertEqual(data, {"error": "scale 需在 (0, 8] 范围内"})

    def test_rejects_denoise_on_non_general_model(self):
        status, data = handle_upscale(
            {"videoDataUrl": "data:video/webm;base64,AAAA", "model": "animevideov3", "denoise": 0.3}
        )
        self.assertEqual(status, 400)
        self.assertEqual(data, {"error": "denoise 仅用于 general-x4v3 模型"})

    def test_upscale_parallelism_is_two(self):
        self.assertEqual(UPSCALE_MAX_WORKERS, 2)

    def test_missing_script_returns_503(self):
        with TemporaryDirectory() as tmp:
            missing = str(Path(tmp) / "does_not_exist.py")
            status, data = handle_upscale(
                {"videoDataUrl": "data:video/webm;base64,AAAA"},
                environ={"UPSCALE_SCRIPT": missing},
            )
        self.assertEqual(status, 503)

    def test_full_lifecycle_with_fake_runner(self):
        with TemporaryDirectory() as tmp:
            script = Path(tmp) / "fake_upscale.py"
            script.write_text("# placeholder", encoding="utf-8")

            def fake_run(cmd, check=True):
                out = None
                for i, arg in enumerate(cmd):
                    if arg == "--output" and i + 1 < len(cmd):
                        out = Path(cmd[i + 1])
                if out:
                    out.write_bytes(b"FAKE")
                return None

            store = {}
            status, data = handle_upscale(
                {"videoDataUrl": "data:video/webm;base64,AAAA", "model": "animevideov3", "scale": 2},
                environ={"UPSCALE_SCRIPT": str(script)},
                run=fake_run,
                task_store=store,
                make_id=lambda: "test-task",
            )
            self.assertEqual(status, 200)
            self.assertEqual(data["taskId"], "test-task")
            for _ in range(100):
                if store.get("test-task", {}).get("status") in ("done", "error"):
                    break
                time.sleep(0.05)
            self.assertEqual(store["test-task"]["status"], "done")

            status, body = handle_upscale_status("/api/upscale/status?taskId=test-task", task_store=store)
            self.assertEqual(status, 200)
            self.assertEqual(body["status"], "done")

            status, headers, raw = handle_upscale_result("/api/upscale/result?taskId=test-task", task_store=store)
            self.assertEqual(status, 200)
            self.assertEqual(raw, b"FAKE")
            self.assertEqual(headers["Content-Type"], "video/mp4")

    def test_status_and_result_for_unknown_task(self):
        status, body = handle_upscale_status("/api/upscale/status?taskId=nope", task_store={})
        self.assertEqual(status, 404)
        status, headers, raw = handle_upscale_result("/api/upscale/result?taskId=nope", task_store={})
        self.assertEqual(status, 404)
        self.assertEqual(raw, b"task not found")

    def test_cancel_unknown_task_returns_404(self):
        status, data = handle_upscale_cancel("/api/upscale/cancel?taskId=nope", task_store={})
        self.assertEqual(status, 404)
        self.assertEqual(data, {"error": "任务不存在"})

    def test_cancel_marks_running_task_cancelled(self):
        store = {"t1": {"status": "running", "error": None, "result_path": "out.mp4"}}
        status, data = handle_upscale_cancel("/api/upscale/cancel?taskId=t1", task_store=store)
        self.assertEqual(status, 200)
        self.assertEqual(data, {"status": "cancelled"})
        self.assertEqual(store["t1"]["status"], "cancelled")

    def test_cancel_terminates_the_subprocess(self):
        class FakeProc:
            def __init__(self):
                self.terminated = False
                self.killed = False

            def poll(self):
                return None  # 仍在运行

            def terminate(self):
                self.terminated = True

            def kill(self):
                self.killed = True

            def wait(self, timeout=None):
                return 0

        proc = FakeProc()
        store = {"t1": {"status": "running", "error": None, "result_path": "out.mp4", "proc": proc}}
        with mock.patch("server.app._terminate_tree", side_effect=lambda p: p.terminate()) as term:
            status, data = handle_upscale_cancel("/api/upscale/cancel?taskId=t1", task_store=store)
        self.assertEqual(status, 200)
        term.assert_called_once_with(proc)
        self.assertTrue(proc.terminated)

    def test_cancel_of_finished_task_is_idempotent(self):
        store = {"t1": {"status": "done", "error": None, "result_path": "out.mp4"}}
        status, data = handle_upscale_cancel("/api/upscale/cancel?taskId=t1", task_store=store)
        self.assertEqual(status, 200)
        self.assertEqual(data, {"status": "done"})
        self.assertEqual(store["t1"]["status"], "done")


class VideoPayloadTests(unittest.TestCase):
    def test_model_table_only_has_first_last_capable_models(self):
        # 2026 年的正解是万相 3.0（All-in-One，靠 media 里同时给 first_frame/last_frame 实现首尾帧）。
        self.assertIn("wan3.0-video-prime", VIDEO_MODELS)
        self.assertIn("wan3.0-video", VIDEO_MODELS)
        for model in VIDEO_MODELS:
            self.assertNotIn("turbo", model)

    def test_first_and_last_frame_go_through_the_media_array(self):
        payload = build_video_payload({
            "model": "wan3.0-video-prime",
            "prompt": "Subtle idle animation",
            "negativePrompt": "blurry",
            "imageDataUrl": "data:image/png;base64,AAAA",
        })
        self.assertEqual(payload["model"], "wan3.0-video-prime")
        self.assertEqual(payload["input"]["media"], [
            {"type": "first_frame", "url": "data:image/png;base64,AAAA"},
            {"type": "last_frame", "url": "data:image/png;base64,AAAA"},
        ])
        # 新接口不再接收 input.first_frame / parameters.size 这套旧字段。
        self.assertNotIn("first_frame", payload["input"])
        self.assertNotIn("size", payload["parameters"])
        self.assertIs(payload["parameters"]["prompt_extend"], False)
        self.assertIs(payload["parameters"]["audio"], False)

    def test_duration_defaults_to_a_soft_cycle(self):
        payload = build_video_payload({"imageDataUrl": "data:image/png;base64,AAAA"})
        # 默认 6 秒：全身重心一个来回 ≈ 6~10 秒，周期越长位移越慢越自然。
        self.assertEqual(payload["parameters"]["duration"], 6)
        self.assertEqual(payload["parameters"]["resolution"], "720P")
        self.assertEqual(payload["parameters"]["ratio"], "adaptive")

    def test_duration_and_enums_are_clamped(self):
        payload = build_video_payload({
            "imageDataUrl": "data:image/png;base64,AAAA",
            "duration": 99,
            "resolution": "4K",
            "ratio": "7:3",
        })
        self.assertEqual(payload["parameters"]["duration"], 30)
        self.assertEqual(payload["parameters"]["resolution"], "720P")
        self.assertEqual(payload["parameters"]["ratio"], "adaptive")
        payload = build_video_payload({"imageDataUrl": "data:image/png;base64,AAAA", "duration": 0})
        # 0 是「小于下限」而不是「无效」，会被夹到下限 2 秒；
        # 前端不会发 0，真要更柔在面板里选 6/8 秒。
        self.assertEqual(payload["parameters"]["duration"], 2)

    def test_negative_prompt_is_folded_into_the_prompt(self):
        payload = build_video_payload({
            "prompt": "idle",
            "negativePrompt": "camera shake, zoom, pan",
            "imageDataUrl": "data:image/png;base64,AAAA",
        })
        self.assertIn("idle", payload["input"]["prompt"])
        self.assertIn("camera shake, zoom, pan", payload["input"]["prompt"])
        # 万相 3.0 的负向写法是独立段落【负向清单】，不是英文前缀。
        self.assertIn("【负向清单】", payload["input"]["prompt"])

    def test_unknown_model_is_rejected(self):
        with self.assertRaises(ValueError):
            build_video_payload({"model": "wan2.1-turbo", "imageDataUrl": "data:image/png;base64,AAAA"})

    def test_missing_image_is_rejected(self):
        with self.assertRaises(ValueError):
            build_video_payload({"model": "wan3.0-video-prime"})

    def test_retired_model_ids_are_explicitly_rejected(self):
        # wan2.1-flf2v 是开源权重名，百炼没有这个 ID；wan2.7-i2v 已被 3.0 取代。
        for model in ("wan2.1-flf2v", "wan2.7-i2v", "wan2.2-kf2v-flash"):
            with self.assertRaises(ValueError):
                build_video_payload({"model": model, "imageDataUrl": "data:image/png;base64,AAAA"})


class VideoGenHandlerTests(unittest.TestCase):
    def test_requires_a_dict_body(self):
        status, data = handle_video_gen(None)
        self.assertEqual(status, 400)
        self.assertEqual(data, {"error": "请求体必须是 JSON 对象"})

    def test_requires_the_api_key(self):
        status, data = handle_video_gen(
            {"imageDataUrl": "data:image/png;base64,AAAA"},
            environ={},
        )
        self.assertEqual(status, 503)
        self.assertEqual(data, {"error": "未配置 DASHSCOPE_API_KEY"})

    def test_bad_parameters_return_400(self):
        status, data = handle_video_gen(
            {"model": "wan2.1-turbo", "imageDataUrl": "data:image/png;base64,AAAA"},
            environ={"DASHSCOPE_API_KEY": "sk-test-do-not-log"},
        )
        self.assertEqual(status, 400)
        self.assertEqual(data, {"error": "不支持的模型：wan2.1-turbo"})

    def test_full_lifecycle_with_fake_dashscope(self):
        class FakeResponse:
            def __init__(self, payload, raw=False):
                self.payload = payload
                self.raw = raw

            def read(self):
                if self.raw:
                    return self.payload
                return json.dumps(self.payload).encode("utf-8")

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

        seen = []

        def urlopen(req, timeout=None):
            seen.append(req.full_url)
            if req.full_url.endswith("/video-synthesis"):
                return FakeResponse({"output": {"task_id": "dash-1"}})
            if req.full_url.startswith("https://dashscope.aliyuncs.com/api/v1/tasks/"):
                return FakeResponse({"output": {"task_status": "SUCCEEDED", "video_url": "https://cdn.test/video.mp4"}})
            return FakeResponse(b"FAKE-VIDEO", raw=True)

        store = {}
        status, data = handle_video_gen(
            {
                "model": "wan3.0-video-prime",
                "prompt": "Subtle idle animation",
                "negativePrompt": "blurry",
                "imageDataUrl": "data:image/png;base64,AAAA",
                "duration": 2,
            },
            environ={"DASHSCOPE_API_KEY": "sk-test-do-not-log"},
            urlopen=urlopen,
            task_store=store,
            make_id=lambda: "v1",
            sleep_fn=lambda s: None,
        )
        self.assertEqual(status, 200)
        self.assertEqual(data, {"taskId": "v1"})
        for _ in range(100):
            if store.get("v1", {}).get("status") in ("done", "error"):
                break
            time.sleep(0.02)
        self.assertEqual(store["v1"]["status"], "done")
        # 首帧被同时用作 last_frame 传入（媒体数组里两个 type），urlopen 只触碰百炼的 3 个端点。
        self.assertEqual(len(seen), 3)

        status, body = handle_video_status("/api/video-gen/status?taskId=v1", task_store=store)
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "done")

        status, headers, raw = handle_video_result("/api/video-gen/result?taskId=v1", task_store=store)
        self.assertEqual(status, 200)
        self.assertEqual(raw, b"FAKE-VIDEO")
        self.assertEqual(headers["Content-Type"], "video/mp4")

    def test_status_result_and_cancel_for_unknown_task(self):
        status, body = handle_video_status("/api/video-gen/status?taskId=nope", task_store={})
        self.assertEqual(status, 404)
        status, _, raw = handle_video_result("/api/video-gen/result?taskId=nope", task_store={})
        self.assertEqual(status, 404)
        self.assertEqual(raw, b"task not found")
        status, data = handle_video_cancel("/api/video-gen/cancel?taskId=nope", task_store={})
        self.assertEqual(status, 404)
        self.assertEqual(data, {"error": "任务不存在"})

    def test_result_is_409_until_done(self):
        store = {"v1": {"status": "running", "error": None, "result_path": "out.mp4"}}
        status, _, raw = handle_video_result("/api/video-gen/result?taskId=v1", task_store=store)
        self.assertEqual(status, 409)
        self.assertEqual(raw, b"not ready")

    def test_cancel_marks_running_task_cancelled(self):
        store = {"v1": {"status": "running", "error": None, "result_path": "out.mp4"}}
        status, data = handle_video_cancel("/api/video-gen/cancel?taskId=v1", task_store=store)
        self.assertEqual(status, 200)
        self.assertEqual(data, {"status": "cancelled"})
        self.assertEqual(store["v1"]["status"], "cancelled")


class InterpolateHandlerTests(unittest.TestCase):
    def test_task_slots_stay_single(self):
        # 任务级仍然只放 1 路：多路任务是抢显存，加速靠任务内部的多 stream。
        self.assertEqual(INTERP_MAX_WORKERS, 1)

    def test_parallel_driver_is_shipped_with_the_project(self):
        path = interpolate_parallel_script_path()
        self.assertIsNotNone(path)
        self.assertTrue(path.endswith("rife_parallel.py"))

    def test_parallel_is_on_by_default_and_can_be_turned_off(self):
        self.assertTrue(interpolate_parallel_enabled({}))
        self.assertFalse(interpolate_parallel_enabled({"INTERPOLATE_PARALLEL": "0"}))
        self.assertFalse(interpolate_parallel_enabled({"INTERPOLATE_PARALLEL": "off"}))
        self.assertTrue(interpolate_parallel_enabled({"INTERPOLATE_PARALLEL": "1"}))
        # 显式指定了别的补帧脚本时不要偷偷换驱动
        self.assertFalse(interpolate_parallel_enabled({"INTERPOLATE_SCRIPT": "D:/x/interpolate_video.py"}))
        self.assertTrue(interpolate_parallel_enabled(
            {"INTERPOLATE_SCRIPT": "D:/x/interpolate_video.py", "INTERPOLATE_PARALLEL": "1"}))

    def test_interp_settings_default_to_four_streams_and_clamp(self):
        # 实测 720P 4 路是拐点（73.9 -> 49.3 ms/对），所以默认 4 且上限 6。
        self.assertEqual(interp_settings({})["workers"], 4)
        self.assertEqual(interp_settings({})["io_workers"], 6)
        self.assertEqual(interp_settings({"RIFE_WORKERS": "6"})["workers"], 6)
        self.assertEqual(interp_settings({"RIFE_WORKERS": "99"})["workers"], 6)
        self.assertEqual(interp_settings({"RIFE_WORKERS": "0"})["workers"], 1)
        self.assertEqual(interp_settings({"RIFE_WORKERS": "abc"})["workers"], 4)

    def test_parallel_run_passes_worker_flags(self):
        with TemporaryDirectory() as tmp:
            script = Path(tmp) / "interpolate_video.py"
            script.write_text("# placeholder", encoding="utf-8")
            seen = {}

            def fake_run(cmd, check=True):
                seen["cmd"] = cmd
                out = Path(cmd[cmd.index("--output") + 1])
                out.write_bytes(b"FAKE-60FPS")
                return None

            store = {}
            status, data = handle_interpolate(
                {"videoDataUrl": "data:video/webm;base64,AAAA", "targetFps": 60},
                environ={
                    "INTERPOLATE_SCRIPT": str(script),
                    "INTERPOLATE_PARALLEL": "1",
                    "RIFE_WORKERS": "3",
                    "RIFE_IO_WORKERS": "5",
                },
                run=fake_run,
                task_store=store,
                make_id=lambda: "p1",
            )
            self.assertEqual(status, 200)
            for _ in range(100):
                if store.get("p1", {}).get("status") in ("done", "error"):
                    break
                time.sleep(0.02)
            self.assertEqual(store["p1"]["status"], "done")

            cmd = seen["cmd"]
            self.assertEqual(cmd[1], interpolate_parallel_script_path())
            self.assertEqual(cmd[cmd.index("--workers") + 1], "3")
            self.assertEqual(cmd[cmd.index("--io-workers") + 1], "5")
            # 工作目录必须跟着任务走，否则并发任务会互相踩掉 frames_in
            self.assertIn("--work", cmd)
            self.assertIn("p1", cmd[cmd.index("--work") + 1])

    def test_serial_fallback_does_not_pass_parallel_flags(self):
        with TemporaryDirectory() as tmp:
            script = Path(tmp) / "interpolate_video.py"
            script.write_text("# placeholder", encoding="utf-8")
            seen = {}

            def fake_run(cmd, check=True):
                seen["cmd"] = cmd
                Path(cmd[cmd.index("--output") + 1]).write_bytes(b"FAKE")
                return None

            store = {}
            handle_interpolate(
                {"videoDataUrl": "data:video/webm;base64,AAAA", "targetFps": 60},
                environ={"INTERPOLATE_SCRIPT": str(script), "INTERPOLATE_PARALLEL": "0"},
                run=fake_run,
                task_store=store,
                make_id=lambda: "s1",
            )
            for _ in range(100):
                if store.get("s1", {}).get("status") in ("done", "error"):
                    break
                time.sleep(0.02)
            cmd = seen["cmd"]
            self.assertEqual(cmd[1], str(script))
            self.assertNotIn("--workers", cmd)

    def test_script_path_follows_the_override(self):
        with TemporaryDirectory() as tmp:
            script = Path(tmp) / "interpolate_video.py"
            script.write_text("# placeholder", encoding="utf-8")
            self.assertEqual(interpolate_script_path({"INTERPOLATE_SCRIPT": str(script)}), str(script))
            missing = Path(tmp) / "nope.py"
            self.assertIsNone(interpolate_script_path({"INTERPOLATE_SCRIPT": str(missing)}))

    def test_requires_video_data_url(self):
        status, data = handle_interpolate({})
        self.assertEqual(status, 400)
        self.assertEqual(data, {"error": "缺少 videoDataUrl"})

    def test_rejects_out_of_range_target_fps(self):
        status, data = handle_interpolate({"videoDataUrl": "data:video/webm;base64,AAAA", "targetFps": 25})
        self.assertEqual(status, 400)

    def test_missing_script_returns_503(self):
        with TemporaryDirectory() as tmp:
            status, data = handle_interpolate(
                {"videoDataUrl": "data:video/webm;base64,AAAA"},
                environ={"INTERPOLATE_SCRIPT": str(Path(tmp) / "nope.py")},
            )
        self.assertEqual(status, 503)

    def test_full_lifecycle_with_fake_runner(self):
        with TemporaryDirectory() as tmp:
            script = Path(tmp) / "fake_interp.py"
            script.write_text("# placeholder", encoding="utf-8")

            def fake_run(cmd, check=True):
                out = None
                for i, arg in enumerate(cmd):
                    if arg == "--output" and i + 1 < len(cmd):
                        out = Path(cmd[i + 1])
                if out:
                    out.write_bytes(b"FAKE-60FPS")
                return None

            store = {}
            status, data = handle_interpolate(
                {"videoDataUrl": "data:video/webm;base64,AAAA", "targetFps": 60},
                environ={"INTERPOLATE_SCRIPT": str(script)},
                run=fake_run,
                task_store=store,
                make_id=lambda: "i1",
            )
            self.assertEqual(status, 200)
            self.assertEqual(data["taskId"], "i1")
            for _ in range(100):
                if store.get("i1", {}).get("status") in ("done", "error"):
                    break
                time.sleep(0.02)
            self.assertEqual(store["i1"]["status"], "done")

            status, body = handle_interpolate_status("/api/interpolate/status?taskId=i1", task_store=store)
            self.assertEqual(status, 200)
            self.assertEqual(body["status"], "done")

            status, headers, raw = handle_interpolate_result("/api/interpolate/result?taskId=i1", task_store=store)
            self.assertEqual(status, 200)
            self.assertEqual(raw, b"FAKE-60FPS")
            self.assertEqual(headers["Content-Type"], "video/mp4")

    def test_status_result_and_cancel_for_unknown_task(self):
        status, body = handle_interpolate_status("/api/interpolate/status?taskId=nope", task_store={})
        self.assertEqual(status, 404)
        status, _, raw = handle_interpolate_result("/api/interpolate/result?taskId=nope", task_store={})
        self.assertEqual(status, 404)
        self.assertEqual(raw, b"task not found")
        status, data = handle_interpolate_cancel("/api/interpolate/cancel?taskId=nope", task_store={})
        self.assertEqual(status, 404)
        self.assertEqual(data, {"error": "任务不存在"})

    def test_cancel_marks_running_task_cancelled(self):
        store = {"i1": {"status": "running", "error": None, "result_path": "out.mp4", "proc": None}}
        status, data = handle_interpolate_cancel("/api/interpolate/cancel?taskId=i1", task_store=store)
        self.assertEqual(status, 200)
        self.assertEqual(data, {"status": "cancelled"})
        self.assertEqual(store["i1"]["status"], "cancelled")


class TranscodeHandlerTests(unittest.TestCase):
    def test_requires_a_dict_body(self):
        status, headers, raw = handle_transcode(None)
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(raw), {"error": "请求体必须是 JSON 对象"})

    def test_requires_video_data_url(self):
        status, headers, raw = handle_transcode({})
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(raw), {"error": "缺少 videoDataUrl"})

    def test_rejects_non_data_url(self):
        status, headers, raw = handle_transcode({"videoDataUrl": "not-a-data-url"})
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(raw), {"error": "缺少 videoDataUrl"})

    def test_missing_ffmpeg_returns_503(self):
        with mock.patch("shutil.which", return_value=None):
            status, headers, raw = handle_transcode({"videoDataUrl": "data:video/webm;base64,AAAA"})
        self.assertEqual(status, 503)
        self.assertEqual(json.loads(raw), {"error": "未找到 ffmpeg，无法转码为 mp4"})

    def test_transcodes_webm_to_mp4_with_fake_runner(self):
        def fake_run(cmd, check=True, capture_output=False, cwd=None):
            # 命令最后一个参数就是输出 mp4 路径。
            out = Path(cmd[-1])
            out.write_bytes(b"FAKE-MP4")
            return None

        with mock.patch("shutil.which", return_value="C:\\ffmpeg.exe"):
            status, headers, raw = handle_transcode(
                {"videoDataUrl": "data:video/webm;base64,AAAA"},
                run=fake_run,
            )
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "video/mp4")
        self.assertIn("filename", headers["Content-Disposition"])
        self.assertEqual(raw, b"FAKE-MP4")

    def test_webm_input_is_resampled_to_cfr(self):
        """webm 的墙钟时间戳必须显式重采样：不写 -fps_mode cfr 就会照抄 2000fps 时基。"""
        seen = {}

        def fake_run(cmd, check=True, capture_output=False, cwd=None):
            seen["cmd"] = cmd
            Path(cmd[-1]).write_bytes(b"FAKE-MP4")

        with mock.patch("shutil.which", return_value="/usr/bin/ffmpeg"):
            status, _headers, _raw = handle_transcode(
                {"videoDataUrl": "data:video/webm;base64,AAAA", "fps": 60},
                run=fake_run,
            )
        self.assertEqual(status, 200)
        cmd = seen["cmd"]
        self.assertEqual(cmd[cmd.index("-fps_mode") + 1], "cfr")
        self.assertEqual(cmd[cmd.index("-r") + 1], "60")
        # webm 走默认解复用器，不该出现裸流专用的 -f h264。
        self.assertNotIn("h264", cmd)

    def test_h264_annexb_input_uses_raw_demuxer(self):
        """WebCodecs 逐帧编码出的是裸流：没有时间戳，只能靠 -f h264 -r fps 铺成 CFR。"""
        seen = {}

        def fake_run(cmd, check=True, capture_output=False, cwd=None):
            seen["cmd"] = cmd
            work = Path(cwd)
            self.assertTrue((work / "in.h264").is_file(), "裸流必须落成 in.h264")
            self.assertEqual((work / "in.h264").read_bytes(), bytes([0, 0, 0, 1]) + b"FAKE")
            Path(cmd[-1]).write_bytes(b"FAKE-MP4")

        with mock.patch("shutil.which", return_value="/usr/bin/ffmpeg"):
            status, _headers, raw = handle_transcode(
                {"videoDataUrl": "data:video/h264;base64,AAAAAUZBS0U=", "inputFormat": "h264", "fps": 60},
                run=fake_run,
            )
        self.assertEqual(status, 200)
        self.assertEqual(raw, b"FAKE-MP4")
        cmd = seen["cmd"]
        self.assertEqual(cmd[cmd.index("-f") + 1], "h264")
        self.assertEqual(cmd[cmd.index("-r") + 1], "60")
        self.assertEqual(cmd[cmd.index("-fps_mode") + 1], "cfr")

    def test_rejects_unknown_input_format(self):
        with mock.patch("shutil.which", return_value="/usr/bin/ffmpeg"):
            status, _headers, raw = handle_transcode(
                {"videoDataUrl": "data:video/webm;base64,AAAA", "inputFormat": "mkv"},
            )
        self.assertEqual(status, 400)
        self.assertIn("inputFormat", json.loads(raw)["error"])

    def test_runner_failure_returns_500_json(self):
        def exploding_run(cmd, check=True, capture_output=False, cwd=None):
            raise RuntimeError("ffmpeg crashed")

        with mock.patch("shutil.which", return_value="/usr/bin/ffmpeg"):
            status, headers, raw = handle_transcode(
                {"videoDataUrl": "data:video/webm;base64,AAAA"},
                run=exploding_run,
            )
        self.assertEqual(status, 500)
        self.assertIn("ffmpeg crashed", json.loads(raw)["error"])

    def test_route_is_wired_in_dispatch(self):
        # 强制「找不到 ffmpeg」走 503，避免测试环境真的拉起 ffmpeg；能返回 503 而非 404 即证明路由已接通。
        with mock.patch("shutil.which", return_value=None):
            status, headers, raw = dispatch(
                "POST",
                "/api/transcode",
                {"videoDataUrl": "data:video/webm;base64,AAAA"},
                {"GENERATE_MOCK": "0"},
            )
        self.assertEqual(status, 503)
        self.assertEqual(headers["Content-Type"], "application/json; charset=utf-8")

    def test_cube_lut_is_validated_and_rejects_injection(self):
        cube = "LUT_3D_SIZE 2\nDOMAIN_MIN 0.0 0.0 0.0\nDOMAIN_MAX 1.0 1.0 1.0\n"
        cube += "0.0 0.0 0.0\n1.0 0.0 0.0\n0.0 1.0 0.0\n1.0 1.0 0.0\n"
        cube += "0.0 0.0 1.0\n1.0 0.0 1.0\n0.0 1.0 1.0\n1.0 1.0 1.0\n"
        self.assertEqual(parse_cube_lut(cube), cube)

        # 行数不对（少一行）必须拒绝，否则 ffmpeg 只会给出难懂的错误。
        with self.assertRaises(ValueError):
            parse_cube_lut(cube.replace("1.0 1.0 1.0\n", ""))

        # 试图把滤镜串塞进 .cube 的人必须被拦住。
        evil = cube + "\n0.1 0.2 0.3,drawtext=text=hi\n"
        with self.assertRaises(ValueError):
            parse_cube_lut(evil)

        with self.assertRaises(ValueError):
            parse_cube_lut("")

    def test_grade_filters_map_the_four_spatial_params(self):
        filters = build_grade_filters({"sharpen": 0.5, "clarity": -0.2, "grain": 0.3, "vignette": 0.6})
        self.assertTrue(filters[0].startswith("unsharp=luma_msize_x=3"))
        self.assertIn("0.600", filters[0])
        self.assertTrue(filters[1].startswith("unsharp=luma_msize_x=7"))
        self.assertIn("-0.180", filters[1])
        self.assertIn("noise=alls=12.0", filters[2])
        self.assertIn("mode=forward", filters[3])
        # 反向暗角（提亮边缘）要切成 backward。
        self.assertIn("mode=backward", build_grade_filters({"vignette": -0.5})[0])
        # 全 0 时不产出任何滤镜，转码命令保持与原来完全一致。
        self.assertEqual(build_grade_filters({}), [])
        self.assertEqual(build_grade_filters({"sharpen": 0, "grain": "x"}), [])

    def test_lut_is_written_next_to_the_input_and_applied_first(self):
        seen = {}

        def fake_run(cmd, check=True, capture_output=False, cwd=None):
            seen["cmd"] = cmd
            seen["cwd"] = cwd
            work = Path(cwd)
            self.assertTrue((work / "grade.cube").is_file(), "LUT 必须落在工作目录里")
            self.assertIn("LUT_3D_SIZE", (work / "grade.cube").read_text(encoding="utf-8"))
            Path(cmd[-1]).write_bytes(b"FAKE-MP4")

        cube = "LUT_3D_SIZE 2\n" + "0.0 0.0 0.0\n1.0 0.0 0.0\n0.0 1.0 0.0\n1.0 1.0 0.0\n"
        cube += "0.0 0.0 1.0\n1.0 0.0 1.0\n0.0 1.0 1.0\n1.0 1.0 1.0\n"
        with mock.patch("shutil.which", return_value="/usr/bin/ffmpeg"):
            status, _headers, raw = handle_transcode(
                {"videoDataUrl": "data:video/webm;base64,AAAA", "lut": cube, "grade": {"grain": 0.5}, "crf": 14},
                run=fake_run,
            )
        self.assertEqual(status, 200)
        self.assertEqual(raw, b"FAKE-MP4")
        vf = seen["cmd"][seen["cmd"].index("-vf") + 1]
        # lut3d 必须排在最前：先定色调，再锐化/加颗粒/压暗角。
        self.assertTrue(vf.startswith("lut3d=file=grade.cube"))
        self.assertIn("noise=alls=", vf)
        self.assertIn("-crf", seen["cmd"])
        self.assertEqual(seen["cmd"][seen["cmd"].index("-crf") + 1], "14")

    def test_bad_lut_returns_400_without_touching_ffmpeg(self):
        called = []

        def fake_run(*args, **kwargs):
            called.append(args)

        with mock.patch("shutil.which", return_value="/usr/bin/ffmpeg"):
            status, _headers, raw = handle_transcode(
                {"videoDataUrl": "data:video/webm;base64,AAAA", "lut": "LUT_3D_SIZE 3\n"},
                run=fake_run,
            )
        self.assertEqual(status, 400)
        self.assertIn("LUT", json.loads(raw)["error"])
        self.assertEqual(called, [])


class ColorLockTests(unittest.TestCase):
    """逐帧色彩锁定：兜底消除「整段一明一暗」的呼吸感。"""

    def _numpy(self):
        try:
            import numpy  # noqa: F401
        except Exception:  # noqa: BLE001
            self.skipTest("未安装 numpy")
        return __import__("numpy")

    def test_gains_pull_brightness_drift_back_to_the_median(self):
        np = self._numpy()
        # 一段缓慢的明暗呼吸：周期 40 帧（1.3 秒）正弦漂移 ±10 级。
        means = np.array(
            [[110 + 10 * np.sin(2 * np.pi * i / 40)] * 3 for i in range(40)],
            dtype=float,
        )
        gains = color_lock_gains(means, fps=30.0)
        corrected = means * gains
        # 原波动 20 级，校正后必须收敛到个位数，肉眼看不出来。
        self.assertLess(float(corrected.max() - corrected.min()), 8.0)

    def test_a_black_first_frame_cannot_blacken_the_whole_clip(self):
        np = self._numpy()
        # 首帧是淡入黑场：若以首帧为基准，整段会被拉黑。
        means = np.array([[0, 0, 0]] + [[128, 128, 128]] * 20, dtype=float)
        gains = color_lock_gains(means, fps=30.0)
        corrected = means * gains
        # 正常帧不能被压暗（基准取中位数），黑场也只会被限幅提亮。
        self.assertGreater(float(corrected[-1][0]), 120.0)

    def test_gains_never_exceed_the_clamp(self):
        np = self._numpy()
        means = np.array([[2, 2, 2], [255, 255, 255], [64, 64, 64]], dtype=float)
        gains = color_lock_gains(means, fps=30.0)
        self.assertGreaterEqual(float(gains.min()), COLOR_LOCK_MIN_GAIN - 1e-9)
        self.assertLessEqual(float(gains.max()), COLOR_LOCK_MAX_GAIN + 1e-9)

    def test_too_few_frames_yields_unity_gains(self):
        np = self._numpy()
        gains = color_lock_gains(np.array([[100, 100, 100]], dtype=float), fps=30.0)
        self.assertEqual(gains.shape, (1, 3))

    def test_env_switch_can_turn_it_off(self):
        self.assertTrue(color_lock_enabled({}))
        for value in ("0", "false", "OFF", "no"):
            self.assertFalse(color_lock_enabled({"WALLPAPER_COLOR_LOCK": value}))

    def test_missing_ffmpeg_returns_the_original_bytes(self):
        payload = b"ORIGINAL-VIDEO"
        with mock.patch("shutil.which", return_value=None):
            out = lock_video_colors(payload, environ={}, log=lambda _msg: None)
        # 兜底失败必须原样返回，不能中断生成流程。
        self.assertEqual(out, payload)

    def test_empty_input_is_untouched(self):
        self.assertEqual(lock_video_colors(b"", environ={}), b"")

    def test_handler_rejects_non_dict_and_missing_video(self):
        status, headers, raw = handle_color_lock(None)
        self.assertEqual(status, 400)
        status, headers, raw = handle_color_lock({})
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(raw), {"error": "缺少 videoDataUrl"})
        status, headers, raw = handle_color_lock({"videoDataUrl": "not-a-data-url"})
        self.assertEqual(status, 400)

    def test_handler_requires_ffmpeg(self):
        with mock.patch("shutil.which", return_value=None):
            status, headers, raw = handle_color_lock({"videoDataUrl": "data:video/mp4;base64,AAAA"})
        self.assertEqual(status, 503)

    def test_handler_marks_whether_pixels_changed(self):
        # 锁定成功 → X-Color-Locked: 1；原样回退 → 0，前端据此如实显示「跳过」。
        with mock.patch("shutil.which", return_value="C:\\ffmpeg.exe"), \
                mock.patch("server.app.lock_video_colors", return_value=b"LOCKED"):
            status, headers, raw = handle_color_lock({"videoDataUrl": "data:video/mp4;base64,AAAA"})
        self.assertEqual(status, 200)
        self.assertEqual(raw, b"LOCKED")
        self.assertEqual(headers["Content-Type"], "video/mp4")
        self.assertEqual(headers["X-Color-Locked"], "1")

        with mock.patch("shutil.which", return_value="C:\\ffmpeg.exe"), \
                mock.patch("server.app.lock_video_colors", side_effect=lambda raw, **_: raw):
            status, headers, raw = handle_color_lock({"videoDataUrl": "data:video/mp4;base64,AAAA"})
        self.assertEqual(status, 200)
        self.assertEqual(headers["X-Color-Locked"], "0")

    def test_route_is_wired_in_dispatch(self):
        with mock.patch("shutil.which", return_value=None):
            status, headers, raw = dispatch(
                "POST",
                "/api/color-lock",
                {"videoDataUrl": "data:video/mp4;base64,AAAA"},
                {"GENERATE_MOCK": "0"},
            )
        # 能返回 503 而不是 404，说明路由已经接上。
        self.assertEqual(status, 503)

class X264LevelTests(unittest.TestCase):
    """4K 四端导出依赖的 level 推导：给低了 x264 直接拒绝配置。"""

    def test_1080p60_stays_on_42(self):
        self.assertEqual(x264_level(1920, 1080, 60), "4.2")

    def test_4k_uhd_60_lands_on_52(self):
        # 3840×2160 = 240×135 宏块，60fps → 1.944M 宏块/秒，正好在 5.2 的 2.07M 以内。
        self.assertEqual(x264_level(3840, 2160, 60), "5.2")

    def test_wider_4k_frames_need_60(self):
        # 16:10 与 4:3 的 4K 画幅宏块率超过 5.2 上限，必须上 6.0，否则编码器报错。
        self.assertEqual(x264_level(3840, 2400, 60), "6.0")
        self.assertEqual(x264_level(3840, 2880, 60), "6.0")

    def test_portrait_4k_phone_needs_60(self):
        # 2160×4800 的宏块数 40500 已超过 5.2 的 MaxFS 36864。
        self.assertEqual(x264_level(2160, 4800, 60), "6.0")

    def test_every_platform_size_resolves_to_a_valid_level(self):
        sizes = [(3840, 2160), (2160, 4800), (3840, 2400), (3840, 2880)]
        for width, height in sizes:
            level = x264_level(width, height, 60)
            self.assertIn(level, {"5.2", "6.0", "6.1", "6.2"})

class FfmpegErrorTailTests(unittest.TestCase):
    """ffmpeg 失败时必须能说清原因，而不是只丢一个退出码。"""

    def test_prefers_error_lines_over_progress_noise(self):
        import tempfile
        from pathlib import Path
        path = Path(tempfile.mkdtemp()) / "e.log"
        path.write_text(
            "frame=1\n"
            "[libx264 @ 0x1] frame MB size (40500) > level limit (36864)\n"
            "frame=2\n"
            "[out#0 @ 0x2] Error while opening encoder\n"
            "Conversion failed!\n",
            encoding="utf-8",
        )
        tail = _ffmpeg_error_tail(path)
        self.assertIn("frame MB size", tail)
        self.assertIn("Error while opening encoder", tail)
        self.assertNotIn("frame=1", tail)

    def test_falls_back_to_last_lines_when_no_keyword(self):
        import tempfile
        from pathlib import Path
        path = Path(tempfile.mkdtemp()) / "e.log"
        path.write_text("line a\nline b\nline c\n", encoding="utf-8")
        self.assertEqual(_ffmpeg_error_tail(path), "line a | line b | line c")

    def test_missing_log_is_not_an_error(self):
        from pathlib import Path
        self.assertEqual(_ffmpeg_error_tail(Path("definitely-missing.log")), "")

    def test_workers_default_to_two_and_threads_are_divided(self):
        # 4 路 4K x264 并行在部分机器上会被系统强杀，默认降到 2 路。
        self.assertGreaterEqual(_WALLPAPER_EXPORT_WORKERS, 1)
        self.assertLessEqual(_WALLPAPER_EXPORT_WORKERS, 4)
        self.assertGreaterEqual(_WALLPAPER_EXPORT_THREADS, 1)
