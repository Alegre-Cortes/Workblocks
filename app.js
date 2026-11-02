/* Workblocks v0.2 — dependency-free, offline-first, preserves v1 session data. */
(() => {
  'use strict';
  const STORAGE_KEY = 'workblocks.state.v1'; // Intentionally unchanged: retain v0.1 records.
  const PREFS_KEY = 'workblocks.preferences.v1';
  const DAY_MS = 86400000;
  const LONG_TIMER_MS = 10 * 3600000;
  const BACKUP_MS = 7 * DAY_MS;
  const defaultPrefs = () => ({ rememberCategory: true, lastCategory: '', lastBackupAt: null, backupSnoozeUntil: null, longDismissedId: '', longDismissedUntil: null });
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

  function readPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null') || {};
      return { ...defaultPrefs(), ...raw, rememberCategory: raw.rememberCategory !== false, lastCategory: safeCategory(raw.lastCategory) };
    } catch (_) { return defaultPrefs(); }
  }
  let prefs = readPrefs();
  function savePrefs(changes) {
    const next = { ...prefs, ...changes };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); prefs = next; return true; }
    catch (_) { toast('Could not save preferences on this device'); return false; }
  }
  let state = readState();
  let pendingCategory = prefs.rememberCategory ? prefs.lastCategory : '';
  let currentTab = 'today';
  let periodMode = 'seven';
  let historyMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let historySelected = dateKey(new Date());
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

  function rangeFromMode(mode, now = new Date()) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start, end, label;
    if (mode === 'week') {
      start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (today.getDay() + 6) % 7);
      end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
      label = 'Monday to Sunday · current calendar week';
    } else if (mode === 'month' || mode === 'previousMonth') {
      const shift = mode === 'previousMonth' ? -1 : 0;
      start = new Date(today.getFullYear(), today.getMonth() + shift, 1);
      end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      label = start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    } else if (mode === 'year') {
      start = new Date(today.getFullYear(), 0, 1);
      end = new Date(today.getFullYear() + 1, 0, 1);
      label = String(today.getFullYear());
    } else {
      start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
      end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      label = 'Last seven calendar days (including today)';
    }
    return { start, end, label };
  }

  function makePeriodStats(mode, now = Date.now()) {
    const { start, end, label } = rangeFromMode(mode, new Date(now));
    const startMs = start.getTime(), endMs = end.getTime();
    const dayTotals = new Map(), categories = new Map();
    for (const b of currentBlocks(now)) {
      const a = Math.max(startMs, b.start), z = Math.min(endMs, b.end);
      if (z <= a) continue;
      eachDaySlice(a, z, (key, amount) => dayTotals.set(key, (dayTotals.get(key) || 0) + amount));
      categories.set(b.category || '', (categories.get(b.category || '') || 0) + z - a);
    }
    const total = [...dayTotals.values()].reduce((a,b) => a + b, 0);
    const activeDays = [...dayTotals.values()].filter(n => n > 0).length;
    const buckets = [];
    if (mode === 'year') {
      for (let i = 0; i < 12; i++) {
        const d = new Date(start.getFullYear(), i, 1), endMonth = new Date(start.getFullYear(), i+1, 1);
        let value = 0;
        for (const [day, amount] of dayTotals) if (day >= dateKey(d) && day < dateKey(endMonth)) value += amount;
        buckets.push({ label: d.toLocaleDateString(undefined,{month:'short'}), value });
      }
    } else if (mode === 'month' || mode === 'previousMonth') {
      let cursor = new Date(start);
      while (cursor < end) {
        const until = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + (7 - (cursor.getDay() + 6) % 7));
        const endBucket = until > end ? end : until;
        let value = 0;
        for (const [day, amount] of dayTotals) if (day >= dateKey(cursor) && day < dateKey(endBucket)) value += amount;
        buckets.push({label:`${cursor.getDate()}–${new Date(endBucket.getTime()-1).getDate()}`, value});
        cursor = new Date(endBucket);
      }
    } else {
      for (let d = new Date(start); d < end; d.setDate(d.getDate()+1)) {
        const key = dateKey(d);
        buckets.push({ label: d.toLocaleDateString(undefined,{weekday:'short'}), value: dayTotals.get(key) || 0 });
      }
    }
    return {total, activeDays, categories, buckets, label};
  }

  function renderHistory() {
    const first = new Date(historyMonth.getFullYear(), historyMonth.getMonth(), 1);
    $('historyMonthTitle').textContent = first.toLocaleDateString(undefined,{month:'long',year:'numeric'});
    const monthStart = (first.getDay() + 6) % 7;
    const count = new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
    const daily = buildStats().daily;
    // buildStats includes all historical daily totals, even outside the seven-day summary.
    let html = '';
    for (let i=0; i<monthStart; i++) html += '<span class="calendar-blank" aria-hidden="true"></span>';
    for (let n=1; n<=count; n++) {
      const d = new Date(first.getFullYear(),first.getMonth(),n), key = dateKey(d), amount = daily.get(key) || 0;
      const selected = key === historySelected, today = key === dateKey(new Date());
      html += `<button type="button" class="calendar-day ${selected ? 'selected' : ''} ${today ? 'is-today' : ''}" data-date="${key}" aria-pressed="${selected}" aria-label="${escapeHtml(d.toDateString())}, ${formatHours(amount)}"><span>${n}</span><small>${amount ? formatShort(amount) : '·'}</small></button>`;
    }
    $('calendarGrid').innerHTML = html;
    const [y,m,d] = historySelected.split('-').map(Number);
    const begin = new Date(y,m-1,d).getTime(), finish = new Date(y,m-1,d+1).getTime();
    const blocks = state.blocks.filter(b => !b.deletedAt && ms(b.startedAt)<finish && ms(b.endedAt)>begin).sort((a,b)=>ms(b.endedAt)-ms(a.endedAt));
    $('historySelectedTitle').textContent = new Date(y,m-1,d).toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long'});
    $('historyDayTotal').textContent = `${formatHours(daily.get(historySelected) || 0)} · ${blocks.length} completed blocks`;
    $('historyBlocks').innerHTML = blocks.length ? blocks.map(b=>blockMarkup(b,Math.max(0,Math.min(ms(b.endedAt),finish)-Math.max(ms(b.startedAt),begin)),ms(b.startedAt)<begin)).join('') : '<div class="empty-state">No completed blocks on this day. You can add one above.</div>';
  }

  function updateRecoveryNotices(now = Date.now()) {
    const a = state.active;
    $('forgotStartBtn').hidden = Boolean(a);
    $('fixStartBtn').hidden = !a;
    $('longTimerNotice').hidden = !a || now - ms(a.startedAt) < LONG_TIMER_MS ||
      (prefs.longDismissedId === a.id && ms(prefs.longDismissedUntil) > now);
    const saved = state.blocks.filter(b=>!b.deletedAt);
    const oldest = saved.length ? Math.min(...saved.map(b=>ms(b.startedAt))) : now;
    const lastBackup = validDate(prefs.lastBackupAt) ? ms(prefs.lastBackupAt) : oldest;
    $('backupNotice').hidden = !saved.length || now - lastBackup < BACKUP_MS ||
      (validDate(prefs.backupSnoozeUntil) && ms(prefs.backupSnoozeUntil)>now);
  }

  function renderInsights() {
    const period = makePeriodStats(periodMode);
    $('periodDescription').textContent = period.label;
    $('insightsTotal').textContent = formatHours(period.total);
    $('insightsAverage').textContent = formatHours(period.activeDays ? period.total / period.activeDays : 0);
    $('activeDaysDescription').textContent = `${period.activeDays} active ${period.activeDays === 1 ? 'day' : 'days'} · averages exclude days with no tracked work`;
    $('workChartTitle').textContent = (periodMode === 'year') ? 'Monthly work' : (periodMode === 'month' || periodMode === 'previousMonth') ? 'Weekly work' : 'Daily work';
    const max = Math.max(1, ...period.buckets.map(day => day.value));
    $('weeklyBars').style.gridTemplateColumns = `repeat(${period.buckets.length},minmax(0,1fr))`;
    $('weeklyBars').innerHTML = period.buckets.map((day, i) => `<div class="weekly-day ${i === period.buckets.length-1 ? 'today' : ''}" title="${escapeHtml(day.label)}: ${formatHours(day.value)}"><span class="bar-hours">${day.value ? formatShort(day.value) : '–'}</span><div class="bar-track"><div class="bar-fill" style="height:${day.value ? Math.max(4, day.value/max*100) : 0}%"></div></div><span class="bar-label">${escapeHtml(day.label)}</span></div>`).join('');
    const ordered = [...period.categories.entries()].sort((a,b)=>b[1]-a[1]);
    $('categoryBreakdown').innerHTML = ordered.length ? ordered.map(([cat,value])=>`<div><div class="category-heading"><span>${escapeHtml(cat||'Uncategorized')}</span><strong>${formatHours(value)} · ${Math.round(value/period.total*100)}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${value/period.total*100}%"></div></div></div>`).join('') : '<div class="empty-state">No work recorded in this period yet.</div>';
    const recent = state.blocks.filter(b=>!b.deletedAt).sort((a,b)=>ms(b.endedAt)-ms(a.endedAt)).slice(0,30);
    $('recentBlocks').innerHTML = recent.length ? recent.map(b=>blockMarkup(b,null,true)).join('') : '<div class="empty-state">Your recent blocks will appear here.</div>';
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
    if (currentTab === 'insights') renderInsights();
    updateRecoveryNotices(now);
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
    $('rememberCategoryToggle').checked = prefs.rememberCategory;
    $('todayView').hidden = currentTab !== 'today';
    $('insightsView').hidden = currentTab !== 'insights';
    $('historyView').hidden = currentTab !== 'history';
    $('todayTab').classList.toggle('active', currentTab === 'today');
    $('insightsTab').classList.toggle('active', currentTab === 'insights');
    $('historyTab').classList.toggle('active', currentTab === 'history');
    if (currentTab === 'today') { $('todayTab').setAttribute('aria-current','page'); $('insightsTab').removeAttribute('aria-current'); }
    else if (currentTab === 'insights') { $('insightsTab').setAttribute('aria-current','page'); $('todayTab').removeAttribute('aria-current'); }
    else { $('todayTab').removeAttribute('aria-current'); $('insightsTab').removeAttribute('aria-current'); }
    if (currentTab === 'history') $('historyTab').setAttribute('aria-current','page');
    else $('historyTab').removeAttribute('aria-current');
    $('storageState').textContent = storageError ? '⚠ Storage unavailable' : '● Saved on this device';
    renderTodayList();
    if (currentTab === 'history') renderHistory();
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
      if (succeeded) {
        pendingCategory = prefs.rememberCategory ? prefs.lastCategory : '';
        $('activeCategory').value = pendingCategory;
        toast('Block saved');
      }
    }
  }

  function localInputValue(instant) {
    const d = new Date(instant);
    return `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function openBlockDialog(block = null, dayKey = null) {
    editingId = block?.id || null;
    $('blockDialogTitle').textContent = block ? 'Edit block' : 'Add a block';
    const now = Date.now();
    let start = now - 3600000, end = now;
    if (!block && dayKey && dayKey !== dateKey(new Date())) {
      const [y,m,d] = dayKey.split('-').map(Number);
      start = new Date(y,m-1,d,9,0).getTime(); end = start + 3600000;
    }
    $('startInput').value = localInputValue(block ? ms(block.startedAt) : start);
    $('endInput').value = localInputValue(block ? ms(block.endedAt) : end);
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

  function openStartDialog() {
    const running = Boolean(state.active);
    $('startDialogTitle').textContent = running ? 'Adjust start time' : 'Start earlier';
    $('saveStartBtn').textContent = running ? 'Save start time' : 'Start from this time';
    $('forgotStartInput').value = localInputValue(running ? ms(state.active.startedAt) : Date.now() - 30*60000);
    $('startError').hidden = true;
    $('startDialog').showModal();
  }

  function saveStart(event) {
    event.preventDefault();
    const start = new Date($('forgotStartInput').value).getTime(), now = Date.now();
    const error = $('startError');
    if (!Number.isFinite(start) || start >= now || start < now - 365*DAY_MS) {
      error.textContent = 'Choose a valid past start time (within the last year).'; error.hidden = false; return;
    }
    if (state.blocks.some(b => !b.deletedAt && start < ms(b.endedAt) && ms(b.startedAt) < now)) {
      error.textContent = 'This overlaps a completed block. Choose a later start time.'; error.hidden = false; return;
    }
    const running = Boolean(state.active);
    const saved = commit(s => {
      if (Boolean(s.active) !== running) return false;
      if (running) s.active.startedAt = new Date(start).toISOString();
      else s.active = {id:id(), startedAt:new Date(start).toISOString(), category:safeCategory($('activeCategory').value)};
    });
    if (saved) { $('startDialog').close(); toast(running ? 'Start time corrected' : 'Started from earlier time'); }
  }

  function openEndDialog() {
    if (!state.active) return;
    const start = ms(state.active.startedAt), now = Date.now();
    $('forgotEndInput').value = localInputValue(Math.min(now, start + 8*3600000));
    $('endError').hidden = true;
    $('endDialog').showModal();
  }

  function saveEnd(event) {
    event.preventDefault();
    const end = new Date($('forgotEndInput').value).getTime(), now = Date.now();
    const error = $('endError');
    if (!state.active || !Number.isFinite(end) || end <= ms(state.active.startedAt) || end > now) {
      error.textContent = 'End must be after the start and not in the future.'; error.hidden = false; return;
    }
    const saved = commit(s => {
      if (!s.active || end <= ms(s.active.startedAt)) return false;
      s.blocks.push({...s.active, endedAt:new Date(end).toISOString(), note:'',updatedAt:isoNow(),deletedAt:null});
      s.active = null;
    });
    if (saved) {
      pendingCategory = prefs.rememberCategory ? prefs.lastCategory : '';
      $('endDialog').close(); toast('End time corrected and block saved');
    }
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
    savePrefs({ lastBackupAt: isoNow(), backupSnoozeUntil: null });
    updateRecoveryNotices();
    toast('Backup download requested — keep the JSON file somewhere safe');
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
    if (prefs.rememberCategory) savePrefs({lastCategory:category});
  });
  $('todayTab').addEventListener('click', () => { currentTab = 'today'; render(); });
  $('insightsTab').addEventListener('click', () => { currentTab = 'insights'; render(); });
  $('historyTab').addEventListener('click', () => { currentTab = 'history'; render(); });
  $('periodSelect').addEventListener('change', event => { periodMode = event.target.value; renderInsights(); });
  $('previousMonthBtn').addEventListener('click', () => { historyMonth = new Date(historyMonth.getFullYear(),historyMonth.getMonth()-1,1); historySelected=dateKey(historyMonth); renderHistory(); });
  $('nextMonthBtn').addEventListener('click', () => { historyMonth = new Date(historyMonth.getFullYear(),historyMonth.getMonth()+1,1); historySelected=dateKey(historyMonth); renderHistory(); });
  $('calendarGrid').addEventListener('click', event => {
    const day = event.target.closest('[data-date]'); if (!day) return;
    historySelected = day.dataset.date; renderHistory();
  });
  $('addHistoryBlockBtn').addEventListener('click', () => openBlockDialog(null,historySelected));
  $('forgotStartBtn').addEventListener('click', openStartDialog);
  $('fixStartBtn').addEventListener('click', openStartDialog);
  $('startForm').addEventListener('submit', saveStart);
  $('closeStartBtn').addEventListener('click', () => $('startDialog').close());
  $('cancelStartBtn').addEventListener('click', () => $('startDialog').close());
  $('startPresets').addEventListener('click', event => {
    const preset = event.target.closest('[data-minutes]'); if (!preset) return;
    $('forgotStartInput').value = localInputValue(Date.now()-Number(preset.dataset.minutes)*60000);
  });
  $('fixEndBtn').addEventListener('click', openEndDialog);
  $('endForm').addEventListener('submit', saveEnd);
  $('closeEndBtn').addEventListener('click', () => $('endDialog').close());
  $('cancelEndBtn').addEventListener('click', () => $('endDialog').close());
  $('dismissLongBtn').addEventListener('click', () => {
    if (!state.active) return;
    savePrefs({longDismissedId:state.active.id,longDismissedUntil:new Date(Date.now()+DAY_MS).toISOString()});
    updateRecoveryNotices();
  });
  $('backupNowBtn').addEventListener('click', exportJson);
  $('backupLaterBtn').addEventListener('click', () => {savePrefs({backupSnoozeUntil:new Date(Date.now()+3*DAY_MS).toISOString()}); updateRecoveryNotices();});
  $('rememberCategoryToggle').addEventListener('change', event => {
    savePrefs({rememberCategory:event.target.checked});
    if (!state.active) {pendingCategory=event.target.checked?prefs.lastCategory:'';render();}
  });
  $('addBlockBtn').addEventListener('click', () => openBlockDialog());
  $('blockForm').addEventListener('submit', saveForm);
  $('closeDialogBtn').addEventListener('click', () => $('blockDialog').close());
  $('cancelBlockBtn').addEventListener('click', () => $('blockDialog').close());
  for (const el of [$('todayBlocks'), $('recentBlocks'), $('historyBlocks')]) el.addEventListener('click', event => {
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
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY) { state = readState(); render(); }
    if (event.key === PREFS_KEY) { prefs=readPrefs(); if(!state.active) pendingCategory=prefs.rememberCategory?prefs.lastCategory:''; render(); }
  });
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