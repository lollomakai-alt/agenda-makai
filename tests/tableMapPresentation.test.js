import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TABLE_ASSIGNMENTS, TABLE_15_19_CONFIGURATIONS } from '../src/config/tableAssignments.js';
import { TABLE_LAYOUT } from '../src/config/tableLayout.js';
import { physicalTableIds } from '../src/utils/tableConflicts.js';
import { landscapeTablePosition, portraitTablePosition } from '../src/utils/tableMapPresentation.js';

const component = readFileSync(new URL('../src/components/TableMap.jsx', import.meta.url), 'utf8');
const operationsCss = readFileSync(new URL('../src/styles/admin-operations.css', import.meta.url), 'utf8');
const neonCss = readFileSync(new URL('../src/styles/admin-neon.css', import.meta.url), 'utf8');
const dayReferenceCss = readFileSync(new URL('../src/styles/admin-day-reference.css', import.meta.url), 'utf8');
const mobileLayoutHook = readFileSync(new URL('../src/hooks/useMobileLayout.js', import.meta.url), 'utf8');
const viewportWidths = [320, 375, 390, 1280];
const fixedUnits = ['10+11', '12', '13+14', '20+21', '22', '23'];
const ids = group => physicalTableIds(group);
const contains = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

function mapRectangles(roomName, groups, viewportWidth, viewportHeight = 844) {
  const room = TABLE_LAYOUT.find(item => item.name === roomName);
  const canvasWidth = Math.min(viewportWidth - 32, 520);
  const canvasHeight = viewportWidth > 600
    ? roomName === 'Sala Nami' ? 230 : 440
    : roomName === 'Sala Nami' ? 210 : Math.max(350, Math.min(52 * viewportHeight / 100, 410));
  return groups.map(group => {
    const members = ids(group).map(id => room.units.find(unit => unit.group === id));
    assert.ok(members.every(Boolean), `${roomName}: ${group} contiene solo tavoli fisici della sala`);
    const center = landscapeTablePosition({ physicalIds: ids(group) }, roomName);
    const centerX = center.x / 100 * canvasWidth;
    const centerY = center.y / 100 * canvasHeight;
    const square = Math.max(44, Math.min(16 * canvasWidth / 100, 56));
    const width = square * members.length;
    const baseHeight = square;
    return { group, left: centerX - width / 2, right: centerX + width / 2,
      top: centerY - baseHeight / 2,
      bottom: centerY + baseHeight / 2,
      width, height: baseHeight };
  });
}

function assertProportionalArea(layout, viewportWidth, viewportHeight = 844) {
  const baseWidth = Math.max(44, Math.min(16 * Math.min(viewportWidth - 32, 520) / 100, 56));
  const baseHeight = baseWidth;
  for (const tile of layout) {
    const expected = baseWidth * baseHeight * ids(tile.group).length;
    assert.ok(Math.abs(tile.width * tile.height - expected) < 0.01,
      `${tile.group} occupa area ${ids(tile.group).length}× rispetto a un'unità`);
    assert.ok(Math.abs(tile.width / tile.height - ids(tile.group).length) < 0.01,
      `${tile.group} mantiene proporzione ${ids(tile.group).length}:1`);
  }
}

test('map tile presentation uses physical count for area and shows the full grouped table number', () => {
  assert.match(component, /const physicalCount = item\.physicalIds\.length/);
  assert.match(component, /<strong>\{item\.group\}<\/strong>/);
  assert.match(component, /data-physical-count=\{physicalCount\}/);
  assert.doesNotMatch(component, /unit-scale|item\.capacity \* 0\.05/);
  assert.match(component, /floor-plan-booking-name/);
  assert.match(component, /\{item\.bookings\[0\]\.party_size\} pers\./);
  assert.match(operationsCss, /--table-square: clamp\(44px, 16cqw, 56px\)/);
  assert.match(operationsCss, /floor-plan-room-tabs button, \.floor-plan-shifts button \{\s*min-height: 32px/);
  assert.match(operationsCss, /\.table-floor-plan\.is-wide-map \.floor-plan-canvas > li\s*\{\s*left: var\(--landscape-x\); top: var\(--landscape-y\)/);
  assert.match(component, /is-wide-map/);
  assert.doesNotMatch(component, /compactMap|matchMedia/);
  assert.match(operationsCss, /data-physical-count="2"\] \{ width: calc\(2 \* var\(--table-square\)\)/);
  assert.match(operationsCss, /data-physical-count="3"\] \{ width: calc\(3 \* var\(--table-square\)\)/);
  assert.doesNotMatch(component, /data-physical-orientation/);
  assert.match(neonCss, /service-normale\.is-reserved[\s\S]*service-normale\.is-occupied/);
  assert.match(neonCss, /service-dopocena\.is-reserved[\s\S]*service-dopocena\.is-occupied/);
});

test('portrait main-room row 15–19 is mirrored from right to left', () => {
  const positions = [15, 16, 17, 18, 19].map(id =>
    portraitTablePosition({ physicalIds: [String(id)] }, 'Sala Principale').x);
  assert.deepEqual(positions, [88, 69, 50, 31, 12]);
});

test('Agenda header collapses to a layered hamburger before navigation can crowd the notification bell', () => {
  assert.match(mobileLayoutHook, /max-width: 1100px/);
  assert.match(dayReferenceCss, /@media screen and \(min-width: 601px\) and \(max-width: 1100px\)/);
  assert.match(dayReferenceCss, /\.admin-shell-private \.mobile-header-menu \{\s*position: relative;\s*z-index: 135/);
  assert.match(dayReferenceCss, /\.admin-shell-private \.mobile-header-menu \.mobile-section-content \{[\s\S]*?z-index: 135/);
  assert.match(dayReferenceCss, /\.admin-shell-private \.admin-notifications \.notification-panel \{[\s\S]*?z-index: 130/);
});

test('valid row 15–19 layouts and fixed units keep square touch geometry on iPhone and desktop', () => {
  assert.equal(TABLE_15_19_CONFIGURATIONS.length, 3);
  for (const row of TABLE_15_19_CONFIGURATIONS) {
    assert.deepEqual(row.flatMap(ids).sort((a, b) => Number(a) - Number(b)), ['15', '16', '17', '18', '19']);
    const mainGroups = [...fixedUnits.slice(0, 3), ...row];
    for (const width of viewportWidths) {
      const main = mapRectangles('Sala Principale', mainGroups, width);
      assertProportionalArea(main, width);
      for (const tile of main) assert.ok(tile.width >= 44 && tile.height >= 44, `${width}px: ${tile.group} mantiene target touch >=44px`);
      for (let index = 0; index < main.length; index++) {
        for (const other of main.slice(index + 1)) assert.ok(!contains(main[index], other), `${width}px: ${main[index].group} non si sovrappone a ${other.group}`);
      }
    }
  }
  for (const group of fixedUnits.slice(3)) {
    assert.ok(Object.hasOwn(TABLE_ASSIGNMENTS, group), `${group} è un'unità assegnabile esistente`);
  }
  for (const width of viewportWidths) {
    const fixedNami = mapRectangles('Sala Nami', fixedUnits.slice(3), width);
    const horizontalGroup = mapRectangles('Sala Nami', ['20+21', '22+23'], width);
    assertProportionalArea(fixedNami, width);
    assertProportionalArea(horizontalGroup, width);
    for (const tile of [...fixedNami, ...horizontalGroup]) assert.ok(tile.width >= 44 && tile.height >= 44, `${width}px: ${tile.group} è touch-friendly`);
    for (const layout of [fixedNami, horizontalGroup]) {
      for (let index = 0; index < layout.length; index++) {
        for (const other of layout.slice(index + 1)) assert.ok(!contains(layout[index], other), `${width}px: ${layout[index].group} non si sovrappone a ${other.group}`);
      }
    }
  }
});
