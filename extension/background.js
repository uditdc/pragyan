async function getConfig() {
  const stored = await chrome.storage.local.get(["apiBase", "batchSize"]);
  return {
    apiBase: stored.apiBase || "http://127.0.0.1:8787",
    batchSize: stored.batchSize || 20,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "ingest") {
    (async () => {
      try {
        const { apiBase } = await getConfig();
        const res = await fetch(`${apiBase}/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ posts: msg.posts }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        sendResponse({ ok: true, data: await res.json() });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
