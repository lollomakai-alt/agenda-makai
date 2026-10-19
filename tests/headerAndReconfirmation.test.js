import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = file => readFileSync(new URL(file, import.meta.url), 'utf8');

test('Area riservata resta accanto al marchio e fuori dal menu', () => {
  const app = source('../src/App.jsx');
  const header = app.slice(app.indexOf('const header ='), app.indexOf('const content ='));
  const brand = header.indexOf('className="admin-brand-group"');
  const menu = header.indexOf('className="mobile-header-menu"');
  assert.ok(brand >= 0 && menu > brand);
  assert.ok(header.slice(brand, menu).includes('Area riservata'));
  assert.ok(!header.slice(menu).includes('Area riservata'));
});

test('menu e notifiche si chiudono a vicenda quando vengono aperti', () => {
  assert.match(source('../src/components/MobileSection.jsx'), /admin-header-notifications-open/);
  assert.match(source('../src/components/MobileSection.jsx'), /admin-header-menu-open/);
  assert.match(source('../src/components/AdminNotifications.jsx'), /admin-header-menu-open/);
  assert.match(source('../src/components/AdminNotifications.jsx'), /admin-header-notifications-open/);
});

test('online aperto è verde, chiuso rosso e la scheda può inviare una riconferma manuale', () => {
  const styles = source('../src/styles/admin-appearance.css');
  assert.match(styles, /agenda-online-toggle\.is-open[\s\S]*?--ui-success-border/);
  assert.match(styles, /agenda-online-toggle\.is-closed[\s\S]*?--ui-danger-border/);
  assert.match(source('../src/components/BookingOperationalControls.jsx'), /Invia richiesta di riconferma/);
  assert.match(source('../src/components/BookingOperationalControls.jsx'), /prepareEmailTemplate\(supabase, booking\.id, 'reconfirmation'\)/);
  assert.match(source('../src/components/BookingOperationalControls.jsx'), /sendEmailTemplate\(supabase, booking\.id, communication\.id\)/);
});
