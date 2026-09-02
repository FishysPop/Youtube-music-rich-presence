(() => {
  if (window.__ytmPageBridgeInstalled) return;
  window.__ytmPageBridgeInstalled = true;
  console.log('[YTM Page Bridge] Script successfully installed in MAIN world');

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'ytm-sync-isolated') return;

    const { action, videoId, currentTime, rate, isPlaying, track, artist, albumArtUrl } = event.data;
    console.log(`[YTM Page Bridge] Received message from isolated world: action=${action}, videoId=${videoId}`);
    const player = document.getElementById('movie_player') ||
                   document.querySelector('ytmusic-player') ||
                   document.querySelector('#player');

    if (action === 'LOAD_VIDEO' && videoId) {
      const app = document.querySelector('ytmusic-app');
      const playerBar = document.querySelector('ytmusic-player-bar');

      const currentVid = (player && typeof player.getVideoData === 'function')
        ? (player.getVideoData() || {}).video_id
        : null;

      console.log(`[YTM Page Bridge] LOAD_VIDEO target=${videoId}, currently playing=${currentVid}`);

      if (currentVid === videoId) {
        console.log(`[YTM Page Bridge] Video ${videoId} is already loaded. Adjusting playback state: currentTime=${currentTime}, isPlaying=${isPlaying}`);
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
      const currentQueueIdx = domQueueItems.findIndex(el => el.selected);

      let handledViaNativeSkip = false;

      const nextQueueItem = (currentQueueIdx !== -1 && currentQueueIdx + 1 < domQueueItems.length)
        ? domQueueItems[currentQueueIdx + 1]
        : null;
      const nextQueueVid = (nextQueueItem && nextQueueItem.data) ? nextQueueItem.data.videoId : null;

      if (nextQueueVid === videoId) {
        const nextBtn = playerBar ? (playerBar.querySelector('.next-button') || playerBar.querySelector('#next-button')) : document.querySelector('ytmusic-player-bar .next-button');
        if (nextBtn && typeof nextBtn.click === 'function') {
          console.log(`[YTM Page Bridge] Using native next button for pre-buffered track transition: ${videoId}`);
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
            console.log(`[YTM Page Bridge] Using native previous button for track transition: ${videoId}`);
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
            console.log(`[YTM Page Bridge] Using in-queue selection for track: ${videoId}`);
            playBtn.click();
            handledViaNativeSkip = true;
          }
        }
      }

      if (!handledViaNativeSkip) {
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
