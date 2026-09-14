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

  const origAddEventListener = window.addEventListener;
  window.addEventListener = function(type, listener, options) {
    if (type === 'beforeunload') return;
    return origAddEventListener.call(this, type, listener, options);
  };

  try {
    const origETAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (type === 'beforeunload' && (this === window || this === document)) return;
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

    const currentVid = (player && typeof player.getVideoData === 'function')
      ? (player.getVideoData() || {}).video_id
      : null;

    if ((typeof currentQueueIdx !== 'number' || currentQueueIdx === -1) && currentVid && items.length > 0) {
      currentQueueIdx = items.findIndex(it => it?.playlistPanelVideoRenderer?.videoId === currentVid);
    }

    return { app, playerBar, player, queueObj, store, items, currentQueueIdx, currentVid };
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

  function syncQueueProperly(targetUpcomingTracks) {
    if (!Array.isArray(targetUpcomingTracks) || targetUpcomingTracks.length === 0) return false;
    const { store, queueObj, items, currentQueueIdx } = getQueueContext();
    if (!store || typeof store.dispatch !== 'function') return false;

    const validTracks = targetUpcomingTracks.slice(0, 15).filter(t => t && t.videoId);
    if (validTracks.length === 0) return false;

    const targetStartIdx = (typeof currentQueueIdx === 'number' && currentQueueIdx >= 0)
      ? currentQueueIdx + 1
      : 0;

    for (let i = 0; i < validTracks.length; i++) {
      const desiredTrack = validTracks[i];
      const desiredPos = targetStartIdx + i;
      const freshItems = (queueObj && typeof queueObj.getItems === 'function')
        ? (queueObj.getItems() || [])
        : (items || []);

      const existingIdx = freshItems.findIndex((it, idx) => idx >= targetStartIdx && it?.playlistPanelVideoRenderer?.videoId === desiredTrack.videoId);

      if (existingIdx === desiredPos) {
        continue;
      } else if (existingIdx > desiredPos) {
        try {
          store.dispatch({
            type: 'MOVE_ITEM',
            payload: {
              fromIndex: existingIdx,
              toIndex: desiredPos
            }
          });
        } catch (e) {}
      } else {
        const formatted = formatUpcomingTrackItem(desiredTrack);
        if (formatted) {
          try {
            store.dispatch({
              type: 'ADD_ITEMS',
              payload: {
                index: desiredPos,
                items: [formatted],
                nextQueueItemId: Math.floor(Math.random() * 1000000),
                shouldAssignIds: true
              }
            });
          } catch (e) {}
        }
      }
    }

    const freshItemsAfter = (queueObj && typeof queueObj.getItems === 'function')
      ? (queueObj.getItems() || [])
      : [];
    const maxAllowedIdx = targetStartIdx + validTracks.length;
    for (let i = freshItemsAfter.length - 1; i >= maxAllowedIdx; i--) {
      const it = freshItemsAfter[i];
      if (queueObj && typeof queueObj.removeItem === 'function' && it) {
        try {
          queueObj.removeItem(it);
          continue;
        } catch (e) {}
      }
      try {
        store.dispatch({ type: 'REMOVE_ITEM', payload: i });
      } catch (e) {}
    }

    return true;
  }

  function executeNavigation(targetVid, targetTime) {
    const { app, player } = getQueueContext();
    const startSec = Math.floor(targetTime || 0);
    const watchEndpoint = { videoId: targetVid };
    if (startSec > 0) watchEndpoint.startTimeSeconds = startSec;

    let navigated = false;
    if (app && typeof app.handleNavigationEndpoint === 'function') {
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
          detail: { endpoint: { watchEndpoint } }
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

    const video = document.querySelector('video');
    const hasPlayer = Boolean((document.documentElement.getAttribute('data-ytm-video-id') || player) && video && (video.readyState > 0 || video.src));
    if (!navigated && !hasPlayer) {
      const searchParams = new URLSearchParams();
      searchParams.set('v', targetVid);
      if (startSec > 0) searchParams.set('t', startSec);
      window.location.assign(`/watch?${searchParams.toString()}`);
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

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'ytm-sync-isolated') return;

    const { action, videoId, currentTime, rate, isPlaying, track, artist, albumArtUrl, upcomingTracks } = event.data;
    const player = document.getElementById('movie_player') ||
                   document.querySelector('ytmusic-player') ||
                   document.querySelector('#player');

    if (action === 'SYNC_UPCOMING_TRACKS' && Array.isArray(upcomingTracks)) {
      window.__syncedUpcomingTracks = upcomingTracks.slice(0, 15);
      bridgeLog(`Synced upcoming tracks updated (count=${window.__syncedUpcomingTracks.length}): ${window.__syncedUpcomingTracks.map(t => t.videoId).join(', ')}`);
      syncQueueProperly(window.__syncedUpcomingTracks);
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

      const { app, playerBar, queueObj, store, items, currentQueueIdx, currentVid } = getQueueContext();
      const hasActivePlayer = Boolean(currentVid && (document.querySelector('video') || player));

      bridgeLog(`LOAD_VIDEO target=${videoId}, currently playing=${currentVid}, hasActivePlayer=${hasActivePlayer}`);

      if (hasActivePlayer && currentVid === videoId) {
        bridgeLog(`Video ${videoId} is already loaded. Adjusting playback state: currentTime=${currentTime}, isPlaying=${isPlaying}`);
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

      if (!hasActivePlayer || !currentVid) {
        bridgeLog(`Direct navigation required (hasActivePlayer=${hasActivePlayer}, currentVid=${currentVid}) for ${videoId}`);
        executeNavigation(videoId, currentTime);
        return;
      }

      if (Array.isArray(window.__syncedUpcomingTracks) && window.__syncedUpcomingTracks.length > 0) {
        syncQueueProperly(window.__syncedUpcomingTracks);
      }

      const freshContext = getQueueContext();
      const freshItems = freshContext.items || [];
      const matchingIdx = freshItems.findIndex(it => it?.playlistPanelVideoRenderer?.videoId === videoId);

      if (matchingIdx !== -1) {
        const matchingItem = freshItems[matchingIdx];
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
        } else if (store && typeof store.dispatch === 'function') {
          try {
            store.dispatch({
              type: 'MOVE_ITEM',
              payload: {
                fromIndex: matchingIdx,
                toIndex: curIdx + 1
              }
            });
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
          } catch (e) {}
        }

        const navEndpoint = matchingItem?.playlistPanelVideoRenderer?.navigationEndpoint;
        if (navEndpoint && app && typeof app.handleNavigationEndpoint === 'function') {
          try {
            bridgeLog(`Triggering native navigationEndpoint for ${videoId}`);
            app.handleNavigationEndpoint(navEndpoint);
            return;
          } catch (e) {
            bridgeLog(`app.handleNavigationEndpoint error: ${e.message}`);
          }
        }

        if (queueObj && typeof queueObj.selectQueueItem === 'function') {
          try {
            bridgeLog(`Selecting via queueObj.selectQueueItem for ${videoId}`);
            queueObj.selectQueueItem(matchingItem);
            return;
          } catch (e) {
            bridgeLog(`queueObj.selectQueueItem error: ${e.message}`);
          }
        }
      }

      if (store && typeof store.dispatch === 'function') {
        const trackToInject = {
          videoId,
          title: track || 'Track',
          artist: artist || '',
          albumArtUrl
        };
        const formatted = formatUpcomingTrackItem(trackToInject);
        const insertIdx = (typeof freshContext.currentQueueIdx === 'number' && freshContext.currentQueueIdx >= 0)
          ? freshContext.currentQueueIdx + 1
          : 0;

        if (formatted) {
          try {
            store.dispatch({
              type: 'ADD_ITEMS',
              payload: {
                index: insertIdx,
                items: [formatted],
                nextQueueItemId: Math.floor(Math.random() * 1000000),
                shouldAssignIds: true
              }
            });
            bridgeLog(`Added ${videoId} to queue at ${insertIdx}; triggering native skip`);

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

            const navEndpoint = formatted.playlistPanelVideoRenderer?.navigationEndpoint;
            if (navEndpoint && app && typeof app.handleNavigationEndpoint === 'function') {
              app.handleNavigationEndpoint(navEndpoint);
              return;
            }

            if (queueObj && typeof queueObj.selectQueueItem === 'function') {
              queueObj.selectQueueItem(formatted);
              return;
            }
          } catch (e) {
            bridgeLog(`Queue add error: ${e.message}`);
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

      bridgeLog(`Falling back to tiered SPA navigation for ${videoId}`);
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
    let vid = null;
    if (player && typeof player.getVideoData === 'function') {
      try {
        const data = player.getVideoData();
        vid = data && data.video_id;
      } catch (e) {}
    }
    if (!vid || !/^[a-zA-Z0-9_-]{11}$/.test(vid)) {
      try {
        const app = document.querySelector('ytmusic-app');
        const state = app && typeof app.getState === 'function' ? app.getState() : null;
        vid = state?.player?.playerResponse?.videoDetails?.videoId ||
              state?.queue?.items?.[state?.queue?.selectedItemIndex]?.playlistPanelVideoRenderer?.videoId;
      } catch (e) {}
    }
    if (vid && /^[a-zA-Z0-9_-]{11}$/.test(vid)) {
      if (document.documentElement.getAttribute('data-ytm-video-id') !== vid) {
        document.documentElement.setAttribute('data-ytm-video-id', vid);
      }
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
