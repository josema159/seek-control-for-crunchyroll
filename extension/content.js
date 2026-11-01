(() => {
  "use strict";

  const DEFAULTS = { arrowSeconds: 5, fineSeconds: 1, holdRate: 2 };
  const HOLD_RATES = [0, 1.5, 2, 3]; // 0 turns the hold-Space feature off.
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
    settings.holdRate = validRate(saved.holdRate);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.arrowSeconds) {
      settings.arrowSeconds = validSeconds(changes.arrowSeconds.newValue, DEFAULTS.arrowSeconds);
    }
    if (changes.fineSeconds) {
      settings.fineSeconds = validSeconds(changes.fineSeconds.newValue, DEFAULTS.fineSeconds);
    }
    if (changes.holdRate) {
      settings.holdRate = validRate(changes.holdRate.newValue);
    }
  });

  function validSeconds(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0.1 && number <= 120 ? number : fallback;
  }

  function validRate(value) {
    const number = Number(value);
    return HOLD_RATES.includes(number) ? number : DEFAULTS.holdRate;
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

  // Hold Space for fast playback, like YouTube. A short tap still toggles play/pause.
  const HOLD_DELAY_MS = 300;
  let hold = null; // { video, timer, fast, previousRate }

  function startHold(video, rate) {
    hold = { video, timer: null, fast: false, previousRate: video.playbackRate };
    hold.timer = setTimeout(() => {
      hold.fast = true;
      video.playbackRate = rate;
      if (video.paused) video.play().catch(() => {});
      showBadge(`${rate}x ▶▶`);
    }, HOLD_DELAY_MS);
  }

  function endHold() {
    if (!hold) return;
    const { video, timer, fast, previousRate } = hold;
    hold = null;
    clearTimeout(timer);
    if (fast) {
      video.playbackRate = previousRate;
      hideBadge();
    } else if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  let badge = null;

  function showBadge(text) {
    if (!badge) {
      badge = document.createElement("div");
      badge.style.cssText = "position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
        "padding:6px 14px;border-radius:16px;background:rgba(0,0,0,.65);color:#fff;" +
        "font:600 15px/1.2 system-ui,sans-serif;pointer-events:none;";
    }
    badge.textContent = text;
    // Inside the fullscreen element so it stays visible in fullscreen.
    (document.fullscreenElement || document.body || document.documentElement).appendChild(badge);
  }

  function hideBadge() {
    if (badge) badge.remove();
  }

  function isSpace(event) {
    return event.key === " " || event.code === "Space";
  }

  // The capture phase lets us run before the player's own shortcuts.
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || isTyping(event)) {
      return;
    }

    if (isSpace(event) && !event.shiftKey && (hold || settings.holdRate > 0)) {
      const video = hold ? hold.video : findVideo();
      if (!video) return;
      // We handle play/pause ourselves, so the player must not toggle it too.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat && !hold) startHold(video, settings.holdRate);
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

  window.addEventListener("keyup", (event) => {
    if (!hold || !isSpace(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    endHold();
  }, true);

  // If focus leaves while Space is held, keyup never arrives: restore the speed without toggling.
  window.addEventListener("blur", () => {
    if (!hold) return;
    clearTimeout(hold.timer);
    if (hold.fast) {
      hold.video.playbackRate = hold.previousRate;
      hideBadge();
    }
    hold = null;
  });
})();
