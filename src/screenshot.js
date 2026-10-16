// Image crop: paste/upload an image and crop it before adding it as an item.
import * as db from './database.js';
import { esc, $, $$, openModal, toast } from './components.js';
import { blobToImage, canvasToBlob, validateImageFile, cutoutBackground } from './image-utils.js';

const ENGINES = {
  google: ['Google Images', q => `https://www.google.com/search?tbm=isch&q=${q}`],
  bing: ['Bing Images', q => `https://www.bing.com/images/search?q=${q}`],
  ddg: ['DuckDuckGo', q => `https://duckduckgo.com/?iax=images&ia=images&q=${q}`],
  pinterest: ['Pinterest', q => `https://www.pinterest.com/search/pins/?q=${q}`]
};

// Shared crop room: loads an image into a canvas and shows the drag-a-box crop UI.
function makeCropUI({ m, onDone, onBack, onUnload }) {
  let work = null;               // canvas holding the (rotated) source
  let box = null;                // crop rect in work-canvas pixels
  let ratio = 0;                 // 0 = free, otherwise width / height

  function resetBox() {
    const W = work.width, H = work.height;
    const mw = W * .8, mh = H * .8;
    let w = mw, h = mh;
    if (ratio) { w = Math.min(mw, mh * ratio); h = w / ratio; }
    box = { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  function stepCrop() {
    m.el.innerHTML = `
      <div class="crop-bar">
        <button class="btn small ghost" data-rot="-90">⟲ Rotate</button>
        <button class="btn small ghost" data-rot="90">⟳ Rotate</button>
        <label class="inline-label">Shape <select id="cropRatio" aria-label="Crop shape">
          <option value="0">Free</option><option value="1">Square</option><option value="0.8">Portrait 4:5</option><option value="1.25">Landscape 5:4</option></select></label>
        <button class="btn small ghost" id="cropReset">Reset</button>
      </div>
      <div class="crop-area"><div class="crop-wrap" id="cropWrap"></div></div>
      <div class="crop-opts">
        <label class="check"><input type="checkbox" id="rmBg"> Make background transparent <span class="muted small">(works best on white or single-colour backgrounds)</span></label>
        <label class="range" id="tolWrap" hidden><span>Strength</span><input type="range" id="tol" min="8" max="60" value="40"></label>
      </div>
      <div class="form-actions"><button class="btn ghost" id="cropBack">Back</button><button class="btn primary" id="cropUse">Use this crop</button></div>`;
    const wrap = $('#cropWrap', m.el);
    wrap.append(work);
    wrap.insertAdjacentHTML('beforeend', `<div class="crop-box" id="cropBox" aria-label="Crop area"><span class="ch" data-h="nw"></span><span class="ch" data-h="ne"></span><span class="ch" data-h="sw"></span><span class="ch" data-h="se"></span><span class="ch edge" data-h="n"></span><span class="ch edge" data-h="s"></span><span class="ch edge" data-h="e"></span><span class="ch edge" data-h="w"></span></div>`);
    const boxEl = $('#cropBox', m.el);
    const paint = () => {
      const W = work.width, H = work.height;
      boxEl.style.cssText = `left:${box.x / W * 100}%;top:${box.y / H * 100}%;width:${box.w / W * 100}%;height:${box.h / H * 100}%`;
      boxEl.classList.toggle('locked', !!ratio);
    };
    paint();

    let drag = null;
    boxEl.addEventListener('pointerdown', e => {
      const h = e.target.dataset.h || 'move';
      drag = { h, sx: e.clientX, sy: e.clientY, b: { ...box }, k: work.width / wrap.clientWidth, pid: e.pointerId };
      boxEl.setPointerCapture(e.pointerId); e.preventDefault();
    });
    boxEl.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.pid) return;
      const dx = (e.clientX - drag.sx) * drag.k, dy = (e.clientY - drag.sy) * drag.k;
      const W = work.width, H = work.height, b = drag.b, min = 24;
      let { x, y, w, h } = b;
      if (drag.h === 'move') { x = Math.min(W - w, Math.max(0, b.x + dx)); y = Math.min(H - h, Math.max(0, b.y + dy)); }
      else {
        let l = b.x, t = b.y, r = b.x + b.w, bt = b.y + b.h;
        if (drag.h.includes('w')) l = Math.min(r - min, Math.max(0, b.x + dx));
        if (drag.h.includes('e')) r = Math.max(l + min, Math.min(W, b.x + b.w + dx));
        if (drag.h.includes('n')) t = Math.min(bt - min, Math.max(0, b.y + dy));
        if (drag.h.includes('s')) bt = Math.max(t + min, Math.min(H, b.y + b.h + dy));
        w = r - l; h = bt - t; x = l; y = t;
        if (ratio && drag.h.length === 2) {            // corner: keep the shape, width leads
          const fromLeft = drag.h.includes('w'), fromTop = drag.h.includes('n');
          const ax = fromLeft ? b.x + b.w : b.x, ay = fromTop ? b.y + b.h : b.y;   // fixed anchor corner
          const maxW = Math.min(fromLeft ? ax : W - ax, (fromTop ? ay : H - ay) * ratio);
          w = Math.max(min, Math.min(w, maxW)); h = w / ratio;
          x = fromLeft ? ax - w : ax; y = fromTop ? ay - h : ay;
        }
      }
      box = { x, y, w, h }; paint();
    });
    const end = () => { drag = null; };
    boxEl.addEventListener('pointerup', end); boxEl.addEventListener('pointercancel', end);

    $$('[data-rot]', m.el).forEach(b => b.onclick = () => { rotate(Number(b.dataset.rot)); stepCrop(); });
    $('#cropRatio', m.el).value = String(ratio);
    $('#cropRatio', m.el).onchange = e => { ratio = Number(e.target.value); resetBox(); paint(); };
    $('#cropReset', m.el).onclick = () => { resetBox(); paint(); };
    $('#rmBg', m.el).onchange = e => { $('#tolWrap', m.el).hidden = !e.target.checked; };
    $('#cropBack', m.el).onclick = onBack || (() => m.close(true));
    $('#cropUse', m.el).onclick = use;
  }

  function rotate(deg) {
    const c = document.createElement('canvas'); c.width = work.height; c.height = work.width;
    const ctx = c.getContext('2d'); ctx.translate(c.width / 2, c.height / 2); ctx.rotate(deg * Math.PI / 180); ctx.drawImage(work, -work.width / 2, -work.height / 2);
    work = c; resetBox();
  }

  async function use() {
    try {
      const out = document.createElement('canvas');
      const s = Math.min(1, 1400 / Math.max(box.w, box.h));
      out.width = Math.max(1, Math.round(box.w * s)); out.height = Math.max(1, Math.round(box.h * s));
      out.getContext('2d').drawImage(work, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height);
      const cut = $('#rmBg', m.el).checked ? await cutoutBackground(out, Number($('#tol', m.el).value)) : out;
      const blob = await canvasToBlob(cut);
      m.close(true); onDone && onDone(blob);
    } catch (e) { console.error(e); toast('Could not crop that image: ' + e.message, 'error'); }
  }

  async function load(file) {
    const problem = validateImageFile(file.type ? file : new File([file], 'x.png', { type: 'image/png' }));
    if (problem) return onUnload && onUnload(problem);
    try {
      const img = await blobToImage(file);
      const max = 2400, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      work = document.createElement('canvas'); work.width = Math.round(img.naturalWidth * s); work.height = Math.round(img.naturalHeight * s);
      work.getContext('2d').drawImage(img, 0, 0, work.width, work.height);
      ratio = 0; resetBox(); stepCrop();
    } catch (e) { onUnload && onUnload('That file could not be read as an image.'); }
  }

  return { load };
}

// Full screenshot flow: search launcher, then paste/upload and crop.
export function openScreenshotCropper({ onDone }) {
  let err = () => {};
  const m = openModal({
    title: 'Add from screenshot', className: 'wide', body: '',
    onClose: () => document.removeEventListener('paste', onPaste)
  });
  const crop = makeCropUI({
    m, onDone,
    onBack: stepSource,
    onUnload: msg => err(typeof msg === 'string' ? msg : (msg && msg.message) || 'Could not read that image.')
  });

  // ---------- step 1: find + load a screenshot ----------
  function stepSource() {
    const engine = db.settings.get('searchEngine', 'google');
    m.el.innerHTML = `
      <div class="shot-grid">
        <div>
          <h3 class="shot-h">1. Find the item</h3>
          <form class="shot-search" id="shotSearch">
            <select id="shotEngine" aria-label="Search site">${Object.entries(ENGINES).map(([k, v]) => `<option value="${k}" ${k === engine ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>
            <input type="search" id="shotQ" placeholder="e.g. black leather ankle boots" aria-label="Search the web" autocomplete="off">
            <button class="btn primary" type="submit">Search</button>
          </form>
          <p class="muted small">Opens in a new tab. Websites can't be shown inside the app, so you bring the image back with a screenshot.</p>
          <h3 class="shot-h">2. Take a screenshot</h3>
          <ul class="shot-tips muted small">
            <li>Windows: <kbd>Win</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd></li>
            <li>Mac: <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>4</kbd> (add <kbd>Ctrl</kbd> to copy it)</li>
            <li>Phone: use your normal screenshot buttons, then upload it</li>
          </ul>
        </div>
        <div>
          <h3 class="shot-h">3. Paste or upload it</h3>
          <label class="dropzone" id="drop" tabindex="0">
            <strong>Paste a screenshot</strong>
            <span>press <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>V</kbd>, drop an image here, or click to choose a file</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden id="shotFile">
          </label>
          <p class="error" id="shotErr" role="alert" hidden></p>
        </div>
      </div>`;
    err = msg => { const e = $('#shotErr', m.el); e.hidden = !msg; e.textContent = msg || ''; };
    $('#shotSearch', m.el).onsubmit = e => {
      e.preventDefault();
      const q = $('#shotQ', m.el).value.trim(); const key = $('#shotEngine', m.el).value;
      if (!q) { $('#shotQ', m.el).focus(); return; }
      db.settings.set('searchEngine', key);
      window.open(ENGINES[key][1](encodeURIComponent(q)), '_blank', 'noopener,noreferrer');
    };
    const drop = $('#drop', m.el), file = $('#shotFile', m.el);
    file.onchange = e => { if (e.target.files[0]) crop.load(e.target.files[0]); e.target.value = ''; };
    drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
    ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) crop.load(f); });
    setTimeout(() => $('#shotQ', m.el)?.focus(), 40);
  }

  function onPaste(e) {
    if (!m.el.isConnected || !$('#drop', m.el)) return;
    const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); crop.load(f); }
  }
  document.addEventListener('paste', onPaste);
  stepSource();
  return m;
}

// Direct crop: opens the crop UI for an image the user uploaded or pasted.
export function openImageCropper(file, { onDone } = {}) {
  const m = openModal({
    title: 'Crop photo', className: 'wide', body: '',
    onClose: () => document.removeEventListener('paste', onPaste)
  });
  const crop = makeCropUI({
    m, onDone,
    onBack: () => m.close(true),
    onUnload: msg => { toast(typeof msg === 'string' ? msg : (msg && msg.message) || 'Could not read that image.', 'error'); m.close(true); }
  });
  function onPaste(e) {
    const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); crop.load(f); }
  }
  document.addEventListener('paste', onPaste);
  crop.load(file);
  return m;
}