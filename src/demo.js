// Sample wardrobe: garments are drawn locally as simple original SVG shapes, rendered to PNG blobs.
import * as db from './database.js';
import { loadImage, canvasToBlob } from './image-utils.js';
import { defaultBox, ROLE_LAYER } from './outfit-builder.js';
import { layoutRole } from './categories.js';

const S = 'stroke="rgba(0,0,0,.28)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';
const SHAPES = {
  tee: { w: 300, h: 290, svg: c => `<path d="M95 20L20 70l30 50 35-20v180h130V100l35 20 30-50-75-50q-55 35-110 0z" fill="${c}" ${S}/><path d="M95 20q55 38 110 0" fill="none" ${S}/>` },
  longsleeve: { w: 320, h: 300, svg: c => `<path d="M105 20L28 62 8 260l44 8 22-130v150h172V138l22 130 44-8-20-198-77-42q-55 36-110 0z" fill="${c}" ${S}/><path d="M105 20q55 38 110 0" fill="none" ${S}/>` },
  hoodie: { w: 320, h: 320, svg: (c, a) => `<path d="M105 38L28 80 8 270l46 8 22-134v166h168V144l22 134 46-8-20-190-77-42z" fill="${c}" ${S}/><path d="M105 38q55-52 110 0-30 52-55 56-25-4-55-56z" fill="${a}" ${S}/><rect x="108" y="220" width="104" height="52" rx="10" fill="none" ${S}/><path d="M145 92v40M175 92v40" ${S} fill="none"/>` },
  shirt: { w: 300, h: 320, svg: (c, a) => `<path d="M100 22L24 68 8 270l44 6 22-130v160h152V146l22 130 44-6-16-202-76-46-50 40z" fill="${c}" ${S}/><path d="M100 22l50 40 50-40-18 56-32 12-32-12z" fill="${a}" ${S}/><path d="M150 62v230" ${S} fill="none"/><circle cx="150" cy="120" r="3" fill="#0004"/><circle cx="150" cy="170" r="3" fill="#0004"/><circle cx="150" cy="220" r="3" fill="#0004"/>` },
  jeans: { w: 240, h: 420, svg: (c, a) => `<path d="M30 10h180l14 400h-82l-10-250-10 250H16z" fill="${c}" ${S}/><path d="M30 38h180" ${S} fill="none"/><path d="M120 38v120" ${S} fill="none"/><path d="M60 70q20 10 30 0" fill="none" stroke="${a}" stroke-width="3"/>` },
  trousers: { w: 240, h: 420, svg: c => `<path d="M34 10h172l16 400h-86l-10-260-10 260H18z" fill="${c}" ${S}/><path d="M34 34h172" ${S} fill="none"/><path d="M120 34v110" ${S} fill="none"/>` },
  shorts: { w: 260, h: 230, svg: c => `<path d="M30 10h200l18 200h-96l-12-80-12 80H12z" fill="${c}" ${S}/><path d="M30 34h200" ${S} fill="none"/><path d="M130 34v60" ${S} fill="none"/>` },
  sneaker: { w: 380, h: 210, svg: (c, a) => `<path d="M22 130Q22 78 62 70l50-8q36 44 100 46 80 4 128 36l10 24q4 18-14 18H38q-16 0-16-18z" fill="${c}" ${S}/><path d="M22 168h330v22H38q-16 0-16-18z" fill="${a}" ${S}/><path d="M116 66l24 20M138 56l24 22M160 54l24 22" ${S} fill="none"/>` },
  boots: { w: 300, h: 300, svg: (c, a) => `<path d="M70 14h100v140q50 10 100 40l8 40q2 16-14 16H64q-16 0-16-16z" fill="${c}" ${S}/><path d="M48 252h230v22H64q-16 0-16-22z" fill="${a}" ${S}/>` },
  jacket: { w: 340, h: 340, svg: (c, a) => `<path d="M112 22L30 66 10 300l50 8 22-150v170h176V158l22 150 50-8-20-234-82-44z" fill="${c}" ${S}/><path d="M112 22l58 56 58-56-12 70-46 30-46-30z" fill="${a}" ${S}/><path d="M170 78v264" ${S} fill="none"/><rect x="100" y="240" width="52" height="8" rx="4" fill="#0003"/><rect x="190" y="240" width="52" height="8" rx="4" fill="#0003"/>` },
  beanie: { w: 240, h: 230, svg: (c, a) => `<path d="M30 170Q30 36 120 32q90 4 90 138z" fill="${c}" ${S}/><rect x="24" y="160" width="192" height="42" rx="10" fill="${a}" ${S}/><circle cx="120" cy="24" r="18" fill="${a}" ${S}/>` },
  cap: { w: 300, h: 190, svg: (c, a) => `<path d="M40 130Q40 28 150 24q110 4 110 106z" fill="${c}" ${S}/><path d="M36 134q120 -20 250 14 6 16-20 20-110-18-230-10z" fill="${a}" ${S}/>` },
  sunglasses: { w: 320, h: 130, svg: c => `<rect x="14" y="26" width="128" height="74" rx="28" fill="${c}" ${S}/><rect x="178" y="26" width="128" height="74" rx="28" fill="${c}" ${S}/><path d="M142 50q18-14 36 0M14 40L2 28M306 40l12-12" ${S} fill="none"/>` },
  backpack: { w: 250, h: 320, svg: (c, a) => `<path d="M60 70q0-50 65-50t65 50v220q0 20-20 20H80q-20 0-20-20z" fill="${c}" ${S}/><rect x="84" y="190" width="82" height="76" rx="12" fill="${a}" ${S}/><path d="M100 24q25-16 50 0" fill="none" ${S}/><path d="M60 110q-26 40-6 120M190 110q26 40 6 120" ${S} fill="none"/>` },
  watch: { w: 150, h: 330, svg: (c, a) => `<rect x="42" y="8" width="66" height="314" rx="14" fill="${a}" ${S}/><circle cx="75" cy="165" r="56" fill="${c}" ${S}/><circle cx="75" cy="165" r="42" fill="#f7f4ee" ${S}/><path d="M75 165V135M75 165l20 10" ${S} fill="none"/>` }
};

const ITEMS = [
  { n: 'Classic white tee', b: 'Northline', cat: 'Tops', sub: 'T-shirts', shape: 'tee', c: '#f4f1ea', a: '#d8d2c4', col: ['White'], se: ['Spring', 'Summer'], oc: ['Casual'], tags: ['basic'] },
  { n: 'Navy long sleeve', b: 'Northline', cat: 'Tops', sub: 'Long-sleeve shirts', shape: 'longsleeve', c: '#2b3a63', a: '#222', col: ['Navy'], se: ['Autumn', 'Spring'], oc: ['Casual'], tags: ['basic'] },
  { n: 'Oatmeal hoodie', b: 'Fieldwork', cat: 'Tops', sub: 'Hoodies', shape: 'hoodie', c: '#cdb99a', a: '#bba684', col: ['Beige'], se: ['Autumn', 'Winter'], oc: ['Casual', 'Travel'], tags: ['cozy'] },
  { n: 'Sage oxford shirt', b: 'Maple & Co', cat: 'Tops', sub: 'Shirts', shape: 'shirt', c: '#9fb59a', a: '#8aa186', col: ['Green'], se: ['Spring', 'Summer'], oc: ['Work', 'Casual'], tags: ['smart'] },
  { n: 'Dark wash jeans', b: 'Denim Lab', cat: 'Bottoms', sub: 'Jeans', shape: 'jeans', c: '#34466d', a: '#e6c27a', col: ['Blue'], se: ['Autumn', 'Winter', 'Spring'], oc: ['Casual'], tags: ['denim'] },
  { n: 'Stone trousers', b: 'Maple & Co', cat: 'Bottoms', sub: 'Trousers', shape: 'trousers', c: '#c9bda5', a: '#aaa', col: ['Beige'], se: ['Spring', 'Summer', 'Autumn'], oc: ['Work', 'Casual'], tags: ['smart'] },
  { n: 'Black trousers', b: 'Maple & Co', cat: 'Bottoms', sub: 'Trousers', shape: 'trousers', c: '#2a2a2d', a: '#555', col: ['Black'], se: ['Autumn', 'Winter'], oc: ['Work', 'Formal', 'Evening'], tags: ['smart'] },
  { n: 'Linen shorts', b: 'Fieldwork', cat: 'Bottoms', sub: 'Shorts', shape: 'shorts', c: '#e3d8c1', a: '#aaa', col: ['Cream'], se: ['Summer'], oc: ['Casual', 'Beach'], tags: ['light'] },
  { n: 'White sneakers', b: 'Stride', cat: 'Shoes', sub: 'Sneakers', shape: 'sneaker', c: '#f3f1ec', a: '#cfc9bb', col: ['White'], se: ['Spring', 'Summer', 'Autumn'], oc: ['Casual'], tags: ['basic'] },
  { n: 'Black sneakers', b: 'Stride', cat: 'Shoes', sub: 'Sneakers', shape: 'sneaker', c: '#2c2c2f', a: '#e9e6df', col: ['Black'], se: ['Autumn', 'Winter', 'Spring'], oc: ['Casual', 'Sport'], tags: ['street'] },
  { n: 'Brown leather boots', b: 'Fieldwork', cat: 'Shoes', sub: 'Boots', shape: 'boots', c: '#6b4a32', a: '#2c2c2f', col: ['Brown'], se: ['Autumn', 'Winter'], oc: ['Casual', 'Work'], tags: ['classic'] },
  { n: 'Olive field jacket', b: 'Fieldwork', cat: 'Outerwear', sub: 'Jackets', shape: 'jacket', c: '#6d6f43', a: '#585a35', col: ['Olive'], se: ['Autumn', 'Spring'], oc: ['Casual', 'Travel'], tags: ['utility'] },
  { n: 'Charcoal coat', b: 'Northline', cat: 'Outerwear', sub: 'Coats', shape: 'jacket', c: '#46484d', a: '#35373b', col: ['Grey'], se: ['Winter'], oc: ['Work', 'Formal'], tags: ['smart'] },
  { n: 'Rust beanie', b: 'Northline', cat: 'Accessories', sub: 'Beanies', shape: 'beanie', c: '#b4623a', a: '#9a512d', col: ['Orange'], se: ['Winter'], oc: ['Casual'], tags: ['cozy'] },
  { n: 'Black cap', b: 'Stride', cat: 'Accessories', sub: 'Hats', shape: 'cap', c: '#2a2a2d', a: '#3a3a3d', col: ['Black'], se: ['Spring', 'Summer'], oc: ['Casual', 'Sport'], tags: ['street'] },
  { n: 'Tortoise sunglasses', b: 'Optic', cat: 'Accessories', sub: 'Sunglasses', shape: 'sunglasses', c: '#5a3a24', a: '#222', col: ['Brown'], se: ['Summer', 'Spring'], oc: ['Casual', 'Beach'], tags: ['summer'] },
  { n: 'Canvas backpack', b: 'Fieldwork', cat: 'Bags', sub: 'Backpacks', shape: 'backpack', c: '#8a8570', a: '#6e6a58', col: ['Olive'], se: ['Spring', 'Summer', 'Autumn'], oc: ['Travel', 'Casual'], tags: ['utility'] },
  { n: 'Steel watch', b: 'Optic', cat: 'Accessories', sub: 'Watches', shape: 'watch', c: '#b9bdc4', a: '#4a4a4f', col: ['Grey'], se: [], oc: ['Work', 'Casual'], tags: ['classic'] }
];

const OUTFITS = [
  { name: 'Easy weekend', occasion: 'Casual', tags: ['relaxed'], pick: ['Oatmeal hoodie', 'Dark wash jeans', 'White sneakers', 'Black cap'] },
  { name: 'Smart casual', occasion: 'Work', tags: ['smart'], pick: ['Sage oxford shirt', 'Stone trousers', 'Brown leather boots', 'Steel watch'] },
  { name: 'Autumn layers', occasion: 'Casual', tags: ['layered'], pick: ['Olive field jacket', 'Navy long sleeve', 'Dark wash jeans', 'Black sneakers', 'Rust beanie'] },
  { name: 'Summer day', occasion: 'Beach', tags: ['light'], pick: ['Classic white tee', 'Linen shorts', 'White sneakers', 'Tortoise sunglasses'] }
];

async function drawBlob(kind, color, accent) {
  const sh = SHAPES[kind];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sh.w * 3}" height="${sh.h * 3}" viewBox="-6 -6 ${sh.w + 12} ${sh.h + 12}">${sh.svg(color, accent)}</svg>`;
  const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  const c = document.createElement('canvas'); c.width = sh.w * 3; c.height = sh.h * 3;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { blob: await canvasToBlob(c), aspect: (sh.w + 12) / (sh.h + 12) };
}

export async function loadDemoContent() {
  const existing = (await db.getItems()).filter(i => i.demo);
  if (existing.length) return;
  const byName = new Map(); const aspects = new Map();
  let t = Date.now() - ITEMS.length * 1000;
  for (const d of ITEMS) {
    const { blob, aspect } = await drawBlob(d.shape, d.c, d.a);
    const item = await db.addItem({ name: d.n, brand: d.b, category: d.cat, subcategory: d.sub, imageBlob: blob, colors: d.col, season: d.se, occasions: d.oc, tags: d.tags, demo: true, createdAt: (t += 1000) });
    byName.set(d.n, item); aspects.set(item.id, aspect);
  }
  for (const o of OUTFITS) {
    const counts = {};
    const items = o.pick.map(n => byName.get(n)).map(it => {
      const role = layoutRole(it); const idx = counts[role] = (counts[role] ?? -1) + 1;
      const b = defaultBox(role, idx, aspects.get(it.id));
      return { itemId: it.id, x: b.x, y: b.y, width: b.w, height: b.h, rotation: 0, layerOrder: ROLE_LAYER[role] * 10 + idx };
    });
    items.sort((a, b) => a.layerOrder - b.layerOrder).forEach((p, i) => p.layerOrder = i);
    await db.addOutfit({ name: o.name, occasion: o.occasion, tags: o.tags, items, demo: true });
  }
}
