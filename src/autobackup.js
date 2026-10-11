// Optional "linked file" auto-backup using the File System Access API (Chrome/Edge).
// Pick a file inside a cloud-synced folder; Atelier re-saves it whenever the closet changes,
// so another device can pull it with Import backup.
import { collectBackup } from './backup.js';

const META_KEY = 'atelier:autobackup';
const DB_NAME = 'atelier-files', STORE = 'handles';

export const supported = () => typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';

function openFiles() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('Could not open handle store'));
  });
}
async function withStore(mode, fn) {
  const d = await openFiles();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    let result;
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => res(result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Handle store aborted'));
  });
}
const getHandle = () => withStore('readonly', s => s.get('linked'));
const setHandle = h => withStore('readwrite', s => s.put(h, 'linked'));
const delHandle = () => withStore('readwrite', s => s.delete('linked'));

export function meta() { try { return JSON.parse(localStorage.getItem(META_KEY) || 'null'); } catch { return null; } }
function setMeta(m) { try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* ignore */ } }

export async function perm() {
  try { const h = await getHandle(); return h ? await h.queryPermission({ mode: 'readwrite' }) : 'none'; }
  catch { return 'none'; }
}

export async function writeNow() {
  const h = await getHandle(); if (!h) return false;
  if (await h.queryPermission({ mode: 'readwrite' }) !== 'granted') return false;
  const { json } = await collectBackup();
  const w = await h.createWritable(); await w.write(json); await w.close();
  setMeta({ ...(meta() || {}), name: h.name, savedAt: Date.now() });
  return true;
}

export async function link() {
  const h = await window.showSaveFilePicker({
    suggestedName: (meta() && meta().name) || 'atelier-backup.json',
    types: [{ description: 'Atelier backup', accept: { 'application/json': ['.json'] } }]
  });
  await setHandle(h);
  await writeNow();
  return h.name;
}

export async function reconnect() {
  const h = await getHandle(); if (!h) return false;
  const p = await h.requestPermission({ mode: 'readwrite' });
  if (p !== 'granted') return false;
  await writeNow();
  return true;
}

export async function unlink() {
  try { await delHandle(); } catch { /* ignore */ }
  try { localStorage.removeItem(META_KEY); } catch { /* ignore */ }
}

let timer;
export function scheduleWrite() {
  if (!meta()) return;
  clearTimeout(timer);
  timer = setTimeout(async () => { try { await writeNow(); } catch (e) { console.error('auto-backup failed', e); } }, 4000);
}
