import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { nextTheme, resolveTheme } from '../src/theme.js';

test('stored theme wins over the system', () => {
  assert.equal(resolveTheme({ stored: 'dark', prefersDark: false }), 'dark');
  assert.equal(resolveTheme({ stored: 'light', prefersDark: true }), 'light');
});

test('missing or unknown theme follows the system', () => {
  assert.equal(resolveTheme({ stored: null, prefersDark: true }), 'dark');
  assert.equal(resolveTheme({ stored: '', prefersDark: false }), 'light');
  assert.equal(resolveTheme({ stored: 'blue', prefersDark: false }), 'light');
});

test('next theme toggles', () => {
  assert.equal(nextTheme('dark'), 'light');
  assert.equal(nextTheme('light'), 'dark');
});

test('shell matches the workbench contract', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');
  for (const id of ['theme-toggle', 'reset', 'workbench', 'col-left', 'col-center', 'col-right', 'download-view', 'download-back', 'download-list', 'toast']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /src="\/src\/main\.js"/);
  for (const color of ['#f4f5f7', '#ffffff', '#2c2c34', '#d6336c', '#121216', '#1c1c24', '#e8e8ee', '#ff4d8d']) {
    assert.match(css, new RegExp(color, 'i'));
  }
  assert.match(css, /100vh/);
  assert.match(css, /overflow:\s*hidden/);
  assert.match(css, /grid-template-columns:\s*20%\s+45%\s+35%/);
  assert.match(css, /0\.3s/);
});
