(() => {
  function extractSession() {
    const full = window.location.href;
    try {
      const u = new URL(full);
      const q = u.searchParams.get('ytm-session') || u.searchParams.get('session');
      if (q && /^[a-zA-Z0-9_-]+$/.test(q)) return q.toUpperCase();
      const h = u.hash || '';
      const m = h.match(/(?:ytm-session|session)=([a-zA-Z0-9_-]+)/i);
      if (m && m[1]) return m[1].toUpperCase();
    } catch (e) {}

    const fallback = full.match(/[?#&](?:ytm-session|session)=([a-zA-Z0-9_-]+)/i);
    return (fallback && fallback[1]) ? fallback[1].toUpperCase() : null;
  }

  const roomId = extractSession();
  if (roomId) {
    window.__ytmPendingSession = roomId;
    try {
      sessionStorage.setItem('__ytm_pending_session', roomId);
    } catch (e) {}
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ __ytm_pending_session: roomId });
    }
  }
})();

