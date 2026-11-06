# 进度条基础设施：后端所有「导入 / 导出 / 处理 / 生成」过程在控制台显示 0~100%。
#
# ConsoleProgress —— 同步过程（如单端导出、转码、色锁）直接用它往控制台画进度。
#   - stderr 是 TTY 时用 \r 覆写同一行画条；不是 TTY（管道/文件/IDE 终端）时退化成
#     「每 N% 打一行」的节流日志，避免刷屏。
#   - 多线程安全：内部锁串行化写屏；每条用一个短标签区分。
#
# TaskProgress —— 后台任务（补帧/超分/生视频/四端导出）用它把 0~100 写进任务字典，
#   状态接口直接返回给前端轮询，同时节流打到控制台。
from __future__ import annotations

import sys
import threading
import time


class ConsoleProgress:
    def __init__(self, label, total=100, width=24, stream=None, min_interval=0.15):
        self.label = label
        self.total = max(1, total)
        self.width = width
        self.stream = stream or sys.stderr
        self.min_interval = min_interval
        self._lock = threading.Lock()
        self._last_pct = -1
        self._last_print = 0.0
        self._tty = getattr(self.stream, "isatty", lambda: False)()

    def update(self, value, note=""):
        pct = max(0.0, min(100.0, value / self.total * 100.0))
        with self._lock:
            if int(pct) == self._last_pct:
                return
            now = time.time()
            if (not self._tty) and int(pct) != 100 and (now - self._last_print) < self.min_interval:
                return
            self._last_pct = int(pct)
            self._last_print = now
            if self._tty:
                self._draw_tty(pct, note)
            else:
                self._draw_line(pct, note)

    def _bar(self, pct):
        filled = int(round(self.width * pct / 100.0))
        return "█" * filled + "░" * (self.width - filled)

    def _draw_tty(self, pct, note):
        suffix = f" {note}" if note else ""
        self.stream.write(f"\r[{self.label}] {self._bar(pct)} {pct:5.1f}%{suffix}    ")
        self.stream.flush()

    def _draw_line(self, pct, note):
        suffix = f" | {note}" if note else ""
        self.stream.write(f"[{self.label}] {pct:5.1f}%{suffix}\n")
        self.stream.flush()

    def done(self, note=""):
        with self._lock:
            self._last_pct = -1
            if self._tty:
                self.stream.write(f"\r[{self.label}] {self._bar(100.0)} 100.0% {note}    \n")
            else:
                self.stream.write(f"[{self.label}] 100.0% {note}\n")
            self.stream.flush()


class TaskProgress:
    """把进度写进后台任务字典（供前端轮询）并节流打到控制台。

    store: 任务字典（dict[task_id] -> task dict）；lock: 该任务字典的锁。
    """

    def __init__(self, store, task_id, lock, label, total=100):
        self.store = store
        self.task_id = task_id
        self.lock = lock
        self.label = label
        self.total = max(1, total)
        self._console = ConsoleProgress(f"{label}:{task_id}", total=total, min_interval=0.5)

    def update(self, value, note=""):
        with self.lock:
            task = self.store.get(self.task_id)
            if task is not None:
                task["progress"] = max(0.0, min(100.0, value / self.total * 100.0))
        self._console.update(value, note)
