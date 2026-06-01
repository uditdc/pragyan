const DEFAULTS = {
  apiBase: "http://127.0.0.1:8787",
  batchSize: 20,
  autoScroll: true,
  scrollCap: 60,
  emptyStop: 3,
};

const els = {
  apiBase: document.getElementById("apiBase"),
  batchSize: document.getElementById("batchSize"),
  autoScroll: document.getElementById("autoScroll"),
  scrollCap: document.getElementById("scrollCap"),
  emptyStop: document.getElementById("emptyStop"),
};
const statusEl = document.getElementById("status");

chrome.storage.local.get(DEFAULTS).then((c) => {
  els.apiBase.value = c.apiBase;
  els.batchSize.value = c.batchSize;
  els.autoScroll.checked = c.autoScroll;
  els.scrollCap.value = c.scrollCap;
  els.emptyStop.value = c.emptyStop;
});

const clamp = (v, lo, hi, fallback) =>
  Math.min(hi, Math.max(lo, Number(v) || fallback));

document.getElementById("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    apiBase: els.apiBase.value.trim().replace(/\/$/, "") || DEFAULTS.apiBase,
    batchSize: clamp(els.batchSize.value, 1, 200, DEFAULTS.batchSize),
    autoScroll: els.autoScroll.checked,
    scrollCap: clamp(els.scrollCap.value, 1, 1000, DEFAULTS.scrollCap),
    emptyStop: clamp(els.emptyStop.value, 1, 50, DEFAULTS.emptyStop),
  });
  statusEl.textContent = "saved";
  setTimeout(() => (statusEl.textContent = ""), 1500);
});
