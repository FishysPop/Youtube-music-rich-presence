(() => {
  function notifyActive() {
    try {
      if (document.documentElement) {
        document.documentElement.setAttribute('data-ytm-extension-active', 'true');
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
          document.documentElement.setAttribute('data-ytm-extension-id', chrome.runtime.id);
        }
      }
      window.postMessage({ type: 'YTM_GATEWAY_INTERCEPTOR_ACTIVE' }, window.location.origin);
      window.dispatchEvent(new CustomEvent('ytm-extension-active'));
    } catch (e) {}
  }

  notifyActive();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', notifyActive);
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (!event.data) return;
    if (event.data.type === 'YTM_PAGE_PING_EXTENSION') {
      notifyActive();
    } else if (event.data.type === 'GATEWAY_JOIN_SESSION' && typeof event.data.roomId === 'string') {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'GATEWAY_JOIN_SESSION', roomId: event.data.roomId });
      }
    }
  });

  window.addEventListener('ytm-ping-extension', notifyActive);
  window.addEventListener('ytm-join-session', (e) => {
    const roomId = e.detail && e.detail.roomId;
    if (roomId && typeof roomId === 'string' && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'GATEWAY_JOIN_SESSION', roomId: roomId });
    }
  });

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
  if (roomId && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: 'GATEWAY_JOIN_SESSION', roomId: roomId });
  }
})();
