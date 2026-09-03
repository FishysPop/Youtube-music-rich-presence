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

  window.__syncedUpcomingTracks = [];

  function formatUpcomingTrackItem(track) {
    if (!track || !track.videoId) return null;
    return {
      playlistPanelVideoRenderer: {
        title: { runs: [{ text: track.title || 'Track' }] },
        longBylineText: { runs: [{ text: track.artist || '' }] },
        shortBylineText: { runs: [{ text: track.artist || '' }] },
        videoId: track.videoId,
        selected: false,
        navigationEndpoint: {
          watchEndpoint: {
            videoId: track.videoId
          }
        }
      }
    };
  }

  function injectUpcomingTracksIntoWatchNext(json, upcomingTracks) {
    if (!json || !Array.isArray(upcomingTracks) || upcomingTracks.length === 0) return json;
    const tabs = json.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs;
    const playlistPanel = tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer;
    if (!playlistPanel || !Array.isArray(playlistPanel.contents)) return json;

    const validUpcoming = upcomingTracks.slice(0, 2).map(formatUpcomingTrackItem).filter(Boolean);
    if (validUpcoming.length === 0) return json;

    const activeIdx = playlistPanel.contents.findIndex(c => c.playlistPanelVideoRenderer?.selected);
    const insertIdx = activeIdx !== -1 ? activeIdx + 1 : 1;

    const upcomingVideoIds = new Set(validUpcoming.map(u => u.playlistPanelVideoRenderer.videoId));
    const filteredContents = playlistPanel.contents.filter((c, idx) => {
      if (idx === activeIdx) return true;
      const vid = c.playlistPanelVideoRenderer?.videoId;
      return !upcomingVideoIds.has(vid);
    });

    filteredContents.splice(insertIdx, 0, ...validUpcoming);
    playlistPanel.contents = filteredContents;
    return json;
  }

  if (!window.__ytmFetchHookInstalled) {
    window.__ytmFetchHookInstalled = true;
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
      const res = await origFetch.apply(this, args);
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);

      if (url && url.includes('/youtubei/v1/next') && Array.isArray(window.__syncedUpcomingTracks) && window.__syncedUpcomingTracks.length > 0) {
        try {
          const json = await res.clone().json();
          const modifiedJson = injectUpcomingTracksIntoWatchNext(json, window.__syncedUpcomingTracks);
          const modifiedBlob = new Blob([JSON.stringify(modifiedJson)], { type: 'application/json' });
          return new Response(modifiedBlob, {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers
          });
        } catch (e) {
          bridgeLog(`Error modifying /youtubei/v1/next response: ${e.message}`);
        }
      }
      return res;
    };
  }

  function injectUpcomingTracksIntoRedux(tracksToInject) {
    if (!Array.isArray(tracksToInject) || tracksToInject.length === 0) return false;
    const store = document.querySelector('ytmusic-player-bar')?.queue?.store?.store;
    if (!store || typeof store.dispatch !== 'function') return false;

    const domItems = Array.from(document.querySelectorAll('ytmusic-player-queue-item'));
    let currentQueueIdx = domItems.findIndex(el => el.selected);
    if (currentQueueIdx === -1) {
      const p = document.getElementById('movie_player');
      const curVid = p && typeof p.getVideoData === 'function' ? p.getVideoData()?.video_id : null;
      if (curVid) {
        currentQueueIdx = domItems.findIndex(el => el.data && el.data.videoId === curVid);
      }
    }

    const targetIdx = currentQueueIdx !== -1 ? currentQueueIdx + 1 : 0;
    const nextItem = currentQueueIdx !== -1 && domItems[currentQueueIdx + 1];
    const nextVid = nextItem && nextItem.data ? nextItem.data.videoId : null;

    if (nextVid === tracksToInject[0]?.videoId) {
      return true;
    }

    const formattedItems = tracksToInject.slice(0, 2).map(formatUpcomingTrackItem).filter(Boolean);
    if (formattedItems.length === 0) return false;

    try {
      store.dispatch({
        type: 'ADD_ITEMS',
        payload: {
          index: targetIdx,
          items: formattedItems,
          nextQueueItemId: Math.floor(Math.random() * 100000),
          shouldAssignIds: true
        }
      });
      bridgeLog(`Injected ${formattedItems.length} upcoming track(s) into Redux queue at index ${targetIdx}`);
      return true;
    } catch (e) {
      bridgeLog(`Failed to dispatch ADD_ITEMS to Redux queue: ${e.message}`);
      return false;
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'ytm-sync-isolated') return;

    const { action, videoId, currentTime, rate, isPlaying, track, artist, albumArtUrl, upcomingTracks } = event.data;

    if (action === 'SYNC_UPCOMING_TRACKS' && Array.isArray(upcomingTracks)) {
      window.__syncedUpcomingTracks = upcomingTracks.slice(0, 2);
      bridgeLog(`Synced upcoming tracks updated (count=${window.__syncedUpcomingTracks.length}): ${window.__syncedUpcomingTracks.map(t => t.videoId).join(', ')}`);
      injectUpcomingTracksIntoRedux(window.__syncedUpcomingTracks);
      return;
    }

    bridgeLog(`Received message from isolated world: action=${action}, videoId=${videoId}`);
    const player = document.getElementById('movie_player') ||
                   document.querySelector('ytmusic-player') ||
                   document.querySelector('#player');

    if (action === 'LOAD_VIDEO' && videoId) {
      if (Array.isArray(upcomingTracks) && upcomingTracks.length > 0) {
        window.__syncedUpcomingTracks = upcomingTracks.slice(0, 2);
      }

      const app = document.querySelector('ytmusic-app');
      const playerBar = document.querySelector('ytmusic-player-bar');

      const currentVid = (player && typeof player.getVideoData === 'function')
        ? (player.getVideoData() || {}).video_id
        : null;

      bridgeLog(`LOAD_VIDEO target=${videoId}, currently playing=${currentVid}`);

      if (currentVid === videoId) {
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

      const domQueueItems = Array.from(document.querySelectorAll('ytmusic-player-queue-item'));
      let currentQueueIdx = domQueueItems.findIndex(el => el.selected);
      if (currentQueueIdx === -1 && currentVid) {
        currentQueueIdx = domQueueItems.findIndex(el => el.data && el.data.videoId === currentVid);
      }

      let handledViaNativeSkip = false;

      const nextQueueItem = (currentQueueIdx !== -1 && currentQueueIdx + 1 < domQueueItems.length)
        ? domQueueItems[currentQueueIdx + 1]
        : null;
      const nextQueueVid = (nextQueueItem && nextQueueItem.data) ? nextQueueItem.data.videoId : null;

      bridgeLog(`Checking queue skip options: currentQueueIdx=${currentQueueIdx}, nextQueueVid=${nextQueueVid}, target=${videoId}`);

      if (nextQueueVid === videoId) {
        const nextBtn = playerBar ? (playerBar.querySelector('.next-button') || playerBar.querySelector('#next-button')) : document.querySelector('ytmusic-player-bar .next-button');
        if (nextBtn && typeof nextBtn.click === 'function') {
          bridgeLog(`Using native next button for pre-buffered track transition: ${videoId}`);
          nextBtn.click();
          handledViaNativeSkip = true;
        }
      }

      if (!handledViaNativeSkip) {
        const prevQueueItem = (currentQueueIdx > 0 && currentQueueIdx - 1 < domQueueItems.length)
          ? domQueueItems[currentQueueIdx - 1]
          : null;
        const prevQueueVid = (prevQueueItem && prevQueueItem.data) ? prevQueueItem.data.videoId : null;

        if (prevQueueVid === videoId) {
          const prevBtn = playerBar ? (playerBar.querySelector('.previous-button') || playerBar.querySelector('#previous-button')) : document.querySelector('ytmusic-player-bar .previous-button');
          if (prevBtn && typeof prevBtn.click === 'function') {
            bridgeLog(`Using native previous button for track transition: ${videoId}`);
            prevBtn.click();
            handledViaNativeSkip = true;
          }
        }
      }

      if (!handledViaNativeSkip && domQueueItems.length > 0) {
        const matchingItem = domQueueItems.find(el => el.data && el.data.videoId === videoId);
        if (matchingItem) {
          const playBtn = matchingItem.querySelector('#play-button, .play-button') || matchingItem;
          if (typeof playBtn.click === 'function') {
            bridgeLog(`Using in-queue selection for track: ${videoId}`);
            playBtn.click();
            handledViaNativeSkip = true;
          }
        }
      }

      if (!handledViaNativeSkip) {
        const trackToInject = {
          videoId,
          title: track || 'Track',
          artist: artist || ''
        };
        const tracks = [trackToInject];
        if (Array.isArray(upcomingTracks) && upcomingTracks.length > 0) {
          for (const u of upcomingTracks) {
            if (u.videoId !== videoId && tracks.length < 2) tracks.push(u);
          }
        }

        const injected = injectUpcomingTracksIntoRedux(tracks);
        if (injected) {
          const nextBtn = playerBar ? (playerBar.querySelector('.next-button') || playerBar.querySelector('#next-button')) : document.querySelector('ytmusic-player-bar .next-button');
          if (nextBtn && typeof nextBtn.click === 'function') {
            bridgeLog(`Injected ${videoId} at next position in Redux; triggering native next button`);
            nextBtn.click();
            handledViaNativeSkip = true;
          }
        }
      }

      if (!handledViaNativeSkip) {
        bridgeLog(`Target track ${videoId} not in immediate queue (next was ${nextQueueVid}); falling back to SPA navigation`);
        const startSec = Math.floor(currentTime || 0);
        const watchEndpoint = {
          videoId: videoId
        };
        if (startSec > 0) {
          watchEndpoint.startTimeSeconds = startSec;
        }
        if (event.data.playlistId && typeof event.data.playlistId === 'string') {
          watchEndpoint.playlistId = event.data.playlistId;
        }
        if (typeof event.data.playlistIndex === 'number' && Number.isInteger(event.data.playlistIndex) && event.data.playlistIndex >= 0) {
          watchEndpoint.index = event.data.playlistIndex;
        }

        let navigated = false;
        if (app && typeof app.handleNavigationEndpoint === 'function') {
          try {
            app.handleNavigationEndpoint({ watchEndpoint });
            bridgeLog(`Navigated via app.handleNavigationEndpoint to ${videoId}`);
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
              detail: {
                endpoint: { watchEndpoint }
              }
            });
            app.dispatchEvent(navEvent);
            navigated = true;
          } catch (e) {
            console.warn('[YTM Page Bridge] dispatchEvent yt-navigate failed:', e);
          }
        }

        if (!navigated && app && app.navigator && typeof app.navigator.navigate === 'function') {
          try {
            app.navigator.navigate({ watchEndpoint });
            navigated = true;
          } catch (e) {
            console.warn('[YTM Page Bridge] app.navigator.navigate failed:', e);
          }
        }

        if (!navigated) {
          const searchParams = new URLSearchParams();
          searchParams.set('v', videoId);
          if (startSec > 0) searchParams.set('t', startSec);
          if (watchEndpoint.playlistId) searchParams.set('list', watchEndpoint.playlistId);
          if (typeof watchEndpoint.index === 'number') searchParams.set('index', watchEndpoint.index);
          window.location.assign(`/watch?${searchParams.toString()}`);
          return;
        }
      }

      if (typeof currentTime === 'number' && currentTime > 3) {
        setTimeout(() => {
          const livePlayer = document.getElementById('movie_player') ||
                             document.querySelector('ytmusic-player') ||
                             document.querySelector('#player');
          if (livePlayer && typeof livePlayer.seekTo === 'function') {
            livePlayer.seekTo(currentTime, true);
          }
        }, 400);
      }

      if (isPlaying === false) {
        const pauseOnReady = () => {
          const livePlayer = document.getElementById('movie_player') ||
                             document.querySelector('ytmusic-player') ||
                             document.querySelector('#player');
          if (livePlayer && typeof livePlayer.pauseVideo === 'function') {
            livePlayer.pauseVideo();
          }
        };
        setTimeout(pauseOnReady, 350);
        setTimeout(pauseOnReady, 900);
      }
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
    }
  });

  function checkIsAd() {
    const player = document.getElementById('movie_player') ||
                   document.querySelector('ytmusic-player') ||
                   document.querySelector('#player');
    if (player) {
      if (typeof player.getAdState === 'function' && player.getAdState() >= 0) return true;
      if (typeof player.isLifaAdPlaying === 'function' && player.isLifaAdPlaying()) return true;
      if (typeof player.isAd === 'function' && player.isAd()) return true;
      if (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting')) return true;
    }
    const starkBadge = document.querySelector('ytmusic-player-bar .badge-style-type-ad-stark');
    if (starkBadge && !starkBadge.hidden && starkBadge.offsetParent !== null) return true;
    if (document.querySelector('.ad-showing, .ytp-ad-showing, .ytp-ad-player-overlay, .video-ads.ytp-ad-module .ytp-ad-text')) return true;
    return false;
  }

  let isAdActive = false;
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
