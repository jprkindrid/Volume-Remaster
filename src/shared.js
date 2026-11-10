// Settings shared by the popup and the audio engine.
export const DEFAULTS = Object.freeze({
  volume: 100, // percent; gain = volume / 100
  muted: false,
  channelMode: 'stereo', // stereo | mono | left | right | swap
  pan: 0, // -1 (left) .. 1 (right)
  dcFilter: false,
  lowCut: false, // 100 Hz high-pass
  highCut: false, // 13 kHz low-pass
  limiter: false,
  compOn: false,
  compRatio: 4, // 2 | 4 | 6 | 8 | 10 (as in "4:1")
  compThreshold: -24, // dBFS where compression starts
  compMakeup: 0, // dB, used when compAutoMakeup is off
  compAutoMakeup: true,
});

export const COMP_RATIOS = [2, 4, 6, 8, 10];

// Auto makeup gain. A signal at 0 dBFS that is T dB above threshold comes out
// T/R dB above it instead, so it loses T·(1 − 1/R) dB. Making all of that back
// would push peaks to the ceiling, so the common rule of thumb is half of it.
export function autoMakeupDb(threshold, ratio) {
  return (-threshold * (1 - 1 / ratio)) / 2;
}

export function makeupDb(settings) {
  if (!settings.compOn) return 0;
  return settings.compAutoMakeup
    ? autoMakeupDb(settings.compThreshold, settings.compRatio)
    : settings.compMakeup;
}
