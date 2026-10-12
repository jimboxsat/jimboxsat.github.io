// Google Drive sync — stores one backup file in the app's hidden appDataFolder.
// Works from a static site (no server) using Google Identity Services tokens + the Drive REST API.
import * as db from './database.js';
import { collectBackup, parseBackupText } from './backup.js';

// Optional default so you don't have to set it per device. Leave '' to enter it in Settings.
const DEFAULT_CLIENT_ID = '';
const LS_ID = 'atelier:gdrive_client_id';
const LS_LAST = 'atelier:gdrive_last_sync';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'atelier-backup.json';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

const read = k => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } };

export const clientId = () => (read(LS_ID) || '').trim() || DEFAULT_CLIENT_ID;
export function setClientId(id) { write(LS_ID, (id || '').trim() || null); }
export const configured = () => !!clientId();
export const lastSync = () => Number(read(LS_LAST) || 0) || 0;

let gisPromise = null, tokenClient = null, token = null, tokenExp = 0;

function loadGis() {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => { gisPromise = null; reject(new Error('Could not load Google sign-in. Check your connection.')); };
    document.head.append(s);
  });
  return gisPromise;
}

// Warm up the Google library ahead of the button press so the popup is not blocked.
export function preload() { if (configured()) loadGis().catch(() => { /* ignore */ }); }

function requestToken() {
  return loadGis().then(() => new Promise((resolve, reject) => {
    const id = clientId();
    if (!id) return reject(new Error('No Google client ID set.'));
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: id, scope: SCOPE,
      callback: resp => resp && resp.error ? reject(new Error(resp.error_description || resp.error)) : resolve(resp)
    });
    tokenClient.requestAccessToken();
  }));
}

async function getToken() {
  if (token && Date.now() < tokenExp - 60000) return token;
  const resp = await requestToken();
  token = resp.access_token;
  tokenExp = Date.now() + (Number(resp.expires_in || 3600) * 1000);
  return token;
}

async function api(url, opts = {}) {
  const t = await getToken();
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${t}` } });
  if (!r.ok) {
    let msg = `Google Drive error (${r.status})`;
    try { const e = await r.json(); if (e && e.error && e.error.message) msg = e.error.message; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return r;
}

async function findFile() {
  const q = encodeURIComponent(`name='${FILE_NAME}'`);
  const r = await api(`${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime)`);
  const data = await r.json();
  return (data.files || [])[0] || null;
}

async function download(fileId) {
  const r = await api(`${API}/files/${fileId}?alt=media`);
  return r.json();
}

async function upload(fileId, text) {
  if (fileId) {
    await api(`${UPLOAD}/files/${fileId}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text
    });
    return fileId;
  }
  const boundary = 'atelier' + Date.now();
  const metadata = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`
    + `--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
  const r = await api(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
  });
  const data = await r.json();
  return data.id;
}

function mergeById(local, remote) {
  const map = new Map();
  for (const x of local) map.set(x.id, x);
  for (const x of remote) {
    const cur = map.get(x.id);
    if (!cur || (x.updatedAt || 0) > (cur.updatedAt || 0)) map.set(x.id, x);
  }
  return [...map.values()];
}

function mergeProfile(local, remote) {
  if (!local || !local.nickname) return remote || local || null;
  if (!remote || !remote.nickname) return local;
  return (local.updatedAt || 0) >= (remote.updatedAt || 0) ? local : remote;
}

// Merge this device with the copy in Drive, upload the union, and apply it here. Last change per item wins.
export async function sync() {
  if (!configured()) throw new Error('Set a Google client ID first.');
  await getToken();
  const { json: localJson } = await collectBackup();
  const local = JSON.parse(localJson);
  const file = await findFile();
  let remote = null;
  if (file) { try { remote = await download(file.id); } catch { remote = null; } }
  const merged = {
    app: 'atelier', version: 1, exportedAt: new Date().toISOString(),
    items: mergeById(local.items || [], (remote && remote.items) || []),
    outfits: mergeById(local.outfits || [], (remote && remote.outfits) || []),
    profile: mergeProfile(local.profile || null, (remote && remote.profile) || null)
  };
  const text = JSON.stringify(merged);
  await upload(file && file.id, text);
  const recs = await parseBackupText(text);
  await db.replaceAll(recs.items, recs.outfits);
  if (recs.profile) db.setProfile(recs.profile);
  write(LS_LAST, String(Date.now()));
  return { items: merged.items.length, outfits: merged.outfits.length, fromDrive: !!remote };
}

export async function disconnect() {
  try {
    if (token && window.google && window.google.accounts && window.google.accounts.oauth2 && window.google.accounts.oauth2.revoke) {
      window.google.accounts.oauth2.revoke(token, () => { /* ignore */ });
    }
  } catch { /* ignore */ }
  token = null; tokenExp = 0;
  setClientId('');
}
