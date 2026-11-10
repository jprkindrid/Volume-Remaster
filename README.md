# Volume Remaster

A Chrome / Edge (Manifest V3) extension for per-tab audio control.

## Features

- **Per-tab volume** from 0–500%, in 0.1% steps (slider, arrow keys, scroll wheel), with a dB readout
- **Mute** button (or press `M` in the popup)
- Starts adjusting a tab automatically the first time you touch any control
- **Restore original audio**: stops processing and hands the tab's audio back to the browser untouched
- **Stereo mode** dropdown: Stereo / Mono (L+R)/2 / Left only / Right only / Swap L↔R
- **Balance knob**: drag up/down or scroll, Shift for fine steps, double-click to center
- **Compressor** with its own on/off, ratio 2/4/6/8/10:1, threshold, makeup gain (auto or manual) and a live gain-reduction readout
- **Low Filter (100 Hz) / High Filter (10 kHz)** toggles
- **DC offset filter** (10 Hz Butterworth high-pass)
- **Reset** puts every setting back to default while keeping the tab adjusted
- **Limiter** so boosted audio doesn't clip harshly
- Keyboard shortcuts listed in a collapsible **Shortcuts** menu at the bottom of the popup
- **L/R peak meters** and a **latency** readout
- **Toolbar badge** showing each adjusted tab's volume
- **Multiple tabs**: lists the other adjusted tabs, lets you jump to or restore each one
- **Keyboard shortcuts** (unassigned by default) for mute and restore, set at `chrome://extensions/shortcuts` / `edge://extensions/shortcuts`
- Dark gray / orange theme, light or dark following the OS

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`)
2. Turn on **Developer mode**
3. Click **Load unpacked** and pick this folder
4. After you edit code, click the reload ↻ icon on the extension card (and reopen the popup)

## How it works

```
popup.js ──(getMediaStreamId)──► stream ID ──► offscreen.js ──getUserMedia──► Web Audio graph ──► speakers
    ▲                                              │
    └──────── state / levels / latency ◄───────────┘
background.js: creates/closes the offscreen doc, badges, keyboard commands
```

- `chrome.tabCapture` grabs a tab's audio. Once a tab is captured, **Chrome mutes its normal output**, so the
  extension has to play the audio itself. That's why the processed signal goes to `ctx.destination`.
- Restoring stops the captured tracks, and Chrome then plays the tab normally again.
- An **offscreen document** hosts the `AudioContext`, because MV3 service workers have no Web Audio and get
  shut down when idle.

Audio graph per tab (in `src/offscreen.js`):

```
source ─[DC filter]─ to-stereo ─ channel router ─ balance ─[low cut]─[high cut]─[compressor ─ makeup]─ volume ─[limiter]─ out ─► speakers + meters
```

## Notes and limitations

- Browser-internal pages (`chrome://`, `edge://`, the web store) can't be captured.
- The latency figure is the `AudioContext`'s own latency (`baseLatency + outputLatency`). It doesn't
  include the extra delay from the capture pipeline itself, which the browser doesn't report.
- If the extension is reloaded or crashes, captured tabs go back to normal playback automatically.
- The logo source is `icons/icon.svg`, which uses the Asmath Bold font as live text. To regenerate the PNGs after
  editing it, open `icons/render.html` in Edge/Chrome, pick the SVG, and save the four files into `icons/`.
  This needs Asmath installed. Converting the text to outlines in your vector editor would remove that requirement.

## Credits

Icons: [Heroicons](https://heroicons.com) by Tailwind Labs, MIT license (inlined in `src/icons.js`).
