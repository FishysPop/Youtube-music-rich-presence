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

  window.addEventListener('beforeunload', (e) => {
    e.stopImmediatePropagation();
    delete e.returnValue;
  }, true);

  try {
    Object.defineProperty(window, 'onbeforeunload', {
      get: () => null,
      set: () => {},
      configurable: true
    });
  } catch (e) {}

  try {
    Object.defineProperty(window, 'onunload', {
      get: () => null,
      set: () => {},
      configurable: true
    });
  } catch (e) {}

  const origAddEventListener = window.addEventListener;
  window.addEventListener = function(type, listener, options) {
    if (type === 'beforeunload' || type === 'unload') return;
    return origAddEventListener.call(this, type, listener, options);
  };

  try {
    const origETAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if ((type === 'beforeunload' || type === 'unload') && (this === window || this === document)) return;
      return origETAdd.call(this, type, listener, options);
    };
  } catch (e) {}

  window.__syncedUpcomingTracks = [];

  function formatUpcomingTrackItem(track) {
    if (!track || !track.videoId) return null;
    const thumbUrl = track.albumArtUrl || track.thumbnail || `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`;
    return {
      playlistPanelVideoRenderer: {
        title: { runs: [{ text: track.title || 'Track' }] },
        longBylineText: { runs: [{ text: track.artist || '' }] },
        shortBylineText: { runs: [{ text: track.artist || '' }] },
        videoId: track.videoId,
        selected: false,
        canReorder: true,
        thumbnail: {
          thumbnails: [
            {
              url: thumbUrl,
              width: 400,
              height: 225
            },
            {
              url: `https://i.ytimg.com/vi/${track.videoId}/default.jpg`,
              width: 120,
              height: 90
            }
          ]
        },
        navigationEndpoint: {
          clickTrackingParams: "CAIQyCAYACITCLDXgoim2JYDFTIYYwEdI5YtHg==",
          watchEndpoint: {
            videoId: track.videoId,
            watchEndpointMusicSupportedConfigs: {
              watchEndpointMusicConfig: {
                hasPersistentPlaylistPanel: true,
                musicVideoType: "MUSIC_VIDEO_TYPE_OMV"
              }
            }
          }
        },
        queueNavigationEndpoint: {
          queueAddEndpoint: {
            queueTarget: {
              videoId: track.videoId
            },
            queueInsertPosition: "INSERT_AT_END"
          }
        },
        menu: {
          menuRenderer: {
            items: [
              {
                menuNavigationItemRenderer: {
                  text: { runs: [{ text: "Start mix" }] },
                  icon: { iconType: "MIX" },
                  navigationEndpoint: {
                    watchEndpoint: {
                      videoId: track.videoId,
                      playlistId: "RDAMVM" + track.videoId
                    }
                  }
                }
              }
            ],
            trackingParams: "CAIQyCAYACITCLDXgoim2JYDFTIYYwEdI5YtHg=="
          }
        }
      }
    };
  }

  function extractQueueTrackItem(it) {
    if (!it || typeof it !== 'object') return null;

    let r = it.playlistPanelVideoRenderer || null;
    if (!r && it.playlistPanelVideoWrapperRenderer) {
      const wrapper = it.playlistPanelVideoWrapperRenderer;
      r = wrapper.primaryRenderer?.playlistPanelVideoRenderer ||
          wrapper.primaryRenderer ||
          wrapper.playlistPanelVideoRenderer ||
          wrapper.counterpart?.[0]?.counterpartRenderer?.playlistPanelVideoRenderer ||
          wrapper.counterpart?.[0]?.counterpartRenderer ||
          null;
    }
    if (!r && it.musicResponsiveListItemRenderer) {
      r = it.musicResponsiveListItemRenderer;
    }
    if (!r && (it.videoId || (it.navigationEndpoint?.watchEndpoint?.videoId))) {
      r = it;
    }

    if (!r) return null;

    const videoId = r.videoId ||
                    r.playlistItemData?.videoId ||
                    r.navigationEndpoint?.watchEndpoint?.videoId ||
                    r.onTap?.watchEndpoint?.videoId ||
                    it.videoId ||
                    null;

    if (!videoId || typeof videoId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return null;
    }

    function getText(obj) {
      if (!obj) return '';
      if (typeof obj === 'string') return obj;
      if (Array.isArray(obj.runs)) {
        return obj.runs.map(run => (run && typeof run.text === 'string') ? run.text : '').join('');
      }
      if (typeof obj.simpleText === 'string') return obj.simpleText;
      return '';
    }

    const title = getText(r.title) ||
                  getText(r.headline) ||
                  getText(r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text) ||
                  '';

    const artist = getText(r.shortBylineText) ||
                   getText(r.longBylineText) ||
                   getText(r.bylineText) ||
                   getText(r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text) ||
                   '';

    const durationText = getText(r.lengthText) ||
                         getText(r.durationText) ||
                         getText(r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text) ||
                         '';

    let thumbnail = null;
    if (typeof r.thumbnail === 'string') {
      thumbnail = r.thumbnail;
    } else if (r.thumbnail?.thumbnails && Array.isArray(r.thumbnail.thumbnails) && r.thumbnail.thumbnails.length > 0) {
      thumbnail = r.thumbnail.thumbnails[0]?.url || null;
    }
    if (!thumbnail && typeof r.albumArtUrl === 'string') {
      thumbnail = r.albumArtUrl;
    }
    if (!thumbnail) {
      thumbnail = `https://i.ytimg.com/vi/${videoId}/default.jpg`;
    }

    return {
      videoId,
      title: title.trim(),
      artist: artist.trim(),
      durationText: durationText.trim(),
      thumbnail
    };
  }

  function getQueueContext() {
    const app = document.querySelector('ytmusic-app');
    const playerBar = document.querySelector('ytmusic-player-bar');
    const player = document.getElementById('movie_player') ||
                   document.querySelector('ytmusic-player') ||
                   document.querySelector('#player');

    const queueObj = playerBar?.queue || app?.queue || null;
    const rawStore = queueObj?.store || playerBar?.queue?.store || app?.queue?.store || app?.store;
    const store = (rawStore && typeof rawStore.dispatch === 'function')
      ? rawStore
      : (rawStore?.store && typeof rawStore.store.dispatch === 'function')
        ? rawStore.store
        : null;

    let items = [];
    if (queueObj && typeof queueObj.getItems === 'function') {
      try { items = queueObj.getItems() || []; } catch (e) {}
    }
    if ((!items || items.length === 0) && app && typeof app.getState === 'function') {
      try { items = app.getState()?.queue?.items || []; } catch (e) {}
    }
    if (!items || items.length === 0) {
      const domElements = document.querySelectorAll('ytmusic-player-queue-item');
      if (domElements && domElements.length > 0) {
        items = Array.from(domElements).map(el => el.data).filter(Boolean);
      }
    }

    let currentQueueIdx = -1;
    if (queueObj && typeof queueObj.getCurrentItemIndex === 'function') {
      try { currentQueueIdx = queueObj.getCurrentItemIndex(); } catch (e) {}
    }
    if ((typeof currentQueueIdx !== 'number' || currentQueueIdx === -1) && app && typeof app.getState === 'function') {
      try {
        const qState = app.getState()?.queue;
        if (qState && typeof qState.selectedItemIndex === 'number') {
          currentQueueIdx = qState.selectedItemIndex;
        }
      } catch (e) {}
    }

    const currentVid = ((player && typeof player.getVideoData === 'function')
      ? (player.getVideoData() || {}).video_id
      : null) || document.documentElement.getAttribute('data-ytm-video-id');

    if ((typeof currentQueueIdx !== 'number' || currentQueueIdx === -1) && currentVid && items.length > 0) {
      currentQueueIdx = items.findIndex(it => {
        const item = extractQueueTrackItem(it);
        return item && item.videoId === currentVid;
      });
    }

    if ((typeof currentQueueIdx !== 'number' || currentQueueIdx === -1) && items.length > 0) {
      currentQueueIdx = items.findIndex(it => {
        const r = it?.playlistPanelVideoRenderer ||
                  it?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer ||
                  it?.playlistPanelVideoWrapperRenderer?.playlistPanelVideoRenderer;
        return Boolean(r && r.selected);
      });
    }

    return { app, playerBar, player, queueObj, store, items, currentQueueIdx, currentVid };
  }

  function getUpcomingTracksFromQueue() {
    const { items, currentQueueIdx, currentVid } = getQueueContext();
    if (!items || items.length === 0) return [];

    let resolvedIdx = currentQueueIdx;
    if ((typeof resolvedIdx !== 'number' || resolvedIdx === -1) && currentVid) {
      resolvedIdx = items.findIndex(it => {
        const item = extractQueueTrackItem(it);
        return item && item.videoId === currentVid;
      });
    }

    if (resolvedIdx === -1) return [];

    const upcoming = [];
    for (let i = resolvedIdx + 1; i < items.length && upcoming.length < 15; i++) {
      const track = extractQueueTrackItem(items[i]);
      if (track && track.videoId) {
        upcoming.push(track);
      }
    }
    return upcoming;
  }

  function syncQueueProperly(targetUpcomingTracks) {
    if (!Array.isArray(targetUpcomingTracks)) return false;
    window.__syncedUpcomingTracks = targetUpcomingTracks.slice(0, 15);
    return true;
  }

  function executeNavigation(targetVid, targetTime) {
    const { app, player } = getQueueContext();
    const startSec = Math.floor(targetTime || 0);
    const watchEndpoint = { videoId: targetVid };
    if (startSec > 0) watchEndpoint.startTimeSeconds = startSec;

    const endpointDetail = {
      clickTrackingParams: '',
      watchEndpoint
    };

    let navigated = false;
    try {
      const navEvent = new CustomEvent('yt-navigate', {
        bubbles: true,
        composed: true,
        detail: { endpoint: endpointDetail }
      });
      document.dispatchEvent(navEvent);
      bridgeLog(`Navigated via document.dispatchEvent('yt-navigate') to ${targetVid}`);
      navigated = true;
    } catch (e) {}

    if (!navigated && app && typeof app.handleNavigationEndpoint === 'function') {
      try {
        app.handleNavigationEndpoint({ watchEndpoint });
        bridgeLog(`Navigated via app.handleNavigationEndpoint to ${targetVid}`);
        navigated = true;
      } catch (e) {
        console.warn('[YTM Page Bridge] app.handleNavigationEndpoint failed:', e);
      }
    }

    if (!navigated && app && typeof app.dispatchEvent === 'function') {
      try {
        const navEvent = new CustomEvent('yt-navigate', {
          bubbles: true,
          composed: true,
          detail: { endpoint: endpointDetail }
        });
        app.dispatchEvent(navEvent);
        navigated = true;
      } catch (e) {}
    }

    if (!navigated && app && app.navigator && typeof app.navigator.navigate === 'function') {
      try {
        app.navigator.navigate({ watchEndpoint });
        navigated = true;
      } catch (e) {}
    }

    if (!navigated && player && typeof player.loadVideoById === 'function') {
      try {
        player.loadVideoById(targetVid, startSec);
        navigated = true;
      } catch (e) {}
    }
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

  let isListenerConnected = false;

  function disableAutoplayForConnectedClient() {
    if (!isListenerConnected) return;
    try {
      const queueContainers = [
        document.querySelector('ytmusic-player-queue'),
        document.querySelector('ytmusic-player-page #queue'),
        document.querySelector('#queue'),
        document
      ].filter(Boolean);

      for (const container of queueContainers) {
        const toggles = container.querySelectorAll('tp-yt-paper-toggle-button, paper-toggle-button');
        for (const toggle of toggles) {
          const parent = toggle.closest('ytmusic-player-queue-header-renderer') ||
                         toggle.closest('#automix') ||
                         toggle.closest('#automix-contents') ||
                         toggle.closest('[class*="automix"]') ||
                         toggle.closest('[class*="autoplay"]') ||
                         toggle.parentElement;

          const text = ((parent ? parent.textContent : '') + ' ' + (toggle.getAttribute('aria-label') || '')).toLowerCase();
          const isAutoplay = text.includes('auto-play') ||
                             text.includes('autoplay') ||
                             text.includes('automix') ||
                             text.includes('add similar content') ||
                             toggle.id === 'automix-toggle' ||
                             toggle.id === 'autoplay-toggle';

          if (isAutoplay) {
            const isChecked = Boolean(toggle.checked || toggle.hasAttribute('checked') || toggle.getAttribute('aria-pressed') === 'true');
            if (isChecked) {
              toggle.click();
              if (toggle.checked) {
                toggle.checked = false;
                toggle.dispatchEvent(new CustomEvent('change', { bubbles: true }));
              }
              bridgeLog('Automatically disabled autoplay toggle for connected client');
            }
          }
        }
      }

      const app = document.querySelector('ytmusic-app');
      const queueObj = app?.queue || document.querySelector('ytmusic-player-bar')?.queue;
      if (queueObj) {
        if (typeof queueObj.autoMixEnabled === 'boolean' && queueObj.autoMixEnabled) {
          queueObj.autoMixEnabled = false;
        }
        if (typeof queueObj.enableAutomix === 'boolean' && queueObj.enableAutomix) {
          queueObj.enableAutomix = false;
        }
      }
    } catch (e) {}
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'ytm-sync-isolated') return;

    const { action, videoId, currentTime, rate, isPlaying, track, artist, albumArtUrl, upcomingTracks, playlistId, playlistIndex } = event.data;
    const player = document.getElementById('movie_player') ||
                   document.querySelector('ytmusic-player') ||
                   document.querySelector('#player');

    if (action === 'SET_CLIENT_ROLE') {
      isListenerConnected = (event.data.role === 'LISTENER');
      if (isListenerConnected) {
        disableAutoplayForConnectedClient();
      }
      return;
    }

    if (action === 'SYNC_UPCOMING_TRACKS' && Array.isArray(upcomingTracks)) {
      window.__syncedUpcomingTracks = upcomingTracks.slice(0, 15);
      bridgeLog(`Synced upcoming tracks updated (count=${window.__syncedUpcomingTracks.length}): ${window.__syncedUpcomingTracks.map(t => t.videoId).join(', ')}`);
      return;
    }

    bridgeLog(`Received message from isolated world: action=${action}, videoId=${videoId}`);

    if (action === 'LOAD_VIDEO' && videoId) {
      if (checkIsAd()) {
        bridgeLog(`Ad is currently playing. Deferring LOAD_VIDEO for ${videoId}`);
        return;
      }

      if (Array.isArray(upcomingTracks) && upcomingTracks.length > 0) {
        window.__syncedUpcomingTracks = upcomingTracks.slice(0, 15);
      }

      const { currentVid } = getQueueContext();
      const video = document.querySelector('video');
      const hasActivePlayer = Boolean(currentVid && (video || player));

      bridgeLog(`LOAD_VIDEO target=${videoId}, currently playing=${currentVid}, hasActivePlayer=${hasActivePlayer}`);

      if (hasActivePlayer && currentVid === videoId) {
        bridgeLog(`Video ${videoId} is already loaded. Adjusting playback state: currentTime=${currentTime}, isPlaying=${isPlaying}`);
        if (typeof currentTime === 'number' && player && typeof player.seekTo === 'function') {
          player.seekTo(currentTime, true);
        }
        if (isPlaying === false) {
          const playPauseBtn = document.querySelector('ytmusic-player-bar #play-pause-button button') ||
                               document.querySelector('#play-pause-button button');
          if (video && !video.paused && playPauseBtn && typeof playPauseBtn.click === 'function') {
            playPauseBtn.click();
          } else if (player && typeof player.pauseVideo === 'function') {
            player.pauseVideo();
          }
        } else if (isPlaying === true) {
          const playPauseBtn = document.querySelector('ytmusic-player-bar #play-pause-button button') ||
                               document.querySelector('#play-pause-button button');
          if (video && video.paused && playPauseBtn && typeof playPauseBtn.click === 'function') {
            playPauseBtn.click();
          } else if (player && typeof player.playVideo === 'function') {
            player.playVideo();
          }
        }
        return;
      }

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
        const video = document.querySelector('video');
        const playPauseBtn = document.querySelector('ytmusic-player-bar #play-pause-button button') ||
                             document.querySelector('#play-pause-button button');
        if (video && video.paused && playPauseBtn && typeof playPauseBtn.click === 'function') {
          playPauseBtn.click();
        } else if (player && typeof player.playVideo === 'function') {
          player.playVideo();
        }
      } catch (e) {}
    } else if (action === 'PAUSE') {
      try {
        const isAd = checkIsAd();
        if (!isAd) {
          const video = document.querySelector('video');
          const playPauseBtn = document.querySelector('ytmusic-player-bar #play-pause-button button') ||
                               document.querySelector('#play-pause-button button');
          if (video && !video.paused && playPauseBtn && typeof playPauseBtn.click === 'function') {
            playPauseBtn.click();
          } else if (player && typeof player.pauseVideo === 'function') {
            player.pauseVideo();
          }
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
  let lastBroadcastList = null;

  function updatePlayerBridgeData() {
    const player = document.getElementById('movie_player') ||
                   document.querySelector('ytmusic-player') ||
                   document.querySelector('#player');
    let vid = null;
    let list = null;
    let playlistIndex = -1;

    if (player && typeof player.getVideoData === 'function') {
      try {
        const data = player.getVideoData();
        vid = data && data.video_id;
        list = data && data.list;
      } catch (e) {}
    }
    if (!list && player && typeof player.getPlaylistId === 'function') {
      try { list = player.getPlaylistId(); } catch (e) {}
    }
    if (player && typeof player.getPlaylistIndex === 'function') {
      try { playlistIndex = player.getPlaylistIndex(); } catch (e) {}
    }
    if (!vid || !/^[a-zA-Z0-9_-]{11}$/.test(vid)) {
      try {
        const app = document.querySelector('ytmusic-app');
        const state = app && typeof app.getState === 'function' ? app.getState() : null;
        vid = state?.player?.playerResponse?.videoDetails?.videoId ||
              extractQueueTrackItem(state?.queue?.items?.[state?.queue?.selectedItemIndex])?.videoId;
      } catch (e) {}
    }
    if (vid && /^[a-zA-Z0-9_-]{11}$/.test(vid)) {
      if (document.documentElement.getAttribute('data-ytm-video-id') !== vid) {
        document.documentElement.setAttribute('data-ytm-video-id', vid);
      }
    }
    if (list && typeof list === 'string' && /^[a-zA-Z0-9_-]+$/.test(list)) {
      if (document.documentElement.getAttribute('data-ytm-playlist-id') !== list) {
        document.documentElement.setAttribute('data-ytm-playlist-id', list);
      }
    } else {
      document.documentElement.removeAttribute('data-ytm-playlist-id');
    }
    if (typeof playlistIndex === 'number' && playlistIndex >= 0) {
      document.documentElement.setAttribute('data-ytm-playlist-index', String(playlistIndex));
    } else {
      document.documentElement.removeAttribute('data-ytm-playlist-index');
    }

    try {
      const upcoming = getUpcomingTracksFromQueue();
      const upcomingJson = JSON.stringify(upcoming.map(t => t.videoId));
      if (upcomingJson !== lastBroadcastQueueJson || list !== lastBroadcastList) {
        lastBroadcastQueueJson = upcomingJson;
        lastBroadcastList = list;
        window.postMessage({
          source: 'ytm-page-bridge-queue',
          upcomingTracks: upcoming,
          playlistId: list,
          playlistIndex: playlistIndex >= 0 ? playlistIndex : null
        }, '*');
      }
    } catch (e) {}
  }

  function pollAdState() {
    updatePlayerBridgeData();
    if (isListenerConnected) {
      disableAutoplayForConnectedClient();
    }
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

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      formatUpcomingTrackItem,
      syncQueueProperly,
      executeNavigation,
      checkIsAd
    };
  }
})();
