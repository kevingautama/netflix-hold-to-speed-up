const DEFAULTS = { multiplier: 2, delay: 200, autoSkip: true };
let { multiplier, delay, autoSkip } = DEFAULTS;

let active = null; // which input started the speed-up: "key" | "mouse" | null
let savedRate = null;
let keyTimer = null;
let keyDown = false;
let mouseTimer = null;
let suppressClick = false;
let badge = null;

chrome.storage.sync.get(DEFAULTS, (s) => ({ multiplier, delay, autoSkip } = s));
chrome.storage.sync.onChanged.addListener((c) => {
  if (c.delay) delay = c.delay.newValue;
  if (c.autoSkip) autoSkip = c.autoSkip.newValue;
  if (c.multiplier) {
    multiplier = c.multiplier.newValue;
    const v = getVideo();
    if (active && v) {
      v.playbackRate = multiplier;
      showBadge(true);
    }
  }
});

// Both sites are SPAs with preview videos on browse pages; only act on the player page.
// Netflix: /watch/<id>. Disney+: /video/<id> or /play/<id>, optionally behind a locale prefix (/en-gb/play/...).
const WATCH = location.hostname.endsWith("disneyplus.com") ? /\/(video|play)\// : /^\/watch/;
const onWatch = () => WATCH.test(location.pathname);
const getVideo = () => {
  if (!onWatch()) return null;
  // Disney+ keeps extra hidden <video>s around; the first one isn't necessarily the one on screen.
  // ponytail: "playing, else has played" heuristic; key off the visible player container if it picks wrong.
  const vs = [...document.querySelectorAll("video")];
  return vs.find((v) => !v.paused) || vs.find((v) => v.currentTime > 0) || vs[0] || null;
};

// Clicks on player controls (buttons, seek bar) keep their normal behaviour.
const onVideoArea = (t) =>
  getVideo() && t instanceof Element && !t.closest('button, a, input, [role="button"], [role="slider"]');

const isTyping = (t) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const block = (e) => {
  e.preventDefault();
  e.stopImmediatePropagation();
};

function showBadge(on) {
  if (!badge) {
    badge = document.createElement("div");
    badge.style.cssText =
      "position:fixed;top:32px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;" +
      "padding:8px 18px;border-radius:999px;background:rgba(20,20,20,.75);backdrop-filter:blur(8px);" +
      "color:#fff;font:600 18px/1 system-ui,sans-serif;letter-spacing:.02em;box-shadow:0 4px 20px rgba(0,0,0,.4)";
  }
  if (!on) return badge.remove();
  // Wall-clock end time if playback stays at this speed.
  const v = getVideo();
  const left = v ? (v.duration - v.currentTime) / multiplier : NaN;
  const end = Number.isFinite(left)
    ? ` · ends ${new Date(Date.now() + left * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : "";
  badge.textContent = `${multiplier}× ▸▸${end}`;
  // In fullscreen only the fullscreen element's subtree is rendered.
  (document.fullscreenElement || document.body).append(badge);
}

function startSpeed(src) {
  const v = getVideo();
  if (!v || active) return;
  active = src;
  savedRate = v.playbackRate;
  v.playbackRate = multiplier;
  showBadge(true);
}

function stopSpeed(src) {
  if (!active || (src && src !== active)) return;
  const v = getVideo();
  if (v) v.playbackRate = savedRate;
  active = savedRate = null;
  showBadge(false);
}

// --- Space: hold = speed, short tap = play/pause ---
// Capture phase on window so we run before the player's own Space handler.
window.addEventListener(
  "keydown",
  (e) => {
    if (e.code !== "Space" || isTyping(e.target) || !getVideo()) return;
    block(e);
    if (keyDown) return; // ignore key auto-repeat
    keyDown = true;
    keyTimer = setTimeout(() => {
      keyTimer = null;
      startSpeed("key");
    }, delay);
  },
  true
);

window.addEventListener(
  "keyup",
  (e) => {
    if (e.code !== "Space" || !keyDown) return;
    block(e);
    keyDown = false;
    if (keyTimer) {
      // Short tap: do the play/pause we suppressed.
      clearTimeout(keyTimer);
      keyTimer = null;
      const v = getVideo();
      if (v) v.paused ? v.play() : v.pause();
    } else {
      stopSpeed("key");
    }
  },
  true
);

// --- Left click: hold = speed, short click passes through to the player untouched ---
window.addEventListener(
  "mousedown",
  (e) => {
    suppressClick = false;
    if (e.button !== 0 || !onVideoArea(e.target)) return;
    mouseTimer = setTimeout(() => {
      mouseTimer = null;
      suppressClick = true;
      startSpeed("mouse");
    }, delay);
  },
  true
);

// After a hold, swallow the release so the player doesn't treat it as a play/pause click.
for (const type of ["pointerup", "mouseup", "click"]) {
  window.addEventListener(
    type,
    (e) => {
      if (e.button !== 0) return;
      if (type === "mouseup") {
        clearTimeout(mouseTimer);
        mouseTimer = null;
        stopSpeed("mouse");
      }
      if (suppressClick) {
        block(e);
        if (type === "click") suppressClick = false;
      }
    },
    true
  );
}

// --- Scroll while holding: step through the speed presets ---
const PRESETS = [1.25, 1.5, 1.75, 2, 2.5, 3, 4]; // ponytail: copy of popup.js PRESETS, keep in sync
let lastWheel = 0;
window.addEventListener(
  "wheel",
  (e) => {
    const v = getVideo();
    if (!active || !v) return;
    block(e);
    // ponytail: trackpads fire dozens of wheel events per swipe; one step per 150ms keeps it controllable.
    if (e.timeStamp - lastWheel < 150) return;
    lastWheel = e.timeStamp;
    // Works from custom speeds too: jump to the next preset above/below.
    const next = e.deltaY < 0 ? PRESETS.find((p) => p > multiplier) : PRESETS.findLast((p) => p < multiplier);
    if (!next) return;
    multiplier = v.playbackRate = next;
    showBadge(true);
    chrome.storage.sync.set({ multiplier: next });
  },
  { capture: true, passive: false }
);

// Releasing outside the window / alt-tabbing must not leave playback stuck fast.
window.addEventListener("blur", () => {
  keyDown = false;
  clearTimeout(keyTimer);
  clearTimeout(mouseTimer);
  keyTimer = mouseTimer = null;
  stopSpeed();
});

// --- Auto-skip: both players only render these buttons while skipping is possible ---
// Netflix: player-skip-intro / -recap / -preplay and next-episode-seamless-button(-draining) during credits.
// Disney+: skip__button (intro/recap/credits) and the up-next play button.
// ponytail: Disney+ class names are unversioned and change with player redesigns; update here if skipping stops.
const SKIP =
  '[data-uia^="player-skip"], [data-uia^="next-episode-seamless-button"], ' +
  '.skip__button, [data-testid="up-next-play-button"]';
const clicked = new WeakSet();
new MutationObserver(() => {
  if (!autoSkip || !onWatch()) return;
  const b = document.querySelector(SKIP);
  if (b && !clicked.has(b)) {
    clicked.add(b);
    b.click();
  }
}).observe(document.documentElement, { childList: true, subtree: true });
