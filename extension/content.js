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
  let hold = null; // { video, target, timer, fast, previousRate }
  let replaying = false;

  function startHold(video, target, rate) {
    hold = { video, target, timer: null, fast: false, previousRate: video.playbackRate };
    hold.timer = setTimeout(() => {
      const current = hold;
      current.fast = true;
      showBadge(`${rate}x ▶▶`);
      if (!video.paused) {
        video.playbackRate = rate;
        return;
      }
      // Paused: let the player resume it (via Space) so its state stays in sync.
      // The player resets the speed while resuming, so apply ours once playback
      // starts and re-apply it if the player overrides it during the first second.
      const until = performance.now() + 1000;
      current.onRateChange = () => {
        if (hold === current && video.playbackRate !== rate && performance.now() < until) {
          video.playbackRate = rate;
        }
      };
      current.onPlaying = () => {
        if (hold === current) video.playbackRate = rate;
      };
      video.addEventListener("ratechange", current.onRateChange);
      video.addEventListener("playing", current.onPlaying, { once: true });
      video.playbackRate = rate;
      tapSpace(video, current.target);
    }, HOLD_DELAY_MS);
  }

  function stopFast(state) {
    const { video } = state;
    if (state.onRateChange) video.removeEventListener("ratechange", state.onRateChange);
    if (state.onPlaying) video.removeEventListener("playing", state.onPlaying);
    video.playbackRate = state.previousRate;
    hideBadge();
  }

  function endHold() {
    if (!hold) return;
    const state = hold;
    const { video, target, timer, fast } = state;
    hold = null;
    clearTimeout(timer);
    if (fast) {
      stopFast(state);
    } else {
      tapSpace(video, target);
    }
  }

  // A short tap: hand the Space press back to the player so it toggles play/pause
  // itself and shows its own controls (elapsed time, etc.). If the player ignores
  // the replayed key, toggle the video directly as a fallback.
  function tapSpace(video, target) {
    const wasPaused = video.paused;
    replayKey(target, " ", "Space", 32);
    setTimeout(() => {
      if (video.paused !== wasPaused) return; // The player handled it.
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    }, 100);
  }

  // Send a key press to the player without our own listeners intercepting it.
  function replayKey(target, key, code, keyCode) {
    const node = target && target.isConnected ? target : document.activeElement || document.body;
    const init = { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true };
    replaying = true;
    try {
      node.dispatchEvent(new KeyboardEvent("keydown", init));
      node.dispatchEvent(new KeyboardEvent("keyup", init));
    } finally {
      replaying = false;
    }
  }

  function isBuffered(video, time) {
    const ranges = video.buffered;
    for (let i = 0; i < ranges.length; i++) {
      if (time >= ranges.start(i) && time <= ranges.end(i)) return true;
    }
    return false;
  }

  // Wait until the player moves the video (or give up after a short while).
  function waitForSeek(video, from) {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        video.removeEventListener("seeking", done);
        resolve();
      };
      // The player may seek a little after the key press, so give it up to a second.
      const timer = setTimeout(done, 1000);
      if (video.currentTime !== from) done();
      else video.addEventListener("seeking", done);
    });
  }

  // Wait until the video has finished seeking and has data to play (or give up after 3 s).
  function waitForReady(video) {
    return new Promise((resolve) => {
      const events = ["seeked", "canplay", "playing"];
      const check = () => {
        if (video.seeking || video.readyState < 3) return;
        clearTimeout(timer);
        for (const type of events) video.removeEventListener(type, check);
        // One more tick so the player's own handlers for these events run before us.
        setTimeout(resolve, 50);
      };
      const timer = setTimeout(() => {
        for (const type of events) video.removeEventListener(type, check);
        resolve();
      }, 3000);
      for (const type of events) video.addEventListener(type, check);
      check();
    });
  }

  // Seeking by setting currentTime works inside the loaded part of the video, but the
  // player only downloads from where it thinks playback is. Jumping back to a part that
  // was never loaded therefore stalls forever. In that case let the player seek back
  // itself with its own arrow key (so it downloads that part), wait for it to finish,
  // then land on our exact time, which is now just ahead of the player's position.
  let seekJob = null; // { video, dest }

  function seekTo(video, dest, target) {
    if (seekJob && seekJob.video === video) {
      seekJob.dest = dest;
      return;
    }
    if (dest >= video.currentTime || isBuffered(video, dest)) {
      video.currentTime = dest;
      return;
    }
    const job = (seekJob = { video, dest });
    (async () => {
      try {
        // More presses can arrive meanwhile and move job.dest further back.
        for (let round = 0; round < 5 && video.currentTime > job.dest; round++) {
          let ignored = false;
          for (let i = 0; i < 30 && video.currentTime > job.dest; i++) {
            const before = video.currentTime;
            replayKey(target, "ArrowLeft", "ArrowLeft", 37);
            await waitForSeek(video, before);
            if (video.currentTime >= before) {
              ignored = true; // The player ignored the key.
              break;
            }
          }
          if (ignored) break;
          // Let the player finish its own seek first, or it overrides our exact time.
          await waitForReady(video);
        }
      } finally {
        seekJob = null;
        video.currentTime = job.dest;
      }
    })();
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
    if (replaying) return;
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || isTyping(event)) {
      return;
    }

    if (isSpace(event) && !event.shiftKey && (hold || settings.holdRate > 0)) {
      const video = hold ? hold.video : findVideo();
      if (!video) return;
      // We handle play/pause ourselves, so the player must not toggle it too.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat && !hold) startHold(video, event.composedPath ? event.composedPath()[0] : event.target, settings.holdRate);
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
    const from = seekJob && seekJob.video === video ? seekJob.dest : video.currentTime;
    const target = event.composedPath ? event.composedPath()[0] : event.target;
    seekTo(video, Math.max(0, Math.min(limit, from + delta)), target);
  }, true);

  window.addEventListener("keyup", (event) => {
    if (replaying) return;
    if (!hold || !isSpace(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    endHold();
  }, true);

  // If focus leaves while Space is held, keyup never arrives: restore the speed without toggling.
  window.addEventListener("blur", () => {
    if (!hold) return;
    const state = hold;
    hold = null;
    clearTimeout(state.timer);
    if (state.fast) stopFast(state);
  });
})();
