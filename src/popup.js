import { DEFAULTS, COMP_RATIOS, makeupDb } from './shared.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);
const el = {
  favicon: $('favicon'), title: $('tab-title'), status: $('status'), error: $('error'),
  volText: $('vol-text'), vol: $('vol'), volDb: $('vol-db'), mute: $('mute'), maxVol: $('max-vol'),
  channelMode: $('channel-mode'), pan: $('pan'), panDial: document.querySelector('#pan .knob-dial'),
  panLabel: $('pan-label'),
  compOn: $('comp-on'), compRatio: $('comp-ratio'), compRatioVal: $('comp-ratio-val'), compBody: $('comp-body'), compGr: $('comp-gr'),
  compThreshold: $('comp-threshold'), compThresholdVal: $('comp-threshold-val'),
  compMakeup: $('comp-makeup'), compMakeupVal: $('comp-makeup-val'), compAuto: $('comp-auto'),
  dc: $('dc'), limiter: $('limiter'), lowCut: $('low-cut'), highCut: $('high-cut'), reset: $('reset'),
  meterL: $('meter-l'), meterR: $('meter-r'), latency: $('latency'),
  restore: $('restore'),
  othersSection: $('others-section'), others: $('others'),
};

let tab; // the active tab this popup is for
let settings = { ...DEFAULTS };
let active = false; // true while this tab's audio is going through our engine
let starting = null; // in-flight capture promise, so rapid slider moves don't capture twice

// ---- Messaging helpers ----------------------------------------------------

async function toOffscreen(type, data = {}) {
  try {
    return await chrome.runtime.sendMessage({ target: 'offscreen', type, ...data });
  } catch {
    // No offscreen document exists yet, meaning no tab is being processed.
    return null;
  }
}

function showError(msg) {
  el.error.textContent = msg;
  el.error.hidden = !msg;
}

// ---- Start / restore --------------------------------------------------------

// Called automatically on the first change to any control.
async function start() {
  if (active) return;
  starting ??= (async () => {
    try {
      const bg = await chrome.runtime.sendMessage({ target: 'background', type: 'ensure-offscreen' });
      if (!bg?.ok) throw new Error(bg?.error ?? 'Could not start audio engine');

      // Only works from a user-invoked context like this popup. The ID is
      // short-lived and is redeemed by the offscreen page via getUserMedia.
      let streamId;
      try {
        streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      } catch (e) {
        throw new Error(`Can't adjust this tab (${e.message}). Browser pages like chrome:// and the web store can't be captured.`);
      }

      const r = await toOffscreen('capture', { tabId: tab.id, streamId, settings });
      if (!r?.ok) throw new Error(r?.error ?? 'Capture failed');

      active = true;
      showError('');
      // Settings may have changed while we were starting; push the latest.
      await toOffscreen('update', { tabId: tab.id, patch: settings });
    } catch (e) {
      showError(e.message);
    } finally {
      starting = null;
      renderStatus();
    }
  })();
  return starting;
}

async function restore(tabId) {
  await toOffscreen('release', { tabId });
  if (tabId === tab.id) {
    active = false;
    settings = { ...DEFAULTS };
    render();
  }
  refreshOthers();
}

// Every control change goes through here.
async function update(patch) {
  settings = { ...settings, ...patch };
  render();
  if (starting) return; // start() pushes the final settings when it finishes
  if (!active) return start();
  const r = await toOffscreen('update', { tabId: tab.id, patch });
  if (r && !r.ok) {
    active = false; // e.g. the tab's capture ended behind our back
    renderStatus();
  }
}

// ---- Rendering --------------------------------------------------------------

const fmtDb = (pct) => (pct <= 0 ? '−∞ dB' : `${(20 * Math.log10(pct / 100)).toFixed(1)} dB`);
const signedDb = (db) => `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clampVol = (v) => clamp(Math.round(v * 10) / 10, 0, 500);

function render() {
  const s = settings;
  el.volText.textContent = `${s.volume.toFixed(1)}%`;
  el.vol.value = s.volume;
  el.volDb.textContent = s.muted ? 'muted' : fmtDb(s.volume);
  el.mute.innerHTML = icon(s.muted ? 'speakerXMark' : 'speakerWave', 20);
  el.mute.setAttribute('aria-pressed', String(s.muted));

  el.channelMode.value = s.channelMode;

  // Knob: -100..100 maps to -135°..135° of rotation.
  const p = Math.round(s.pan * 100);
  el.panDial.style.transform = `rotate(${p * 1.35}deg)`;
  el.pan.setAttribute('aria-valuenow', String(p));
  el.panLabel.textContent = p === 0 ? 'Center' : p < 0 ? `L ${-p}` : `R ${p}`;

  el.compOn.setAttribute('aria-pressed', String(s.compOn));
  el.compOn.textContent = s.compOn ? 'On' : 'Off';
  renderRatio();
  el.compBody.classList.toggle('off', !s.compOn);
  el.compThreshold.value = s.compThreshold;
  el.compThresholdVal.textContent = `${s.compThreshold.toFixed(1)} dB`;
  const mk = s.compOn ? makeupDb(s) : s.compMakeup;
  el.compMakeup.value = mk;
  el.compMakeup.disabled = s.compAutoMakeup;
  el.compMakeupVal.textContent = signedDb(mk);
  el.compAuto.setAttribute('aria-pressed', String(s.compAutoMakeup));
  if (!s.compOn) el.compGr.textContent = 'GR —';

  el.dc.setAttribute('aria-pressed', String(s.dcFilter));
  el.limiter.setAttribute('aria-pressed', String(s.limiter));
  el.lowCut.setAttribute('aria-pressed', String(s.lowCut));
  el.highCut.setAttribute('aria-pressed', String(s.highCut));
  renderStatus();
}

function renderStatus() {
  el.status.textContent = starting ? 'Starting…' : active ? 'Adjusted' : 'Original audio';
  el.status.classList.toggle('on', active);
  el.restore.hidden = !active;
  if (!active) {
    setMeter(el.meterL, 0);
    setMeter(el.meterR, 0);
    el.latency.textContent = 'Latency: —';
  }
}

function setMeter(bar, peak) {
  // Map -60..0 dBFS onto 0..100% width.
  const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  const pct = clamp(((db + 60) / 60) * 100, 0, 100);
  bar.style.width = `${pct}%`;
  bar.classList.toggle('hot', db > -6 && db <= -0.5);
  bar.classList.toggle('clip', db > -0.5);
}

// Lists every other tab that's either adjusted by us or currently making sound.
// A captured tab isn't "audible" to Chrome (its own output is silenced while
// we play it), so the two sources have to be merged rather than just querying
// audible tabs.
async function refreshOthers() {
  const [st, audible] = await Promise.all([
    toOffscreen('get-state'),
    chrome.tabs.query({ audible: true }),
  ]);
  const adjusted = new Map((st?.tabs ?? []).map((t) => [t.tabId, t.settings]));
  const ids = new Set([...adjusted.keys(), ...audible.map((t) => t.id)]);
  ids.delete(tab.id);

  const rows = [];
  for (const id of ids) {
    const info = audible.find((t) => t.id === id) ?? (await chrome.tabs.get(id).catch(() => null));
    if (info) rows.push({ info, settings: adjusted.get(id) });
  }
  rows.sort((a, b) => b.info.id - a.info.id); // newest tabs first

  el.othersSection.hidden = rows.length === 0;
  el.others.replaceChildren(...rows.map(otherTabRow));
}

function otherTabRow({ info, settings: s }) {
  const li = document.createElement('li');

  const icon = document.createElement('img');
  icon.className = 'tab-icon';
  icon.alt = '';
  if (info.favIconUrl) icon.src = info.favIconUrl;
  else icon.style.visibility = 'hidden';

  const name = document.createElement('span');
  name.className = 'ellipsis';
  name.textContent = info.title || info.url || `Tab ${info.id}`;
  name.title = 'Switch to this tab';
  name.onclick = async () => {
    await chrome.tabs.update(info.id, { active: true });
    await chrome.windows.update(info.windowId, { focused: true });
  };

  const tag = document.createElement('span');
  tag.className = 'small tag';
  tag.textContent = !s ? 'playing' : s.muted ? 'muted' : `${s.volume.toFixed(0)}%`;
  tag.classList.toggle('adjusted', !!s);

  li.append(icon, name, tag);
  if (s) {
    const btn = document.createElement('button');
    btn.textContent = 'Restore';
    btn.title = 'Restore original audio';
    btn.onclick = () => restore(info.id);
    li.append(btn);
  }
  return li;
}

// Keep the list live while the popup is open: tabs start/stop playing,
// change title, or close.
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (tab && ('audible' in change || 'title' in change || 'favIconUrl' in change)) refreshOthers();
});
chrome.tabs.onRemoved.addListener(() => tab && refreshOthers());

// Poll meters, latency and gain reduction while the popup is open (~20 fps).
async function meterLoop() {
  if (active) {
    const r = await toOffscreen('levels', { tabId: tab.id });
    if (r?.ok && r.controlled) {
      setMeter(el.meterL, r.peaks[0]);
      setMeter(el.meterR, r.peaks[1]);
      const { base, output } = r.latency;
      el.latency.textContent =
        `Latency: ${((base + output) * 1000).toFixed(1)} ms ` +
        `(processing ${(base * 1000).toFixed(1)} + output ${(output * 1000).toFixed(1)})`;
      if (settings.compOn) el.compGr.textContent = `GR ${r.reduction.toFixed(1)} dB`;
    } else if (r?.ok && !r.controlled) {
      active = false; // restored elsewhere (e.g. keyboard shortcut)
      renderStatus();
    }
  }
  setTimeout(meterLoop, 50);
}

// ---- Volume -----------------------------------------------------------------

el.vol.addEventListener('input', () => update({ volume: clampVol(+el.vol.value) }));

// The native slider's step is 0.1 so dragging is smooth, but that makes arrow
// keys too slow. Arrows = 1, Shift+arrows = 0.1, PgUp/Dn = 10.
const ARROWS = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };
el.vol.addEventListener('keydown', (e) => {
  let delta;
  if (e.key in ARROWS) delta = ARROWS[e.key] * (e.shiftKey ? 0.1 : 1);
  else if (e.key === 'PageUp') delta = 10;
  else if (e.key === 'PageDown') delta = -10;
  else return;
  e.preventDefault();
  update({ volume: clampVol(settings.volume + delta) });
});
el.vol.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.1 : 1);
  update({ volume: clampVol(settings.volume + delta) });
}, { passive: false });

el.mute.addEventListener('click', () => update({ muted: !settings.muted }));
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'm' && !['INPUT', 'SELECT'].includes(e.target.tagName)) {
    update({ muted: !settings.muted });
  }
});

document.querySelectorAll('.presets button').forEach((b) =>
  b.addEventListener('click', () => update({ volume: +b.dataset.vol, muted: false })),
);

el.maxVol.addEventListener('change', async () => {
  const max = +el.maxVol.value;
  el.vol.max = max;
  await chrome.storage.sync.set({ maxVolume: max });
  if (settings.volume > max) update({ volume: max });
});

// ---- Channels + balance knob ----------------------------------------------

el.channelMode.addEventListener('change', () => update({ channelMode: el.channelMode.value }));

// The knob works like most audio-software knobs: drag up/down rather than in a
// circle. Pointer capture keeps the drag going even if the mouse leaves the knob.
const setPan = (p) => update({ pan: clamp(Math.round(p), -100, 100) / 100 });
let drag = null;
el.pan.addEventListener('pointerdown', (e) => {
  el.pan.setPointerCapture(e.pointerId);
  drag = { y: e.clientY, start: settings.pan * 100 };
});
el.pan.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const perPx = e.shiftKey ? 0.25 : 1; // 1 balance unit per pixel, Shift = fine
  setPan(drag.start + (drag.y - e.clientY) * perPx);
});
el.pan.addEventListener('pointerup', () => (drag = null));
el.pan.addEventListener('pointercancel', () => (drag = null));
el.pan.addEventListener('dblclick', () => setPan(0));
el.pan.addEventListener('wheel', (e) => {
  e.preventDefault();
  setPan(settings.pan * 100 + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 1 : 5));
}, { passive: false });
el.pan.addEventListener('keydown', (e) => {
  if (e.key in ARROWS) {
    e.preventDefault();
    setPan(settings.pan * 100 + ARROWS[e.key] * (e.shiftKey ? 1 : 5));
  } else if (e.key === 'Home' || e.key === '0') {
    setPan(0);
  }
});

// ---- Compressor -------------------------------------------------------------

// Ratio stepper: a slider that snaps to 5 stops. The dots grow left to right
// so the "more squash" direction is visible at a glance.
const ratioFill = document.createElement('div');
ratioFill.className = 'stepper-fill';
const ratioTrack = document.createElement('div');
ratioTrack.className = 'stepper-track';
ratioTrack.append(ratioFill);
const ratioDots = COMP_RATIOS.map((r, i) => {
  const dot = document.createElement('span');
  dot.className = 'step';
  dot.style.left = `${(i / (COMP_RATIOS.length - 1)) * 100}%`;
  dot.style.setProperty('--d', `${6 + i * 2}px`); // 6, 8, 10, 12, 14 px
  return dot;
});
el.compRatio.append(ratioTrack, ...ratioDots);

function renderRatio() {
  const idx = Math.max(0, COMP_RATIOS.indexOf(settings.compRatio));
  ratioFill.style.width = `${(idx / (COMP_RATIOS.length - 1)) * 100}%`;
  ratioDots.forEach((d, i) => {
    d.classList.toggle('on', i <= idx);
    d.classList.toggle('current', i === idx);
  });
  el.compRatioVal.textContent = `${settings.compRatio}:1`;
  el.compRatio.setAttribute('aria-valuenow', String(settings.compRatio));
  el.compRatio.setAttribute('aria-valuetext', `${settings.compRatio} to 1`);
}

function setRatioIndex(i) {
  const r = COMP_RATIOS[Math.max(0, Math.min(COMP_RATIOS.length - 1, i))];
  if (r !== settings.compRatio) update({ compRatio: r });
}

// Nearest stop to the pointer's x position.
function ratioIndexAt(clientX) {
  const box = el.compRatio.getBoundingClientRect();
  return Math.round(((clientX - box.left) / box.width) * (COMP_RATIOS.length - 1));
}

let ratioDrag = false;
el.compRatio.addEventListener('pointerdown', (e) => {
  ratioDrag = true;
  el.compRatio.setPointerCapture(e.pointerId);
  setRatioIndex(ratioIndexAt(e.clientX));
});
el.compRatio.addEventListener('pointermove', (e) => ratioDrag && setRatioIndex(ratioIndexAt(e.clientX)));
el.compRatio.addEventListener('pointerup', () => (ratioDrag = false));
el.compRatio.addEventListener('pointercancel', () => (ratioDrag = false));
el.compRatio.addEventListener('keydown', (e) => {
  const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
  if (!step) return;
  e.preventDefault();
  setRatioIndex(COMP_RATIOS.indexOf(settings.compRatio) + step);
});
el.compThreshold.addEventListener('input', () => update({ compThreshold: +el.compThreshold.value }));
el.compMakeup.addEventListener('input', () => update({ compMakeup: +el.compMakeup.value }));
el.compOn.addEventListener('click', () => update({ compOn: !settings.compOn }));
el.compAuto.addEventListener('click', () => {
  // Turning auto off: start manual makeup from the current auto value so the
  // level doesn't jump.
  const auto = !settings.compAutoMakeup;
  const patch = { compAutoMakeup: auto };
  if (!auto) patch.compMakeup = Math.round(makeupDb(settings) * 2) / 2;
  update(patch);
});

// ---- Toggles / restore ----------------------------------------------------

el.dc.addEventListener('click', () => update({ dcFilter: !settings.dcFilter }));
el.limiter.addEventListener('click', () => update({ limiter: !settings.limiter }));
el.lowCut.addEventListener('click', () => update({ lowCut: !settings.lowCut }));
el.highCut.addEventListener('click', () => update({ highCut: !settings.highCut }));
el.restore.addEventListener('click', () => restore(tab.id));
// Reset = default settings but keep processing. Restore = stop processing.
el.reset.addEventListener('click', () => update({ ...DEFAULTS }));

// ---- Static icons + shortcuts menu -----------------------------------------

el.reset.innerHTML = `${icon('arrowPath', 16)}<span>Reset</span>`;
el.restore.innerHTML = `${icon('arrowUturnLeft', 16)}<span>Restore original audio</span>`;
$('shortcuts-summary').insertAdjacentHTML('afterbegin', icon('questionMarkCircle', 14));
// Edge redirects chrome:// URLs to edge://, so this works in both browsers.
$('global-shortcuts').addEventListener('click', () =>
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }),
);

// ---- Init -------------------------------------------------------------------

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  el.title.textContent = tab?.title ?? 'Unknown tab';
  if (tab?.favIconUrl) el.favicon.src = tab.favIconUrl;
  else el.favicon.hidden = true;

  const { maxVolume = 200 } = await chrome.storage.sync.get('maxVolume');
  el.maxVol.value = String(maxVolume);
  el.vol.max = maxVolume;

  const st = await toOffscreen('get-state');
  const mine = st?.tabs?.find((t) => t.tabId === tab.id);
  if (mine) {
    active = true;
    settings = { ...DEFAULTS, ...mine.settings };
    if (settings.volume > maxVolume) el.vol.max = 500; // don't clip the slider
  }
  render();
  refreshOthers();
  meterLoop();
}

init();
