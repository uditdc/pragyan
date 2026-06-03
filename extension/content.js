(function () {
  const { TWEET, parseTweet } = globalThis.PragyanSelectors;

  const DEFAULTS = {
    apiBase: "http://127.0.0.1:8787",
    batchSize: 20,
    flushMs: 3000,
    autoScroll: true,
    scrollCap: 60,
    emptyStop: 3,
    scrollStep: 0.8,
    minDelayMs: 800,
    maxDelayMs: 1800,
    settleTimeoutMs: 2500,
    settleIntervalMs: 150,
    reloadOnDone: true,
    breakMs: 300000,
  };

  const captured = new Map();
  let pending = [];
  let sent = 0;
  let config = { ...DEFAULTS };
  let running = false;
  let stopRequested = false;
  let state = "idle";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = (a, b) => a + Math.random() * (b - a);

  function debounce(fn, ms) {
    let timer;
    return () => {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }

  function harvest() {
    let added = 0;
    for (const article of document.querySelectorAll(TWEET)) {
      let post = null;
      try {
        post = parseTweet(article);
      } catch {
        post = null;
      }
      if (!post || !post.id || captured.has(post.id)) continue;
      captured.set(post.id, true);
      post.harvested_at = new Date().toISOString();
      pending.push(post);
      added++;
    }
    if (added) {
      render();
      if (pending.length >= config.batchSize) flush();
    }
  }

  function flush() {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    render();
    chrome.runtime.sendMessage({ type: "ingest", posts: batch }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        pending = batch.concat(pending);
        render(true);
        return;
      }
      sent += resp.data && typeof resp.data.received === "number" ? resp.data.received : batch.length;
      render();
    });
  }

  async function settle(timeout = config.settleTimeoutMs, interval = config.settleIntervalMs) {
    const startHeight = document.body.scrollHeight;
    const startCount = document.querySelectorAll(TWEET).length;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await sleep(interval);
      if (
        document.body.scrollHeight !== startHeight ||
        document.querySelectorAll(TWEET).length !== startCount
      ) {
        await sleep(interval);
        return;
      }
    }
  }

  async function autoScrollLoop() {
    if (running) return;
    running = true;
    stopRequested = false;
    state = "scrolling";
    render();

    let scrolls = 0;
    let emptyStreak = 0;
    while (!stopRequested && scrolls < config.scrollCap && emptyStreak < config.emptyStop) {
      const before = captured.size;
      window.scrollBy(0, Math.round(window.innerHeight * config.scrollStep));
      scrolls++;
      await settle();
      harvest();
      emptyStreak = captured.size > before ? 0 : emptyStreak + 1;
      render();
      await sleep(jitter(config.minDelayMs, config.maxDelayMs));
    }

    flush();
    state = stopRequested ? "paused" : "done";
    render();

    if (state === "done" && config.autoScroll && config.reloadOnDone) {
      state = "break";
      const until = Date.now() + config.breakMs;
      while (Date.now() < until && !stopRequested && config.autoScroll && config.reloadOnDone) {
        breakRemainingMs = until - Date.now();
        render();
        await sleep(1000);
      }
      if (!stopRequested && config.autoScroll && config.reloadOnDone) {
        location.reload();
        return;
      }
      state = stopRequested ? "paused" : "done";
    }

    running = false;
    render();
  }

  function startAuto() {
    if (!running) void autoScrollLoop();
  }
  function stopAuto() {
    if (running) stopRequested = true;
  }

  const STATE_ICON = { idle: "⦿", scrolling: "▶", paused: "⏸", done: "✓", break: "⏲", error: "✕" };
  let badge;
  let breakRemainingMs = 0;
  function render(error) {
    if (!badge) {
      badge = document.createElement("div");
      badge.style.cssText =
        "position:fixed;bottom:12px;right:12px;z-index:99999;background:#16171c;" +
        "font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;padding:6px 10px;" +
        "border:1px solid #2b2e38;border-radius:6px;opacity:.92;cursor:pointer;user-select:none";
      badge.title = "click to pause/resume auto-scroll";
      badge.addEventListener("click", () => (running ? stopAuto() : startAuto()));
      document.documentElement.appendChild(badge);
    }
    badge.style.color = error ? "#d08176" : state === "break" ? "#c8a45c" : running ? "#5cb6ac" : "#969cab";
    const icon = error ? STATE_ICON.error : STATE_ICON[state];
    let label = state;
    if (state === "break") {
      const s = Math.ceil(breakRemainingMs / 1000);
      label = `break ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }
    badge.textContent = `pragyan ${icon} ${label} · seen ${captured.size} · sent ${sent} · queue ${pending.length}`;
  }

  const scheduleHarvest = debounce(harvest, 250);
  new MutationObserver(scheduleHarvest).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("scroll", scheduleHarvest, { passive: true });
  setInterval(flush, DEFAULTS.flushMs);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in config) config[key] = newValue;
    }
    if ("autoScroll" in changes) {
      if (config.autoScroll) startAuto();
      else stopAuto();
    }
  });

  chrome.storage.local.get(DEFAULTS).then((c) => {
    config = c;
    harvest();
    if (config.autoScroll) setTimeout(startAuto, 1200);
    else render();
  });
})();
