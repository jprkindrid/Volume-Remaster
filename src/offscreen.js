// Offscreen document: the audio engine.
//
// When Chrome captures a tab's audio, the tab itself goes silent and the audio
// is handed to us as a MediaStream. We route it through a Web Audio graph and
// out to the speakers. "Releasing" just means stopping the capture: Chrome then
// plays the tab's audio normally again, untouched.
//
// Graph per tab (nodes in [brackets] are switched in/out by settings):
//
//   source ─[dc]─ chIn ─┬─ splitter ─┐
//                       └─ monoSum ──┴─ merger ─ panner ─[low cut]─[high cut]─[compressor ─ makeup]─ gain ─[limiter]─ out ─┬─ speakers
//                                                                                                                         └─ meters (L/R)
//
// The compressor sits before the volume gain so moving the volume slider
// doesn't change how hard it compresses. The limiter is last so it catches
// whatever the volume boost and makeup gain add.

import { DEFAULTS, makeupDb } from './shared.js';

/** @type {Map<number, ReturnType<typeof createSession>>} */
const sessions = new Map();

function createSession(tabId, stream, settings) {
  // 'interactive' asks for the smallest output buffer the device allows.
  const ctx = new AudioContext({ latencyHint: 'interactive' });

  const source = ctx.createMediaStreamSource(stream);

  // DC offset filter: a 2nd-order high-pass at 10 Hz. DC is 0 Hz, so it gets
  // removed, while 10 Hz is below anything audible. A Q of 1/√2 gives a flat
  // (Butterworth) response so it doesn't add a bump near the cutoff.
  const dc = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 10, Q: Math.SQRT1_2 });

  // Force everything to stereo first. 'speakers' interpretation means a mono
  // source gets copied to L and R, and 5.1 is properly downmixed.
  const chIn = new GainNode(ctx, {
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  });
  const splitter = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  // A node forced to 1 channel with 'speakers' downmixes stereo as (L + R) / 2.
  const monoSum = new GainNode(ctx, {
    channelCount: 1,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
  });
  const merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 });

  const panner = new StereoPannerNode(ctx);

  // Low cut / high cut: 12 dB-per-octave Butterworth filters. Low cut removes
  // rumble and boominess below 100 Hz; high cut tames hiss/harshness above 13 kHz.
  const lowCut = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 100, Q: Math.SQRT1_2 });
  const highCut = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 10000, Q: Math.SQRT1_2 });

  // Compressor: reduces the level of anything above the threshold by `ratio`
  // (4:1 = every 4 dB over the threshold comes out as 1 dB over). That makes
  // everything quieter overall, so makeup gain brings the level back up.
  const compressor = new DynamicsCompressorNode(ctx, {
    threshold: -24,
    knee: 6, // soft knee: compression eases in over 6 dB around the threshold
    ratio: 4,
    attack: 0.01, // 10 ms to clamp down
    release: 0.25, // 250 ms to let go
  });
  const makeup = new GainNode(ctx);

  const gain = new GainNode(ctx);

  // Brick-wall-ish limiter: stops boosted audio from clipping harshly.
  const limiter = new DynamicsCompressorNode(ctx, {
    threshold: -1,
    knee: 0,
    ratio: 20,
    attack: 0.002,
    release: 0.1,
  });

  const out = new GainNode(ctx);
  const meterSplit = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  const analysers = [0, 1].map(() => new AnalyserNode(ctx, { fftSize: 1024 }));
  const meterBuf = new Float32Array(1024);

  // Fixed connections
  chIn.connect(splitter);
  chIn.connect(monoSum);
  merger.connect(panner);
  compressor.connect(makeup);
  out.connect(ctx.destination);
  out.connect(meterSplit);
  meterSplit.connect(analysers[0], 0);
  meterSplit.connect(analysers[1], 1);

  const s = {
    tabId, stream, ctx, settings: { ...DEFAULTS, ...settings },
    source, dc, chIn, splitter, monoSum, merger, panner, lowCut, highCut, compressor, makeup, gain, limiter, out,
    analysers, meterBuf,
  };

  wireSource(s);
  wireChannels(s);
  wireInserts(s);
  applyCompressor(s, true);
  wireOutput(s);
  applyGain(s, true);
  applyPan(s, true);
  return s;
}

// ---- Switchable parts of the graph ----------------------------------------

function wireSource(s) {
  s.source.disconnect();
  s.dc.disconnect();
  if (s.settings.dcFilter) {
    s.source.connect(s.dc);
    s.dc.connect(s.chIn);
  } else {
    s.source.connect(s.chIn);
  }
}

function wireChannels(s) {
  const { splitter: sp, monoSum, merger: m } = s;
  sp.disconnect();
  monoSum.disconnect();
  // connect(destination, outputIndex, inputIndex)
  switch (s.settings.channelMode) {
    case 'mono':
      monoSum.connect(m, 0, 0);
      monoSum.connect(m, 0, 1);
      break;
    case 'left': // left channel to both ears
      sp.connect(m, 0, 0);
      sp.connect(m, 0, 1);
      break;
    case 'right':
      sp.connect(m, 1, 0);
      sp.connect(m, 1, 1);
      break;
    case 'swap':
      sp.connect(m, 0, 1);
      sp.connect(m, 1, 0);
      break;
    default: // stereo
      sp.connect(m, 0, 0);
      sp.connect(m, 1, 1);
  }
}

// Rebuilds the chain between the balance stage and the volume from whichever
// optional stages are switched on. Each stage is [input node, output node]
// (the compressor's output is its makeup gain).
function wireInserts(s) {
  const { panner, lowCut, highCut, compressor, makeup, gain, settings } = s;
  for (const n of [panner, lowCut, highCut, makeup]) n.disconnect();

  const stages = [];
  if (settings.lowCut) stages.push([lowCut, lowCut]);
  if (settings.highCut) stages.push([highCut, highCut]);
  if (settings.compOn) stages.push([compressor, makeup]);

  let prev = panner;
  for (const [input, output] of stages) {
    prev.connect(input);
    prev = output;
  }
  prev.connect(gain);
}

function applyCompressor(s, immediate = false) {
  const { compRatio, compThreshold } = s.settings;
  const makeupGain = 10 ** (makeupDb(s.settings) / 20); // dB -> linear
  const set = (param, v) =>
    immediate ? (param.value = v) : param.setTargetAtTime(v, s.ctx.currentTime, 0.02);
  set(s.compressor.ratio, compRatio);
  set(s.compressor.threshold, compThreshold);
  set(s.makeup.gain, makeupGain);
}

function wireOutput(s) {
  s.gain.disconnect();
  s.limiter.disconnect();
  if (s.settings.limiter) {
    s.gain.connect(s.limiter);
    s.limiter.connect(s.out);
  } else {
    s.gain.connect(s.out);
  }
}

// Changing a gain instantly makes an audible click ("zipper noise"), so we
// glide to the new value with a ~10 ms time constant instead.
function applyGain(s, immediate = false) {
  const target = s.settings.muted ? 0 : s.settings.volume / 100;
  if (immediate) s.gain.gain.value = target;
  else s.gain.gain.setTargetAtTime(target, s.ctx.currentTime, 0.01);
}

function applyPan(s, immediate = false) {
  if (immediate) s.panner.pan.value = s.settings.pan;
  else s.panner.pan.setTargetAtTime(s.settings.pan, s.ctx.currentTime, 0.01);
}

function applyPatch(s, patch) {
  const prev = s.settings;
  s.settings = { ...prev, ...patch };
  if ('volume' in patch || 'muted' in patch) applyGain(s);
  if ('pan' in patch) applyPan(s);
  if (patch.dcFilter !== undefined && patch.dcFilter !== prev.dcFilter) wireSource(s);
  if (patch.channelMode && patch.channelMode !== prev.channelMode) wireChannels(s);
  if (patch.limiter !== undefined && patch.limiter !== prev.limiter) wireOutput(s);
  if (
    ('lowCut' in patch && patch.lowCut !== prev.lowCut) ||
    ('highCut' in patch && patch.highCut !== prev.highCut) ||
    ('compOn' in patch && patch.compOn !== prev.compOn)
  ) {
    wireInserts(s);
  }
  if (['compOn', 'compRatio', 'compThreshold', 'compMakeup', 'compAutoMakeup'].some((k) => k in patch)) {
    applyCompressor(s);
  }
}

// ---- Capture / release ------------------------------------------------------

async function capture(tabId, streamId, settings) {
  if (sessions.has(tabId)) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  });
  const s = createSession(tabId, stream, settings);
  sessions.set(tabId, s);
  // Fires when the tab is closed or the capture is otherwise killed.
  stream.getAudioTracks()[0]?.addEventListener('ended', () => release(tabId));
}

async function release(tabId) {
  const s = sessions.get(tabId);
  if (!s) return;
  sessions.delete(tabId);
  s.stream.getTracks().forEach((t) => t.stop()); // tab audio goes back to normal
  await s.ctx.close();
  notify();
}

// ---- Readouts ---------------------------------------------------------------

function latencyOf(s) {
  // baseLatency: processing buffer inside the AudioContext.
  // outputLatency: time from the context to the actual audio hardware.
  return { base: s.ctx.baseLatency ?? 0, output: s.ctx.outputLatency ?? 0 };
}

function peaks(s) {
  return s.analysers.map((a) => {
    a.getFloatTimeDomainData(s.meterBuf);
    let peak = 0;
    for (const v of s.meterBuf) peak = Math.max(peak, Math.abs(v));
    return peak;
  });
}

function snapshot() {
  return [...sessions.values()].map((s) => ({
    tabId: s.tabId,
    settings: s.settings,
    latency: latencyOf(s),
  }));
}

// Tell the service worker so it can update badges / close us when idle.
function notify() {
  const tabs = [...sessions.values()].map((s) => ({
    tabId: s.tabId,
    volume: s.settings.volume,
    muted: s.settings.muted,
  }));
  chrome.runtime.sendMessage({ target: 'background', type: 'tabs-changed', tabs }).catch(() => {});
}

// ---- Messages ---------------------------------------------------------------

async function handle(msg) {
  const s = sessions.get(msg.tabId);
  switch (msg.type) {
    case 'get-state':
      return { tabs: snapshot() };
    case 'capture':
      await capture(msg.tabId, msg.streamId, msg.settings);
      notify();
      return { tabs: snapshot() };
    case 'update':
      if (!s) throw new Error('Tab is not controlled');
      applyPatch(s, msg.patch);
      notify();
      return {};
    case 'toggle-mute':
      if (s) {
        applyPatch(s, { muted: !s.settings.muted });
        notify();
      }
      return {};
    case 'release':
      await release(msg.tabId);
      return { tabs: snapshot() };
    case 'levels':
      if (!s) return { controlled: false };
      return {
        controlled: true,
        peaks: peaks(s),
        latency: latencyOf(s),
        // How many dB the compressor is currently pulling down (≤ 0).
        reduction: s.settings.compOn ? s.compressor.reduction : 0,
      };
    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  handle(msg).then(
    (r) => sendResponse({ ok: true, ...r }),
    (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }),
  );
  return true;
});
