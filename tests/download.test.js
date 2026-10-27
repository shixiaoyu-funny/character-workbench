import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dataUrlToBytes, promptsText, singleName, zipBatch } from '../src/download.js';

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
        dataUrl: PNG_A,
      },
      {
        id: 'item-2',
        kind: '三视图',
        aspect: '16:9',
        seed: 22,
        positive: '正向乙',
        negative: '负向乙',
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

test('singleName pads the index from 1 and keeps the kind', () => {
  assert.equal(singleName(1, '基准立绘'), '01-基准立绘.png');
  assert.equal(singleName(12, '三视图'), '12-三视图.png');
});

test('promptsText includes both files, both prompts, and NEGATIVE', () => {
  const text = promptsText(batch());
  const first = text.indexOf('images/01-基准立绘.png');
  const aspect = text.indexOf('aspect: 3:4');
  const seed = text.indexOf('seed: 11');
  const positiveLabel = text.indexOf('POSITIVE');
  const positive = text.indexOf('正向甲');
  const negativeLabel = text.indexOf('NEGATIVE');
  const negative = text.indexOf('负向甲');
  const sep = text.indexOf('\n---\n');
  const second = text.indexOf('images/02-三视图.png');
  assert.ok(first !== -1 && first < aspect);
  assert.ok(aspect < seed);
  assert.ok(seed < positiveLabel);
  assert.ok(positiveLabel < positive);
  assert.ok(positive < negativeLabel);
  assert.ok(negativeLabel < negative);
  assert.ok(negative < sep);
  assert.ok(sep < second);
  assert.equal(text.includes('aspect: 16:9'), true);
  assert.equal(text.includes('seed: 22'), true);
  assert.equal(text.includes('正向乙'), true);
  assert.equal(text.includes('负向乙'), true);
  assert.equal(text.includes('NEGATIVE'), true);
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
    'images/01-基准立绘.png',
    'images/02-三视图.png',
    'prompts.txt',
  ]);

  const flags = pythonZip(zipped.bytes, 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]);\n[print(f"{i.compress_type} {i.flag_bits & 0x800:x} {i.filename}") for i in z.infolist()]');
  assert.equal(flags.status, 0, flags.stderr);
  assert.equal(flags.stderr, '');
  assert.deepEqual(flags.stdout.trim().split(/\r?\n/), [
    '0 800 images/01-基准立绘.png',
    '0 800 images/02-三视图.png',
    '0 800 prompts.txt',
  ]);

  const prompts = pythonZip(zipped.bytes, 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.read("prompts.txt").decode("utf-8"))');
  assert.equal(prompts.status, 0, prompts.stderr);
  assert.equal(prompts.stderr, '');
  assert.equal(prompts.stdout.includes('正向甲'), true);
  assert.equal(prompts.stdout.includes('正向乙'), true);
  assert.equal(prompts.stdout.includes('images/01-基准立绘.png'), true);

  const pngA = Buffer.from(PNG_A.slice(PNG_A.indexOf(',') + 1), 'base64');
  const pngB = Buffer.from(PNG_B.slice(PNG_B.indexOf(',') + 1), 'base64');
  assert.deepEqual(Buffer.from(dataUrlToBytes(PNG_A)), pngA);
  assert.equal(pngA[0], 0x89);
  const png = pythonZip(zipped.bytes, 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.read("images/01-基准立绘.png").hex())');
  assert.equal(png.status, 0, png.stderr);
  assert.equal(png.stdout.trim(), pngA.toString('hex'));
  const other = pythonZip(zipped.bytes, 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.read("images/02-三视图.png").hex())');
  assert.equal(other.status, 0, other.stderr);
  assert.equal(other.stdout.trim(), pngB.toString('hex'));
});
