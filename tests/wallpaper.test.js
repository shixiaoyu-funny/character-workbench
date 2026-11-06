import assert from 'node:assert/strict';
import test from 'node:test';

import { applyGrading, defaultGradingParams, GRADING_PARAMS } from '../src/colorGrade.js';
import { WALLPAPER_PLATFORMS, cropForFocus, focusDeltaFromDrag, focusDeltaFromEditorDrag, containRect, normalizeCrop, scaleCrop, loopDurationFor } from '../src/wallpaper.js';

function frame(w, h, fill = [128, 128, 128, 255]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = fill[3];
  }
  return { data, width: w, height: h };
}

test('grading defaults leave pixels unchanged', () => {
  const src = frame(2, 2, [200, 100, 50, 255]);
  const out = applyGrading(src, defaultGradingParams());
  assert.deepEqual([...out.data], [...src.data]);
});

test('brightness shifts all channels within bounds', () => {
  const src = frame(1, 1, [100, 100, 100, 255]);
  const out = applyGrading(src, { brightness: 100 }); // +60
  assert.equal(out.data[0], 160);
  assert.equal(out.data[1], 160);
  assert.equal(out.data[2], 160);
  // 负向
  const dim = applyGrading(src, { brightness: -100 });
  assert.equal(dim.data[0], 40);
});

test('saturation -100 collapses to luma (grayscale)', () => {
  const src = frame(1, 1, [200, 100, 50, 255]);
  const out = applyGrading(src, { saturation: -100 });
  assert.equal(out.data[0], out.data[1]);
  assert.equal(out.data[1], out.data[2]);
});

test('temperature warms and cools around the blue/red axes', () => {
  const src = frame(1, 1, [128, 128, 128, 255]);
  const warm = applyGrading(src, { temperature: 100 });
  assert.ok(warm.data[0] > 128, 'warm raises red');
  assert.ok(warm.data[2] < 128, 'warm lowers blue');
  const cool = applyGrading(src, { temperature: -100 });
  assert.ok(cool.data[0] < 128, 'cool lowers red');
  assert.ok(cool.data[2] > 128, 'cool raises blue');
});

test('clamps out-of-range values to 0..255', () => {
  const src = frame(1, 1, [250, 250, 250, 255]);
  const out = applyGrading(src, { brightness: 100, contrast: 100 });
  for (let i = 0; i < 4; i++) assert.ok(out.data[i] >= 0 && out.data[i] <= 255);
});

test('sharpen and clarity keep the frame size and alpha intact', () => {
  const src = frame(8, 8, [90, 120, 160, 255]);
  const out = applyGrading(src, { sharpen: 50, clarity: 30 });
  assert.equal(out.width, 8);
  assert.equal(out.height, 8);
  assert.equal(out.data[3], 255, 'alpha preserved');
});

test('every grading param is defined and normalizes to a number', () => {
  for (const { id } of GRADING_PARAMS) {
    assert.ok(id in defaultGradingParams(), `${id} present in defaults`);
  }
});

test('cropForFocus covers the source with the requested ratio', () => {
  // 源图 2000x1000（2:1），目标 16:9 → 裁高到 1000*9/16=562.5 宽 1125
  const crop = cropForFocus(2000, 1000, 16 / 9, 0.5, 0.5);
  assert.equal(crop.sh, 1000);
  assert.ok(Math.abs(crop.sw / crop.sh - 16 / 9) < 1e-6);
  // 焦点居中
  assert.ok(Math.abs((crop.sx + crop.sw / 2) - 1000) < 1e-6);
});

test('cropForFocus shifts with focus within bounds', () => {
  const left = cropForFocus(2000, 1000, 1, 0, 0.5);
  const right = cropForFocus(2000, 1000, 1, 1, 0.5);
  assert.ok(left.sx < right.sx);
  assert.ok(left.sx >= 0 && right.sx + right.sw <= 2000 + 1e-6);
});

test('all four platforms export at 4K and match their aspect ratio', () => {
  assert.equal(WALLPAPER_PLATFORMS.length, 4);
  const ratios = new Set(WALLPAPER_PLATFORMS.map((p) => p.ratio));
  assert.equal(ratios.size, 4);
  for (const p of WALLPAPER_PLATFORMS) {
    assert.ok(p.exportWidth > 0 && p.exportHeight > 0, p.id);
    // 4K 意味着短边不低于 2160（1080P 的 2 倍）、长边不低于 3840。
    assert.ok(Math.min(p.exportWidth, p.exportHeight) >= 2160, `${p.id} short side is below 4K`);
    assert.ok(Math.max(p.exportWidth, p.exportHeight) >= 3840, `${p.id} long edge is below 3840`);
    // 导出画幅必须与平台比例一致，否则后端 crop 出来的画面会被拉变形。
    assert.ok(Math.abs(p.exportWidth / p.exportHeight - p.ratio) < 0.005, `${p.id} aspect drift`);
    // x264 的 yuv420p 要求偶数宽高。
    assert.equal(p.exportWidth % 2, 0, p.id);
    assert.equal(p.exportHeight % 2, 0, p.id);
  }
  const byId = Object.fromEntries(WALLPAPER_PLATFORMS.map((p) => [p.id, p]));
  assert.deepEqual([byId.pc.exportWidth, byId.pc.exportHeight], [3840, 2160]);
  assert.deepEqual([byId.phone.exportWidth, byId.phone.exportHeight], [2160, 4800]);
  assert.deepEqual([byId.tablet.exportWidth, byId.tablet.exportHeight], [3840, 2400]);
  assert.deepEqual([byId.ipad.exportWidth, byId.ipad.exportHeight], [3840, 2880]);
});

test('focusDeltaFromDrag maps preview pixels to focus deltas', () => {
  const crop = cropForFocus(2000, 1000, 1, 0.5, 0.5);
  const { dfx, dfy } = focusDeltaFromDrag(50, 0, 500, 500, crop, 2000, 1000);
  // crop.sw = 1000（1:1），rangeX = 1000；dfx = 50*1000/500/1000 = 0.1
  assert.ok(Math.abs(dfx - 0.1) < 1e-9);
  assert.equal(dfy, 0);
});

test('focusDeltaFromEditorDrag maps full-image drags to focus deltas', () => {
  // 源 2000x2000（方形）在编辑画布 405x405 内 contain。
  // 裁剪框按 16:9：裁高到 1125，rangeX=0（钳到1），rangeY=875。
  const crop = cropForFocus(2000, 2000, 16 / 9, 0.5, 0.5);
  const { dfx, dfy } = focusDeltaFromEditorDrag(0, 100, 405, 405, crop, 2000, 2000);
  assert.equal(dfx, 0);
  assert.ok(Math.abs(dfy - (100 * 2000 / 405 / 875)) < 1e-9);
  assert.ok(dfy > 0);
});

test('containRect fits and centers the source within the canvas', () => {
  // 2000x1000 放进 720x405：scale=min(720/2000,405/1000)=0.36，w=720,h=360，垂直居中 y=22.5
  const rect = containRect(2000, 1000, 720, 405);
  assert.ok(Math.abs(rect.w - 720) < 1e-9);
  assert.ok(Math.abs(rect.h - 360) < 1e-9);
  assert.ok(Math.abs(rect.x) < 1e-9);
  assert.ok(Math.abs(rect.y - 22.5) < 1e-9);
});

test('normalizeCrop / scaleCrop move a crop between 720P and 4K sources', () => {
  const crop = cropForFocus(1280, 720, 9 / 20, 0.3, 0.7);
  const norm = normalizeCrop(crop, 1280, 720);
  assert.ok(Math.abs(norm.sw - crop.sw / 1280) < 1e-9);
  const scaled = scaleCrop(norm, 3840, 2160);
  // 同一套比例换到 3 倍尺寸上，裁剪框也正好放大 3 倍：预览框住的区域就是导出裁下的区域。
  assert.ok(Math.abs(scaled.sx - crop.sx * 3) < 1e-6);
  assert.ok(Math.abs(scaled.sy - crop.sy * 3) < 1e-6);
  assert.ok(Math.abs(scaled.sw - crop.sw * 3) < 1e-6);
  assert.ok(Math.abs(scaled.sh - crop.sh * 3) < 1e-6);
});

test('normalizeCrop survives a degenerate zero-sized source', () => {
  const norm = normalizeCrop({ sx: 0, sy: 0, sw: 0, sh: 0 }, 0, 0);
  assert.equal(Number.isFinite(norm.sw), true);
  assert.equal(Number.isFinite(norm.sh), true);
});

test('loop length follows the video, and only falls back for stills', () => {
  const video = { kind: 'video', el: { duration: 5.983 } };
  assert.equal(loopDurationFor(video, 4), 5.983);
  // 视频还没拿到 metadata（duration 是 NaN）时用回退值，别把整段设成 NaN。
  assert.equal(loopDurationFor({ kind: 'video', el: { duration: NaN } }, 4), 4);
  assert.equal(loopDurationFor({ kind: 'video', el: { duration: 0 } }, 4), 4);
  assert.equal(loopDurationFor({ kind: 'image', el: {} }, 4), 4);
  assert.equal(loopDurationFor(null, 4), 4);
});
