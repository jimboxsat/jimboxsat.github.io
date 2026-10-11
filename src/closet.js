import * as db from './database.js';
import { esc, $, $$, itemCard, icons, debounce, toast, confirmDialog } from './components.js';
import { newFilters, activeCount, applyFilters, renderCategoryTabs, openFilterPanel } from './filters.js';
import { openItemEditor, openItemDetails } from './item-editor.js';
import { pruneUrlCache } from './image-utils.js';

export function createCloset(root, { onAddToOutfit, onBuild, onLoadDemo, onRemoveDemo }) {
  const filters = newFilters();
  let items = [];
  let loaded = false, error = null, viewing = false;
  const selected = new Set();

  root.innerHTML = `
    <div class="page-head">
      <div><h1>My Closet</h1><p class="muted" id="cl-count" aria-live="polite"></p></div>
    </div>
    <div class="toolbar">
      <label class="search">${icons.search}<input id="cl-search" type="search" placeholder="Search name, brand, color, tag…" aria-label="Search closet" autocomplete="off"></label>
      <button class="btn ghost" id="cl-filter">${icons.filter}<span>Filters</span><span class="badge-count" id="cl-fcount" hidden></span></button>
    </div>
    <div id="cl-tabs" class="tabs"></div>
    <div id="cl-active" class="active-filters"></div>
    <div id="cl-grid" class="grid" role="list"></div>
    <div id="cl-state"></div>
    <button class="archive-fab" id="cl-archive" aria-pressed="false" aria-label="Show archived items" title="Show archived items">${icons.archive}<span>Archived</span><span class="badge-count" id="cl-acount" hidden></span></button>
    <div class="unarchive-bar" id="cl-unarchive" hidden><button class="btn primary" id="cl-unarchive-btn">Unarchive selected</button></div>`;

  const grid = $('#cl-grid', root), stateEl = $('#cl-state', root);

  async function load() {
    try { items = await db.getItems(); error = null; }
    catch (e) { console.error(e); error = e; }
    loaded = true;
    pruneUrlCache(new Set(items.map(i => i.id)));
    render();
  }

  function render() {
    const n = activeCount(filters);
    const fc = $('#cl-fcount', root); fc.hidden = !n; fc.textContent = n;
    renderCategoryTabs($('#cl-tabs', root), filters, items, render);
    const live = items.filter(i => !i.archived), arch = items.filter(i => i.archived);
    viewing = !!filters.archived;
    if (!viewing) selected.clear();
    const fab = $('#cl-archive', root);
    fab.hidden = !loaded;
    fab.classList.toggle('active', viewing);
    fab.setAttribute('aria-pressed', viewing ? 'true' : 'false');
    const fabLabel = viewing ? 'Back to your closet' : 'Show archived items';
    fab.setAttribute('aria-label', fabLabel); fab.title = fabLabel;
    const ac = $('#cl-acount', root); ac.hidden = !arch.length; ac.textContent = arch.length;
    $('#cl-count', root).textContent = loaded
      ? (viewing ? `${arch.length} archived item${arch.length === 1 ? '' : 's'}` : `${live.length} item${live.length === 1 ? '' : 's'}${arch.length ? ` · ${arch.length} archived` : ''}`)
      : '';
    updateBar();

    // active filter pills
    const pills = [];
    if (filters.subcategory) pills.push(['subcategory', filters.subcategory]);
    ['colors', 'brands', 'seasons', 'occasions', 'tags'].forEach(k => filters[k].forEach(v => pills.push([k, v])));
    if (filters.favoritesOnly) pills.push(['favoritesOnly', 'Favorites']);
    if (filters.archived) pills.push(['archived', 'Archived']);
    $('#cl-active', root).innerHTML = pills.map(([k, v]) => `<button class="pill removable" data-k="${k}" data-v="${esc(v)}" aria-label="Remove filter ${esc(v)}">${esc(v)} ×</button>`).join('');
    $$('#cl-active [data-k]', root).forEach(b => b.onclick = () => {
      const k = b.dataset.k, v = b.dataset.v;
      if (Array.isArray(filters[k])) filters[k] = filters[k].filter(x => x !== v); else filters[k] = k === 'subcategory' ? '' : false;
      render();
    });

    grid.innerHTML = ''; stateEl.innerHTML = '';
    if (error) {
      stateEl.innerHTML = `<div class="empty"><h2>We couldn't open your closet</h2><p class="muted">${esc(error.message || 'Storage is unavailable. Private browsing can block it.')}</p><button class="btn primary" id="retry">Try again</button></div>`;
      $('#retry', root).onclick = load; return;
    }
    if (!loaded) { grid.innerHTML = Array.from({ length: 8 }, () => '<div class="card skeleton"><div class="card-img"></div></div>').join(''); return; }
    if (!items.length) {
      stateEl.innerHTML = `<div class="empty"><svg viewBox="0 0 120 120" width="110" height="110" aria-hidden="true"><path d="M60 14a10 10 0 0 1 10 10c0 6-6 8-10 12M60 36L14 70a6 6 0 0 0 4 11h84a6 6 0 0 0 4-11L60 36z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>
        <h2>Your closet is empty</h2><p class="muted">Add your clothes one at a time, or explore a sample wardrobe first.</p>
        <div class="empty-actions"><button class="btn primary big" id="first">Add your first item</button><button class="btn ghost big" id="demo">Explore sample closet</button></div></div>`;
      $('#first', root).onclick = () => add(); $('#demo', root).onclick = onLoadDemo; return;
    }
    const shown = applyFilters(items, filters);
    if (!shown.length) {
      if (viewing) {
        if (arch.length) {
          stateEl.innerHTML = `<div class="empty"><h2>No matching archived items</h2><p class="muted">Try a different search or clear your filters.</p><button class="btn ghost" id="clr">Clear search and filters</button></div>`;
          $('#clr', root).onclick = () => { const q = filters.q; Object.assign(filters, newFilters(), { q, archived: true }); $('#cl-search', root).value = ''; render(); };
        } else {
          stateEl.innerHTML = `<div class="empty"><h2>No archived items</h2><p class="muted">Items you archive will be kept here.</p><button class="btn ghost" id="clr-arch">Back to your closet</button></div>`;
          $('#clr-arch', root).onclick = () => { filters.archived = false; render(); };
        }
      } else if (!live.length && arch.length) {
        stateEl.innerHTML = `<div class="empty"><h2>Nothing to show</h2><p class="muted">Every item in your closet is archived right now.</p><button class="btn ghost" id="clr-arch">View archived items</button></div>`;
        $('#clr-arch', root).onclick = () => { filters.archived = true; render(); };
      } else {
        stateEl.innerHTML = `<div class="empty"><h2>No items match</h2><p class="muted">Try a different search or clear your filters.</p><button class="btn ghost" id="clr">Clear search and filters</button></div>`;
        $('#clr', root).onclick = () => { Object.assign(filters, newFilters()); $('#cl-search', root).value = ''; render(); };
      }
      return;
    }
    const frag = document.createDocumentFragment();
    shown.forEach(i => {
      const c = itemCard(i, { deletable: !viewing }); c.setAttribute('role', 'listitem');
      if (viewing) {
        const on = selected.has(i.id);
        const pick = document.createElement('button');
        pick.type = 'button';
        pick.className = 'pick' + (on ? ' on' : '');
        pick.dataset.pick = '';
        pick.setAttribute('aria-pressed', on ? 'true' : 'false');
        pick.setAttribute('aria-label', (on ? 'Deselect ' : 'Select ') + i.name);
        pick.innerHTML = icons.check;
        if (on) c.classList.add('picked');
        c.append(pick);
      }
      frag.append(c);
    });
    grid.append(frag);
    if (items.some(i => i.demo)) {
      stateEl.innerHTML = `<div class="demo-note">Sample items are marked “Sample”. <button class="link" id="rmdemo">Remove sample content</button></div>`;
      $('#rmdemo', root).onclick = onRemoveDemo;
    }
  }

  // Event delegation for cards
  grid.addEventListener('click', async e => {
    const card = e.target.closest('.card'); if (!card || card.classList.contains('skeleton')) return;
    const id = card.dataset.id;
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      const on = !selected.has(id);
      on ? selected.add(id) : selected.delete(id);
      pick.classList.toggle('on', on);
      pick.setAttribute('aria-pressed', on ? 'true' : 'false');
      const it = items.find(i => i.id === id);
      pick.setAttribute('aria-label', (on ? 'Deselect ' : 'Select ') + (it ? it.name : 'item'));
      card.classList.toggle('picked', on);
      updateBar();
      return;
    }
    if (e.target.closest('[data-fav]')) {
      const it = items.find(i => i.id === id);
      try { await db.updateItem(id, { favorite: !it.favorite }); } catch (err) { toast('Could not update favorite', 'error'); }
      return;
    }
    if (e.target.closest('[data-del]')) { await removeItem(id); return; }
    if (e.target.closest('[data-open]')) openItemDetails(id, { onAddToOutfit, onChanged: () => {} });
  });

  function updateBar() {
    const bar = $('#cl-unarchive', root), btn = $('#cl-unarchive-btn', root);
    const show = viewing && selected.size > 0;
    bar.hidden = !show;
    btn.disabled = false;
    if (show) btn.textContent = `Unarchive ${selected.size} item${selected.size === 1 ? '' : 's'}`;
  }

  async function unarchiveSelected() {
    const ids = new Set(selected);
    if (!ids.size) return;
    const btn = $('#cl-unarchive-btn', root); btn.disabled = true;
    try {
      const all = await db.getItems();
      const updated = all.filter(i => ids.has(i.id)).map(i => ({ ...i, archived: false, updatedAt: Date.now() }));
      await db.bulkPut(updated);
      toast(`${updated.length} item${updated.length === 1 ? '' : 's'} unarchived`, 'success');
      selected.clear();
    } catch (err) { toast('Could not unarchive: ' + err.message, 'error'); btn.disabled = false; }
  }

  async function removeItem(id) {
    const it = items.find(i => i.id === id); if (!it) return;
    try {
      const used = (await db.getOutfits()).filter(o => o.items.some(p => p.itemId === id));
      const msg = used.length ? `"${it.name}" is used in ${used.length} saved outfit${used.length > 1 ? 's' : ''} and will be removed from ${used.length > 1 ? 'them' : 'it'}. This can't be undone.` : `Delete "${it.name}" and its photo from this device? This can't be undone. Archive it instead if you might need it again.`;
      if (await confirmDialog({ title: 'Delete item?', message: msg, confirmText: 'Delete', danger: true })) { await db.deleteItem(id); toast('Item deleted'); }
    } catch (err) { toast('Could not delete: ' + err.message, 'error'); }
  }

  function add() { openItemEditor(null); }

  $('#cl-search', root).addEventListener('input', debounce(e => { filters.q = e.target.value; render(); }));
  $('#cl-filter', root).onclick = () => openFilterPanel(filters, items, render);
  $('#cl-archive', root).onclick = () => {
    filters.archived = !filters.archived;
    filters.category = 'All'; filters.subcategory = '';
    render();
  };
  $('#cl-unarchive-btn', root).onclick = unarchiveSelected;

  db.onChange(k => { if (k === 'items') load(); });
  load();
  return { add, refresh: load, getItems: () => items };
}
