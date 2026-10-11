import * as db from './database.js';
import { esc, $, $$, openModal, confirmDialog, toast, icons } from './components.js';
import { exportBackup, importBackup } from './backup.js';
import * as auto from './autobackup.js';
import * as gdrive from './gdrive.js';

const prefs = db.settings;
const VERSION = 'alpha 0.3.1';
const PREF_KEYS = ['theme', 'startMode', 'dressMode', 'searchEngine'];

// ---- Appearance: 'system' follows the device; the CSS only needs data-theme="dark" | "light"
const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme() {
  const t = prefs.get('theme', 'system');
  const dark = t === 'dark' || (t === 'system' && !!(mq && mq.matches));
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}
export function initAppearance() {
  applyTheme();
  if (mq && mq.addEventListener) mq.addEventListener('change', applyTheme);
}

const fmtBytes = n => n == null ? '—' : n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';

const sIco = (main, badge, pos = 'br') => `<span class="s-ico">${main}${badge ? `<span class="s-ico-badge ${pos}">${badge}</span>` : ''}</span>`;
const sTitle = (icon, label) => `<h2 class="s-title">${icon}<span>${label}</span></h2>`;

function typedConfirm({ title, message, word = 'DELETE', button = 'Delete everything' }) {
  return new Promise(resolve => {
    let done = false;
    const m = openModal({
      title, className: 'small',
      body: `<p class="muted">${esc(message)}</p><label class="field"><span>Type ${word} to confirm</span><input id="tc" autocomplete="off" autofocus></label>
        <div class="form-actions"><button class="btn ghost" data-no>Cancel</button><button class="btn danger" data-yes disabled>${esc(button)}</button></div>`,
      onClose: () => { if (!done) resolve(false); }
    });
    const inp = $('#tc', m.el), yes = $('[data-yes]', m.el);
    inp.oninput = () => { yes.disabled = inp.value.trim() !== word; };
    $('[data-no]', m.el).onclick = () => { done = true; m.close(true); resolve(false); };
    yes.onclick = () => { done = true; m.close(true); resolve(true); };
  });
}

export function createSettings(root, { onRemoveDemo } = {}) {
  let page = 'main';
  const radios = (name, value, opts) => `<div class="radios" role="radiogroup" aria-label="${name}">${opts.map(([v, l]) =>
    `<label class="radio"><input type="radio" name="${name}" value="${v}" ${v === value ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
  const row = (label, desc, control, cls = '') => `<div class="s-row ${cls}"><div><strong>${label}</strong>${desc ? `<p class="muted small">${desc}</p>` : ''}</div>${control ? `<div>${control}</div>` : ''}</div>`;

  async function renderMain() {
    let items = [], outfits = [], info = { supported: false, persisted: false, usage: null };
    try { [items, outfits] = await Promise.all([db.getItems(), db.getOutfits()]); } catch (e) { console.error(e); }
    try { info = await db.storageInfo(); } catch { /* unsupported */ }
    const theme = prefs.get('theme', 'system'), startMode = prefs.get('startMode', 'ask'), dice = prefs.get('dressMode', 'random') === 'color' ? 'color' : 'random';
    const hasDemo = items.some(i => i.demo) || outfits.some(o => o.demo);
    const photos = items.filter(i => i.imageBlob).length;
    const autoSup = auto.supported();
    const autoMeta = auto.meta();
    const autoPerm = autoSup && autoMeta ? await auto.perm() : 'none';
    const autoRow = !autoSup
      ? row('Auto-backup to a file', 'This browser can’t link a file. Use Export backup above, or open Atelier in Chrome or Edge on a computer.', '')
      : (autoMeta && autoPerm !== 'none')
        ? row(`Saved to ${esc(autoMeta.name || 'backup file')}`,
            `${autoMeta.savedAt ? `Last saved ${new Date(autoMeta.savedAt).toLocaleString()}. ` : ''}${autoPerm === 'granted' ? 'Atelier re-saves this file whenever your closet changes.' : 'Your browser needs permission again before it can save. Click Reconnect.'}`,
            autoPerm === 'granted'
              ? '<button class="btn" data-act="autoSave">Save now</button> <button class="btn danger-ghost" data-act="autoUnlink">Unlink</button>'
              : '<button class="btn primary" data-act="autoReconnect">Reconnect</button> <button class="btn danger-ghost" data-act="autoUnlink">Unlink</button>')
        : row('Auto-backup to a file',
            'Pick a file inside a cloud-synced folder (iCloud Drive, OneDrive, Google Drive). Atelier re-saves it whenever your closet changes, so another device can pick it up.',
            '<button class="btn" data-act="autoLink">Link a file…</button>');
    const gdriveOk = gdrive.configured();
    gdrive.preload();
    const lastSync = gdrive.lastSync();
    const driveRow = gdriveOk
      ? row('Google Drive',
          lastSync ? `Last synced ${new Date(lastSync).toLocaleString()}.` : 'Not synced on this device yet. Press Sync to upload and merge.',
          '<button class="btn primary" data-act="gsync">Sync now</button> <button class="btn danger-ghost" data-act="gdisconnect">Disconnect</button>')
      : row('Connect Google Drive', 'Paste your Google OAuth Client ID to turn on sync.',
          `<div class="inline-field"><input id="gclient" placeholder="Client ID…" value="${esc(gdrive.clientId())}" aria-label="Google client ID" autocomplete="off"><button class="btn" data-act="gsave">Save</button></div>`);
    root.innerHTML = `<div class="settings">
      <div class="page-head"><div><h1>Settings</h1><p class="muted">Everything stays privately on this device.</p></div></div>

      <section class="s-card">${sTitle(sIco(icons.palette), 'Appearance')}
        ${row('Theme', 'Follow your device, or pick light or dark.', radios('theme', theme, [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]))}
      </section>

      <section class="s-card">${sTitle(sIco(icons.shirt, icons.sparkle, 'tr'), 'Outfit Builder')}
        ${row('When I open it', 'Show the two options each time, or jump straight into one.', radios('startMode', startMode, [['ask', 'Ask me'], ['dress', 'Dress me'], ['canvas', 'Canvas']]))}
        ${row('Dice mode', 'How the dice picks pieces in Dress me.', radios('dressMode', dice, [['random', 'Random'], ['color', 'Color match']]))}
      </section>

      <section class="s-card">${sTitle(sIco(icons.database), 'Photos and data')}
        ${row('Saved on this device', `${items.length} item${items.length === 1 ? '' : 's'} (${photos} with photos) and ${outfits.length} outfit${outfits.length === 1 ? '' : 's'}. Photos you add or upload stay here between launches until you delete them.${info.usage != null ? ` Using ${fmtBytes(info.usage)}.` : ''}`, '')}
        ${row('Keep it safe', info.persisted ? '<span class="ok-text">Protected.</span> Your browser will not clear your closet automatically.' : info.supported ? 'Browsers can clear site data when storage runs low. Ask yours to keep it, and make a backup file for extra safety.' : 'This browser cannot guarantee storage. Make backups to be safe.', info.supported && !info.persisted ? '<button class="btn" data-act="persist">Protect my data</button>' : '')}
        <div class="s-actions"><button class="btn" data-act="export">Export backup</button><button class="btn" data-act="import">Import backup</button><input type="file" id="importFile" accept="application/json,.json" hidden>
          ${hasDemo ? '<button class="btn" data-act="demo">Remove sample content</button>' : ''}</div>
        <p class="muted small">A backup is one file with your items, photos and outfits. When importing you can merge it into this device or replace everything with it.</p>
        <div class="s-div"></div>
        ${row('Delete all outfits', 'Your clothing items are kept.', `<button class="btn danger-ghost" data-act="delOutfits" ${outfits.length ? '' : 'disabled'}>Delete outfits</button>`)}
        ${row('Delete everything', 'Removes all items, photos and outfits from this device. You can delete a single item from its card in the closet.', `<button class="btn danger-ghost" data-act="delAll" ${items.length || outfits.length ? '' : 'disabled'}>Delete everything</button>`)}
        ${row('Reset preferences', 'Theme, start mode and dice mode return to defaults. Your data is untouched.', '<button class="btn" data-act="reset">Reset</button>')}
      </section>

      <section class="s-card">${sTitle(sIco(icons.refresh), 'Automatic backup')}
        ${autoRow}
        <p class="muted small">Keeps one backup file up to date automatically. On another device, open Atelier and use Import backup with that same file.</p>
      </section>

      <section class="s-card">${sTitle(sIco(icons.cloud, icons.refresh), 'Cloud sync')}
        ${driveRow}
        <p class="muted small">Sync keeps your closet in a hidden app-data file inside your own Google Drive — nothing is sent to us. It merges this device with the Drive copy, most recent change winning, so you can move between different devices.</p>
        <details><summary>How to get a Client ID</summary><p class="muted small">In Google Cloud Console, create a project, enable the “Google Drive API”, then create an OAuth client ID of type “Web application”. Under <em>Authorized JavaScript origins</em> add your site (e.g. http://localhost:8080 and your GitHub Pages URL). Paste the client ID above.</p></details>
      </section>

      <section class="s-card">${sTitle(sIco(icons.question), 'Help')}
        <details><summary>Canvas controls</summary><p class="muted small">Drag a piece to move it and drag the round handle to resize. With a piece focused: arrow keys nudge (Shift for bigger steps), + and − resize, R rotates, [ and ] change layers, Delete removes. Pin a piece to keep it when you press Shuffle.</p></details>
        <details><summary>Dress me tips</summary><p class="muted small">Swipe a row, or press ← and → on it. The piece in the middle is the chosen one. Pin a row so the dice skips it. Color match works best when your items have colors.</p></details>
        <details><summary>Adding items from the web</summary><p class="muted small">In the item form, choose Upload and paste or drop a screenshot of the item — it opens in the crop view. Search the web in a new tab, screenshot the item, and paste it here.</p></details>
      </section>

      <section class="s-card">${sTitle(sIco(icons.info), 'About')}
        ${row('Atelier', `Version ${VERSION}`, '<button class="btn" data-act="about">About</button>')}
      </section></div>`;
  }

  function renderAbout() {
    root.innerHTML = `<div class="settings">
      <div><button class="link-back" data-act="back">‹ Settings</button></div>
      <section class="s-card about">
        <div class="about-logo" aria-hidden="true">a</div>
        <h3>Atelier</h3><p class="muted">Version ${VERSION}</p>
        <p>A private digital closet and outfit builder. Add your clothes once, then mix and match them into outfits.</p>
        <p class="muted small">No account. No tracking. Your photos and outfits never leave this device.</p>
        <p class="creator"><span class="muted">Created by</span> <strong>@jimboxsat</strong></p>
        <p class="muted small">Find me on all platforms under the same name.</p>
        <p class="vibe">vibe-coded with love <span aria-hidden="true">♥</span></p>
      </section></div>`;
    window.scrollTo({ top: 0 });
  }

  const render = () => (page === 'about' ? Promise.resolve(renderAbout()) : renderMain());

  let importMode = 'merge';
  function openImportDialog() {
    const m = openModal({
      title: 'Import backup', className: 'small',
      body: `<div class="imode" role="radiogroup" aria-label="Import mode">
          <label class="imode-opt"><input type="radio" name="imode" value="merge" checked><span><strong>Merge</strong><small>Add the backup and replace any items with matching IDs. Everything else on this device stays.</small></span></label>
          <label class="imode-opt"><input type="radio" name="imode" value="replace"><span><strong>Replace</strong><small>Delete everything on this device first, then load exactly what the backup contains.</small></span></label>
        </div>
        <div class="form-actions"><button class="btn ghost" data-cancel>Cancel</button><button class="btn primary" data-go autofocus>Choose file…</button></div>`
    });
    $('[data-cancel]', m.el).onclick = () => m.close(true);
    $('[data-go]', m.el).onclick = () => {
      importMode = $('[name="imode"]:checked', m.el).value;
      m.close(true);
      $('#importFile', root).click();
    };
  }

  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    try {
      if (act === 'persist') {
        const ok = await db.requestPersistence();
        toast(ok ? 'Your data is now protected.' : 'Your browser did not grant protection. Use backups to be safe.', ok ? 'success' : 'info'); await render();
      } else if (act === 'export') {
        b.disabled = true; const label = b.textContent; b.textContent = 'Preparing…';
        try { const r = await exportBackup(); toast(`Backup saved: ${r.items} items, ${r.outfits} outfits.`, 'success'); }
        finally { b.disabled = false; b.textContent = label; }
      } else if (act === 'import') { openImportDialog(); }
      else if (act === 'autoLink') {
        try { await auto.link(); toast('Backup file linked — it stays up to date.', 'success'); }
        catch (err) { if (!err || err.name !== 'AbortError') toast('Could not link the file.', 'error'); }
        await render();
      } else if (act === 'autoSave') {
        const ok = await auto.writeNow();
        toast(ok ? 'Backup file updated.' : 'Could not save — try Reconnect.', ok ? 'success' : 'error');
        await render();
      } else if (act === 'autoReconnect') {
        const ok = await auto.reconnect();
        toast(ok ? 'Backup file reconnected.' : 'Permission was not granted.', ok ? 'success' : 'error');
        await render();
      } else if (act === 'autoUnlink') {
        await auto.unlink(); toast('Auto-backup unlinked.'); await render();
      }
      else if (act === 'gsave') {
        gdrive.setClientId($('#gclient', root).value);
        toast(gdrive.configured() ? 'Google Drive connected.' : 'Client ID cleared.', gdrive.configured() ? 'success' : 'info');
        await render();
      } else if (act === 'gsync') {
        b.disabled = true; const label = b.textContent; b.textContent = 'Syncing…';
        try { const r = await gdrive.sync(); toast(`Synced: ${r.items} items, ${r.outfits} outfits.`, 'success'); }
        catch (err) { toast(err.message || 'Sync failed', 'error'); }
        finally { b.disabled = false; b.textContent = label; }
        await render();
      } else if (act === 'gdisconnect') {
        await gdrive.disconnect(); toast('Disconnected from Google Drive.'); await render();
      }
      else if (act === 'demo') { await onRemoveDemo && onRemoveDemo(); await render(); }
      else if (act === 'delOutfits') {
        if (await confirmDialog({ title: 'Delete all outfits?', message: 'Every saved outfit will be removed. Your clothing items are kept.', confirmText: 'Delete outfits', danger: true })) {
          for (const o of await db.getOutfits()) await db.deleteOutfit(o.id);
          toast('Outfits deleted'); await render();
        }
      } else if (act === 'delAll') {
        if (await typedConfirm({ title: 'Delete everything?', message: 'All items, photos and outfits will be permanently removed from this device. Export a backup first if you might want them back.' })) {
          await db.clearAll(); toast('Everything deleted'); await render();
        }
      } else if (act === 'reset') {
        PREF_KEYS.forEach(k => { try { localStorage.removeItem('atelier:' + k); } catch { /* ignore */ } });
        applyTheme(); toast('Preferences reset'); await render();
      } else if (act === 'about') { page = 'about'; await render(); }
      else if (act === 'back') { page = 'main'; await render(); window.scrollTo({ top: 0 }); }
    } catch (err) { console.error(err); toast(err.message || 'Something went wrong', 'error'); }
  });

  root.addEventListener('change', async e => {
    const t = e.target;
    if (t.type === 'radio') {
      prefs.set(t.name, t.value);
      if (t.name === 'theme') applyTheme();
      toast('Saved'); return;
    }
    if (t.id === 'importFile') {
      const f = t.files[0]; t.value = ''; if (!f) return;
      try {
        const r = await importBackup(f, { mode: importMode });
        toast(r.mode === 'replace' ? `Replaced with ${r.items} items and ${r.outfits} outfits.` : `Imported ${r.items} items and ${r.outfits} outfits.`, 'success');
        await render();
      } catch (err) { toast(err.message || 'Import failed', 'error'); }
    }
  });

  root.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target && e.target.id === 'gclient') {
      e.preventDefault();
      const save = $('[data-act="gsave"]', root); if (save) save.click();
    }
  });

  let timer;
  db.onChange(() => {
    auto.scheduleWrite();
    clearTimeout(timer);
    timer = setTimeout(() => { if (page === 'main' && !root.hidden) renderMain(); }, 300);
  });
  render();
  return { refresh: () => { page = 'main'; return render(); } };
}
