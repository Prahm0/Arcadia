const state = {
  data: null,
  anchorDate: new Date(),
  selectedDate: localDateKey(new Date()),
  calendarFilter: 'all',
  editingEvent: null,
  loading: false
};

const savedTheme = localStorage.getItem('arcadia-theme');
const initialTheme = savedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
document.documentElement.dataset.theme = initialTheme;

const elements = {
  shell: document.querySelector('.app-shell'),
  workspace: document.querySelector('.workspace'),
  todayLabel: document.querySelector('#today-label'),
  greeting: document.querySelector('#greeting'),
  avatar: document.querySelector('#avatar'),
  weekSummary: document.querySelector('#week-summary'),
  weekStrip: document.querySelector('#week-strip'),
  agenda: document.querySelector('#agenda'),
  analytics: document.querySelector('#analytics-body'),
  subjectBreakdown: document.querySelector('#subject-breakdown'),
  contextNow: document.querySelector('#context-now'),
  contextNext: document.querySelector('#context-next'),
  contextLoad: document.querySelector('#context-load'),
  contextRecovery: document.querySelector('#context-recovery'),
  syncCaption: document.querySelector('#sync-caption'),
  googleStatus: document.querySelector('#google-status'),
  messages: document.querySelector('#messages'),
  proposals: document.querySelector('#proposals'),
  composer: document.querySelector('#composer'),
  chatInput: document.querySelector('#chat-input'),
  send: document.querySelector('#send-button'),
  eventDialog: document.querySelector('#event-dialog'),
  eventForm: document.querySelector('#event-form'),
  settingsDialog: document.querySelector('#settings-dialog'),
  googleConnect: document.querySelector('#google-connect'),
  googleDisconnect: document.querySelector('#google-disconnect'),
  googleDetail: document.querySelector('#google-detail'),
  toast: document.querySelector('#toast')
};

bindControls();
loadDashboard();

function bindControls() {
  updateThemeToggle();
  document.querySelector('#theme-toggle').addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('arcadia-theme', theme);
    updateThemeToggle();
  });
  document.querySelector('#rail-toggle').addEventListener('click', () => {
    const open = elements.shell.classList.toggle('rail-open');
    document.querySelector('#rail-toggle').setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('[data-target]').forEach((button) => button.addEventListener('click', () => {
    document.querySelector(`#${button.dataset.target}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  document.querySelector('#settings-button').addEventListener('click', () => elements.settingsDialog.showModal());
  document.querySelector('#add-event-button').addEventListener('click', () => openEventDialog());
  elements.googleStatus.addEventListener('click', () => elements.settingsDialog.showModal());
  document.querySelector('#previous-week').addEventListener('click', () => moveWeek(-7));
  document.querySelector('#next-week').addEventListener('click', () => moveWeek(7));
  document.querySelector('#calendar-filters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]'); if (!button) return;
    state.calendarFilter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((item) => {
      const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active));
    });
    if (state.data) renderAgenda(state.data.events);
  });
  elements.eventForm.addEventListener('submit', saveEvent);
  document.querySelector('#delete-event-button').addEventListener('click', removeEvent);
  document.querySelector('#complete-event-button').addEventListener('click', toggleEventComplete);
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => document.querySelector(`#${button.dataset.close}`).close()));
  elements.composer.addEventListener('submit', sendChat);
  document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => {
    elements.chatInput.value = button.dataset.prompt; elements.chatInput.focus();
  }));
  elements.googleConnect.addEventListener('click', handleGoogleAction);
  elements.googleDisconnect.addEventListener('click', disconnectGoogle);
  const params = new URLSearchParams(location.search);
  if (params.get('google') === 'connected') { toast('Google Calendar connected.'); history.replaceState({}, '', '/'); }
  if (params.get('google') === 'denied') { toast('Google Calendar connection was cancelled.'); history.replaceState({}, '', '/'); }
}

function updateThemeToggle() {
  const button = document.querySelector('#theme-toggle');
  if (!button) return;
  const dark = document.documentElement.dataset.theme === 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#22242d' : '#f4f5f9');
  button.setAttribute('aria-pressed', String(dark));
  button.setAttribute('aria-label', dark ? 'Use light mode' : 'Use dark mode');
  button.textContent = dark ? '☼' : '◐';
}

function renderContext(events, analytics) {
  const now = new Date();
  const today = localDateKey(now);
  const todayEvents = events
    .filter((event) => localDateKey(new Date(event.startAt)) === today && Date.parse(event.endAt) > now.getTime())
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const active = todayEvents.find((event) => Date.parse(event.startAt) <= now.getTime());
  const next = todayEvents.find((event) => Date.parse(event.startAt) > now.getTime());
  const nextSleep = todayEvents.find((event) => event.kind === 'sleep');

  elements.contextNow.textContent = active
    ? `In session · ${active.title}`
    : next
      ? `Clear for ${formatDuration(Math.max(0, Math.round((Date.parse(next.startAt) - now.getTime()) / 60000)))}`
      : 'Open for the rest of today';
  elements.contextNext.textContent = next ? `${next.title} · ${formatTime(next.startAt)}` : 'No more commitments';
  elements.contextLoad.textContent = `${capacityLabel(analytics.capacityMinutes)} · ${formatDuration(analytics.plannedMinutes)} planned`;
  elements.contextRecovery.textContent = nextSleep ? `Sleep target · ${formatTime(nextSleep.startAt)}` : 'Add a sleep target';
}

async function loadDashboard() {
  setLoading(true);
  try {
    const data = await api(`/api/dashboard?date=${encodeURIComponent(state.anchorDate.toISOString())}`);
    state.data = data;
    if (!isInRange(state.selectedDate, data.range)) state.selectedDate = localDateKey(new Date(data.range.start));
    renderDashboard();
  } catch (error) {
    elements.agenda.innerHTML = emptyState('Arcadia is unavailable', error.message);
    toast(error.message);
  } finally { setLoading(false); }
}

function renderDashboard() {
  const { user, events, analytics, google, assistant, range } = state.data;
  const today = new Date();
  elements.todayLabel.textContent = today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  elements.greeting.textContent = greetingFor(user.name);
  const initials = user.name.split(/\s|@/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  elements.avatar.textContent = initials || 'A';
  elements.avatar.setAttribute('aria-label', `Signed in as ${user.name}`);
  elements.weekSummary.textContent = `${formatRange(range)} · ${formatDuration(analytics.plannedMinutes)} planned`;
  renderContext(events, analytics);
  renderWeek(range);
  renderAgenda(events);
  renderAnalytics(analytics);
  renderGoogle(google);
  renderMessages(assistant);
}

function renderWeek(range) {
  const start = new Date(range.start);
  elements.weekStrip.innerHTML = '';
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(start); date.setUTCDate(start.getUTCDate() + index);
    const key = localDateKey(date);
    const button = document.createElement('button');
    button.className = `day${key === state.selectedDate ? ' active' : ''}`;
    button.type = 'button'; button.dataset.date = key;
    button.setAttribute('aria-pressed', String(key === state.selectedDate));
    button.innerHTML = `<span>${date.toLocaleDateString(undefined, { weekday: 'short' })}</span><strong>${date.getDate()}</strong>`;
    button.addEventListener('click', () => { state.selectedDate = key; renderWeek(range); renderAgenda(state.data.events); });
    elements.weekStrip.append(button);
  }
}

function renderAgenda(events) {
  const selected = events.filter((event) => localDateKey(new Date(event.startAt)) === state.selectedDate)
    .filter((event) => state.calendarFilter === 'all' || (state.calendarFilter === 'google' ? event.source === 'google' : event.kind === state.calendarFilter));
  elements.agenda.innerHTML = '';
  if (!selected.length) {
    elements.agenda.innerHTML = emptyState('A clear day', 'Add a study block, task, training session, or protected rest.');
    const button = document.createElement('button'); button.className = 'button primary'; button.type = 'button'; button.textContent = 'Add to plan';
    button.addEventListener('click', () => openEventDialog()); elements.agenda.querySelector('.empty-state').append(button); return;
  }
  const groups = [['Morning', 0, 12], ['Afternoon', 12, 17], ['Evening', 17, 24]];
  for (const [label, from, to] of groups) {
    const group = selected.filter((event) => { const hour = new Date(event.startAt).getHours(); return hour >= from && hour < to; });
    if (!group.length) continue;
    elements.agenda.insertAdjacentHTML('beforeend', `<div class="agenda-label">${label}</div>`);
    for (const event of group) elements.agenda.append(eventRow(event));
  }
}

function eventRow(event) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `event ${event.source === 'google' ? 'google' : event.kind}${event.status === 'completed' ? ' completed' : ''}`;
  button.innerHTML = `<span class="event-time">${event.allDay ? 'All day' : formatTime(event.startAt)}</span><span class="event-bar"></span><div class="event-copy"><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(event.location || event.subject || formatDuration(minutesBetween(event.startAt, event.endAt)))}</span></div><span class="event-badge">${event.source === 'google' ? 'Google' : event.status === 'completed' ? 'Done' : capitalise(event.kind)}</span>`;
  button.addEventListener('click', () => event.source === 'google' ? toast('Google events are read-only in Arcadia.') : openEventDialog(event));
  return button;
}

function renderAnalytics(analytics) {
  const topSubject = analytics.subjectDistribution[0];
  const rate = Math.max(0, Math.min(100, analytics.completionRate));
  elements.analytics.innerHTML = `
    <div class="metric"><span class="metric-label">Focused time</span><strong class="metric-value">${formatDuration(analytics.focusedMinutes)}</strong><span class="metric-note">${formatDuration(analytics.plannedMinutes)} planned</span><div class="mini-bars" aria-hidden="true"><span style="height:30%"></span><span style="height:48%"></span><span style="height:42%"></span><span style="height:68%"></span><span style="height:${Math.max(18, rate)}%"></span></div></div>
    <div class="metric"><span class="metric-label">Completion</span><strong class="metric-value">${rate}%</strong><span class="metric-note">${analytics.completedCount} of ${analytics.plannedCount} blocks</span><div class="ring" role="img" aria-label="${rate} percent complete" style="background:conic-gradient(var(--accent) 0 ${rate}%,var(--divider) ${rate}%)"></div></div>
    <div class="metric"><span class="metric-label">Capacity</span><strong class="metric-value">${capacityLabel(analytics.capacityMinutes)}</strong><span class="metric-note">${formatDuration(analytics.capacityMinutes)} open${topSubject ? ` · ${escapeHtml(topSubject.subject)} leads` : ''}</span><div class="mini-bars" aria-hidden="true"><span style="height:78%"></span><span style="height:58%"></span><span style="height:49%"></span><span style="height:34%"></span><span style="height:24%"></span></div></div>`;
  const subjects = analytics.subjectDistribution || [];
  if (!subjects.length) {
    elements.subjectBreakdown.innerHTML = '<strong>Study mix</strong><span class="subject-name">Complete a study block to build your mix</span><span class="subject-track"><span class="subject-fill" style="width:0"></span></span><span class="subject-minutes">0m</span>';
  } else {
    const max = Math.max(...subjects.map((item) => item.minutes), 1);
    elements.subjectBreakdown.innerHTML = `<strong>Study mix</strong>${subjects.slice(0, 3).map((item) => `<span class="subject-name">${escapeHtml(item.subject)}</span><span class="subject-track"><span class="subject-fill" style="width:${Math.round((item.minutes / max) * 100)}%"></span></span><span class="subject-minutes">${formatDuration(item.minutes)}</span>`).join('')}`;
  }
}

function renderGoogle(google) {
  const label = elements.googleStatus.querySelector('span:last-child');
  if (!google.configured) {
    label.textContent = 'Google setup required';
    elements.googleDetail.textContent = 'Google Calendar is built in, but the site owner still needs to add the Google OAuth credentials before it can connect.';
    elements.googleConnect.textContent = 'Setup required'; elements.googleDisconnect.hidden = true;
  } else if (google.connected) {
    label.textContent = 'Google Calendar connected';
    elements.googleDetail.textContent = `${google.calendars.length} calendar${google.calendars.length === 1 ? '' : 's'} connected. Existing events are read-only; Arcadia study blocks sync to the Arcadia calendar.`;
    elements.googleConnect.textContent = 'Sync now'; elements.googleDisconnect.hidden = false;
  } else {
    label.textContent = 'Google Calendar not connected';
    elements.googleDetail.textContent = 'Connect your calendars so Arcadia can plan around real commitments. Arcadia only writes study blocks to its own Google calendar.';
    elements.googleConnect.textContent = 'Connect Google'; elements.googleDisconnect.hidden = true;
  }
  elements.syncCaption.textContent = google.connected
    ? `Google ${google.lastSyncAt ? `· synced ${relativeTime(google.lastSyncAt)}` : '· sync pending'}`
    : 'Arcadia calendar only';
}

function renderMessages(assistant) {
  elements.messages.innerHTML = '';
  const messages = assistant.messages.length ? assistant.messages : [{ role: 'assistant', content: assistant.configured ? 'Your calendar is ready. Ask me what to focus on, or tell me how your week needs to change.' : 'The planning assistant is built and waiting for its OpenAI API key.' }];
  for (const message of messages) appendMessage(message.role, message.content);
  renderProposals(assistant.proposals);
  elements.chatInput.disabled = !assistant.configured;
  elements.send.disabled = !assistant.configured;
  elements.chatInput.placeholder = assistant.configured ? 'Ask Arcadia to plan, explain or adjust…' : 'OpenAI setup required';
}

function renderProposals(proposals = []) {
  elements.proposals.innerHTML = '';
  for (const proposal of proposals) {
    const card = document.createElement('div'); card.className = 'proposal'; card.dataset.id = proposal.id;
    card.innerHTML = `<div class="proposal-top"><strong>${escapeHtml(proposal.summary)}</strong><span class="proposal-chip">Needs approval</span></div><p>${proposal.operations.map(operationSummary).join('<br>')}</p><div class="proposal-actions"><button class="button primary" type="button" data-action="apply">Apply</button><button class="button" type="button" data-action="decline">Decline</button></div>`;
    card.querySelector('[data-action="apply"]').addEventListener('click', () => handleProposal(proposal.id, 'apply'));
    card.querySelector('[data-action="decline"]').addEventListener('click', () => handleProposal(proposal.id, 'decline'));
    elements.proposals.append(card);
  }
}

async function sendChat(event) {
  event.preventDefault();
  const message = elements.chatInput.value.trim(); if (!message || state.loading) return;
  elements.chatInput.value = ''; appendMessage('user', message); elements.send.disabled = true;
  const thinking = appendMessage('assistant', 'Thinking through your week…');
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message }) });
    if (!response.ok) throw new Error((await response.json()).error || 'The assistant is unavailable.');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    while (true) {
      const { value, done } = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) if (line.trim()) {
        const payload = JSON.parse(line);
        if (payload.type === 'message') { thinking.textContent = payload.message.content; if (payload.proposal) renderProposals([payload.proposal, ...(state.data.assistant.proposals || [])]); }
        if (payload.type === 'error') throw new Error(payload.message);
      }
      if (done) break;
    }
  } catch (error) { thinking.textContent = error.message; }
  finally { elements.send.disabled = !state.data.assistant.configured; elements.chatInput.focus(); }
}

async function handleProposal(id, action) {
  try { await api(`/api/proposals/${encodeURIComponent(id)}/${action}`, { method: 'POST' }); toast(action === 'apply' ? 'Schedule changes applied.' : 'Proposal declined.'); await loadDashboard(); }
  catch (error) { toast(error.message); }
}

function openEventDialog(event = null) {
  state.editingEvent = event;
  document.querySelector('#event-dialog-title').textContent = event ? 'Edit plan item' : 'Add to your plan';
  document.querySelector('#event-id').value = event?.id || '';
  document.querySelector('#event-title').value = event?.title || '';
  document.querySelector('#event-kind').value = event?.kind || 'study';
  document.querySelector('#event-subject').value = event?.subject || '';
  document.querySelector('#event-location').value = event?.location || '';
  document.querySelector('#event-description').value = event?.description || '';
  document.querySelector('#event-repeat').value = event?.recurrence && ['RRULE:FREQ=DAILY', 'RRULE:FREQ=WEEKLY'].includes(event.recurrence) ? event.recurrence : '';
  document.querySelector('#event-all-day').checked = Boolean(event?.allDay);
  const start = event ? new Date(event.startAt) : suggestedStart();
  const end = event ? new Date(event.endAt) : new Date(start.getTime() + 45 * 60000);
  document.querySelector('#event-start').value = localDateTimeValue(start);
  document.querySelector('#event-end').value = localDateTimeValue(end);
  document.querySelector('#event-error').textContent = '';
  document.querySelector('#delete-event-button').hidden = !event;
  const completeButton = document.querySelector('#complete-event-button');
  completeButton.hidden = !event; completeButton.textContent = event?.status === 'completed' ? 'Mark planned' : 'Mark complete';
  elements.eventDialog.showModal();
  setTimeout(() => document.querySelector('#event-title').focus(), 20);
}

async function saveEvent(event) {
  event.preventDefault();
  const id = document.querySelector('#event-id').value;
  const allDay = document.querySelector('#event-all-day').checked;
  const startValue = document.querySelector('#event-start').value;
  const endValue = document.querySelector('#event-end').value;
  const allDayStart = new Date(`${startValue.slice(0, 10)}T00:00:00.000Z`);
  let allDayEnd = new Date(`${endValue.slice(0, 10)}T00:00:00.000Z`);
  if (allDay && allDayEnd <= allDayStart) allDayEnd = new Date(allDayStart.getTime() + 86400000);
  const body = {
    title: document.querySelector('#event-title').value,
    kind: document.querySelector('#event-kind').value,
    subject: document.querySelector('#event-subject').value,
    location: document.querySelector('#event-location').value,
    description: document.querySelector('#event-description').value,
    recurrence: document.querySelector('#event-repeat').value || null,
    allDay,
    startAt: allDay ? allDayStart.toISOString() : new Date(startValue).toISOString(),
    endAt: allDay ? allDayEnd.toISOString() : new Date(endValue).toISOString()
  };
  try {
    await api(id ? `/api/events/${encodeURIComponent(id)}` : '/api/events', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    elements.eventDialog.close(); toast(id ? 'Plan item updated.' : 'Added to your plan.'); await loadDashboard();
  } catch (error) { document.querySelector('#event-error').textContent = error.message; }
}

async function removeEvent() {
  const id = document.querySelector('#event-id').value; if (!id) return;
  try { await api(`/api/events/${encodeURIComponent(id)}`, { method: 'DELETE' }); elements.eventDialog.close(); toast('Removed from your plan.'); await loadDashboard(); }
  catch (error) { document.querySelector('#event-error').textContent = error.message; }
}

async function toggleEventComplete() {
  const id = document.querySelector('#event-id').value; if (!id) return;
  try { await api(`/api/events/${encodeURIComponent(id)}/complete`, { method: 'POST' }); elements.eventDialog.close(); toast(state.editingEvent?.status === 'completed' ? 'Returned to your plan.' : 'Marked complete.'); await loadDashboard(); }
  catch (error) { document.querySelector('#event-error').textContent = error.message; }
}

async function handleGoogleAction() {
  const google = state.data.google;
  if (!google.configured) { toast('Add the Google OAuth credentials to enable this connection.'); return; }
  if (!google.connected) { location.href = '/api/google/connect'; return; }
  try { elements.googleConnect.disabled = true; await api('/api/google/sync', { method: 'POST' }); toast('Google Calendar is up to date.'); await loadDashboard(); }
  catch (error) { toast(error.message); } finally { elements.googleConnect.disabled = false; }
}

async function disconnectGoogle() {
  try { await api('/api/google/connection', { method: 'DELETE' }); toast('Google Calendar disconnected.'); await loadDashboard(); }
  catch (error) { toast(error.message); }
}

function moveWeek(days) { state.anchorDate = new Date(state.anchorDate.getTime() + days * 86400000); state.selectedDate = localDateKey(state.anchorDate); loadDashboard(); }
function suggestedStart() { const date = new Date(`${state.selectedDate}T10:00:00`); return Number.isNaN(date.valueOf()) ? new Date() : date; }
function appendMessage(role, content) { const node = document.createElement('div'); node.className = `message ${role}`; node.textContent = content; elements.messages.append(node); elements.messages.scrollTop = elements.messages.scrollHeight; return node; }
function operationSummary(operation) { const verb = operation.action === 'create' ? 'Add' : 'Move'; return `${verb} ${escapeHtml(operation.title || 'plan item')} · ${new Date(operation.startAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`; }
function setLoading(value) { state.loading = value; elements.workspace.classList.toggle('loading', value); }
function greetingFor(name) { const first = String(name || '').split(/[\s@]/)[0]; return first ? `${first}, your week is in view.` : 'Your week, in balance.'; }
function capacityLabel(minutes) { if (minutes >= 8 * 60) return 'Open'; if (minutes >= 4 * 60) return 'Good'; if (minutes >= 2 * 60) return 'Tight'; return 'Full'; }
function formatDuration(minutes) { const safe = Math.max(0, Number(minutes) || 0); const hours = Math.floor(safe / 60); const mins = safe % 60; return hours ? `${hours}h${mins ? ` ${mins}m` : ''}` : `${mins}m`; }
function formatTime(value) { return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function relativeTime(value) { const elapsed = Date.now() - Date.parse(value); if (!Number.isFinite(elapsed) || elapsed < 60000) return 'just now'; const minutes = Math.floor(elapsed / 60000); if (minutes < 60) return `${minutes}m ago`; const hours = Math.floor(minutes / 60); return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`; }
function formatRange(range) { const start = new Date(range.start); const end = new Date(Date.parse(range.end) - 86400000); return `${start.toLocaleDateString([], { day: 'numeric', month: 'short' })}–${end.toLocaleDateString([], { day: 'numeric', month: 'short' })}`; }
function minutesBetween(start, end) { return Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60000)); }
function localDateKey(date) { const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, '0'); const day = String(date.getDate()).padStart(2, '0'); return `${year}-${month}-${day}`; }
function localDateTimeValue(date) { const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return shifted.toISOString().slice(0, 16); }
function isInRange(key, range) { const value = Date.parse(`${key}T00:00:00Z`); return value >= Date.parse(range.start) && value < Date.parse(range.end); }
function capitalise(value) { return value ? value[0].toUpperCase() + value.slice(1) : ''; }
function emptyState(title, text) { return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div>`; }
function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function toast(message) { elements.toast.textContent = message; elements.toast.classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => elements.toast.classList.remove('visible'), 3500); }

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) } });
  let data = {}; try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw new Error(data.error || 'Arcadia could not complete that request.');
  return data;
}
