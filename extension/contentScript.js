// ============================================================
// contentScript.js — Caption Scraper + Local Storage Writer
// Runs inside the Google Meet tab.
//
// Uses MutationObserver (zero-latency) + setInterval fallback.
// Tries multiple selectors since Google Meet's DOM changes often.
// ============================================================

let lastCaption = "";
let captionMissSeconds = 0;
const HEALTH_MISS_LIMIT = 20; // warn after 20s of no captions found

// ── All known Google Meet caption selectors (2024-2026) ──
const CAPTION_SELECTORS = [
  // Most common: the main caption text block
  '[jsname="YSxPC"]',
  '[jsname="tgaKEf"]',

  // Caption container spans
  '.a4cQT',
  '.CNusmb',
  '.CNusmb span',
  '.iOAmFf',

  // Aria-live regions (broadest fallback)
  '[aria-live="polite"]',
  '[aria-live="assertive"]',

  // Text content blocks inside subtitles panel
  '.TBMuR',
  '.bj2sDe',
];

function readCaptionText() {
  for (const sel of CAPTION_SELECTORS) {
    try {
      const el = document.querySelector(sel);
      const text = el?.innerText?.trim() || el?.textContent?.trim();
      if (text && text.length > 2) return text;
    } catch (_) {}
  }
  return null;
}

// ── Process a new caption string  ──
async function processCaption(text) {
  if (!text || text === lastCaption) return;

  if (lastCaption && lastCaption.length > 10 && text.startsWith(lastCaption.slice(0, -5))) {
    lastCaption = text;
    return;
  }

  lastCaption = text;
  captionMissSeconds = 0;

  const chunk = { text, timestamp: Date.now() };

  // Save to chrome.storage.local (TRACK A — always-on transcript buffer)
  const result = await chrome.storage.local.get(["transcriptLog"]);
  const log    = result.transcriptLog || [];
  log.push(chunk);
  if (log.length > 2000) log.splice(0, log.length - 2000); // rolling cap
  await chrome.storage.local.set({ transcriptLog: log });

  // Forward to side panel for live display
  chrome.runtime.sendMessage({ type: "NEW_CAPTION", payload: chunk });
}

// ══════════════════════════════════════════════════════════
// MutationObserver — watches for DOM changes in caption area
// More reliable than setInterval; fires instantly on change
// ══════════════════════════════════════════════════════════

let observer = null;

function startObserver() {
  if (observer) return;

  observer = new MutationObserver(() => {
    const text = readCaptionText();
    if (text) processCaption(text);
  });

  // Observe the whole subtitles region if we can find it, else observe body
  const subtitleRoot =
    document.querySelector('[data-subtitle-container]') ||
    document.querySelector('.aJgDEd') ||   // subtitle region div
    document.querySelector('.crqnQb') ||   // another known container
    document.body;

  observer.observe(subtitleRoot, {
    childList:     true,
    subtree:       true,
    characterData: true,
  });

  console.log("[MeetSense] MutationObserver attached to:", subtitleRoot.tagName || "body");
}

// ══════════════════════════════════════════════════════════
// setInterval fallback — health check + catches edge cases
// ══════════════════════════════════════════════════════════

let healthInterval = null;

function startHealthCheck() {
  if (healthInterval) return;

  healthInterval = setInterval(() => {
    const text = readCaptionText();

    if (text) {
      processCaption(text); // catches anything observer might miss
      captionMissSeconds = 0;
    } else {
      captionMissSeconds++;
      if (captionMissSeconds >= HEALTH_MISS_LIMIT) {
        captionMissSeconds = 0; // reset so it doesn't spam
        chrome.runtime.sendMessage({ type: "CAPTIONS_MISSING" });
      }
    }
  }, 1000);
}

// ══════════════════════════════════════════════════════════
// Wait for Meet to fully load before attaching observer
// (DOM may not be ready immediately on injection)
// ══════════════════════════════════════════════════════════

function waitForMeetLoad(retries = 30) {
  // Check if the Meet call UI is loaded (look for known Meet elements)
  const loadIndicators = [
    '[data-call-ended]',
    '[data-allocation-index]',
    '.crqnQb',
    '.Tmb7Fd',  // control bar
    '[jscontroller="LcYFW"]',
  ];

  const meetLoaded = loadIndicators.some(sel => document.querySelector(sel));

  if (meetLoaded || retries <= 0) {
    console.log("[MeetSense] Meet UI detected. Starting caption observer.");
    startObserver();
    startHealthCheck();
    chrome.runtime.sendMessage({ type: "CONTENT_SCRIPT_READY" });
  } else {
    setTimeout(() => waitForMeetLoad(retries - 1), 1000);
  }
}

// ══════════════════════════════════════════════════════════
// Boot
// ══════════════════════════════════════════════════════════

// Also handle the case where Meet is already loaded (extension reload)
if (document.readyState === "complete") {
  waitForMeetLoad();
} else {
  window.addEventListener("load", waitForMeetLoad, { once: true });
}
