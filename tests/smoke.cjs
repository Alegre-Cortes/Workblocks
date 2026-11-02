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

// New version: last category is suggested, and can be disabled.
storage.clear();
app = createApp();
app.node('activeCategory').value = 'Research';
app.node('activeCategory').dispatch('change');
app.node('timerButton').click();
app.node('timerButton').click();
assert.equal(app.node('activeCategory').value, 'Research', 'remember category across blocks');
app = createApp();
assert.equal(app.node('activeCategory').value, 'Research', 'remember category across reloads');
app.node('rememberCategoryToggle').checked = false;
app.node('rememberCategoryToggle').dispatch('change');
assert.equal(app.node('activeCategory').value, '', 'disabling category memory clears suggestion');

// Forgot to start: predate an active timer and check durable persistence.
storage.clear();
app = createApp();
app.node('forgotStartBtn').click();
assert(app.node('startDialog').open);
const pastStart = new Date(Date.now() - 45 * 60000);
const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
app.node('forgotStartInput').value = fmt(pastStart);
app.node('startForm').dispatch('submit');
assert(read().active, 'earlier start creates running session');
assert(Math.abs(Date.parse(read().active.startedAt) - pastStart.getTime())<1000);
app = createApp();
assert.equal(app.node('fixStartBtn').hidden, false);
app.node('fixStartBtn').click();
const earlierStart = new Date(Date.now()-90*60000);
app.node('forgotStartInput').value=fmt(earlierStart);
app.node('startForm').dispatch('submit');
assert(Math.abs(Date.parse(read().active.startedAt)-earlierStart.getTime())<1000);

// Long timer: do not auto-stop; permit correcting the end time.
const tenHoursAgo = new Date(Date.now()-11*3600000).toISOString();
const existing = read();
existing.active.startedAt = tenHoursAgo;
storage.set('workblocks.state.v1',JSON.stringify(existing));
app = createApp();
assert.equal(app.node('longTimerNotice').hidden,false,'long timer recovery notice');
app.node('fixEndBtn').click();
const actualEnd = new Date(Date.now()-3600000);
app.node('forgotEndInput').value=fmt(actualEnd);
app.node('endForm').dispatch('submit');
assert.equal(read().active,null);
assert.equal(read().blocks.length,1);
assert(Math.abs(Date.parse(read().blocks[0].endedAt) - actualEnd.getTime())<1000);

// Reject overlapping forgotten starts without overwriting existing data.
app.node('forgotStartBtn').click();
app.node('forgotStartInput').value=fmt(new Date(Date.now()-12*3600000));
app.node('startForm').dispatch('submit');
assert.equal(read().active,null,'overlapping new start is rejected');
assert.equal(app.node('startError').hidden,false);
app.node('startDialog').close();

// Calendar navigation and history details for previously saved blocks.
app.node('historyTab').click();
assert(app.node('historyMonthTitle').textContent);
assert(app.node('calendarGrid').innerHTML.includes('calendar-day'));
assert(app.node('historyBlocks').innerHTML.includes('block-item'));
app.node('periodSelect').value = 'month';
app.node('periodSelect').dispatch('change');
app.node('insightsTab').click();
assert(app.node('periodDescription').textContent);
app.node('periodSelect').value = 'year';
app.node('periodSelect').dispatch('change');
assert(app.node('weeklyBars').innerHTML.includes('bar-track'));
console.log('PASS v0.2: category preference, forgotten starts, start correction, long timer recovery, overlap prevention, history, period summaries');
