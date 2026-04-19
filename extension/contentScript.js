// ============================================================
// contentScript.js — Caption Scraper + Local Storage Writer
// Runs inside the Google Meet tab.
//
// TRACK A: Continuously saves every caption to chrome.storage.local
//           (zero API cost, always-on transcript buffer)
// ============================================================

let lastCaption = "";
let captionHealthMissCount = 0;
const HEALTH_MISS_LIMIT = 15; // alert after 15s of no captions

// ── Selector resilience: try 3 known Google Meet caption selectors ──
function getCaptionText() {
  const selectors = [
    '[aria-live="polite"]',      // primary
    '.a4cQT',                    // fallback 1
    '[jsname="tgaKEf"]',         // fallback 2
    '.CNusmb span'               // fallback 3
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el?.innerText?.trim()) {
      captionHealthMissCount = 0; // reset miss counter on success
      return el.innerText.trim();
    }
  }

  captionHealthMissCount++;

  // After 15s of silence, notify background to show "enable captions" banner
  if (captionHealthMissCount === HEALTH_MISS_LIMIT) {
    chrome.runtime.sendMessage({ type: "CAPTIONS_MISSING" });
  }

  return null;
}

// ── Save caption chunk to chrome.storage.local ──
async function saveToStorage(text) {
  const chunk = {
    text,
    timestamp: Date.now()
  };

  const result = await chrome.storage.local.get(["transcriptLog"]);
  const log = result.transcriptLog || [];

  log.push(chunk);

  // Rolling cap: keep max 2000 chunks (~33 min at 1/sec) to avoid storage overflow
  if (log.length > 2000) log.splice(0, log.length - 2000);

  await chrome.storage.local.set({ transcriptLog: log });
}

// ── Main polling loop: 1 second interval ──
setInterval(async () => {
  const text = getCaptionText();

  if (text && text !== lastCaption) {
    lastCaption = text;

    // Save to local storage (TRACK A — always runs)
    await saveToStorage(text);

    // Also notify background for real-time transcript display in side panel
    chrome.runtime.sendMessage({
      type: "NEW_CAPTION",
      payload: { text, timestamp: Date.now() }
    });
  }
}, 1000);

// ── Notify background script when content script loads (re-init on reload) ──
chrome.runtime.sendMessage({ type: "CONTENT_SCRIPT_READY" });
