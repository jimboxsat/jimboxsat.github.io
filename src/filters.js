// Shared filter state + panel, used by both Closet and Outfit Builder selector.
import { CATEGORIES, MAIN_CATEGORIES, SEASONS, OCCASIONS, COLOR_NAMES } from './categories.js';
import { esc, openModal, $, $$ } from './components.js';

export const newFilters = () => ({
  q: '', category: 'All', subcategory: '', colors: [], brands: [], seasons: [], occasions: [], tags: [],
  favoritesOnly: false, archived: false, sort: 'newest'
});

export function activeCount(f) {
  return (f.subcategory ? 1 : 0) + f.colors.length + f.brands.length + f.seasons.length + f.occasions.length + f.tags.length +
    (f.favoritesOnly ? 1 : 0) + (f.sort !== 'newest' ? 1 : 0);
}

const norm = s => String(s || '').toLowerCase();
const anyIn = (sel, arr) => !sel.length || sel.some(v => arr.map(norm).includes(norm(v)));

export function applyFilters(items, f, { includeArchivedAlways = false } = {}) {
  const q = norm(f.q).trim();
  let out = items.filter(i => {
    if (!includeArchivedAlways) {
      if (f.archived ? !i.archived : i.archived) return false;
    }
    if (f.category !== 'All' && i.category !== f.category) return false;
    if (f.subcategory && i.subcategory !== f.subcategory) return false;
    if (f.favoritesOnly && !i.favorite) return false;
    if (!anyIn(f.colors, i.colors || [])) return false;
    if (f.brands.length && !f.brands.map(norm).includes(norm(i.brand))) return false;
    if (!anyIn(f.seasons, i.season || [])) return false;
    if (!anyIn(f.occasions, i.occasions || [])) return false;
    if (!anyIn(f.tags, i.tags || [])) return false;
    if (q) {
      const hay = [i.name, i.brand, i.category, i.subcategory, ...(i.colors || []), ...(i.tags || [])].map(norm).join(' ');
      if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  });
  out.sort((a, b) => compareSort(a, b, f.sort));
  return out;
}

// Main colour only (colors[0]); pieces with no main colour rank after every known colour.
const mainColorRank = it => { const i = COLOR_NAMES.indexOf((it.colors && it.colors[0]) || ''); return i < 0 ? COLOR_NAMES.length : i; };
function compareSort(a, b, sort) {
  if (sort === 'oldest') return a.createdAt - b.createdAt;
  if (sort === 'name') return a.name.localeCompare(b.name);
  if (sort === 'brand') {
    const ab = (a.brand || '').trim().toLowerCase(), bb = (b.brand || '').trim().toLowerCase();
    if (!ab !== !bb) return ab ? -1 : 1;          // branded pieces first, unbranded last
    return ab.localeCompare(bb) || a.name.localeCompare(b.name);
  }
  if (sort === 'color') return mainColorRank(a) - mainColorRank(b) || a.name.localeCompare(b.name);
  return b.createdAt - a.createdAt;               // newest
}

export function categoryCounts(items, { archived = false } = {}) {
  const counts = { All: 0 };
  MAIN_CATEGORIES.forEach(c => counts[c] = 0);
  items.forEach(i => { if (!!i.archived !== archived) return; counts.All++; counts[i.category] = (counts[i.category] || 0) + 1; });
  return counts;
}

export function renderCategoryTabs(container, filters, items, onChange) {
  const counts = categoryCounts(items, { archived: filters.archived });
  const cats = ['All', ...MAIN_CATEGORIES.filter(c => counts[c] || c === filters.category)];
  Object.keys(counts).forEach(c => { if (!cats.includes(c) && counts[c]) cats.push(c); });
  container.innerHTML = `<div class="chips" role="tablist" aria-label="Categories">${cats.map(c =>
    `<button class="chip ${filters.category === c ? 'active' : ''}" role="tab" aria-selected="${filters.category === c}" data-cat="${esc(c)}">${esc(c)} <span class="count">${counts[c] || 0}</span></button>`).join('')}</div>
    ${filters.category !== 'All' && (CATEGORIES[filters.category] || []).length ? `<div class="chips sub" aria-label="Subcategories">
      <button class="chip small ${!filters.subcategory ? 'active' : ''}" data-sub="">All ${esc(filters.category)}</button>
      ${CATEGORIES[filters.category].map(s => `<button class="chip small ${filters.subcategory === s ? 'active' : ''}" data-sub="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}`;
  $$('[data-cat]', container).forEach(b => b.onclick = () => { filters.category = b.dataset.cat; filters.subcategory = ''; onChange(); });
  $$('[data-sub]', container).forEach(b => b.onclick = () => { filters.subcategory = b.dataset.sub; onChange(); });
}

export function openFilterPanel(filters, items, onApply, opts = {}) {
  const draft = JSON.parse(JSON.stringify(filters));
  const brands = [...new Set(items.map(i => i.brand).filter(Boolean))].sort();
  const tags = [...new Set(items.flatMap(i => i.tags || []))].sort();
  const multi = (key, opts, label) => `<fieldset><legend>${label}</legend><div class="chips wrap">${opts.length ? opts.map(o =>
    `<button type="button" class="chip small ${draft[key].includes(o) ? 'active' : ''}" data-multi="${key}" data-val="${esc(o)}" aria-pressed="${draft[key].includes(o)}">${esc(o)}</button>`).join('') : '<span class="muted small">Nothing to filter by yet</span>'}</div></fieldset>`;

  const m = openModal({ title: 'Filters', className: 'panel', body: '' });
  const render = () => {
    const subs = draft.category !== 'All' ? CATEGORIES[draft.category] || [] : [];
    m.el.innerHTML = `<form class="filter-form">
      <label class="field"><span>Main category</span><select name="category">${['All', ...MAIN_CATEGORIES].map(c => `<option ${c === draft.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="field"><span>Subcategory</span><select name="subcategory" ${subs.length ? '' : 'disabled'}><option value="">Any</option>${subs.map(s => `<option ${s === draft.subcategory ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
      ${multi('colors', COLOR_NAMES, 'Color')}
      ${multi('brands', brands, 'Brand')}
      ${multi('seasons', SEASONS, 'Season')}
      ${multi('occasions', OCCASIONS, 'Occasion')}
      ${multi('tags', tags, 'Style tags')}
      <label class="check"><input type="checkbox" name="favoritesOnly" ${draft.favoritesOnly ? 'checked' : ''}> Favorites only</label>
      <label class="field"><span>Sort</span><select name="sort">
        <option value="newest" ${draft.sort === 'newest' ? 'selected' : ''}>Newest added</option>
        <option value="oldest" ${draft.sort === 'oldest' ? 'selected' : ''}>Oldest added</option>
        <option value="name" ${draft.sort === 'name' ? 'selected' : ''}>Name A–Z</option>
        <option value="brand" ${draft.sort === 'brand' ? 'selected' : ''}>Brand A–Z</option>
        <option value="color" ${draft.sort === 'color' ? 'selected' : ''}>Main color</option></select></label>
      <div class="form-actions sticky">
        <button type="button" class="btn ghost" data-reset>Reset</button>
        <button type="button" class="btn ghost" data-clear>Clear all</button>
        <button type="submit" class="btn primary">Apply${activeCount(draft) ? ` (${activeCount(draft)})` : ''}</button></div></form>`;
    const form = $('form', m.el);
    if (opts.hideCategory) { form.category.closest('.field').hidden = true; form.subcategory.closest('.field').hidden = true; }
    form.category.onchange = () => { draft.category = form.category.value; draft.subcategory = ''; render(); };
    form.subcategory.onchange = () => { draft.subcategory = form.subcategory.value; render(); };
    form.favoritesOnly.onchange = () => { draft.favoritesOnly = form.favoritesOnly.checked; render(); };
    form.sort.onchange = () => { draft.sort = form.sort.value; render(); };
    $$('[data-multi]', form).forEach(b => b.onclick = () => {
      const arr = draft[b.dataset.multi], v = b.dataset.val; const ix = arr.indexOf(v);
      ix >= 0 ? arr.splice(ix, 1) : arr.push(v); render();
    });
    $('[data-reset]', form).onclick = () => { Object.assign(draft, JSON.parse(JSON.stringify(filters))); render(); };
    $('[data-clear]', form).onclick = () => { const q = draft.q; Object.assign(draft, newFilters(), { q }); render(); };
    form.onsubmit = e => { e.preventDefault(); Object.assign(filters, draft, { q: filters.q }); m.close(true); onApply(); };
  };
  render();
}
