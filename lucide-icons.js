/**
 * Focused Lucide icon subset for Arcadia.
 * Icon paths are from Lucide 1.34.0 (ISC license).
 */

(() => {

const ArrowUp = [['path', { d: 'm5 12 7-7 7 7' }], ['path', { d: 'M12 19V5' }]];
const CalendarDays = [
  ['path', { d: 'M8 2v3' }], ['path', { d: 'M16 2v3' }],
  ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }],
  ['path', { d: 'M3 9h18' }], ['path', { d: 'M8 13h.01' }],
  ['path', { d: 'M12 13h.01' }], ['path', { d: 'M16 13h.01' }],
  ['path', { d: 'M8 17h.01' }], ['path', { d: 'M12 17h.01' }],
  ['path', { d: 'M16 17h.01' }]
];
const ChartNoAxesColumnIncreasing = [
  ['path', { d: 'M5 21v-6' }], ['path', { d: 'M12 21V9' }], ['path', { d: 'M19 21V3' }]
];
const Check = [['path', { d: 'M20 6 9 17l-5-5' }]];
const ChevronLeft = [['path', { d: 'm15 18-6-6 6-6' }]];
const ChevronRight = [['path', { d: 'm9 18 6-6-6-6' }]];
const House = [
  ['path', { d: 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8' }],
  ['path', { d: 'M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }]
];
const Moon = [['path', { d: 'M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401' }]];
const PanelLeftClose = [
  ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
  ['path', { d: 'M9 3v18' }], ['path', { d: 'm16 15-3-3 3-3' }]
];
const PanelLeftOpen = [
  ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
  ['path', { d: 'M9 3v18' }], ['path', { d: 'm14 9 3 3-3 3' }]
];
const Sparkles = [
  ['path', { d: 'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z' }],
  ['path', { d: 'M20 2v4' }], ['path', { d: 'M22 4h-4' }],
  ['circle', { cx: '4', cy: '20', r: '2' }]
];
const Sun = [
  ['circle', { cx: '12', cy: '12', r: '4' }], ['path', { d: 'M12 2v2' }],
  ['path', { d: 'M12 20v2' }], ['path', { d: 'm4.93 4.93 1.41 1.41' }],
  ['path', { d: 'm17.66 17.66 1.41 1.41' }], ['path', { d: 'M2 12h2' }],
  ['path', { d: 'M20 12h2' }], ['path', { d: 'm6.34 17.66-1.41 1.41' }],
  ['path', { d: 'm19.07 4.93-1.41 1.41' }]
];
const Timer = [
  ['line', { x1: '10', x2: '14', y1: '2', y2: '2' }],
  ['line', { x1: '12', x2: '15', y1: '14', y2: '11' }],
  ['circle', { cx: '12', cy: '14', r: '8' }]
];
const Users = [
  ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
  ['circle', { cx: '9', cy: '7', r: '4' }],
  ['path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }],
  ['path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }]
];
const X = [['path', { d: 'M18 6 6 18' }], ['path', { d: 'm6 6 12 12' }]];

const svgNamespace = 'http://www.w3.org/2000/svg';

function createIcons({ icons, root = document, attrs = {} }) {
  root.querySelectorAll('[data-lucide]').forEach((placeholder) => {
    const name = placeholder.getAttribute('data-lucide');
    const exportName = name.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('');
    const icon = icons[exportName];
    if (!icon) return;
    const svg = document.createElementNS(svgNamespace, 'svg');
    const svgAttrs = {
      xmlns: svgNamespace, width: '24', height: '24', viewBox: '0 0 24 24',
      fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      class: `lucide lucide-${name}`, 'data-lucide': name, ...attrs
    };
    Object.entries(svgAttrs).forEach(([key, value]) => svg.setAttribute(key, value));
    icon.forEach(([tag, iconAttrs]) => {
      const child = document.createElementNS(svgNamespace, tag);
      Object.entries(iconAttrs).forEach(([key, value]) => child.setAttribute(key, value));
      svg.append(child);
    });
    placeholder.replaceWith(svg);
  });
}

window.ArcadiaLucide = {
  createIcons,
  icons: {
    ArrowUp, CalendarDays, ChartNoAxesColumnIncreasing, Check, ChevronLeft, ChevronRight, House, Moon,
    PanelLeftClose, PanelLeftOpen, Sparkles, Sun, Timer, Users, X
  }
};
})();
