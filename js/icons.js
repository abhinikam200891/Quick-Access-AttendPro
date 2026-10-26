/**
 * Icon renderer (Lucide)
 * Markup uses <i data-lucide="name"></i> placeholders. They are swapped for inline SVG on
 * load, and a MutationObserver picks up placeholders added later by innerHTML templates.
 * Only the icons listed here are bundled.
 */

import {
  createElement,
  AlarmClock, ArrowLeft, ArrowRight, Ban, Bell, BellOff, Briefcase, Building2, Calendar,
  CalendarDays, Camera, ChartColumn, Check, ChevronDown, CircleCheck, CircleUser, CircleX,
  ClipboardList, Copy, Crosshair, Eye, EyeOff, FileDown, FileText, FileUp, Flashlight,
  FlaskConical, FolderOpen, Globe, Handshake, Hash, Hourglass, Info, KeyRound, Lightbulb,
  Lock, LockKeyhole, LockOpen, LogIn, LogOut, Mail, Map, MapPin, Monitor, Moon,
  MoveHorizontal, PartyPopper, Pause, Pencil, PenLine, Play, Plus, QrCode, RefreshCw,
  RotateCcw, Save, ScanLine, Search, SearchCheck, Send, Settings, Shield, Smartphone,
  Sparkles, Star, Timer, Trash2, TrendingUp, TriangleAlert, User, Users, X, Zap
} from 'lucide';

const ICONS = {
  'alarm-clock': AlarmClock, 'arrow-left': ArrowLeft, 'arrow-right': ArrowRight, ban: Ban,
  bell: Bell, 'bell-off': BellOff, briefcase: Briefcase, 'building-2': Building2,
  calendar: Calendar, 'calendar-days': CalendarDays, camera: Camera, 'chart-column': ChartColumn,
  check: Check, 'chevron-down': ChevronDown, 'circle-check': CircleCheck, 'circle-user': CircleUser,
  'circle-x': CircleX, 'clipboard-list': ClipboardList, copy: Copy, crosshair: Crosshair,
  eye: Eye, 'eye-off': EyeOff, 'file-down': FileDown, 'file-text': FileText, 'file-up': FileUp,
  flashlight: Flashlight, 'flask-conical': FlaskConical, 'folder-open': FolderOpen, globe: Globe,
  handshake: Handshake, hash: Hash, hourglass: Hourglass, info: Info, 'key-round': KeyRound,
  lightbulb: Lightbulb, lock: Lock, 'lock-keyhole': LockKeyhole, 'lock-open': LockOpen,
  'log-in': LogIn, 'log-out': LogOut, mail: Mail, map: Map, 'map-pin': MapPin, monitor: Monitor,
  moon: Moon, 'move-horizontal': MoveHorizontal, 'party-popper': PartyPopper, pause: Pause,
  pencil: Pencil, 'pen-line': PenLine, play: Play, plus: Plus, 'qr-code': QrCode,
  'refresh-cw': RefreshCw, 'rotate-ccw': RotateCcw, save: Save, 'scan-line': ScanLine,
  search: Search, 'search-check': SearchCheck, send: Send, settings: Settings, shield: Shield,
  smartphone: Smartphone, sparkles: Sparkles, star: Star, timer: Timer, 'trash-2': Trash2,
  'trending-up': TrendingUp, 'triangle-alert': TriangleAlert, user: User, users: Users, x: X, zap: Zap
};

function swap(placeholder) {
  const name = placeholder.getAttribute('data-lucide');
  const node = ICONS[name];
  if (!node) {
    console.warn(`Unknown icon "${name}"`);
    return;
  }
  const [tag, attrs, children] = node;
  const svg = createElement([tag, {
    ...attrs,
    width: '1em',
    height: '1em',
    'stroke-width': 2.25,
    'aria-hidden': 'true',
    focusable: 'false',
    class: ['icon', `icon-${name}`, placeholder.getAttribute('class')].filter(Boolean).join(' ')
  }, children]);
  placeholder.replaceWith(svg);
}

export function renderIcons(root = document) {
  root.querySelectorAll('i[data-lucide]').forEach(swap);
}

/**
 * Markup for an icon inside a template string
 */
export function icon(name, className = '') {
  return `<i data-lucide="${name}"${className ? ` class="${className}"` : ''}></i>`;
}

let observer = null;

export function startIcons() {
  renderIcons();
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const added of m.addedNodes) {
        if (added.nodeType !== 1) continue;
        if (added.matches('i[data-lucide]')) swap(added);
        else renderIcons(added);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startIcons, { once: true });
  } else {
    startIcons();
  }
}
