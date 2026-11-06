import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COLOR_MODELS, normalizeHex, englishNameForHex, basicColorName,
  fallbackColorName, mockTranslateColor, translateColorName,
} from '../src/colorTranslate.js';

test('COLOR_MODELS lists the translation chain in fallback order', () => {
  assert.deepEqual(COLOR_MODELS, ['qwen3.8-flash', 'deepseek-v4.1-flash', 'qwen3.7-flash']);
});

test('normalizeHex normalizes short and mixed-case hex, rejects garbage', () => {
  assert.equal(normalizeHex('#DBFFF4'), '#dbfff4');
  assert.equal(normalizeHex('#abc'), '#aabbcc');
  assert.equal(normalizeHex(' #ffb6c1 '), '#ffb6c1');
  assert.equal(normalizeHex('red'), '');
  assert.equal(normalizeHex('#12345'), '');
  assert.equal(normalizeHex(123), '');
});

test('englishNameForHex maps shades, grays and the documented examples', () => {
  assert.equal(englishNameForHex('#dbfff4'), 'pale aquamarine');
  assert.equal(englishNameForHex('#add8e6'), 'light blue');
  assert.equal(englishNameForHex('#ffb6c1'), 'pastel pink');
  assert.equal(englishNameForHex('#ff0000'), 'vibrant red');
  assert.equal(englishNameForHex('#000000'), 'black');
  assert.equal(englishNameForHex('#ffffff'), 'white');
  assert.equal(englishNameForHex('#000033'), 'deep navy blue');
  // System Prompt 示例。
  assert.equal(englishNameForHex('#00008b'), 'deep navy blue');
  assert.equal(englishNameForHex('#8a2be2'), 'vibrant violet');
  assert.equal(englishNameForHex('#7fffd4'), 'pale aquamarine');
  assert.equal(englishNameForHex('#ff4500'), 'vibrant orange red');
});

test('basicColorName falls back to coarse color names', () => {
  assert.equal(basicColorName('#ff0000'), 'red');
  assert.equal(basicColorName('#0000ff'), 'blue');
  assert.equal(basicColorName('#000000'), 'black');
  assert.equal(basicColorName('#ffffff'), 'white');
  assert.equal(basicColorName('#808080'), 'gray');
});

test('fallbackColorName never throws and returns color #HEX for unknown input', () => {
  assert.equal(fallbackColorName('#ff0000'), 'red');
  assert.equal(fallbackColorName('not-a-color'), 'color not-a-color');
});

test('mockTranslateColor translates a single hex after the delay', async () => {
  const started = Date.now();
  const name = await mockTranslateColor('#dbfff4');
  assert.equal(name, 'pale aquamarine');
  assert.ok(Date.now() - started >= 300, 'must wait at least 300ms');
});

test('mockTranslateColor translates a gradient request format', async () => {
  const name = await mockTranslateColor('gradient from #ffb6c1 to #add8e6', { delay: 0 });
  assert.equal(name, 'gradient from pastel pink to light blue');
});

test('translateColorName uses the fetcher result when available', async () => {
  let seenUrl = null;
  let seenBody = null;
  const fetcher = async (url, init) => {
    seenUrl = url;
    seenBody = JSON.parse(init.body);
    return { englishName: 'midnight blue' };
  };
  const name = await translateColorName('#00008b', { fetcher });
  assert.equal(name, 'midnight blue');
  assert.equal(seenUrl, '/api/translate-color');
  assert.deepEqual(seenBody, { input: '#00008b' });
});

test('translateColorName falls back on failure and timeout', async () => {
  const failing = await translateColorName('#ff0000', { translate: async () => { throw new Error('boom'); } });
  assert.equal(failing, 'red');

  const slow = await translateColorName('#0000ff', {
    translate: () => new Promise((resolve) => setTimeout(() => resolve('never'), 100)),
    timeoutMs: 10,
  });
  assert.equal(slow, 'blue');
});

test('translateColorName defaults to the mock when no fetcher or translate is given', async () => {
  const name = await translateColorName('#dbfff4');
  assert.equal(name, 'pale aquamarine');
});
