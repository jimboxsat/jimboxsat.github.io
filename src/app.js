import * as db from './database.js';
import { $, $$, openModal, confirmDialog, toast } from './components.js';
import { createCloset } from './closet.js';
import { createOutfitBuilder } from './outfit-builder.js';
import { createDressMe } from './dress-me.js';
import { createSettings, initAppearance } from './settings.js';
import { loadDemoContent } from './demo.js';

initAppearance();
db.requestPersistence();   // ask the browser to keep photos and outfits between launches

const views = { closet: $('#view-closet'), outfits: $('#view-outfits'), settings: $('#view-settings') };
const settingsBtn = $('#settingsBtn');
let current = 'closet', obMode = 'chooser';

// ---------- Outfit Builder shell: chooser + two modes ----------
const mini = {
  dress: '<svg viewBox="0 0 120 90" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><rect x="6" y="6" width="26" height="24" rx="5"/><rect x="47" y="4" width="26" height="28" rx="5"/><rect x="88" y="6" width="26" height="24" rx="5"/><rect x="6" y="36" width="26" height="24" rx="5"/><rect x="47" y="34" width="26" height="28" rx="5"/><rect x="88" y="36" width="26" height="24" rx="5"/><rect x="26" y="68" width="68" height="18" rx="9"/></g><circle cx="60" cy="77" r="3.5" fill="currentColor"/></svg>',
  canvas: '<svg viewBox="0 0 120 90" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M40 8l-14 8 5 10 8-4v26h28V22l8 4 5-10-14-8q-12 8-26 0z"/><path d="M44 62h32l3 22H66l-6-14-6 14H41z"/><path d="M88 18l16 2-2 18-16-2z" transform="rotate(8 96 28)"/><ellipse cx="22" cy="74" rx="14" ry="7"/></g></svg>'
};
views.outfits.innerHTML = `
  <div id="ob-chooser" class="chooser">
    <h1>Outfit Builder</h1>
    <p class="muted">How do you want to put a look together?</p>
    <div class="choose-grid">
      <button class="choose-card" data-mode="dress">${mini.dress}<h2>Dress me</h2><p class="muted">Swipe through your tops, bottoms and shoes, pin favorites, and roll the dice for a random or color-matched look.</p><span class="btn primary">Open Dress me</span></button>
      <button class="choose-card" data-mode="canvas">${mini.canvas}<h2>Canvas</h2><p class="muted" id="canvas-blurb">Free-form styling board. Drag, resize and layer pieces, add accessories, and save your finished looks.</p><span class="btn primary" id="canvas-cta">Open Canvas</span></button>
    </div>
    <p class="muted small chooser-foot">Looks from both modes are kept in <button class="link" id="open-my-outfits">My Outfits</button>.</p>
  </div>
  <div id="ob-dress" hidden><div class="mode-bar"><button class="link-back" data-back>‹ Outfit modes</button></div><div id="dress-root"></div></div>
  <div id="ob-canvas" hidden><div class="mode-bar"><button class="link-back" data-back>‹ Outfit modes</button></div><div id="canvas-root"></div></div>`;

const builder = createOutfitBuilder($('#canvas-root'));
const dress = createDressMe($('#dress-root'), {
  onOpenInCanvas: async ids => { setMode('canvas'); const ok = await builder.startWith(ids); if (!ok) toast('Kept your current canvas outfit.'); }
});

function setMode(mode) {
  obMode = mode;
  $('#ob-chooser').hidden = mode !== 'chooser';
  $('#ob-dress').hidden = mode !== 'dress';
  $('#ob-canvas').hidden = mode !== 'canvas';
  if (mode === 'chooser') {
    const dirty = builder.isDirty();
    $('#canvas-blurb').textContent = dirty ? 'You have an unsaved outfit waiting on the canvas.' : 'Free-form styling board. Drag, resize and layer pieces, add accessories, and save your finished looks.';
    $('#canvas-cta').textContent = dirty ? 'Continue editing' : 'Open Canvas';
  }
  if (mode === 'dress') { dress.refresh(); requestAnimationFrame(() => dress.recenter()); }
  window.scrollTo({ top: 0 });
}
$('#ob-chooser').addEventListener('click', e => {
  const c = e.target.closest('[data-mode]'); if (c) setMode(c.dataset.mode);
});
$('#open-my-outfits').onclick = () => { setMode('canvas'); builder.showList(); };
views.outfits.addEventListener('click', e => { if (e.target.closest('[data-back]')) setMode('chooser'); });

// ---------- navigation ----------
function showView(name) {
  current = name;
  Object.entries(views).forEach(([k, el]) => { el.hidden = k !== name; });
  $$('.nav-btn').forEach(b => {
    const on = b.dataset.view === name;
    on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current');
  });
  settingsBtn.setAttribute('aria-pressed', name === 'settings' ? 'true' : 'false');
  if (name === 'outfits' && obMode === 'dress') requestAnimationFrame(() => dress.recenter());
  if (name === 'settings') settingsPage.refresh();
  window.scrollTo({ top: 0 });
}

async function loadDemo() {
  try { await loadDemoContent(); toast('Sample closet added. Remove it any time in Settings.', 'success'); }
  catch (e) { console.error(e); toast('Could not create the sample closet: ' + e.message, 'error'); }
}
async function removeDemo() {
  if (!(await confirmDialog({ title: 'Remove sample content?', message: 'This deletes the sample items and sample outfits. Your own items and outfits stay.', confirmText: 'Remove', danger: true }))) return;
  try { await db.removeDemoContent(); toast('Sample content removed'); } catch (e) { toast('Could not remove: ' + e.message, 'error'); }
}

const settingsPage = createSettings(views.settings, { onRemoveDemo: removeDemo });
const closet = createCloset(views.closet, {
  onAddToOutfit: id => { showView('outfits'); setMode('canvas'); builder.addItem(id); },
  onLoadDemo: loadDemo, onRemoveDemo: removeDemo,
  onOpenDressMe: () => { showView('outfits'); setMode('dress'); },
  onOpenCanvas: () => { showView('outfits'); setMode('canvas'); }
});

// Opening the Outfit Builder shows the two options (or jumps straight to the mode chosen in Settings).
// Work in progress is kept in memory, so leaving and coming back never loses an unsaved outfit.
function openBuilder() {
  showView('outfits');
  const pref = db.settings.get('startMode', 'ask');
  setMode(pref === 'dress' || pref === 'canvas' ? pref : 'chooser');
}
$$('.nav-btn').forEach(b => b.onclick = () => (b.dataset.view === 'outfits' ? openBuilder() : showView(b.dataset.view)));
settingsBtn.onclick = () => showView('settings');
views.outfits.addEventListener('goto-closet', () => showView('closet'));

// ---------- first launch ----------
(async function firstLaunch() {
  try {
    if (db.settings.get('welcomed')) return;
    const items = await db.getItems();
    db.settings.set('welcomed', true);
    if (items.length) return;
    const m = openModal({
      title: 'Welcome to Atelier', className: 'small', closeOnBackdrop: false,
      body: `<p class="muted">Your digital closet lives in this browser. No account needed. How would you like to begin?</p>
      <div class="form-actions col"><button class="btn primary big" data-demo autofocus>Explore a sample closet</button><button class="btn ghost big" data-empty>Start with an empty closet</button></div>`
    });
    $('[data-demo]', m.el).onclick = async () => { m.close(true); await loadDemo(); };
    $('[data-empty]', m.el).onclick = () => m.close(true);
  } catch (e) { console.error(e); }
})();
