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
  for (const id of ['theme-toggle', 'reset', 'workbench', 'sidebar', 'page-base', 'page-detail', 'page-generate', 'download-view', 'download-back', 'download-list', 'toast']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /src="\/src\/main\.js"/);
  for (const color of ['#f4f5f7', '#ffffff', '#2c2c34', '#d6336c', '#121216', '#1c1c24', '#e8e8ee', '#ff4d8d']) {
    assert.match(css, new RegExp(color, 'i'));
  }
  assert.match(css, /100vh/);
  assert.match(css, /overflow:\s*hidden/);
  assert.match(css, /\.app-shell[\s\S]*display:\s*flex/);
  assert.match(css, /\.sidebar[\s\S]*width:\s*224px/);
  assert.match(css, /\.page[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /0\.3s/);
  assert.match(css, /color-scheme:\s*dark/);
  assert.match(css, /button[\s\S]*background:\s*var\(--control\)/);
  assert.match(css, /--control:\s*#eceef2/i);
  assert.match(css, /--control:\s*#2a2a34/i);
});
