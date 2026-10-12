// IndexedDB layer: items, outfits. Blobs are stored directly in item records.
const DB_NAME = 'atelier-closet';
const DB_VERSION = 1;
let dbPromise;
const listeners = new Set();

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(kind) { listeners.forEach(fn => { try { fn(kind); } catch (e) { console.error(e); } }); }

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('outfits')) db.createObjectStore('outfits', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Could not open database'));
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

// ---- Items
export async function addItem(data) {
  const now = Date.now();
  const item = {
    id: uid(), name: '', brand: '', category: 'Other', subcategory: '', imageBlob: null, imageUrl: '',
    colors: [], season: [], occasions: [], tags: [], notes: '', favorite: false, archived: false,
    purchasePrice: null, purchaseDate: '', demo: false, wearCount: 0, createdAt: now, updatedAt: now, ...data
  };
  await tx('items', 'readwrite', s => s.put(item));
  emit('items');
  return item;
}
export const getItems = () => tx('items', 'readonly', s => s.getAll()).then(r => r || []);
export const getItem = id => tx('items', 'readonly', s => s.get(id));
export async function updateItem(id, patch) {
  const cur = await getItem(id);
  if (!cur) throw new Error('Item no longer exists');
  const next = { ...cur, ...patch, id, updatedAt: Date.now() };
  await tx('items', 'readwrite', s => s.put(next));
  emit('items');
  return next;
}
export const archiveItem = (id, archived = true) => updateItem(id, { archived });
export async function deleteItem(id) {
  await tx('items', 'readwrite', s => s.delete(id));
  // Safely remove placements from outfits
  const outfits = await getOutfits();
  for (const o of outfits) {
    if (o.items.some(p => p.itemId === id)) {
      o.items = o.items.filter(p => p.itemId !== id);
      o.updatedAt = Date.now();
      o.previewImage = null;
      await tx('outfits', 'readwrite', s => s.put(o));
    }
  }
  emit('items'); emit('outfits');
}

// ---- Outfits
export async function addOutfit(data) {
  const now = Date.now();
  const o = { id: uid(), name: 'Untitled outfit', items: [], occasion: '', tags: [], notes: '', demo: false, createdAt: now, updatedAt: now, previewImage: null, ...data };
  await tx('outfits', 'readwrite', s => s.put(o));
  emit('outfits');
  return o;
}
export const getOutfits = () => tx('outfits', 'readonly', s => s.getAll()).then(r => r || []);
export const getOutfit = id => tx('outfits', 'readonly', s => s.get(id));
export async function updateOutfit(id, patch) {
  const cur = await getOutfit(id);
  if (!cur) throw new Error('Outfit no longer exists');
  const next = { ...cur, ...patch, id, updatedAt: Date.now() };
  await tx('outfits', 'readwrite', s => s.put(next));
  emit('outfits');
  return next;
}
export async function deleteOutfit(id) { await tx('outfits', 'readwrite', s => s.delete(id)); emit('outfits'); }
export async function duplicateOutfit(id) {
  const o = await getOutfit(id);
  if (!o) throw new Error('Outfit not found');
  const { id: _i, ...rest } = o;
  return addOutfit({ ...rest, name: o.name + ' (copy)', demo: false, items: o.items.map(p => ({ ...p })) });
}

export async function removeDemoContent() {
  const items = await getItems();
  const outfits = await getOutfits();
  const demoItemIds = new Set(items.filter(i => i.demo).map(i => i.id));
  for (const o of outfits) {
    if (o.demo) await tx('outfits', 'readwrite', s => s.delete(o.id));
    else if (o.items.some(p => demoItemIds.has(p.itemId))) {
      o.items = o.items.filter(p => !demoItemIds.has(p.itemId)); o.previewImage = null;
      await tx('outfits', 'readwrite', s => s.put(o));
    }
  }
  for (const id of demoItemIds) await tx('items', 'readwrite', s => s.delete(id));
  emit('items'); emit('outfits');
}

// ---- Bulk / maintenance
function bulk(fn) {
  return open().then(db => new Promise((res, rej) => {
    const t = db.transaction(['items', 'outfits'], 'readwrite');
    fn(t.objectStore('items'), t.objectStore('outfits'));
    t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Transaction aborted'));
  }));
}
export async function bulkPut(items = [], outfits = []) {
  await bulk((si, so) => { items.forEach(i => si.put(i)); outfits.forEach(o => so.put(o)); });
  emit('items'); emit('outfits');
}
export async function clearAll() { await bulk((si, so) => { si.clear(); so.clear(); }); emit('items'); emit('outfits'); }
export async function replaceAll(items = [], outfits = []) {
  await bulk((si, so) => { si.clear(); so.clear(); items.forEach(i => si.put(i)); outfits.forEach(o => so.put(o)); });
  emit('items'); emit('outfits');
}
export async function requestPersistence() { try { return !!(await navigator.storage?.persist?.()); } catch { return false; } }
export async function storageInfo() {
  const out = { supported: !!navigator.storage, persisted: false, usage: null, quota: null };
  try { out.persisted = !!(await navigator.storage.persisted()); const e = await navigator.storage.estimate(); out.usage = e.usage; out.quota = e.quota; } catch { /* unsupported */ }
  return out;
}

// ---- Settings (LocalStorage)
export const settings = {
  get(k, d = null) { try { const v = localStorage.getItem('atelier:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('atelier:' + k, JSON.stringify(v)); } catch { /* ignore */ } }
};

// ---- Profile: the nickname used in greetings. Synced with backups by updatedAt.
export function getProfile() {
  const p = settings.get('profile', null);
  return (p && typeof p === 'object')
    ? { nickname: typeof p.nickname === 'string' ? p.nickname : '', updatedAt: Number(p.updatedAt) || 0 }
    : { nickname: '', updatedAt: 0 };
}
export function setProfile(profile = {}) {
  const nickname = typeof profile.nickname === 'string' ? profile.nickname : '';
  settings.set('profile', { nickname, updatedAt: Number(profile.updatedAt) || Date.now() });
  emit('profile');
}
