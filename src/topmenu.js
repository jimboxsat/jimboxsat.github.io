// Top-right navigation cluster: notifications, Google Drive sync and the account dropdown.
// Reuses the app's existing pieces — theme preference through settings.js, profile data through
// database.js, and the Drive integration in gdrive.js — instead of adding parallel systems.
import { $, $$, esc, icons, openModal, toast } from './components.js';
import * as db from './database.js';
import * as gdrive from './gdrive.js';
import * as notif from './notifications.js';
import { setTheme } from './settings.js';
import { t, tr, tf, lang, setLang, LANGS, LANG_LABEL } from './i18n.js';


// Notifications created before the phrase dictionary existed stored key names; map them to text.
const LEGACY = {
  'notif.welcomeTitle': 'Welcome to Atelier!',
  'notif.welcomeBody': "We're glad you're here. Explore the platform and keep an eye on your notifications for helpful updates and announcements.",
  'notif.syncTitle': 'Google Drive synced'
};
const THEME_LABEL = { light: 'Light theme', system: 'System theme', dark: 'Dark theme' };

function avatarHtml(profile) {
  const ch = (profile.nickname || '').trim().charAt(0).toUpperCase();
  return profile.photo ? `<img src="${esc(profile.photo)}" alt="">` : ch ? esc(ch) : icons.user;
}

function prepareProfilePhoto(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject(new Error('Please choose an image file.')); return; }
    const url = URL.createObjectURL(file), image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const size = Math.min(image.naturalWidth, image.naturalHeight);
        if (!size) throw new Error('Could not read that image.');
        const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2, size, size, 0, 0, 256, 256);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch (err) { reject(err); }
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    image.src = url;
  });
}

export function createTopMenu({ onSettings, onConnectDrive } = {}) {
  const root = $('#topNav');
  if (!root) return { close() { }, refresh() { } };

  const accountBtn = $('#accountBtn'), notifBtn = $('#notifBtn'), syncBtn = $('#syncBtn');
  const accountMenu = $('#accountMenu'), notifMenu = $('#notifMenu');
  const dot = $('#notifDot'), avatar = $('#accountAvatar'), chevron = $('#accountChevron');

  notifBtn.insertAdjacentHTML('afterbegin', icons.bell);
  syncBtn.insertAdjacentHTML('afterbegin', icons.sync);
  chevron.innerHTML = icons.chevron;

  let open = null;   // 'account' | 'notif' | null

  // ---------- avatars & labels ----------
  function renderAvatar() {
    const profile = db.getProfile();
    avatar.classList.toggle('empty', !profile.photo && !profile.nickname.trim());
    avatar.innerHTML = avatarHtml(profile);
  }

  function updateIndicators() {
    const n = notif.unreadCount();
    dot.hidden = n === 0;
    notifBtn.setAttribute('aria-label', n ? `${t('Notifications')} (${n})` : t('Notifications'));
    notifBtn.title = t('Notifications');
    syncBtn.setAttribute('aria-label', t('Sync with Google Drive'));
    syncBtn.title = t('Sync with Google Drive');
    accountBtn.setAttribute('aria-label', t('Account menu'));
  }

  function applyLang() {
    document.documentElement.lang = lang();
    $$('[data-i18n]').forEach(el => { const s = t(el.dataset.i18n); if (s) el.textContent = s; });
    if (open === 'account') renderAccount();
    if (open === 'notif') renderNotif();
    updateIndicators();
  }

  // ---------- open / close ----------
  function focusFirst(panel) {
    const first = panel.querySelector('button, select, [href], input');
    if (first) first.focus();
  }

  function setOpen(which) {
    open = which;
    accountMenu.hidden = which !== 'account';
    notifMenu.hidden = which !== 'notif';
    accountBtn.setAttribute('aria-expanded', String(which === 'account'));
    notifBtn.setAttribute('aria-expanded', String(which === 'notif'));
    root.classList.toggle('menu-open', !!which);
    if (which === 'account') { renderAccount(); focusFirst(accountMenu); }
    else if (which === 'notif') { renderNotif(); focusFirst(notifMenu); }
  }

  function close(refocus) {
    const was = open;
    open = null;
    accountMenu.hidden = true;
    notifMenu.hidden = true;
    accountBtn.setAttribute('aria-expanded', 'false');
    notifBtn.setAttribute('aria-expanded', 'false');
    root.classList.remove('menu-open');
    if (refocus && was) (was === 'account' ? accountBtn : notifBtn).focus();
  }

  // ---------- account dropdown ----------
  function renderAccount() {
    const theme = db.settings.get('theme', 'system');
    const profile = db.getProfile();
    const seg = [['light', 'sun'], ['system', 'monitor'], ['dark', 'moon']].map(([v, ico]) =>
      `<button type="button" data-theme-set="${v}" aria-pressed="${theme === v}" aria-label="${esc(t(THEME_LABEL[v]))}" title="${esc(t(THEME_LABEL[v]))}">${icons[ico]}</button>`).join('');
    accountMenu.innerHTML = `
      <button class="tm-row" data-act="profile">
        <span>${esc(t('View Profile'))}</span>
        <span class="tm-avatar-sm" aria-hidden="true">${avatarHtml(profile)}</span>
      </button>
      <button class="tm-row" data-act="settings">
        <span>${esc(t('Settings'))}</span>${icons.gear}
      </button>
      <div class="tm-sep" role="separator"></div>
      <div class="tm-row tm-static">
        <span>${esc(t('Theme'))}</span>
        <div class="tm-seg" role="group" aria-label="${esc(t('Theme'))}">${seg}</div>
      </div>
      <div class="tm-row tm-static">
        <span>${esc(t('Language'))}</span>
        <select class="tm-pill" id="tmLang" aria-label="${esc(t('Language'))}">
          ${LANGS.map(k => `<option value="${k}"${k === lang() ? ' selected' : ''}>${LANG_LABEL[k]}</option>`).join('')}
        </select>
      </div>`;
  }

  // ---------- notifications panel ----------
  function when(at) {
    const s = Math.round((Date.now() - at) / 1000);
    if (lang() !== 'en') {
      const relative = new Intl.RelativeTimeFormat(lang(), { numeric: 'auto' });
      if (s < 60) return relative.format(0, 'second');
      if (s < 3600) return relative.format(-Math.round(s / 60), 'minute');
      if (s < 86400) return relative.format(-Math.round(s / 3600), 'hour');
      if (s < 604800) return relative.format(-Math.round(s / 86400), 'day');
    }
    if (s < 60) return t('just now');
    const m = Math.round(s / 60); if (m < 60) return `${m} ${t('m ago')}`;
    const h = Math.round(m / 60); if (h < 24) return `${h} ${t('h ago')}`;
    const d = Math.round(h / 24); if (d < 7) return `${d} ${t('d ago')}`;
    return new Date(at).toLocaleDateString(lang());
  }

  function renderNotif() {
    const items = notif.list();
    const rows = items.map(n => {
      const title = esc(t(LEGACY[n.titleKey] || n.title || ''));
      const source = LEGACY[n.bodyKey] || n.body || '';
      // Also localize sync entries already saved in English before language support.
      const sync = n.kind === 'sync' && /^(\d+) items? · (\d+) outfits?( · merged with Drive)?$/.exec(source);
      const body = esc(sync
        ? tf('{items} items · {outfits} outfits', { items: sync[1], outfits: sync[2] }) + (sync[3] ? ' · ' + t('merged with Drive') : '')
        : t(source));
      return `<li class="notif-item${n.read ? '' : ' unread'}">
        <strong>${title}</strong>
        ${body ? `<p>${body}</p>` : ''}
        <time datetime="${new Date(n.at).toISOString()}">${esc(when(n.at))}</time>
      </li>`;
    }).join('');
    notifMenu.innerHTML = `
      <div class="notif-head">
        <h2>${esc(t('Notifications'))}</h2>
        ${items.some(n => !n.read) ? `<button class="tm-link" data-act="readAll">${esc(t('Mark all read'))}</button>` : ''}
      </div>
      ${items.length ? `<ul class="notif-list">${rows}</ul>` : `<p class="notif-empty">${esc(t('No notifications yet.'))}</p>`}`;
  }

  // ---------- profile dialog (the app has no separate profile page) ----------
  async function openProfile() {
    const profile = db.getProfile(), name = profile.nickname.trim();
    let photo = profile.photo, photoRequest = 0, processing = false;
    let items = [], outfits = [];
    try { [items, outfits] = await Promise.all([db.getItems(), db.getOutfits()]); } catch (e) { console.error(e); }
    const m = openModal({
      title: t('Profile'), className: 'small',
      body: tr`<div class="pf-head">
          <button type="button" class="pf-avatar pf-avatar-upload" data-upload-photo aria-label="${esc(t('Upload profile picture'))}" title="${esc(t('Upload profile picture'))}"><span class="pf-avatar-image" aria-hidden="true">${avatarHtml(profile)}</span><span class="pf-avatar-overlay" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7h3l2-2h6l2 2h3v12H4z"/><circle cx="12" cy="13" r="3.5"/></svg></span></button>
          <div><p class="pf-name">${esc(name || t('No name yet'))}</p>
          <p class="muted small">${esc(tf('{items} items · {outfits} outfits', { items: items.length, outfits: outfits.length }))}</p></div>
        </div>
        <div class="pf-photo-actions"><input id="pfPhoto" type="file" accept="image/*" hidden><button type="button" class="btn ghost" data-remove-photo ${photo ? '' : 'hidden'}>${esc(t('Remove picture'))}</button></div>
        <label class="field"><span>${esc(t('Your name'))}</span><input id="pfName" maxlength="30" value="${esc(name)}" placeholder="e.g. Alex" autocomplete="nickname"></label>
        <p class="muted small">${esc(t('Used for the greeting on your home page. Everything stays on this device.'))}</p>
        <div class="form-actions"><button class="btn primary" data-save autofocus>${esc(t('Save'))}</button></div>`
    });
    const save = $('[data-save]', m.el), remove = $('[data-remove-photo]', m.el), input = $('#pfPhoto', m.el);
    $('[data-upload-photo]', m.el).onclick = () => input.click();
    const preview = () => { $('.pf-avatar-image', m.el).innerHTML = avatarHtml({ nickname: $('#pfName', m.el).value, photo }); remove.hidden = !photo; };
    $('#pfName', m.el).addEventListener('input', preview);
    input.addEventListener('change', async () => {
      const file = input.files[0]; if (!file) return;
      const request = ++photoRequest; processing = true; save.disabled = true;
      try { const result = await prepareProfilePhoto(file); if (request === photoRequest) { photo = result; preview(); } }
      catch (err) { if (request === photoRequest) toast(t(err.message || 'Could not read that image.'), 'error'); }
      finally { if (request === photoRequest) { processing = false; save.disabled = false; input.value = ''; } }
    });
    remove.onclick = () => { photoRequest++; processing = false; save.disabled = false; input.value = ''; photo = ''; preview(); };
    save.onclick = () => {
      if (processing) return;
      try {
        db.setProfile({ nickname: $('#pfName', m.el).value.trim(), photo });
        toast(t('Profile saved.'), 'success');
        m.close(true);
      } catch { toast(t('Could not save profile. Check your device storage.'), 'error'); }
    };
  }

  // ---------- Google Drive sync (the real integration, not a decorative save) ----------
  async function doSync() {
    if (syncBtn.getAttribute('aria-busy') === 'true') return;
    if (!gdrive.configured()) {
      toast(t('Google Drive not connected.'), 'error');
      close();
      if (onConnectDrive) onConnectDrive();
      return;
    }
    syncBtn.setAttribute('aria-busy', 'true');
    syncBtn.classList.add('busy');
    toast(t('Synchronizing…'));
    try {
      const r = await gdrive.sync();          // resolves only after the Drive upload and local merge
      const detail = `${r.items} item${r.items === 1 ? '' : 's'} · ${r.outfits} outfit${r.outfits === 1 ? '' : 's'}`;
      toast(`${t('Sync completed successfully.')} ${tf('{items} items · {outfits} outfits', { items: r.items, outfits: r.outfits })}.`, 'success');
      notif.add({ kind: 'sync', title: 'Google Drive synced', body: detail + (r.fromDrive ? ' · merged with Drive' : '') });
      updateIndicators();
    } catch (err) {
      console.error(err);
      toast(t(err && err.message) || t('Synchronization failed.'), 'error');
    } finally {
      syncBtn.removeAttribute('aria-busy');
      syncBtn.classList.remove('busy');
    }
  }

  // ---------- events ----------
  accountBtn.onclick = () => (open === 'account' ? close(true) : setOpen('account'));
  notifBtn.onclick = () => (open === 'notif' ? close(true) : setOpen('notif'));
  syncBtn.onclick = doSync;

  accountMenu.addEventListener('click', e => {
    const seg = e.target.closest('[data-theme-set]');
    if (seg) {
      const v = seg.dataset.themeSet;
      setTheme(v);   // existing preference + applyTheme()
      $$('[data-theme-set]', accountMenu).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeSet === v)));
      return;
    }
    const row = e.target.closest('[data-act]');
    if (!row) return;
    if (row.dataset.act === 'profile') { close(); openProfile(); }
    else if (row.dataset.act === 'settings') { close(); if (onSettings) onSettings(); }
  });

  accountMenu.addEventListener('change', e => {
    if (e.target.id !== 'tmLang') return;
    setLang(e.target.value);   // stores the language and reloads in it
  });

  notifMenu.addEventListener('click', e => {
    if (!e.target.closest('[data-act="readAll"]')) return;
    notif.markAllRead();
    renderNotif();
    updateIndicators();
  });

  document.addEventListener('pointerdown', e => {
    if (!open || e.target.closest('#topNav')) return;
    close();
  });

  document.addEventListener('keydown', e => {
    if (!open) return;
    if (e.key === 'Escape') { e.stopPropagation(); close(true); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const panel = open === 'account' ? accountMenu : notifMenu;
    const f = $$('button, select, [href], input', panel).filter(el => el.offsetParent !== null);
    if (!f.length) return;
    e.preventDefault();
    const i = f.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? f.length - 1
        : e.key === 'ArrowDown' ? (i < 0 ? 0 : (i + 1) % f.length)
          : (i <= 0 ? f.length - 1 : i - 1);
    f[next].focus();
  });

  // ---------- wiring into existing state ----------
  notif.onChange(updateIndicators);
  db.onChange(kind => {
    if (kind !== 'profile') return;
    renderAvatar();
    if (open === 'account') renderAccount();
  });

  renderAvatar();
  applyLang();
  notif.ensureWelcome();
  updateIndicators();
  gdrive.preload();

  return {
    close: () => close(),
    refresh: () => { renderAvatar(); applyLang(); }
  };
}
