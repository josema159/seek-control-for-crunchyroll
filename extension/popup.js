"use strict";

const DEFAULTS = { arrowSeconds: 5, fineSeconds: 1 };

const form = document.querySelector("#settings-form");
const arrowInput = document.querySelector("#arrow-seconds");
const fineInput = document.querySelector("#fine-seconds");
const resetButton = document.querySelector("#reset");
const status = document.querySelector("#status");
let statusTimer = null;

// Look up a translated string from _locales/, falling back to the key itself.
function t(key) {
  return chrome.i18n.getMessage(key) || key;
}

// Fill every element marked with data-i18n using the browser's language.
function localize() {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  for (const element of document.querySelectorAll("[data-i18n]")) {
    const message = chrome.i18n.getMessage(element.dataset.i18n);
    if (message) element.textContent = message;
  }
}

function showStatus(messageKey) {
  status.textContent = t(messageKey);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { status.textContent = ""; }, 2500);
}

function save(values, messageKey) {
  chrome.storage.local.set(values, () => {
    showStatus(chrome.runtime.lastError ? "statusSaveError" : messageKey);
  });
}

localize();

chrome.storage.local.get(DEFAULTS, (saved) => {
  arrowInput.value = saved.arrowSeconds;
  fineInput.value = saved.fineSeconds;
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const arrowSeconds = Number(arrowInput.value);
  const fineSeconds = Number(fineInput.value);
  const valid = [arrowSeconds, fineSeconds].every((n) => Number.isFinite(n) && n >= 0.1 && n <= 120);

  if (!valid) {
    showStatus("statusInvalid");
    return;
  }

  save({ arrowSeconds, fineSeconds }, "statusSaved");
});

resetButton.addEventListener("click", () => {
  arrowInput.value = DEFAULTS.arrowSeconds;
  fineInput.value = DEFAULTS.fineSeconds;
  save({ ...DEFAULTS }, "statusReset");
});
