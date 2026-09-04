import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const window = {};
vm.runInNewContext(await readFile(new URL('../navigation.js', import.meta.url), 'utf8'), { window });
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));

test('navigation saves are serialised and the latest selection wins', async () => {
  const calls = [], pending = [];
  let shown;
  const queue = window.ArcadiaNavigation.preferenceQueue({
    save(value) { calls.push(plain(value)); return new Promise(resolve => pending.push(resolve)); },
    apply(value) { shown = plain(value); }, status() {}
  });
  queue.load({ navigationLayout: 'sidebar', sidebarCollapsed: false });
  queue.change({ navigationLayout: 'topbar' });
  queue.change({ sidebarCollapsed: true });
  queue.change({ navigationLayout: 'sidebar' });
  assert.equal(calls.length, 1);
  assert.deepEqual(shown, { navigationLayout: 'sidebar', sidebarCollapsed: true });
  pending.shift()(calls[0]); await tick();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], shown);
  pending.shift()(calls[1]); await tick();
  assert.deepEqual(shown, { navigationLayout: 'sidebar', sidebarCollapsed: true });
});

test('a failed save restores confirmed preferences and reports the failure', async () => {
  let shown, message;
  const queue = window.ArcadiaNavigation.preferenceQueue({
    async save() { throw new Error('offline'); },
    apply(value) { shown = plain(value); }, status(value) { message = value; }
  });
  queue.load({ navigationLayout: 'topbar', sidebarCollapsed: true });
  queue.change({ navigationLayout: 'sidebar' }); await tick();
  assert.deepEqual(shown, { navigationLayout: 'topbar', sidebarCollapsed: true });
  assert.match(message, /could not be saved/);
});

test('a failed older save does not discard a newer selection', async () => {
  let rejectFirst, shown;
  const calls = [];
  const queue = window.ArcadiaNavigation.preferenceQueue({
    save(value) {
      calls.push(plain(value));
      if (calls.length === 1) return new Promise((resolve, reject) => { rejectFirst = reject; });
      return Promise.resolve(value);
    },
    apply(value) { shown = plain(value); }, status() {}
  });
  queue.load({ navigationLayout: 'sidebar', sidebarCollapsed: false });
  queue.change({ navigationLayout: 'topbar' });
  queue.change({ sidebarCollapsed: true });
  rejectFirst(new Error('offline')); await tick();
  assert.equal(calls.length, 2);
  assert.deepEqual(shown, { navigationLayout: 'topbar', sidebarCollapsed: true });
});
