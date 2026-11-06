import assert from 'node:assert/strict';
import test from 'node:test';

import { applyGrading, defaultGradingParams } from '../src/colorGrade.js';
import {
  LUT_SIZE, buildCubeLut, gradeForExport, lutParams, needsLut, spatialGrade,
} from '../src/gradeLut.js';

function rows(cube) {
  return cube.split('\n').filter((line) => line && !line.startsWith('#') && !line.startsWith('LUT_3D') && !line.startsWith('DOMAIN'));
}

function header(cube, key) {
  const line = cube.split('\n').find((row) => row.startsWith(key));
  return line ? line.slice(key.length).trim() : '';
}

test('identity params need no LUT at all', () => {
  assert.equal(needsLut(defaultGradingParams()), false);
  // 只有空间参数时也不需要 LUT：那四个交给 ffmpeg 滤镜。
  assert.equal(needsLut({ sharpen: 40, clarity: 20, grain: 10, vignette: -30 }), false);
  assert.equal(needsLut({ saturation: 10 }), true);
  const { lut, grade } = gradeForExport({ sharpen: 50, grain: 20 });
  assert.equal(lut, '');
  assert.deepEqual(grade, { sharpen: 0.5, clarity: 0, grain: 0.2, vignette: 0 });
});

test('lutParams zeroes the four spatial params and clamps the rest', () => {
  const params = lutParams({ temperature: 500, tint: -500, sharpen: 90, clarity: 80, grain: 70, vignette: 60 });
  assert.equal(params.temperature, 100);
  assert.equal(params.tint, -100);
  for (const key of ['sharpen', 'clarity', 'grain', 'vignette']) assert.equal(params[key], 0);
  // 缺字段 / 非数字一律当成 0，别让 undefined 进到逐像素运算里。
  assert.equal(lutParams({ saturation: 'x' }).saturation, 0);
  assert.equal(lutParams({}).glow, 0);
});

test('spatialGrade scales -100..100 into -1..1', () => {
  assert.deepEqual(spatialGrade({ sharpen: 100, clarity: -50, grain: 25, vignette: -100 }), {
    sharpen: 1, clarity: -0.5, grain: 0.25, vignette: -1,
  });
});

test('cube has the right header and row count', () => {
  const cube = buildCubeLut({ saturation: 30 }, 8);
  assert.equal(header(cube, 'LUT_3D_SIZE'), '8');
  assert.equal(header(cube, 'DOMAIN_MIN'), '0.0 0.0 0.0');
  assert.equal(header(cube, 'DOMAIN_MAX'), '1.0 1.0 1.0');
  assert.equal(rows(cube).length, 8 ** 3);
  // 行序必须 R 变化最快：第一行是黑，第二行是 (1/7,0,0)，最后一行是纯白。
  const first = rows(cube)[0].split(' ').map(Number);
  const second = rows(cube)[1].split(' ').map(Number);
  const last = rows(cube)[rows(cube).length - 1].split(' ').map(Number);
  assert.ok(first.every((v) => v < 0.01), '第一行是黑');
  assert.ok(second[0] > 0.1, '第二行红通道已经抬起来');
  assert.equal(second[1], 0);
  assert.ok(last.every((v) => v > 0.98), '最后一行是白');
});

test('default LUT size is fine for the export chain', () => {
  assert.equal(LUT_SIZE, 33);
  const cube = buildCubeLut({ saturation: 30 });
  assert.equal(rows(cube).length, LUT_SIZE ** 3);
  // 33³ 的表约 1MB 文本，塞进一次 JSON 请求没有压力；再大就没必要了。
  assert.ok(cube.length < 1_400_000, `cube 太大：${cube.length}`);
});

test('every table entry equals the grading engine applied to that exact colour', () => {
  const params = {
    temperature: 24, tint: -12, saturation: 30, vibrance: 18,
    brightness: 6, contrast: 20, highlights: -22, shadows: 28,
    whites: -14, blacks: -9, glow: 16, fade: 8,
  };
  const size = 9;
  const cube = buildCubeLut(params, size);
  const list = rows(cube);
  const step = 255 / (size - 1);
  const picks = [0, 1, 3, 4, 8]; // 抽几档 RGB，逐档比对
  for (const r of picks) {
    for (const g of picks) {
      for (const b of picks) {
        const index = (b * size * size + g * size + r);
        const expected = applyGrading(
          { data: new Uint8ClampedArray([Math.round(r * step), Math.round(g * step), Math.round(b * step), 255]), width: 1, height: 1 },
          params,
        ).data;
        const got = list[index].split(' ').map((v) => Number(v) * 255);
        for (let c = 0; c < 3; c++) {
          assert.ok(
            Math.abs(got[c] - expected[c]) <= 0.6,
            `(${r},${g},${b}) 通道 ${c}: LUT ${got[c].toFixed(2)} != 引擎 ${expected[c]}`,
          );
        }
      }
    }
  }
});

test('空间参数不进表：加不加锐化/颗粒/暗角，导出的表完全一致', () => {
  const base = { temperature: 40, saturation: 20 };
  const plain = buildCubeLut(base, 5);
  const spatial = buildCubeLut({ ...base, sharpen: 90, clarity: 70, grain: 60, vignette: -80 }, 5);
  assert.equal(spatial, plain);
});
