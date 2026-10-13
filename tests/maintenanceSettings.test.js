import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Agenda exposes the maintenance control and requires explicit save', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const page = await readFile(new URL('../src/pages/MaintenanceSettingsPage.jsx', import.meta.url), 'utf8');
  assert.match(app, /"\/manutenzione": \{ title: "Manutenzione sito"/);
  assert.match(page, /adminFetch\('\/api\/admin\/site-maintenance'/);
  assert.match(page, /method: 'POST'/);
  assert.match(page, /'X-Admin-Request': '1'/);
  assert.match(page, /disabled=\{status\.saving \|\| Boolean\(status\.error\)\}/);
  assert.match(page, /Storico amministrativo/);
});
