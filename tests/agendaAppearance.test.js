import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeAppearance, resolveAppearance, readAppearancePreference } from '../src/utils/agendaAppearance.js';

test('automatic theme uses Rome boundaries, including winter and summer offsets', () => {
  for (const [instant, expected] of [
    ['2026-01-15T05:59:59Z', 'dark'], ['2026-01-15T06:00:00Z', 'light'],
    ['2026-01-15T17:59:59Z', 'light'], ['2026-01-15T18:00:00Z', 'dark'],
    ['2026-07-15T04:59:59Z', 'dark'], ['2026-07-15T05:00:00Z', 'light'],
    ['2026-07-15T16:59:59Z', 'light'], ['2026-07-15T17:00:00Z', 'dark'],
    ['2026-10-25T01:30:00Z', 'dark'], ['2026-03-29T05:00:00Z', 'light'],
  ]) assert.equal(resolveAppearance('auto', new Date(instant)), expected, instant);
});

test('manual themes override time and unsupported preferences safely fall back to automatic', () => {
  assert.equal(resolveAppearance('light', new Date('2026-01-15T23:00:00Z')), 'light');
  assert.equal(resolveAppearance('dark', new Date('2026-01-15T12:00:00Z')), 'dark');
  assert.equal(normalizeAppearance('invalid'), 'auto');
  assert.equal(readAppearancePreference({ getItem: () => 'dark' }), 'dark');
  assert.equal(readAppearancePreference({ getItem: () => null }), 'auto');
  assert.equal(readAppearancePreference({ getItem: () => { throw new Error('blocked'); } }), 'auto');
});

test('both palettes keep readable text and primary buttons above WCAG AA contrast', () => {
  const css = readFileSync(new URL('../src/styles/admin-appearance.css', import.meta.url), 'utf8');
  const luminance = hex => {
    const c = hex.match(/[a-f\d]{2}/gi).map(n => parseInt(n, 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
  };
  for (const block of css.matchAll(/:root(?:\[data-agenda-theme="dark"\])?\s*\{([^}]+)\}/g)) {
    const colors = Object.fromEntries([...block[1].matchAll(/--ui-([\w-]+):\s*(#[a-f\d]{6})/gi)].map(m => [m[1], m[2]]));
    for (const [foreground, background] of [['text','bg'], ['text','surface'], ['muted','surface'], ['on-primary','primary'], ['success-text','success-bg'], ['warning-text','warning-bg'], ['danger-text','danger-bg']]) {
      const a = luminance(colors[foreground]), b = luminance(colors[background]);
      assert.ok((Math.max(a,b) + .05) / (Math.min(a,b) + .05) >= 4.5, `${foreground}/${background}`);
    }
  }
});
