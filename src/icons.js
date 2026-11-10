// Heroicons v2 (outline, 24×24) by Tailwind Labs, MIT license: https://heroicons.com
// Inlined as path data so they inherit `currentColor` and need no network or build step.

export const PATHS = {
  speakerWave:
    'M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z',
  speakerXMark:
    'M17.25 9.75 19.5 12m0 0 2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6 4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z',
  arrowPath:
    'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99',
  arrowUturnLeft: 'M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3',
  questionMarkCircle:
    'M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z',
};

/** Returns an inline <svg> string for one of the PATHS. */
export function icon(name, size = 18) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">` +
    `<path stroke-linecap="round" stroke-linejoin="round" d="${PATHS[name]}"/></svg>`
  );
}
