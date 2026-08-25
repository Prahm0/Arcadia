const state = {
  data: null,
  anchorDate: new Date(),
  selectedDate: localDateKey(new Date()),
  calendarFilter: 'all',
  editingEvent: null,
  loading: false,
  eventSaving: false,
  activeView: 'dashboard',
  focusViewAfterHashChange: false
};

const initialTheme = getPreferredTheme();
document.documentElement.dataset.theme = initialTheme;

const elements = {
  shell: document.querySelector('.app-shell'),
  workspace: document.querySelector('.workspace'),
  views: [...document.querySelectorAll('[data-widget-view]')],
  viewButtons: [...document.querySelectorAll('[data-view]')],
  previewLinks: [...document.querySelectorAll('[data-preview-view]')],
  calendarOnly: [...document.querySelectorAll('[data-calendar-only]')],
  todayLabel: document.querySelector('#today-label'),
  greeting: document.querySelector('#greeting'),
  avatar: document.querySelector('#avatar'),
  profileMenu: document.querySelector('#profile-menu'),
  profileMenuAvatar: document.querySelector('#profile-menu-avatar'),
  profileMenuName: document.querySelector('#profile-menu-name'),
  profileMenuEmail: document.querySelector('#profile-menu-email'),
  weekSummary: document.querySelector('#week-summary'),
  calendarPreviewKicker: document.querySelector('#calendar-preview-kicker'),
  dashboardWeekStrip: document.querySelector('#dashboard-week-strip'),
  calendarPreview: document.querySelector('#calendar-preview'),
  pulsePreview: document.querySelector('#pulse-preview'),
  assistantPreview: document.querySelector('#assistant-preview'),
  dashboardAssistantState: document.querySelector('#dashboard-assistant-state'),
  dashboardComposer: document.querySelector('#dashboard-composer'),
  dashboardChatInput: document.querySelector('#dashboard-chat-input'),
  dashboardSend: document.querySelector('#dashboard-send-button'),
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
  eventConflicts: document.querySelector('#event-conflicts'),
  saveEventButton: document.querySelector('#save-event-button'),
  settingsDialog: document.querySelector('#settings-dialog'),
  accountDialog: document.querySelector('#account-dialog'),
  googleConnect: document.querySelector('#google-connect'),
  googleDisconnect: document.querySelector('#google-disconnect'),
  googleDetail: document.querySelector('#google-detail'),
  toast: document.querySelector('#toast')
};

bindControls();
loadDashboard();

function bindControls() {
  updateThemeToggle();
  activateView(viewFromHash());
  window.addEventListener('hashchange', () => {
    activateView(viewFromHash(), { focus: state.focusViewAfterHashChange });
    state.focusViewAfterHashChange = false;
  });
  document.querySelector('#theme-toggle').addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
    updateThemeToggle();
  });
  document.querySelector('#rail-toggle').addEventListener('click', () => {
    const open = elements.shell.classList.toggle('rail-open');
    const toggle = document.querySelector('#rail-toggle');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Collapse navigation' : 'Expand navigation');
  });
  elements.viewButtons.forEach((button) => button.addEventListener('click', () => {
    const hash = `#${button.dataset.view}`;
    state.focusViewAfterHashChange = true;
    if (location.hash === hash) {
      activateView(button.dataset.view, { focus: true });
      state.focusViewAfterHashChange = false;
    } else location.hash = hash;
  }));
  elements.previewLinks.forEach((link) => link.addEventListener('click', () => { state.focusViewAfterHashChange = true; }));
  document.querySelector('.rail-nav').addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const current = elements.viewButtons.indexOf(document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    const direction = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1;
    elements.viewButtons[(current + direction + elements.viewButtons.length) % elements.viewButtons.length].click();
  });
  document.querySelector('#settings-button').addEventListener('click', () => elements.settingsDialog.showModal());
  elements.avatar.addEventListener('click', (event) => {
    event.stopPropagation();
    setProfileMenu(!elements.profileMenu.classList.contains('open'));
  });
  document.querySelector('#account-menu-button').addEventListener('click', () => {
    setProfileMenu(false);
    elements.accountDialog.showModal();
  });
  document.querySelector('#profile-settings-button').addEventListener('click', () => {
    setProfileMenu(false);
    elements.settingsDialog.showModal();
  });
  document.querySelector('#invite-menu-button').addEventListener('click', inviteFriend);
  document.querySelector('#logout-menu-button').addEventListener('click', () => {
    setProfileMenu(false);
    location.assign('/signout-with-chatgpt?return_to=/');
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.profile-wrap')) setProfileMenu(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !elements.profileMenu.classList.contains('open')) return;
    setProfileMenu(false, { restoreFocus: true });
  });
  document.querySelector('#add-event-button').addEventListener('click', () => openEventDialog());
  elements.googleStatus.addEventListener('click', () => elements.settingsDialog.showModal());
  document.querySelector('#previous-week').addEventListener('click', () => moveWeek(-7));
  document.querySelector('#next-week').addEventListener('click', () => moveWeek(7));
  document.querySelector('#dashboard-previous-week').addEventListener('click', () => moveWeek(-7));
  document.querySelector('#dashboard-next-week').addEventListener('click', () => moveWeek(7));
  document.querySelector('#dashboard-add-event').addEventListener('click', () => openEventDialog());
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
  elements.dashboardComposer.addEventListener('submit', sendDashboardChat);
  document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => {
    elements.chatInput.value = button.dataset.prompt; elements.chatInput.focus();
  }));
  elements.googleConnect.addEventListener('click', handleGoogleAction);
  elements.googleDisconnect.addEventListener('click', disconnectGoogle);
  const params = new URLSearchParams(location.search);
  if (params.get('google') === 'connected') { toast('Google Calendar connected.'); history.replaceState({}, '', `${location.pathname}#calendar`); }
  if (params.get('google') === 'denied') { toast('Google Calendar connection was cancelled.'); history.replaceState({}, '', `${location.pathname}#calendar`); }
}

function viewFromHash() {
  const requested = location.hash.slice(1);
  if (['dashboard', 'calendar', 'weekly-pulse', 'assistant'].includes(requested)) return requested;
  history.replaceState({}, '', `${location.pathname}${location.search}#dashboard`);
  return 'dashboard';
}

function setProfileMenu(open, { restoreFocus = false } = {}) {
  elements.profileMenu.classList.toggle('open', open);
  elements.avatar.setAttribute('aria-expanded', String(open));
  if (open) elements.profileMenu.querySelector('[role="menuitem"]').focus();
  if (!open && restoreFocus) elements.avatar.focus();
}

async function inviteFriend() {
  setProfileMenu(false);
  const invite = { title: 'Arcadia', text: 'Plan your week with Arcadia.', url: location.origin };
  try {
    if (navigator.share) await navigator.share(invite);
    else {
      await navigator.clipboard.writeText(`${invite.text} ${invite.url}`);
      toast('Invite link copied.');
    }
  } catch (error) {
    if (error.name !== 'AbortError') toast('Could not share the invite right now.');
  }
}

function activateView(view, { focus = false } = {}) {
  const activeView = ['dashboard', 'calendar', 'weekly-pulse', 'assistant'].includes(view) ? view : 'dashboard';
  state.activeView = activeView;
  elements.workspace.dataset.view = activeView;
  for (const panel of elements.views) panel.hidden = panel.dataset.widgetView !== activeView;
  for (const button of elements.viewButtons) {
    const active = button.dataset.view === activeView;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  for (const element of elements.calendarOnly) element.hidden = activeView !== 'calendar';
  const viewTitle = { dashboard: 'Dashboard', calendar: 'Calendar', 'weekly-pulse': 'Weekly Pulse', assistant: 'AI Assistant' }[activeView];
  document.title = `${viewTitle} · Arcadia`;
  if (focus) document.querySelector(`[data-widget-view="${activeView}"] .panel-title`)?.focus({ preventScroll: true });
}

function getPreferredTheme() {
  try {
    return localStorage.getItem('arcadia-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  } catch {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
}

function saveTheme(theme) {
  try { localStorage.setItem('arcadia-theme', theme); } catch {}
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
    const previewError = `<div class="preview-empty">${escapeHtml(error.message)}</div>`;
    elements.calendarPreview.innerHTML = previewError;
    elements.pulsePreview.innerHTML = previewError;
    elements.assistantPreview.innerHTML = previewError;
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
  elements.avatar.setAttribute('aria-label', `Open profile menu for ${user.name}`);
  elements.profileMenuAvatar.textContent = initials || 'A';
  elements.profileMenuName.textContent = user.name;
  elements.profileMenuEmail.textContent = user.email;
  document.querySelector('#account-name').textContent = user.name;
  document.querySelector('#account-email').textContent = user.email;
  elements.weekSummary.textContent = `${formatRange(range)} · ${formatDuration(analytics.plannedMinutes)} planned`;
  renderDashboardPreviews(events, analytics, assistant, range);
  renderContext(events, analytics);
  renderWeek(range);
  renderAgenda(events);
  renderAnalytics(analytics);
  renderGoogle(google);
  renderMessages(assistant);
}

function renderDashboardPreviews(events, analytics, assistant, range) {
  elements.calendarPreviewKicker.textContent = formatRange(range);
  renderDashboardCalendar(events, range);

  const topSubject = analytics.subjectDistribution?.[0];
  elements.pulsePreview.innerHTML = `<div class="preview-metrics"><div class="preview-metric"><span>Focused</span><strong>${formatDuration(analytics.focusedMinutes)}</strong></div><div class="preview-metric"><span>Complete</span><strong>${Math.max(0, Math.min(100, analytics.completionRate))}%</strong></div><div class="preview-metric"><span>Capacity</span><strong>${capacityLabel(analytics.capacityMinutes)}</strong></div></div><p class="preview-detail">${topSubject ? `${escapeHtml(topSubject.subject)} leads your study mix with ${formatDuration(topSubject.minutes)} focused.` : 'Complete a study block to start building your study mix.'}</p>`;

  const latestAssistant = [...(assistant.messages || [])].reverse().find((message) => message.role === 'assistant');
  const fallback = assistant.configured ? 'Your calendar is ready. Ask me what to focus on next.' : 'The assistant is ready once OpenAI setup is complete.';
  const pending = assistant.proposals?.length || 0;
  elements.assistantPreview.innerHTML = `<p class="preview-message">${escapeHtml(latestAssistant?.content || fallback)}</p><div class="preview-status"><span>${pending ? `${pending} schedule proposal${pending === 1 ? '' : 's'} waiting` : 'No pending schedule changes'}</span><strong>${assistant.configured ? 'Ready' : 'Setup required'}</strong></div>`;
  elements.dashboardAssistantState.textContent = assistant.configured ? 'Ready' : 'Setup required';
  elements.dashboardChatInput.disabled = !assistant.configured;
  elements.dashboardSend.disabled = !assistant.configured;
  elements.dashboardChatInput.placeholder = assistant.configured ? 'Ask Arcadia to plan or adjust…' : 'OpenAI setup required';
}

function renderDashboardCalendar(events, range) {
  const start = new Date(range.start);
  elements.dashboardWeekStrip.innerHTML = '';
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(start); date.setUTCDate(start.getUTCDate() + index);
    const key = localDateKey(date);
    const button = document.createElement('button');
    button.type = 'button'; button.className = `preview-day${key === state.selectedDate ? ' active' : ''}`;
    button.setAttribute('aria-pressed', String(key === state.selectedDate));
    button.setAttribute('aria-label', date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }));
    if (key === state.selectedDate) button.setAttribute('aria-current', 'date');
    button.innerHTML = `${date.toLocaleDateString([], { weekday: 'narrow' })}<strong>${date.getDate()}</strong>`;
    button.addEventListener('click', () => {
      state.selectedDate = key;
      renderDashboardCalendar(events, range);
      renderWeek(range);
      renderAgenda(events);
    });
    elements.dashboardWeekStrip.append(button);
  }
  const selected = events
    .filter((event) => localDateKey(new Date(event.startAt)) === state.selectedDate && event.status !== 'cancelled')
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    .slice(0, 5);
  elements.calendarPreview.innerHTML = '';
  if (!selected.length) {
    elements.calendarPreview.innerHTML = '<div class="preview-empty">A clear day. Add a block or protect some recovery time.</div>';
  } else {
    const list = document.createElement('div'); list.className = 'preview-list';
    for (const event of selected) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = `preview-event${event.source === 'google' ? ' google' : ''}`;
      const detail = event.location || event.subject || formatDuration(minutesBetween(event.startAt, event.endAt));
      button.innerHTML = `<span class="preview-time">${event.allDay ? 'All day' : formatTime(event.startAt)}</span><span class="preview-bar"></span><span><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(detail)}</span></span>`;
      button.addEventListener('click', () => event.source === 'google'
        ? toast(`${event.title} comes from Google Calendar and is read-only in Arcadia.`)
        : openEventDialog(event));
      list.append(button);
    }
    elements.calendarPreview.append(list);
  }
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
    if (key === state.selectedDate) button.setAttribute('aria-current', 'date');
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
  button.addEventListener('click', () => event.source === 'google'
    ? toast(`${event.title} comes from Google Calendar and is read-only in Arcadia.`)
    : openEventDialog(event));
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

async function sendDashboardChat(event) {
  event.preventDefault();
  const message = elements.dashboardChatInput.value.trim();
  if (!message || state.loading || !state.data?.assistant?.configured) return;
  elements.dashboardChatInput.value = '';
  elements.dashboardChatInput.disabled = true;
  elements.dashboardSend.disabled = true;
  elements.assistantPreview.innerHTML = '<p class="preview-message">Thinking through your week…</p><div class="preview-status"><span>Your request is being reviewed</span><strong>Working</strong></div>';
  const responseNode = elements.assistantPreview.querySelector('.preview-message');
  let completed = false;
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message }) });
    if (!response.ok) throw new Error((await response.json()).error || 'The assistant is unavailable.');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    while (true) {
      const { value, done } = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) if (line.trim()) {
        const payload = JSON.parse(line);
        if (payload.type === 'message') responseNode.textContent = payload.message.content;
        if (payload.type === 'error') throw new Error(payload.message);
      }
      if (done) break;
    }
    completed = true;
  } catch (error) {
    responseNode.textContent = error.message;
    elements.assistantPreview.querySelector('.preview-status').innerHTML = '<span>Try again when you are ready</span><strong>Unavailable</strong>';
  } finally {
    if (completed) await loadDashboard();
    elements.dashboardChatInput.disabled = !state.data?.assistant?.configured;
    elements.dashboardSend.disabled = !state.data?.assistant?.configured;
    elements.dashboardChatInput.focus();
  }
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
  elements.eventConflicts.hidden = true;
  elements.eventConflicts.replaceChildren();
  elements.saveEventButton.dataset.idleLabel = event ? 'Save changes' : 'Save to plan';
  elements.saveEventButton.textContent = elements.saveEventButton.dataset.idleLabel;
  document.querySelector('#delete-event-button').hidden = !event;
  const completeButton = document.querySelector('#complete-event-button');
  completeButton.hidden = !event; completeButton.textContent = event?.status === 'completed' ? 'Mark planned' : 'Mark complete';
  elements.eventDialog.showModal();
  setTimeout(() => document.querySelector('#event-title').focus(), 20);
}

async function saveEvent(event) {
  event.preventDefault();
  if (state.eventSaving) return;
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
  await persistEvent(id, body);
}

async function persistEvent(id, body, allowOverlap = false) {
  setEventFormBusy(true);
  document.querySelector('#event-error').textContent = '';
  elements.eventConflicts.hidden = true;
  try {
    await api(id ? `/api/events/${encodeURIComponent(id)}` : '/api/events', {
      method: id ? 'PATCH' : 'POST', body: JSON.stringify({ ...body, allowOverlap })
    });
    elements.eventDialog.close();
    toast(id ? 'Plan item updated.' : 'Added to your plan.');
    await loadDashboard();
  } catch (error) {
    if (error.status === 409 && error.data?.conflicts?.length) showEventConflicts(id, body, error.data.conflicts);
    else document.querySelector('#event-error').textContent = error.message;
  } finally { setEventFormBusy(false); }
}

function showEventConflicts(id, body, conflicts) {
  elements.eventConflicts.innerHTML = `<strong>This time overlaps your plan</strong><p>Choose another time, or save it anyway if the overlap is intentional.</p><ul class="conflict-list">${conflicts.map((conflict) => `<li>${escapeHtml(conflict.title)} · ${formatTime(conflict.startAt)}–${formatTime(conflict.endAt)}</li>`).join('')}</ul><div class="conflict-actions"><button class="button" type="button" data-conflict-action="edit">Choose another time</button><button class="button primary" type="button" data-conflict-action="save">Save anyway</button></div>`;
  elements.eventConflicts.hidden = false;
  elements.eventConflicts.querySelector('[data-conflict-action="edit"]').addEventListener('click', () => {
    elements.eventConflicts.hidden = true;
    document.querySelector('#event-start').focus();
  });
  elements.eventConflicts.querySelector('[data-conflict-action="save"]').addEventListener('click', () => persistEvent(id, body, true));
}

function setEventFormBusy(busy) {
  state.eventSaving = busy;
  elements.eventForm.setAttribute('aria-busy', String(busy));
  elements.eventForm.querySelectorAll('button, input, select, textarea').forEach((control) => { control.disabled = busy; });
  elements.saveEventButton.textContent = busy ? 'Saving…' : (elements.saveEventButton.dataset.idleLabel || 'Save to plan');
}

async function removeEvent() {
  const id = document.querySelector('#event-id').value; if (!id || state.eventSaving) return;
  if (!window.confirm(`Delete “${document.querySelector('#event-title').value || 'this event'}”? This cannot be undone.`)) return;
  setEventFormBusy(true);
  try { await api(`/api/events/${encodeURIComponent(id)}`, { method: 'DELETE' }); elements.eventDialog.close(); toast('Removed from your plan.'); await loadDashboard(); }
  catch (error) { document.querySelector('#event-error').textContent = error.message; }
  finally { setEventFormBusy(false); }
}

async function toggleEventComplete() {
  const id = document.querySelector('#event-id').value; if (!id || state.eventSaving) return;
  setEventFormBusy(true);
  try { await api(`/api/events/${encodeURIComponent(id)}/complete`, { method: 'POST' }); elements.eventDialog.close(); toast(state.editingEvent?.status === 'completed' ? 'Returned to your plan.' : 'Marked complete.'); await loadDashboard(); }
  catch (error) { document.querySelector('#event-error').textContent = error.message; }
  finally { setEventFormBusy(false); }
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
function setLoading(value) {
  state.loading = value;
  elements.workspace.classList.toggle('loading', value);
  document.querySelector('.dashboard-grid').setAttribute('aria-busy', String(value));
  document.querySelector('#previous-week').disabled = value;
  document.querySelector('#next-week').disabled = value;
  document.querySelector('#dashboard-previous-week').disabled = value;
  document.querySelector('#dashboard-next-week').disabled = value;
  document.querySelector('#dashboard-add-event').disabled = value;
}
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
  if (!response.ok) {
    const error = new Error(data.error || 'Arcadia could not complete that request.');
    error.status = response.status; error.data = data; throw error;
  }
  return data;
}
