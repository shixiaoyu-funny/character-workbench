import assert from 'node:assert/strict';
import test from 'node:test';

import { avccToAnnexb, pickAvcLevel, readNalLengthSize } from '../src/exportVideo.js';

// 这几条护的是「导出后卡到爆炸」的两处根因：
// ① level 给低了编码器直接拒绝配置（1080p60 至少要 4.2，1920×1440@60 要 5.1）；
// ② 有的平台无视 avc.format=annexb，回的是长度前缀格式，不转成 Annex-B 后端会解出花屏。

test('pickAvcLevel follows the macroblock-rate table', () => {
  // 1080p60 = 120×68 宏块 × 60 ≈ 489600 → 4.2
  assert.equal(pickAvcLevel(1920, 1080, 60), '2a');
  // 864×1920@60 与 1080p60 宏块数相同，也应落在 4.2
  assert.equal(pickAvcLevel(864, 1920, 60), '2a');
  // 1920×1200@60 ≈ 540000 → 超出 4.2，要 5.0
  assert.equal(pickAvcLevel(1920, 1200, 60), '32');
  // 1920×1440@60 ≈ 648000 → 5.1
  assert.equal(pickAvcLevel(1920, 1440, 60), '33');
  // 720p30 很小，4.1 足够
  assert.equal(pickAvcLevel(1280, 720, 30), '29');
  // 4K 四端：3840×2160@60 卡在 5.2，3840×2880@60 与 2160×4800@60 要 6.0
  assert.equal(pickAvcLevel(3840, 2160, 60), '34');
  assert.equal(pickAvcLevel(3840, 2400, 60), '3c');
  assert.equal(pickAvcLevel(3840, 2880, 60), '3c');
  assert.equal(pickAvcLevel(2160, 4800, 60), '3c');
});

test('readNalLengthSize reads lengthSizeMinusOne from avcC', () => {
  const description = new Uint8Array([1, 0x64, 0x00, 0x2a, 0xff, 0xe1]);
  assert.equal(readNalLengthSize(description), 4);
  const twoByte = new Uint8Array([1, 0x64, 0x00, 0x2a, 0xfd, 0xe1]);
  assert.equal(readNalLengthSize(twoByte), 2);
  // 拿不到 description 时按最常见的 4 字节算
  assert.equal(readNalLengthSize(null), 4);
});

test('avccToAnnexb rewrites length prefixes into start codes', () => {
  // 两个 NAL：4 字节长度前缀 + 3 字节数据
  const avcc = new Uint8Array([
    0, 0, 0, 3, 0x67, 0x11, 0x22,
    0, 0, 0, 2, 0x68, 0x33,
  ]);
  const annexb = avccToAnnexb(avcc, 4);
  assert.deepEqual(Array.from(annexb), [
    0, 0, 0, 1, 0x67, 0x11, 0x22,
    0, 0, 0, 1, 0x68, 0x33,
  ]);
});

test('avccToAnnexb supports two-byte lengths and leaves annexb untouched', () => {
  const avcc = new Uint8Array([0, 2, 0x41, 0x42]);
  assert.deepEqual(Array.from(avccToAnnexb(avcc, 2)), [0, 0, 0, 1, 0x41, 0x42]);

  // 已经是 Annex-B 的字节不该被二次转换（转换不出任何 NAL 时原样返回）。
  const already = new Uint8Array([0, 0, 0, 1, 0x65, 0x01]);
  assert.deepEqual(Array.from(avccToAnnexb(already, 4)), Array.from(already));
});

test('avccToAnnexb drops a truncated trailing NAL instead of emitting garbage', () => {
  const avcc = new Uint8Array([0, 0, 0, 8, 0x41, 0x42]);
  assert.deepEqual(Array.from(avccToAnnexb(avcc, 4)), [0, 0, 0, 8, 0x41, 0x42]);
});

