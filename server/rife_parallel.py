#!/usr/bin/env python3
"""并行 RIFE 补帧：多线程各跑一条 CUDA stream，共享一份权重。

实测（RTX 4060 Laptop 8GB，1280x720，单对 73.9ms）：

| 并发路数 | ms/对 | 显存峰值 |
|---|---|---|
| 1 | 73.9 | 827MB |
| 2 | 58.0 | 1536MB |
| 3 | 51.2 | 2333MB |
| 4 | 49.3 | 2950MB |
| 6 | 53.1 | 4433MB |

结论：
  * 加速来自「多条 stream 同时喂 GPU」，因为单路的 GPU 利用率只有约 51%；
  * 4 路是拐点（1.5x），再往上显存和带宽收益递减；
  * 1080P 是另一回事：单对 175ms、3 路就会掉到 386ms/对（带宽打满），所以按像素数收窄上限；
  * 「把多对图打包成一次 forward」实测无效（batch=4 反而慢到 79ms/对），已放弃这条路。

切段规则（错了就会出现重复帧或丢帧）：第 k 对图只归一条 stream 所有，
它写出中间帧 f_000{2k+2} 和原始第 k+1 帧 f_000{2k+3}；首帧由第 0 对那条写出。
这样每个输出帧有且只有一个生产者，不需要重编号或拼接。

用法：
  python rife_parallel.py --input IN.mp4 --output OUT.mp4 --target-fps 60 --workers 4
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


MB = 1024 ** 2

# 一路 stream 的显存开销 ≈ 一张 720P 激活图集，按像素线性估。
WORKER_BASE_BYTES = 900 * MB
WORKER_BYTES_PER_PIXEL = 850
# 超过这个像素数（1080P 及以上）带宽先打满，多路只会互相拖慢。
BANDWIDTH_LIMIT_PIXELS = 1_200_000


# ---------------- 可单测的纯逻辑 ----------------

def passes_for_target(fps: float, target_fps: float) -> int:
    """RIFE 每次只把帧率翻倍；下一次翻倍会超过目标就停。"""
    passes = 0
    current = float(fps)
    while current * 2 <= float(target_fps) + 0.5:
        passes += 1
        current *= 2
    return passes


def split_pairs(total_pairs: int, workers: int) -> list[tuple[int, int]]:
    """把 total_pairs 对图切成 workers 段连续区间，尽量均匀（多的 1 对给前面的段）。

    区间左闭右开：段 (a, b) 需要 frames[a] ~ frames[b] 共 b-a+1 张图。
    """
    total = max(0, int(total_pairs))
    if total == 0:
        return []
    count = max(1, min(int(workers), total))
    base, extra = divmod(total, count)
    ranges = []
    start = 0
    for index in range(count):
        size = base + (1 if index < extra else 0)
        ranges.append((start, start + size))
        start += size
    return ranges


def output_index_for_pair(pair_index: int) -> tuple[int, int]:
    """第 k 对图产出的两个帧号（1-based；首帧是另外单独写的第 1 帧）。"""
    return pair_index * 2 + 2, pair_index * 2 + 3


def expected_frame_count(source_frames: int) -> int:
    """2x 补帧后的总帧数：首帧 + 每对图的 (中间帧 + 后一帧)。"""
    return 1 + 2 * max(0, source_frames - 1)


def estimate_worker_count(free_bytes, pixels: int, requested: int, cap: int = 6) -> int:
    """按空闲显存和分辨率决定真的开几路 stream。"""
    want = max(1, int(requested or 1))
    if pixels >= BANDWIDTH_LIMIT_PIXELS:
        want = min(want, 2)
    if not free_bytes or pixels <= 0:
        return 1
    per_worker = pixels * WORKER_BYTES_PER_PIXEL
    room = int(free_bytes) - WORKER_BASE_BYTES
    fit = 1 if room <= 0 else int(room // per_worker)
    return max(1, min(want, int(cap), max(1, fit)))


def _env_int(environ, name: str, default: int, low: int = 1, high: int = 16) -> int:
    env = os.environ if environ is None else environ
    try:
        value = int((env.get(name) or "").strip())
    except (TypeError, ValueError):
        return default
    return max(low, min(high, value))


def workers_from_env(environ=None) -> int:
    return _env_int(environ, "RIFE_WORKERS", 4, high=6)


def io_workers_from_env(environ=None) -> int:
    return _env_int(environ, "RIFE_IO_WORKERS", 6)


# ---------------- ffmpeg / 图像 IO ----------------

def _run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def probe(path: Path) -> dict:
    raw = subprocess.check_output(
        [
            "ffprobe", "-v", "error",
            "-show_entries",
            "format=duration:stream=codec_type,width,height,avg_frame_rate,r_frame_rate",
            "-of", "json", str(path),
        ],
        text=True,
    )
    data = json.loads(raw)
    video = next(s for s in data["streams"] if s.get("codec_type") == "video")
    rate = video.get("avg_frame_rate") or video["r_frame_rate"]
    num, den = rate.split("/")
    fps = float(num) / float(den) if float(den) else 30.0
    return {
        "width": int(video["width"]),
        "height": int(video["height"]),
        "fps": fps,
        "has_audio": any(s.get("codec_type") == "audio" for s in data["streams"]),
    }


def imread_unicode(path):
    """Windows 路径常带中文，cv2.imread 会返回 None，必须自己读字节再解码。"""
    import cv2
    import numpy as np

    data = np.fromfile(str(path), dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError(f"failed to read {path}")
    return img


def imwrite_unicode(path, bgr) -> None:
    import cv2

    ok, buf = cv2.imencode(".png", bgr)
    if not ok:
        raise RuntimeError("imencode failed")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    buf.tofile(str(path))


def extract_frames(video: Path, frames_dir: Path) -> list[Path]:
    if frames_dir.exists():
        shutil.rmtree(frames_dir)
    frames_dir.mkdir(parents=True, exist_ok=True)
    _run([
        "ffmpeg", "-y", "-v", "error", "-i", str(video),
        "-vsync", "0",
        str(frames_dir / "f_%06d.png"),
    ])
    return sorted(frames_dir.glob("f_*.png"))


def encode(frames_dir: Path, fps: float, out_mp4: Path, audio_src: Path | None) -> None:
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-framerate", str(fps),
        "-i", str(frames_dir / "f_%06d.png"),
    ]
    if audio_src is not None:
        cmd += ["-i", str(audio_src)]
    cmd += [
        "-c:v", "libx264", "-crf", "16", "-preset", "fast",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    ]
    if audio_src is not None:
        cmd += ["-c:a", "aac", "-b:a", "192k", "-shortest"]
    cmd.append(str(out_mp4))
    _run(cmd)


# ---------------- 单对推理 ----------------

def _to_tensor(bgr, torch, device, pad_h: int, pad_w: int):
    import cv2

    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    t = torch.from_numpy(rgb).permute(2, 0, 1).float().div_(255.0).unsqueeze(0)
    h, w = t.shape[2], t.shape[3]
    if pad_h != h or pad_w != w:
        t = torch.nn.functional.pad(t, (0, pad_w - w, 0, pad_h - h))
    return t.to(device)


def interpolate_pair(net, img0, img1, torch, device, scale: float, height: int, width: int):
    """一对相邻帧 -> 中间帧（BGR）。"""
    import cv2

    pad_h = ((height - 1) // 128 + 1) * 128
    pad_w = ((width - 1) // 128 + 1) * 128
    t0 = _to_tensor(img0, torch, device, pad_h, pad_w)
    t1 = _to_tensor(img1, torch, device, pad_h, pad_w)
    imgs = torch.cat((t0, t1), 1)
    scale_list = [16 / scale, 8 / scale, 4 / scale, 2 / scale, 1 / scale]
    with torch.inference_mode():
        _flow, _mask, merged = net(imgs, 0.5, scale_list)
        mid = merged[4][:, :, :height, :width].clamp(0, 1)
        out = (mid[0].permute(1, 2, 0).cpu().numpy() * 255.0).round().astype("uint8")
    return cv2.cvtColor(out, cv2.COLOR_RGB2BGR)


# ---------------- 单遍补帧（多 stream 并行） ----------------

def interpolate_pass(
    frame_paths: list[Path],
    out_dir: Path,
    net,
    torch,
    device,
    scale: float,
    workers: int,
    io_pool: ThreadPoolExecutor,
    log,
) -> tuple[list[Path], float]:
    """把每一对相邻帧之间插一帧，帧率翻倍。返回 (输出帧路径, 实际 scale)。"""
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    first = imread_unicode(frame_paths[0])
    height, width = first.shape[0], first.shape[1]
    io_pool.submit(imwrite_unicode, out_dir / "f_000001.png", first).result()

    total_pairs = len(frame_paths) - 1
    ranges = split_pairs(total_pairs, workers)
    errors: list[BaseException] = []
    done = [0]
    done_lock = threading.Lock()

    def run_segment(pair_from: int, pair_to: int) -> None:
        if errors:
            return
        if device.type == "cuda":
            # 每条线程一条独立 stream：默认 stream 会把不同线程的 kernel 串起来。
            torch.cuda.set_stream(torch.cuda.Stream())
        local_writes = []
        try:
            # 每段只预读 2 帧：解码和 GPU 推理重叠，又不会让某一段把 IO 池占满。
            paths = frame_paths[pair_from: pair_to + 1]
            lookahead: list = []
            cursor = [0]

            def submit_next() -> None:
                if cursor[0] < len(paths):
                    lookahead.append(io_pool.submit(imread_unicode, paths[cursor[0]]))
                    cursor[0] += 1

            submit_next()
            submit_next()
            prev = lookahead.pop(0).result()
            for offset in range(pair_to - pair_from):
                submit_next()
                cur = lookahead.pop(0).result()
                mid = interpolate_pair(net, prev, cur, torch, device, scale, height, width)
                mid_index, next_index = output_index_for_pair(pair_from + offset)
                local_writes.append(io_pool.submit(imwrite_unicode, out_dir / f"f_{mid_index:06d}.png", mid))
                local_writes.append(io_pool.submit(imwrite_unicode, out_dir / f"f_{next_index:06d}.png", cur))
                prev = cur
                with done_lock:
                    done[0] += 1
                    if done[0] % 20 == 0 or done[0] == total_pairs:
                        log(f"rife {done[0]}/{total_pairs} pairs workers={len(ranges)}")
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)
        finally:
            for future in local_writes:
                try:
                    future.result()
                except BaseException as exc:  # noqa: BLE001
                    errors.append(exc)

    threads = [
        threading.Thread(target=run_segment, args=(a, b), daemon=True)
        for a, b in ranges
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    if errors:
        raise errors[0]

    expected = expected_frame_count(len(frame_paths))
    out_paths = [out_dir / f"f_{index:06d}.png" for index in range(1, expected + 1)]
    if device.type == "cuda":
        torch.cuda.empty_cache()
    return out_paths, scale


def _is_oom(exc: BaseException) -> bool:
    return "out of memory" in str(exc).lower()


# ---------------- 主流程 ----------------

def resolve_scripts_dir(environ=None) -> Path | None:
    """找到 frame-interpolation-service 的 scripts 目录（复用它的模型与权重）。"""
    env = os.environ if environ is None else environ
    override = env.get("INTERPOLATE_SCRIPT")
    if override and os.path.isfile(override):
        return Path(override).resolve().parent
    home = env.get("USERPROFILE") or os.path.expanduser("~")
    candidate = Path(home) / ".cursor" / "skills" / "frame-interpolation-service" / "scripts"
    return candidate if (candidate / "rife_interp.py").is_file() else None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="RIFE 2x frame interpolation (multi-stream)")
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", default=None)
    ap.add_argument("--target-fps", type=float, default=60.0)
    ap.add_argument("--rife-scale", type=float, default=1.0)
    ap.add_argument("--work", default=None, help="ASCII 工作目录；默认用临时目录")
    ap.add_argument("--workers", type=int, default=None, help="并发 stream 数（默认 4）")
    ap.add_argument("--io-workers", type=int, default=None, help="PNG 解码/编码线程数")
    args = ap.parse_args(argv)

    log = lambda message: print(message, flush=True)  # noqa: E731

    scripts_dir = resolve_scripts_dir()
    if scripts_dir is None:
        print("ERROR: 未找到 frame-interpolation-service 的 scripts 目录", file=sys.stderr)
        return 2
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))

    import torch
    from rife_interp import load_rife  # noqa: E402

    # 多 stream 并发时关掉 cudnn 自动调优，避免各线程互相改 benchmark 状态。
    torch.backends.cudnn.benchmark = False

    src = Path(args.input).resolve()
    if not src.exists():
        raise FileNotFoundError(src)
    meta = probe(src)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    requested = args.workers or workers_from_env()
    io_workers = args.io_workers or io_workers_from_env()
    if device.type == "cuda":
        free_bytes, _total = torch.cuda.mem_get_info()
        workers = estimate_worker_count(free_bytes, meta["width"] * meta["height"], requested)
    else:
        workers = 1

    out = Path(args.output).resolve() if args.output else src.with_name(f"{src.stem}_interp.mp4")
    # 默认工作目录带随机后缀：多个任务同时跑不会互相踩掉 frames_in。
    work = Path(args.work) if args.work else Path(tempfile.mkdtemp(prefix="frame_interp_"))
    work.mkdir(parents=True, exist_ok=True)

    log(f"input={src} {meta['width']}x{meta['height']} @{meta['fps']:.3f}fps "
        f"workers={workers}/{requested} io={io_workers}")

    frames = extract_frames(src, work / "frames_in")
    if len(frames) < 2:
        raise RuntimeError("need at least 2 frames")

    fps = meta["fps"]
    passes = passes_for_target(fps, args.target_fps)
    if passes == 0:
        raise RuntimeError(
            f"source {fps:.2f}fps already reaches target {args.target_fps}. "
            "RIFE only doubles; it will not interpolate when the next step would overshoot."
        )

    net = load_rife(device)
    scale = args.rife_scale
    with ThreadPoolExecutor(max_workers=io_workers) as io_pool:
        for index in range(1, passes + 1):
            log(f"rife pass {index}: {fps:.3f} -> {fps * 2:.3f} frames={len(frames)}")
            out_dir = work / f"frames_rife{index}"
            while True:
                try:
                    frames, scale = interpolate_pass(
                        frames, out_dir, net, torch, device, scale, workers, io_pool, log,
                    )
                    break
                except BaseException as exc:  # noqa: BLE001
                    if device.type == "cuda":
                        torch.cuda.empty_cache()
                    if _is_oom(exc) and workers > 1:
                        workers = max(1, workers // 2)
                        log(f"显存不足，降到 workers={workers} 重试：{str(exc)[:120]}")
                        continue
                    if _is_oom(exc) and scale > 0.25:
                        scale = max(0.25, scale * 0.5)
                        log(f"显存不足，降到 scale={scale} 重试：{str(exc)[:120]}")
                        continue
                    raise
            fps *= 2
            log(f"pass {index} frames={len(frames)} scale={scale} workers={workers}")

    del net
    if device.type == "cuda":
        torch.cuda.empty_cache()
    encode(frames[0].parent, fps, out, src if meta["has_audio"] else None)
    log(f"done -> {out} @{fps:.3f}fps frames={len(frames)}")
    # 中间帧一堆 PNG（6 秒 720P 约 300MB+），出片后立刻清掉。
    if args.work is None:
        shutil.rmtree(work, ignore_errors=True)
    else:
        for leftover in work.glob("frames_*"):
            shutil.rmtree(leftover, ignore_errors=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
