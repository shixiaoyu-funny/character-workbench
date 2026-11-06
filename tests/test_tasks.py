import json
import threading
import time
import unittest
from tempfile import TemporaryDirectory
from unittest import mock
from pathlib import Path

from server import app as app_module
from server import tasks as task_queue
from server.tasks import TaskManager, TaskQueueFull


def wait_for(manager, task_id, timeout=10.0):
    task = manager.wait(task_id, timeout=timeout)
    return task


def call(fn, *args, **kwargs):
    """JSON 处理器统一返回 (status, headers, raw)，这里解成 (status, dict)。"""
    status, _headers, raw = fn(*args, **kwargs)
    return status, json.loads(raw)


class TaskManagerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db_path = Path(self.tmp.name) / "tasks.db"
        self.storage = Path(self.tmp.name) / "tasks"

    def make_manager(self, runners=None, **kwargs):
        manager = TaskManager(
            db_path=self.db_path,
            storage_dir=self.storage,
            runners=runners,
            auto_start=False,
            **kwargs,
        )
        self.addCleanup(manager.stop)
        return manager

    def test_two_pools_run_in_parallel_but_each_pool_is_serial(self):
        events = []
        lock = threading.Lock()
        b1_started = threading.Event()

        def runner(task, report):
            with lock:
                events.append(("start", task["pool"], task["title"], time.monotonic()))
            if task["title"] == "A1":
                # 等 B1 真的开始再收尾：两池并行不该靠 sleep 抢时序，
                # 机器忙的时候纯时间比较会假失败。
                b1_started.wait(5)
            elif task["title"] == "B1":
                b1_started.set()
            time.sleep(0.15)
            with lock:
                events.append(("end", task["pool"], task["title"], time.monotonic()))
            report.step(0, status="done")

        manager = self.make_manager({task_queue.TASK_IMAGE: runner})
        manager.start()
        main1 = manager.submit("image", {}, pool=task_queue.POOL_MAIN, title="A1", steps=[{"title": "a"}])
        wall1 = manager.submit("image", {}, pool=task_queue.POOL_WALLPAPER, title="B1", steps=[{"title": "b"}])
        main2 = manager.submit("image", {}, pool=task_queue.POOL_MAIN, title="A2", steps=[{"title": "a"}])
        wait_for(manager, main1["id"])
        wait_for(manager, wall1["id"])
        wait_for(manager, main2["id"])

        starts = {title: stamp for kind, _pool, title, stamp in events if kind == "start"}
        ends = {title: stamp for kind, _pool, title, stamp in events if kind == "end"}
        # 两池并行：B1 在 A1 结束前就开始。
        self.assertLess(starts["B1"], ends["A1"])
        # 池内串行：A2 必须等 A1 结束。
        self.assertGreaterEqual(starts["A2"], ends["A1"])

    def test_queue_full_raises_503_style_error(self):
        manager = self.make_manager()
        with mock.patch.object(task_queue, "QUEUE_MAX", 2):
            manager._queues[task_queue.POOL_MAIN] = __import__("queue").Queue(maxsize=2)
            manager.submit("image", {}, pool=task_queue.POOL_MAIN, steps=[{"title": "1"}])
            manager.submit("image", {}, pool=task_queue.POOL_MAIN, steps=[{"title": "1"}])
            with self.assertRaises(TaskQueueFull) as ctx:
                manager.submit("image", {}, pool=task_queue.POOL_MAIN, steps=[{"title": "1"}])
        self.assertEqual(ctx.exception.pool, task_queue.POOL_MAIN)

    def test_payload_is_written_to_disk_and_readable_by_id(self):
        manager = self.make_manager()
        task = manager.submit(
            "image",
            {"steps": [{"title": "第 1 张", "body": {"prompt": "p"}}], "refs": {"r0": "data:image/png;base64,AA"}},
            steps=[{"title": "第 1 张"}],
        )
        payload_file = self.storage / task["id"] / "payload.json"
        self.assertTrue(payload_file.is_file())
        payload = manager.payload_of(task["id"])
        self.assertEqual(payload["refs"]["r0"], "data:image/png;base64,AA")
        self.assertEqual(payload["steps"][0]["body"]["prompt"], "p")
        self.assertEqual(task["steps"][0]["title"], "第 1 张")

    def test_partial_status_counts_done_and_failed(self):
        def runner(task, report):
            report.step(0, status="done")
            report.step(1, status="failed", error="上游失败")

        manager = self.make_manager({task_queue.TASK_IMAGE: runner})
        manager.start()
        task = manager.submit("image", {}, steps=[{"title": "a"}, {"title": "b"}])
        done = wait_for(manager, task["id"])
        self.assertEqual(done["status"], "partial")
        self.assertEqual(done["done"], 1)
        self.assertEqual(done["failed"], 1)
        self.assertEqual(done["progress"], 100.0)

    def test_cancel_running_task_marks_steps_cancelled(self):
        started = threading.Event()

        def runner(task, report):
            started.set()
            for _ in range(200):
                if report.cancelled():
                    raise task_queue.TaskCancelled()
                time.sleep(0.01)

        manager = self.make_manager({task_queue.TASK_IMAGE: runner})
        manager.start()
        task = manager.submit("image", {}, steps=[{"title": "a"}])
        self.assertTrue(started.wait(3))
        manager.cancel(task["id"])
        done = wait_for(manager, task["id"])
        self.assertEqual(done["status"], "cancelled")
        self.assertEqual(done["steps"][0]["status"], "cancelled")

    def test_task_survives_in_db_for_a_new_manager(self):
        def runner(task, report):
            report.write_result(0, b"PNGDATA", "png")
            report.step(0, status="done", url="https://cdn.test/a.png", record_id=7)

        manager = self.make_manager({task_queue.TASK_IMAGE: runner})
        manager.start()
        task = manager.submit("image", {}, steps=[{"title": "第一张"}])
        wait_for(manager, task["id"])

        reopened = self.make_manager()
        record = reopened.get(task["id"])
        self.assertEqual(record["status"], "done")
        self.assertEqual(record["results"][0]["index"], 0)
        path, ext = reopened.result_file(task["id"], 0)
        self.assertEqual(ext, "png")
        self.assertEqual(Path(path).read_bytes(), b"PNGDATA")
        self.assertEqual(record["steps"][0]["recordId"], 7)

        listed = reopened.list_tasks()
        self.assertEqual([entry["id"] for entry in listed], [task["id"]])

    def test_delete_removes_db_row_and_task_directory(self):
        def runner(task, report):
            report.write_result(0, b"X", "png")
            report.step(0, status="done")

        manager = self.make_manager({task_queue.TASK_IMAGE: runner})
        manager.start()
        task = manager.submit("image", {}, steps=[{"title": "a"}])
        wait_for(manager, task["id"])
        self.assertTrue(manager.delete(task["id"]))
        self.assertIsNone(manager.get(task["id"]))
        self.assertFalse((self.storage / task["id"]).exists())

    def test_interrupted_tasks_are_marked_failed_on_restart(self):
        manager = self.make_manager()
        task = manager.submit("image", {}, steps=[{"title": "a"}])
        # 模拟「重启前一直挂着 running」：直接把状态写进库。
        record = manager.get(task["id"])
        record["status"] = "running"
        record["started_at"] = record["created_at"]
        task_queue.task_db.save_task(self.db_path, record)

        reopened = self.make_manager()
        self.assertEqual(reopened.recover_interrupted(), 1)
        recovered = reopened.get(task["id"])
        self.assertEqual(recovered["status"], "failed")


class TaskRouteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db_path = Path(self.tmp.name) / "tasks.db"
        self.storage = Path(self.tmp.name) / "tasks"
        self.manager = TaskManager(
            db_path=self.db_path,
            storage_dir=self.storage,
            runners={},
            auto_start=False,
        )
        self.addCleanup(self.manager.stop)

    def test_submit_list_detail_payload_cancel_delete(self):
        status, data = call(
            app_module.handle_task_submit,
            {
                "kind": "image",
                "pool": "main",
                "title": "生成基准立绘",
                "unit": "张",
                "steps": [{"title": "第 1 张", "body": {"prompt": "p"}}],
            },
            manager=self.manager,
        )
        self.assertEqual(status, 200)
        task_id = data["task"]["id"]

        status, listing = call(app_module.handle_task_list, "/api/tasks?pool=main", manager=self.manager)
        self.assertEqual(status, 200)
        self.assertEqual(len(listing["tasks"]), 1)

        status, detail = call(app_module.handle_task_detail, f"/api/tasks/{task_id}", manager=self.manager)
        self.assertEqual(status, 200)
        self.assertEqual(detail["task"]["id"], task_id)

        status, payload = call(app_module.handle_task_payload, f"/api/tasks/{task_id}/payload", manager=self.manager)
        self.assertEqual(status, 200)
        self.assertEqual(payload["payload"]["steps"][0]["body"]["prompt"], "p")

        status, cancelled = call(
            app_module.handle_task_cancel,
            f"/api/tasks/{task_id}/cancel",
            manager=self.manager,
        )
        self.assertEqual(status, 200)
        self.assertEqual(cancelled["task"]["status"], "cancelled")

        status, deleted = call(app_module.handle_task_delete, f"/api/tasks/{task_id}", manager=self.manager)
        self.assertEqual(status, 200)
        self.assertEqual(deleted["deleted"], task_id)

    def test_unknown_kind_and_pool_are_rejected(self):
        status, data = call(app_module.handle_task_submit, {"kind": "nope"}, manager=self.manager)
        self.assertEqual(status, 400)
        status, data = call(
            app_module.handle_task_submit,
            {"kind": "image", "pool": "nope"},
            manager=self.manager,
        )
        self.assertEqual(status, 400)

    def test_payload_route_returns_404_for_unknown_task(self):
        status, data = call(app_module.handle_task_payload, "/api/tasks/nope/payload", manager=self.manager)
        self.assertEqual(status, 404)
        status, data = call(app_module.handle_task_detail, "/api/tasks/nope", manager=self.manager)
        self.assertEqual(status, 404)


class ImageTaskRunnerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db_path = Path(self.tmp.name) / "tasks.db"
        self.storage = Path(self.tmp.name) / "tasks"

    def test_mock_generation_writes_results_and_reports_progress(self):
        manager = app_module.create_task_manager(
            environ={"GENERATE_MOCK": "1"}, db_path=self.db_path, storage_dir=self.storage,
        )
        self.addCleanup(manager.stop)
        manager.start()
        body = {
            "prompt": "测试",
            "negativePrompt": "",
            "aspectRatio": "3:4",
            "resolution": "1k",
            "kind": "基准立绘",
        }
        task = manager.submit(
            "image",
            {"steps": [{"kind": "基准立绘", "title": "第 1 张", "body": body}]},
            steps=[{"kind": "基准立绘", "title": "第 1 张"}],
        )
        done = manager.wait(task["id"], timeout=15)
        self.assertEqual(done["status"], "done", done.get("error"))
        self.assertEqual(done["done"], 1)
        path, ext = manager.result_file(task["id"], 0)
        self.assertEqual(ext, "png")
        self.assertTrue(Path(path).read_bytes().startswith(b"\x89PNG"))

    def test_downstream_step_is_skipped_when_upstream_fails(self):
        manager = app_module.create_task_manager(
            environ={"GENERATE_MOCK": "1"}, db_path=self.db_path, storage_dir=self.storage,
        )
        self.addCleanup(manager.stop)
        manager.start()
        # 第 0 步直接判失败；第 1 步声明引用 #0，拿不到上游产物就只能跳过。
        with mock.patch.object(app_module, "handle_generate", return_value=(500, {"error": "上游失败"})):
            task = manager.submit(
                "image",
                {
                    "steps": [
                        {"kind": "三视图", "title": "上游", "body": {"prompt": "p"}},
                        {"kind": "服饰拆解图", "title": "下游", "body": {"prompt": "p"}, "ref": ["#0"]},
                    ],
                    "refs": {},
                },
                steps=[{"kind": "三视图", "title": "上游"}, {"kind": "服饰拆解图", "title": "下游"}],
            )
            done = manager.wait(task["id"], timeout=15)
        statuses = [step["status"] for step in done["steps"]]
        self.assertEqual(done["status"], "failed")
        self.assertEqual(statuses, ["failed", "skipped"])
        self.assertEqual(done["done"], 0)
        self.assertEqual(done["failed"], 1)
        self.assertEqual(done["skipped"], 1)


class WallpaperTaskRunnerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db_path = Path(self.tmp.name) / "tasks.db"
        self.storage = Path(self.tmp.name) / "tasks"

    def test_batch_pipeline_writes_one_mp4_per_unit(self):
        manager = TaskManager(
            db_path=self.db_path, storage_dir=self.storage,
            runners={}, auto_start=False,
        )
        self.addCleanup(manager.stop)
        manager.register(
            task_queue.TASK_WALLPAPER_BATCH,
            lambda task, report: app_module._run_wallpaper_batch_task(task, report, environ={}),
        )
        manager.start()

        with mock.patch.object(app_module, "handle_video_gen", return_value=(200, {"taskId": "v1"})), \
                mock.patch.object(app_module, "_await_internal_task", return_value=b"RAW"), \
                mock.patch.object(app_module, "lock_video_colors", return_value=b"LOCKED"), \
                mock.patch.object(app_module, "handle_interpolate", return_value=(200, {"taskId": "i1"})), \
                mock.patch.object(app_module, "handle_upscale", return_value=(200, {"taskId": "u1"})):
            task = manager.submit(
                "wallpaper-batch",
                {"units": [{"title": "立绘 A", "imageDataUrl": "data:image/png;base64,AA"},
                           {"title": "立绘 B", "imageDataUrl": "data:image/png;base64,BB"}]},
                pool=task_queue.POOL_WALLPAPER,
                steps=[{"title": "立绘 A"}, {"title": "立绘 B"}],
            )
            done = manager.wait(task["id"], timeout=15)

        self.assertEqual(done["status"], "done", done.get("error"))
        self.assertEqual(done["done"], 2)
        for index in (0, 1):
            path, ext = manager.result_file(task["id"], index)
            self.assertEqual(ext, "mp4")
            self.assertEqual(Path(path).read_bytes(), b"RAW" if index == 0 else b"RAW")

    def test_batch_accepts_frontend_steps_key(self):
        """前端把每张图的参数放在 steps 里，执行器必须认（曾经只读 units 导致秒完成 0/0）。"""
        manager = TaskManager(
            db_path=self.db_path, storage_dir=self.storage,
            runners={}, auto_start=False,
        )
        self.addCleanup(manager.stop)
        manager.register(
            task_queue.TASK_WALLPAPER_BATCH,
            lambda task, report: app_module._run_wallpaper_batch_task(task, report, environ={}),
        )
        manager.start()

        with mock.patch.object(app_module, "handle_video_gen", return_value=(200, {"taskId": "v1"})), \
                mock.patch.object(app_module, "_await_internal_task", return_value=b"RAW"), \
                mock.patch.object(app_module, "lock_video_colors", return_value=b"LOCKED"), \
                mock.patch.object(app_module, "handle_interpolate", return_value=(200, {"taskId": "i1"})), \
                mock.patch.object(app_module, "handle_upscale", return_value=(200, {"taskId": "u1"})):
            task = manager.submit(
                "wallpaper-batch",
                {"steps": [{"title": "立绘 A", "imageDataUrl": "data:image/png;base64,AA"}]},
                pool=task_queue.POOL_WALLPAPER,
                steps=[{"title": "立绘 A"}],
            )
            done = manager.wait(task["id"], timeout=15)

        self.assertEqual(done["status"], "done", done.get("error"))
        self.assertEqual(done["done"], 1)

    def test_batch_without_units_fails_instead_of_done(self):
        manager = TaskManager(
            db_path=self.db_path, storage_dir=self.storage,
            runners={}, auto_start=False,
        )
        self.addCleanup(manager.stop)
        manager.register(
            task_queue.TASK_WALLPAPER_BATCH,
            lambda task, report: app_module._run_wallpaper_batch_task(task, report, environ={}),
        )
        manager.start()

        task = manager.submit(
            "wallpaper-batch",
            {},
            pool=task_queue.POOL_WALLPAPER,
            steps=[{"title": "立绘 A"}, {"title": "立绘 B"}],
        )
        done = manager.wait(task["id"], timeout=15)

        self.assertEqual(done["status"], "failed")
        self.assertEqual([step["status"] for step in done["steps"]], ["failed", "failed"])
        self.assertEqual(done["failed"], 2)
        self.assertEqual(done["done"], 0)
        self.assertIn("没有可处理的图片", done.get("error") or "")


if __name__ == "__main__":
    unittest.main()
