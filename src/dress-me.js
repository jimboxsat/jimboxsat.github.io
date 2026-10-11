// "Dress me": swipe through tops, bottoms and shoes, pin a row to keep it, roll the dice.
import * as db from './database.js';
import { layoutRole } from './categories.js';
import { esc, $, $$, icons, toast, openModal, debounce } from './components.js';
import { newFilters, activeCount, applyFilters, openFilterPanel } from './filters.js';
import { imgSrc, blobToImage, loadImage } from './image-utils.js';
import { defaultBox, ROLE_LAYER } from './outfit-builder.js';

const ROWS = [
  { role: 'top', label: 'Tops', one: 'tops' },
  { role: 'bottom', label: 'Bottoms', one: 'bottoms' },
  { role: 'shoes', label: 'Shoes', one: 'shoes' }
];
const ICON = {
  dice: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3v1.5H7V13l3-3z"/><path d="M12 14.5V20"/></svg>'
};

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
  const sel = { top: undefined, bottom: undefined, shoes: undefined };   // undefined = not chosen yet, null = "None"
  const pinned = { top: false, bottom: false, shoes: false };
  const mode = () => (db.settings.get('dressMode', 'random') === 'color' ? 'color' : 'random');
  const byId = id => items.find(i => i.id === id) || null;
  const selected = () => ROWS.map(r => byId(sel[r.role])).filter(Boolean);

  async function load() {
    try { items = await db.getItems(); } catch (e) { console.error(e); items = []; }
    const live = applyFilters(items, { ...filters, category: 'All', subcategory: '', q: '', archived: false });
    for (const r of ROWS) pool[r.role] = live.filter(i => layoutRole(i) === r.role);
    for (const r of ROWS) {
      const list = pool[r.role], cur = sel[r.role];
      const valid = cur === null || (cur !== undefined && list.some(i => i.id === cur));
      // null means the user deliberately chose "None"; an empty pool stays undefined so a later load picks a piece
      if (!valid) sel[r.role] = list.length ? list[rand(list.length)].id : undefined;
    }
    build();
    requestAnimationFrame(() => { sizeRowImages(); paint({ scroll: true, instant: true }); });
  }

  function rowHtml(r) {
    const list = pool[r.role];
    const none = `<button class="dm-cell none" data-copy="1" role="option" data-id="" aria-selected="false" aria-label="No ${r.one}">None</button>`;
    const itemCells = c => list.map(i => `<button class="dm-cell" data-copy="${c}" role="option" data-id="${i.id}" aria-selected="false" aria-label="${esc(i.name)}"><img src="${imgSrc(i)}" alt="" draggable="false"></button>`).join('');
    // The items are repeated 3 times so swiping wraps around seamlessly; "None" lives at the far left.
    const cells = none + itemCells(0) + itemCells(1) + itemCells(2);
    return `<section class="dm-row" data-role="${r.role}">
      <div class="dm-row-head"><span class="dm-label">${r.label}</span><span class="dm-name"></span>
        <button class="dm-pin" data-pin="${r.role}" aria-pressed="false" aria-label="Pin ${r.one} (the dice skips pinned rows)" title="Pin: the dice skips this row">${ICON.pin}</button></div>
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
        <button class="dm-save" data-save>Save</button>
      </div>
      ${ROWS.map(rowHtml).join('')}
      <div class="dm-dock">
        <div class="seg two" role="group" aria-label="Dice mode"><button class="seg-btn" data-dm="random">Random</button><button class="seg-btn" data-dm="color">Color match</button></div>
        <button class="dm-dice" data-dice aria-label="Roll the dice">${ICON.dice}</button>
        <button class="btn" data-canvas>Open in canvas</button>
      </div>
      <p class="dm-note muted small" aria-live="polite"></p></div>`;
  }

  // suppressSettle stops settle() from interfering while we scroll programmatically,
  // so an animation can never be teleported to another copy halfway through.
  let suppressSettle = 0;
  function centerOn(strip, el, instant) {
    suppressSettle++;
    strip.scrollTo({ left: el.offsetLeft + el.offsetWidth / 2 - strip.clientWidth / 2, behavior: instant ? 'auto' : 'smooth' });
    const clear = () => { suppressSettle = Math.max(0, suppressSettle - 1); };
    if ('onscrollend' in strip) strip.addEventListener('scrollend', clear, { once: true });
    setTimeout(clear, instant ? 40 : 650);
  }
  function paint(opts = {}) {
    const m = mode();
    $$('[data-dm]', root).forEach(b => { const on = b.dataset.dm === m; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
    for (const r of ROWS) {
      const row = $(`.dm-row[data-role="${r.role}"]`, root); if (!row) continue;
      const pin = $('[data-pin]', row); pin.classList.toggle('on', !!pinned[r.role]); pin.setAttribute('aria-pressed', !!pinned[r.role]);
      const cur = sel[r.role] || '';
      const strip = $('.dm-strip', row);
      let target = null;
      if (strip) $$('.dm-cell', strip).forEach(b => { const on = b.dataset.copy === '1' && b.dataset.id === cur; b.classList.toggle('sel', on); b.setAttribute('aria-selected', on); if (on) target = b; });
      const it = byId(sel[r.role]);
      $('.dm-name', row).textContent = it ? it.name : (strip ? 'None' : '');
      if (opts.scroll && strip && target) centerOn(strip, target, opts.instant);
    }
  }

  // Choosing by swiping: whichever cell rests nearest the middle is the pick
  const timers = new WeakMap();
  root.addEventListener('scroll', e => {
    const strip = e.target; if (!strip.classList || !strip.classList.contains('dm-strip')) return;
    if (suppressSettle) return;
    clearTimeout(timers.get(strip)); timers.set(strip, setTimeout(() => settle(strip), 120));
  }, true);
  function settle(strip) {
    if (suppressSettle) return;
    const role = strip.closest('.dm-row').dataset.role;
    const cells = $$('.dm-cell', strip); if (!cells.length) return;
    const c = strip.scrollLeft + strip.clientWidth / 2; let best = null, d = Infinity;
    cells.forEach(b => { const x = Math.abs(b.offsetLeft + b.offsetWidth / 2 - c); if (x < d) { d = x; best = b; } });
    if (!best) return;
    // Keep the visible copy inside the middle so swiping wraps forever instead of dead-ending:
    // if the nearest cell sits in an outer copy, hop to the identical middle copy cell.
    if (best.dataset.copy !== '1') {
      const eq = cells.find(b => b.dataset.copy === '1' && (b.dataset.id || '') === (best.dataset.id || ''));
      if (eq) { centerOn(strip, eq, true); return; }
    }
    if ((best.dataset.id || null) !== sel[role]) { sel[role] = best.dataset.id || null; paint(); }
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
    const cell = e.target.closest('.dm-cell');
    if (cell) { sel[cell.closest('.dm-row').dataset.role] = cell.dataset.id || null; paint({ scroll: true }); return; }
    const pin = e.target.closest('[data-pin]');
    if (pin) { const r = pin.dataset.pin; pinned[r] = !pinned[r]; paint(); return; }
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
  root.addEventListener('keydown', e => {
    const strip = e.target.closest && e.target.closest('.dm-strip');
    if (!strip || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const role = strip.closest('.dm-row').dataset.role;
    const ids = ['', ...pool[role].map(i => i.id)];
    const i = Math.max(0, ids.indexOf(sel[role] || ''));
    const last = ids.length - 1;
    const fwd = e.key === 'ArrowRight';
    // Logical neighbour with wrap: past the last item -> first item; before the first one -> "None"; before "None" -> last item.
    let n;
    if (fwd) n = i >= last ? 1 : i + 1;
    else n = i <= 1 ? (i === 1 ? 0 : last) : i - 1;
    const id = ids[n] || '';
    const cells = $$('.dm-cell', strip); if (!cells.length) { e.preventDefault(); return; }
    // Which copy is currently on screen? Center there and only drift into the next copy on a wrap
    // so every key press advances exactly one tile without a long teleport.
    const c = strip.scrollLeft + strip.clientWidth / 2; let best = cells[0], d = Infinity;
    for (const b of cells) { const x = Math.abs(b.offsetLeft + b.offsetWidth / 2 - c); if (x < d) { d = x; best = b; } }
    const src = best.dataset.copy ? +best.dataset.copy : 1;
    const wrapFwd = fwd && i === last;                 // last item -> first item
    const wrapBack = !fwd && i === 0;                  // "None" -> last item
    const tCopy = Math.max(0, Math.min(2, src + (wrapFwd ? 1 : wrapBack ? -1 : 0)));
    let target = cells.find(b => +b.dataset.copy === tCopy && (b.dataset.id || '') === id);
    if (!target) target = cells.find(b => (b.dataset.id || '') === id && +b.dataset.copy === 1);
    if (!target) target = cells[0];
    sel[role] = id || null;
    centerOn(strip, target, wrapFwd || wrapBack);
    paint();
    e.preventDefault();
  });

  db.onChange(debounce(k => { if (k === 'items') load(); }, 80));
  const reflow = debounce(() => {
    sizeRowImages();
    paint({ scroll: true, instant: true });
  }, 150);
  window.addEventListener('resize', reflow);
  if ('orientationchange' in window) window.addEventListener('orientationchange', reflow);
  load();
  return { refresh: load, recenter: () => paint({ scroll: true, instant: true }) };
}
