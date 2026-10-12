import * as db from './database.js';
import { layoutRole, OCCASIONS } from './categories.js';
import { esc, $, $$, itemCard, icons, debounce, toast, openModal, confirmDialog } from './components.js';
import { newFilters, activeCount, applyFilters, renderCategoryTabs, openFilterPanel } from './filters.js';
import { openItemDetails } from './item-editor.js';
import { imgSrc, blobToImage, loadImage, canvasToBlob } from './image-utils.js';

const CW = 800, CH = 1000;            // logical canvas, 4:5
const ASPECT_H_OVER_W = CH / CW;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const ROLE_LAYER = { outer: 1, bottom: 2, full: 2, shoes: 2, misc: 3, top: 4, bag: 5, acc: 6 };

// ---------- default layout (starting suggestions only) ----------
const SLOTS = {
  top: { cx: .5, top: .09, h: .31 }, bottom: { cx: .5, top: .38, h: .38 }, shoes: { cx: .5, top: .78, h: .15 },
  outer: { cx: .27, top: .10, h: .46 }, bag: { cx: .79, top: .52, h: .2 }, acc: { cx: .8, top: .10, h: .13 },
  full: { cx: .5, top: .08, h: .72 }, misc: { cx: .5, top: .1, h: .3 }
};
export function defaultBox(role, idx, aspect) {
  const s = SLOTS[role] || SLOTS.misc;
  let cx = s.cx, top = s.top;
  if (idx > 0) { const step = Math.ceil(idx / 2) * .13 * (idx % 2 ? 1 : -1); cx = clamp(cx + step, .15, .85); top = clamp(top + .02 * idx, 0, .8); }
  let h = s.h, w = h * ASPECT_H_OVER_W * aspect;
  const maxW = role === 'full' ? .6 : .52;
  if (w > maxW) { w = maxW; h = w / (ASPECT_H_OVER_W * aspect); }
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(top, 0, 1 - h), w, h, rotation: 0 };
}

export function createOutfitBuilder(root) {
  let allItems = [], itemsById = new Map(), outfits = [];
  const aspects = new Map();                       // itemId -> {key, aspect}
  const imgCache = new Map();                      // itemId -> {key, img}
  const filters = newFilters();
  let S = blank();
  let tab = 'editor', uidCounter = 1, listQuery = '', listSort = 'modified', selectionInited = false;
  const recent = [];

  function blank() { return { id: null, name: '', occasion: '', tags: [], notes: '', placements: [], dirty: false, selected: null, replacing: null, pane: 'canvas', history: [], createdAt: null }; }

  root.innerHTML = `
    <div class="page-head"><div><h1>Outfit Builder</h1><p class="muted">Pick pieces from your closet, arrange them, and save the look.</p></div>
      <div class="subtabs" role="tablist"><button class="subtab active" role="tab" data-tab="editor" aria-selected="true">Editor</button><button class="subtab" role="tab" data-tab="list" aria-selected="false">My Outfits <span class="count" id="ob-ocount">0</span></button></div></div>
    <div id="ob-editor">
      <div class="pane-toggle" role="group" aria-label="Switch panel"><button data-pane="select">Closet</button><button data-pane="canvas" class="active">Canvas <span class="count" id="ob-pcount">0</span></button></div>
      <div class="workspace" data-pane="canvas">
        <aside class="selector" aria-label="Choose clothing">
          <div class="toolbar"><label class="search">${icons.search}<input id="ob-search" type="search" placeholder="Search closet…" aria-label="Search clothing" autocomplete="off"></label>
            <button class="btn ghost" id="ob-filter">${icons.filter}<span>Filters</span><span class="badge-count" id="ob-fcount" hidden></span></button></div>
          <div id="ob-tabs" class="tabs"></div>
          <div id="ob-replace-banner" class="banner" hidden></div>
          <div id="ob-grid" class="grid dense" role="list"></div>
          <div id="ob-sel-empty"></div>
        </aside>
        <section class="canvas-pane" aria-label="Outfit canvas">
          <div class="canvas-head">
            <input id="ob-name" class="name-input" placeholder="Name your outfit" maxlength="60" aria-label="Outfit name">
            <div class="canvas-tools">
              <button class="btn small ghost" id="ob-undo">↶ Undo</button>
              <button class="btn small ghost" id="ob-reset">Reset layout</button>
              <button class="btn small ghost" id="ob-shuffle" title="Randomly combine items from your closet. Pinned items stay.">⤮ Shuffle</button>
              <button class="btn small ghost" id="ob-new">New</button>
            </div>
          </div>
          <div class="stage-wrap"><div class="stage" id="ob-stage" tabindex="-1" aria-label="Outfit canvas"></div></div>
          <div class="sel-toolbar" id="ob-seltools" aria-label="Selected item controls"></div>
          <details class="meta" id="ob-meta"><summary>Occasion, tags and notes</summary>
            <div class="meta-grid">
              <label class="field"><span>Occasion</span><select id="ob-occ"><option value="">None</option>${OCCASIONS.map(o => `<option>${o}</option>`).join('')}</select></label>
              <label class="field"><span>Style tags (comma separated)</span><input id="ob-tags" maxlength="120"></label>
              <label class="field full"><span>Notes</span><textarea id="ob-notes" rows="2" maxlength="500"></textarea></label>
            </div></details>
          <div class="canvas-actions" id="ob-actions"></div>
        </section>
      </div>
    </div>
    <div id="ob-list" hidden>
      <div class="toolbar"><label class="search">${icons.search}<input id="ol-search" type="search" placeholder="Search outfits…" aria-label="Search outfits" autocomplete="off"></label>
        <label class="select-inline"><span class="sr">Sort</span><select id="ol-sort" aria-label="Sort outfits"><option value="modified">Recently modified</option><option value="created">Recently created</option><option value="name">Name A–Z</option></select></label>
        <button class="btn primary" id="ol-new">+ New outfit</button></div>
      <div id="ol-grid" class="grid outfits"></div><div id="ol-state"></div>
    </div>`;

  const stage = $('#ob-stage', root);

  // ---------- data ----------
  async function loadData() {
    try { allItems = await db.getItems(); outfits = await db.getOutfits(); }
    catch (e) { console.error(e); toast('Could not read your closet: ' + e.message, 'error'); }
    itemsById = new Map(allItems.map(i => [i.id, i]));
    renderSelector(); renderStage(); renderList();
  }
  function aspectOf(item) {
    if (!item) return 1;
    const key = item.id + ':' + item.updatedAt;
    const hit = aspects.get(item.id);
    if (hit && hit.key === key) return hit.aspect;
    return hit ? hit.aspect : 1;
  }
  async function ensureAspect(item) {
    if (!item) return 1;
    const key = item.id + ':' + item.updatedAt;
    const hit = aspects.get(item.id);
    if (hit && hit.key === key) return hit.aspect;
    let a = 1;
    try {
      const src = item.imageBlob ? item.imageBlob : item.imageUrl;
      if (src) { const img = item.imageBlob ? await blobToImage(src) : await loadImage(src); a = img.naturalWidth / img.naturalHeight || 1; }
    } catch { /* placeholder */ }
    aspects.set(item.id, { key, aspect: clamp(a, .25, 4) });
    return aspects.get(item.id).aspect;
  }
  async function imageFor(item) {
    const key = item.id + ':' + item.updatedAt;
    const hit = imgCache.get(item.id);
    if (hit && hit.key === key) return hit.img;
    const img = item.imageBlob ? await blobToImage(item.imageBlob) : item.imageUrl ? await loadImage(item.imageUrl) : null;
    imgCache.set(item.id, { key, img });
    return img;
  }

  // ---------- session helpers ----------
  const snapshot = () => JSON.stringify(S.placements);
  function pushHistory() { S.history.push(snapshot()); if (S.history.length > 60) S.history.shift(); }
  function markDirty() { S.dirty = true; renderActions(); }
  function normalizeLayers() { S.placements.sort((a, b) => a.layerOrder - b.layerOrder).forEach((p, i) => p.layerOrder = i); }
  const roleOfItem = id => { const it = itemsById.get(id); return it ? layoutRole(it) : 'misc'; };
  const getP = uid => S.placements.find(p => p.uid === uid);
  const newP = (itemId, box, layer) => ({ uid: uidCounter++, itemId, x: box.x, y: box.y, w: box.w, h: box.h, rotation: box.rotation || 0, layerOrder: layer, pinned: false });

  async function addItem(itemId, { allowDuplicate = false, silent = false } = {}) {
    const item = itemsById.get(itemId);
    if (!item) { toast('That item is no longer in your closet', 'error'); return; }
    if (item.archived) { toast('Archived items can’t be used in new outfits. Restore it first.', 'error'); return; }
    const existing = S.placements.find(p => p.itemId === itemId);
    if (existing && !allowDuplicate) { S.selected = existing.uid; renderStage(); if (!silent) toast('Already in this outfit'); return; }
    const aspect = await ensureAspect(item);
    pushHistory();
    const role = layoutRole(item);
    const idx = S.placements.filter(p => roleOfItem(p.itemId) === role).length;
    const layer = role === 'outer' ? Math.min(0, ...S.placements.map(p => p.layerOrder)) - 1 : Math.max(-1, ...S.placements.map(p => p.layerOrder)) + 1;
    const p = newP(itemId, defaultBox(role, idx, aspect), layer);
    S.placements.push(p); normalizeLayers(); S.selected = p.uid; markDirty(); renderStage(); updateMarks();
  }
  function removeP(uid) {
    pushHistory(); S.placements = S.placements.filter(p => p.uid !== uid); if (S.selected === uid) S.selected = null;
    normalizeLayers(); markDirty(); renderStage(); updateMarks();
  }
  async function autoLayoutAll() {
    pushHistory();
    const counts = {};
    for (const p of [...S.placements].sort((a, b) => a.layerOrder - b.layerOrder)) {
      const it = itemsById.get(p.itemId); const role = it ? layoutRole(it) : 'misc';
      const idx = counts[role] = (counts[role] ?? -1) + 1;
      Object.assign(p, defaultBox(role, idx, await ensureAspect(it)), { layerOrder: ROLE_LAYER[role] * 10 + idx });
    }
    normalizeLayers(); markDirty(); renderStage();
  }
  async function replaceWith(uid, itemId) {
    const p = getP(uid), item = itemsById.get(itemId);
    if (!p || !item) return;
    if (item.archived) return toast('Archived items can’t be used. Restore it first.', 'error');
    if (S.placements.some(q => q.itemId === itemId)) { toast('That item is already in the outfit', 'error'); return; }
    const aspect = await ensureAspect(item);
    pushHistory();
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    let h = p.h, w = h * ASPECT_H_OVER_W * aspect;
    if (w > .6) { w = .6; h = w / (ASPECT_H_OVER_W * aspect); }
    Object.assign(p, { itemId, w, h, x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h) });
    S.replacing = null; markDirty(); renderStage(); renderReplaceBanner(); updateMarks();
  }

  // ---------- stage rendering ----------
  function renderStage() {
    const sorted = [...S.placements].sort((a, b) => a.layerOrder - b.layerOrder);
    stage.innerHTML = '';
    if (!sorted.length) stage.innerHTML = `<div class="stage-empty"><p>Your canvas is empty</p><span class="muted">Choose pieces from the closet to start an outfit.</span><button class="btn ghost mobile-only" data-goto-select>Browse closet</button></div>`;
    sorted.forEach(p => {
      const item = itemsById.get(p.itemId);
      const el = document.createElement('div');
      el.className = 'piece' + (S.selected === p.uid ? ' selected' : '') + (p.pinned ? ' pinned' : '') + (item ? '' : ' missing');
      el.dataset.uid = p.uid; el.tabIndex = 0; el.setAttribute('role', 'button');
      el.setAttribute('aria-label', (item ? item.name : 'Missing item') + (p.pinned ? ', pinned' : '') + '. Arrow keys move, plus and minus resize, Delete removes.');
      el.style.cssText = `left:${p.x * 100}%;top:${p.y * 100}%;width:${p.w * 100}%;height:${p.h * 100}%;transform:rotate(${p.rotation}deg);z-index:${p.layerOrder + 1}`;
      el.innerHTML = item ? `<img src="${imgSrc(item)}" alt="" draggable="false">` : '<div class="missing-box">Item removed from closet</div>';
      if (S.selected === p.uid) el.insertAdjacentHTML('beforeend', '<span class="handle" data-handle aria-hidden="true"></span>' + (p.pinned ? '<span class="pin-mark">📌</span>' : ''));
      else if (p.pinned) el.insertAdjacentHTML('beforeend', '<span class="pin-mark">📌</span>');
      stage.append(el);
    });
    $('#ob-pcount', root).textContent = S.placements.length;
    renderSelTools(); renderActions();
  }

  function renderSelTools() {
    const el = $('#ob-seltools', root);
    const p = getP(S.selected);
    if (!p) { el.innerHTML = `<span class="muted small">${S.placements.length ? 'Tap a piece to move, resize or layer it.' : ''}</span>`; return; }
    const item = itemsById.get(p.itemId);
    const b = (a, label, text) => `<button class="btn tiny ghost" data-s="${a}" aria-label="${label}" title="${label}">${text}</button>`;
    el.innerHTML = `<strong class="sel-name">${esc(item ? item.name : 'Missing item')}</strong>
      <span class="grp">${b('left', 'Move left', '←')}${b('up', 'Move up', '↑')}${b('down', 'Move down', '↓')}${b('right', 'Move right', '→')}</span>
      <span class="grp">${b('smaller', 'Smaller', '−')}${b('bigger', 'Bigger', '+')}${b('rotl', 'Rotate left', '⟲')}${b('rotr', 'Rotate right', '⟳')}</span>
      <span class="grp">${b('fwd', 'Bring forward', 'Forward')}${b('back', 'Send backward', 'Backward')}</span>
      <span class="grp">${b('pin', p.pinned ? 'Unpin (shuffle may replace)' : 'Pin (shuffle keeps it)', p.pinned ? 'Unpin' : 'Pin')}${b('dup', 'Duplicate this piece', 'Duplicate')}${item ? b('replace', 'Replace with another item', 'Replace') : ''}${b('remove', 'Remove from outfit', 'Remove')}</span>`;
  }

  function renderActions() {
    const el = $('#ob-actions', root);
    el.innerHTML = `<button class="btn primary" id="a-save">${S.id ? 'Save changes' : 'Save outfit'}</button>
      <button class="btn ghost" id="a-cancel">Cancel</button>
      <button class="btn ghost" id="a-export" ${S.placements.length ? '' : 'disabled'}>Export PNG</button>
      ${S.id ? '<button class="btn ghost" id="a-dup">Duplicate outfit</button><button class="btn danger-ghost" id="a-del">Delete outfit</button>' : ''}
      ${S.dirty ? '<span class="dirty muted small">Unsaved changes</span>' : ''}`;
    $('#a-save', root).onclick = save; $('#a-cancel', root).onclick = cancel; $('#a-export', root).onclick = () => exportDialog(currentOutfitLike());
    if (S.id) { $('#a-dup', root).onclick = async () => { if (await saveIfDirty()) { const o = await db.duplicateOutfit(S.id); toast('Outfit duplicated'); await openOutfit(o.id, true); } }; $('#a-del', root).onclick = () => deleteOutfit(S.id); }
    $('#ob-undo', root).disabled = !S.history.length;
  }

  // ---------- pointer interactions ----------
  let drag = null;
  stage.addEventListener('pointerdown', e => {
    const piece = e.target.closest('.piece');
    if (!piece) { if (S.selected) { S.selected = null; renderStage(); } return; }
    const p = getP(+piece.dataset.uid); if (!p) return;
    const handle = e.target.closest('[data-handle]');
    if (S.selected !== p.uid) { S.selected = p.uid; renderStage(); }
    const el = $(`.piece[data-uid="${p.uid}"]`, stage);
    const r = stage.getBoundingClientRect();
    drag = { uid: p.uid, mode: handle ? 'resize' : 'move', sx: e.clientX, sy: e.clientY, p0: { ...p }, r, el, moved: false, pid: e.pointerId };
    el.setPointerCapture?.(e.pointerId); e.preventDefault();
  });
  stage.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pid) return;
    const p = getP(drag.uid); if (!p) return;
    const dx = (e.clientX - drag.sx) / drag.r.width, dy = (e.clientY - drag.sy) / drag.r.height;
    if (!drag.moved && Math.hypot(dx * drag.r.width, dy * drag.r.height) < 3) return;
    if (!drag.moved) { pushHistory(); drag.moved = true; }
    if (drag.mode === 'move') { p.x = clamp(drag.p0.x + dx, -drag.p0.w * .6, 1 - drag.p0.w * .4); p.y = clamp(drag.p0.y + dy, -drag.p0.h * .6, 1 - drag.p0.h * .4); }
    else { const w = clamp(drag.p0.w + dx, .06, 1.1); p.w = w; p.h = drag.p0.h * w / drag.p0.w; }
    const s = drag.el.style; s.left = p.x * 100 + '%'; s.top = p.y * 100 + '%'; s.width = p.w * 100 + '%'; s.height = p.h * 100 + '%';
  });
  const endDrag = e => { if (!drag || (e && e.pointerId !== drag.pid)) return; const moved = drag.moved; drag = null; if (moved) { markDirty(); renderStage(); } };
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('click', e => { if (e.target.closest('[data-goto-select]')) setPane('select'); });
  stage.addEventListener('keydown', e => {
    const piece = e.target.closest('.piece'); if (!piece) return;
    const p = getP(+piece.dataset.uid); if (!p) return;
    const step = e.shiftKey ? .05 : .01;
    const k = e.key; let handled = true;
    if (k === 'ArrowLeft') nudge(p, -step, 0); else if (k === 'ArrowRight') nudge(p, step, 0); else if (k === 'ArrowUp') nudge(p, 0, -step); else if (k === 'ArrowDown') nudge(p, 0, step);
    else if (k === '+' || k === '=') scale(p, 1.06); else if (k === '-') scale(p, 1 / 1.06);
    else if (k === ']') layer(p, 1); else if (k === '[') layer(p, -1);
    else if (k === 'r' || k === 'R') rotate(p, e.shiftKey ? -10 : 10);
    else if (k === 'Delete' || k === 'Backspace') { removeP(p.uid); return e.preventDefault(); }
    else handled = false;
    if (handled) { e.preventDefault(); const again = $(`.piece[data-uid="${p.uid}"]`, stage); again && again.focus(); }
  });
  let lastHistoryT = 0;
  const softPush = () => { const t = Date.now(); if (t - lastHistoryT > 600) pushHistory(); lastHistoryT = t; };
  function nudge(p, dx, dy) { softPush(); p.x = clamp(p.x + dx, -p.w * .6, 1 - p.w * .4); p.y = clamp(p.y + dy, -p.h * .6, 1 - p.h * .4); markDirty(); renderStage(); }
  function scale(p, f) { softPush(); const cx = p.x + p.w / 2, cy = p.y + p.h / 2; const w = clamp(p.w * f, .06, 1.1); const h = p.h * w / p.w; Object.assign(p, { w, h, x: cx - w / 2, y: cy - h / 2 }); markDirty(); renderStage(); }
  function rotate(p, d) { softPush(); p.rotation = ((p.rotation + d) % 360 + 360) % 360; markDirty(); renderStage(); }
  function layer(p, d) {
    pushHistory(); const arr = [...S.placements].sort((a, b) => a.layerOrder - b.layerOrder);
    const i = arr.indexOf(p), j = clamp(i + d, 0, arr.length - 1); if (i === j) return;
    arr.splice(i, 1); arr.splice(j, 0, p); arr.forEach((q, n) => q.layerOrder = n); markDirty(); renderStage();
  }
  $('#ob-seltools', root).addEventListener('click', async e => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    const p = getP(S.selected); if (!p) return; const a = b.dataset.s; const st = .02;
    if (a === 'left') nudge(p, -st, 0); else if (a === 'right') nudge(p, st, 0); else if (a === 'up') nudge(p, 0, -st); else if (a === 'down') nudge(p, 0, st);
    else if (a === 'bigger') scale(p, 1.1); else if (a === 'smaller') scale(p, 1 / 1.1);
    else if (a === 'rotl') rotate(p, -10); else if (a === 'rotr') rotate(p, 10);
    else if (a === 'fwd') layer(p, 1); else if (a === 'back') layer(p, -1);
    else if (a === 'pin') { p.pinned = !p.pinned; renderStage(); }
    else if (a === 'remove') removeP(p.uid);
    else if (a === 'dup') { pushHistory(); const c = newP(p.itemId, { x: clamp(p.x + .05, 0, 1 - p.w), y: clamp(p.y + .05, 0, 1 - p.h), w: p.w, h: p.h, rotation: p.rotation }, Math.max(...S.placements.map(q => q.layerOrder)) + 1); S.placements.push(c); S.selected = c.uid; markDirty(); renderStage(); }
    else if (a === 'replace') { S.replacing = p.uid; renderReplaceBanner(); setPane('select'); }
  });

  // ---------- selector ----------
  function renderSelector() {
    const n = activeCount(filters); const fc = $('#ob-fcount', root); fc.hidden = !n; fc.textContent = n;
    renderCategoryTabs($('#ob-tabs', root), filters, allItems.filter(i => !i.archived), renderSelector);
    const grid = $('#ob-grid', root), empty = $('#ob-sel-empty', root);
    const shown = applyFilters(allItems, { ...filters, archived: false });
    grid.innerHTML = ''; empty.innerHTML = '';
    if (!allItems.filter(i => !i.archived).length) { empty.innerHTML = '<div class="empty small-empty"><p class="muted">Your closet has no items yet.</p><button class="btn primary" data-goto-closet>Go to closet</button></div>'; return; }
    if (!shown.length) { empty.innerHTML = '<div class="empty small-empty"><p class="muted">No items match your search or filters.</p></div>'; return; }
    const inOutfit = new Set(S.placements.map(p => p.itemId));
    const frag = document.createDocumentFragment();
    shown.forEach(i => { const c = itemCard(i, { selected: inOutfit.has(i.id), selectable: true, showFav: false }); c.setAttribute('role', 'listitem'); frag.append(c); });
    grid.append(frag);
  }
  function updateMarks() {
    const inOutfit = new Set(S.placements.map(p => p.itemId));
    $$('#ob-grid .card', root).forEach(c => { const on = inOutfit.has(c.dataset.id); c.classList.toggle('selected', on); const hit = $('[data-open]', c); hit && hit.setAttribute('aria-pressed', on); });
  }
  function renderReplaceBanner() {
    const el = $('#ob-replace-banner', root); const p = getP(S.replacing);
    if (!p) { el.hidden = true; return; }
    const it = itemsById.get(p.itemId);
    el.hidden = false; el.innerHTML = `Choose an item to replace <strong>${esc(it ? it.name : 'missing item')}</strong> <button class="link" data-cancel-replace>Cancel</button>`;
  }
  $('#ob-replace-banner', root).addEventListener('click', e => { if (e.target.closest('[data-cancel-replace]')) { S.replacing = null; renderReplaceBanner(); } });
  $('#ob-grid', root).addEventListener('click', async e => {
    const card = e.target.closest('.card'); if (!card) return; const id = card.dataset.id;
    if (e.target.closest('[data-peek]')) { openItemDetails(id, { onAddToOutfit: i => addItem(i), onChanged: () => {} }); return; }
    if (!e.target.closest('[data-open]')) return;
    if (S.replacing) { await replaceWith(S.replacing, id); setPane('canvas'); return; }
    const existing = S.placements.filter(p => p.itemId === id);
    if (existing.length) { pushHistory(); S.placements = S.placements.filter(p => p.itemId !== id); if (!getP(S.selected)) S.selected = null; normalizeLayers(); markDirty(); renderStage(); updateMarks(); }
    else { await addItem(id); }
  });
  root.addEventListener('click', e => { if (e.target.closest('[data-goto-closet]')) root.dispatchEvent(new CustomEvent('goto-closet', { bubbles: true })); });
  $('#ob-search', root).addEventListener('input', debounce(e => { filters.q = e.target.value; renderSelector(); }));
  $('#ob-filter', root).onclick = () => openFilterPanel(filters, allItems.filter(i => !i.archived), renderSelector);

  function setPane(p) {
    S.pane = p; $('.workspace', root).dataset.pane = p;
    $$('.pane-toggle button', root).forEach(b => b.classList.toggle('active', b.dataset.pane === p));
  }
  $$('.pane-toggle button', root).forEach(b => b.onclick = () => setPane(b.dataset.pane));

  // ---------- header controls ----------
  $('#ob-name', root).addEventListener('input', e => { S.name = e.target.value; markDirty(); });
  $('#ob-occ', root).addEventListener('change', e => { S.occasion = e.target.value; markDirty(); });
  $('#ob-tags', root).addEventListener('input', e => { S.tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean); markDirty(); });
  $('#ob-notes', root).addEventListener('input', e => { S.notes = e.target.value; markDirty(); });
  $('#ob-undo', root).onclick = () => {
    const snap = S.history.pop(); if (!snap) return;
    S.placements = JSON.parse(snap); if (!getP(S.selected)) S.selected = null; S.dirty = true; renderStage(); updateMarks();
  };
  $('#ob-reset', root).onclick = () => { if (!S.placements.length) return toast('Nothing to arrange yet'); autoLayoutAll(); };
  $('#ob-new', root).onclick = async () => { if (await confirmDiscard()) { S = blank(); syncFields(); renderStage(); updateMarks(); } };
  function syncFields() {
    $('#ob-name', root).value = S.name; $('#ob-occ', root).value = S.occasion || ''; $('#ob-tags', root).value = S.tags.join(', '); $('#ob-notes', root).value = S.notes || '';
    setPane(S.pane); renderReplaceBanner();
  }

  // ---------- shuffle ----------
  $('#ob-shuffle', root).onclick = async () => {
    const active = allItems.filter(i => !i.archived);
    if (active.length < 2) return toast('Add at least two items to your closet to shuffle outfits.', 'error');
    const f = { ...filters, category: 'All', subcategory: '', q: '', archived: false };
    const group = list => list.reduce((m, i) => { (m[layoutRole(i)] ||= []).push(i); return m; }, {});
    const filtered = group(applyFilters(allItems, f)), all = group(active);
    const pinned = S.placements.filter(p => p.pinned && itemsById.has(p.itemId));
    const have = new Set(pinned.map(p => roleOfItem(p.itemId)));
    let relaxed = false;
    const candidates = role => { if (filtered[role]?.length) return filtered[role]; if (all[role]?.length) { relaxed = true; return all[role]; } return []; };
    const required = have.has('full') ? [] : ['top', 'bottom'];
    const optional = ['shoes'];
    const winter = f.seasons.some(s => ['Winter', 'Autumn'].includes(s));
    if (!have.has('outer') && (winter || Math.random() < .4)) optional.push('outer');
    if (!have.has('acc') && Math.random() < .4) optional.push('acc');
    if (!have.has('bag') && Math.random() < .2) optional.push('bag');
    const slots = [...required, ...optional].filter(r => !have.has(r));
    const usable = slots.filter(r => candidates(r).length);
    if (!pinned.length && !usable.some(r => r === 'top' || r === 'bottom')) return toast('Not enough tops or bottoms to build a combination yet.', 'error');
    if (!usable.length) return toast('Nothing else in your closet to shuffle with the pinned items.', 'error');
    const sig = ids => [...ids].sort().join('|');
    recent.length = 0; recent.push(sig(S.placements.map(p => p.itemId)));
    let pick = null;
    for (let t = 0; t < 30; t++) {
      const chosen = usable.map(r => { const c = candidates(r); return c[Math.floor(Math.random() * c.length)]; });
      pick = chosen;
      if (!recent.includes(sig([...pinned.map(p => p.itemId), ...chosen.map(i => i.id)]))) break;
    }
    pushHistory();
    const keep = pinned.map(p => ({ ...p })); const counts = {};
    keep.forEach(p => { const r = roleOfItem(p.itemId); counts[r] = (counts[r] ?? -1) + 1; });
    const out = [...keep];
    for (const it of pick) {
      const r = layoutRole(it); const idx = counts[r] = (counts[r] ?? -1) + 1;
      const a = await ensureAspect(it);
      out.push(newP(it.id, defaultBox(r, idx, a), ROLE_LAYER[r] * 10 + idx));
    }
    S.placements = out; normalizeLayers(); S.selected = null; markDirty(); renderStage(); updateMarks();
    const missing = ['top', 'bottom'].filter(r => !have.has(r) && !usable.includes(r));
    toast(relaxed ? 'Shuffled. Some filters were relaxed to find enough items.' : missing.length ? `Shuffled. You have no ${missing.join(' or ')} items yet.` : 'Shuffled. Pin pieces you like, then shuffle again.');
  };

  // ---------- save / open ----------
  function currentOutfitLike() { return { name: S.name || 'outfit', items: S.placements.map(strip) }; }
  const strip = p => ({ itemId: p.itemId, x: p.x, y: p.y, width: p.w, height: p.h, rotation: p.rotation, layerOrder: p.layerOrder });
  const unstrip = q => ({ uid: uidCounter++, itemId: q.itemId, x: q.x, y: q.y, w: q.width, h: q.height, rotation: q.rotation || 0, layerOrder: q.layerOrder, pinned: false });

  async function save() {
    if (!S.placements.length) { toast('Add at least one item before saving.', 'error'); return false; }
    const name = (S.name || '').trim() || 'Untitled outfit';
    try {
      let preview = null; try { preview = await renderPNG(currentOutfitLike(), { width: 480, transparent: false }); } catch { /* preview optional */ }
      const data = { name, items: S.placements.map(strip), occasion: S.occasion, tags: S.tags, notes: S.notes, previewImage: preview };
      const saved = S.id ? await db.updateOutfit(S.id, data) : await db.addOutfit(data);
      S.id = saved.id; S.name = name; S.dirty = false; syncFields(); renderActions();
      toast('Outfit saved', 'success'); return true;
    } catch (e) { console.error(e); toast('Could not save outfit: ' + e.message, 'error'); return false; }
  }
  async function saveIfDirty() { return S.dirty ? save() : true; }
  async function confirmDiscard() {
    if (!S.dirty) return true;
    return confirmDialog({ title: 'Discard unsaved changes?', message: 'This outfit has changes that haven’t been saved.', confirmText: 'Discard', danger: true });
  }
  async function cancel() { if (await confirmDiscard()) { S = blank(); syncFields(); renderStage(); updateMarks(); setTab('list'); } }
  async function openOutfit(id, skipConfirm = false) {
    if (!skipConfirm && S.id !== id && !(await confirmDiscard())) return;
    const o = await db.getOutfit(id); if (!o) return toast('That outfit no longer exists', 'error');
    await loadData();
    for (const q of o.items) await ensureAspect(itemsById.get(q.itemId));
    S = blank(); Object.assign(S, { id: o.id, name: o.name, occasion: o.occasion || '', tags: o.tags || [], notes: o.notes || '', createdAt: o.createdAt });
    S.placements = o.items.map(unstrip);
    const missing = S.placements.filter(p => !itemsById.has(p.itemId)).length;
    syncFields(); renderStage(); updateMarks(); setTab('editor');
    if (missing) toast(`${missing} item${missing > 1 ? 's' : ''} in this outfit ${missing > 1 ? 'are' : 'is'} no longer in your closet. You can remove or replace them.`, 'error');
  }
  async function deleteOutfit(id) {
    const o = outfits.find(x => x.id === id) || await db.getOutfit(id); if (!o) return;
    if (!(await confirmDialog({ title: 'Delete outfit?', message: `Delete “${o.name}”? Your clothing items are not affected.`, confirmText: 'Delete', danger: true }))) return;
    try { await db.deleteOutfit(id); toast('Outfit deleted'); if (S.id === id) { S = blank(); syncFields(); renderStage(); updateMarks(); } } catch (e) { toast('Could not delete: ' + e.message, 'error'); }
  }

  // ---------- rendering to PNG ----------
  async function renderPNG(outfit, { width = 1600, transparent = false } = {}) {
    const height = Math.round(width * CH / CW);
    const c = document.createElement('canvas'); c.width = width; c.height = height;
    const ctx = c.getContext('2d');
    if (!transparent) { ctx.fillStyle = '#f7f4ee'; ctx.fillRect(0, 0, width, height); }
    const placements = [...outfit.items].sort((a, b) => a.layerOrder - b.layerOrder);
    for (const p of placements) {
      const item = itemsById.get(p.itemId); if (!item) continue;
      const img = await imageFor(item); if (!img) continue;
      const bx = p.x * width, by = p.y * height, bw = p.width * width, bh = p.height * height;
      const s = Math.min(bw / img.naturalWidth, bh / img.naturalHeight);
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      ctx.save(); ctx.translate(bx + bw / 2, by + bh / 2); ctx.rotate((p.rotation || 0) * Math.PI / 180);
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh); ctx.restore();
    }
    return canvasToBlob(c);
  }
  function exportDialog(outfit) {
    if (!outfit.items.some(p => itemsById.has(p.itemId))) return toast('There is nothing to export yet.', 'error');
    const m = openModal({ title: 'Export outfit as PNG', className: 'small', body: `<label class="check"><input type="checkbox" id="x-tr"> Transparent background</label><p class="muted small">Exports at 1600 × 2000 px without any editor controls.</p><div class="form-actions"><button class="btn ghost" data-no>Cancel</button><button class="btn primary" id="x-go" autofocus>Download PNG</button></div>` });
    $('[data-no]', m.el).onclick = () => m.close();
    $('#x-go', m.el).onclick = async () => {
      try {
        const blob = await renderPNG(outfit, { width: 1600, transparent: $('#x-tr', m.el).checked });
        const url = URL.createObjectURL(blob); const a = document.createElement('a');
        a.href = url; a.download = (outfit.name || 'outfit').replace(/[^\w\-]+/g, '-').toLowerCase() + '.png'; document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000); m.close(true); toast('PNG exported', 'success');
      } catch (e) { console.error(e); toast('Export failed: ' + (e.message || 'could not draw the outfit'), 'error'); }
    };
  }

  // ---------- My Outfits ----------
  function miniCollage(o) {
    const parts = [...o.items].sort((a, b) => a.layerOrder - b.layerOrder).map(p => {
      const it = itemsById.get(p.itemId); if (!it) return '';
      return `<img src="${imgSrc(it)}" alt="" loading="lazy" style="left:${p.x * 100}%;top:${p.y * 100}%;width:${p.width * 100}%;height:${p.height * 100}%;transform:rotate(${p.rotation || 0}deg);z-index:${p.layerOrder + 1}">`;
    }).join('');
    return `<div class="mini">${parts || '<span class="muted small">Empty</span>'}</div>`;
  }
  function renderList() {
    $('#ob-ocount', root).textContent = outfits.length;
    const grid = $('#ol-grid', root), st = $('#ol-state', root); grid.innerHTML = ''; st.innerHTML = '';
    const q = listQuery.trim().toLowerCase();
    let list = outfits.filter(o => !q || [o.name, o.occasion, ...(o.tags || [])].join(' ').toLowerCase().includes(q));
    list.sort((a, b) => listSort === 'name' ? a.name.localeCompare(b.name) : listSort === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt);
    if (!outfits.length) { st.innerHTML = '<div class="empty"><h2>No saved outfits yet</h2><p class="muted">Combine pieces from your closet into your first look.</p><button class="btn primary big" id="ol-first">Create your first outfit</button></div>'; $('#ol-first', root).onclick = newOutfit; return; }
    if (!list.length) { st.innerHTML = '<div class="empty"><h2>No outfits match</h2></div>'; return; }
    grid.innerHTML = list.map(o => {
      const n = o.items.length;
      return `<article class="ocard" data-id="${o.id}"><button class="ocard-hit" data-edit aria-label="Edit ${esc(o.name)}">${miniCollage(o)}
        <span class="card-meta"><span class="card-name">${esc(o.name)}</span><span class="card-sub">${n} item${n === 1 ? '' : 's'}${o.occasion ? ' · ' + esc(o.occasion) : ''}</span></span></button>
        ${o.demo ? '<span class="badge demo">Sample</span>' : ''}
        <div class="ocard-actions"><button class="btn tiny ghost" data-edit>Edit</button><button class="btn tiny ghost" data-dup>Duplicate</button><button class="btn tiny ghost" data-exp>Export</button><button class="btn tiny danger-ghost" data-del>Delete</button></div></article>`;
    }).join('');
  }
  $('#ol-grid', root).addEventListener('click', async e => {
    const card = e.target.closest('.ocard'); if (!card) return; const id = card.dataset.id;
    try {
      if (e.target.closest('[data-del]')) await deleteOutfit(id);
      else if (e.target.closest('[data-dup]')) { await db.duplicateOutfit(id); toast('Outfit duplicated'); }
      else if (e.target.closest('[data-exp]')) { const o = outfits.find(x => x.id === id); exportDialog(o); }
      else if (e.target.closest('[data-edit]')) openOutfit(id);
    } catch (err) { toast(err.message, 'error'); }
  });
  $('#ol-search', root).addEventListener('input', debounce(e => { listQuery = e.target.value; renderList(); }));
  $('#ol-sort', root).onchange = e => { listSort = e.target.value; renderList(); };
  async function newOutfit() { if (await confirmDiscard()) { S = blank(); syncFields(); renderStage(); updateMarks(); setTab('editor'); } }
  $('#ol-new', root).onclick = newOutfit;

  function setTab(t) {
    tab = t;
    $$('.subtab', root).forEach(b => { const on = b.dataset.tab === t; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
    $('#ob-editor', root).hidden = t !== 'editor'; $('#ob-list', root).hidden = t !== 'list';
  }
  $$('.subtab', root).forEach(b => b.onclick = () => setTab(b.dataset.tab));

  window.addEventListener('beforeunload', e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

  const reload = debounce(async () => {
    await loadData();
    // Drop references to deleted items from the live session without crashing
    const gone = S.placements.filter(p => !itemsById.has(p.itemId));
    if (gone.length && !S.id) { S.placements = S.placements.filter(p => itemsById.has(p.itemId)); renderStage(); }
    updateMarks();
  }, 60);
  db.onChange(() => reload());
  syncFields(); renderActions(); loadData();

  return {
    async addItem(id) { setTab('editor'); setPane('canvas'); await loadData(); await addItem(id); },
    async startWith(ids) {
      if (!(await confirmDiscard())) return false;
      S = blank(); syncFields(); setTab('editor'); await loadData(); renderStage();
      for (const id of ids) await addItem(id, { silent: true });
      S.selected = null; renderStage(); updateMarks(); return true;
    },
    startNew: () => { setTab('editor'); },
    showList: () => setTab('list'),
    showEditor: () => setTab('editor'),
    isDirty: () => S.dirty,
    openOutfit: id => openOutfit(id),
    exportOutfit: id => { const o = outfits.find(x => x.id === id); if (o) exportDialog(o); },
    deleteOutfit: id => deleteOutfit(id)
  };
}
