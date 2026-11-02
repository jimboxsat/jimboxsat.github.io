// Notifications: one small list kept in the app's existing settings store, so any module can push
// a message and the bell in the top bar shows whatever is here. The welcome entry is created once;
// later announcements go through the same add() call.
import { settings, uid } from './database.js';

const KEY = 'notifications';
const MAX = 30;
const listeners = new Set();

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }

export function list() {
  const a = settings.get(KEY, []);
  return Array.isArray(a) ? a.filter(n => n && typeof n === 'object') : [];
}
function save(items) { settings.set(KEY, items.slice(0, MAX)); emit(); }

export const unreadCount = () => list().filter(n => !n.read).length;

// Entries store plain English text; the panel translates it when it renders (i18n.js).
export function add({ title, body, titleKey, bodyKey, kind = 'info' } = {}) {
  const items = list();
  const last = items[0];
  const same = last && last.kind === kind
    && (titleKey || title || '') === (last.titleKey || last.title || '')
    && (bodyKey || body || '') === (last.bodyKey || last.body || '');
  if (same) return null;   // never stack the same message twice in a row
  const n = {
    id: uid(), kind, at: Date.now(), read: false,
    titleKey: titleKey || null, bodyKey: bodyKey || null, title: title || '', body: body || ''
  };
  save([n, ...items]);
  return n;
}

export function markAllRead() {
  const items = list();
  if (!items.some(n => !n.read)) return;
  save(items.map(n => (n.read ? n : { ...n, read: true })));
}

// Shown to new users only: guarded by its own flag, so opening the bell again never re-adds it.
export function ensureWelcome() {
  if (settings.get('notifWelcomed', false)) return;
  settings.set('notifWelcomed', true);
  add({
    kind: 'welcome',
    title: 'Welcome to Atelier!',
    body: "We're glad you're here. Explore the platform and keep an eye on your notifications for helpful updates and announcements."
  });
}
