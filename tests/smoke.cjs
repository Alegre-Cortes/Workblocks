/* Dependency-free app-logic smoke tests (Node.js 18+).
   Runs app.js in a minimal fake DOM to test persistence and interactions.
   For actual visual/PWA installation checks, use Chrome on localhost/HTTPS. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const js = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const storage = new Map();
let lastContext;
function createApp() {
  const nodes = new Map();
  function node(id = '') {
    if (!nodes.has(id)) {
      const el = {
        id, textContent: '', innerHTML: '', value: '', hidden: false, style: {}, dataset: {}, listeners: {},
        classList: { toggle() {}, add() {}, remove() {} },
        addEventListener(event, fn) { (this.listeners[event] ||= []).push(fn); },
        dispatch(event, extras = {}) { for (const fn of this.listeners[event] || []) fn({ preventDefault() {}, target: this, ...extras }); },
        setAttribute() {}, removeAttribute() {}, append() {}, remove() {}, prepend(el) { this.child = el; }, click() { this.dispatch('click'); },
        showModal() { this.open = true; }, close() { this.open = false; this.dispatch('close'); },
        querySelector() { return node('modal-actions'); },
      };
      nodes.set(id, el);
    }
    return nodes.get(id);
  }
  const window = { listeners: {}, addEventListener(event, fn) { (this.listeners[event] ||= []).push(fn); } };
  const document = {
    hidden: false,
    getElementById: node, createElement: () => node('created-' + Math.random()),
    body: { append() {} }, addEventListener() {}
  };
  const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  const context = { console, Date, Math, JSON, Map, Set, Intl, String, Number, URL, Blob, document, window, localStorage,
    navigator: {}, location: { protocol: 'http:', hostname: 'example.com' },
    setInterval: () => 1, setTimeout: () => 1, clearTimeout: () => {},
    confirm: () => true, globalThis: {},
  };
  vm.runInNewContext(js, context, { filename: 'app.js' });
  return { node, context, window };
}
function read() { return JSON.parse(storage.get('workblocks.state.v1')); }

let app = createApp();
assert.equal(app.node('timerButtonLabel').textContent, 'Start working');
app.node('timerButton').click();
assert(read().active?.startedAt, 'start must be persisted immediately');
app.node('activeCategory').value = 'Research';
app.node('activeCategory').dispatch('change');
assert.equal(read().active.category, 'Research');

// Simulate terminating/reopening the app (same device/browser storage).
app = createApp();
assert.equal(app.node('timerButtonLabel').textContent, 'Stop working');
assert.equal(app.node('activeCategory').value, 'Research');
app.node('timerButton').click();
assert.equal(read().blocks.length, 1);
assert.equal(read().blocks[0].category, 'Research');
assert.equal(read().active, null);

// A second independently started/stopped block on the same day.
app.node('timerButton').click();
app.node('timerButton').click();
assert.equal(read().blocks.length, 2);

// Edit a completed block via the block dialog.
const firstId = read().blocks[0].id;
app.node('todayBlocks').dispatch('click', { target: { closest: () => ({ dataset: { edit: firstId } }) } });
assert.equal(app.node('blockDialog').open, true);
app.node('noteInput').value = 'Mechanistic modeling';
app.node('blockForm').dispatch('submit');
assert.equal(read().blocks[0].note, 'Mechanistic modeling');

// Delete a block (a tombstone is kept for future sync).
app.node('todayBlocks').dispatch('click', { target: { closest: () => ({ dataset: { edit: firstId } }) } });
app.node('modal-actions').child.click();
assert(read().blocks[0].deletedAt, 'deletion must retain a tombstone');

// Midnight splitting: two-hour block from yesterday 23:00 to today 01:00.
const today = new Date();
const firstMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
const from = new Date(firstMidnight - 60 * 60 * 1000).toISOString();
const to = new Date(firstMidnight + 60 * 60 * 1000).toISOString();
const backup = { version: 1, blocks: [{ id: 'midnight-test', startedAt: from, endedAt: to, category: 'Outreach', updatedAt: to, deletedAt: null }], active: null };
storage.set('workblocks.state.v1', JSON.stringify(backup));
app = createApp();
// Even though the block is two hours long, only one hour counts toward today.
assert.equal(app.node('todayTotal').textContent, '1h 00m');
assert(app.node('todayBlocks').innerHTML.includes('1h 00m'));
app.node('insightsTab').click();
assert.equal(app.node('insightsTotal').textContent, '2h 00m');
console.log('PASS: start/stop, reload persistence, categories, multiple blocks, editing, deletion, midnight stats, insights');
