// Service worker: housekeeping only. It owns the offscreen document's
// lifecycle, keeps the toolbar badges in sync, and handles keyboard commands.
// The actual audio processing lives in offscreen.js.

const OFFSCREEN_PATH = 'src/offscreen.html';
let creating = null; // guards against two concurrent createDocument() calls

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['USER_MEDIA'],
      justification: 'Process captured tab audio with the Web Audio API.',
    })
    .finally(() => (creating = null));
  await creating;
}

async function closeOffscreen() {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument();
}

// ---- Badges -------------------------------------------------------------
// Tab-specific badge text is reset by Chrome whenever the tab navigates, so we
// remember the controlled tabs in session storage and re-apply on navigation.

function badgeText(t) {
  return t.muted ? 'M' : String(Math.round(t.volume));
}

async function updateBadges(tabs) {
  const { controlled = [] } = await chrome.storage.session.get('controlled');
  const now = new Set(tabs.map((t) => t.tabId));
  for (const old of controlled) {
    if (!now.has(old.tabId)) {
      chrome.action.setBadgeText({ tabId: old.tabId, text: '' }).catch(() => {});
    }
  }
  for (const t of tabs) {
    chrome.action.setBadgeText({ tabId: t.tabId, text: badgeText(t) }).catch(() => {});
    chrome.action
      .setBadgeBackgroundColor({ tabId: t.tabId, color: t.muted ? '#777' : '#d07a1e' })
      .catch(() => {});
  }
  await chrome.storage.session.set({ controlled: tabs });
}

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'complete') return;
  const { controlled = [] } = await chrome.storage.session.get('controlled');
  const t = controlled.find((c) => c.tabId === tabId);
  if (t) chrome.action.setBadgeText({ tabId, text: badgeText(t) }).catch(() => {});
});

// ---- Messages -------------------------------------------------------------
// Every message carries a `target` so the popup, the worker and the offscreen
// document can share chrome.runtime messaging without answering each other's mail.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'background') return false;

  switch (msg.type) {
    case 'ensure-offscreen':
      ensureOffscreen().then(
        () => sendResponse({ ok: true }),
        (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }),
      );
      return true; // keep the channel open for the async response

    case 'tabs-changed':
      updateBadges(msg.tabs);
      // Nothing left to control: free the offscreen page and its AudioContexts.
      if (msg.tabs.length === 0) closeOffscreen();
      return false;
  }
  return false;
});

// ---- Keyboard commands (set keys at chrome://extensions/shortcuts) --------

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab || !(await hasOffscreen())) return;
  const type = command === 'release-tab' ? 'release' : 'toggle-mute';
  chrome.runtime.sendMessage({ target: 'offscreen', type, tabId: tab.id }).catch(() => {});
});
