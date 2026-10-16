// Image helpers: validation, loading, transforms (crop/rotate/zoom), thumbnails, URL cache.
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_BYTES = 15 * 1024 * 1024;

export function validateImageFile(file) {
  if (!file) return 'No file selected.';
  if (!ALLOWED_TYPES.includes(file.type)) return 'Unsupported file type. Please use JPEG, PNG or WebP.';
  if (file.size > MAX_BYTES) return 'That image is larger than 15 MB. Please choose a smaller one.';
  return null;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Only ask for CORS on real cross-origin http(s) sources. Setting crossOrigin
    // on same-origin blob:/data: URLs makes iOS Safari treat them as cross-origin
    // and taint the canvas, which silently breaks getImageData (e.g. background
    // removal). crossOrigin must also be set before src on Safari.
    if (/^https?:/i.test(src)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image could not be loaded.'));
    img.src = src;
  });
}

export function blobToImage(blob) {
  const url = URL.createObjectURL(blob);
  return loadImage(url).finally(() => setTimeout(() => URL.revokeObjectURL(url), 1000));
}

export const canvasToBlob = (canvas, type = 'image/png', q = 0.92) =>
  new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('Could not encode image.')), type, q));

// Downscale very large photos; preserves PNG transparency
export async function normalizeBlob(blob, maxSide = 1400) {
  const img = await blobToImage(blob);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1 && blob.size < 2.5 * 1024 * 1024) return blob;
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return canvasToBlob(c, blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9);
}

// RGB distance (0..441) used for background matching
const colorDist = (r1, g1, b1, r2, g2, b2) => {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

// Remove a plain/uniform background: flood-fill inward from the borders and
// fade out pixels that match the border colour. Returns a same-size canvas with
// transparency. No external model, so it works offline and stays on-device.
const cutoutCache = new WeakMap();
const nextFrame = () => new Promise(r => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 16)));
export async function cutoutBackground(img, tol) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  // Some Safari versions hand back a blank buffer when the pixels are read in the
  // same frame the image was drawn (willReadFrequently only covers Safari 16.4+),
  // which makes the cutout silently do nothing. Let the draw settle for a frame.
  if (typeof img.decode === 'function') { try { await img.decode(); } catch { /* already decoded */ } }
  await nextFrame();
  let data;
  try { data = ctx.getImageData(0, 0, w, h); } catch { return c; } // cross-origin image: leave untouched
  const d = data.data;
  let rs = 0, gs = 0, bs = 0, n = 0;
  const sample = (x, y) => { const i = (y * w + x) * 4; rs += d[i]; gs += d[i + 1]; bs += d[i + 2]; n++; };
  for (let x = 0; x < w; x++) { sample(x, 0); sample(x, h - 1); }
  for (let y = 0; y < h; y++) { sample(0, y); sample(w - 1, y); }
  const br = rs / n, bg = gs / n, bb = bs / n;
  const mask = new Uint8Array(w * h);
  const stack = [];
  const seed = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x; if (mask[p]) return;
    const i = p * 4;
    if (colorDist(d[i], d[i + 1], d[i + 2], br, bg, bb) <= tol) { mask[p] = 1; stack.push(p); }
  };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
  while (stack.length) { const p = stack.pop(); const x = p % w, y = (p - x) / w; seed(x + 1, y); seed(x - 1, y); seed(x, y + 1); seed(x, y - 1); }
  const soft = tol * 0.5 || 1;
  for (let p = 0; p < w * h; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    const dd = colorDist(d[i], d[i + 1], d[i + 2], br, bg, bb);
    d[i + 3] = Math.round(Math.max(0, Math.min(1, (dd - soft) / soft)) * 255);
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

// Apply edits: rotation (deg), zoom, offset (-1..1 fraction of frame), square-ish frame aspect
export async function renderEdited(img, { rotate = 0, zoom = 1, offX = 0, offY = 0, frame = 'free', bgRemove = false, bgTol = 40 }, outMax = 1200) {
  const w = img.naturalWidth, h = img.naturalHeight;
  let src = img;
  if (bgRemove) {
    const hit = cutoutCache.get(img);
    if (hit && hit.tol === bgTol) src = hit.canvas;
    else { src = await cutoutBackground(img, bgTol); cutoutCache.set(img, { tol: bgTol, canvas: src }); }
  }
  const rad = rotate * Math.PI / 180;
  const rw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
  const rh = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
  const aspect = frame === 'square' ? 1 : frame === 'portrait' ? 0.8 : rw / rh;
  let fw, fh;
  if (aspect >= rw / rh) { fh = rh; fw = rh * aspect; } else { fw = rw; fh = rw / aspect; }
  const scale = Math.min(1, outMax / Math.max(fw, fh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(fw * scale)); c.height = Math.max(1, Math.round(fh * scale));
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2 + offX * c.width / 2, c.height / 2 + offY * c.height / 2);
  ctx.scale(scale * zoom, scale * zoom);
  ctx.rotate(rad);
  ctx.drawImage(src, -w / 2, -h / 2);
  return canvasToBlob(c);
}

// Object URL cache keyed by item id + updatedAt, revoked when stale
const urlCache = new Map();
export function itemImageUrl(item) {
  if (item.imageBlob) {
    const key = item.id + ':' + item.updatedAt;
    let hit = urlCache.get(item.id);
    if (!hit || hit.key !== key) {
      if (hit) URL.revokeObjectURL(hit.url);
      hit = { key, url: URL.createObjectURL(item.imageBlob) };
      urlCache.set(item.id, hit);
    }
    return hit.url;
  }
  return item.imageUrl || '';
}
export function pruneUrlCache(validIds) {
  for (const [id, v] of urlCache) if (!validIds.has(id)) { URL.revokeObjectURL(v.url); urlCache.delete(id); }
}

// Neutral placeholder as SVG data URL for items without images
export function placeholderFor(item) {
  const letter = (item.name || '?').trim().charAt(0).toUpperCase() || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240"><rect width="200" height="240" fill="#efeae0"/><g fill="none" stroke="#b9b1a1" stroke-width="3" stroke-linejoin="round"><path d="M70 60l-40 28 14 24 22-12v78h68v-78l22 12 14-24-40-28c-6 12-16 16-30 16s-24-4-30-16z"/></g><text x="100" y="228" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#b9b1a1">${letter}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
export const imgSrc = item => itemImageUrl(item) || placeholderFor(item);
