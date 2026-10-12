// Weather widget — free Open-Meteo API (no key needed). A single chip sits in the
// home strip; tapping it opens a compact forecast popover. Forecasts are cached for
// 30 minutes so the last reading still shows offline.
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
export const describe = code => codeInfo(code); // -> [label, icon]

const readers = new Set();
const emit = () => readers.forEach(fn => { try { fn(); } catch { /* ignore */ } });

export const enabled = () => !!db.settings.get('weatherEnabled', false);
export const setEnabled = on => { db.settings.set('weatherEnabled', !!on); emit(); };
export const city = () => db.settings.get('weatherCity', null);
export const setCity = c => { db.settings.set('weatherCity', c); emit(); };
export const onWeatherChange = fn => { readers.add(fn); return () => readers.delete(fn); };

let last = null; // { label, ico, temp } of the most recent forecast, for the compact chip
let lastData = null; // full { current, days } forecast, for other views (e.g. Dress me)
let lastDataCity = null;
export const summary = () => last;
export const forecast = () => lastData;

// Fetches (or reads the cache) for the chosen city when weather is on, so other
// views can render a forecast without managing the network themselves.
export async function ensure() {
  if (!enabled()) return null;
  const c = city(); if (!c) return null;
  if (lastData && lastDataCity === c.label) return lastData;
  try { return await fetchForecast(c); } catch { return lastData; }
}

const shortPlace = label => (label || '').split(',')[0].trim();

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
  if (hit) { last = { label: c.label, ico: codeInfo(hit.current.code)[1], temp: hit.current.temp }; lastData = hit; lastDataCity = c.label; return hit; }
  const url = `${FC}?latitude=${c.latitude}&longitude=${c.longitude}&current=temperature_2m,apparent_temperature,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=4`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Weather is unavailable right now.');
  const d = await r.json();
  const data = {
    current: { temp: Math.round(d.current.temperature_2m), feels: Math.round(d.current.apparent_temperature), code: d.current.weather_code },
    days: (d.daily.time || []).map((t, i) => ({ date: t, code: d.daily.weather_code[i], min: Math.round(d.daily.temperature_2m_min[i]), max: Math.round(d.daily.temperature_2m_max[i]) }))
  };
  last = { label: c.label, ico: codeInfo(data.current.code)[1], temp: data.current.temp };
  lastData = data;
  lastDataCity = c.label;
  cacheSet(c, data);
  return data;
}

const dayName = t => { try { return new Date(t + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' }); } catch { return ''; } };

// Renders into `host` (the popover container beside the strip) and keeps `chip`
// (the button in the strip) in sync. Tapping the chip toggles the popover.
export function mountWeather({ host, chip }) {
  if (!host) return { refresh: () => {}, close: () => {} };
  let open = false;

  function setOpen(v) {
    open = v;
    host.hidden = !v;
    if (chip) { chip.classList.toggle('on', v); chip.setAttribute('aria-expanded', String(v)); }
  }
  const close = () => setOpen(false);
  const openDrop = () => { setOpen(true); refresh(); };

  function daysBlock(days) {
    return `<div class="wx-days">${days.map((d, i) => `<div class="wx-day${i === 0 ? ' today' : ''}">
        <span class="wx-dn">${i === 0 ? 'Today' : dayName(d.date)}</span>
        <span class="wx-di">${codeInfo(d.code)[1]}</span>
        <span class="wx-dt"><b>${d.max}°</b><i>${d.min}°</i></span>
      </div>`).join('')}</div>`;
  }

  function draw(d) {
    const [cond, ico] = codeInfo(d.current.code);
    host.innerHTML = `<div class="wx-top">
        <span class="wx-ico">${ico}</span>
        <div class="wx-now"><b>${d.current.temp}°</b><span>${cond}</span></div>
        <div class="wx-place"><span class="wx-city">${esc(shortPlace(city().label))}</span><span class="wx-feels">Feels ${d.current.feels}°</span></div>
        <button type="button" class="wx-close" data-close aria-label="Close forecast">×</button>
      </div>${daysBlock(d.days)}`;
  }

  function loading() {
    const c = city();
    host.innerHTML = `<div class="wx-top">
        <span class="wx-ico">⛅</span>
        <div class="wx-now"><b>—</b><span>Loading…</span></div>
        <div class="wx-place"><span class="wx-city">${esc(shortPlace(c ? c.label : ''))}</span></div>
      </div>
      <div class="wx-days">${'<div class="wx-day wx-skel"></div>'.repeat(4)}</div>`;
  }

  function fail(msg) {
    const c = city();
    host.innerHTML = `<div class="wx-top">
        <span class="wx-ico">⚠️</span>
        <div class="wx-now"><b>—</b><span>Weather unavailable</span></div>
        <div class="wx-place"><span class="wx-city">${esc(shortPlace(c.label))}</span></div>
        <button type="button" class="wx-close" data-close aria-label="Close forecast">×</button>
      </div>
      <p class="wx-retry muted small">${esc(msg)} <button class="link" data-retry>Try again</button></p>`;
  }

  async function load() {
    const c = city(); if (!c) return;
    loading();
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
    const c = city();
    host.innerHTML = `<form class="wx-setup">
        <span class="wx-setup-title">Which city?</span>
        <div class="wx-setup-row">
          <input id="wCityIn" class="wx-input" placeholder="City name" aria-label="Weather city" maxlength="60" autocomplete="off" value="${c ? esc(shortPlace(c.label)) : ''}">
          <button class="btn primary small" id="wCityGo" type="submit">Set</button>
        </div>
        <span class="wx-hint">Forecast from Open-Meteo · no account needed</span>
      </form>`;
    const form = host.querySelector('.wx-setup'), inp = host.querySelector('#wCityIn'), go = host.querySelector('#wCityGo');
    form.onsubmit = async e => {
      e.preventDefault();
      if (!inp.value.trim()) return;
      go.disabled = true;
      try {
        const found = await resolveCity(inp.value);
        if (!found) { toast('No matching city — try another name.', 'error'); return; }
        setCity(found);
      } catch (e2) { toast(e2.message || 'Could not find that city.', 'error'); }
      finally { go.disabled = false; }
    };
    setTimeout(() => inp.focus(), 30);
  }

  function drawOff() {
    host.innerHTML = `<div class="wx-off">
        <span class="wx-off-ico">🌤️</span>
        <p class="muted small">Weather is off.</p>
        <button class="btn primary small" data-enable>Turn on weather</button>
      </div>`;
  }

  function refresh() {
    if (!enabled()) { drawOff(); return; }
    if (!city()) drawSetup();
    else load();
  }

  host.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) close();
    else if (e.target.closest('[data-retry]')) load();
    else if (e.target.closest('[data-enable]')) setEnabled(true);
  });

  if (chip) chip.onclick = () => { if (!open && !enabled()) setEnabled(true); open ? close() : openDrop(); };
  document.addEventListener('pointerdown', e => {
    if (!open) return;
    if (!host.contains(e.target) && !(chip && chip.contains(e.target))) close();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) close(); });

  refresh();
  return { refresh, close };
}
