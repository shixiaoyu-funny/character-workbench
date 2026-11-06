# 任务队列基础设施：两个单线程池 + 两个阻塞队列（各上限 64）。
#
# 整体并行：池 "main"（动态壁纸以外）与池 "wallpaper"（动态壁纸）各有一条常驻
# worker 线程，互不阻塞。
# 局部串行：每个池只有一条 worker 线程，任务与任务之间串行，任务内部的各个 step
# 也串行执行（生图一张一张出，壁纸一步接一步跑）。
#
# 任务执行方在服务端，所以浏览器关标签页不会打断任务；进度靠前端轮询
# GET /api/tasks/<id> 拉取，不需要心跳，也没有「已中断」这种半吊子状态。

from __future__ import annotations

import json
import queue
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

# 直接运行 python server/app.py 时（脚本模式），server 不在包路径里；
# 用 from server import ... 导入时（unittest），走包内相对导入。
if __package__ in (None, ""):
    import db as task_db
else:
    from . import db as task_db

# 每个池的阻塞队列上限。满了直接 503，不排队假装接收。
QUEUE_MAX = 64

POOL_MAIN = "main"
POOL_WALLPAPER = "wallpaper"
POOLS = (POOL_MAIN, POOL_WALLPAPER)

# 任务种类（等于 runner 注册键，不等于界面上的任务名；界面名走 title）。
TASK_IMAGE = "image"
TASK_WALLPAPER_BATCH = "wallpaper-batch"
TASK_WALLPAPER_EXPORT = "wallpaper-export"

STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_DONE = "done"
STATUS_PARTIAL = "partial"
STATUS_FAILED = "failed"
STATUS_SKIPPED = "skipped"
STATUS_CANCELLED = "cancelled"
TERMINAL_STATUSES = frozenset(
    {STATUS_DONE, STATUS_PARTIAL, STATUS_FAILED, STATUS_CANCELLED}
)


class TaskQueueFull(Exception):
    """池的阻塞队列已满（64 个待执行任务）。"""

    def __init__(self, pool: str, limit: int = QUEUE_MAX):
        super().__init__(f"队列已满（{pool} 最多 {limit} 个等待中的任务）")
        self.pool = pool
        self.limit = limit


class TaskCancelled(Exception):
    """取消信号：runner 内部主动抛出，worker 统一收成 cancelled 状态。"""


def _now() -> str:
    # 毫秒精度：同一秒内连提的批量任务也要能稳定排出「最新在前」。
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def default_storage_dir() -> Path:
    return Path(task_db.default_db_path()).parent / "tasks"


def _public(task: dict) -> dict:
    """剥掉下划线开头的内部字段，并算好 0~100 的整体进度。"""
    out = {key: value for key, value in task.items() if not key.startswith("_")}
    total = out.get("total") or 0
    done = out.get("done") or 0
    failed = out.get("failed") or 0
    skipped = out.get("skipped") or 0
    fraction = out.get("fraction") or 0.0
    if total > 0:
        processed = done + failed + skipped + (min(100.0, max(0.0, fraction)) / 100.0)
        out["progress"] = max(0.0, min(100.0, processed / total * 100.0))
    else:
        out["progress"] = 100.0 if out.get("status") in TERMINAL_STATUSES else 0.0
    return out


class TaskReporter:
    """runner 拿到的句柄：报进度、报 step、落结果文件、注册取消钩子。"""

    def __init__(self, manager: "TaskManager", task: dict):
        self._manager = manager
        self._task = task

    # ---- 读 ----

    def payload(self) -> dict:
        return self._manager.payload(self._task)

    @property
    def task_id(self) -> str:
        return self._task["id"]

    def cancelled(self) -> bool:
        return bool(self._task.get("_cancel"))

    # ---- 写 ----

    def message(self, text: str) -> None:
        self._manager.set_message(self._task, text)

    def set_fraction(self, pct: float) -> None:
        self._manager.set_fraction(self._task, pct)

    def step(self, index: int, *, status=None, error=None, url=None,
             record_id=None, message=None, title=None) -> None:
        self._manager.update_step(
            self._task, index, status=status, error=error, url=url,
            record_id=record_id, message=message, title=title,
        )

    def write_result(self, index: int, data: bytes, ext: str = "mp4") -> str:
        return self._manager.write_result(self._task, index, data, ext)

    def on_cancel(self, hook) -> None:
        self._manager.add_cancel_hook(self._task, hook)


class TaskManager:
    """两个阻塞队列 + 两个单线程 worker。任务状态落 SQLite，刷新页面也看得到。"""

    def __init__(self, *, runners=None, db_path=None, storage_dir=None,
                 log=None, auto_start: bool = True):
        self.db_path = db_path
        self.storage_dir = Path(storage_dir or default_storage_dir())
        self.log = log or (lambda message: None)
        self._runners = dict(runners or {})
        self._queues = {pool: queue.Queue(maxsize=QUEUE_MAX) for pool in POOLS}
        self._tasks: dict[str, dict] = {}
        self._lock = threading.RLock()
        self._workers: dict[str, threading.Thread] = {}
        self._stopping = False
        if auto_start:
            self.start()

    # ---------------- 生命周期 ----------------

    def start(self) -> None:
        for pool in POOLS:
            if pool in self._workers and self._workers[pool].is_alive():
                continue
            thread = threading.Thread(
                target=self._worker, args=(pool,),
                name=f"task-worker-{pool}", daemon=True,
            )
            self._workers[pool] = thread
            thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        self._stopping = True
        for pool in POOLS:
            try:
                self._queues[pool].put_nowait(None)
            except queue.Full:
                pass
        for thread in self._workers.values():
            if thread.is_alive():
                thread.join(timeout=timeout)
        self._workers.clear()

    def register(self, kind: str, runner) -> None:
        """runner(task, reporter) 由 worker 调用。"""
        self._runners[kind] = runner

    def recover_interrupted(self) -> int:
        """服务重启：上次没跑完的任务标记为失败，避免界面上永远挂着「进行中」。"""
        try:
            return task_db.mark_interrupted_tasks(self.db_path)
        except Exception as exc:  # noqa: BLE001
            self.log(f"[任务] 中断任务修复失败：{exc}")
            return 0

    # ---------------- 提交与查询 ----------------

    def submit(self, kind: str, payload=None, *, pool=POOL_MAIN, title=None,
               unit=None, total=None, steps=None) -> dict:
        if pool not in self._queues:
            raise ValueError(f"未知的池：{pool}")
        q = self._queues[pool]
        if q.full():
            raise TaskQueueFull(pool)

        payload = payload or {}
        task_id = uuid.uuid4().hex[:12]
        task_dir = self.storage_dir / task_id
        task_dir.mkdir(parents=True, exist_ok=True)
        payload_path = task_dir / "payload.json"
        payload_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

        step_list = list(steps or payload.get("steps") or payload.get("units") or [])
        step_meta = [
            {
                "index": index,
                "kind": entry.get("kind") or kind,
                "title": entry.get("title") or entry.get("name") or f"第 {index + 1} 项",
                "status": "pending",
                "error": "",
                "url": None,
                "message": "",
            }
            for index, entry in enumerate(step_list)
        ]
        task = {
            "id": task_id,
            "pool": pool,
            "kind": kind,
            "title": title or kind,
            "status": STATUS_QUEUED,
            "total": max(0, int(total if total is not None else len(step_meta))),
            "done": 0,
            "failed": 0,
            "skipped": 0,
            "unit": unit or "项",
            "fraction": 0.0,
            "error": "",
            "message": "排队中",
            "steps": step_meta,
            "results": [],
            "created_at": _now(),
            "started_at": None,
            "finished_at": None,
            "_counted": set(),
            "_cancel": False,
            "_cancel_hooks": [],
            "_payload": None,
            "_payload_path": str(payload_path),
            "_dir": str(task_dir),
            "_persist_at": 0.0,
        }
        with self._lock:
            self._tasks[task_id] = task
        self._persist(task, force=True)
        try:
            q.put_nowait(task)
        except queue.Full:
            with self._lock:
                self._tasks.pop(task_id, None)
            self._discard_task_dir(task)
            raise TaskQueueFull(pool) from None
        self.log(f"[任务] 入队 {task_id} pool={pool} kind={kind} 共 {task['total']} {task['unit']} | {task['title']}")
        return _public(task)

    def get(self, task_id: str):
        with self._lock:
            task = self._tasks.get(task_id)
            if task is not None:
                return _public(task)
        record = task_db.load_task(self.db_path, task_id)
        if not record:
            return None
        record["progress"] = _public(record)["progress"]
        return record

    def list_tasks(self, *, pool=None, limit: int = 200):
        by_id = {}
        for record in task_db.load_tasks(self.db_path, limit=limit, pool=pool):
            by_id[record["id"]] = record
        with self._lock:
            for task in self._tasks.values():
                if pool and task.get("pool") != pool:
                    continue
                by_id[task["id"]] = _public(task)
        ordered = sorted(by_id.values(), key=lambda item: item.get("created_at") or "", reverse=True)
        return ordered[:limit]

    def pending_count(self, pool: str) -> int:
        return self._queues[pool].qsize()

    def wait(self, task_id: str, timeout: float = 10.0, interval: float = 0.02):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            task = self.get(task_id)
            if task and task.get("status") in TERMINAL_STATUSES:
                return task
            time.sleep(interval)
        return self.get(task_id)

    # ---------------- 取消 / 删除 ----------------

    def cancel(self, task_id: str):
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                record = task_db.load_task(self.db_path, task_id)
                return record
            if task["status"] in TERMINAL_STATUSES:
                return _public(task)
            task["_cancel"] = True
            task["message"] = "正在取消…"
            hooks = list(task.get("_cancel_hooks") or [])
        for hook in hooks:
            try:
                hook()
            except Exception as exc:  # noqa: BLE001
                self.log(f"[任务] {task_id} 取消钩子失败：{exc}")
        if task["status"] == STATUS_QUEUED:
            # 还在排队：worker 取到后会立刻跳过，这里先把状态改掉让界面马上有反馈。
            with self._lock:
                task["status"] = STATUS_CANCELLED
                task["finished_at"] = _now()
                task["message"] = "已取消"
                self._persist(task, force=True)
            self.log(f"[任务] {task_id} 排队中取消")
        self._persist(task, force=True)
        return _public(task)

    def delete(self, task_id: str):
        with self._lock:
            task = self._tasks.pop(task_id, None)
        if task is not None and task["status"] == STATUS_RUNNING:
            with self._lock:
                self._tasks[task_id] = task
            raise RuntimeError("任务正在执行，先取消再删除")
        task_db.delete_task(self.db_path, task_id)
        if task is not None:
            self._discard_task_dir(task)
        else:
            self._discard_task_dir({"id": task_id})
        return True

    def result_file(self, task_id: str, index: int):
        with self._lock:
            task = self._tasks.get(task_id)
            results = list(task.get("results") or []) if task else []
        if not results:
            record = task_db.load_task(self.db_path, task_id)
            results = list((record or {}).get("results") or [])
        for entry in results:
            if int(entry.get("index", -1)) == int(index) and entry.get("file"):
                path = Path(entry["file"])
                if path.is_file():
                    return path, entry.get("ext") or "mp4"
        return None, None

    # ---------------- runner 用的写入接口 ----------------

    def payload(self, task: dict) -> dict:
        cached = task.get("_payload")
        if cached is not None:
            return cached
        path = Path(task["_payload_path"])
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            data = {}
        task["_payload"] = data
        return data

    def payload_of(self, task_id: str):
        """按 id 取提交时的原始载荷（重试失败项用），磁盘上没有就返回 None。"""
        with self._lock:
            task = self._tasks.get(task_id)
            if task is not None:
                return self.payload(task)
        path = Path(self.storage_dir) / str(task_id) / "payload.json"
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            return None

    def set_message(self, task: dict, text: str) -> None:
        with self._lock:
            task["message"] = text
        self._persist(task)

    def set_fraction(self, task: dict, pct: float) -> None:
        with self._lock:
            task["fraction"] = max(0.0, min(100.0, float(pct)))
        self._persist(task)

    def update_step(self, task: dict, index: int, *, status=None, error=None,
                    url=None, record_id=None, message=None, title=None) -> None:
        with self._lock:
            steps = task.get("steps") or []
            if index < 0 or index >= len(steps):
                return
            entry = steps[index]
            if title:
                entry["title"] = title
            if message is not None:
                entry["message"] = message
            if url:
                entry["url"] = url
            if record_id is not None:
                entry["recordId"] = record_id
            if error is not None:
                entry["error"] = error
            if status and entry.get("status") != status:
                entry["status"] = status
                counted = task["_counted"]
                if status == STATUS_DONE and index not in counted:
                    counted.add(index)
                    task["done"] += 1
                elif status == STATUS_FAILED and index not in counted:
                    counted.add(index)
                    task["failed"] += 1
                elif status == STATUS_SKIPPED and index not in counted:
                    counted.add(index)
                    task["skipped"] += 1
                task["fraction"] = 0.0
        self._persist(task, force=status is not None)

    def write_result(self, task: dict, index: int, data: bytes, ext: str = "mp4") -> str:
        directory = Path(task["_dir"])
        directory.mkdir(parents=True, exist_ok=True)
        filename = f"result-{index}.{ext}"
        path = directory / filename
        path.write_bytes(data)
        with self._lock:
            results = [entry for entry in (task.get("results") or [])
                       if int(entry.get("index", -1)) != int(index)]
            results.append({"index": index, "file": str(path), "ext": ext})
            task["results"] = sorted(results, key=lambda entry: entry["index"])
        self._persist(task, force=True)
        return filename

    def add_cancel_hook(self, task: dict, hook) -> None:
        with self._lock:
            task.setdefault("_cancel_hooks", []).append(hook)

    # ---------------- worker ----------------

    def _worker(self, pool: str) -> None:
        q = self._queues[pool]
        while True:
            task = q.get()
            if task is None:
                q.task_done()
                return
            try:
                self._run_one(task)
            except Exception as exc:  # noqa: BLE001
                self.log(f"[任务] worker({pool}) 异常：{exc}")
            finally:
                q.task_done()

    def _run_one(self, task: dict) -> None:
        task_id = task["id"]
        if task.get("_cancel"):
            with self._lock:
                task["status"] = STATUS_CANCELLED
                task["finished_at"] = _now()
                task["message"] = "已取消"
                # 终态与落库必须在同一把锁里：否则 wait() 可能先看到内存里的 done，
                # 另一个进程/管理器重开时却从 DB 读到 running（测试里偶发复现过）。
                self._persist(task, force=True)
            return

        runner = self._runners.get(task["kind"])
        with self._lock:
            task["status"] = STATUS_RUNNING
            task["started_at"] = _now()
            task["message"] = "开始执行"
        self._persist(task, force=True)
        self.log(f"[任务] 开始 {task_id} pool={task['pool']} | {task['title']}")

        reporter = TaskReporter(self, task)
        error = ""
        cancelled = False
        try:
            if runner is None:
                raise RuntimeError(f"没有为 {task['kind']} 注册执行器")
            runner(task, reporter)
        except TaskCancelled:
            cancelled = True
        except Exception as exc:  # noqa: BLE001
            error = str(exc) or exc.__class__.__name__
        finally:
            with self._lock:
                if task.get("_cancel"):
                    cancelled = True
                counted = task["_counted"]
                for index, entry in enumerate(task.get("steps") or []):
                    if entry.get("status") in ("pending", "running"):
                        # 没跑到的 step 不算失败，只是取消
                        if cancelled:
                            entry["status"] = "cancelled"
                            continue
                        entry["status"] = "failed"
                        if not entry.get("error") and error:
                            entry["error"] = error
                        # 执行器提前退出时也要计数，否则界面会显示「失败 0 / 共 N」。
                        if index not in counted:
                            counted.add(index)
                            task["failed"] += 1
                if cancelled:
                    task["status"] = STATUS_CANCELLED
                    task["message"] = "已取消"
                elif error and task["done"]:
                    # 有成功也有失败：黄色「部分完成」就够，别把整份任务标成失败。
                    task["status"] = STATUS_PARTIAL
                    task["error"] = error
                    task["message"] = f"部分完成：{task['done']} 成功 / {task['failed']} 失败（{error}）"
                elif error:
                    task["status"] = STATUS_FAILED
                    task["error"] = error
                    task["message"] = f"失败：{error}"
                elif task["failed"] and task["done"]:
                    task["status"] = STATUS_PARTIAL
                    task["message"] = f"部分完成：{task['done']} 成功 / {task['failed']} 失败"
                elif task["failed"] and not task["done"]:
                    task["status"] = STATUS_FAILED
                    task["message"] = f"全部失败（{task['failed']}）"
                elif task["skipped"]:
                    task["status"] = STATUS_PARTIAL
                    task["message"] = f"部分完成：跳过 {task['skipped']} 项（上游未出图）"
                elif int(task.get("total") or 0) > 0 and not (task["done"] or task["failed"] or task["skipped"]):
                    # 执行器什么都没干就退出了：绝不能报「已完成」。
                    error = error or "执行器没有处理任何子项（载荷为空）"
                    task["status"] = STATUS_FAILED
                    task["error"] = error
                    task["message"] = f"失败：{error}"
                else:
                    task["status"] = STATUS_DONE
                    task["message"] = "已完成"
                if task["status"] != STATUS_DONE:
                    task["error"] = task.get("error") or error
                task["fraction"] = 0.0
                task["finished_at"] = _now()
                task["_cancel_hooks"] = []
                # 终态与落库同锁：wait() 一看到 done 就必须能从 DB 读到 done。
                self._persist(task, force=True)
            self.log(
                f"[任务] 结束 {task_id} status={task['status']} "
                f"成功={task['done']} 失败={task['failed']} 跳过={task.get('skipped', 0)} 共={task['total']}"
                + (f" 错误={error}" if error else "")
            )

    # ---------------- 持久化 ----------------

    def _persist(self, task: dict, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - (task.get("_persist_at") or 0.0) < 1.0:
            return
        task["_persist_at"] = now
        try:
            task_db.save_task(self.db_path, _public(task))
        except Exception as exc:  # noqa: BLE001
            self.log(f"[任务] 落库失败 {task.get('id')}：{exc}")

    def _discard_task_dir(self, task: dict) -> None:
        directory = Path(str(self.storage_dir / str(task.get("id"))))
        try:
            if directory.is_dir():
                for child in directory.iterdir():
                    child.unlink()
                directory.rmdir()
        except Exception:  # noqa: BLE001
            pass
