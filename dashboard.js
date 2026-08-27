const { createIcons, icons: lucideIcons } = window.ArcadiaLucide;

const themes = ['light', 'dawn', 'rose', 'ocean', 'sage', 'lavender', 'dusk', 'dark', 'midnight'];
const themeColours = {
  light: '#f4f5f9', dawn: '#fbf5ef', rose: '#faf4f6', ocean: '#f2f7fa', sage: '#f4f7f1',
  lavender: '#f7f5fa', dusk: '#282633', dark: '#22242d', midnight: '#020309'
};

const trackerPresets = {
  pomodoro: { focus: 25, rest: 5, cycles: 4 }, deep: { focus: 50, rest: 10, cycles: 3 },
  long: { focus: 90, rest: 20, cycles: 2 }, sprint: { focus: 15, rest: 3, cycles: 4 },
  exam: { focus: 45, rest: 15, cycles: 2 }
};

const state = {
  data: null,
  anchorDate: new Date(),
  analyticsDate: new Date(),
  analyticsPeriod: 'day',
  analyticsRequest: 0,
  tracker: { initialized: false, userId: null, mode: 'focus', phase: 'focus', running: false, remaining: 1500, total: 1500, elapsed: 0, baseValue: 0, startedAt: 0, cycle: 1, distractions: 0, history: [], interval: null, storageKey: null },
  activeView: 'today',
  calendarView: matchMedia('(max-width: 720px)').matches ? 'day' : 'week',
  calendarEvents: [], calendarRangeKey: '', calendarRequest: 0, calendarScrolled: false, calendarUserId: null,
  calendarFilters: new Set(['school', 'study', 'sport', 'extracurricular', 'other', 'assessment']),
  editingEvent: null, drag: null,
  csrfToken: null,
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
  calendarViewButtons: [...document.querySelectorAll('[data-calendar-view]')], calendarFilterButtons: [...document.querySelectorAll('[data-filter]')],
  calendarAddEvent: document.querySelector('#calendar-add-event'), calendarAddTask: document.querySelector('#calendar-add-task'),
  analyticsContent: document.querySelector('#analytics-content'), analyticsMetrics: document.querySelector('#analytics-metrics'),
  analyticsRangeLabel: document.querySelector('#analytics-range-label'), subjectDistribution: document.querySelector('#subject-distribution'),
  analyticsNote: document.querySelector('#analytics-note'), analyticsPeriodButtons: [...document.querySelectorAll('[data-analytics-period]')],
  trackerModeButtons: [...document.querySelectorAll('[data-tracker-mode]')], trackerSubject: document.querySelector('#tracker-subject'),
  trackerGoal: document.querySelector('#tracker-goal'), trackerFace: document.querySelector('#tracker-face'), trackerPhase: document.querySelector('#tracker-phase'),
  trackerClock: document.querySelector('#tracker-clock'), trackerCycle: document.querySelector('#tracker-cycle'), trackerLiveStatus: document.querySelector('#tracker-live-status'),
  trackerStart: document.querySelector('#tracker-start'), trackerSkip: document.querySelector('#tracker-skip'), trackerFinish: document.querySelector('#tracker-finish'),
  trackerPreset: document.querySelector('#tracker-preset'), trackerFocusMinutes: document.querySelector('#tracker-focus-minutes'), trackerRestMinutes: document.querySelector('#tracker-rest-minutes'),
  trackerCycles: document.querySelector('#tracker-cycles'), trackerAutoRest: document.querySelector('#tracker-auto-rest'), trackerStats: document.querySelector('#tracker-stats'),
  trackerHistory: document.querySelector('#tracker-history'), trackerDistractionCount: document.querySelector('#tracker-distraction-count'),
  messages: document.querySelector('#messages'), proposals: document.querySelector('#proposals'),
  mentorStatus: document.querySelector('#mentor-status'), mentorContext: document.querySelector('#mentor-context'),
  composer: document.querySelector('#composer'), chatInput: document.querySelector('#chat-input'), send: document.querySelector('#send-button'),
  onboardingDialog: document.querySelector('#onboarding-dialog'), onboardingForm: document.querySelector('#onboarding-form'),
  onboardingClose: document.querySelector('#onboarding-close'), onboardingError: document.querySelector('#onboarding-error'),
  subjectRows: document.querySelector('#subject-rows'), taskRows: document.querySelector('#task-rows'),
  commitmentRows: document.querySelector('#commitment-rows'), taskDialog: document.querySelector('#task-dialog'),
  taskForm: document.querySelector('#task-form'), taskError: document.querySelector('#task-error'),
  settingsDialog: document.querySelector('#settings-dialog'), themeSelect: document.querySelector('#theme-select'), googleDetail: document.querySelector('#google-detail'),
  profileForm: document.querySelector('#profile-form'), emailForm: document.querySelector('#email-form'), passwordForm: document.querySelector('#password-form'), deleteAccountForm: document.querySelector('#delete-account-form'),
  googleConnect: document.querySelector('#google-connect'), googleDisconnect: document.querySelector('#google-disconnect'),
  eventDialog: document.querySelector('#event-dialog'), eventForm: document.querySelector('#event-form'), eventError: document.querySelector('#event-error'),
  assessmentDialog: document.querySelector('#assessment-dialog'), assessmentDetail: document.querySelector('#assessment-detail'),
  toast: document.querySelector('#toast')
};

document.documentElement.dataset.theme = preferredTheme();
bindControls();
renderIcons();
activateView(viewFromHash());
loadDashboard();

function bindControls() {
  updateThemeControls();
  elements.themeSelect.addEventListener('change', () => saveTheme(elements.themeSelect.value));
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
  document.querySelector('#account-sign-out-button').addEventListener('click', () => signOut(false));
  document.addEventListener('click', (event) => { if (!event.target.closest('.avatar-wrap')) closeAccountMenu(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !elements.accountMenu.hidden) { closeAccountMenu(); elements.avatar.focus(); } });
  document.querySelector('#life-setup-button').addEventListener('click', openLifeSetup);
  document.querySelector('#edit-life-button').addEventListener('click', () => { elements.settingsDialog.close(); openLifeSetup(); });
  document.querySelector('#add-task-button').addEventListener('click', openTaskDialog);
  document.querySelector('#rebuild-button').addEventListener('click', rebuildPlan);
  document.querySelector('#previous-week').addEventListener('click', () => navigateCalendar(-1));
  document.querySelector('#next-week').addEventListener('click', () => navigateCalendar(1));
  document.querySelector('#current-week').addEventListener('click', () => { state.anchorDate = new Date(); state.calendarRangeKey = ''; renderSchedule(); });
  elements.calendarViewButtons.forEach((button) => button.addEventListener('click', () => setCalendarView(button.dataset.calendarView)));
  elements.calendarFilterButtons.forEach((button) => button.addEventListener('click', () => toggleCalendarFilter(button.dataset.filter)));
  elements.calendarAddEvent.addEventListener('click', () => openEventDialog());
  elements.calendarAddTask.addEventListener('click', openTaskDialog);
  elements.weekBoard.addEventListener('keydown', (event) => { if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); navigateCalendar(-1); } if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); navigateCalendar(1); } });
  elements.analyticsPeriodButtons.forEach((button) => button.addEventListener('click', () => {
    if (state.analyticsPeriod === button.dataset.analyticsPeriod) return;
    state.analyticsPeriod = button.dataset.analyticsPeriod;
    loadAnalytics();
  }));
  document.querySelector('#previous-analytics').addEventListener('click', () => moveAnalytics(-1));
  document.querySelector('#next-analytics').addEventListener('click', () => moveAnalytics(1));
  document.querySelector('#current-analytics').addEventListener('click', () => { state.analyticsDate = new Date(); loadAnalytics(); });
  elements.trackerModeButtons.forEach((button) => button.addEventListener('click', () => selectTrackerMode(button.dataset.trackerMode)));
  elements.trackerStart.addEventListener('click', toggleTracker);
  document.querySelector('#tracker-reset').addEventListener('click', resetTracker);
  elements.trackerSkip.addEventListener('click', skipTrackerPhase);
  elements.trackerFinish.addEventListener('click', finishTrackerSession);
  elements.trackerPreset.addEventListener('change', () => applyTrackerPreset(elements.trackerPreset.value));
  [elements.trackerFocusMinutes, elements.trackerRestMinutes, elements.trackerCycles].forEach((input) => input.addEventListener('change', () => { elements.trackerPreset.value = 'custom'; resetTracker(); }));
  document.querySelector('#tracker-distraction').addEventListener('click', () => { state.tracker.distractions += 1; renderTracker(); });
  document.querySelector('#tracker-clear-distractions').addEventListener('click', () => { state.tracker.distractions = 0; renderTracker(); });
  document.querySelector('#tracker-clear-history').addEventListener('click', clearTrackerHistory);
  document.querySelector('#add-subject-row').addEventListener('click', () => addSubjectRow());
  document.querySelector('#add-task-row').addEventListener('click', () => addTaskRow());
  document.querySelector('#add-commitment-row').addEventListener('click', () => addCommitmentRow());
  elements.onboardingForm.addEventListener('submit', saveOnboarding);
  elements.taskForm.addEventListener('submit', saveTask);
  elements.eventForm.addEventListener('submit', saveCalendarEvent);
  document.querySelector('#event-all-day').addEventListener('change', updateEventTimeFields);
  document.querySelector('#event-delete').addEventListener('click', deleteCalendarEvent);
  document.querySelector('#event-pin-toggle').addEventListener('click', toggleEventPin);
  document.querySelector('#event-outcome-complete').addEventListener('click', () => saveEventOutcome('completed'));
  document.querySelector('#event-outcome-missed').addEventListener('click', () => saveEventOutcome('missed'));
  elements.composer.addEventListener('submit', sendChat);
  document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => { elements.chatInput.value = button.dataset.prompt; elements.chatInput.focus(); }));
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => document.querySelector(`#${button.dataset.close}`).close()));
  elements.onboardingClose.addEventListener('click', () => elements.onboardingDialog.close());
  elements.googleConnect.addEventListener('click', handleGoogleAction);
  elements.googleDisconnect.addEventListener('click', disconnectGoogle);
  document.querySelector('#sign-out-button').addEventListener('click', () => signOut(false));
  document.querySelector('#sign-out-all-button').addEventListener('click', () => signOut(true));
  elements.profileForm.addEventListener('submit', saveProfile);
  elements.emailForm.addEventListener('submit', changeEmail);
  elements.passwordForm.addEventListener('submit', changePassword);
  elements.deleteAccountForm.addEventListener('submit', deleteAccount);
  const params = new URLSearchParams(location.search);
  if (params.get('google') === 'connected') { toast('Google Calendar connected.'); history.replaceState({}, '', `${location.pathname}#today`); }
  if (params.get('google') === 'denied') { toast('Google Calendar connection was cancelled.'); history.replaceState({}, '', `${location.pathname}#today`); }
}

function viewFromHash() {
  const requested = location.hash.slice(1);
  if (['today', 'schedule', 'study-tracker', 'analytics', 'study-group', 'mentor'].includes(requested)) return requested;
  history.replaceState({}, '', `${location.pathname}${location.search}#today`);
  return 'today';
}

function activateView(view) {
  state.activeView = ['today', 'schedule', 'study-tracker', 'analytics', 'study-group', 'mentor'].includes(view) ? view : 'today';
  elements.views.forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== state.activeView; });
  elements.viewButtons.forEach((button) => {
    const active = button.dataset.view === state.activeView;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  const titles = { today: 'Today', schedule: 'Schedule', 'study-tracker': 'Study Tracker', analytics: 'Analytics', 'study-group': 'Study Group', mentor: 'AI Mentor' };
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
    state.csrfToken = data.csrfToken;
    applyTheme(data.preferences?.theme || preferredTheme());
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
  initializeCalendarPreferences(user.id);
  const initials = user.name.split(/\s|@/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'A';
  elements.avatar.textContent = initials;
  elements.avatar.setAttribute('aria-label', `Open account menu for ${user.name}`);
  document.querySelector('#account-menu-name').textContent = user.name;
  document.querySelector('#account-menu-email').textContent = user.email || 'Arcadia account';
  document.querySelector('#account-name').textContent = user.name;
  document.querySelector('#account-email').textContent = user.email;
  document.querySelector('#account-display-name').value = user.name;
  updateHeader();
  renderToday();
  renderSchedule();
  initializeTracker();
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
  } else if (state.activeView === 'study-tracker') {
    elements.pageEyebrow.textContent = 'Focus, rest, repeat';
    elements.pageTitle.textContent = 'Study Tracker';
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

function initializeTracker() {
  const userId = state.data.user.id;
  const previousSubject = elements.trackerSubject.value;
  elements.trackerSubject.innerHTML = '';
  const subjectNames = ['General', ...state.data.subjects.map((subject) => subject.name)].filter((name, index, list) => name && list.indexOf(name) === index);
  subjectNames.forEach((name) => elements.trackerSubject.add(new Option(name, name)));
  elements.trackerSubject.value = subjectNames.includes(previousSubject) ? previousSubject : subjectNames[0];
  if (state.tracker.initialized && state.tracker.userId === userId) { renderTracker(); return; }
  stopTrackerClock();
  state.tracker.userId = userId;
  state.tracker.storageKey = `arcadia-study-tracker:${userId}`;
  state.tracker.history = Array.isArray(state.data.studySessions) ? state.data.studySessions.slice(0, 50) : [];
  let legacy = [];
  try {
    const saved = JSON.parse(localStorage.getItem(state.tracker.storageKey) || '[]');
    if (Array.isArray(saved)) legacy = saved.filter((item) => item && Number(item.seconds) > 0 && item.endedAt).slice(0, 50);
  } catch {}
  state.tracker.initialized = true;
  state.tracker.distractions = 0;
  selectTrackerMode('focus');
  if (legacy.length) migrateLegacyTracker(legacy);
}

function trackerConfig() {
  const focus = clampTrackerInput(elements.trackerFocusMinutes, 1, 240, 25);
  const rest = clampTrackerInput(elements.trackerRestMinutes, 1, 60, 5);
  const cycles = clampTrackerInput(elements.trackerCycles, 1, 12, 4);
  return { focus, rest, cycles };
}

function clampTrackerInput(input, min, max, fallback) {
  const value = Math.min(max, Math.max(min, Math.round(Number(input.value) || fallback)));
  input.value = String(value);
  return value;
}

function applyTrackerPreset(name) {
  const preset = trackerPresets[name];
  if (preset) {
    elements.trackerFocusMinutes.value = String(preset.focus);
    elements.trackerRestMinutes.value = String(preset.rest);
    elements.trackerCycles.value = String(preset.cycles);
  }
  resetTracker();
}

function selectTrackerMode(mode) {
  if (!['focus', 'stopwatch', 'rest'].includes(mode)) return;
  stopTrackerClock();
  state.tracker.mode = mode;
  state.tracker.phase = mode === 'rest' ? 'rest' : 'focus';
  state.tracker.cycle = 1;
  state.tracker.elapsed = 0;
  const config = trackerConfig();
  state.tracker.total = (mode === 'rest' ? config.rest : config.focus) * 60;
  state.tracker.remaining = state.tracker.total;
  elements.trackerModeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.trackerMode === mode)));
  renderTracker();
}

function toggleTracker() {
  if (state.tracker.running) { pauseTracker(); return; }
  state.tracker.running = true;
  state.tracker.startedAt = Date.now();
  state.tracker.baseValue = state.tracker.mode === 'stopwatch' ? state.tracker.elapsed : state.tracker.remaining;
  state.tracker.interval = setInterval(tickTracker, 250);
  renderTracker();
}

function tickTracker() {
  if (!state.tracker.running) return;
  const delta = Math.floor((Date.now() - state.tracker.startedAt) / 1000);
  if (state.tracker.mode === 'stopwatch') state.tracker.elapsed = state.tracker.baseValue + delta;
  else state.tracker.remaining = Math.max(0, state.tracker.baseValue - delta);
  if (state.tracker.mode !== 'stopwatch' && state.tracker.remaining === 0) completeTrackerPhase();
  renderTracker();
}

function pauseTracker() {
  tickTracker();
  stopTrackerClock();
  renderTracker();
}

function stopTrackerClock() {
  state.tracker.running = false;
  if (state.tracker.interval) clearInterval(state.tracker.interval);
  state.tracker.interval = null;
}

function resetTracker() {
  stopTrackerClock();
  const config = trackerConfig();
  state.tracker.elapsed = 0;
  state.tracker.cycle = 1;
  state.tracker.phase = state.tracker.mode === 'rest' ? 'rest' : 'focus';
  state.tracker.total = (state.tracker.mode === 'rest' ? config.rest : config.focus) * 60;
  state.tracker.remaining = state.tracker.total;
  renderTracker();
}

function skipTrackerPhase() {
  if (state.tracker.mode === 'stopwatch') return;
  stopTrackerClock();
  if (state.tracker.mode === 'rest') { resetTracker(); return; }
  moveToNextTrackerPhase(false);
}

function completeTrackerPhase() {
  stopTrackerClock();
  logTrackerSession(state.tracker.phase, state.tracker.total);
  if (state.tracker.mode === 'rest') { toast('Rest complete. You’re ready for the next block.'); resetTracker(); return; }
  moveToNextTrackerPhase(true);
}

function moveToNextTrackerPhase(completed) {
  const config = trackerConfig();
  if (state.tracker.phase === 'focus') {
    if (state.tracker.cycle >= config.cycles) {
      state.tracker.cycle = 1; state.tracker.phase = 'focus'; state.tracker.total = config.focus * 60; state.tracker.remaining = state.tracker.total;
      toast(completed ? 'Study plan complete. Great work.' : 'Study plan reset.'); renderTracker(); return;
    }
    state.tracker.phase = 'rest'; state.tracker.total = config.rest * 60; state.tracker.remaining = state.tracker.total;
  } else {
    state.tracker.cycle += 1; state.tracker.phase = 'focus'; state.tracker.total = config.focus * 60; state.tracker.remaining = state.tracker.total;
  }
  state.tracker.elapsed = 0;
  if (elements.trackerAutoRest.checked) toggleTracker(); else renderTracker();
}

function finishTrackerSession() {
  if (state.tracker.running) tickTracker();
  stopTrackerClock();
  const seconds = state.tracker.mode === 'stopwatch' ? state.tracker.elapsed : Math.max(0, state.tracker.total - state.tracker.remaining);
  if (seconds < 1) { toast('Start the tracker before logging a session.'); renderTracker(); return; }
  logTrackerSession(state.tracker.mode === 'stopwatch' ? 'stopwatch' : state.tracker.phase, seconds);
  toast('Session saved to your account.');
  resetTracker();
}

async function logTrackerSession(type, seconds) {
  const entry = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, type, seconds: Math.max(1, Math.round(seconds)), subject: elements.trackerSubject.value || 'General', goal: elements.trackerGoal.value.trim(), distractions: state.tracker.distractions, endedAt: new Date().toISOString() };
  state.tracker.history.unshift(entry);
  state.tracker.history = state.tracker.history.slice(0, 50);
  renderTrackerHistory();
  renderTrackerStats();
  try { state.tracker.history = (await api('/api/study-sessions', { method: 'POST', body: JSON.stringify(entry) })).sessions; renderTrackerHistory(); renderTrackerStats(); }
  catch (caught) { toast(`Session could not sync: ${caught.message}`); }
}

async function migrateLegacyTracker(entries) {
  try {
    const result = await api('/api/study-sessions', { method: 'POST', body: JSON.stringify({ sessions: entries }) });
    state.tracker.history = result.sessions; localStorage.removeItem(state.tracker.storageKey); renderTrackerHistory(); renderTrackerStats();
  } catch (caught) { console.warn('Legacy tracker migration will retry later', caught.message); }
}
async function clearTrackerHistory() {
  try { await api('/api/study-sessions', { method: 'DELETE' }); state.tracker.history = []; renderTrackerHistory(); renderTrackerStats(); toast('Study Tracker history cleared.'); }
  catch (caught) { toast(caught.message); }
}

function renderTracker() {
  const tracker = state.tracker;
  const config = trackerConfig();
  const seconds = tracker.mode === 'stopwatch' ? tracker.elapsed : tracker.remaining;
  elements.trackerClock.textContent = formatTrackerClock(seconds);
  elements.trackerPhase.textContent = tracker.mode === 'stopwatch' ? 'Stopwatch' : tracker.phase === 'rest' ? 'Rest' : 'Focus';
  elements.trackerCycle.textContent = tracker.mode === 'focus' ? `Cycle ${tracker.cycle} of ${config.cycles}` : tracker.mode === 'rest' ? 'Standalone rest timer' : 'Count up freely';
  const progress = tracker.mode === 'stopwatch' ? (tracker.elapsed % 3600) / 3600 : tracker.total ? (tracker.total - tracker.remaining) / tracker.total : 0;
  elements.trackerFace.style.setProperty('--timer-progress', `${Math.max(0, Math.min(1, progress)) * 360}deg`);
  elements.trackerStart.textContent = tracker.running ? 'Pause' : tracker.mode === 'stopwatch' && tracker.elapsed ? 'Resume' : 'Start';
  elements.trackerSkip.hidden = tracker.mode === 'stopwatch';
  elements.trackerLiveStatus.textContent = tracker.running ? `${elements.trackerPhase.textContent} in progress` : tracker.mode === 'stopwatch' && tracker.elapsed ? 'Stopwatch paused' : tracker.mode === 'rest' ? 'Ready to rest' : 'Ready to focus';
  elements.trackerLiveStatus.classList.toggle('running', tracker.running);
  [elements.trackerPreset, elements.trackerFocusMinutes, elements.trackerRestMinutes, elements.trackerCycles].forEach((control) => { control.disabled = tracker.running; });
  elements.trackerDistractionCount.textContent = String(tracker.distractions);
  renderTrackerStats();
  renderTrackerHistory();
}

function renderTrackerStats() {
  const timezone = state.data?.user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = dateKeyInZone(new Date(), timezone);
  const sessions = state.tracker.history.filter((item) => dateKeyInZone(item.endedAt, timezone) === today && ['focus', 'stopwatch'].includes(item.type));
  const focusedSeconds = sessions.reduce((sum, item) => sum + Number(item.seconds || 0), 0);
  elements.trackerStats.innerHTML = `<div class="tracker-stat"><span>Focused today</span><strong>${formatDuration(Math.round(focusedSeconds / 60))}</strong></div><div class="tracker-stat"><span>Sessions</span><strong>${sessions.length}</strong></div><div class="tracker-stat"><span>Distractions</span><strong>${state.tracker.distractions}</strong></div>`;
}

function renderTrackerHistory() {
  elements.trackerHistory.innerHTML = '';
  if (!state.tracker.history.length) { elements.trackerHistory.innerHTML = emptyState('No sessions yet', 'Finish or complete a timer to start your record.'); return; }
  const timezone = state.data?.user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  state.tracker.history.slice(0, 10).forEach((item) => {
    const row = document.createElement('div'); row.className = 'tracker-history-row';
    const detail = item.goal ? `${item.subject} · ${item.goal}` : item.subject;
    row.innerHTML = `<div><strong>${escapeHtml(detail)}</strong><span>${escapeHtml(zonedDate(item.endedAt, timezone, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}</span></div><span class="tracker-history-type">${escapeHtml(item.type)}</span><span class="tracker-history-time">${formatTrackerClock(item.seconds)}</span>`;
    elements.trackerHistory.append(row);
  });
}

function formatTrackerClock(seconds) {
  const safe = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(safe / 3600); const minutes = Math.floor((safe % 3600) / 60); const rest = safe % 60;
  return hours ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
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

function initializeCalendarPreferences(userId) {
  if (state.calendarUserId === userId) return;
  state.calendarUserId = userId;
  try {
    const saved = JSON.parse(localStorage.getItem(`arcadia-calendar:${userId}`) || '{}');
    if (['day', 'week', 'month'].includes(saved.view)) state.calendarView = saved.view;
    if (Array.isArray(saved.filters)) state.calendarFilters = new Set(saved.filters.filter((item) => ['school', 'study', 'sport', 'extracurricular', 'other', 'assessment'].includes(item)));
  } catch {}
}

function persistCalendarPreferences() {
  if (!state.calendarUserId) return;
  try { localStorage.setItem(`arcadia-calendar:${state.calendarUserId}`, JSON.stringify({ view: state.calendarView, filters: [...state.calendarFilters] })); } catch {}
}

function setCalendarView(view) {
  if (!['day', 'week', 'month'].includes(view) || state.calendarView === view) return;
  state.calendarView = view; state.calendarRangeKey = ''; state.calendarScrolled = false;
  persistCalendarPreferences(); renderSchedule();
}

function toggleCalendarFilter(filter) {
  if (state.calendarFilters.has(filter)) state.calendarFilters.delete(filter); else state.calendarFilters.add(filter);
  persistCalendarPreferences(); renderCalendarContent();
}

function navigateCalendar(direction) {
  const timezone = state.data.user.timezone;
  if (state.calendarView === 'month') {
    const key = dateKeyInZone(state.anchorDate, timezone); const [year, month, day] = key.split('-').map(Number);
    const target = new Date(Date.UTC(year, month - 1 + direction, Math.min(day, 28))).toISOString().slice(0, 10);
    state.anchorDate = new Date(zonedLocalToIso(target, '12:00', timezone));
  } else state.anchorDate = new Date(state.anchorDate.getTime() + direction * (state.calendarView === 'week' ? 7 : 1) * 86400000);
  state.calendarRangeKey = ''; state.calendarScrolled = false; renderSchedule();
}

function calendarRange() {
  const timezone = state.data.user.timezone; const anchor = dateKeyInZone(state.anchorDate, timezone);
  let startKey = anchor; let days = 1;
  if (state.calendarView === 'week') { startKey = shiftDateKey(anchor, -weekdayIndex(anchor)); days = 7; }
  if (state.calendarView === 'month') {
    const [year, month] = anchor.split('-').map(Number); const first = `${year}-${String(month).padStart(2, '0')}-01`;
    startKey = shiftDateKey(first, -weekdayIndex(first)); days = 42;
  }
  const endKey = shiftDateKey(startKey, days);
  return { startKey, endKey, days, start: zonedLocalToIso(startKey, '00:00', timezone), end: zonedLocalToIso(endKey, '00:00', timezone) };
}

function weekdayIndex(key) { return (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7; }
function shiftDateKey(key, days) { const [year, month, day] = key.split('-').map(Number); return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10); }
function displayDateForKey(key) { return new Date(`${key}T12:00:00Z`); }

async function renderSchedule() {
  if (!state.data) return;
  elements.calendarViewButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.calendarView === state.calendarView)));
  elements.calendarFilterButtons.forEach((button) => button.setAttribute('aria-pressed', String(state.calendarFilters.has(button.dataset.filter))));
  const range = calendarRange(); const timezone = state.data.user.timezone;
  elements.weekLabel.textContent = state.calendarView === 'day'
    ? zonedDate(displayDateForKey(range.startKey), 'UTC', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : state.calendarView === 'month' ? zonedDate(state.anchorDate, timezone, { month: 'long', year: 'numeric' })
      : `${zonedDate(displayDateForKey(range.startKey), 'UTC', { day: 'numeric', month: 'short' })}–${zonedDate(displayDateForKey(shiftDateKey(range.endKey, -1)), 'UTC', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const key = `${range.start}|${range.end}`;
  if (state.calendarRangeKey === key) { renderCalendarContent(); return; }
  const requestId = ++state.calendarRequest; elements.weekBoard.innerHTML = '<div class="calendar-loading">Loading your calendar...</div>';
  try {
    const result = await api(`/api/calendar?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`);
    if (requestId !== state.calendarRequest) return;
    state.calendarEvents = result.events; state.calendarRangeKey = key; renderCalendarContent();
  } catch (error) { if (requestId === state.calendarRequest) elements.weekBoard.innerHTML = emptyState('Calendar unavailable', error.message); }
}

function renderCalendarContent() {
  if (!state.data) return;
  elements.calendarFilterButtons.forEach((button) => button.setAttribute('aria-pressed', String(state.calendarFilters.has(button.dataset.filter))));
  if (state.calendarView === 'month') renderMonthCalendar(); else renderTimeCalendar();
}

function visibleCalendarEvents() { return state.calendarEvents.filter((event) => event.status !== 'cancelled' && state.calendarFilters.has(categoryClass(event))); }
function visibleAssessmentsForKey(key) {
  if (!state.calendarFilters.has('assessment')) return [];
  const timezone = state.data.user.timezone;
  return state.data.tasks.filter((task) => dateKeyInZone(task.dueAt, timezone) === key && task.status !== 'archived');
}

function renderTimeCalendar() {
  const range = calendarRange(); const timezone = state.data.user.timezone; const dayCount = state.calendarView === 'day' ? 1 : 7;
  const keys = Array.from({ length: dayCount }, (_, index) => shiftDateKey(range.startKey, index)); const todayKey = dateKeyInZone(new Date(), timezone);
  const root = document.createElement('div'); root.className = `time-calendar${dayCount === 1 ? ' day-view' : ''}`; root.style.setProperty('--calendar-days', dayCount);
  const heads = document.createElement('div'); heads.className = 'calendar-day-heads'; heads.innerHTML = '<div class="calendar-head-spacer"></div>' + keys.map((key) => `<div class="calendar-day-head${key === todayKey ? ' today' : ''}"><span>${zonedDate(displayDateForKey(key), 'UTC', { weekday: 'short' })}</span><strong>${Number(key.slice(8))}</strong></div>`).join('');
  const allDay = document.createElement('div'); allDay.className = 'all-day-row'; allDay.innerHTML = '<div class="all-day-label">All day</div>';
  keys.forEach((key) => {
    const cell = document.createElement('div'); cell.className = 'all-day-cell'; cell.dataset.date = key;
    visibleCalendarEvents().filter((event) => event.allDay && allDayEventIncludes(event, key)).forEach((event) => cell.append(calendarAllDayEvent(event)));
    visibleAssessmentsForKey(key).forEach((task) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'assessment-chip'; button.textContent = `Due · ${task.title}`; button.addEventListener('click', () => openAssessment(task)); cell.append(button); });
    cell.addEventListener('click', (click) => { if (click.target === cell) openEventDialog({ dateKey: key, allDay: true }); }); allDay.append(cell);
  });
  const body = document.createElement('div'); body.className = 'calendar-body'; const labels = document.createElement('div'); labels.className = 'time-labels';
  for (let hour = 0; hour < 24; hour += 1) { const label = document.createElement('span'); label.className = 'time-label'; label.style.top = `${hour * 64}px`; label.textContent = hour === 0 ? '' : new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2020, 0, 1, hour)); labels.append(label); }
  const columns = document.createElement('div'); columns.className = 'calendar-columns';
  keys.forEach((key) => {
    const column = document.createElement('div'); column.className = `calendar-column${key === todayKey ? ' today' : ''}`; column.dataset.date = key; column.tabIndex = 0; column.setAttribute('aria-label', `${zonedDate(displayDateForKey(key), 'UTC', { weekday: 'long', day: 'numeric', month: 'long' })} time grid`);
    column.addEventListener('click', (event) => { if (event.target !== column) return; const rect = column.getBoundingClientRect(); const minute = Math.max(0, Math.min(1425, Math.round(((event.clientY - rect.top) / 64 * 60) / 15) * 15)); openEventDialog({ dateKey: key, minute }); });
    column.addEventListener('keydown', (event) => { if (event.target === column && event.key === 'Enter') { event.preventDefault(); openEventDialog({ dateKey: key, minute: 9 * 60 }); } });
    const timed = visibleCalendarEvents().filter((event) => !event.allDay && eventTouchesDay(event, key));
    layoutTimedEvents(timed, key).forEach((layout) => column.append(calendarTimedEvent(layout, key)));
    if (key === todayKey) { const now = zonedTime(new Date(), timezone).split(':').map(Number); const line = document.createElement('div'); line.className = 'now-line'; line.style.top = `${(now[0] * 60 + now[1]) / 60 * 64}px`; column.append(line); }
    columns.append(column);
  });
  body.append(labels, columns); root.append(heads, allDay, body); elements.weekBoard.replaceChildren(root);
  if (!state.calendarScrolled) { state.calendarScrolled = true; requestAnimationFrame(() => { const nowMinutes = keys.includes(todayKey) ? Number(zonedTime(new Date(), timezone).slice(0, 2)) * 60 : earliestVisibleMinute(); elements.weekBoard.scrollTop = Math.max(0, nowMinutes / 60 * 64 - 150); }); }
}

function allDayEventIncludes(event, key) { return event.startAt.slice(0, 10) <= key && event.endAt.slice(0, 10) > key; }
function eventTouchesDay(event, key) { const timezone = state.data.user.timezone; return dateKeyInZone(event.startAt, timezone) <= key && dateKeyInZone(new Date(Date.parse(event.endAt) - 1), timezone) >= key; }
function eventMinutesForDay(event, key) {
  const timezone = state.data.user.timezone; const startKey = dateKeyInZone(event.startAt, timezone); const endKey = dateKeyInZone(new Date(Date.parse(event.endAt) - 1), timezone);
  const start = startKey < key ? 0 : timeToMinutes(zonedTime(event.startAt, timezone)); const end = endKey > key ? 1440 : Math.max(start + 15, timeToMinutes(zonedTime(event.endAt, timezone)));
  return { start, end: Math.min(1440, end) };
}
function layoutTimedEvents(events, key) {
  const sorted = events.map((event) => ({ event, ...eventMinutesForDay(event, key) })).sort((a, b) => a.start - b.start || b.end - a.end); const lanes = [];
  sorted.forEach((item) => { let lane = lanes.findIndex((end) => end <= item.start); if (lane < 0) lane = lanes.length; lanes[lane] = item.end; item.lane = lane; });
  const count = Math.max(1, lanes.length); return sorted.map((item) => ({ ...item, laneCount: count }));
}

function calendarTimedEvent(layout, key) {
  const { event, start, end, lane, laneCount } = layout; const button = document.createElement('button'); button.type = 'button';
  button.className = `calendar-event ${categoryClass(event)}${event.outcome === 'completed' ? ' completed' : ''}${event.editable ? '' : ' readonly'}`;
  button.style.top = `${start / 60 * 64}px`; button.style.height = `${Math.max(22, (end - start) / 60 * 64)}px`; button.style.setProperty('--event-left', lane / laneCount * 100); button.style.setProperty('--event-width', 100 / laneCount);
  button.innerHTML = `<span class="calendar-event-time">${escapeHtml(formatTime(event.startAt, state.data.user.timezone))}–${escapeHtml(formatTime(event.endAt, state.data.user.timezone))}${event.pinned ? '<span class="event-pin">●</span>' : ''}</span><span class="calendar-event-title">${escapeHtml(event.title)}</span><span class="calendar-event-meta">${escapeHtml(event.subject || event.location || event.category)}</span>${event.editable ? '<span class="event-resize" aria-hidden="true"></span>' : ''}`;
  button.setAttribute('aria-label', `${event.title}, ${formatTime(event.startAt, state.data.user.timezone)} to ${formatTime(event.endAt, state.data.user.timezone)}${event.editable ? ', movable event' : ', read only'}`);
  button.addEventListener('click', () => { if (!state.drag?.didMove) openEventDialog({ event }); });
  if (event.editable) button.addEventListener('pointerdown', (pointer) => beginEventDrag(pointer, event, button, key, pointer.target.classList.contains('event-resize')));
  return button;
}

function calendarAllDayEvent(event) { const button = document.createElement('button'); button.type = 'button'; button.className = 'all-day-event'; button.textContent = event.title; button.addEventListener('click', () => openEventDialog({ event })); return button; }

function renderMonthCalendar() {
  const range = calendarRange(); const timezone = state.data.user.timezone; const todayKey = dateKeyInZone(new Date(), timezone); const anchorMonth = dateKeyInZone(state.anchorDate, timezone).slice(0, 7);
  const root = document.createElement('div'); root.className = 'month-calendar'; ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach((day) => root.insertAdjacentHTML('beforeend', `<div class="month-weekday">${day}</div>`));
  for (let index = 0; index < 42; index += 1) {
    const key = shiftDateKey(range.startKey, index); const cell = document.createElement('div'); cell.className = `month-day${key.slice(0, 7) === anchorMonth ? '' : ' outside'}${key === todayKey ? ' today' : ''}`; cell.tabIndex = 0; cell.dataset.date = key; cell.setAttribute('role', 'button'); cell.innerHTML = `<span class="month-day-number">${Number(key.slice(8))}</span>`;
    const events = visibleCalendarEvents().filter((event) => event.allDay ? allDayEventIncludes(event, key) : dateKeyInZone(event.startAt, timezone) === key);
    const items = [...events.map((event) => ({ type: 'event', value: event })), ...visibleAssessmentsForKey(key).map((task) => ({ type: 'assessment', value: task }))];
    items.slice(0, 3).forEach((item) => {
      const chip = document.createElement('span'); chip.className = `month-event${item.type === 'assessment' ? ' assessment' : ''}`; chip.textContent = item.type === 'assessment' ? `Due · ${item.value.title}` : `${item.value.allDay ? '' : formatTime(item.value.startAt, timezone) + ' · '}${item.value.title}`;
      chip.addEventListener('click', (click) => { click.stopPropagation(); if (item.type === 'assessment') openAssessment(item.value); else openEventDialog({ event: item.value }); });
      if (item.type === 'event' && item.value.editable && item.value.outcome === 'planned') { chip.draggable = true; chip.addEventListener('dragstart', (drag) => { drag.dataTransfer.setData('text/arcadia-event', item.value.id); drag.dataTransfer.effectAllowed = 'move'; }); }
      cell.append(chip);
    });
    if (items.length > 3) cell.insertAdjacentHTML('beforeend', `<span class="month-more">+${items.length - 3} more</span>`);
    cell.addEventListener('dragover', (drag) => { if (drag.dataTransfer.types.includes('text/arcadia-event')) { drag.preventDefault(); drag.dataTransfer.dropEffect = 'move'; } });
    cell.addEventListener('drop', async (drop) => { drop.preventDefault(); drop.stopPropagation(); const event = state.calendarEvents.find((item) => item.id === drop.dataTransfer.getData('text/arcadia-event')); if (event) await moveMonthEvent(event, key); });
    cell.addEventListener('click', () => { state.anchorDate = new Date(zonedLocalToIso(key, '12:00', timezone)); setCalendarView('day'); });
    cell.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); cell.click(); } }); root.append(cell);
  }
  elements.weekBoard.replaceChildren(root);
}

function earliestVisibleMinute() { const timezone = state.data.user.timezone; const minutes = visibleCalendarEvents().filter((event) => !event.allDay).map((event) => timeToMinutes(zonedTime(event.startAt, timezone))); return minutes.length ? Math.max(0, Math.min(...minutes) - 60) : 7 * 60; }
function timeToMinutes(time) { const [hour, minute] = time.split(':').map(Number); return hour * 60 + minute; }

async function moveMonthEvent(event, targetKey) {
  const timezone = state.data.user.timezone; const sourceKey = event.allDay ? event.startAt.slice(0, 10) : dateKeyInZone(event.startAt, timezone); const dayDelta = Math.round((Date.parse(`${targetKey}T00:00:00Z`) - Date.parse(`${sourceKey}T00:00:00Z`)) / 86400000); if (!dayDelta) return;
  const next = event.allDay ? { startAt: `${shiftDateKey(event.startAt.slice(0, 10), dayDelta)}T00:00:00.000Z`, endAt: `${shiftDateKey(event.endAt.slice(0, 10), dayDelta)}T00:00:00.000Z` } : adjustedEventTimes(event, 0, dayDelta, false); next.pinned = event.category === 'study' && event.taskId ? true : event.pinned;
  const original = { ...event }; state.calendarEvents = state.calendarEvents.map((item) => item.id === event.id ? { ...event, ...next } : item); renderCalendarContent();
  try { const result = await api(`/api/events/${encodeURIComponent(event.id)}`, { method: 'PATCH', body: JSON.stringify(next) }); state.calendarEvents = state.calendarEvents.map((item) => item.id === event.id ? result.event : item); toast(next.pinned && !event.pinned ? 'Study block moved and pinned.' : 'Event moved.'); }
  catch (error) { state.calendarEvents = state.calendarEvents.map((item) => item.id === event.id ? original : item); const conflict = error.data?.conflicts?.[0]; toast(conflict ? `${error.message} It conflicts with ${conflict.title}.` : error.message); }
  renderCalendarContent();
}

function renderScheduleLegacy() {
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

function beginEventDrag(pointer, event, node, key, resizing) {
  if (pointer.button !== 0 || event.outcome !== 'planned') return;
  pointer.preventDefault(); node.setPointerCapture(pointer.pointerId);
  const columnWidth = node.parentElement.getBoundingClientRect().width; const origin = { ...event };
  state.drag = { event, node, key, resizing, startX: pointer.clientX, startY: pointer.clientY, columnWidth, origin, didMove: false, pointerId: pointer.pointerId };
  const move = (current) => {
    if (!state.drag || current.pointerId !== state.drag.pointerId) return;
    const dx = current.clientX - state.drag.startX; const dy = current.clientY - state.drag.startY;
    if (!state.drag.didMove && Math.hypot(dx, dy) < 6) return;
    state.drag.didMove = true; node.classList.add('calendar-dragging');
    const minuteDelta = Math.round((dy / 64 * 60) / 15) * 15; const dayDelta = state.calendarView === 'week' && !resizing ? Math.max(-6, Math.min(6, Math.round(dx / columnWidth))) : 0;
    state.drag.preview = adjustedEventTimes(origin, minuteDelta, dayDelta, resizing);
    if (resizing) node.style.height = `${Math.max(22, minutesBetween(origin.startAt, state.drag.preview.endAt) / 60 * 64)}px`; else node.style.transform = `translate(${dayDelta * columnWidth}px,${minuteDelta / 60 * 64}px)`;
  };
  const finish = async (current) => {
    if (!state.drag || current.pointerId !== state.drag.pointerId) return;
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', finish); document.removeEventListener('pointercancel', cancel);
    const drag = state.drag; node.classList.remove('calendar-dragging'); node.style.transform = ''; node.style.height = '';
    if (!drag.didMove || !drag.preview) { setTimeout(() => { state.drag = null; }, 0); return; }
    const next = { ...event, ...drag.preview, pinned: event.category === 'study' && event.taskId ? true : event.pinned };
    state.calendarEvents = state.calendarEvents.map((item) => item.id === event.id ? next : item); renderCalendarContent();
    try {
      const result = await api(`/api/events/${encodeURIComponent(event.id)}`, { method: 'PATCH', body: JSON.stringify({ startAt: next.startAt, endAt: next.endAt, pinned: next.pinned }) });
      state.calendarEvents = state.calendarEvents.map((item) => item.id === event.id ? result.event : item); toast(next.pinned && !event.pinned ? 'Study block moved and pinned.' : 'Event moved.');
    } catch (error) {
      state.calendarEvents = state.calendarEvents.map((item) => item.id === event.id ? origin : item); const conflict = error.data?.conflicts?.[0]; toast(conflict ? `${error.message} It conflicts with ${conflict.title}.` : error.message);
    } finally { state.drag = null; renderCalendarContent(); }
  };
  const cancel = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', finish); document.removeEventListener('pointercancel', cancel); state.drag = null; renderCalendarContent(); };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', finish); document.addEventListener('pointercancel', cancel);
}

function adjustedEventTimes(event, minuteDelta, dayDelta, resizing) {
  const timezone = state.data.user.timezone;
  if (resizing) return { startAt: event.startAt, endAt: new Date(Math.max(Date.parse(event.startAt) + 15 * 60000, Date.parse(event.endAt) + minuteDelta * 60000)).toISOString() };
  const key = shiftDateKey(dateKeyInZone(event.startAt, timezone), dayDelta); const originalMinutes = timeToMinutes(zonedTime(event.startAt, timezone)); const total = originalMinutes + minuteDelta;
  const normalizedKey = shiftDateKey(key, Math.floor(total / 1440)); const normalizedMinutes = ((total % 1440) + 1440) % 1440; const time = `${String(Math.floor(normalizedMinutes / 60)).padStart(2, '0')}:${String(normalizedMinutes % 60).padStart(2, '0')}`;
  const startAt = zonedLocalToIso(normalizedKey, time, timezone); return { startAt, endAt: new Date(Date.parse(startAt) + (Date.parse(event.endAt) - Date.parse(event.startAt))).toISOString() };
}

function openEventDialog({ event = null, dateKey = null, minute = null, allDay = false } = {}) {
  const timezone = state.data.user.timezone; state.editingEvent = event;
  const subject = document.querySelector('#event-subject'); subject.innerHTML = '<option value="">General</option>'; state.data.subjects.forEach((item) => subject.add(new Option(item.name, item.name)));
  const nowKey = dateKey || dateKeyInZone(state.anchorDate, timezone); const startMinute = minute ?? Math.ceil(timeToMinutes(zonedTime(new Date(), timezone)) / 15) * 15;
  const defaultStart = `${String(Math.floor(startMinute / 60) % 24).padStart(2, '0')}:${String(startMinute % 60).padStart(2, '0')}`; const defaultEndMinute = Math.min(1439, startMinute + 60); const defaultEnd = `${String(Math.floor(defaultEndMinute / 60)).padStart(2, '0')}:${String(defaultEndMinute % 60).padStart(2, '0')}`;
  document.querySelector('#event-title').value = event?.title || ''; document.querySelector('#event-category').value = categoryClass(event || { category: 'study' }); setSelectValue(subject, event?.subject || '');
  document.querySelector('#event-all-day').checked = event?.allDay ?? allDay;
  document.querySelector('#event-start-date').value = event ? (event.allDay ? event.startAt.slice(0, 10) : dateKeyInZone(event.startAt, timezone)) : nowKey;
  document.querySelector('#event-end-date').value = event ? (event.allDay ? event.endAt.slice(0, 10) : dateKeyInZone(event.endAt, timezone)) : (allDay ? shiftDateKey(nowKey, 1) : nowKey);
  document.querySelector('#event-start-time').value = event && !event.allDay ? zonedTime(event.startAt, timezone) : defaultStart; document.querySelector('#event-end-time').value = event && !event.allDay ? zonedTime(event.endAt, timezone) : defaultEnd;
  document.querySelector('#event-location').value = event?.location || ''; document.querySelector('#event-description').value = event?.description || ''; elements.eventError.textContent = '';
  const editable = !event || (event.editable && event.source === 'arcadia'); elements.eventForm.querySelectorAll('input,select,textarea').forEach((control) => { control.disabled = !editable; });
  document.querySelector('#event-dialog-title').textContent = event ? event.title : 'New event'; document.querySelector('#event-dialog-eyebrow').textContent = event ? (event.source === 'google' ? 'Google Calendar' : event.commitmentId ? 'Life commitment' : 'Arcadia event') : 'Calendar event';
  const note = document.querySelector('#event-dialog-note'); note.hidden = editable; note.textContent = event?.source === 'google' ? 'This imported event is read-only. Make changes in Google Calendar.' : 'This recurring commitment is read-only here. Make changes in Life setup.';
  document.querySelector('#event-save').hidden = !editable; document.querySelector('#event-delete').hidden = !event || !editable; const plannedStudy = event?.category === 'study' && event.outcome === 'planned';
  document.querySelector('#event-outcome-complete').hidden = !plannedStudy; document.querySelector('#event-outcome-missed').hidden = !plannedStudy; const pin = document.querySelector('#event-pin-toggle'); pin.hidden = !(event?.taskId && plannedStudy && editable); pin.textContent = event?.pinned ? 'Unpin' : 'Pin';
  updateEventTimeFields(); elements.eventDialog.showModal(); if (editable) document.querySelector('#event-title').focus();
}

function updateEventTimeFields() { const allDay = document.querySelector('#event-all-day').checked; ['#event-start-time','#event-end-time'].forEach((selector) => { const input = document.querySelector(selector); input.disabled = allDay || (state.editingEvent && (!state.editingEvent.editable || state.editingEvent.source !== 'arcadia')); input.required = !allDay; }); }

async function saveCalendarEvent(submit) {
  submit.preventDefault(); if (state.saving) return; const timezone = state.data.user.timezone; const allDay = document.querySelector('#event-all-day').checked; const startDate = document.querySelector('#event-start-date').value; const endDate = document.querySelector('#event-end-date').value;
  const startAt = allDay ? `${startDate}T00:00:00.000Z` : zonedLocalToIso(startDate, document.querySelector('#event-start-time').value, timezone); const endAt = allDay ? `${endDate}T00:00:00.000Z` : zonedLocalToIso(endDate, document.querySelector('#event-end-time').value, timezone);
  const category = document.querySelector('#event-category').value; const body = { title: document.querySelector('#event-title').value.trim(), category, kind: category === 'study' ? 'study' : category === 'sport' ? 'training' : 'general', subject: document.querySelector('#event-subject').value || null, location: document.querySelector('#event-location').value.trim(), description: document.querySelector('#event-description').value.trim(), allDay, startAt, endAt, pinned: state.editingEvent?.pinned || false };
  state.saving = true; elements.eventError.textContent = '';
  try {
    const path = state.editingEvent ? `/api/events/${encodeURIComponent(state.editingEvent.id)}` : '/api/events'; const result = await api(path, { method: state.editingEvent ? 'PATCH' : 'POST', body: JSON.stringify(body) }); elements.eventDialog.close(); toast(state.editingEvent ? 'Event updated.' : 'Event added.'); state.calendarRangeKey = ''; await renderSchedule();
  } catch (error) { const conflict = error.data?.conflicts?.[0]; elements.eventError.textContent = conflict ? `${error.message} It conflicts with ${conflict.title}.` : error.message; } finally { state.saving = false; }
}

async function deleteCalendarEvent() { const event = state.editingEvent; if (!event || state.saving) return; state.saving = true; try { await api(`/api/events/${encodeURIComponent(event.id)}`, { method: 'DELETE' }); elements.eventDialog.close(); toast('Event deleted.'); state.calendarRangeKey = ''; await renderSchedule(); } catch (error) { elements.eventError.textContent = error.message; } finally { state.saving = false; } }
async function toggleEventPin() { const event = state.editingEvent; if (!event || state.saving) return; state.saving = true; try { const result = await api(`/api/events/${encodeURIComponent(event.id)}`, { method: 'PATCH', body: JSON.stringify({ pinned: !event.pinned }) }); state.editingEvent = result.event; elements.eventDialog.close(); toast(result.event.pinned ? 'Study block pinned.' : 'Study block can adapt again.'); state.calendarRangeKey = ''; await renderSchedule(); } catch (error) { elements.eventError.textContent = error.message; } finally { state.saving = false; } }
async function saveEventOutcome(outcome) { const event = state.editingEvent; if (!event || state.saving) return; state.saving = true; try { const result = await api(`/api/events/${encodeURIComponent(event.id)}/outcome`, { method: 'POST', body: JSON.stringify({ outcome }) }); elements.eventDialog.close(); toast(result.message); state.calendarRangeKey = ''; await loadDashboard(); } catch (error) { elements.eventError.textContent = error.message; } finally { state.saving = false; } }

function openAssessment(task) {
  const completed = Math.max(0, task.estimatedMinutes - task.remainingMinutes); elements.assessmentDetail.innerHTML = `<div class="connection-card"><strong>${escapeHtml(task.title)}</strong><p>${escapeHtml(task.subject || 'General')} · ${escapeHtml(task.taskType)} · Due ${escapeHtml(formatDue(task.dueAt, state.data.user.timezone))}</p><div class="progress-track"><div class="progress-fill" style="width:${task.estimatedMinutes ? Math.round(completed / task.estimatedMinutes * 100) : 0}%"></div></div><p>${formatDuration(task.remainingMinutes)} remaining of ${formatDuration(task.estimatedMinutes)} · ${task.status}</p>${task.notes ? `<p>${escapeHtml(task.notes)}</p>` : ''}</div>`; document.querySelector('#assessment-title').textContent = task.title; elements.assessmentDialog.showModal();
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
function preferredTheme() { try { const saved = localStorage.getItem('arcadia-theme'); return themes.includes(saved) ? saved : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch { return 'light'; } }
function applyTheme(theme) {
  const safeTheme = themes.includes(theme) ? theme : 'light';
  document.documentElement.dataset.theme = safeTheme;
  try { localStorage.setItem('arcadia-theme', safeTheme); } catch {}
  updateThemeControls();
}
async function saveTheme(theme) {
  applyTheme(theme);
  try { await api('/api/account', { method: 'PATCH', body: JSON.stringify({ theme }) }); if (state.data?.preferences) state.data.preferences.theme = theme; }
  catch (caught) { toast(caught.message); }
}

async function saveProfile(event) {
  event.preventDefault(); const error = document.querySelector('#profile-error'); error.textContent = '';
  try {
    const result = await api('/api/account', { method: 'PATCH', body: JSON.stringify({ name: document.querySelector('#account-display-name').value }) });
    state.data.user.name = result.account.name; renderAll(); toast('Profile saved.');
  } catch (caught) { error.textContent = caught.message; }
}

async function changeEmail(event) {
  event.preventDefault(); const error = document.querySelector('#email-error'); error.textContent = '';
  try {
    const result = await api('/api/account/change-email', { method: 'POST', body: JSON.stringify({ email: document.querySelector('#new-email').value, currentPassword: document.querySelector('#email-password').value }) });
    elements.emailForm.reset(); toast(result.message);
  } catch (caught) { error.textContent = caught.message; }
}

async function changePassword(event) {
  event.preventDefault(); const error = document.querySelector('#password-error'); error.textContent = '';
  try {
    const result = await api('/api/account/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: document.querySelector('#current-password').value, newPassword: document.querySelector('#new-password').value }) });
    state.csrfToken = result.csrfToken; elements.passwordForm.reset(); toast('Password updated. Other devices have been signed out.');
  } catch (caught) { error.textContent = caught.message; }
}

async function signOut(everywhere = false) {
  try { await api(everywhere ? '/api/auth/logout-all' : '/api/auth/logout', { method: 'POST' }); }
  catch (caught) { if (caught.status !== 401) { toast(caught.message); return; } }
  location.assign('/login');
}

async function deleteAccount(event) {
  event.preventDefault(); const error = document.querySelector('#delete-error'); error.textContent = '';
  try {
    await api('/api/account', { method: 'DELETE', body: JSON.stringify({ password: document.querySelector('#delete-password').value, confirmation: document.querySelector('#delete-confirmation').value }) });
    location.assign('/register');
  } catch (caught) { error.textContent = caught.message; }
}
function updateThemeControls() {
  const theme = document.documentElement.dataset.theme || 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColours[theme] || themeColours.light);
  if (elements.themeSelect) elements.themeSelect.value = theme;
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
  const method = String(options.method || 'GET').toUpperCase();
  const response = await fetch(path, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) && state.csrfToken ? { 'x-csrf-token': state.csrfToken } : {}), ...(options.headers || {}) } });
  let data = {}; try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) { if (response.status === 401 && location.pathname !== '/login') location.assign('/login'); const error = new Error(data.error || 'Arcadia could not complete that request.'); error.status = response.status; error.data = data; throw error; }
  return data;
}
