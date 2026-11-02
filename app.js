/* Workblocks v0.1 — deliberately dependency-free and offline-first. */
(() => {
  'use strict';
  const STORAGE_KEY = 'workblocks.state.v1';
  const CATEGORY_NAMES = ['', 'Research', 'Mentoring', 'Bureaucracy', 'Outreach', 'Other'];
  const CATEGORY_SET = new Set(CATEGORY_NAMES);
  const $ = id => document.getElementById(id);
  const freshState = () => ({ version: 1, blocks: [], active: null });
  const isoNow = () => new Date().toISOString();
  const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const safeCategory = value => CATEGORY_SET.has(value) ? value : '';
  const id = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : `wb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const pad = n => String(n).padStart(2, '0');
  const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const ms = value => Date.parse(value);

  function readState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.blocks)) return freshState();
      const blocks = parsed.blocks.filter(b => b && typeof b.id === 'string' && validDate(b.startedAt) && validDate(b.endedAt) && ms(b.endedAt) > ms(b.startedAt)).map(b => ({
        id: b.id, startedAt: b.startedAt, endedAt: b.endedAt,
        category: safeCategory(b.category), note: String(b.note || '').slice(0, 140),
        updatedAt: validDate(b.updatedAt) ? b.updatedAt : b.endedAt,
        deletedAt: validDate(b.deletedAt) ? b.deletedAt : null
      }));
      const a = parsed.active;
      const active = a && typeof a.id === 'string' && validDate(a.startedAt)
        ? { id: a.id, startedAt: a.startedAt, category: safeCategory(a.category) } : null;
      return { version: 1, blocks, active };
    } catch (_) { return freshState(); }
  }

  let state = readState();
  let pendingCategory = '';
  let currentTab = 'today';
  let editingId = null;
  let toastHandle;
  let installPrompt = null;
  let lastDay = dateKey(new Date());
  let storageError = false;

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastHandle);
    toastHandle = setTimeout(() => { el.hidden = true; }, 3500);
  }

  function commit(change) {
    const next = readState();
    if (change(next) === false) return false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      state = next;
      storageError = false;
      render();
      return true;
    } catch (_) {
      storageError = true;
      $('storageState').textContent = '⚠ Storage unavailable';
      toast('Could not save. Please check browser storage settings.');
      return false;
    }
  }

  function currentBlocks(now = Date.now()) {
    const result = state.blocks.filter(b => !b.deletedAt).map(b => ({ ...b, start: ms(b.startedAt), end: ms(b.endedAt) }));
    if (state.active) result.push({ ...state.active, start: ms(state.active.startedAt), end: Math.max(now, ms(state.active.startedAt)), live: true });
    return result;
  }

  function eachDaySlice(start, end, callback) {
    let point = start;
    while (point < end) {
      const t = new Date(point);
      const nextMidnight = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1).getTime();
      const nextPoint = Math.min(end, nextMidnight);
      if (nextPoint <= point) break;
      callback(dateKey(t), nextPoint - point);
      point = nextPoint;
    }
  }

  function buildStats(now = Date.now()) {
    const daily = new Map();
    const categories = new Map();
    const today = new Date(now);
    const first = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6).getTime();
    const last = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
    for (const block of currentBlocks(now)) {
      eachDaySlice(block.start, block.end, (key, amount) => daily.set(key, (daily.get(key) || 0) + amount));
      const portion = Math.max(0, Math.min(block.end, last) - Math.max(block.start, first));
      if (portion) categories.set(block.category || '', (categories.get(block.category || '') || 0) + portion);
    }
    const lastSeven = [];
    for (let offset = 6; offset >= 0; offset--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
      lastSeven.push({ key: dateKey(d), date: d, duration: daily.get(dateKey(d)) || 0 });
    }
    return { daily, categories, lastSeven, sevenTotal: lastSeven.reduce((sum, day) => sum + day.duration, 0) };
  }

  function formatHours(duration) {
    const mins = Math.floor(Math.max(0, duration) / 60000);
    return `${Math.floor(mins / 60)}h ${pad(mins % 60)}m`;
  }
  function formatShort(duration) {
    const mins = Math.floor(Math.max(0, duration) / 60000);
    return mins >= 60 ? `${Math.floor(mins / 60)}h ${pad(mins % 60)}m` : `${mins}m`;
  }
  function formatClock(duration) {
    const seconds = Math.floor(Math.max(0, duration) / 1000);
    return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
  }
  const timeLabel = epoch => new Date(epoch).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  const dateLabel = epoch => new Date(epoch).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const buttonEdit = b => `<button class="edit-button" type="button" data-edit="${escapeHtml(b.id)}" aria-label="Edit this block" title="Edit">✎</button>`;

  function blockMarkup(block, clippedDuration = null, showDate = false) {
    const a = ms(block.startedAt), b = ms(block.endedAt);
    const period = `${showDate ? `${dateLabel(a)} · ` : ''}${timeLabel(a)} – ${timeLabel(b)}`;
    const category = block.category || 'Uncategorized';
    return `<article class="block-item"><div class="block-main"><div class="block-time">${escapeHtml(period)}</div><div class="block-meta"><span class="category-pill ${block.category ? '' : 'uncategorized'}">${escapeHtml(category)}</span></div>${block.note ? `<div class="block-note">${escapeHtml(block.note)}</div>` : ''}</div><div class="block-right"><span class="block-duration">${formatShort(clippedDuration ?? b - a)}</span>${buttonEdit(block)}</div></article>`;
  }

  function renderTodayList() {
    const now = new Date();
    const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    const blocks = state.blocks.filter(b => !b.deletedAt && ms(b.startedAt) < endDay && ms(b.endedAt) > startDay)
      .sort((a, b) => ms(b.endedAt) - ms(a.endedAt));
    $('blocksCount').textContent = `${blocks.length} completed ${blocks.length === 1 ? 'block' : 'blocks'}`;
    $('todayBlocks').innerHTML = blocks.length ? blocks.map(b => {
      const portion = Math.max(0, Math.min(ms(b.endedAt), endDay) - Math.max(ms(b.startedAt), startDay));
      return blockMarkup(b, portion, ms(b.startedAt) < startDay);
    }).join('') : `<div class="empty-state"><span class="empty-icon">◷</span>Your completed blocks will appear here.<br>One tap is all it takes to begin.</div>`;
  }

  function renderInsights(stats) {
    $('insightsTotal').textContent = formatHours(stats.sevenTotal);
    $('insightsAverage').textContent = formatHours(stats.sevenTotal / 7);
    const max = Math.max(1, ...stats.lastSeven.map(day => day.duration));
    $('weeklyBars').innerHTML = stats.lastSeven.map((day, i) => `<div class="weekly-day ${i === 6 ? 'today' : ''}" title="${escapeHtml(day.key)}: ${formatHours(day.duration)}"><span class="bar-hours">${day.duration ? formatShort(day.duration) : '–'}</span><div class="bar-track"><div class="bar-fill" style="height:${day.duration ? Math.max(4, day.duration / max * 100) : 0}%"></div></div><span class="bar-label">${escapeHtml(day.date.toLocaleDateString(undefined, { weekday: 'short' }))}</span></div>`).join('');
    const ordered = [...stats.categories.entries()].sort((a, b) => b[1] - a[1]);
    $('categoryBreakdown').innerHTML = ordered.length ? ordered.map(([cat, value]) => `<div><div class="category-heading"><span>${escapeHtml(cat || 'Uncategorized')}</span><strong>${formatHours(value)} · ${Math.round(value / stats.sevenTotal * 100)}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${value / stats.sevenTotal * 100}%"></div></div></div>`).join('') : '<div class="empty-state">Nothing to compare yet. Your first work block will start the picture.</div>';
    const recent = state.blocks.filter(b => !b.deletedAt).sort((a, b) => ms(b.endedAt) - ms(a.endedAt)).slice(0, 30);
    $('recentBlocks').innerHTML = recent.length ? recent.map(b => blockMarkup(b, null, true)).join('') : '<div class="empty-state">Your recent blocks will appear here.</div>';
  }

  function updateClock() {
    const now = Date.now();
    const thisDay = dateKey(new Date(now));
    if (thisDay !== lastDay) { lastDay = thisDay; render(); return; }
    const stats = buildStats(now);
    const active = state.active;
    $('timerDisplay').textContent = active ? formatClock(now - ms(active.startedAt)) : '00:00:00';
    $('todayTotal').textContent = formatHours(stats.daily.get(thisDay) || 0);
    $('weekTotal').textContent = formatHours(stats.sevenTotal);
    if (currentTab === 'insights') renderInsights(stats);
  }

  function render() {
    lastDay = dateKey(new Date());
    $('todayDate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
    const running = Boolean(state.active);
    $('timerCard').classList.toggle('running', running);
    $('statusText').textContent = running ? 'Tracking your work' : 'Ready when you are';
    $('timerDescription').textContent = running ? `Started at ${timeLabel(ms(state.active.startedAt))} · keep going` : 'Start a block whenever you begin working';
    $('timerButtonLabel').textContent = running ? 'Stop working' : 'Start working';
    $('timerButtonIcon').textContent = running ? '■' : '▶';
    $('activeCategory').value = running ? state.active.category : pendingCategory;
    $('todayView').hidden = currentTab !== 'today';
    $('insightsView').hidden = currentTab !== 'insights';
    $('todayTab').classList.toggle('active', currentTab === 'today');
    $('insightsTab').classList.toggle('active', currentTab === 'insights');
    if (currentTab === 'today') { $('todayTab').setAttribute('aria-current','page'); $('insightsTab').removeAttribute('aria-current'); }
    else { $('insightsTab').setAttribute('aria-current','page'); $('todayTab').removeAttribute('aria-current'); }
    $('storageState').textContent = storageError ? '⚠ Storage unavailable' : '● Saved on this device';
    renderTodayList();
    updateClock();
  }

  function overlaps(start, end, excludeId = null) {
    return state.blocks.some(b => !b.deletedAt && b.id !== excludeId && start < ms(b.endedAt) && ms(b.startedAt) < end)
      || Boolean(state.active && start < Date.now() && ms(state.active.startedAt) < end);
  }

  function startOrStop() {
    if (!state.active) {
      const category = safeCategory($('activeCategory').value);
      const succeeded = commit(s => { if (s.active) return false; s.active = { id: id(), startedAt: isoNow(), category }; });
      if (succeeded) toast('Tracking started');
    } else {
      const succeeded = commit(s => {
        if (!s.active) return false;
        const end = new Date(Math.max(Date.now(), ms(s.active.startedAt) + 1)).toISOString();
        s.blocks.push({ ...s.active, endedAt: end, note: '', updatedAt: isoNow(), deletedAt: null });
        s.active = null;
      });
      if (succeeded) { pendingCategory = ''; $('activeCategory').value = ''; toast('Block saved'); }
    }
  }

  function localInputValue(instant) {
    const d = new Date(instant);
    return `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function openBlockDialog(block = null) {
    editingId = block?.id || null;
    $('blockDialogTitle').textContent = block ? 'Edit block' : 'Add a block';
    const now = Date.now();
    $('startInput').value = localInputValue(block ? ms(block.startedAt) : now - 60 * 60 * 1000);
    $('endInput').value = localInputValue(block ? ms(block.endedAt) : now);
    $('editCategory').value = block ? block.category : '';
    $('noteInput').value = block ? block.note : '';
    $('formError').hidden = true;
    $('deleteBlockBtn').hidden = !block;
    $('blockDialog').showModal();
  }

  function saveForm(event) {
    event.preventDefault();
    const original = editingId ? state.blocks.find(x => x.id === editingId && !x.deletedAt) : null;
    // Preserve sub-second precision when a user edits only the category or note.
    const a = original && localInputValue(original.startedAt) === $('startInput').value
      ? ms(original.startedAt) : new Date($('startInput').value).getTime();
    const b = original && localInputValue(original.endedAt) === $('endInput').value
      ? ms(original.endedAt) : new Date($('endInput').value).getTime();
    const error = $('formError');
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) { error.textContent = 'End must be after start.'; error.hidden = false; return; }
    if (overlaps(a, b, editingId)) { error.textContent = 'This overlaps another block or the active timer. Adjust the times first.'; error.hidden = false; return; }
    const saved = commit(s => {
      const values = { startedAt: new Date(a).toISOString(), endedAt: new Date(b).toISOString(), category: safeCategory($('editCategory').value), note: $('noteInput').value.trim().slice(0, 140), updatedAt: isoNow() };
      if (editingId) {
        const found = s.blocks.find(x => x.id === editingId && !x.deletedAt);
        if (!found) return false;
        Object.assign(found, values);
      } else s.blocks.push({ id: id(), ...values, deletedAt: null });
    });
    if (saved) { $('blockDialog').close(); toast(editingId ? 'Block updated' : 'Block added'); }
  }

  function downloadFile(name, type, content) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
  function exportCsv() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
    const headers = ['id', 'date_local', 'start_local', 'end_local', 'start_iso', 'end_iso', 'category', 'note', 'duration_minutes', 'timezone', 'updated_at'];
    const rows = state.blocks.filter(b => !b.deletedAt).sort((a,b) => ms(a.startedAt) - ms(b.startedAt)).map(b => {
      const local = value => `${dateKey(new Date(value))} ${timeLabel(ms(value))}`;
      return [b.id, dateKey(new Date(b.startedAt)), local(b.startedAt), local(b.endedAt), b.startedAt, b.endedAt, b.category, b.note, ((ms(b.endedAt) - ms(b.startedAt)) / 60000).toFixed(2), tz, b.updatedAt];
    });
    const contents = '\ufeff' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    downloadFile(`workblocks-${dateKey(new Date())}.csv`, 'text/csv;charset=utf-8', contents);
    toast('CSV exported');
  }

  function exportJson() {
    const backup = { ...state, exportedAt: isoNow(), app: 'Workblocks' };
    downloadFile(`workblocks-backup-${dateKey(new Date())}.json`, 'application/json', JSON.stringify(backup, null, 2));
    toast('Backup exported');
  }

  async function importJson(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      if (raw?.app !== 'Workblocks' || raw.version !== 1 || !Array.isArray(raw.blocks)) throw new Error('Not a Workblocks v1 backup.');
      if (raw.blocks.some(b => !b || typeof b.id !== 'string' || !validDate(b.startedAt) || !validDate(b.endedAt) || ms(b.endedAt) <= ms(b.startedAt))) throw new Error('Backup includes invalid blocks.');
      if (!confirm(`Import ${raw.blocks.length} backup records? Existing records will be kept; matching IDs use the latest edit.`)) return;
      let imported = 0;
      const done = commit(s => {
        const merged = new Map(s.blocks.map(b => [b.id, b]));
        for (const b of raw.blocks) {
          const copy = { id: b.id, startedAt: b.startedAt, endedAt: b.endedAt, category: safeCategory(b.category), note: String(b.note || '').slice(0,140), updatedAt: validDate(b.updatedAt) ? b.updatedAt : b.endedAt, deletedAt: validDate(b.deletedAt) ? b.deletedAt : null };
          const current = merged.get(b.id);
          if (!current || ms(copy.updatedAt) > ms(current.updatedAt)) { merged.set(b.id, copy); imported++; }
        }
        s.blocks = [...merged.values()];
        // Do not restore a potentially stale running timer from an old backup.
      });
      if (done) toast(`${imported} new or updated records imported`);
    } catch (error) { toast(`Import failed: ${error.message}`); }
  }

  $('timerButton').addEventListener('click', startOrStop);
  $('activeCategory').addEventListener('change', event => {
    const category = safeCategory(event.target.value);
    if (state.active) commit(s => { if (!s.active) return false; s.active.category = category; });
    else pendingCategory = category;
  });
  $('todayTab').addEventListener('click', () => { currentTab = 'today'; render(); });
  $('insightsTab').addEventListener('click', () => { currentTab = 'insights'; render(); });
  $('addBlockBtn').addEventListener('click', () => openBlockDialog());
  $('blockForm').addEventListener('submit', saveForm);
  $('closeDialogBtn').addEventListener('click', () => $('blockDialog').close());
  $('cancelBlockBtn').addEventListener('click', () => $('blockDialog').close());
  for (const el of [$('todayBlocks'), $('recentBlocks')]) el.addEventListener('click', event => {
    const edit = event.target.closest('[data-edit]');
    if (!edit) return;
    const block = state.blocks.find(b => b.id === edit.dataset.edit && !b.deletedAt);
    if (block) openBlockDialog(block);
  });
  // Delete from the edit dialog; confirmation prevents accidental data loss.
  const deleteButton = document.createElement('button');
  deleteButton.id = 'deleteBlockBtn'; deleteButton.type = 'button';
  deleteButton.className = 'secondary-button delete-button'; deleteButton.textContent = 'Delete';
  deleteButton.style.cssText = 'margin-right:auto;color:#a44b43';
  $('blockForm').querySelector('.modal-actions').prepend(deleteButton);
  deleteButton.addEventListener('click', () => {
    if (!editingId || !confirm('Delete this work block? You can recover it from an earlier JSON backup.')) return;
    if (commit(s => {
      const block = s.blocks.find(b => b.id === editingId && !b.deletedAt);
      if (!block) return false;
      block.deletedAt = isoNow(); block.updatedAt = block.deletedAt;
    })) { $('blockDialog').close(); toast('Block deleted'); }
  });
  $('blockDialog').addEventListener('close', () => { editingId = null; });

  $('dataBtn').addEventListener('click', () => $('dataDialog').showModal());
  $('closeDataBtn').addEventListener('click', () => $('dataDialog').close());
  $('dismissDataBtn').addEventListener('click', () => $('dataDialog').close());
  $('exportCsvBtn').addEventListener('click', exportCsv);
  $('exportJsonBtn').addEventListener('click', exportJson);
  $('importJsonInput').addEventListener('change', importJson);
  window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) { state = readState(); render(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { state = readState(); render(); } });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('installBtn').hidden = false; });
  $('installBtn').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null; $('installBtn').hidden = true;
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; $('installBtn').hidden = true; });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => { /* Remains usable online. */ }));
  }
  render();
  setInterval(updateClock, 1000);
})();
