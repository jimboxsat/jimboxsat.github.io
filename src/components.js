import { imgSrc } from './image-utils.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const icons = {
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-9-9.2C1.8 7.4 3.8 4 7.2 4c2 0 3.5 1 4.8 2.8C13.3 5 14.800 4 16.800 4 20.200 4 22.200 7.400 21 10.800 19 15.600 12 20 12 20z"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.500l4.500 4.500L19 7.500"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.500"/><path d="M16 16l4.500 4.500"/></svg>',
  filter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.63 5.33 5.87.86-4.25 4.14 1 5.85L12 17l-5.25 2.63 1-5.85L3.5 9.78l5.87-.86z"/></svg>',
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.500-6.500 10-6.500S22 12 22 12s-3.500 6.500-10 6.500S2 12 2 12z"/><circle cx="12" cy="12" r="2.800"/></svg>',
  archive: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1.2"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12.5h4"/></svg>',
  palette: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0 0 18 2 2 0 0 0 2-2c0-.55-.22-1.05-.58-1.41a1.99 1.99 0 0 1 1.41-3.4H17a4 4 0 0 0 4-4c0-3.92-4.03-7.19-9-7.19z"/><circle cx="7.3" cy="11.2" r="1.05" fill="currentColor" stroke="none"/><circle cx="10" cy="7.3" r="1.05" fill="currentColor" stroke="none"/><circle cx="14.4" cy="7" r="1.05" fill="currentColor" stroke="none"/><circle cx="17.3" cy="10.4" r="1.05" fill="currentColor" stroke="none"/></svg>',
  shirt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3.5 6 5 3 7l2 4 2-1v9.5h10V10l2 1 2-4-3-2-3-1.5-2 2z"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7.5" r="3.8"/><path d="M4.5 20c.9-3.4 3.8-5 7.5-5s6.6 1.6 7.5 5"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2 5.5 5.5 2-5.5 2-2 5.5-2-5.5L4.5 10l5.5-2z"/></svg>',
  database: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5.5" rx="7" ry="2.8"/><path d="M5 5.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6"/><path d="M5 11.5v6c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8v-6"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 13.66-5.66L20 8"/><path d="M20 4v4h-4"/><path d="M20 12a8 8 0 0 1-13.66 5.66L4 16"/><path d="M4 20v-4h4"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 18.5A4.5 4.5 0 0 1 6 9.65a6 6 0 0 1 11.4-1.7A4.25 4.25 0 0 1 17.5 18.5z"/></svg>',
  question: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.9.4-1.4 1-1.4 1.9v.3"/><circle cx="11.9" cy="17" r="1" fill="currentColor" stroke="none"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.6" r="1" fill="currentColor" stroke="none"/></svg>'
};

export function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = 'toast ' + type; el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3200);
}

export function debounce(fn, ms = 180) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// Accessible modal dialog. Returns {el, close}
export function openModal({ title, body, className = '', onClose, closeOnBackdrop = true, beforeClose }) {
  const root = $('#modalRoot');
  const prev = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1">
    <header class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${icons.close}</button></header>
    <div class="modal-body"></div></div>`;
  const dlg = $('.modal', wrap);
  const bodyEl = $('.modal-body', wrap);
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
  root.append(wrap);
  document.body.classList.add('no-scroll');
  const api = { el: bodyEl, dialog: dlg };
  const close = async (force = false) => {
    if (!force && beforeClose && (await beforeClose()) === false) return;
    document.removeEventListener('keydown', onKey, true);
    wrap.remove();
    if (!$('.modal-backdrop')) document.body.classList.remove('no-scroll');
    prev && prev.focus && prev.focus();
    onClose && onClose();
  };
  const onKey = e => {
    const top = [...document.querySelectorAll('.modal-backdrop')].pop();
    if (top !== wrap) return;
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') {
      const f = $$('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])', dlg).filter(x => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  wrap.addEventListener('mousedown', e => { if (e.target === wrap && closeOnBackdrop) close(); });
  $('[data-close]', wrap).addEventListener('click', () => close());
  api.close = close;
  const coarse = matchMedia('(pointer: coarse)').matches;
  setTimeout(() => {
    if (coarse) { dlg.focus(); return; }   // avoid popping the on-screen keyboard over the modal
    (dlg.querySelector('[autofocus]') || dlg).focus();
  }, 30);
  return api;
}

export function confirmDialog({ title, message, confirmText = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    let done = false;
    const m = openModal({
      title, className: 'small',
      body: `<p class="muted">${esc(message)}</p><div class="form-actions"><button class="btn ghost" data-no>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes autofocus>${esc(confirmText)}</button></div>`,
      onClose: () => { if (!done) resolve(false); }
    });
    $('[data-no]', m.el).onclick = () => { done = true; m.close(true); resolve(false); };
    $('[data-yes]', m.el).onclick = () => { done = true; m.close(true); resolve(true); };
  });
}

export function itemCard(item, { selected = false, selectable = false, showFav = true, lazy = true, deletable = false } = {}) {
  const el = document.createElement('article');
  el.className = 'card' + (selected ? ' selected' : '') + (item.archived ? ' archived' : '');
  el.dataset.id = item.id;
  el.innerHTML = `
    <button class="card-hit" data-open aria-label="${selectable ? 'Toggle' : 'Open'} ${esc(item.name)}${selected ? ' (in outfit)' : ''}" ${selectable ? `aria-pressed="${selected}"` : ''}>
      <span class="card-img"><img src="${imgSrc(item)}" alt="" ${lazy ? 'loading="lazy"' : ''} decoding="async"></span>
      <span class="card-meta"><span class="card-name">${esc(item.name)}</span>
      <span class="card-sub">${esc(item.brand || item.subcategory || item.category)}</span></span>
    </button>
    ${deletable ? `<button class="card-del" data-del aria-label="Delete ${esc(item.name)}">${icons.trash}</button>` : ''}
    ${item.demo ? '<span class="badge demo">Sample</span>' : ''}
    ${item.archived ? '<span class="badge arch">Archived</span>' : ''}
    ${showFav ? `<button class="fav ${item.favorite ? 'on' : ''}" data-fav aria-label="${item.favorite ? 'Unfavorite' : 'Favorite'} ${esc(item.name)}" aria-pressed="${!!item.favorite}">${icons.star}</button>` : ''}
    ${selectable ? `<span class="sel-mark" aria-hidden="true">${icons.check}</span><button class="peek" data-peek aria-label="Preview ${esc(item.name)}">${icons.eye}</button>` : ''}`;
  const img = $('img', el);
  img.onerror = () => { img.onerror = null; img.src = ''; img.removeAttribute('src'); el.querySelector('.card-img').classList.add('noimg'); };
  return el;
}
