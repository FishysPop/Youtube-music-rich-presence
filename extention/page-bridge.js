(() => {
  if (window.__ytmPageBridgeInstalled) return;
  window.__ytmPageBridgeInstalled = true;

  function bridgeLog(msg) {
    console.log(`[YTM Page Bridge] ${msg}`);
    try {
      window.postMessage({ source: 'ytm-page-bridge-log', message: msg }, '*');
    } catch (e) {}
  }

  bridgeLog('Script successfully installed in MAIN world');

  function getQueueContext() {
    const app = document.querySelector('ytmusic-app');
    const playerBar = document.querySelector('ytmusic-player-bar');
    const player = document.getElementById('movie_player') ||
                   document.querySelector('ytmusic-player') ||
                   document.querySelector('#player');

    const queueObj = playerBar?.queue || app?.queue;
    let items = [];
    let currentQueueIdx = -1;

    if (queueObj && typeof queueObj.getItems === 'function') {
      try {
        items = queueObj.getItems() || [];
      } catch (e) {}
    }

    if (queueObj && typeof queueObj.getCurrentItemIndex === 'function') {
      try {
        currentQueueIdx = queueObj.getCurrentItemIndex();
      } catch (e) {}
    }

    if (items.length === 0) {
      try {
        const queueRenderer = document.querySelector('ytmusic-player-page #queue, ytmusic-player-page ytmusic-playlist-panel-renderer');
        if (queueRenderer && Array.isArray(queueRenderer.data?.contents)) {
          items = queueRenderer.data.contents;
        }
      } catch (e) {}
    }

    const currentVid = (player && typeof player.getVideoData === 'function')
      ? (player.getVideoData() || {}).video_id
      : null;

    if ((typeof currentQueueIdx !== 'number' || currentQueueIdx === -1) && currentVid && items.length > 0) {
      currentQueueIdx = items.findIndex(it => it?.playlistPanelVideoRenderer?.videoId === currentVid);
    }

    return { app, playerBar, player, queueObj, items, currentQueueIdx, currentVid };
  }

  function getUpcomingTracksFromQueue() {
    const { items, currentQueueIdx } = getQueueContext();
    if (!items || items.length === 0 || currentQueueIdx === -1) return [];
    return items.slice(currentQueueIdx + 1, currentQueueIdx + 16).map(it => {
      const r = it?.playlistPanelVideoRenderer;
      if (!r || !r.videoId) return null;
      return {
        videoId: r.videoId,
        title: r.title?.runs?.[0]?.text || r.title?.simpleText || '',
        artist: r.shortBylineText?.runs?.[0]?.text || r.shortBylineText?.simpleText || ''
      };
    }).filter(Boolean);
  }

  function executeNavigation(targetVid, targetTime) {
    const startSec = Math.floor(targetTime || 0);
    const searchParams = new URLSearchParams();
    searchParams.set('v', targetVid);
    if (startSec > 0) searchParams.set('t', startSec);
    const targetUrl = `/watch?${searchParams.toString()}`;

    bridgeLog(`Navigating normally like a user to ${targetUrl}`);
    window.location.assign(targetUrl);
  }

  function triggerNativeNext(targetVid) {
    const { playerBar } = getQueueContext();
    const player = document.getElementById('movie_player') ||
                   document.querySelector('ytmusic-player') ||
                   document.querySelector('#player');
    const nextBtn = playerBar?.querySelector('.next-button') ||
                    playerBar?.querySelector('#next-button') ||
                    document.querySelector('ytmusic-player-bar .next-button');

    if (nextBtn && typeof nextBtn.click === 'function' && !nextBtn.disabled && !nextBtn.hasAttribute('disabled')) {
      try {
        nextBtn.click();
        bridgeLog(`Native skip triggered via next-button click for ${targetVid}`);
        return true;
      } catch (e) {
        bridgeLog(`nextBtn.click error: ${e.message}`);
      }
    }

    if (player && typeof player.nextVideo === 'function') {
      try {
        player.nextVideo();
        bridgeLog(`Native skip triggered via player.nextVideo() for ${targetVid}`);
        return true;
      } catch (e) {
        bridgeLog(`player.nextVideo error: ${e.message}`);
      }
    }

    return false;
  }

  function triggerNativePrev(targetVid) {
    const { playerBar } = getQueueContext();
    const player = document.getElementById('movie_player') ||
                   document.querySelector('ytmusic-player') ||
                   document.querySelector('#player');
    const prevBtn = playerBar?.querySelector('.previous-button') ||
                    playerBar?.querySelector('#previous-button') ||
                    document.querySelector('ytmusic-player-bar .previous-button');

    if (prevBtn && typeof prevBtn.click === 'function' && !prevBtn.disabled && !prevBtn.hasAttribute('disabled')) {
      try {
        prevBtn.click();
        bridgeLog(`Native prev triggered via previous-button click for ${targetVid}`);
        return true;
      } catch (e) {
        bridgeLog(`prevBtn.click error: ${e.message}`);
      }
    }

    if (player && typeof player.previousVideo === 'function') {
      try {
        player.previousVideo();
        bridgeLog(`Native prev triggered via player.previousVideo() for ${targetVid}`);
        return true;
      } catch (e) {
        bridgeLog(`player.previousVideo error: ${e.message}`);
      }
    }

    return false;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'ytm-sync-isolated') return;

    const { action, videoId, currentTime, rate, isPlaying } = event.data;
    const player = document.getElementById('movie_player') ||
                   document.querySelector('ytmusic-player') ||
                   document.querySelector('#player');

    if (action === 'LOAD_VIDEO' && videoId) {
      if (checkIsAd()) {
        bridgeLog(`Ad is currently playing. Deferring LOAD_VIDEO for ${videoId}`);
        return;
      }

      const { currentQueueIdx, currentVid } = getQueueContext();
      const isOnWatch = window.location.pathname.startsWith('/watch');
      const hasActivePlayer = Boolean(isOnWatch && currentVid && (document.querySelector('video') || player));

      bridgeLog(`LOAD_VIDEO target=${videoId}, currently playing=${currentVid}, isOnWatch=${isOnWatch}, hasActivePlayer=${hasActivePlayer}`);

      if (isOnWatch && hasActivePlayer && currentVid === videoId) {
        bridgeLog(`Video ${videoId} is already loaded on watch page. Adjusting playback state: currentTime=${currentTime}, isPlaying=${isPlaying}`);
        if (typeof currentTime === 'number' && player && typeof player.seekTo === 'function') {
          player.seekTo(currentTime, true);
        }
        if (isPlaying === false) {
          if (player && typeof player.pauseVideo === 'function') player.pauseVideo();
        } else if (isPlaying === true) {
          if (player && typeof player.playVideo === 'function') player.playVideo();
        }
        return;
      }

      if (!isOnWatch || !hasActivePlayer || !currentVid || currentQueueIdx === -1) {
        bridgeLog(`Navigating normally like a user to watch page for ${videoId}`);
        executeNavigation(videoId, currentTime);
        return;
      }

      const freshContext = getQueueContext();
      const freshItems = freshContext.items || [];
      const matchingIdx = freshItems.findIndex(it => it?.playlistPanelVideoRenderer?.videoId === videoId);

      if (matchingIdx !== -1) {
        const curIdx = (typeof freshContext.currentQueueIdx === 'number' && freshContext.currentQueueIdx >= 0)
          ? freshContext.currentQueueIdx
          : 0;

        if (matchingIdx === curIdx + 1) {
          if (triggerNativeNext(videoId)) {
            if (typeof currentTime === 'number' && currentTime > 2) {
              setTimeout(() => {
                try {
                  const p = document.getElementById('movie_player');
                  if (p && typeof p.seekTo === 'function') p.seekTo(currentTime, true);
                } catch (e) {}
              }, 350);
            }
            return;
          }
        } else if (matchingIdx === curIdx - 1) {
          if (triggerNativePrev(videoId)) {
            if (typeof currentTime === 'number' && currentTime > 2) {
              setTimeout(() => {
                try {
                  const p = document.getElementById('movie_player');
                  if (p && typeof p.seekTo === 'function') p.seekTo(currentTime, true);
                } catch (e) {}
              }, 350);
            }
            return;
          }
        }
      }

      const domQueueItems = Array.from(document.querySelectorAll('ytmusic-player-queue-item'));
      if (domQueueItems.length > 0) {
        const matchingDomItem = domQueueItems.find(el => el.data && el.data.videoId === videoId);
        if (matchingDomItem) {
          const playBtn = matchingDomItem.querySelector('#play-button, .play-button') || matchingDomItem;
          if (typeof playBtn.click === 'function') {
            bridgeLog(`Target found in DOM queue: clicking queue play button for ${videoId}`);
            playBtn.click();
            return;
          }
        }
      }

      bridgeLog(`Target not in immediate queue: navigating normally like a user to ${videoId}`);
      executeNavigation(videoId, currentTime);
    } else if (action === 'SEEK' && typeof currentTime === 'number') {
      try {
        const isAd = checkIsAd();
        if (!isAd && player && typeof player.seekTo === 'function') {
          player.seekTo(currentTime, true);
        }
      } catch (e) {}
    } else if (action === 'PLAY') {
      try {
        if (player && typeof player.playVideo === 'function') {
          player.playVideo();
        }
      } catch (e) {}
    } else if (action === 'PAUSE') {
      try {
        const isAd = checkIsAd();
        if (!isAd && player && typeof player.pauseVideo === 'function') {
          player.pauseVideo();
        }
      } catch (e) {}
    } else if (action === 'SET_RATE' && typeof rate === 'number') {
      try {
        const isAd = checkIsAd();
        if (!isAd && player && typeof player.setPlaybackRate === 'function') {
          player.setPlaybackRate(rate);
        }
      } catch (e) {}
    } else if (action === 'REQUEST_QUEUE') {
      try {
        const upcoming = getUpcomingTracksFromQueue();
        window.postMessage({
          source: 'ytm-page-bridge-queue',
          upcomingTracks: upcoming
        }, '*');
      } catch (e) {}
    }
  });

  window.__getYtmUpcomingTracks = getUpcomingTracksFromQueue;

  function checkIsAd() {
    const player = document.getElementById('movie_player') ||
                   document.querySelector('ytmusic-player') ||
                   document.querySelector('#player');
    if (player) {
      if (typeof player.getAdState === 'function') {
        const adState = player.getAdState();
        if (adState >= 0) return true;
        if (adState === -1) return false;
      }
      if (typeof player.isLifaAdPlaying === 'function' && player.isLifaAdPlaying()) return true;
    }
    const starkBadge = document.querySelector('ytmusic-player-bar .badge-style-type-ad-stark');
    if (starkBadge && !starkBadge.hidden && starkBadge.offsetParent !== null) return true;
    if (document.querySelector('.ytp-ad-player-overlay, .video-ads.ytp-ad-module .ytp-ad-text')) return true;
    return false;
  }

  let isAdActive = false;
  let lastBroadcastQueueJson = '';
  function updatePlayerBridgeData() {
    const player = document.getElementById('movie_player') ||
                   document.querySelector('ytmusic-player') ||
                   document.querySelector('#player');
    if (player && typeof player.getVideoData === 'function') {
      try {
        const data = player.getVideoData();
        const vid = data && data.video_id;
        if (vid && /^[a-zA-Z0-9_-]{11}$/.test(vid)) {
          if (document.documentElement.getAttribute('data-ytm-video-id') !== vid) {
            document.documentElement.setAttribute('data-ytm-video-id', vid);
          }
        }
      } catch (e) {}
    }

    try {
      const upcoming = getUpcomingTracksFromQueue();
      const upcomingJson = JSON.stringify(upcoming.map(t => t.videoId));
      if (upcomingJson !== lastBroadcastQueueJson) {
        lastBroadcastQueueJson = upcomingJson;
        window.postMessage({
          source: 'ytm-page-bridge-queue',
          upcomingTracks: upcoming
        }, '*');
      }
    } catch (e) {}
  }

  function pollAdState() {
    updatePlayerBridgeData();
    const isAd = checkIsAd();
    if (isAd !== isAdActive) {
      isAdActive = isAd;
      document.documentElement.setAttribute('data-ytm-ad-active', isAd ? 'true' : 'false');
    }

    if (isAd) {
      const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button.ytp-ad-skip-button-text, .ytp-ad-skip-button-container button');
      if (skipBtn && skipBtn.offsetParent !== null) {
        try { skipBtn.click(); } catch (e) {}
      }
    }
  }

  updatePlayerBridgeData();
  window.addEventListener('yt-navigate-finish', () => {
    updatePlayerBridgeData();
  });

  setInterval(pollAdState, 200);
})();
