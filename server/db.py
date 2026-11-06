"""本地 SQLite：图片 URL/元数据 + 任务队列记录，供跨会话找回。"""

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "gallery.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  kind TEXT,
  aspect TEXT,
  seed INTEGER,
  positive TEXT,
  negative TEXT,
  batch_id TEXT,
  base_url TEXT,
  base_seed INTEGER,
  state TEXT,
  created_at TEXT NOT NULL
);
"""

# 任务队列：steps/results 只存界面需要的轻量元数据（标题、状态、产物路径），
# 提示词与参考图这类大块内容落在 data/tasks/<id>/payload.json 里，不进库。
_TASKS_SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  pool TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  unit TEXT,
  progress REAL NOT NULL DEFAULT 0,
  error TEXT,
  message TEXT,
  steps TEXT,
  results TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
"""


def default_db_path():
    return DEFAULT_DB


def connect(db_path):
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def _json_state(value):
    """把角色配置序列化成 JSON 文本；已是字符串或空值则原样返回。"""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return None


def init_db(db_path=None):
    path = db_path or default_db_path()
    conn = connect(path)
    try:
        conn.execute(_SCHEMA)
        conn.execute(_TASKS_SCHEMA)
        # 已有库是用旧表建的：CREATE TABLE IF NOT EXISTS 不会补列。生成时间靠 created_at。
        columns = {row[1] for row in conn.execute("PRAGMA table_info(images)")}
        if "created_at" not in columns:
            conn.execute("ALTER TABLE images ADD COLUMN created_at TEXT")
        if "state" not in columns:
            conn.execute("ALTER TABLE images ADD COLUMN state TEXT")
        task_columns = {row[1] for row in conn.execute("PRAGMA table_info(tasks)")}
        if task_columns and "skipped" not in task_columns:
            conn.execute("ALTER TABLE tasks ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0")
        conn.commit()
    finally:
        conn.close()
    return path


def insert_image(db_path, record):
    conn = connect(db_path)
    try:
        cur = conn.execute(
            "INSERT INTO images (url, kind, aspect, seed, positive, negative, "
            "batch_id, base_url, base_seed, state, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                record["url"],
                record.get("kind"),
                record.get("aspect"),
                record.get("seed"),
                record.get("positive"),
                record.get("negative"),
                record.get("batch_id"),
                record.get("base_url"),
                record.get("base_seed"),
                _json_state(record.get("state")),
                record["created_at"],
            ),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def delete_images(db_path, ids):
    if not ids:
        return 0
    conn = connect(db_path)
    try:
        marks = ",".join("?" * len(ids))
        cur = conn.execute(f"DELETE FROM images WHERE id IN ({marks})", tuple(ids))
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def list_images(db_path=None):
    path = db_path or default_db_path()
    if not Path(path).exists():
        return []
    conn = connect(path)
    try:
        rows = conn.execute("SELECT * FROM images ORDER BY id DESC").fetchall()
        out = []
        for row in rows:
            data = dict(row)
            if data.get("state"):
                try:
                    data["state"] = json.loads(data["state"])
                except (TypeError, ValueError):
                    data["state"] = None
            out.append(data)
        return out
    finally:
        conn.close()


def known_urls(db_path=None):
    """图库里出现过的图片地址。打包时代理只允许拉这些，避免变成开放代理。"""
    urls = set()
    for row in list_images(db_path):
        if row.get("url"):
            urls.add(row["url"])
        if row.get("base_url"):
            urls.add(row["base_url"])
    return urls


# ---------------- 任务队列 ----------------

_TASK_COLUMNS = (
    "id", "pool", "kind", "title", "status", "total", "done", "failed", "skipped",
    "unit", "progress", "error", "message", "steps", "results", "created_at",
    "started_at", "finished_at",
)


def _task_row(record):
    return (
        record.get("id"),
        record.get("pool"),
        record.get("kind"),
        record.get("title"),
        record.get("status"),
        int(record.get("total") or 0),
        int(record.get("done") or 0),
        int(record.get("failed") or 0),
        int(record.get("skipped") or 0),
        record.get("unit"),
        float(record.get("progress") or 0.0),
        record.get("error") or "",
        record.get("message") or "",
        json.dumps(record.get("steps") or [], ensure_ascii=False),
        json.dumps(record.get("results") or [], ensure_ascii=False),
        record.get("created_at"),
        record.get("started_at"),
        record.get("finished_at"),
    )


def _task_dict(row):
    data = dict(row)
    for key in ("steps", "results"):
        try:
            data[key] = json.loads(data.get(key) or "[]")
        except (TypeError, ValueError):
            data[key] = []
    return data


def save_task(db_path, record):
    init_db(db_path)
    marks = ",".join("?" * len(_TASK_COLUMNS))
    columns = ",".join(_TASK_COLUMNS)
    conn = connect(db_path or default_db_path())
    try:
        conn.execute(f"INSERT OR REPLACE INTO tasks ({columns}) VALUES ({marks})", _task_row(record))
        conn.commit()
    finally:
        conn.close()


def load_task(db_path, task_id):
    path = db_path or default_db_path()
    if not Path(path).exists():
        return None
    conn = connect(path)
    try:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return _task_dict(row) if row else None
    finally:
        conn.close()


def load_tasks(db_path=None, limit=200, pool=None):
    path = db_path or default_db_path()
    if not Path(path).exists():
        return []
    conn = connect(path)
    try:
        if pool:
            rows = conn.execute(
                "SELECT * FROM tasks WHERE pool = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
                (pool, int(limit)),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM tasks ORDER BY created_at DESC, rowid DESC LIMIT ?",
                (int(limit),),
            ).fetchall()
        return [_task_dict(row) for row in rows]
    finally:
        conn.close()


def delete_task(db_path, task_id):
    init_db(db_path)
    conn = connect(db_path or default_db_path())
    try:
        cur = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def mark_interrupted_tasks(db_path=None):
    """服务重启后，把上次停在排队/执行中的任务收尾成失败，别让界面永远「进行中」。"""
    init_db(db_path)
    conn = connect(db_path or default_db_path())
    try:
        cur = conn.execute(
            "UPDATE tasks SET status = 'failed', message = '服务重启，任务中断', "
            "error = '服务重启，任务中断', finished_at = datetime('now') "
            "WHERE status IN ('queued', 'running')"
        )
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()

