import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dataUrlToBytes, imageFileName, makeFileKey, zipBatch } from '../src/download.js';

const PNG_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function batch() {
  return {
    id: 'batch-1',
    createdAt: new Date(2026, 9, 27, 21, 40, 5).getTime(),
    status: 'complete',
    items: [
      {
        id: 'item-1',
        kind: '基准立绘',
        aspect: '3:4',
        seed: 11,
        positive: '正向甲',
        negative: '负向甲',
        fileKey: 'a1b2c3-20261027-214005',
        dataUrl: PNG_A,
      },
      {
        id: 'item-2',
        kind: '三视图',
        aspect: '16:9',
        seed: 22,
        positive: '正向乙',
        negative: '负向乙',
        fileKey: 'd4e5f6-20261027-214006',
        dataUrl: PNG_B,
      },
    ],
  };
}

function pythonZip(bytes, code) {
  const dir = mkdtempSync(join(tmpdir(), 'role-zip-'));
  const path = join(dir, 'batch.zip');
  try {
    writeFileSync(path, bytes);
    return spawnSync('python', ['-c', code, path], {
      encoding: 'utf8',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('image names use six uuid characters and a timestamp', () => {
  const key = makeFileKey(new Date(2026, 9, 30, 1, 59, 0).getTime());
  assert.match(key, /^[0-9a-f]{6}-20261030-015900$/);
  assert.equal(imageFileName({ fileKey: 'a1b2c3-20261027-214005' }), 'a1b2c3-20261027-214005.png');
});

test('zipBatch writes a stored UTF-8 archive Python can read', () => {
  const entry = batch();
  const zipped = zipBatch(entry);
  assert.equal(zipped.filename, '角色设定-20261027-214005.zip');
  assert.match(zipped.filename, /^角色设定-\d{8}-\d{6}\.zip$/);

  const names = pythonZip(zipped.bytes, 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print("\\n".join(z.namelist()))');
  assert.equal(names.status, 0, names.stderr);
  assert.equal(names.stderr, '');
  assert.deepEqual(names.stdout.trim().split(/\r?\n/), [
    'images/a1b2c3-20261027-214005.png',
    'images/d4e5f6-20261027-214006.png',
  ]);

  const flags = pythonZip(zipped.bytes, 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]);\n[print(f"{i.compress_type} {i.flag_bits & 0x800:x} {i.filename}") for i in z.infolist()]');
  assert.equal(flags.status, 0, flags.stderr);
  assert.equal(flags.stderr, '');
  assert.deepEqual(flags.stdout.trim().split(/\r?\n/), [
    '0 800 images/a1b2c3-20261027-214005.png',
    '0 800 images/d4e5f6-20261027-214006.png',
  ]);

  const pngA = Buffer.from(PNG_A.slice(PNG_A.indexOf(',') + 1), 'base64');
  const pngB = Buffer.from(PNG_B.slice(PNG_B.indexOf(',') + 1), 'base64');
  assert.deepEqual(Buffer.from(dataUrlToBytes(PNG_A)), pngA);
  assert.equal(pngA[0], 0x89);
  const png = pythonZip(zipped.bytes, 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.read("images/a1b2c3-20261027-214005.png").hex())');
  assert.equal(png.status, 0, png.stderr);
  assert.equal(png.stdout.trim(), pngA.toString('hex'));
  const other = pythonZip(zipped.bytes, 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.read("images/d4e5f6-20261027-214006.png").hex())');
  assert.equal(other.status, 0, other.stderr);
  assert.equal(other.stdout.trim(), pngB.toString('hex'));
});

test('zipBatch prepends the base portrait when batch.base is set', () => {
  const entry = { ...batch(), base: { dataUrl: PNG_B, seed: 99, fileKey: 'b0c1d2-20261027-214000' } };
  const zipped = zipBatch(entry);
  const names = pythonZip(zipped.bytes, 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print("\\n".join(z.namelist()))');
  assert.equal(names.status, 0, names.stderr);
  assert.deepEqual(names.stdout.trim().split(/\r?\n/), [
    'images/b0c1d2-20261027-214000.png',
    'images/a1b2c3-20261027-214005.png',
    'images/d4e5f6-20261027-214006.png',
  ]);
  const base = pythonZip(zipped.bytes, 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.read("images/b0c1d2-20261027-214000.png").hex())');
  assert.equal(base.status, 0, base.stderr);
  const pngB = Buffer.from(PNG_B.slice(PNG_B.indexOf(',') + 1), 'base64');
  assert.equal(base.stdout.trim(), pngB.toString('hex'));
});

test('a tune batch packs only the images', () => {
  const entry = {
    ...batch(),
    base: { dataUrl: PNG_B, seed: null, fileKey: 'e7f809-20261027-214000' },
    items: [
      { ...batch().items[0], kind: '微调角色', positive: '正向微调', negative: '负向微调' },
      { ...batch().items[1], kind: '微调角色', positive: '第二张', negative: '负向二' },
    ],
  };
  const zipped = zipBatch(entry);
  const names = pythonZip(zipped.bytes, 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print("\\n".join(z.namelist()))');
  assert.equal(names.status, 0, names.stderr);
  assert.deepEqual(names.stdout.trim().split(/\r?\n/), [
    'images/e7f809-20261027-214000.png',
    'images/a1b2c3-20261027-214005.png',
    'images/d4e5f6-20261027-214006.png',
  ]);
});
