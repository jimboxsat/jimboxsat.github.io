// "Dress me": swipe through tops, bottoms and shoes, pin a row to keep it, roll the dice.
import * as db from './database.js';
import { layoutRole, COLOR_NAMES } from './categories.js';
import { esc, $, $$, icons, toast, openModal, debounce } from './components.js';
import { newFilters, activeCount, applyFilters, openFilterPanel } from './filters.js';
import { imgSrc, blobToImage, loadImage } from './image-utils.js';
import { defaultBox, ROLE_LAYER } from './outfit-builder.js';
import * as weather from './weather.js';

const ROWS = [
  { role: 'top', label: 'Tops', one: 'tops' },
  { role: 'bottom', label: 'Bottoms', one: 'bottoms' },
  { role: 'shoes', label: 'Shoes', one: 'shoes' }
];
const ICON = {
  dice: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3v1.5H7V13l3-3z"/><path d="M12 14.5V20"/></svg>'
};
// How many times each item's run is repeated in a strip. Enough copies (plus kutch(), below)
// guarantee a swipe or an arrow walk can never hit a dead end, so the strip reads as endless.
const COPIES = 7;

// ---- Colour matching: local rules, nothing hidden ----
const NEUTRAL = new Set(['Black', 'White', 'Grey', 'Beige', 'Cream', 'Navy', 'Brown']);
const ANALOGOUS = [['Red', 'Pink'], ['Red', 'Orange'], ['Orange', 'Yellow'], ['Blue', 'Purple'], ['Green', 'Olive'], ['Olive', 'Yellow'], ['Pink', 'Purple'], ['Blue', 'Green']];
const primary = it => (it && it.colors && it.colors[0]) || null;

export function pairScore(a, b) {
  if (!a || !b) return .8;                        // unknown colour: don't punish
  if (NEUTRAL.has(a) || NEUTRAL.has(b)) return 1; // neutrals go with everything
  if (a === b) return 1;
  if (ANALOGOUS.some(p => p.includes(a) && p.includes(b))) return .6;
  return 0;                                        // two different bold colours clash
}
export function comboScore(items) {
  const cols = items.map(primary);
  let s = 0, n = 0;
  for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) { s += pairScore(cols[i], cols[j]); n++; }
  const accents = cols.filter(c => c && !NEUTRAL.has(c)).length;
  return (n ? s / n : 1) + (accents <= 1 ? .2 : 0);
}
const rand = n => Math.floor(Math.random() * n);

export function createDressMe(root, { onOpenInCanvas }) {
  const filters = newFilters();
  let items = [];
  const pool = { top: [], bottom: [], shoes: [] };
  const sel = { top: undefined, bottom: undefined, shoes: undefined };   // undefined = not chosen yet
  const pinned = { top: false, bottom: false, shoes: false };
  const active = { top: 1, bottom: 1, shoes: 1 };                        // which strip copy holds the highlight and the centered view
  const mode = () => (db.settings.get('dressMode', 'random') === 'color' ? 'color' : 'random');
  const byId = id => items.find(i => i.id === id) || null;
  const selected = () => ROWS.map(r => byId(sel[r.role])).filter(Boolean);
  const sortMode = () => { const v = db.settings.get('dressSort', 'none'); return v === 'brand' || v === 'color' ? v : 'none'; };
  // Re-orders a row's pieces. Colour sorting groups by each item's MAIN colour only
  // (colors[0]); pieces with no main colour, or no brand, fall to the end.
  function sortPool(list) {
    const s = sortMode();
    if (s === 'none' || list.length < 2) return list;
    const arr = list.slice();
    if (s === 'brand') arr.sort((a, b) => {
      const ab = (a.brand || '').trim().toLowerCase(), bb = (b.brand || '').trim().toLowerCase();
      if (!ab !== !bb) return ab ? -1 : 1;
      return ab.localeCompare(bb) || a.name.localeCompare(b.name);
    });
    else arr.sort((a, b) => {
      const ai = COLOR_NAMES.indexOf(primary(a)), bi = COLOR_NAMES.indexOf(primary(b));
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || a.name.localeCompare(b.name);
    });
    return arr;
  }

  // ---- Weather pill (kept across rebuilds so its listeners bind only once) ----
  const wxChip = document.createElement('button');
  wxChip.type = 'button'; wxChip.className = 'home-weather-chip'; wxChip.hidden = true;
  const wxHost = document.createElement('div');
  wxHost.className = 'home-dropdown dm-wx-drop'; wxHost.hidden = true;
  const wxWrap = document.createElement('div');
  wxWrap.className = 'dm-wx-mini';
  wxWrap.append(wxChip, wxHost);
  const weatherWidget = weather.mountWeather({ host: wxHost, chip: wxChip });
  function renderWxChip() {
    const on = weather.enabled();
    wxChip.hidden = !on;
    if (!on) { wxChip.innerHTML = ''; return; }
    const c = weather.city(), s = weather.summary();
    if (!c) { wxChip.innerHTML = '<span class="wc-ico">📍</span><span>Set city</span>'; wxChip.title = 'Pick a city for the forecast.'; return; }
    const place = c.label.split(',')[0].trim();
    wxChip.innerHTML = s
      ? `<span class="wc-ico">${s.ico}</span><span class="wc-temp">${s.temp}°</span><span class="wc-city">${esc(place)}</span>`
      : '<span class="wc-ico">⛅</span><span>Weather…</span>';
    wxChip.title = `Weather in ${c.label}. Tap for the forecast.`;
  }
  renderWxChip();

  async function load() {
    try { items = await db.getItems(); } catch (e) { console.error(e); items = []; }
    const live = applyFilters(items, { ...filters, category: 'All', subcategory: '', q: '', archived: false });
    for (const r of ROWS) pool[r.role] = sortPool(live.filter(i => layoutRole(i) === r.role));
    for (const r of ROWS) {
      const list = pool[r.role], cur = sel[r.role];
      const valid = cur !== undefined && list.some(i => i.id === cur);
      // a missing or stale pick falls back to a random piece; an empty pool stays undefined
      // so a later load picks one instead of showing a gap
      if (!valid) sel[r.role] = list.length ? list[rand(list.length)].id : undefined;
    }
    build();
    requestAnimationFrame(() => { sizeRowImages(); paint({ scroll: true, instant: true }); });
  }

  function rowHtml(r) {
    const list = pool[r.role];
    const itemCells = c => list.map(i => `<button class="dm-cell" data-copy="${c}" role="option" data-id="${i.id}" aria-selected="false" aria-label="${esc(i.name)}"><img src="${imgSrc(i)}" alt="" draggable="false"></button>`).join('');
    // The items repeat across several copies so both ends always have runway; kutch()
    // shifts the run invisibly as the view scrolls, making the strip feel endless.
    const cells = Array.from({ length: COPIES }, (_, c) => itemCells(c)).join('');
    return `<section class="dm-row" data-role="${r.role}">
      <div class="dm-row-head"><button class="dm-pin" data-pin="${r.role}" aria-pressed="false" aria-label="Pin ${r.one} (the dice skips pinned rows)" title="Pin: the dice skips this row">${ICON.pin}</button></div>
      ${list.length ? `<div class="dm-strip" role="listbox" aria-label="${r.label}" tabindex="0">${cells}</div>`
        : `<p class="dm-empty muted">No ${r.one} ${activeCount(filters) ? 'match your filters' : 'in your closet yet'}.</p>`}
    </section>`;
  }

  // Scale every photo by its own pixels so they all look the same size: the longest side
  // of each image is mapped onto the same tile dimension, and it never overflows the tile.
  // Runs again on every resize so tiles re-fill their (possibly changed) dimensions.
  function sizeRowImages() {
    for (const img of $$('.dm-cell img', root)) {
      const set = () => {
        try {
          const nw = img.naturalWidth, nh = img.naturalHeight;
          if (!nw || !nh) return;
          const cell = img.closest('.dm-cell'); if (!cell) return;
          const inner = Math.max(1, Math.min(cell.clientWidth, cell.clientHeight) - 14);
          const s = inner / Math.max(nw, nh);
          img.style.width = Math.round(nw * s) + 'px';
          img.style.height = Math.round(nh * s) + 'px';
        } catch { /* keep the default layout */ }
      };
      if (img.complete && img.naturalWidth) set(); else img.addEventListener('load', set, { once: true });
    }
  }

  function build() {
    const have = items.some(i => !i.archived && ROWS.some(r => layoutRole(i) === r.role));
    for (const r of ROWS) active[r.role] = 1;
    if (!have) {
      root.innerHTML = `<div class="empty"><h2>Nothing to dress yet</h2><p class="muted">Add tops, bottoms and shoes to your closet to start rolling outfits.</p>
        <div class="empty-actions"><button class="btn primary" data-go-closet>Go to closet</button></div></div>`;
      return;
    }
    const n = activeCount(filters);
    root.innerHTML = `<div class="dm">
      <div class="dm-head">
        <button class="dm-round" data-filter aria-label="Filters">${icons.filter}<span class="badge-count" ${n ? '' : 'hidden'}>${n}</span></button>
        <h2>Dress me</h2>
        <div class="dm-head-right"><button class="dm-save" data-save>Save</button></div>
      </div>
      ${ROWS.map(rowHtml).join('')}
      <div class="dm-dock">
        <select class="dm-sort" data-sort aria-label="Sort each row by">
          <option value="none"${sortMode() === 'none' ? ' selected' : ''}>Sort: default</option>
          <option value="brand"${sortMode() === 'brand' ? ' selected' : ''}>Sort: brand</option>
          <option value="color"${sortMode() === 'color' ? ' selected' : ''}>Sort: main color</option>
        </select>
        <div class="seg two" role="group" aria-label="Dice mode"><button class="seg-btn" data-dm="random">Random</button><button class="seg-btn" data-dm="color">Color match</button></div>
        <button class="dm-dice" data-dice aria-label="Roll the dice">${ICON.dice}</button>
        <button class="btn" data-canvas>Open in canvas</button>
      </div>
      <p class="dm-note muted small" aria-live="polite"></p></div>`;
    const right = $('.dm-head-right', root);
    if (right) right.insertBefore(wxWrap, right.firstElementChild);
  }

  // suppressSettle stops settle() from interfering while we scroll programmatically,
  // so an animation can never be teleported to another copy halfway through.
  let suppressSettle = 0;
  function centerOn(strip, el, instant) {
    suppressSettle++;
    strip.scrollTo({ left: el.offsetLeft + el.offsetWidth / 2 - strip.clientWidth / 2, behavior: instant ? 'auto' : 'smooth' });
    const clear = () => { suppressSettle = Math.max(0, suppressSettle - 1); kutch(strip); };
    if ('onscrollend' in strip) strip.addEventListener('scrollend', clear, { once: true });
    setTimeout(clear, instant ? 40 : 650);
  }
  // Invisible re-anchor at either end of the strip: the copies are identical, so nudging
  // scrollLeft by exactly one run looks like nothing happened while the run underneath
  // keeps looping. Only ever runs when nothing is being scrolled programmatically.
  function kutch(strip) {
    const cw = strip.scrollWidth / COPIES;
    if (!cw || strip.clientWidth > cw) return;
    const role = strip.closest('.dm-row').dataset.role;
    if (strip.scrollLeft < cw) strip.scrollLeft += cw;
    else if (strip.scrollLeft + strip.clientWidth > cw * (COPIES - 1)) strip.scrollLeft -= cw;
    // Keep the highlight on whichever copy the viewport now sits in (clamped to the run).
    active[role] = Math.min(COPIES - 1, Math.max(0, Math.round((strip.scrollLeft + strip.clientWidth / 2) / cw)));
  }
  function paint(opts = {}) {
    const m = mode();
    $$('[data-dm]', root).forEach(b => { const on = b.dataset.dm === m; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
    for (const r of ROWS) {
      const row = $(`.dm-row[data-role="${r.role}"]`, root); if (!row) continue;
      const pin = $('[data-pin]', row); pin.classList.toggle('on', !!pinned[r.role]); pin.setAttribute('aria-pressed', !!pinned[r.role]);
      const cur = sel[r.role] || '';
      const strip = $('.dm-strip', row);
      // A programmatic scroll (dice, resize) always home in on the canonical copy.
      if (opts.scroll) active[r.role] = 1;
      let target = null;
      // Only the active copy is highlighted, so a small item set never shows
      // duplicate outlines across its repeated copies.
      if (strip) $$('.dm-cell', strip).forEach(b => {
        const on = b.dataset.id === cur && b.dataset.copy === String(active[r.role]);
        b.classList.toggle('sel', on);
        b.setAttribute('aria-selected', on);
        if (b.dataset.id === cur && b.dataset.copy === '1') target = b;
      });
      if (opts.scroll && strip && target) centerOn(strip, target, opts.instant);
    }
  }

  // Choosing by swiping: whichever cell rests nearest the middle is the pick
  const timers = new WeakMap();
  root.addEventListener('scroll', e => {
    const strip = e.target; if (!strip.classList || !strip.classList.contains('dm-strip')) return;
    if (suppressSettle) return;
    kutch(strip);
    clearTimeout(timers.get(strip)); timers.set(strip, setTimeout(() => settle(strip), 120));
  }, true);
  function settle(strip) {
    if (suppressSettle) return;
    const role = strip.closest('.dm-row').dataset.role;
    const cells = $$('.dm-cell', strip); if (!cells.length) return;
    const c = strip.scrollLeft + strip.clientWidth / 2; let best = null, d = Infinity;
    cells.forEach(b => { const x = Math.abs(b.offsetLeft + b.offsetWidth / 2 - c); if (x < d) { d = x; best = b; } });
    if (!best) return;
    // Wherever the swipe stopped is the pick; the closest copy of that item is highlighted.
    active[role] = Number(best.dataset.copy);
    const id = best.dataset.id || null;
    if (id !== sel[role]) { sel[role] = id; }
    paint();
  }

  function roll() {
    const free = ROWS.map(r => r.role).filter(r => !pinned[r] && pool[r].length);
    if (!free.length) return toast(ROWS.every(r => !pool[r.role].length) ? 'Nothing to roll yet.' : 'Everything is pinned. Unpin a row to roll it.');
    const dice = $('[data-dice]', root); dice.classList.remove('rolling'); void dice.offsetWidth; dice.classList.add('rolling');
    const current = ROWS.map(r => sel[r.role]).join('|');
    let msg = 'Random pick.';
    if (mode() === 'random') {
      for (const role of free) {
        const others = pool[role].filter(i => i.id !== sel[role]);
        const list = others.length ? others : pool[role];
        sel[role] = list[rand(list.length)].id;
      }
    } else {
      const fixed = ROWS.map(r => r.role).filter(r => !free.includes(r)).map(r => byId(sel[r])).filter(Boolean);
      const tries = [];
      for (let t = 0; t < 80; t++) {
        const combo = {}; free.forEach(role => { combo[role] = pool[role][rand(pool[role].length)]; });
        tries.push({ combo, score: comboScore([...fixed, ...Object.values(combo)]) + Math.random() * .08 });
      }
      tries.sort((a, b) => b.score - a.score);
      const key = c => ROWS.map(r => (c[r.role] ? c[r.role].id : sel[r.role])).join('|');
      const fresh = tries.slice(0, 8).filter(t => key(t.combo) !== current);
      const list = fresh.length ? fresh : tries;
      const choice = list[rand(Math.min(3, list.length))];
      free.forEach(role => { sel[role] = choice.combo[role].id; });
      const cols = selected().map(primary).filter(Boolean);
      msg = cols.length ? `Color match: ${cols.join(' + ')}.` : 'Add colors to your items for smarter matches.';
    }
    paint({ scroll: true });
    $('.dm-note', root).textContent = msg;
  }

  // ---- Save ----
  async function aspectOf(item) {
    try {
      const img = item.imageBlob ? await blobToImage(item.imageBlob) : item.imageUrl ? await loadImage(item.imageUrl) : null;
      return img ? Math.min(4, Math.max(.25, img.naturalWidth / img.naturalHeight)) : 1;
    } catch { return 1; }
  }
  async function saveLook(name) {
    const placements = [];
    for (const it of selected()) {
      const role = layoutRole(it); const b = defaultBox(role, 0, await aspectOf(it));
      placements.push({ itemId: it.id, x: b.x, y: b.y, width: b.w, height: b.h, rotation: 0, layerOrder: ROLE_LAYER[role] });
    }
    placements.sort((a, b) => a.layerOrder - b.layerOrder).forEach((p, i) => { p.layerOrder = i; });
    return db.addOutfit({ name, items: placements });
  }
  function saveDialog() {
    if (!selected().length) return toast('Pick at least one piece first.', 'error');
    const def = 'Look ' + new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const m = openModal({
      title: 'Save this look', className: 'small',
      body: `<form id="dm-form"><label class="field"><span>Name</span><input id="dm-name" maxlength="60" value="${esc(def)}" autofocus></label>
        <div class="form-actions"><button type="button" class="btn ghost" data-no>Cancel</button><button type="submit" class="btn primary">Save to My Outfits</button></div></form>`
    });
    $('[data-no]', m.el).onclick = () => m.close(true);
    $('#dm-form', m.el).onsubmit = async e => {
      e.preventDefault();
      try { await saveLook($('#dm-name', m.el).value.trim() || def); m.close(true); toast('Saved to My Outfits', 'success'); }
      catch (err) { toast('Could not save: ' + err.message, 'error'); }
    };
  }

  root.addEventListener('click', e => {
    if (e.target.closest('[data-go-closet]')) { root.dispatchEvent(new CustomEvent('goto-closet', { bubbles: true })); return; }
    const pin = e.target.closest('[data-pin]');
    if (pin) { const r = pin.dataset.pin; pinned[r] = !pinned[r]; paint(); return; }
    const cell = e.target.closest('.dm-cell');
    if (cell) {
      const row = cell.closest('.dm-row'); const role = row.dataset.role;
      const id = cell.dataset.id || null;
      const strip = $('.dm-strip', row);
      active[role] = Number(cell.dataset.copy);
      if (id !== sel[role]) { sel[role] = id; }
      paint();
      // Centre the piece you actually tapped, inside the copy you're looking at.
      if (strip) centerOn(strip, cell, false);
      return;
    }
    const dm = e.target.closest('[data-dm]');
    if (dm) { db.settings.set('dressMode', dm.dataset.dm); paint(); return; }
    if (e.target.closest('[data-dice]')) return roll();
    if (e.target.closest('[data-save]')) return saveDialog();
    if (e.target.closest('[data-filter]')) return openFilterPanel(filters, items.filter(i => !i.archived), load, { hideCategory: true });
    if (e.target.closest('[data-canvas]')) {
      const ids = selected().map(i => i.id);
      if (!ids.length) return toast('Pick at least one piece first.', 'error');
      onOpenInCanvas(ids);
    }
  });
  root.addEventListener('change', e => {
    const s = e.target.closest && e.target.closest('[data-sort]');
    if (!s) return;
    db.settings.set('dressSort', s.value);
    load();
  });
  root.addEventListener('keydown', e => {
    const strip = e.target.closest && e.target.closest('.dm-strip');
    if (!strip || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const role = strip.closest('.dm-row').dataset.role;
    const list = pool[role]; if (!list.length) return;
    const ids = list.map(i => i.id);
    const i0 = Math.max(0, ids.indexOf(sel[role]));
    const fwd = e.key === 'ArrowRight';
    const id = ids[(i0 + (fwd ? 1 : -1) + ids.length) % ids.length];
    const cells = $$('.dm-cell', strip); if (!cells.length) { e.preventDefault(); return; }
    // Walk the item ring and glide to the nearest copy of the next item: crossing the
    // last<->first seam is just one tile because the copies sit adjacent to each other,
    // so there is never a teleport, only a short smooth scroll.
    const c = strip.scrollLeft + strip.clientWidth / 2;
    let target = null, d = Infinity;
    for (const b of cells) {
      if ((b.dataset.id || '') !== id) continue;
      const x = Math.abs(b.offsetLeft + b.offsetWidth / 2 - c);
      if (x < d) { d = x; target = b; }
    }
    if (!target) target = cells[0];
    active[role] = Number(target.dataset.copy);
    sel[role] = id;
    centerOn(strip, target, false);
    paint();
    e.preventDefault();
  });

  db.onChange(debounce(k => { if (k === 'items') load(); }, 80));
  weather.onWeatherChange(() => { renderWxChip(); weatherWidget.refresh(); });
  const reflow = debounce(() => {
    sizeRowImages();
    paint({ scroll: true, instant: true });
  }, 150);
  window.addEventListener('resize', reflow);
  if ('orientationchange' in window) window.addEventListener('orientationchange', reflow);
  load();
  return { refresh: load, recenter: () => paint({ scroll: true, instant: true }) };
}
