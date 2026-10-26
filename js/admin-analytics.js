/**
 * Visual Analytics Dashboard Controller
 * Powered by Chart.js with responsive, enterprise-grade charts for attendance intelligence.
 */

import { Chart } from 'chart.js/auto';

// Global Chart instances
let chartVelocity = null;
let chartRole = null;
let chartDivision = null;
let chartGeofence = null;
let chartPunctuality = null;

// Design System Color Tokens
const COLORS = {
  indigo: '#4f46e5',
  indigoLight: 'rgba(79, 70, 229, 0.15)',
  cyan: '#06b6d4',
  cyanLight: 'rgba(6, 182, 212, 0.15)',
  emerald: '#10b981',
  emeraldLight: 'rgba(16, 185, 129, 0.15)',
  amber: '#f59e0b',
  amberLight: 'rgba(245, 158, 11, 0.15)',
  rose: '#f43f5e',
  roseLight: 'rgba(244, 63, 94, 0.15)',
  slate: '#64748b',
  grid: 'rgba(226, 232, 240, 0.7)',
  darkTooltipBg: '#0f172a'
};

// Set Global Chart Defaults
Chart.defaults.font.family = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif";
Chart.defaults.color = '#475569';
Chart.defaults.plugins.tooltip.backgroundColor = COLORS.darkTooltipBg;
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.plugins.tooltip.titleFont = { weight: '700', size: 13 };
Chart.defaults.plugins.tooltip.bodyFont = { size: 12 };

/**
 * Initialize Visual Analytics Tab
 */
export function initVisualAnalytics(state, onEventChangeCallback) {
  const eventSelect = document.getElementById('analyticsEventFilter');
  if (eventSelect) {
    populateAnalyticsEventFilter(state.events);
    eventSelect.addEventListener('change', () => {
      const selectedEventId = eventSelect.value;
      updateVisualAnalytics(state, selectedEventId);
      if (onEventChangeCallback) onEventChangeCallback(selectedEventId);
    });
  }

  // Initial render
  updateVisualAnalytics(state, eventSelect ? eventSelect.value : 'All');
}

/**
 * Populate Event Selector dropdown
 */
export function populateAnalyticsEventFilter(events) {
  const select = document.getElementById('analyticsEventFilter');
  if (!select) return;

  const currentVal = select.value || 'All';
  select.innerHTML = '<option value="All">🌐 All Events (Aggregated)</option>' +
    events.map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');

  if ([...select.options].some((o) => o.value === currentVal)) {
    select.value = currentVal;
  }
}

/**
 * Event currently chosen in the Analytics drop-down
 */
function getSelectedAnalyticsEvent() {
  return document.getElementById('analyticsEventFilter')?.value || 'All';
}

/**
 * Recomputes metrics and updates all Chart.js instances.
 * Without an explicit event it keeps the one selected in the drop-down,
 * so live check-ins do not switch the charts back to All Events.
 */
export function updateVisualAnalytics(state, eventId = getSelectedAnalyticsEvent()) {
  const filteredAttendance = filterAttendanceForAnalytics(state.attendance, eventId);
  const events = state.events || [];
  const scopedEvents = eventId === 'All' ? events : events.filter((e) => e.id === eventId);

  // 1. Update KPI Summary Cards
  renderAnalyticsKpis(filteredAttendance, scopedEvents, state.members || [], eventId);

  // 2. Render / Update Charts
  renderVelocityChart(filteredAttendance);
  renderRoleChart(filteredAttendance);
  renderDivisionChart(filteredAttendance, state.divisions);
  renderGeofenceChart(filteredAttendance);
  renderPunctualityChart(filteredAttendance, events);
}

/**
 * Active members allowed to attend an event (its permitted roles)
 */
function countEligibleMembers(event, members) {
  return members.filter((m) => m.is_active && (event.permitted_roles === 'All' || m.role === event.permitted_roles)).length;
}

/**
 * Minutes since midnight of an ISO time, on the event's own clock
 */
function minutesInZone(iso, timeZone) {
  const date = new Date(iso);
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const get = (type) => Number(parts.find((p) => p.type === type)?.value);
    return get('hour') * 60 + get('minute');
  } catch (e) {
    return date.getHours() * 60 + date.getMinutes();
  }
}

/**
 * 'early' (before the event start), 'late' (saved Late flag), 'onTime', or null for manual entries
 */
function arrivalCategory(record, eventsById) {
  if (record.check_in_mode === 'ADMIN_MANUAL') return null;
  if (record.is_late) return 'late';
  const event = eventsById.get(record.event_id);
  if (event && record.check_in_time) {
    const [h, m] = String(event.start_time || '0:0').split(':').map(Number);
    if (minutesInZone(record.check_in_time, event.timezone || 'Asia/Kolkata') < h * 60 + m) return 'early';
  }
  return 'onTime';
}

/**
 * Filters attendance records by selected event
 */
function filterAttendanceForAnalytics(records, eventId) {
  if (!eventId || eventId === 'All') return records || [];
  return (records || []).filter((r) => r.event_id === eventId);
}

/**
 * Render Top Metric Cards for Analytics Tab
 */
function renderAnalyticsKpis(records, scopedEvents, members, eventId) {
  const totalChecked = records.length;
  const turnoutEl = document.getElementById('analyticsKpiTurnout');
  const turnoutSubEl = document.getElementById('analyticsKpiTurnoutSub');
  const velocityEl = document.getElementById('analyticsKpiVelocity');
  const distanceEl = document.getElementById('analyticsKpiDistance');
  const punctualityEl = document.getElementById('analyticsKpiPunctuality');

  // Turnout: check-ins against the members each event was open to (its permitted roles)
  const eligible = scopedEvents.reduce((sum, event) => sum + countEligibleMembers(event, members), 0);
  if (turnoutEl) {
    const rate = eligible > 0 ? Math.min(100, Math.round((totalChecked / eligible) * 100)) : 0;
    turnoutEl.textContent = `${totalChecked} (${rate}%)`;
  }
  if (turnoutSubEl) {
    turnoutSubEl.textContent = eventId === 'All'
      ? `Of ${eligible} possible check-ins across ${scopedEvents.length} event${scopedEvents.length === 1 ? '' : 's'}`
      : `Out of ${eligible} eligible members`;
  }

  // Peak Velocity
  if (velocityEl) {
    if (totalChecked === 0) {
      velocityEl.textContent = '0 / hr';
    } else {
      const buckets = computeVelocityBuckets(records);
      const maxCount = Math.max(...Object.values(buckets.counts), 0);
      velocityEl.textContent = `${maxCount} check-ins/window`;
    }
  }

  // Average Distance
  if (distanceEl) {
    const validDistances = records
      .map((r) => r.distance_meters)
      .filter((d) => d !== null && d !== undefined && !isNaN(d));

    if (validDistances.length > 0) {
      const avg = validDistances.reduce((a, b) => a + b, 0) / validDistances.length;
      distanceEl.textContent = `${Math.round(avg * 10) / 10} m`;
    } else {
      distanceEl.textContent = 'N/A';
    }
  }

  // Punctuality: share of scanned check-ins not marked late (manual entries excluded)
  if (punctualityEl) {
    const scanned = records.filter((r) => r.check_in_mode !== 'ADMIN_MANUAL');
    if (scanned.length === 0) {
      punctualityEl.textContent = 'N/A';
    } else {
      const onTimeCount = scanned.filter((r) => !r.is_late).length;
      punctualityEl.textContent = `${Math.round((onTimeCount / scanned.length) * 100)}% On-Time`;
    }
  }
}

/**
 * 1. ARRIVAL VELOCITY TIMELINE (Area / Line Chart)
 */
function renderVelocityChart(records) {
  const canvas = document.getElementById('chartVelocity');
  if (!canvas) return;

  const { labels, data } = computeVelocityBuckets(records);

  if (chartVelocity) {
    chartVelocity.data.labels = labels;
    chartVelocity.data.datasets[0].data = data;
    chartVelocity.update();
    return;
  }

  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, 'rgba(79, 70, 229, 0.4)');
  gradient.addColorStop(1, 'rgba(79, 70, 229, 0.0)');

  chartVelocity = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Verified Check-Ins',
          data,
          fill: true,
          backgroundColor: gradient,
          borderColor: COLORS.indigo,
          borderWidth: 3,
          pointBackgroundColor: COLORS.indigo,
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.38
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => ` ${item.parsed.y} check-in${item.parsed.y === 1 ? '' : 's'}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11, weight: '500' } }
        },
        y: {
          beginAtZero: true,
          suggestedMax: Math.max(...data, 4) + 1,
          grid: { color: COLORS.grid },
          ticks: {
            precision: 0,
            font: { size: 11 }
          }
        }
      }
    }
  });
}

function computeVelocityBuckets(records) {
  // 30-min intervals from 08:00 to 18:00
  const slots = [
    '08:00', '08:30', '09:00', '09:30',
    '10:00', '10:30', '11:00', '11:30',
    '12:00', '12:30', '13:00', '14:00',
    '15:00', '16:00', '17:00', '18:00'
  ];
  const counts = {};
  slots.forEach((s) => (counts[s] = 0));

  records.forEach((r) => {
    if (!r.check_in_time) return;
    const d = new Date(r.check_in_time);
    const hour = d.getHours();
    const min = d.getMinutes();

    let slotKey = '08:00';
    if (hour < 8) slotKey = '08:00';
    else if (hour === 8 && min < 30) slotKey = '08:00';
    else if (hour === 8) slotKey = '08:30';
    else if (hour === 9 && min < 30) slotKey = '09:00';
    else if (hour === 9) slotKey = '09:30';
    else if (hour === 10 && min < 30) slotKey = '10:00';
    else if (hour === 10) slotKey = '10:30';
    else if (hour === 11 && min < 30) slotKey = '11:00';
    else if (hour === 11) slotKey = '11:30';
    else if (hour === 12 && min < 30) slotKey = '12:00';
    else if (hour === 12) slotKey = '12:30';
    else if (hour === 13) slotKey = '13:00';
    else if (hour === 14) slotKey = '14:00';
    else if (hour === 15) slotKey = '15:00';
    else if (hour === 16) slotKey = '16:00';
    else if (hour === 17) slotKey = '17:00';
    else slotKey = '18:00';

    if (counts[slotKey] !== undefined) {
      counts[slotKey]++;
    }
  });

  return {
    labels: slots,
    data: slots.map((s) => counts[s]),
    counts
  };
}

/**
 * 2. ROLE DISTRIBUTION (Doughnut Chart)
 */
function renderRoleChart(records) {
  const canvas = document.getElementById('chartRole');
  if (!canvas) return;

  const staffCount = records.filter((r) => r.role === 'Staff').length;
  const agentCount = records.filter((r) => r.role === 'Agent').length;
  const total = staffCount + agentCount;

  const staffPct = total > 0 ? Math.round((staffCount / total) * 100) : 0;
  const agentPct = total > 0 ? Math.round((agentCount / total) * 100) : 0;

  const dataValues = total > 0 ? [staffCount, agentCount] : [1, 0];
  const dataColors = total > 0 ? [COLORS.indigo, COLORS.amber] : ['#e2e8f0', '#cbd5e1'];

  if (chartRole) {
    chartRole.data.datasets[0].data = dataValues;
    chartRole.data.datasets[0].backgroundColor = dataColors;
    chartRole.update();
    return;
  }

  chartRole = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Staff Employees', 'Field Agents'],
      datasets: [
        {
          data: dataValues,
          backgroundColor: dataColors,
          borderWidth: 2,
          borderColor: '#ffffff',
          hoverOffset: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 12,
            padding: 16,
            font: { weight: '600' }
          }
        },
        tooltip: {
          callbacks: {
            label: (item) => {
              const val = item.parsed;
              const pct = total > 0 ? Math.round((val / total) * 100) : 0;
              return ` ${item.label}: ${val} (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

/**
 * 3. TURNOUT BY DIVISION (Horizontal Bar Chart)
 */
function renderDivisionChart(records, divisions = []) {
  const canvas = document.getElementById('chartDivision');
  if (!canvas) return;

  const divMap = {};
  divisions.forEach((d) => {
    divMap[d.name] = 0;
  });

  records.forEach((r) => {
    const name = r.division_name || 'Corporate Division';
    divMap[name] = (divMap[name] || 0) + 1;
  });

  const labels = Object.keys(divMap);
  const data = labels.map((l) => divMap[l]);

  if (chartDivision) {
    chartDivision.data.labels = labels;
    chartDivision.data.datasets[0].data = data;
    chartDivision.update();
    return;
  }

  chartDivision = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Checked In',
          data,
          backgroundColor: [
            COLORS.cyan,
            COLORS.indigo,
            COLORS.emerald,
            COLORS.amber
          ],
          borderRadius: 8,
          borderSkipped: false,
          maxBarThickness: 28
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: COLORS.grid },
          ticks: { precision: 0 }
        },
        y: {
          grid: { display: false },
          ticks: {
            font: { weight: '600', size: 12 }
          }
        }
      }
    }
  });
}

/**
 * 4. GEOFENCE DISTANCE & ACCURACY DISTRIBUTION (Bar Chart)
 */
function renderGeofenceChart(records) {
  const canvas = document.getElementById('chartGeofence');
  if (!canvas) return;

  let under10 = 0;
  let between10and25 = 0;
  let between25and50 = 0;
  let over50 = 0;

  records.forEach((r) => {
    const dist = r.distance_meters;
    if (dist === null || dist === undefined) return;
    if (dist < 10) under10++;
    else if (dist <= 25) between10and25++;
    else if (dist <= 50) between25and50++;
    else over50++;
  });

  const labels = ['< 10m (Entrance)', '10 - 25m (Lobby)', '25 - 50m (Perimeter)', '> 50m (Borderline)'];
  const data = [under10, between10and25, between25and50, over50];

  if (chartGeofence) {
    chartGeofence.data.datasets[0].data = data;
    chartGeofence.update();
    return;
  }

  chartGeofence = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Attendees',
          data,
          backgroundColor: [
            COLORS.emerald,
            COLORS.cyan,
            COLORS.amber,
            COLORS.rose
          ],
          borderRadius: 6,
          maxBarThickness: 36
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => ` ${item.parsed.y} attendees`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11, weight: '500' } }
        },
        y: {
          beginAtZero: true,
          grid: { color: COLORS.grid },
          ticks: { precision: 0 }
        }
      }
    }
  });
}

/**
 * 5. PUNCTUALITY & ARRIVAL STATUS (Doughnut Chart)
 */
function renderPunctualityChart(records, events = []) {
  const canvas = document.getElementById('chartPunctuality');
  if (!canvas) return;

  // Uses each event's own start time and late threshold, not fixed clock times
  const eventsById = new Map(events.map((e) => [e.id, e]));
  let early = 0;
  let onTime = 0;
  let late = 0;

  records.forEach((r) => {
    const category = arrivalCategory(r, eventsById);
    if (category === 'early') early++;
    else if (category === 'onTime') onTime++;
    else if (category === 'late') late++;
  });

  const total = early + onTime + late;
  const data = total > 0 ? [early, onTime, late] : [1, 0, 0];
  const colors = total > 0 ? [COLORS.cyan, COLORS.emerald, COLORS.amber] : ['#e2e8f0', '#cbd5e1', '#94a3b8'];

  if (chartPunctuality) {
    chartPunctuality.data.datasets[0].data = data;
    chartPunctuality.data.datasets[0].backgroundColor = colors;
    chartPunctuality.update();
    return;
  }

  chartPunctuality = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Before Start', 'On Time', 'Late'],
      datasets: [
        {
          data,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: '#ffffff'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 12, padding: 12, font: { weight: '600' } }
        }
      }
    }
  });
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
