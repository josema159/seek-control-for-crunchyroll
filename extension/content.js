(() => {
  "use strict";

  const DEFAULTS = { arrowSeconds: 5, fineSeconds: 1 };
  let settings = { ...DEFAULTS };

  // Key -> [setting to use, direction, allows Shift].
  // "<" and ">" cover the dedicated <> key on Spanish layouts and Shift+, / Shift+. on US layouts.
  const KEYS = {
    ArrowLeft: ["arrowSeconds", -1, false],
    ArrowRight: ["arrowSeconds", 1, false],
    ",": ["fineSeconds", -1, false],
    ".": ["fineSeconds", 1, false],
    "<": ["fineSeconds", -1, true],
    ">": ["fineSeconds", 1, true],
  };

  // Load settings and keep them in sync with the popup.
  chrome.storage.local.get(DEFAULTS, (saved) => {
    settings.arrowSeconds = validSeconds(saved.arrowSeconds, DEFAULTS.arrowSeconds);
    settings.fineSeconds = validSeconds(saved.fineSeconds, DEFAULTS.fineSeconds);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.arrowSeconds) {
      settings.arrowSeconds = validSeconds(changes.arrowSeconds.newValue, DEFAULTS.arrowSeconds);
    }
    if (changes.fineSeconds) {
      settings.fineSeconds = validSeconds(changes.fineSeconds.newValue, DEFAULTS.fineSeconds);
    }
  });

  function validSeconds(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0.1 && number <= 120 ? number : fallback;
  }

  function isTyping(event) {
    // composedPath()[0] is the real element even when it lives inside a shadow DOM.
    const target = event.composedPath ? event.composedPath()[0] : event.target;
    if (!(target instanceof Element)) return false;
    if (target.isContentEditable) return true;
    return Boolean(target.closest('input, textarea, select, [role="textbox"]'));
  }

  // Pick the episode video rather than a preview: prefer the one that is
  // playing, then the largest one on screen.
  function findVideo() {
    const videos = [...document.querySelectorAll("video")].filter((v) => Number.isFinite(v.currentTime));
    if (videos.length <= 1) return videos[0] || null;

    const area = (v) => {
      const rect = v.getBoundingClientRect();
      return rect.width * rect.height;
    };
    return videos.sort((a, b) => (b.paused === a.paused ? 0 : a.paused ? 1 : -1) || area(b) - area(a))[0];
  }

  // The capture phase lets us run before the player's own shortcuts.
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || isTyping(event)) {
      return;
    }

    const mapping = KEYS[event.key];
    if (!mapping) return;

    const [settingName, direction, allowsShift] = mapping;
    if (event.shiftKey && !allowsShift) return;

    const video = findVideo();
    if (!video) return;

    // Cancel the player's own seek so it doesn't add to ours.
    event.preventDefault();
    event.stopImmediatePropagation();

    const delta = direction * settings[settingName];
    const limit = Number.isFinite(video.duration) ? video.duration : Infinity;
    video.currentTime = Math.max(0, Math.min(limit, video.currentTime + delta));
  }, true);
})();
