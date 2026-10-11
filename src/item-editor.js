import * as db from './database.js';
import { CATEGORIES, MAIN_CATEGORIES, SEASONS, OCCASIONS, COLOR_NAMES, COLORS } from './categories.js';
import { esc, $, $$, openModal, toast, confirmDialog, icons } from './components.js';
import { openImageCropper } from './screenshot.js';
import { validateImageFile, blobToImage, loadImage, renderEdited, normalizeBlob, imgSrc, canvasToBlob } from './image-utils.js';

export function openItemEditor(existing = null, { onSaved, initialBlob = null } = {}) {
  const editing = !!existing;
  const state = {
    source: existing?.imageBlob || existing?.imageUrl ? 'keep' : 'upload',
    img: null, blob: existing?.imageBlob || null, imageUrl: existing?.imageUrl || '',
    edit: { rotate: 0, zoom: 1, offX: 0, offY: 0, frame: 'free', bgRemove: false, bgTol: 40 }, dirtyImage: false,
    colors: (existing?.colors || []).slice(1), season: [...(existing?.season || [])], occasions: [...(existing?.occasions || [])],
    tags: [...(existing?.tags || [])], dirty: false, saving: false, previewUrl: ''
  };
  const items = []; // for brand suggestions
  db.getItems().then(all => {
    const dl = $('#brandList', m.el); if (!dl) return;
    [...new Set(all.map(i => i.brand).filter(Boolean))].forEach(b => dl.insertAdjacentHTML('beforeend', `<option value="${esc(b)}">`));
    items.push(...all);
  });
  const known = existing && (MAIN_CATEGORIES.includes(existing.category));
  const cat0 = existing ? existing.category : 'Tops';

  const m = openModal({
    title: editing ? 'Edit item' : 'Add item', className: 'wizard',
    beforeClose: async () => state.dirty ? confirmDialog({ title: 'Discard changes?', message: 'Your unsaved changes will be lost.', confirmText: 'Discard', danger: true }) : true,
    onClose: () => { if (state.previewUrl) URL.revokeObjectURL(state.previewUrl); },
    body: `
    <div class="wizard-steps">
      <button type="button" class="wizard-step" data-step="1"><b>1</b> Photo</button>
      <span class="wizard-sep" aria-hidden="true"></span>
      <button type="button" class="wizard-step" data-step="2"><b>2</b> Details</button>
    </div>
    <form class="item-form" novalidate>
      <section class="step-panel" data-panel="1">
        <div class="img-pane">
          <div class="img-preview" id="imgPreview" aria-live="polite"><div class="img-empty">No image yet</div></div>
          <div class="seg" role="tablist" aria-label="Image source">
            <button type="button" class="seg-btn" data-src="upload">Upload</button>
            <button type="button" class="seg-btn" data-src="camera">Camera</button>
            <button type="button" class="seg-btn" data-src="url">URL</button>
            <button type="button" class="seg-btn" data-src="none">No image</button>
          </div>
          <div id="srcPanel" class="src-panel"></div>
          <div id="imgTools" class="img-tools" hidden>
            <div class="tool-row">
              <button type="button" class="btn small ghost" data-rot="-90" aria-label="Rotate left">⟲ Left</button>
              <button type="button" class="btn small ghost" data-rot="90" aria-label="Rotate right">⟳ Right</button>
              <select id="frameSel" aria-label="Crop frame"><option value="free">Original frame</option><option value="square">Square crop</option><option value="portrait">Portrait crop</option></select>
            </div>
            <div class="tool-row">
              <button type="button" class="btn small ghost" id="bgRemoveBtn" aria-pressed="false">Remove background</button>
            </div>
            <label class="range" id="bgTolRow" hidden><span>Tolerance</span><input type="range" id="bgTol" min="10" max="120" step="5" value="40"></label>
            <label class="range"><span>Zoom</span><input type="range" id="zoom" min="0.5" max="3" step="0.05" value="1"></label>
            <label class="range"><span>Move ↔</span><input type="range" id="offX" min="-1" max="1" step="0.02" value="0"></label>
            <label class="range"><span>Move ↕</span><input type="range" id="offY" min="-1" max="1" step="0.02" value="0"></label>
            <button type="button" class="btn small ghost" id="resetImg">Reset edits</button>
            <p class="muted small">Tip: “Remove background” works best on a plain, uniform background. Transparent PNGs are supported.</p>
          </div>
          <p class="error" id="imgErr" role="alert" hidden></p>
        </div>
        <div class="step-actions"><button type="button" class="btn primary big" data-step-go="2">Continue to details</button></div>
      </section>
      <section class="step-panel" data-panel="2" hidden>
        <div class="step-photo" id="stepPhoto"></div>
        <div class="fields">
        <label class="field"><span>Name *</span><input name="name" maxlength="80" required autocomplete="off" value="${esc(existing?.name || '')}" autofocus><em class="err" data-err="name"></em></label>
        <div class="row2">
          <label class="field"><span>Brand</span><input name="brand" list="brandList" maxlength="60" value="${esc(existing?.brand || '')}"><datalist id="brandList"></datalist></label>
          <label class="field"><span>Main color</span><select name="mainColor"><option value="">—</option>${COLOR_NAMES.map(c => `<option ${existing?.colors?.[0] === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        </div>
        <div class="row2">
          <label class="field"><span>Category *</span><select name="category">${[...MAIN_CATEGORIES, ...(known || !existing ? [] : [existing.category]), '＋ Custom…'].map(c => `<option ${c === cat0 ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
          <label class="field"><span>Subcategory</span><input name="subcategory" list="subList" maxlength="40" value="${esc(existing?.subcategory || '')}"><datalist id="subList"></datalist></label>
        </div>
        <label class="field" id="customCatWrap" hidden><span>Custom category name</span><input name="customCategory" maxlength="30"><em class="err" data-err="customCategory"></em></label>
        <fieldset><legend>Additional colors</legend><select id="addColorSel" aria-label="Add an additional color"><option value="">Choose a color…</option>${COLOR_NAMES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select><div class="chips wrap color-pills" id="colorChips"></div></fieldset>
        <fieldset><legend>Season</legend><div class="chips wrap" id="seasonChips"></div></fieldset>
        <fieldset><legend>Occasion</legend><div class="chips wrap" id="occChips"></div></fieldset>
        <div class="field"><span>Style tags</span>
          <div class="tag-input" id="tagBox"><span id="tagList"></span><input id="tagInput" placeholder="Type a tag and press Enter" maxlength="30" aria-label="Add tag"></div></div>
        <label class="field"><span>Notes</span><textarea name="notes" rows="2" maxlength="500">${esc(existing?.notes || '')}</textarea></label>
        <div class="row2">
          <label class="field"><span>Purchase price</span><input name="price" type="number" min="0" step="0.01" value="${existing?.purchasePrice ?? ''}"><em class="err" data-err="price"></em></label>
          <label class="field"><span>Purchase date</span><input name="date" type="date" value="${esc(existing?.purchaseDate || '')}"></label>
        </div>
        <label class="fav-check"><input type="checkbox" name="favorite" ${existing?.favorite ? 'checked' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.63 5.33 5.87.86-4.25 4.14 1 5.85L12 17l-5.25 2.63 1-5.85L3.5 9.78l5.87-.86z"/></svg><span>Favorite</span></label>
        <div class="form-actions sticky">
          <button type="button" class="btn ghost" data-step-go="1">Back</button>
          <button type="submit" class="btn primary" id="saveBtn">${editing ? 'Save changes' : 'Save item'}</button>
        </div>
        </div>
      </section>
    </form>`
  });
  const form = $('form', m.el);
  form.addEventListener('input', () => { state.dirty = true; });

  // ---- two-step wizard: 1) photo, 2) details
  let step = 1;
  const stepPhoto = $('#stepPhoto', m.el);
  function renderStepPhoto() {
    if (!stepPhoto) return;
    const src = state.previewUrl || state.imageUrl;
    stepPhoto.innerHTML = `<span class="step-photo-thumb">${src ? `<img src="${src}" alt="">` : '<span class="muted small">None</span>'}</span>
      <span class="step-photo-meta"><strong>${src ? 'Photo ready' : 'No photo yet'}</strong><span class="muted small">${src ? 'Tap to change it, or continue below.' : 'You can add one now or later.'}</span><button type="button" class="link" data-step-go="1">Change photo</button></span>`;
  }
  function setStep(n) {
    step = n;
    $$('.step-panel', m.el).forEach(p => { p.hidden = Number(p.dataset.panel) !== n; });
    $$('.wizard-step', m.el).forEach(b => {
      const i = Number(b.dataset.step), on = i === n;
      b.classList.toggle('active', on); b.classList.toggle('done', i < n);
      on ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current');
    });
    const title = m.el.closest('.modal')?.querySelector('.modal-head h2');
    if (title) title.textContent = n === 1 ? (editing ? 'Item photo' : 'Add a photo') : (editing ? 'Edit item' : 'Add details');
    const dlg = m.el.closest('.modal'); if (dlg) dlg.scrollTop = 0;
    if (n === 2) {
      renderStepPhoto();
      if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => { const nm = form.name; if (nm && !nm.value) nm.focus(); }, 30);
    }
  }
  m.el.addEventListener('click', e => {
    const g = e.target.closest('[data-step-go]');
    if (g) { e.preventDefault(); setStep(Number(g.dataset.stepGo)); return; }
    const s = e.target.closest('.wizard-step'); if (s) setStep(Number(s.dataset.step));
  });
  setStep(editing ? 2 : 1);

  // ---- chips
  const chipSet = (el, opts, arr, { max = 99 } = {}) => {
    const draw = () => { el.innerHTML = opts.map(o => `<button type="button" class="chip small ${arr.includes(o) ? 'active' : ''}" aria-pressed="${arr.includes(o)}" data-v="${esc(o)}">${esc(o)}</button>`).join(''); };
    draw();
    el.onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; const v = b.dataset.v; const i = arr.indexOf(v); i >= 0 ? arr.splice(i, 1) : arr.length < max && arr.push(v); state.dirty = true; draw(); };
  };
  // Additional colors: choose from a dropdown, remove with a tap
  const colorSel = $('#addColorSel', m.el), colorPills = $('#colorChips', m.el);
  const drawColors = () => { colorPills.innerHTML = state.colors.map(c => `<span class="pill removable"><i class="dot" style="background:${COLORS[c] || '#ccc'}"></i>${esc(c)}<button type="button" data-rmc="${esc(c)}" aria-label="Remove ${esc(c)}">×</button></span>`).join(''); };
  colorSel.onchange = () => { const v = colorSel.value; colorSel.value = ''; if (!v || state.colors.includes(v)) return; state.colors.push(v); state.dirty = true; drawColors(); };
  colorPills.onclick = e => { const b = e.target.closest('[data-rmc]'); if (!b) return; state.colors = state.colors.filter(c => c !== b.dataset.rmc); state.dirty = true; drawColors(); };
  drawColors();
  chipSet($('#seasonChips', m.el), SEASONS, state.season);
  chipSet($('#occChips', m.el), OCCASIONS, state.occasions);

  const drawTags = () => {
    $('#tagList', m.el).innerHTML = state.tags.map(t => `<span class="tag">${esc(t)}<button type="button" data-rm="${esc(t)}" aria-label="Remove tag ${esc(t)}">×</button></span>`).join('');
  };
  drawTags();
  $('#tagList', m.el).onclick = e => { const b = e.target.closest('[data-rm]'); if (b) { state.tags = state.tags.filter(t => t !== b.dataset.rm); state.dirty = true; drawTags(); } };
  const tagInput = $('#tagInput', m.el);
  const addTag = () => { const v = tagInput.value.trim().replace(/,$/, ''); if (v && !state.tags.some(t => t.toLowerCase() === v.toLowerCase())) { state.tags.push(v); state.dirty = true; drawTags(); } tagInput.value = ''; };
  tagInput.onkeydown = e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } else if (e.key === 'Backspace' && !tagInput.value && state.tags.length) { state.tags.pop(); drawTags(); } };
  tagInput.onblur = addTag;

  // ---- category/subcategory
  const syncSubs = () => {
    const c = form.category.value;
    $('#customCatWrap', m.el).hidden = c !== '＋ Custom…';
    $('#subList', m.el).innerHTML = (CATEGORIES[c] || []).map(s => `<option value="${esc(s)}">`).join('');
  };
  form.category.onchange = () => { syncSubs(); if (form.category.value !== '＋ Custom…') form.subcategory.value = form.subcategory.value && (CATEGORIES[form.category.value] || []).includes(form.subcategory.value) ? form.subcategory.value : ''; };
  syncSubs();

  // ---- image handling
  const preview = $('#imgPreview', m.el), tools = $('#imgTools', m.el), imgErr = $('#imgErr', m.el);
  const bgBtn = $('#bgRemoveBtn', m.el), bgTolRow = $('#bgTolRow', m.el), bgTolIn = $('#bgTol', m.el);
  const syncBgUI = () => { const on = !!state.edit.bgRemove; bgBtn.classList.toggle('active', on); bgBtn.setAttribute('aria-pressed', String(on)); bgTolRow.hidden = !on; bgTolIn.value = state.edit.bgTol; };
  const showErr = msg => { imgErr.hidden = !msg; imgErr.textContent = msg || ''; };
  let renderToken = 0;
  async function refreshPreview() {
    showErr('');
    if (state.source === 'none' || (!state.img && !state.blob && !state.imageUrl)) {
      if (state.previewUrl) { URL.revokeObjectURL(state.previewUrl); state.previewUrl = ''; }
      preview.innerHTML = '<div class="img-empty">No image yet</div>'; tools.hidden = true; renderStepPhoto(); return;
    }
    if (state.img) {
      const token = ++renderToken;
      try {
        const b = await renderEdited(state.img, state.edit, 700);
        if (token !== renderToken) return;
        if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
        state.previewUrl = URL.createObjectURL(b);
        preview.innerHTML = `<img src="${state.previewUrl}" alt="Preview of the garment">`;
        tools.hidden = false; renderStepPhoto();
      } catch (e) { showErr('Could not render preview.'); }
    } else {
      if (state.previewUrl) { URL.revokeObjectURL(state.previewUrl); state.previewUrl = ''; }
      const src = state.blob ? (state.previewUrl = URL.createObjectURL(state.blob)) : state.imageUrl;
      preview.innerHTML = `<img src="${src}" alt="Current image">`;
      tools.hidden = true; renderStepPhoto();
    }
  }
  async function setBlob(blob) {
    const err = validateImageFile(blob);
    if (err) { showErr(err); return; }
    try {
      const fname = blob.name || '';
      blob = await normalizeBlob(blob);
      state.img = await blobToImage(blob);
      state.blob = blob; state.imageUrl = ''; state.dirtyImage = true; state.dirty = true;
      state.edit = { rotate: 0, zoom: 1, offX: 0, offY: 0, frame: 'free', bgRemove: false, bgTol: 40 };
      ['zoom', 'offX', 'offY'].forEach(k => $('#' + k, m.el).value = state.edit[k]);
      $('#frameSel', m.el).value = 'free';
      syncBgUI();
      if (!form.name.value.trim() && fname && fname !== 'image') form.name.value = fname.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
      refreshPreview();
    } catch (e) { showErr('That file does not look like a valid image.'); }
  }
  const cropPicked = file => openImageCropper(file, { onDone: b => setBlob(new File([b], 'image', { type: b.type || 'image/png' })) });
  const panel = $('#srcPanel', m.el);
  function setSource(s) {
    state.source = s;
    $$('.seg-btn', m.el).forEach(b => b.classList.toggle('active', b.dataset.src === s || (s === 'keep' && b.dataset.src === 'upload')));
    if (s === 'upload' || s === 'keep') {
      panel.innerHTML = `<label class="dropzone" id="upDrop" tabindex="0"><strong>${state.blob || state.imageUrl ? 'Replace image' : 'Upload a photo'}</strong><span>Click to choose a file, drop an image here, or press <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>V</kbd> to paste</span><input type="file" accept="image/jpeg,image/png,image/webp" hidden id="fileIn"></label>`;
      const drop = $('#upDrop', m.el), file = $('#fileIn', m.el);
      const start = f => { if (f) cropPicked(f); file.value = ''; };
      file.onchange = e => start(e.target.files[0]);
      drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
      ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) start(f); });
    } else if (s === 'camera') {
      panel.innerHTML = `<label class="btn ghost file-btn">Take a photo<input type="file" accept="image/*" capture="environment" hidden id="camIn"></label><span class="muted small"> Opens your camera on supported devices</span>`;
      $('#camIn', m.el).onchange = e => { const f = e.target.files[0]; if (f) setBlob(f); e.target.value = ''; };
    } else if (s === 'url') {
      panel.innerHTML = `<div class="url-row"><input type="url" id="urlIn" placeholder="https://…/garment.png" aria-label="Image URL"><button type="button" class="btn ghost" id="urlGo">Load</button></div>`;
      $('#urlGo', m.el).onclick = async () => {
        const url = $('#urlIn', m.el).value.trim();
        if (!/^https?:\/\//i.test(url)) { showErr('Please enter a valid http(s) image URL.'); return; }
        try {
          const res = await fetch(url, { mode: 'cors' });
          if (!res.ok) throw new Error('bad');
          const b = await res.blob();
          await setBlob(new File([b], 'image', { type: b.type }));
        } catch {
          try { await loadImage(url.replace(/^/, '')); state.img = null; state.blob = null; state.imageUrl = url; state.dirtyImage = true; state.dirty = true; refreshPreview(); showErr('That site blocks copying, so the image is linked rather than saved. For permanent storage, download it and upload the file.'); }
          catch { showErr('That URL could not be loaded as an image.'); }
        }
      };
    } else {
      panel.innerHTML = '<p class="muted small">This item will be saved without an image and shown with a neutral placeholder.</p>';
      state.img = null; state.blob = null; state.imageUrl = ''; state.dirtyImage = true; refreshPreview();
    }
  }
  $$('.seg-btn', m.el).forEach(b => b.onclick = () => setSource(b.dataset.src));
  setSource(state.source);
  m.el.addEventListener('paste', e => {
    if (step !== 1) return;
    const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); cropPicked(f); }
  });
  if (state.blob || state.imageUrl) {
    refreshPreview();
    if (state.blob) blobToImage(state.blob).then(i => { state.img = i; }).catch(() => {});
  }
  syncBgUI();

  const edit = patch => { Object.assign(state.edit, patch); state.dirty = state.dirtyImage = true; refreshPreview(); };
  // Make sure edits to an existing image work: load img lazily
  const ensureImg = async () => { if (!state.img && state.blob) state.img = await blobToImage(state.blob); };
  $$('[data-rot]', m.el).forEach(b => b.onclick = async () => { await ensureImg(); if (state.img) edit({ rotate: (state.edit.rotate + Number(b.dataset.rot) + 360) % 360 }); });
  $('#zoom', m.el).oninput = async e => { await ensureImg(); edit({ zoom: +e.target.value }); };
  $('#offX', m.el).oninput = async e => { await ensureImg(); edit({ offX: +e.target.value }); };
  $('#offY', m.el).oninput = async e => { await ensureImg(); edit({ offY: +e.target.value }); };
  $('#frameSel', m.el).onchange = async e => { await ensureImg(); edit({ frame: e.target.value }); };
  bgBtn.onclick = async () => { await ensureImg(); if (!state.img) return; edit({ bgRemove: !state.edit.bgRemove }); syncBgUI(); };
  bgTolIn.oninput = async e => { await ensureImg(); edit({ bgTol: +e.target.value }); };
  $('#resetImg', m.el).onclick = () => { state.edit = { rotate: 0, zoom: 1, offX: 0, offY: 0, frame: 'free', bgRemove: false, bgTol: 40 }; ['zoom', 'offX', 'offY'].forEach(k => $('#' + k, m.el).value = state.edit[k]); $('#frameSel', m.el).value = 'free'; syncBgUI(); refreshPreview(); };
  // Existing image (kept blob) can be edited too
  if (existing?.imageBlob) tools.hidden = false;

  // ---- submit
  const submitForm = async e => {
    if (e) e.preventDefault();
    if (step === 1) { setStep(2); return; }
    if (state.saving) return;
    $$('[data-err]', m.el).forEach(x => x.textContent = '');
    const errors = {};
    const name = form.name.value.trim();
    if (!name) errors.name = 'Please give this item a name.';
    let category = form.category.value;
    if (category === '＋ Custom…') {
      category = form.customCategory.value.trim();
      if (!category) errors.customCategory = 'Enter a category name.';
    }
    const price = form.price.value === '' ? null : Number(form.price.value);
    if (price !== null && (isNaN(price) || price < 0)) errors.price = 'Enter a valid price.';
    if (Object.keys(errors).length) {
      Object.entries(errors).forEach(([k, v]) => { const el = $(`[data-err="${k}"]`, m.el); if (el) el.textContent = v; });
      const first = form.querySelector('.err:not(:empty)'); first?.closest('.field')?.querySelector('input,select')?.focus();
      return;
    }
    state.saving = true; $('#saveBtn', m.el).disabled = true;
    try {
      let imageBlob = state.blob, imageUrl = state.imageUrl;
      if (state.img && (state.dirtyImage || !existing)) {
        const e2 = state.edit; const changed = e2.rotate || e2.zoom !== 1 || e2.offX || e2.offY || e2.frame !== 'free' || e2.bgRemove;
        imageBlob = changed ? await renderEdited(state.img, e2) : state.blob;
      } else if (state.source === 'none') { imageBlob = null; imageUrl = ''; }
      const main = form.mainColor.value;
      const colors = [...new Set([...(main ? [main] : []), ...state.colors])];
      const data = {
        name, brand: form.brand.value.trim(), category, subcategory: form.subcategory.value.trim(),
        imageBlob: imageBlob || null, imageUrl: imageBlob ? '' : imageUrl,
        colors, season: [...state.season], occasions: [...state.occasions], tags: [...state.tags],
        notes: form.notes.value.trim(), favorite: form.favorite.checked, purchasePrice: price, purchaseDate: form.date.value
      };
      const saved = editing ? await db.updateItem(existing.id, data) : await db.addItem(data);
      state.dirty = false; m.close(true);
      toast(editing ? 'Changes saved' : 'Item added to your closet', 'success');
      onSaved && onSaved(saved);
    } catch (err) {
      console.error(err);
      toast('Could not save: ' + (err.message || 'storage error'), 'error');
      state.saving = false; $('#saveBtn', m.el).disabled = false;
    }
  };
  form.addEventListener('submit', submitForm);
  $('#saveBtn', m.el).addEventListener('click', submitForm);
  if (initialBlob) setBlob(new File([initialBlob], 'image', { type: initialBlob.type || 'image/png' }));
  return m;
}

export async function openItemDetails(itemId, { onAddToOutfit, onChanged } = {}) {
  let item = await db.getItem(itemId);
  if (!item) { toast('That item no longer exists', 'error'); return; }
  const m = openModal({ title: 'Item details', className: 'wide', body: '' });
  const draw = () => {
    const cs = (item.colors || []);
    const chips = (arr, cls = '') => arr?.length ? arr.map(x => `<span class="pill ${cls}">${esc(x)}</span>`).join('') : '<span class="muted">—</span>';
    m.el.innerHTML = `<div class="details">
      <div class="details-img"><img src="${imgSrc(item)}" alt="${esc(item.name)}"><button class="detail-fav ${item.favorite ? 'on' : ''}" data-act="fav" aria-pressed="${!!item.favorite}" aria-label="${item.favorite ? 'Unfavorite' : 'Favorite'} ${esc(item.name)}">${icons.star}</button></div>
      <div class="details-info">
        <h3>${esc(item.name)} ${item.demo ? '<span class="badge demo inline">Sample</span>' : ''}${item.archived ? '<span class="badge arch inline">Archived</span>' : ''}</h3>
        <p class="muted">${esc(item.brand || 'No brand')}</p>
        <dl>
          <dt>Category</dt><dd>${esc(item.category)}${item.subcategory ? ' · ' + esc(item.subcategory) : ''}</dd>
          <dt>Colors</dt><dd>${cs.length ? cs.map(c => `<span class="pill"><i class="dot" style="background:${COLORS[c] || '#ccc'}"></i>${esc(c)}</span>`).join('') : '<span class="muted">—</span>'}</dd>
          <dt>Season</dt><dd>${chips(item.season)}</dd>
          <dt>Occasion</dt><dd>${chips(item.occasions)}</dd>
          <dt>Tags</dt><dd>${chips(item.tags)}</dd>
          ${item.notes ? `<dt>Notes</dt><dd>${esc(item.notes)}</dd>` : ''}
          ${item.purchasePrice != null ? `<dt>Price</dt><dd>${esc(item.purchasePrice.toFixed(2))}</dd>` : ''}
          ${item.purchaseDate ? `<dt>Purchased</dt><dd>${esc(item.purchaseDate)}</dd>` : ''}
        </dl>
        <div class="actions">
          <button class="btn primary" data-act="outfit" ${item.archived ? 'disabled title="Restore this item to use it in outfits"' : ''}>Add to outfit</button>
          <button class="btn ghost" data-act="edit">Edit</button>
          <button class="btn ghost" data-act="archive">${item.archived ? 'Restore' : 'Archive'}</button>
          <button class="btn ghost" data-act="close">Close</button>
        </div>
        <div class="details-foot"><button class="btn danger-ghost" data-act="delete">${icons.trash} Delete</button></div>
        </div></div>`;
    $$('[data-act]', m.el).forEach(b => b.onclick = () => act(b.dataset.act));
  };
  async function act(a) {
    try {
      if (a === 'close') return m.close();
      if (a === 'fav') { item = await db.updateItem(item.id, { favorite: !item.favorite }); draw(); onChanged && onChanged(); }
      if (a === 'archive') { item = await db.archiveItem(item.id, !item.archived); toast(item.archived ? 'Item archived' : 'Item restored'); draw(); onChanged && onChanged(); }
      if (a === 'edit') { m.close(true); openItemEditor(item, { onSaved: () => onChanged && onChanged() }); }
      if (a === 'outfit') { m.close(true); onAddToOutfit && onAddToOutfit(item.id); }
      if (a === 'delete') {
        const outfits = (await db.getOutfits()).filter(o => o.items.some(p => p.itemId === item.id));
        const msg = outfits.length
          ? `"${item.name}" is used in ${outfits.length} saved outfit${outfits.length > 1 ? 's' : ''} (${outfits.slice(0, 3).map(o => o.name).join(', ')}${outfits.length > 3 ? '…' : ''}). It will be removed from them. This cannot be undone.`
          : `Permanently delete "${item.name}"? This cannot be undone. You could archive it instead.`;
        if (await confirmDialog({ title: 'Delete item?', message: msg, confirmText: 'Delete', danger: true })) {
          await db.deleteItem(item.id); m.close(true); toast('Item deleted'); onChanged && onChanged();
        }
      }
    } catch (e) { console.error(e); toast('Something went wrong: ' + e.message, 'error'); }
  }
  draw();
}
