// Weather widget: free Open-Meteo API (no key), forecast cached 30 minutes for offline use.
// UI is one chip in the home bar; clicking it opens a small dropdown with the current
// conditions and the next 3 days. "Widgets" live only in that dropdown.
import * as db from './database.js';
import { esc, toast } from './components.js';

const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FC = 'https://api.open-meteo.com/v1/forecast';
const CACHE_KEY = 'atelier:weatherCache';
const CACHE_TTL = 30 * 60000;

// WMO weather codes -> [label, icon]
const CODE = {
  0: ['Clear', '☀️'], 1: ['Mostly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'], 48: ['Icy fog', '🌫️'],
  51: ['Drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Drizzle', '🌦️'],
  56: ['Freezing drizzle', '🌧️'], 57: ['Freezing drizzle', '🌧️'],
  61: ['Rain', '🌧️'], 63: ['Rain', '🌧️'], 65: ['Rain', '🌧️'],
  66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'],
  71: ['Snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Snow', '🌨️'], 77: ['Snow grains', '🌨️'],
  80: ['Showers', '🌦️'], 81: ['Showers', '🌦️'], 82: ['Rain showers', '🌧️'],
  85: ['Snow showers', '🌨️'], 86: ['Snow showers', '🌨️'],
  95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm', '⛈️'], 99: ['Thunderstorm', '⛈️']
};
const codeInfo = c => CODE[Number(c)] || ['—', '🌡️'];

const readers = new Set();
const emit = () => readers.forEach(fn => { try { fn(); } catch { /* ignore */ } });

export const enabled = () => !!db.settings.get('weatherEnabled', false);
export const setEnabled = on => { db.settings.set('weatherEnabled', !!on); emit(); };
export const city = () => db.settings.get('weatherCity', null);
export const setCity = c => { db.settings.set('weatherCity', c); emit(); };
export const onWeatherChange = fn => { readers.add(fn); return () => readers.delete(fn); };

let last = null; // { label, ico, temp } of the most recent forecast, for compact chips
export const summary = () => last;

export async function resolveCity(q) {
  const r = await fetch(`${GEO}?name=${encodeURIComponent(q.trim())}&count=1&language=en&format=json`);
  if (!r.ok) throw new Error('Could not reach the city lookup.');
  const d = await r.json();
  const res = (d.results || [])[0];
  if (!res) return null;
  return { label: [res.name, res.admin1, res.country].filter(Boolean).join(', '), latitude: res.latitude, longitude: res.longitude };
}

function cacheGet(c) {
  if (!c) return null;
  try { const x = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); if (x && x.city && x.city.label === c.label && x.at > Date.now() - CACHE_TTL) return x.data; } catch { /* ignore */ }
  return null;
}
function cacheSet(c, data) { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), city: c, data })); } catch { /* ignore */ } }

export async function fetchForecast(c) {
  const hit = cacheGet(c);
  if (hit) { last = { label: c.label, ico: codeInfo(hit.current.code)[1], temp: hit.current.temp }; return hit; }
  const url = `${FC}?latitude=${c.latitude}&longitude=${c.longitude}&current=temperature_2m,apparent_temperature,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=4`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Weather is unavailable right now.');
  const d = await r.json();
  const data = {
    current: { temp: Math.round(d.current.temperature_2m), feels: Math.round(d.current.apparent_temperature), code: d.current.weather_code },
    days: (d.daily.time || []).map((t, i) => ({ date: t, code: d.daily.weather_code[i], min: Math.round(d.daily.temperature_2m_min[i]), max: Math.round(d.daily.temperature_2m_max[i]) }))
  };
  last = { label: c.label, ico: codeInfo(data.current.code)[1], temp: data.current.temp };
  cacheSet(c, data);
  return data;
}

const dayName = t => { try { return new Date(t + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' }); } catch { return ''; } };

// Renders into `host` (an empty dropdown container next to the bar) and keeps `chip`
// (the button in the bar) in sync. Toggling the chip opens/closes the dropdown.
export function mountWeather({ host, chip }) {
  if (!host) return { refresh: () => {}, close: () => {} };
  let open = false;

  function setOpen(v) {
    open = v;
    host.hidden = !v;
    if (chip) {
      chip.classList.toggle('on', v);
      chip.setAttribute('aria-expanded', String(v));
    }
  }
  const close = () => setOpen(false);
  const openDrop = () => { setOpen(true); refresh(); };

  function draw(data) {
    const [cLabel, cIco] = codeInfo(data.current.code);
    const c = city(); const label = c ? c.label : '';
    host.innerHTML = `<div class="w-dd-head">
        <span class="w-ico">${cIco}</span><span class="w-cur"><b>${data.current.temp}°</b><span>${cLabel}</span></span>
        <span class="w-city">${esc(label)}</span>
        <button type="button" class="w-dd-close" data-close aria-label="Close weather">×</button>
      </div>
      <div class="w-days">
        ${data.days.map((d, i) => `<div class="w-day${i === 0 ? ' today' : ''}"><span class="w-day-name">${i === 0 ? 'Today' : dayName(d.date)}</span><span class="w-day-ico">${codeInfo(d.code)[1]}</span><span class="w-day-temp"><b>${d.max}°</b><s>${d.min}°</s></span></div>`).join('')}
      </div>
      <p class="muted small w-note">Feels like ${data.current.feels}° in ${esc(label)}.</p>`;
  }

  function fail(msg) {
    const c = city();
    host.innerHTML = `<div class="w-dd-head"><span class="w-ico">⚠️</span><span class="w-cur"><b>—</b><span>${esc(msg)}</span></span><span class="w-city">${esc(c ? c.label : '')}</span></div>
      <p class="muted small w-note"><button class="link" data-retry>Try again</button></p>`;
    host.querySelector('[data-retry]').onclick = refresh;
  }

  async function load() {
    const c = city(); if (!c) return;
    host.innerHTML = `<div class="w-dd-head"><span class="w-ico">🕐</span><span class="w-cur"><b>…</b><span>Loading weather</span></span><span class="w-city">${esc(c.label)}</span></div>`;
    try {
      const before = summary();
      const data = await fetchForecast(c);
      const after = summary();
      if (!before || !after || before.temp !== after.temp || before.ico !== after.ico || before.label !== after.label) emit();
      draw(data);
    } catch (e) {
      const cached = cacheGet(c);
      if (cached) { draw(cached); return; }
      fail(e.message || 'Tap to retry');
    }
  }

  function drawSetup() {
    host.innerHTML = `<strong class="w-set-title">Weather by city</strong>
      <div class="inline-field"><input id="wCityIn" placeholder="City name…" aria-label="Weather city" maxlength="60"><button class="btn small" id="wCityGo">Set</button></div>`;
    const inp = host.querySelector('#wCityIn'), go = host.querySelector('#wCityGo');
    const submit = async () => {
      if (!inp.value.trim()) return;
      go.disabled = true;
      try {
        const c = await resolveCity(inp.value);
        if (!c) { toast('No matching city — try another name.', 'error'); return; }
        setCity(c);
      } catch (e2) { toast(e2.message || 'Could not find that city.', 'error'); }
      finally { go.disabled = false; }
    };
    go.onclick = submit;
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
    setTimeout(() => inp.focus(), 30);
  }

  function refresh() {
    if (!enabled()) { host.innerHTML = '<p class="muted small">Weather is off — turn it on in Settings.</p>'; return; }
    if (!city()) drawSetup();
    else load();
  }

  host.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });

  if (chip) chip.onclick = () => {
    if (!open && !enabled()) setEnabled(true);
    open ? close() : openDrop();
  };
  document.addEventListener('pointerdown', e => {
    if (!open) return;
    if (!host.contains(e.target) && !(chip && chip.contains(e.target))) close();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) close(); });

  refresh();
  return { refresh, close };
}