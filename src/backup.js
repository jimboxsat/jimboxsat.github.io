// Backup and restore: one JSON file containing items (with photos), outfits and previews.
import * as db from './database.js';

const toDataUrl = blob => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error || new Error('Could not read image')); r.readAsDataURL(blob);
});
const fromDataUrl = async url => (await fetch(url)).blob();

export async function collectBackup() {
  const [items, outfits] = await Promise.all([db.getItems(), db.getOutfits()]);
  const outItems = [];
  for (const it of items) { const c = { ...it }; if (it.imageBlob instanceof Blob) c.imageBlob = await toDataUrl(it.imageBlob); outItems.push(c); }
  const outOutfits = [];
  for (const o of outfits) { const c = { ...o }; if (o.previewImage instanceof Blob) c.previewImage = await toDataUrl(o.previewImage); outOutfits.push(c); }
  const json = JSON.stringify({ app: 'atelier', version: 1, exportedAt: new Date().toISOString(), items: outItems, outfits: outOutfits });
  return { json, items: items.length, outfits: outfits.length };
}

export async function exportBackup() {
  const { json, items, outfits } = await collectBackup();
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = `atelier-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  return { items, outfits };
}

export async function parseBackupText(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not a valid Atelier backup.'); }
  if (!data || data.app !== 'atelier' || !Array.isArray(data.items) || !Array.isArray(data.outfits)) throw new Error('That file is not an Atelier backup.');
  const items = [], outfits = [];
  for (const it of data.items) {
    if (!it || typeof it.id !== 'string' || typeof it.name !== 'string') continue;
    const c = { ...it };
    c.imageBlob = typeof it.imageBlob === 'string' && it.imageBlob.startsWith('data:') ? await fromDataUrl(it.imageBlob) : null;
    items.push(c);
  }
  for (const o of data.outfits) {
    if (!o || typeof o.id !== 'string' || !Array.isArray(o.items)) continue;
    const c = { ...o };
    c.previewImage = typeof o.previewImage === 'string' && o.previewImage.startsWith('data:') ? await fromDataUrl(o.previewImage) : null;
    outfits.push(c);
  }
  return { items, outfits };
}

export async function importBackup(file, { mode = 'merge' } = {}) {
  const { items, outfits } = await parseBackupText(await file.text());
  if (mode === 'replace') await db.replaceAll(items, outfits);
  else await db.bulkPut(items, outfits);
  return { items: items.length, outfits: outfits.length, mode };
}
