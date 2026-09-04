// Analytics widget board. Loaded as a classic script before dashboard.js, so it shares the
// same global lexical scope: `state`, `elements`, `api`, `toast`, `formatDuration`,
// `escapeHtml`, `renderIcons` and friends all come from dashboard.js and are only touched at
// call time, never at load time.

const WIDGET_TOOLTIP_DELAY = 320;
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const analyticsBoard = {
  payload: null,
  heatmap: null,
  heatmapKey: '',
  heatmapRequest: 0,
  expanded: null,
  restoreFocus: null,
  slot: null,
  settingsTimer: null,
  settingsSnapshot: null,
  tooltipTimer: null,
  tooltipOpen: false,
  bound: false
};

function analyticsSettings() {
  const stored = state.analyticsSettings || state.data?.analyticsSettings || {};
  return {
    heatmap: { window: 371, metric: 'minutes', includeTracker: true, weekStart: 'monday', ...(stored.heatmap || {}) },
    trend: { metric: 'minutes', compare: true, ...(stored.trend || {}) },
    subjects: { sort: 'minutes', limit: 6, ...(stored.subjects || {}) },
    rhythm: { metric: 'minutes', ...(stored.rhythm || {}) }
  };
}

// ---------------------------------------------------------------- board lifecycle

function renderAnalyticsBoard(payload) {
  analyticsBoard.payload = payload;
  if (payload?.settings) state.analyticsSettings = payload.settings;
  bindAnalyticsBoard();

  const timezone = payload.timezone || state.data?.user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  elements.analyticsRangeLabel.textContent = analyticsRangeText(payload.period, payload.range, timezone);

  renderWidget('kpi');
  renderWidget('trend');
  renderWidget('streak');
  renderWidget('subjects');
  renderWidget('rhythm');
  loadAnalyticsHeatmap();
}

function analyticsBoardError(message) {
  bindAnalyticsBoard();
  for (const name of ['kpi', 'trend', 'streak', 'subjects', 'rhythm', 'heatmap']) {
    const widget = analyticsWidget(name);
    if (widget) setWidgetBody(widget, widgetError(message));
  }
}

function analyticsWidget(name) { return document.querySelector(`.widget[data-widget="${name}"]`); }

function setWidgetBody(widget, html) {
  widget.classList.remove('loading');
  widget.querySelector('.widget-body').innerHTML = html;
}

function setWidgetDetail(widget, html) {
  widget.querySelector('.widget-detail').innerHTML = html;
}

function widgetError(message) {
  return `<div class="widget-error"><strong>Could not load this</strong><span>${escapeHtml(message || 'Something went wrong.')}</span><button class="button small" type="button" data-widget-retry>Try again</button></div>`;
}

function widgetEmpty(title, detail) {
  return `<div class="widget-empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
}

function renderWidget(name) {
  const widget = analyticsWidget(name);
  if (!widget) return;
  const payload = analyticsBoard.payload;
  if (!payload && name !== 'heatmap') return;
  const expanded = widget.classList.contains('expanded');
  try {
    if (name === 'kpi') renderKpiWidget(widget, payload, expanded);
    if (name === 'trend') renderTrendWidget(widget, payload, expanded);
    if (name === 'streak') renderStreakWidget(widget, payload, expanded);
    if (name === 'subjects') renderSubjectsWidget(widget, payload, expanded);
    if (name === 'rhythm') renderRhythmWidget(widget, payload, expanded);
    if (name === 'heatmap') renderHeatmapWidget(widget, expanded);
  } catch (error) {
    setWidgetBody(widget, widgetError(error.message));
  }
  renderIcons(widget);
}

function renderAnalyticsWidgets() {
  for (const name of ['kpi', 'trend', 'streak', 'subjects', 'rhythm', 'heatmap']) renderWidget(name);
}

// ---------------------------------------------------------------- heatmap data

async function loadAnalyticsHeatmap({ force = false } = {}) {
  const widget = analyticsWidget('heatmap');
  if (!widget) return;
  const settings = analyticsSettings().heatmap;
  const anchor = new Date();
  const key = `${settings.window}:${anchor.toISOString().slice(0, 10)}`;
  if (!force && analyticsBoard.heatmap && analyticsBoard.heatmapKey === key) { renderWidget('heatmap'); return; }

  const requestId = ++analyticsBoard.heatmapRequest;
  widget.classList.add('loading');
  try {
    const result = await api(`/api/analytics/heatmap?days=${settings.window}&end=${encodeURIComponent(anchor.toISOString())}`);
    if (requestId !== analyticsBoard.heatmapRequest) return;
    analyticsBoard.heatmap = result;
    analyticsBoard.heatmapKey = key;
    renderWidget('heatmap');
  } catch (error) {
    if (requestId !== analyticsBoard.heatmapRequest) return;
    setWidgetBody(widget, widgetError(error.message));
  }
}

// ---------------------------------------------------------------- widgets

function renderKpiWidget(widget, payload, expanded) {
  const analytics = payload.analytics;
  const current = payload.current || {};
  const previous = payload.previous || {};
  const daily = payload.daily || [];
  const tiles = [
    { label: 'Focused time', value: formatDuration(current.minutes ?? analytics.focusedMinutes), raw: current.minutes ?? 0, previous: previous.minutes ?? 0, series: daily.map((row) => row.minutes), detail: 'Completed study blocks and tracked sessions.' },
    { label: 'Completion', value: `${analytics.completionRate}%`, raw: current.completionRate ?? analytics.completionRate, previous: previous.completionRate ?? 0, suffix: 'pt', series: daily.map((row) => (row.completedCount + row.missedCount ? Math.round((row.completedCount / (row.completedCount + row.missedCount)) * 100) : 0)), detail: 'Share of finished sessions that were completed rather than missed.' },
    { label: 'Sessions', value: String(current.completedCount ?? analytics.completedCount), raw: current.completedCount ?? 0, previous: previous.completedCount ?? 0, series: daily.map((row) => row.completedCount), detail: 'Study blocks and tracker sessions you finished.' },
    { label: 'Missed', value: String(current.missedCount ?? analytics.missedCount), raw: current.missedCount ?? 0, previous: previous.missedCount ?? 0, invert: true, series: daily.map((row) => row.missedCount), detail: 'Sessions marked missed. Lower is better.' },
    { label: 'Active days', value: String(current.activeDays ?? 0), raw: current.activeDays ?? 0, previous: previous.activeDays ?? 0, series: daily.map((row) => (row.minutes > 0 ? 1 : 0)), detail: 'Days in this period with any study at all.' },
    { label: 'Capacity left', value: formatDuration(analytics.capacityMinutes), raw: analytics.capacityMinutes, series: daily.map((row) => row.plannedMinutes), detail: 'Study time still unplanned, after your scheduled blocks.' }
  ];

  setWidgetBody(widget, `<div class="stat-strip">${tiles.map((tile) => statTile(tile)).join('')}</div>`);
  setWidgetDetail(widget, `<div class="widget-detail-inner"><h3 class="widget-detail-title">What these mean</h3><dl class="metric-glossary">${tiles.map((tile) => `<div><dt>${escapeHtml(tile.label)}</dt><dd>${escapeHtml(tile.detail)}</dd></div>`).join('')}</dl></div>`);
  void expanded;
}

function statTile(tile) {
  const delta = tile.previous === undefined ? null : (tile.raw || 0) - (tile.previous || 0);
  const good = tile.invert ? delta < 0 : delta > 0;
  const trendClass = !delta ? 'flat' : good ? 'up' : 'down';
  const arrow = !delta ? '·' : delta > 0 ? '▲' : '▼';
  const deltaLabel = delta === null || !delta
    ? 'Same as last period'
    : `${arrow} ${tile.label === 'Focused time' ? formatDuration(Math.abs(delta)) : `${Math.abs(delta)}${tile.suffix || ''}`} vs last period`;
  return `<div class="stat-tile">
    <span class="stat-label">${escapeHtml(tile.label)}</span>
    <strong class="stat-value">${escapeHtml(tile.value)}</strong>
    <div class="stat-spark">${sparkline(tile.series || [])}</div>
    <span class="stat-delta ${trendClass}">${escapeHtml(deltaLabel)}</span>
  </div>`;
}

function renderTrendWidget(widget, payload, expanded) {
  const settings = analyticsSettings().trend;
  const daily = payload.daily || [];
  if (!daily.length) { setWidgetBody(widget, widgetEmpty('Nothing to plot yet', 'Complete a study session in this period to see the trend.')); return; }

  const metric = settings.metric;
  const valueOf = (row) => trendValue(row, metric);
  const points = daily.map((row) => ({ label: shortDateLabel(row.date), value: valueOf(row), row }));
  const comparison = settings.compare && payload.previousDaily ? payload.previousDaily.map(valueOf) : null;

  setWidgetBody(widget, `
    <div class="chart-frame" data-chart="trend">
      ${areaChart(points, { height: expanded ? 300 : 190, metric, comparison })}
    </div>
    <div class="chart-legend"><span class="legend-key accent"></span>${escapeHtml(trendMetricLabel(metric))}</div>
  `);

  const total = points.reduce((sum, point) => sum + point.value, 0);
  const best = points.reduce((top, point) => (point.value > (top?.value || 0) ? point : top), null);
  setWidgetDetail(widget, `<div class="widget-detail-inner">
    ${widgetSettings('trend', [
      selectSetting('trend', 'metric', 'Measure', [['minutes', 'Focused minutes'], ['sessions', 'Sessions'], ['completion', 'Completion %']], metric),
      toggleSetting('trend', 'compare', 'Show previous period', settings.compare)
    ])}
    <h3 class="widget-detail-title">Day by day</h3>
    <p class="widget-detail-note">${escapeHtml(`${trendMetricLabel(metric)} totalling ${metric === 'minutes' ? formatDuration(total) : total}${best && best.value ? `, best on ${best.label}` : ''}.`)}</p>
    <div class="detail-table-scroll"><table class="detail-table">
      <thead><tr><th>Day</th><th>Focused</th><th>Sessions</th><th>Missed</th><th>Top subject</th></tr></thead>
      <tbody>${daily.map((row) => `<tr><td>${escapeHtml(shortDateLabel(row.date, true))}</td><td>${escapeHtml(formatDuration(row.minutes))}</td><td>${row.completedCount}</td><td>${row.missedCount}</td><td>${escapeHtml(row.topSubject || '—')}</td></tr>`).join('')}</tbody>
    </table></div>
  </div>`);
}

function trendValue(row, metric) {
  if (metric === 'sessions') return row.completedCount;
  if (metric === 'completion') {
    const finished = row.completedCount + row.missedCount;
    return finished ? Math.round((row.completedCount / finished) * 100) : 0;
  }
  return row.minutes;
}

function trendMetricLabel(metric) {
  return metric === 'sessions' ? 'Sessions completed' : metric === 'completion' ? 'Completion rate' : 'Focused minutes';
}

function renderStreakWidget(widget, payload, expanded) {
  const streaks = payload.streaks || { current: 0, longest: 0, activeDays: 0, totalDays: 0 };
  const daily = payload.daily || [];
  const recent = daily.slice(-7);
  const consistency = streaks.totalDays ? Math.round((streaks.activeDays / streaks.totalDays) * 100) : 0;

  setWidgetBody(widget, `
    <div class="streak-hero">
      <strong class="streak-value">${streaks.current}</strong>
      <span class="streak-unit">day${streaks.current === 1 ? '' : 's'} in a row</span>
    </div>
    <div class="streak-dots" role="img" aria-label="${escapeAttr(`Study on the last ${recent.length} days`)}">
      ${recent.map((row) => `<span class="streak-dot${row.minutes > 0 ? ' on' : ''}" title="${escapeAttr(`${row.date}: ${formatDuration(row.minutes)}`)}"></span>`).join('')}
    </div>
    <div class="streak-facts">
      <div><span>Longest run</span><strong>${streaks.longest}d</strong></div>
      <div><span>Active days</span><strong>${streaks.activeDays}/${streaks.totalDays}</strong></div>
      <div><span>Consistency</span><strong>${consistency}%</strong></div>
    </div>
  `);

  const byWeekday = new Array(7).fill(0);
  const countWeekday = new Array(7).fill(0);
  for (const row of daily) {
    const weekday = weekdayOfDateKey(row.date);
    byWeekday[weekday] += row.minutes;
    countWeekday[weekday] += 1;
  }
  const maximum = Math.max(1, ...byWeekday);
  setWidgetDetail(widget, `<div class="widget-detail-inner">
    <h3 class="widget-detail-title">Which days you actually study</h3>
    <div class="weekday-bars">${WEEKDAY_LABELS.map((label, index) => `
      <div class="weekday-bar"><span class="weekday-bar-label">${label}</span>
        <div class="weekday-bar-track"><div class="weekday-bar-fill" style="width:${Math.round((byWeekday[index] / maximum) * 100)}%"></div></div>
        <span class="weekday-bar-value">${escapeHtml(formatDuration(countWeekday[index] ? Math.round(byWeekday[index] / countWeekday[index]) : 0))} avg</span></div>`).join('')}
    </div>
  </div>`);
  void expanded;
}

function renderSubjectsWidget(widget, payload, expanded) {
  const settings = analyticsSettings().subjects;
  const all = sortSubjects(payload.subjects || [], settings.sort);
  if (!all.length) { setWidgetBody(widget, widgetEmpty('No completed study yet', 'Finish a study block in this period to see your subject balance.')); setWidgetDetail(widget, ''); return; }

  const shown = expanded ? all : all.slice(0, settings.limit);
  const total = all.reduce((sum, subject) => sum + subject.minutes, 0) || 1;
  const segments = shown.map((subject, index) => ({ ...subject, share: subject.minutes / total, tone: index }));

  setWidgetBody(widget, `
    <div class="subject-split">
      <div class="donut-wrap">${donut(segments, formatDuration(total))}</div>
      <ul class="subject-legend">${segments.map((segment) => `
        <li><span class="legend-key" data-tone="${segment.tone % 6}"></span>
          <span class="subject-legend-name">${escapeHtml(segment.subject)}</span>
          <span class="subject-legend-value">${escapeHtml(formatDuration(segment.minutes))} · ${Math.round(segment.share * 100)}%</span></li>`).join('')}
      </ul>
    </div>
  `);

  setWidgetDetail(widget, `<div class="widget-detail-inner">
    ${widgetSettings('subjects', [
      selectSetting('subjects', 'sort', 'Sort by', [['minutes', 'Time studied'], ['sessions', 'Session count'], ['name', 'Name']], settings.sort),
      selectSetting('subjects', 'limit', 'Show on card', [[3, 'Top 3'], [6, 'Top 6'], [10, 'Top 10'], [20, 'Top 20']], settings.limit)
    ])}
    <h3 class="widget-detail-title">All subjects</h3>
    <div class="detail-table-scroll"><table class="detail-table">
      <thead><tr><th>Subject</th><th>Time</th><th>Sessions</th><th>Share</th></tr></thead>
      <tbody>${all.map((subject) => `<tr><td>${escapeHtml(subject.subject)}</td><td>${escapeHtml(formatDuration(subject.minutes))}</td><td>${subject.sessions}</td><td>${Math.round((subject.minutes / total) * 100)}%</td></tr>`).join('')}</tbody>
    </table></div>
  </div>`);
}

function sortSubjects(subjects, sort) {
  const copy = [...subjects];
  if (sort === 'name') return copy.sort((a, b) => a.subject.localeCompare(b.subject));
  if (sort === 'sessions') return copy.sort((a, b) => b.sessions - a.sessions || b.minutes - a.minutes);
  return copy.sort((a, b) => b.minutes - a.minutes);
}

function renderRhythmWidget(widget, payload, expanded) {
  const settings = analyticsSettings().rhythm;
  const cells = payload.hourly || [];
  if (!cells.length) { setWidgetBody(widget, widgetEmpty('No rhythm yet', 'Once you log a few sessions, your best focus windows appear here.')); setWidgetDetail(widget, ''); return; }

  const metric = settings.metric;
  const lookup = new Map(cells.map((cell) => [`${cell.weekday}:${cell.hour}`, cell]));
  const values = cells.map((cell) => (metric === 'sessions' ? cell.sessions : cell.minutes));
  const thresholds = localThresholds(values);
  // The card shows waking hours only; the expanded view shows the full 24.
  const hours = expanded ? hourRange(0, 23) : hourRange(6, 23);

  const grid = `<div class="rhythm-grid${expanded ? ' expanded' : ''}" style="--rhythm-columns:${hours.length}">
    <div class="rhythm-corner"></div>
    ${hours.map((hour) => `<span class="rhythm-hour${hour % 3 === 0 || expanded ? '' : ' faint'}">${expanded || hour % 3 === 0 ? formatHourLabel(hour) : ''}</span>`).join('')}
    ${WEEKDAY_LABELS.map((label, weekday) => `<span class="rhythm-day">${label}</span>${hours.map((hour) => {
      const cell = lookup.get(`${weekday}:${hour}`);
      const value = cell ? (metric === 'sessions' ? cell.sessions : cell.minutes) : 0;
      const level = levelFor(value, thresholds);
      const detail = value ? `${label} ${formatHourLabel(hour)} · ${formatDuration(cell.minutes)} across ${cell.sessions} session${cell.sessions === 1 ? '' : 's'}` : `${label} ${formatHourLabel(hour)} · no study`;
      return `<button class="heat-cell rhythm-cell" type="button" data-level="${level}" data-tip="${escapeAttr(detail)}" aria-label="${escapeAttr(detail)}" tabindex="-1"></button>`;
    }).join('')}`).join('')}
  </div>`;

  const best = cells.reduce((top, cell) => ((metric === 'sessions' ? cell.sessions : cell.minutes) > (top ? (metric === 'sessions' ? top.sessions : top.minutes) : 0) ? cell : top), null);
  setWidgetBody(widget, `${grid}${best ? `<p class="rhythm-note">Your strongest window is <strong>${escapeHtml(WEEKDAY_LABELS[best.weekday])} ${escapeHtml(formatHourLabel(best.hour))}</strong> — ${escapeHtml(formatDuration(best.minutes))} logged there.</p>` : ''}`);

  const byHour = new Array(24).fill(0);
  for (const cell of cells) byHour[cell.hour] += cell.minutes;
  const peak = byHour.indexOf(Math.max(...byHour));
  setWidgetDetail(widget, `<div class="widget-detail-inner">
    ${widgetSettings('rhythm', [selectSetting('rhythm', 'metric', 'Shade by', [['minutes', 'Minutes studied'], ['sessions', 'Session count']], metric)])}
    <h3 class="widget-detail-title">Time of day</h3>
    <p class="widget-detail-note">Most of your study lands around ${escapeHtml(formatHourLabel(peak))}. Cells are shaded against your own busiest hour, not a fixed scale.</p>
  </div>`);
}

function renderHeatmapWidget(widget, expanded) {
  const data = analyticsBoard.heatmap;
  if (!data) { setWidgetBody(widget, `<div class="widget-skeleton" aria-hidden="true"></div>`); widget.classList.add('loading'); return; }
  const settings = analyticsSettings().heatmap;
  const metric = settings.metric;
  const days = data.days || [];
  if (!days.length) { setWidgetBody(widget, widgetEmpty('No study recorded yet', 'Every day you study fills in a square here.')); return; }

  // The card is a readable slice of the tail; expanded shows the whole requested window.
  const visible = expanded ? days : days.slice(-119);
  const thresholds = (data.thresholds || {})[metric] || [1, 2, 3, 4];
  const weeks = groupIntoWeeks(visible, settings.weekStart);

  const monthRow = weeks.map((week) => {
    const first = week.find((cell) => cell);
    if (!first) return '<span class="heat-month"></span>';
    const day = Number(first.date.slice(8, 10));
    const month = Number(first.date.slice(5, 7)) - 1;
    return `<span class="heat-month">${day <= 7 ? MONTH_LABELS[month] : ''}</span>`;
  }).join('');

  const rowLabels = orderedWeekdays(settings.weekStart);
  const grid = weeks.map((week) => `<div class="heat-week">${week.map((cell) => {
    if (!cell) return '<span class="heat-cell empty" aria-hidden="true"></span>';
    const value = metric === 'sessions' ? cell.sessions : cell.minutes;
    return `<button class="heat-cell" type="button" data-level="${levelFor(value, thresholds)}" data-date="${escapeAttr(cell.date)}" data-tip="${escapeAttr(heatmapTip(cell))}" aria-label="${escapeAttr(heatmapTip(cell))}" tabindex="-1"></button>`;
  }).join('')}</div>`).join('');

  setWidgetBody(widget, `
    <div class="heat-scroll">
      <div class="heat-canvas">
        <div class="heat-months" style="--heat-weeks:${weeks.length}">${monthRow}</div>
        <div class="heat-body">
          <div class="heat-weekdays">${rowLabels.map((label, index) => `<span class="heat-weekday">${index % 2 === 1 ? label : ''}</span>`).join('')}</div>
          <div class="heat-grid" role="grid" aria-label="Study calendar">${grid}</div>
        </div>
      </div>
    </div>
    <div class="heat-footer">
      <span class="heat-hint">Click a day to focus the rest of the board on it.</span>
      <div class="heat-legend"><span>Less</span>${[0, 1, 2, 3, 4, 5].map((level) => `<span class="heat-cell legend" data-level="${level}"></span>`).join('')}<span>More</span></div>
    </div>
  `);

  const total = visible.reduce((sum, cell) => sum + cell.minutes, 0);
  const active = visible.filter((cell) => cell.minutes > 0).length;
  setWidgetDetail(widget, `<div class="widget-detail-inner">
    ${widgetSettings('heatmap', [
      selectSetting('heatmap', 'window', 'Window', [[92, 'Last 3 months'], [183, 'Last 6 months'], [371, 'Last 12 months']], settings.window),
      selectSetting('heatmap', 'metric', 'Shade by', [['minutes', 'Minutes studied'], ['sessions', 'Session count']], settings.metric),
      selectSetting('heatmap', 'weekStart', 'Week starts', [['monday', 'Monday'], ['sunday', 'Sunday']], settings.weekStart)
    ])}
    <p class="widget-detail-note">${escapeHtml(`${formatDuration(total)} of study across ${active} day${active === 1 ? '' : 's'} in this window. Shading is scaled to your own busiest days, so a quiet month still reads clearly.`)}</p>
  </div>`);
}

function heatmapTip(cell) {
  const label = longDateLabel(cell.date);
  if (!cell.minutes && !cell.missedCount) return `${label} · no study`;
  const parts = [`${formatDuration(cell.minutes)} studied`];
  if (cell.sessions) parts.push(`${cell.sessions} session${cell.sessions === 1 ? '' : 's'}`);
  if (cell.topSubject) parts.push(`mostly ${cell.topSubject}`);
  if (cell.missedCount) parts.push(`${cell.missedCount} missed`);
  return `${label} · ${parts.join(' · ')}`;
}

function groupIntoWeeks(cells, weekStart) {
  const offset = weekStart === 'sunday' ? 1 : 0;
  const weeks = [];
  let week = new Array(7).fill(null);
  let filled = false;
  for (const cell of cells) {
    const row = (weekdayOfDateKey(cell.date) + offset) % 7;
    if (filled && row === 0) { weeks.push(week); week = new Array(7).fill(null); }
    week[row] = cell;
    filled = true;
  }
  if (filled) weeks.push(week);
  return weeks;
}

function orderedWeekdays(weekStart) {
  return weekStart === 'sunday' ? ['Sun', ...WEEKDAY_LABELS.slice(0, 6)] : WEEKDAY_LABELS;
}

// ---------------------------------------------------------------- charts

function sparkline(values, { width = 120, height = 30 } = {}) {
  const series = (values || []).map((value) => Number(value) || 0);
  if (series.length < 2) return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"></svg>`;
  const maximum = Math.max(...series, 1);
  const step = width / (series.length - 1);
  const path = series.map((value, index) => `${index ? 'L' : 'M'}${(index * step).toFixed(2)} ${(height - (value / maximum) * (height - 2) - 1).toFixed(2)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" /></svg>`;
}

function areaChart(points, { height = 190, metric = 'minutes', comparison = null } = {}) {
  const width = 640;
  const padding = { top: 14, right: 10, bottom: 26, left: 40 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = points.map((point) => point.value);
  const maximum = Math.max(1, ...values, ...(comparison || []));
  const ticks = niceTicks(maximum);
  const scaleX = (index) => padding.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const scaleY = (value) => padding.top + plotHeight - (value / ticks.max) * plotHeight;

  const line = points.map((point, index) => `${index ? 'L' : 'M'}${scaleX(index).toFixed(2)} ${scaleY(point.value).toFixed(2)}`).join(' ');
  const area = `${line} L${scaleX(points.length - 1).toFixed(2)} ${(padding.top + plotHeight).toFixed(2)} L${scaleX(0).toFixed(2)} ${(padding.top + plotHeight).toFixed(2)} Z`;
  const compareLine = comparison && comparison.length
    ? comparison.map((value, index) => `${index ? 'L' : 'M'}${scaleX(Math.min(index, points.length - 1)).toFixed(2)} ${scaleY(value).toFixed(2)}`).join(' ')
    : null;

  const gridLines = ticks.values.map((value) => `
    <line class="chart-grid" x1="${padding.left}" x2="${width - padding.right}" y1="${scaleY(value).toFixed(2)}" y2="${scaleY(value).toFixed(2)}" />
    <text class="chart-axis" x="${padding.left - 8}" y="${(scaleY(value) + 3.5).toFixed(2)}" text-anchor="end">${escapeHtml(formatAxisValue(value, metric))}</text>`).join('');

  const labelEvery = Math.max(1, Math.ceil(points.length / 7));
  const xLabels = points.map((point, index) => (index % labelEvery === 0 || index === points.length - 1
    ? `<text class="chart-axis" x="${scaleX(index).toFixed(2)}" y="${height - 8}" text-anchor="middle">${escapeHtml(point.label)}</text>` : '')).join('');

  const bandWidth = points.length > 1 ? plotWidth / (points.length - 1) : plotWidth;
  const hotspots = points.map((point, index) => `<rect class="chart-band" x="${(scaleX(index) - bandWidth / 2).toFixed(2)}" y="${padding.top}" width="${bandWidth.toFixed(2)}" height="${plotHeight}" data-index="${index}" data-cx="${scaleX(index).toFixed(2)}" data-cy="${scaleY(point.value).toFixed(2)}" data-tip="${escapeAttr(`${point.label} · ${formatAxisValue(point.value, metric)}`)}" tabindex="-1" aria-label="${escapeAttr(`${point.label}: ${formatAxisValue(point.value, metric)}`)}" />`).join('');

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeAttr(trendMetricLabel(metric))}">
    <defs><linearGradient id="chart-fade" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="var(--accent)" stop-opacity=".34" />
      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
    </linearGradient></defs>
    ${gridLines}
    <path class="chart-area" d="${area}" fill="url(#chart-fade)" />
    ${compareLine ? `<path class="chart-compare" d="${compareLine}" fill="none" />` : ''}
    <path class="chart-line" d="${line}" fill="none" />
    ${xLabels}
    <line class="chart-crosshair" x1="0" x2="0" y1="${padding.top}" y2="${padding.top + plotHeight}" hidden />
    <circle class="chart-marker" r="4.5" hidden />
    ${hotspots}
  </svg>`;
}

function donut(segments, centreLabel) {
  const size = 140; const radius = 54; const stroke = 20;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const arcs = segments.map((segment, index) => {
    const length = Math.max(0, segment.share) * circumference;
    const arc = `<circle class="donut-arc" data-tone="${index % 6}" cx="${size / 2}" cy="${size / 2}" r="${radius}"
      stroke-width="${stroke}" fill="none" stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}"
      data-tip="${escapeAttr(`${segment.subject} · ${formatDuration(segment.minutes)} · ${Math.round(segment.share * 100)}%`)}" />`;
    offset += length;
    return arc;
  }).join('');
  return `<svg class="donut" viewBox="0 0 ${size} ${size}" role="img" aria-label="Study time by subject">
    <circle class="donut-track" cx="${size / 2}" cy="${size / 2}" r="${radius}" stroke-width="${stroke}" fill="none" />
    <g transform="rotate(-90 ${size / 2} ${size / 2})">${arcs}</g>
    <text class="donut-value" x="${size / 2}" y="${size / 2 + 2}" text-anchor="middle">${escapeHtml(centreLabel)}</text>
    <text class="donut-caption" x="${size / 2}" y="${size / 2 + 18}" text-anchor="middle">total</text>
  </svg>`;
}

function niceTicks(maximum) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, maximum)));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => maximum / candidate <= 4) || magnitude * 10;
  const max = Math.ceil(maximum / step) * step;
  const values = [];
  for (let value = 0; value <= max + 0.001; value += step) values.push(Math.round(value));
  return { max: max || 1, values };
}

function formatAxisValue(value, metric) {
  if (metric === 'completion') return `${Math.round(value)}%`;
  if (metric === 'sessions') return String(Math.round(value));
  return formatDuration(value);
}

// ---------------------------------------------------------------- settings controls

function widgetSettings(widget, controls) {
  return `<div class="widget-settings"><h3 class="widget-detail-title">Settings</h3><div class="widget-settings-grid" data-settings-widget="${widget}">${controls.join('')}</div></div>`;
}

function selectSetting(widget, field, label, options, value) {
  const id = `setting-${widget}-${field}`;
  return `<div class="field"><label for="${id}">${escapeHtml(label)}</label>
    <select id="${id}" data-setting-widget="${widget}" data-setting-field="${field}">
      ${options.map(([optionValue, optionLabel]) => `<option value="${escapeAttr(String(optionValue))}"${String(optionValue) === String(value) ? ' selected' : ''}>${escapeHtml(optionLabel)}</option>`).join('')}
    </select></div>`;
}

function toggleSetting(widget, field, label, value) {
  const id = `setting-${widget}-${field}`;
  return `<label class="widget-check" for="${id}"><input id="${id}" type="checkbox" data-setting-widget="${widget}" data-setting-field="${field}"${value ? ' checked' : ''} /> ${escapeHtml(label)}</label>`;
}

function onAnalyticsSettingChange(control) {
  const widget = control.dataset.settingWidget;
  const field = control.dataset.settingField;
  if (!widget || !field) return;
  const raw = control.type === 'checkbox' ? control.checked : control.value;
  const value = control.type === 'checkbox' ? raw : (/^\d+$/.test(raw) ? Number(raw) : raw);

  const settings = analyticsSettings();
  if (!analyticsBoard.settingsSnapshot) analyticsBoard.settingsSnapshot = settings;
  state.analyticsSettings = { ...settings, [widget]: { ...settings[widget], [field]: value } };

  if (widget === 'heatmap' && field === 'window') loadAnalyticsHeatmap({ force: true });
  else renderWidget(widget === 'heatmap' ? 'heatmap' : widget);
  if (widget === 'subjects') renderWidget('subjects');

  clearTimeout(analyticsBoard.settingsTimer);
  analyticsBoard.settingsTimer = setTimeout(saveAnalyticsSettings, 500);
}

async function saveAnalyticsSettings() {
  const snapshot = analyticsBoard.settingsSnapshot;
  try {
    const result = await api('/api/analytics/settings', { method: 'PATCH', body: JSON.stringify(state.analyticsSettings) });
    state.analyticsSettings = result.settings;
    if (state.data) state.data.analyticsSettings = result.settings;
    analyticsBoard.settingsSnapshot = null;
  } catch (error) {
    if (snapshot) state.analyticsSettings = snapshot;
    analyticsBoard.settingsSnapshot = null;
    renderAnalyticsWidgets();
    toast(error.message || 'Could not save that setting.');
  }
}

// ---------------------------------------------------------------- expand / collapse

function expandWidget(widget) {
  if (analyticsBoard.expanded === widget) { collapseWidget(); return; }
  if (analyticsBoard.expanded) collapseWidget({ animate: false });

  const stage = document.querySelector('.widget-stage');
  const scrim = document.querySelector('.widget-scrim');
  const first = widget.getBoundingClientRect();

  const slot = document.createElement('div');
  slot.className = 'widget-slot';
  slot.style.height = `${first.height}px`;
  slot.style.gridColumn = getComputedStyle(widget).gridColumn;
  widget.after(slot);
  analyticsBoard.slot = slot;

  analyticsBoard.restoreFocus = document.activeElement;
  stage.hidden = false;
  scrim.hidden = false;
  stage.append(widget);
  widget.classList.add('expanded');
  widget.setAttribute('aria-expanded', 'true');
  widget.querySelector('.widget-detail').hidden = false;
  document.querySelector('.app-shell').inert = true;
  analyticsBoard.expanded = widget;

  renderWidget(widget.dataset.widget);
  updateWidgetChrome(widget, true);

  const last = widget.getBoundingClientRect();
  animateWidget(widget, first, last, scrim, true);
  (widget.querySelector('.widget-expand') || widget).focus({ preventScroll: true });
}

function collapseWidget({ animate = true } = {}) {
  const widget = analyticsBoard.expanded;
  if (!widget) return;
  const stage = document.querySelector('.widget-stage');
  const scrim = document.querySelector('.widget-scrim');
  const slot = analyticsBoard.slot;
  const first = widget.getBoundingClientRect();

  analyticsBoard.expanded = null;
  analyticsBoard.slot = null;
  widget.classList.remove('expanded');
  widget.setAttribute('aria-expanded', 'false');
  widget.querySelector('.widget-detail').hidden = true;
  if (slot) slot.replaceWith(widget); else document.querySelector('.widget-board')?.append(widget);
  document.querySelector('.app-shell').inert = false;

  renderWidget(widget.dataset.widget);
  updateWidgetChrome(widget, false);
  hideWidgetTooltip();

  const last = widget.getBoundingClientRect();
  if (animate && !reducedMotion()) {
    animateWidget(widget, first, last, scrim, false).finished.finally(() => {
      if (!analyticsBoard.expanded) { stage.hidden = true; scrim.hidden = true; }
    });
  } else {
    stage.hidden = true;
    scrim.hidden = true;
  }

  const restore = analyticsBoard.restoreFocus;
  analyticsBoard.restoreFocus = null;
  if (restore && document.contains(restore)) restore.focus({ preventScroll: true });
  else widget.querySelector('.widget-expand')?.focus({ preventScroll: true });
}

function updateWidgetChrome(widget, expanded) {
  const button = widget.querySelector('.widget-expand');
  if (!button) return;
  const title = widget.querySelector('.widget-title')?.textContent || 'widget';
  button.setAttribute('aria-label', expanded ? `Close ${title}` : `Expand ${title}`);
  setIcon(button, expanded ? 'x' : 'maximize-2');
}

// The FLIP: the card keeps its identity and lifts from exactly where it sat, with the shadow
// ramp doing the work of reading as depth.
function animateWidget(widget, first, last, scrim, opening) {
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  const sx = last.width ? first.width / last.width : 1;
  const sy = last.height ? first.height / last.height : 1;
  const flat = '0 2px 6px rgba(15,17,26,.05)';
  const lifted = '0 42px 90px -28px rgba(15,17,26,.45), 0 8px 24px -12px rgba(15,17,26,.22)';

  if (reducedMotion()) {
    scrim.style.opacity = opening ? '1' : '0';
    return { finished: Promise.resolve() };
  }

  const from = { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, boxShadow: opening ? flat : lifted };
  const to = { transform: 'translate(0, 0) scale(1, 1)', boxShadow: opening ? lifted : flat };
  const options = { duration: opening ? 340 : 260, easing: 'cubic-bezier(.22,.68,.32,1)', fill: 'both' };

  scrim.animate([{ opacity: opening ? 0 : 1 }, { opacity: opening ? 1 : 0 }], { ...options, fill: 'forwards' });
  const animation = widget.animate([from, to], options);
  animation.finished.then(() => animation.cancel()).catch(() => {});
  return animation;
}

function reducedMotion() { return matchMedia('(prefers-reduced-motion: reduce)').matches; }

// ---------------------------------------------------------------- tooltip

function showWidgetTooltip(target) {
  const tooltip = document.querySelector('.widget-tooltip');
  const text = target.dataset.tip;
  if (!tooltip || !text) return;
  tooltip.textContent = text;
  tooltip.hidden = false;
  analyticsBoard.tooltipOpen = true;

  const anchor = target.getBoundingClientRect();
  const box = tooltip.getBoundingClientRect();
  let left = anchor.left + anchor.width / 2 - box.width / 2;
  let top = anchor.top - box.height - 10;
  left = Math.min(window.innerWidth - box.width - 10, Math.max(10, left));
  if (top < 10) top = anchor.bottom + 10;
  tooltip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

function hideWidgetTooltip() {
  clearTimeout(analyticsBoard.tooltipTimer);
  analyticsBoard.tooltipOpen = false;
  const tooltip = document.querySelector('.widget-tooltip');
  if (tooltip) tooltip.hidden = true;
  document.querySelectorAll('.chart .chart-crosshair, .chart .chart-marker').forEach((node) => node.setAttribute('hidden', ''));
}

function queueWidgetTooltip(target) {
  clearTimeout(analyticsBoard.tooltipTimer);
  // Once a tooltip is already open, sliding across neighbouring cells updates immediately --
  // the dwell delay only guards the first reveal.
  if (analyticsBoard.tooltipOpen) { showWidgetTooltip(target); moveChartCrosshair(target); return; }
  analyticsBoard.tooltipTimer = setTimeout(() => { showWidgetTooltip(target); moveChartCrosshair(target); }, WIDGET_TOOLTIP_DELAY);
}

function moveChartCrosshair(target) {
  if (!target.classList.contains('chart-band')) return;
  const svg = target.closest('.chart');
  const crosshair = svg?.querySelector('.chart-crosshair');
  const marker = svg?.querySelector('.chart-marker');
  if (!crosshair || !marker) return;
  crosshair.setAttribute('x1', target.dataset.cx);
  crosshair.setAttribute('x2', target.dataset.cx);
  crosshair.removeAttribute('hidden');
  marker.setAttribute('cx', target.dataset.cx);
  marker.setAttribute('cy', target.dataset.cy);
  marker.removeAttribute('hidden');
}

// ---------------------------------------------------------------- bindings

function bindAnalyticsBoard() {
  if (analyticsBoard.bound) return;
  const board = document.querySelector('.widget-board');
  if (!board) return;
  analyticsBoard.bound = true;

  board.addEventListener('click', onAnalyticsBoardClick);
  document.querySelector('.widget-stage')?.addEventListener('click', onAnalyticsBoardClick);
  document.querySelector('.widget-scrim')?.addEventListener('click', () => collapseWidget());

  for (const root of [board, document.querySelector('.widget-stage')]) {
    if (!root) continue;
    root.addEventListener('change', (event) => { if (event.target.matches('[data-setting-field]')) onAnalyticsSettingChange(event.target); });
    root.addEventListener('pointerover', (event) => {
      const target = event.target.closest('[data-tip]');
      if (target) queueWidgetTooltip(target); else hideWidgetTooltip();
    });
    root.addEventListener('pointerleave', hideWidgetTooltip);
    root.addEventListener('pointerdown', (event) => {
      const target = event.target.closest('[data-tip]');
      if (target && event.pointerType === 'touch') { clearTimeout(analyticsBoard.tooltipTimer); showWidgetTooltip(target); moveChartCrosshair(target); }
    });
    root.addEventListener('focusin', (event) => {
      const target = event.target.closest('[data-tip]');
      if (target) { clearTimeout(analyticsBoard.tooltipTimer); showWidgetTooltip(target); moveChartCrosshair(target); }
    });
    root.addEventListener('keydown', onAnalyticsGridKeydown);
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && analyticsBoard.expanded) { event.preventDefault(); collapseWidget(); }
  });
  window.addEventListener('scroll', hideWidgetTooltip, { passive: true });
  window.addEventListener('resize', () => { hideWidgetTooltip(); if (analyticsBoard.expanded) renderWidget(analyticsBoard.expanded.dataset.widget); });
}

function onAnalyticsBoardClick(event) {
  const retry = event.target.closest('[data-widget-retry]');
  if (retry) {
    const widget = retry.closest('.widget');
    if (widget?.dataset.widget === 'heatmap') loadAnalyticsHeatmap({ force: true }); else loadAnalytics();
    return;
  }

  const day = event.target.closest('.heat-cell[data-date]');
  if (day) {
    focusAnalyticsDay(day.dataset.date);
    return;
  }

  const expander = event.target.closest('.widget-expand');
  if (expander) {
    event.stopPropagation();
    const widget = expander.closest('.widget');
    if (widget === analyticsBoard.expanded) collapseWidget(); else expandWidget(widget);
    return;
  }

  // A click on the card's own chrome expands it; clicks on controls inside do not.
  const head = event.target.closest('.widget-head');
  if (head && !event.target.closest('button, a, select, input, label')) {
    const widget = head.closest('.widget');
    if (widget === analyticsBoard.expanded) collapseWidget(); else expandWidget(widget);
  }
}

function focusAnalyticsDay(date) {
  if (!date) return;
  // Midday keeps the date on the intended day once the user's zone offset is applied.
  state.analyticsDate = new Date(`${date}T12:00:00.000Z`);
  state.analyticsPeriod = 'day';
  if (analyticsBoard.expanded?.dataset.widget === 'heatmap') collapseWidget();
  loadAnalytics();
}

// Grid cells stay out of the tab order individually; arrow keys walk them instead.
function onAnalyticsGridKeydown(event) {
  const cell = event.target.closest('.heat-cell, .chart-band');
  if (!cell) return;
  const siblings = [...cell.closest('.heat-grid, .rhythm-grid, .chart').querySelectorAll('.heat-cell:not(.empty), .chart-band')];
  const index = siblings.indexOf(cell);
  const columns = cell.classList.contains('heat-cell') && cell.closest('.heat-grid') ? 7 : 1;
  const moves = { ArrowRight: columns, ArrowLeft: -columns, ArrowDown: 1, ArrowUp: -1 };
  if (columns === 1) { moves.ArrowRight = 1; moves.ArrowLeft = -1; }
  const step = moves[event.key];
  if (step === undefined) return;
  const next = siblings[index + step];
  if (!next) return;
  event.preventDefault();
  next.focus();
}

// ---------------------------------------------------------------- small helpers

function levelFor(value, thresholds) {
  const amount = Number(value) || 0;
  if (amount <= 0) return 0;
  const bands = thresholds || [1, 2, 3, 4];
  for (let index = 0; index < bands.length; index += 1) if (amount <= bands[index]) return index + 1;
  return bands.length + 1;
}

function localThresholds(values) {
  const sorted = (values || []).map((value) => Number(value) || 0).filter((value) => value > 0).sort((a, b) => a - b);
  if (!sorted.length) return [1, 2, 3, 4];
  const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
  const thresholds = [];
  for (const value of [at(0.2), at(0.45), at(0.7), at(0.9)]) {
    thresholds.push(Math.max(1, value, (thresholds[thresholds.length - 1] || 0) + 1));
  }
  return thresholds;
}

function weekdayOfDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

// Date keys arrive already resolved to the user's zone, so they are formatted at UTC noon --
// re-applying a zone here would slide them a day.
function shortDateLabel(dateKey, withWeekday = false) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', day: 'numeric', month: 'short', ...(withWeekday ? { weekday: 'short' } : {}) }).format(date);
}

function longDateLabel(dateKey) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

function formatHourLabel(hour) {
  const suffix = hour < 12 ? 'am' : 'pm';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}${suffix}`;
}

function hourRange(from, to) {
  const values = [];
  for (let value = from; value <= to; value += 1) values.push(value);
  return values;
}
