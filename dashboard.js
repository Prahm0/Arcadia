const { createIcons, icons: lucideIcons } = window.ArcadiaLucide;

const state = {
  data: null,
  anchorDate: new Date(),
  analyticsDate: new Date(),
  analyticsPeriod: 'day',
  analyticsRequest: 0,
  activeView: 'today',
  loading: false,
  saving: false
};

const elements = {
  shell: document.querySelector('.app-shell'), workspace: document.querySelector('.workspace'),
  viewButtons: [...document.querySelectorAll('[data-view]')], views: [...document.querySelectorAll('[data-view-panel]')],
  pageTitle: document.querySelector('#page-title'), pageEyebrow: document.querySelector('#page-eyebrow'),
  avatar: document.querySelector('#avatar'), accountMenu: document.querySelector('#account-menu'), briefing: document.querySelector('#briefing'),
  todayTimeline: document.querySelector('#today-timeline'), todaySummary: document.querySelector('#today-summary'),
  todayLoad: document.querySelector('#today-load'), focusList: document.querySelector('#focus-list'),
  progressMetrics: document.querySelector('#progress-metrics'), taskList: document.querySelector('#task-list'),
  weekLabel: document.querySelector('#week-label'), weekBoard: document.querySelector('#week-board'),
  analyticsContent: document.querySelector('#analytics-content'), analyticsMetrics: document.querySelector('#analytics-metrics'),
  analyticsRangeLabel: document.querySelector('#analytics-range-label'), subjectDistribution: document.querySelector('#subject-distribution'),
  analyticsNote: document.querySelector('#analytics-note'), analyticsPeriodButtons: [...document.querySelectorAll('[data-analytics-period]')],
  messages: document.querySelector('#messages'), proposals: document.querySelector('#proposals'),
  mentorStatus: document.querySelector('#mentor-status'), mentorContext: document.querySelector('#mentor-context'),
  composer: document.querySelector('#composer'), chatInput: document.querySelector('#chat-input'), send: document.querySelector('#send-button'),
  onboardingDialog: document.querySelector('#onboarding-dialog'), onboardingForm: document.querySelector('#onboarding-form'),
  onboardingClose: document.querySelector('#onboarding-close'), onboardingError: document.querySelector('#onboarding-error'),
  subjectRows: document.querySelector('#subject-rows'), taskRows: document.querySelector('#task-rows'),
  commitmentRows: document.querySelector('#commitment-rows'), taskDialog: document.querySelector('#task-dialog'),
  taskForm: document.querySelector('#task-form'), taskError: document.querySelector('#task-error'),
  settingsDialog: document.querySelector('#settings-dialog'), googleDetail: document.querySelector('#google-detail'),
  googleConnect: document.querySelector('#google-connect'), googleDisconnect: document.querySelector('#google-disconnect'),
  toast: document.querySelector('#toast')
};

document.documentElement.dataset.theme = preferredTheme();
bindControls();
renderIcons();
activateView(viewFromHash());
loadDashboard();

function bindControls() {
  updateThemeToggle();
  document.querySelector('#theme-toggle').addEventListener('click', () => {
    const themes = ['light', 'dark', 'midnight'];
    const current = themes.indexOf(document.documentElement.dataset.theme);
    const theme = themes[(current + 1) % themes.length];
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('arcadia-theme', theme); } catch {}
    updateThemeToggle();
  });
  document.querySelector('#rail-toggle').addEventListener('click', () => {
    const open = elements.shell.classList.toggle('rail-open');
    const button = document.querySelector('#rail-toggle');
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Collapse navigation' : 'Expand navigation');
    setIcon(button, open ? 'panel-left-close' : 'panel-left-open');
  });
  elements.viewButtons.forEach((button) => button.addEventListener('click', () => { location.hash = button.dataset.view; }));
  window.addEventListener('hashchange', () => activateView(viewFromHash()));
  elements.avatar.addEventListener('click', (event) => { event.stopPropagation(); toggleAccountMenu(); });
  document.querySelector('#account-settings-button').addEventListener('click', () => { closeAccountMenu(); elements.settingsDialog.showModal(); });
  document.querySelector('#account-sign-out-button').addEventListener('click', () => location.assign('/signout-with-chatgpt?return_to=/'));
  document.addEventListener('click', (event) => { if (!event.target.closest('.avatar-wrap')) closeAccountMenu(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !elements.accountMenu.hidden) { closeAccountMenu(); elements.avatar.focus(); } });
  document.querySelector('#life-setup-button').addEventListener('click', openLifeSetup);
  document.querySelector('#edit-life-button').addEventListener('click', () => { elements.settingsDialog.close(); openLifeSetup(); });
  document.querySelector('#add-task-button').addEventListener('click', openTaskDialog);
  document.querySelector('#rebuild-button').addEventListener('click', rebuildPlan);
  document.querySelector('#previous-week').addEventListener('click', () => moveWeek(-7));
  document.querySelector('#next-week').addEventListener('click', () => moveWeek(7));
  document.querySelector('#current-week').addEventListener('click', () => { state.anchorDate = new Date(); loadDashboard(); });
  elements.analyticsPeriodButtons.forEach((button) => button.addEventListener('click', () => {
    if (state.analyticsPeriod === button.dataset.analyticsPeriod) return;
    state.analyticsPeriod = button.dataset.analyticsPeriod;
    loadAnalytics();
  }));
  document.querySelector('#previous-analytics').addEventListener('click', () => moveAnalytics(-1));
  document.querySelector('#next-analytics').addEventListener('click', () => moveAnalytics(1));
  document.querySelector('#current-analytics').addEventListener('click', () => { state.analyticsDate = new Date(); loadAnalytics(); });
  document.querySelector('#add-subject-row').addEventListener('click', () => addSubjectRow());
  document.querySelector('#add-task-row').addEventListener('click', () => addTaskRow());
  document.querySelector('#add-commitment-row').addEventListener('click', () => addCommitmentRow());
  elements.onboardingForm.addEventListener('submit', saveOnboarding);
  elements.taskForm.addEventListener('submit', saveTask);
  elements.composer.addEventListener('submit', sendChat);
  document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => { elements.chatInput.value = button.dataset.prompt; elements.chatInput.focus(); }));
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => document.querySelector(`#${button.dataset.close}`).close()));
  elements.onboardingClose.addEventListener('click', () => elements.onboardingDialog.close());
  elements.googleConnect.addEventListener('click', handleGoogleAction);
  elements.googleDisconnect.addEventListener('click', disconnectGoogle);
  document.querySelector('#sign-out-button').addEventListener('click', () => location.assign('/signout-with-chatgpt?return_to=/'));
  const params = new URLSearchParams(location.search);
  if (params.get('google') === 'connected') { toast('Google Calendar connected.'); history.replaceState({}, '', `${location.pathname}#today`); }
  if (params.get('google') === 'denied') { toast('Google Calendar connection was cancelled.'); history.replaceState({}, '', `${location.pathname}#today`); }
}

function viewFromHash() {
  const requested = location.hash.slice(1);
  if (['today', 'schedule', 'analytics', 'study-group', 'mentor'].includes(requested)) return requested;
  history.replaceState({}, '', `${location.pathname}${location.search}#today`);
  return 'today';
}

function activateView(view) {
  state.activeView = ['today', 'schedule', 'analytics', 'study-group', 'mentor'].includes(view) ? view : 'today';
  elements.views.forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== state.activeView; });
  elements.viewButtons.forEach((button) => {
    const active = button.dataset.view === state.activeView;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  const titles = { today: 'Today', schedule: 'Schedule', analytics: 'Analytics', 'study-group': 'Study Group', mentor: 'AI Mentor' };
  elements.pageTitle.textContent = titles[state.activeView];
  document.title = `${titles[state.activeView]} · Arcadia`;
  updateHeader();
  if (state.activeView === 'analytics') loadAnalytics();
}

async function loadDashboard() {
  setLoading(true);
  try {
    const data = await api(`/api/dashboard?date=${encodeURIComponent(state.anchorDate.toISOString())}`);
    state.data = data;
    renderAll();
    if (!data.user.onboardingComplete && !elements.onboardingDialog.open) openLifeSetup({ firstRun: true });
  } catch (error) {
    const content = emptyState('Arcadia is unavailable', error.message);
    elements.todayTimeline.innerHTML = content;
    elements.weekBoard.innerHTML = content;
    elements.messages.innerHTML = content;
    toast(error.message);
  } finally { setLoading(false); }
}

function renderAll() {
  const { user } = state.data;
  const initials = user.name.split(/\s|@/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'A';
  elements.avatar.textContent = initials;
  elements.avatar.setAttribute('aria-label', `Open account menu for ${user.name}`);
  document.querySelector('#account-menu-name').textContent = user.name;
  document.querySelector('#account-menu-email').textContent = user.email || 'Arcadia account';
  document.querySelector('#account-name').textContent = user.name;
  document.querySelector('#account-email').textContent = user.email;
  updateHeader();
  renderToday();
  renderSchedule();
  renderMentor();
  renderGoogle();
}

function updateHeader() {
  if (!state.data) return;
  const { user, range } = state.data;
  if (state.activeView === 'today') {
    elements.pageEyebrow.textContent = zonedDate(new Date(), user.timezone, { weekday: 'long', day: 'numeric', month: 'long' });
    elements.pageTitle.textContent = `${firstName(user.name)}, here’s today.`;
  } else if (state.activeView === 'schedule') {
    elements.pageEyebrow.textContent = range ? `Week of ${zonedDate(range.start, user.timezone, { day: 'numeric', month: 'long' })}` : 'Weekly plan';
    elements.pageTitle.textContent = 'Schedule';
  } else if (state.activeView === 'analytics') {
    elements.pageEyebrow.textContent = 'Your study patterns';
    elements.pageTitle.textContent = 'Analytics';
  } else if (state.activeView === 'study-group') {
    elements.pageEyebrow.textContent = 'Study with your people';
    elements.pageTitle.textContent = 'Study Group';
  } else {
    elements.pageEyebrow.textContent = 'Plan, recover, adapt';
    elements.pageTitle.textContent = 'AI Mentor';
  }
}

async function loadAnalytics() {
  const requestId = ++state.analyticsRequest;
  const period = state.analyticsPeriod;
  updateAnalyticsControls();
  elements.analyticsContent.setAttribute('aria-busy', 'true');
  elements.analyticsContent.classList.add('loading');
  try {
    const result = await api(`/api/analytics?period=${encodeURIComponent(period)}&date=${encodeURIComponent(state.analyticsDate.toISOString())}`);
    if (requestId !== state.analyticsRequest) return;
    renderAnalytics(result);
  } catch (error) {
    if (requestId !== state.analyticsRequest) return;
    elements.analyticsMetrics.innerHTML = `<div class="analytics-card"><span>Analytics unavailable</span><strong>—</strong><small>${escapeHtml(error.message)}</small></div>`;
    elements.subjectDistribution.innerHTML = emptyState('Could not load progress', error.message);
    elements.analyticsNote.innerHTML = '<p>Your schedule is still safe. Try this view again in a moment.</p>';
  } finally {
    if (requestId === state.analyticsRequest) {
      elements.analyticsContent.setAttribute('aria-busy', 'false');
      elements.analyticsContent.classList.remove('loading');
    }
  }
}

function renderAnalytics({ period, range, analytics }) {
  const timezone = state.data?.user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  elements.analyticsRangeLabel.textContent = analyticsRangeText(period, range, timezone);
  elements.analyticsMetrics.innerHTML = [
    analyticsMetric('Focused time', formatDuration(analytics.focusedMinutes), analytics.focusedMinutes ? 'Completed study sessions' : 'No completed study yet'),
    analyticsMetric('Completion', `${analytics.completionRate}%`, analytics.plannedCount ? `${analytics.completedCount} of ${analytics.plannedCount} sessions` : 'No sessions in this period'),
    analyticsMetric('Completed', analytics.completedCount, analytics.completedCount === 1 ? 'Study session' : 'Study sessions'),
    analyticsMetric('Missed', analytics.missedCount, analytics.missedCount ? 'Ready to replan' : 'Nothing missed'),
    analyticsMetric('Current streak', analytics.currentStreak, analytics.currentStreak === 1 ? 'Day' : 'Days'),
    analyticsMetric('Capacity left', formatDuration(analytics.capacityMinutes), 'After scheduled study blocks')
  ].join('');

  elements.subjectDistribution.innerHTML = '';
  const subjects = analytics.subjectDistribution || [];
  if (!subjects.length) {
    elements.subjectDistribution.innerHTML = emptyState('No completed study yet', 'Complete a study block in this period to see your subject balance.');
  } else {
    const maximum = Math.max(...subjects.map((subject) => subject.minutes), 1);
    subjects.forEach((subject) => {
      const row = document.createElement('div'); row.className = 'subject-row';
      const width = Math.max(4, Math.round((subject.minutes / maximum) * 100));
      row.innerHTML = `<strong>${escapeHtml(subject.subject)}</strong><div class="subject-bar-track" role="img" aria-label="${escapeAttr(subject.subject)} ${escapeAttr(formatDuration(subject.minutes))}"><div class="subject-bar" style="width:${width}%"></div></div><span>${formatDuration(subject.minutes)}</span>`;
      elements.subjectDistribution.append(row);
    });
  }

  const summary = analytics.focusedMinutes
    ? `You completed <strong>${formatDuration(analytics.focusedMinutes)}</strong> of focused study with a <strong>${analytics.completionRate}% completion rate</strong>. ${analytics.missedCount ? `${analytics.missedCount} missed session${analytics.missedCount === 1 ? '' : 's'} can be replanned with your Mentor.` : 'Nothing was marked missed in this period.'}`
    : `There is no completed study in this period yet. You still have <strong>${formatDuration(analytics.capacityMinutes)}</strong> of unplanned capacity available.`;
  elements.analyticsNote.innerHTML = `<p>${summary}</p>`;
}

function analyticsMetric(label, value, detail) {
  return `<div class="analytics-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`;
}

function updateAnalyticsControls() {
  const labels = { day: 'Today', week: 'This week', month: 'This month' };
  elements.analyticsPeriodButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.analyticsPeriod === state.analyticsPeriod)));
  document.querySelector('#current-analytics').textContent = labels[state.analyticsPeriod];
  document.querySelector('#previous-analytics').setAttribute('aria-label', `Previous ${state.analyticsPeriod}`);
  document.querySelector('#next-analytics').setAttribute('aria-label', `Next ${state.analyticsPeriod}`);
}

function moveAnalytics(direction) {
  const next = new Date(state.analyticsDate);
  if (state.analyticsPeriod === 'month') { next.setUTCDate(1); next.setUTCMonth(next.getUTCMonth() + direction); }
  else next.setUTCDate(next.getUTCDate() + direction * (state.analyticsPeriod === 'week' ? 7 : 1));
  state.analyticsDate = next;
  loadAnalytics();
}

function renderToday() {
  const { user, events, analytics, focusTasks, tasks, briefing } = state.data;
  elements.briefing.textContent = briefing || 'Finish Life setup to generate a briefing from your real schedule.';
  const todayKey = dateKeyInZone(new Date(), user.timezone);
  const today = events.filter((event) => dateKeyInZone(event.startAt, user.timezone) === todayKey && event.status !== 'cancelled')
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const studyMinutes = today.filter((event) => event.category === 'study' && event.outcome === 'planned').reduce((sum, event) => sum + minutesBetween(event.startAt, event.endAt), 0);
  elements.todaySummary.textContent = today.length ? `${today.length} plan item${today.length === 1 ? '' : 's'} · ${formatDuration(studyMinutes)} of study` : 'A clear day, with no scheduled commitments.';
  elements.todayLoad.textContent = studyMinutes > 180 ? 'Heavy' : studyMinutes > 90 ? 'Balanced' : studyMinutes ? 'Light' : 'Clear';
  elements.todayTimeline.innerHTML = '';
  if (!today.length) {
    elements.todayTimeline.innerHTML = emptyState('Nothing scheduled today', tasks.some((task) => task.status === 'pending') ? 'Your open work is scheduled elsewhere in the week.' : 'Add a task or keep the day open.');
  } else today.forEach((event) => elements.todayTimeline.append(timelineItem(event)));

  elements.focusList.innerHTML = '';
  if (!focusTasks.length) elements.focusList.innerHTML = emptyState('No urgent work', 'Your active task list is clear.');
  else focusTasks.forEach((task) => elements.focusList.append(focusItem(task)));

  elements.progressMetrics.innerHTML = `<div class="metric"><span>Completed</span><strong>${analytics.completedCount}</strong><small>${formatDuration(analytics.focusedMinutes)} focused</small></div><div class="metric"><span>Completion</span><strong>${analytics.completionRate}%</strong><small>${analytics.missedCount ? `${analytics.missedCount} missed` : 'No missed blocks'}</small></div><div class="metric"><span>Current streak</span><strong>${analytics.currentStreak}</strong><small>${analytics.currentStreak === 1 ? 'day' : 'days'}</small></div>`;

  const openTasks = tasks.filter((task) => task.status === 'pending').slice(0, 6);
  elements.taskList.innerHTML = '';
  if (!openTasks.length) elements.taskList.innerHTML = emptyState('All caught up', 'New assignments will appear here.');
  else openTasks.forEach((task) => {
    const row = document.createElement('div'); row.className = 'task-row';
    row.innerHTML = `<div><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.subject || 'General')} · due ${escapeHtml(formatDue(task.dueAt, user.timezone))}</span></div><span class="task-remaining">${formatDuration(task.remainingMinutes)} left</span>`;
    elements.taskList.append(row);
  });
}

function timelineItem(event) {
  const item = document.createElement('div');
  item.className = `timeline-item ${categoryClass(event)}${event.outcome === 'completed' ? ' completed' : ''}`;
  const detail = [event.subject, event.location, formatDuration(minutesBetween(event.startAt, event.endAt))].filter(Boolean).join(' · ');
  const actionHtml = event.category === 'study' && event.outcome === 'planned'
    ? `<div class="timeline-actions"><button class="outcome-button complete" type="button" data-outcome="completed" aria-label="Mark ${escapeHtml(event.title)} complete"><i data-lucide="check" aria-hidden="true"></i></button><button class="outcome-button missed" type="button" data-outcome="missed" aria-label="Mark ${escapeHtml(event.title)} missed"><i data-lucide="x" aria-hidden="true"></i></button></div>`
    : `<span class="timeline-badge">${escapeHtml(event.outcome === 'completed' ? 'Done' : event.category)}</span>`;
  item.innerHTML = `<time class="timeline-time">${event.allDay ? 'All day' : formatTime(event.startAt, state.data.user.timezone)}</time><span class="timeline-bar"></span><div class="timeline-copy"><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(detail || event.category)}</span></div>${actionHtml}`;
  renderIcons(item);
  item.querySelectorAll('[data-outcome]').forEach((button) => button.addEventListener('click', () => recordOutcome(event, button.dataset.outcome, item)));
  return item;
}

function focusItem(task) {
  const item = document.createElement('div'); item.className = 'focus-item';
  const completed = Math.max(0, task.estimatedMinutes - task.remainingMinutes);
  const progress = task.estimatedMinutes ? Math.round((completed / task.estimatedMinutes) * 100) : 0;
  item.innerHTML = `<div class="focus-top"><div><strong>${escapeHtml(task.title)}</strong><div class="focus-meta"><span>${escapeHtml(task.subject || 'General')}</span><span>Due ${escapeHtml(formatDue(task.dueAt, state.data.user.timezone))}</span></div></div><span class="priority-dot" title="${task.priority === 3 ? 'High' : task.priority === 1 ? 'Low' : 'Normal'} priority"></span></div><div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div><div class="focus-meta"><span>${formatDuration(task.remainingMinutes)} remaining</span><span>${task.taskType}</span></div>`;
  return item;
}

async function recordOutcome(event, outcome, item) {
  if (state.saving) return;
  state.saving = true;
  item.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  if (outcome === 'completed') item.classList.add('completed');
  else item.style.opacity = '.35';
  try {
    const result = await api(`/api/events/${encodeURIComponent(event.id)}/outcome`, { method: 'POST', body: JSON.stringify({ outcome }) });
    toast(result.message);
    await loadDashboard();
  } catch (error) {
    toast(error.message);
    await loadDashboard();
  } finally { state.saving = false; }
}

function renderSchedule() {
  const { range, events, user } = state.data;
  elements.weekLabel.textContent = formatRange(range, user.timezone);
  elements.weekBoard.innerHTML = '';
  const start = new Date(range.start);
  const todayKey = dateKeyInZone(new Date(), user.timezone);
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(start); date.setUTCDate(start.getUTCDate() + index);
    const key = dateKeyInZone(date, user.timezone);
    const column = document.createElement('section'); column.className = `week-day${key === todayKey ? ' today' : ''}`;
    column.setAttribute('aria-label', zonedDate(date, user.timezone, { weekday: 'long', day: 'numeric', month: 'long' }));
    column.innerHTML = `<header class="week-day-head"><span>${zonedDate(date, user.timezone, { weekday: 'short' })}</span><strong>${zonedDate(date, user.timezone, { day: 'numeric' })}</strong></header>`;
    const dayEvents = events.filter((event) => dateKeyInZone(event.startAt, user.timezone) === key && event.status !== 'cancelled').sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
    if (!dayEvents.length) column.insertAdjacentHTML('beforeend', '<div class="day-empty">Open</div>');
    dayEvents.forEach((event) => {
      const node = document.createElement(event.category === 'study' && event.outcome === 'planned' ? 'button' : 'div');
      if (node.tagName === 'BUTTON') node.type = 'button';
      node.className = `week-event ${categoryClass(event)}${event.outcome === 'completed' ? ' completed' : ''}`;
      node.innerHTML = `<time>${event.allDay ? 'All day' : `${formatTime(event.startAt, user.timezone)}–${formatTime(event.endAt, user.timezone)}`}</time><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.subject || event.category)}</small>`;
      if (node.tagName === 'BUTTON') node.addEventListener('click', () => { location.hash = 'today'; toast(`Use Today to complete or miss “${event.title}”.`); });
      column.append(node);
    });
    elements.weekBoard.append(column);
  }
}

function renderMentor() {
  const { assistant, subjects, tasks, commitments, preferences, events, user } = state.data;
  elements.messages.innerHTML = '';
  const messages = assistant.messages.length ? assistant.messages : [{ role: 'assistant', content: state.data.briefing || 'Finish Life setup, then tell me what changed and I’ll update the real plan.' }];
  messages.forEach((message) => appendMessage(message.role, message.content));
  renderProposals(assistant.proposals);
  elements.mentorStatus.textContent = assistant.providerConfigured ? 'AI + planner ready' : 'Planner ready';
  const openTasks = tasks.filter((task) => task.status === 'pending');
  const todayKey = dateKeyInZone(new Date(), user.timezone);
  const todayCount = events.filter((event) => dateKeyInZone(event.startAt, user.timezone) === todayKey && event.status !== 'cancelled').length;
  elements.mentorContext.innerHTML = `<div class="context-row"><span>Student</span><strong>${escapeHtml(user.name)} · ${escapeHtml(user.grade || 'Grade not set')}</strong></div><div class="context-row"><span>Subjects</span><strong>${subjects.length ? subjects.map((item) => escapeHtml(item.name)).join(', ') : 'None yet'}</strong></div><div class="context-row"><span>Open work</span><strong>${openTasks.length} task${openTasks.length === 1 ? '' : 's'} · ${formatDuration(openTasks.reduce((sum, task) => sum + task.remainingMinutes, 0))} remaining</strong></div><div class="context-row"><span>Today</span><strong>${todayCount} plan item${todayCount === 1 ? '' : 's'}</strong></div><div class="context-row"><span>Fixed commitments</span><strong>${commitments.length} recurring or one-off</strong></div><div class="context-row"><span>Sleep protected</span><strong>${escapeHtml(preferences.bedtime)}–${escapeHtml(preferences.wakeTime)} · ${formatDuration(preferences.minimumSleepMinutes)} minimum</strong></div>`;
  elements.chatInput.disabled = !assistant.configured;
  elements.send.disabled = !assistant.configured;
}

function renderProposals(proposals = []) {
  elements.proposals.innerHTML = '';
  proposals.forEach((proposal) => {
    const card = document.createElement('div'); card.className = 'proposal';
    card.innerHTML = `<div class="proposal-top"><strong>${escapeHtml(proposal.summary)}</strong><span class="proposal-chip">Needs approval</span></div><p>${proposal.operations.map(operationSummary).join('<br>')}</p><div class="button-row" style="margin-top:10px"><button class="button primary small" type="button" data-action="apply">Apply</button><button class="button small" type="button" data-action="decline">Decline</button></div>`;
    card.querySelector('[data-action="apply"]').addEventListener('click', () => handleProposal(proposal.id, 'apply'));
    card.querySelector('[data-action="decline"]').addEventListener('click', () => handleProposal(proposal.id, 'decline'));
    elements.proposals.append(card);
  });
}

async function sendChat(event) {
  event.preventDefault();
  const message = elements.chatInput.value.trim();
  if (!message || state.saving) return;
  state.saving = true;
  elements.chatInput.value = '';
  appendMessage('user', message);
  const thinking = appendMessage('assistant', 'Reviewing your real plan…');
  elements.send.disabled = true;
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message }) });
    if (!response.ok) throw new Error((await response.json()).error || 'The Mentor is unavailable.');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let changed = false;
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) if (line.trim()) {
        const payload = JSON.parse(line);
        if (payload.type === 'message') { thinking.textContent = payload.message.content; changed = Boolean(payload.action || payload.proposal); }
        if (payload.type === 'error') throw new Error(payload.message);
      }
      if (done) break;
    }
    if (changed) await loadDashboard();
  } catch (error) { thinking.textContent = error.message; }
  finally { state.saving = false; elements.send.disabled = false; elements.chatInput.focus(); }
}

async function handleProposal(id, action) {
  try {
    await api(`/api/proposals/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
    toast(action === 'apply' ? 'Schedule changes applied.' : 'Proposal declined.');
    await loadDashboard();
  } catch (error) { toast(error.message); }
}

function openLifeSetup({ firstRun = false } = {}) {
  if (!state.data) return;
  const { user, subjects, tasks, commitments, preferences } = state.data;
  document.querySelector('#onboarding-name').value = user.name || '';
  document.querySelector('#onboarding-grade').value = user.grade || '';
  setSelectValue(document.querySelector('#onboarding-timezone'), user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Sydney');
  document.querySelector('#bedtime').value = preferences.bedtime || '22:30';
  document.querySelector('#wake-time').value = preferences.wakeTime || '06:30';
  document.querySelector('#minimum-sleep').value = (preferences.minimumSleepMinutes || 480) / 60;
  document.querySelector('#max-daily-study').value = preferences.maxDailyStudyMinutes || 180;
  document.querySelector('#preferred-session').value = preferences.preferredSessionMinutes || 60;
  document.querySelector('#break-minutes').value = preferences.breakMinutes || 15;
  elements.subjectRows.innerHTML = ''; elements.taskRows.innerHTML = ''; elements.commitmentRows.innerHTML = '';
  (subjects.length ? subjects : [{ name: '', color: '#8389ca', priority: 2 }]).forEach(addSubjectRow);
  const pending = tasks.filter((task) => task.status === 'pending');
  (pending.length ? pending : [{}]).forEach(addTaskRow);
  (commitments.length ? commitments : [{}]).forEach(addCommitmentRow);
  elements.onboardingError.textContent = '';
  elements.onboardingClose.hidden = firstRun || !user.onboardingComplete;
  document.querySelector('#onboarding-save').textContent = user.onboardingComplete ? 'Save and rebuild plan' : 'Generate my plan';
  elements.onboardingDialog.showModal();
}

function addSubjectRow(subject = {}) {
  const row = document.createElement('div'); row.className = 'input-row subject-input-row';
  row.innerHTML = `<div class="field"><label>Subject name</label><input data-field="name" maxlength="80" value="${escapeAttr(subject.name || '')}" placeholder="Maths" /></div><div class="field"><label>Colour</label><input data-field="color" type="color" value="${escapeAttr(subject.color || '#8389ca')}" /></div><div class="field"><label>Priority</label><select data-field="priority"><option value="1">Low</option><option value="2">Normal</option><option value="3">High</option></select></div><button class="remove-row" type="button" aria-label="Remove subject"><i data-lucide="x" aria-hidden="true"></i></button>`;
  renderIcons(row);
  row.querySelector('[data-field="priority"]').value = String(subject.priority || 2);
  row.querySelector('.remove-row').addEventListener('click', () => row.remove());
  elements.subjectRows.append(row);
}

function addTaskRow(task = {}) {
  const timezone = state.data?.user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dueDate = task.dueAt ? dateKeyInZone(task.dueAt, timezone) : '';
  const dueTime = task.dueAt ? zonedTime(task.dueAt, timezone) : '23:59';
  const row = document.createElement('div'); row.className = 'input-row task-input-row';
  row.innerHTML = `<div class="field"><label>Task title</label><input data-field="title" maxlength="120" value="${escapeAttr(task.title || '')}" placeholder="English assignment" /></div><div class="field"><label>Subject</label><input data-field="subject" maxlength="80" value="${escapeAttr(task.subject || '')}" placeholder="English" /></div><div class="field"><label>Due date</label><input data-field="dueDate" type="date" value="${escapeAttr(dueDate)}" /></div><div class="field"><label>Due time</label><input data-field="dueTime" type="time" value="${escapeAttr(dueTime)}" /></div><div class="field"><label>Minutes left</label><input data-field="estimatedMinutes" type="number" min="15" max="1440" step="15" value="${escapeAttr(task.remainingMinutes || task.estimatedMinutes || 60)}" /></div><div class="field"><label>Type</label><select data-field="taskType"><option value="homework">Homework</option><option value="assignment">Assignment</option><option value="exam">Exam / test</option><option value="revision">Revision</option><option value="project">Project</option><option value="other">Other</option></select></div><div class="field"><label>Priority</label><select data-field="priority"><option value="1">Low</option><option value="2">Normal</option><option value="3">High</option></select></div><button class="remove-row" type="button" aria-label="Remove task"><i data-lucide="x" aria-hidden="true"></i></button>`;
  renderIcons(row);
  row.querySelector('[data-field="taskType"]').value = task.taskType || 'homework';
  row.querySelector('[data-field="priority"]').value = String(task.priority || 2);
  row.querySelector('.remove-row').addEventListener('click', () => row.remove());
  elements.taskRows.append(row);
}

function addCommitmentRow(commitment = {}) {
  const row = document.createElement('div'); row.className = 'input-row commitment-input-row';
  row.innerHTML = `<div class="field"><label>Commitment</label><input data-field="title" maxlength="120" value="${escapeAttr(commitment.title || '')}" placeholder="School or football" /></div><div class="field"><label>Category</label><select data-field="category"><option value="school">School</option><option value="sport">Sport</option><option value="extracurricular">Extracurricular</option><option value="other">Other</option></select></div><div class="field"><label>Repeats</label><select data-field="recurrence"><option value="weekdays">Weekdays</option><option value="weekly">Weekly</option><option value="none">One-off</option></select></div><div class="field"><label>Weekday</label><select data-field="weekday"><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option><option value="0">Sunday</option></select></div><div class="field"><label>One-off date</label><input data-field="startDate" type="date" value="${escapeAttr(commitment.startDate || '')}" /></div><div class="field"><label>Starts</label><input data-field="startTime" type="time" value="${escapeAttr(commitment.startTime || '08:45')}" /></div><div class="field"><label>Ends</label><input data-field="endTime" type="time" value="${escapeAttr(commitment.endTime || '15:00')}" /></div><button class="remove-row" type="button" aria-label="Remove commitment"><i data-lucide="x" aria-hidden="true"></i></button>`;
  renderIcons(row);
  row.querySelector('[data-field="category"]').value = commitment.category || 'school';
  row.querySelector('[data-field="recurrence"]').value = commitment.recurrence || 'weekdays';
  row.querySelector('[data-field="weekday"]').value = String(commitment.weekday ?? 1);
  row.querySelector('.remove-row').addEventListener('click', () => row.remove());
  elements.commitmentRows.append(row);
}

async function saveOnboarding(event) {
  event.preventDefault();
  if (state.saving) return;
  elements.onboardingError.textContent = '';
  const timezone = document.querySelector('#onboarding-timezone').value;
  const subjects = rowsData(elements.subjectRows).filter((item) => item.name).map((item) => ({ name: item.name, color: item.color, icon: null, priority: Number(item.priority) }));
  const tasks = rowsData(elements.taskRows).filter((item) => item.title).map((item) => ({
    title: item.title, subject: item.subject, taskType: item.taskType,
    dueAt: zonedLocalToIso(item.dueDate, item.dueTime || '23:59', timezone), estimatedMinutes: Number(item.estimatedMinutes),
    priority: Number(item.priority), notes: ''
  }));
  const commitments = rowsData(elements.commitmentRows).filter((item) => item.title).map((item) => ({
    title: item.title, subject: null, category: item.category, recurrence: item.recurrence,
    weekday: item.recurrence === 'weekly' ? Number(item.weekday) : null,
    startDate: item.recurrence === 'none' ? item.startDate : null,
    startTime: item.startTime, endTime: item.endTime, notes: ''
  }));
  const body = {
    name: document.querySelector('#onboarding-name').value,
    grade: document.querySelector('#onboarding-grade').value,
    timezone, subjects, tasks, commitments,
    preferences: {
      bedtime: document.querySelector('#bedtime').value, wakeTime: document.querySelector('#wake-time').value,
      minimumSleepMinutes: Number(document.querySelector('#minimum-sleep').value) * 60,
      maxDailyStudyMinutes: Number(document.querySelector('#max-daily-study').value),
      preferredSessionMinutes: Number(document.querySelector('#preferred-session').value),
      breakMinutes: Number(document.querySelector('#break-minutes').value)
    }
  };
  if (!subjects.length) { elements.onboardingError.textContent = 'Add at least one subject.'; return; }
  if (tasks.some((task) => !task.dueAt)) { elements.onboardingError.textContent = 'Every task needs a valid due date and time.'; return; }
  state.saving = true; setFormBusy(elements.onboardingForm, true, '#onboarding-save', 'Building your plan…');
  try {
    const result = await api('/api/onboarding', { method: 'POST', body: JSON.stringify(body) });
    elements.onboardingDialog.close();
    state.anchorDate = new Date();
    toast(result.unscheduled?.length ? `Plan generated. ${result.unscheduled.length} task needs a capacity review.` : `Plan generated with ${result.createdCount} study blocks.`);
    await loadDashboard();
  } catch (error) { elements.onboardingError.textContent = error.message; }
  finally { state.saving = false; setFormBusy(elements.onboardingForm, false, '#onboarding-save', 'Save and rebuild plan'); }
}

function openTaskDialog() {
  if (!state.data?.user.onboardingComplete) { openLifeSetup({ firstRun: true }); return; }
  const select = document.querySelector('#task-subject');
  select.innerHTML = state.data.subjects.map((subject) => `<option value="${escapeAttr(subject.name)}">${escapeHtml(subject.name)}</option>`).join('');
  elements.taskForm.reset();
  document.querySelector('#task-duration').value = '60';
  document.querySelector('#task-priority').value = '2';
  const due = new Date(Date.now() + 2 * 86400000); due.setHours(23, 59, 0, 0);
  document.querySelector('#task-due').value = localDateTimeValue(due);
  elements.taskError.textContent = '';
  elements.taskDialog.showModal();
  document.querySelector('#task-title').focus();
}

async function saveTask(event) {
  event.preventDefault();
  if (state.saving) return;
  state.saving = true; elements.taskError.textContent = ''; setFormBusy(elements.taskForm, true, '#task-save', 'Adding and replanning…');
  const body = {
    title: document.querySelector('#task-title').value, subject: document.querySelector('#task-subject').value,
    taskType: document.querySelector('#task-type').value, dueAt: zonedLocalToIso(document.querySelector('#task-due').value.slice(0, 10), document.querySelector('#task-due').value.slice(11), state.data.user.timezone),
    estimatedMinutes: Number(document.querySelector('#task-duration').value), priority: Number(document.querySelector('#task-priority').value),
    notes: document.querySelector('#task-notes').value
  };
  try {
    const result = await api('/api/tasks', { method: 'POST', body: JSON.stringify(body) });
    elements.taskDialog.close();
    toast(result.schedule.unscheduled.length ? `${result.task.title} was added but needs a capacity review.` : `${result.task.title} was added and scheduled.`);
    await loadDashboard();
  } catch (error) { elements.taskError.textContent = error.message; }
  finally { state.saving = false; setFormBusy(elements.taskForm, false, '#task-save', 'Add and replan'); }
}

async function rebuildPlan() {
  if (state.saving || !state.data?.user.onboardingComplete) return;
  state.saving = true; const button = document.querySelector('#rebuild-button'); button.disabled = true; button.textContent = 'Rebuilding…';
  try {
    const result = await api('/api/schedule/generate', { method: 'POST', body: '{}' });
    toast(result.schedule.unscheduled.length ? `Plan rebuilt. ${result.schedule.unscheduled.length} task needs review.` : 'Your plan has been rebuilt around current commitments.');
    await loadDashboard();
  } catch (error) { toast(error.message); }
  finally { state.saving = false; button.disabled = false; button.textContent = 'Rebuild plan'; }
}

function renderGoogle() {
  const google = state.data.google;
  if (!google.configured) {
    elements.googleDetail.textContent = 'Google Calendar import is ready in the app, but the site owner must add the Google OAuth credentials before it can connect.';
    elements.googleConnect.textContent = 'Setup required'; elements.googleDisconnect.hidden = true;
  } else if (google.connected) {
    elements.googleDetail.textContent = `${google.calendars.length} calendar${google.calendars.length === 1 ? '' : 's'} connected. Imported events are fixed; generated study blocks sync to Arcadia’s Google calendar.`;
    elements.googleConnect.textContent = 'Sync now'; elements.googleDisconnect.hidden = false;
  } else {
    elements.googleDetail.textContent = 'Connect Google Calendar so imported events become fixed commitments. Arcadia only writes study blocks to its own calendar.';
    elements.googleConnect.textContent = 'Connect Google'; elements.googleDisconnect.hidden = true;
  }
}

async function handleGoogleAction() {
  const google = state.data.google;
  if (!google.configured) { toast('Google OAuth credentials are still required for this connection.'); return; }
  if (!google.connected) { location.href = '/api/google/connect'; return; }
  try { elements.googleConnect.disabled = true; await api('/api/google/sync', { method: 'POST' }); toast('Google Calendar is up to date.'); await loadDashboard(); }
  catch (error) { toast(error.message); } finally { elements.googleConnect.disabled = false; }
}

async function disconnectGoogle() {
  try { await api('/api/google/connection', { method: 'DELETE' }); toast('Google Calendar disconnected.'); await loadDashboard(); }
  catch (error) { toast(error.message); }
}

function moveWeek(days) { state.anchorDate = new Date(state.anchorDate.getTime() + days * 86400000); loadDashboard(); }
function rowsData(container) { return [...container.children].map((row) => Object.fromEntries([...row.querySelectorAll('[data-field]')].map((input) => [input.dataset.field, input.value.trim()]))); }
function setFormBusy(form, busy, buttonSelector, label) { form.querySelectorAll('button,input,select,textarea').forEach((control) => { control.disabled = busy; }); document.querySelector(buttonSelector).textContent = label; }
function setLoading(value) { state.loading = value; elements.workspace.classList.toggle('loading', value); elements.views.forEach((view) => view.setAttribute('aria-busy', String(value))); }
function setSelectValue(select, value) { if (![...select.options].some((option) => option.value === value)) select.add(new Option(value.replaceAll('_', ' '), value)); select.value = value; }
function appendMessage(role, content) { const node = document.createElement('div'); node.className = `message ${role}`; node.textContent = content; elements.messages.append(node); elements.messages.scrollTop = elements.messages.scrollHeight; return node; }
function operationSummary(operation) { const verb = operation.action === 'create' ? 'Add' : 'Move'; return `${verb} ${escapeHtml(operation.title || 'plan item')} · ${escapeHtml(formatDateTime(operation.startAt, state.data.user.timezone))}`; }
function categoryClass(event) { return ['school', 'study', 'sport', 'extracurricular', 'other'].includes(event.category) ? event.category : (event.kind === 'training' ? 'sport' : event.kind === 'study' ? 'study' : 'other'); }
function firstName(value) { return String(value || '').split(/[\s@]/)[0] || 'You'; }
function preferredTheme() { try { const saved = localStorage.getItem('arcadia-theme'); return ['light', 'dark', 'midnight'].includes(saved) ? saved : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch { return 'light'; } }
function updateThemeToggle() {
  const theme = document.documentElement.dataset.theme;
  const next = theme === 'light' ? { name: 'dark', icon: 'moon' } : theme === 'dark' ? { name: 'midnight', icon: 'sparkles' } : { name: 'light', icon: 'sun' };
  const themeColours = { light: '#f4f5f9', dark: '#22242d', midnight: '#020309' };
  const button = document.querySelector('#theme-toggle');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColours[theme] || themeColours.light);
  setIcon(button, next.icon);
  button.setAttribute('aria-label', `Use ${next.name} mode`);
  button.setAttribute('title', `Use ${next.name} mode`);
}

function toggleAccountMenu() { const open = elements.accountMenu.hidden; elements.accountMenu.hidden = !open; elements.avatar.setAttribute('aria-expanded', String(open)); if (open) document.querySelector('#account-settings-button').focus(); }
function closeAccountMenu() { elements.accountMenu.hidden = true; elements.avatar.setAttribute('aria-expanded', 'false'); }

function renderIcons(root = document) { createIcons({ icons: lucideIcons, root, attrs: { 'aria-hidden': 'true' } }); }
function setIcon(element, name) { element.innerHTML = `<i data-lucide="${name}" aria-hidden="true"></i>`; renderIcons(element); }
function formatDuration(minutes) { const safe = Math.max(0, Math.round(Number(minutes) || 0)); const hours = Math.floor(safe / 60); const rest = safe % 60; return hours ? `${hours}h${rest ? ` ${rest}m` : ''}` : `${rest}m`; }
function minutesBetween(start, end) { return Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60000)); }
function formatTime(value, timezone) { return new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }
function formatDateTime(value, timezone) { return zonedDate(value, timezone, { weekday: 'short', hour: 'numeric', minute: '2-digit' }); }
function formatDue(value, timezone) { return zonedDate(value, timezone, { weekday: 'short', day: 'numeric', month: 'short' }); }
function formatRange(range, timezone) { const end = new Date(Date.parse(range.end) - 1); return `${zonedDate(range.start, timezone, { day: 'numeric', month: 'short' })}–${zonedDate(end, timezone, { day: 'numeric', month: 'short', year: 'numeric' })}`; }
function analyticsRangeText(period, range, timezone) {
  if (period === 'day') return zonedDate(range.start, timezone, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (period === 'month') return zonedDate(range.start, timezone, { month: 'long', year: 'numeric' });
  return formatRange(range, timezone);
}
function zonedDate(value, timezone, options) { return new Intl.DateTimeFormat(undefined, { timeZone: timezone, ...options }).format(new Date(value)); }
function dateKeyInZone(value, timezone) { const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)).map((part) => [part.type, part.value])); return `${parts.year}-${parts.month}-${parts.day}`; }
function zonedTime(value, timezone) { const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map((part) => [part.type, part.value])); return `${parts.hour}:${parts.minute}`; }
function zonedLocalToIso(date, time, timezone) {
  if (!date || !time) return null;
  const [year, month, day] = date.split('-').map(Number); const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute); let guess = target;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    guess += target - represented;
  }
  return new Date(guess).toISOString();
}
function localDateTimeValue(date) { const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return shifted.toISOString().slice(0, 16); }
function emptyState(title, text) { return `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(text)}</div>`; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function escapeAttr(value) { return escapeHtml(value); }
function toast(message) { elements.toast.textContent = message; elements.toast.classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => elements.toast.classList.remove('visible'), 4200); }

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) } });
  let data = {}; try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) { const error = new Error(data.error || 'Arcadia could not complete that request.'); error.status = response.status; error.data = data; throw error; }
  return data;
}
