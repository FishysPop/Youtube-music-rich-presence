(() => {
if (typeof window.__ytmRpcCleanup === 'function') {
  window.__ytmRpcCleanup();
}

let isExtensionContextValid = true;

let lastContextInvalidWarningTime = 0;
const CONTEXT_INVALID_WARNING_INTERVAL = 30000;

let lastContextValidationTime = 0;
let lastContextValidationResult = true;
const CONTEXT_VALIDATION_CACHE_DURATION = 1000;

function isExtensionContextStillValid() {
  const now = Date.now();
  
  if (now - lastContextValidationTime < CONTEXT_VALIDATION_CACHE_DURATION) {
    return lastContextValidationResult;
  }
  
  try {
    lastContextValidationResult = typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.id !== 'undefined';
  } catch (e) {
    lastContextValidationResult = false;
  }
  
  lastContextValidationTime = now;
  return lastContextValidationResult;
}

function findVideoElement() {
  const directVideo = document.querySelector('video.html5-main-video') || document.querySelector('video');
  if (directVideo) return directVideo;

  const player = document.querySelector('ytmusic-player') || document.querySelector('#player');
  if (player) {
    if (player.shadowRoot) {
      const shadowVideo = player.shadowRoot.querySelector('video');
      if (shadowVideo) return shadowVideo;
    }
    const innerVideo = player.querySelector('video');
    if (innerVideo) return innerVideo;
  }

  const playerBar = document.querySelector('ytmusic-player-bar');
  if (playerBar && playerBar.shadowRoot) {
    const barVideo = playerBar.shadowRoot.querySelector('video');
    if (barVideo) return barVideo;
  }

  return null;
}

function getCurrentTrackInfo() {
  try {
    const playerBar = document.querySelector('ytmusic-player-bar');
    if (!playerBar) {
      return null;
    }

    let root = playerBar;
    if (playerBar.shadowRoot) {
      root = playerBar.shadowRoot;
    }

    const trackElement = root.querySelector('.title.style-scope.ytmusic-player-bar') || root.querySelector('yt-formatted-string.title') || root.querySelector('.middle-controls .title');
    const artistElement = root.querySelector('.byline.style-scope.ytmusic-player-bar') || root.querySelector('yt-formatted-string.byline') || root.querySelector('.middle-controls .byline');
    const albumArtElement = root.querySelector('img.image.style-scope.ytmusic-player-bar') || root.querySelector('.thumbnail-image-wrapper img') || root.querySelector('#thumbnail img');
    const timeInfoElement = root.querySelector('.time-info.style-scope.ytmusic-player-bar') || root.querySelector('.time-info');
    const playPauseButton = root.querySelector('#play-pause-button');
    const videoElement = findVideoElement();

    const trackText = trackElement ? (trackElement.textContent || trackElement.innerText || trackElement.getAttribute('title') || '').trim() : '';
    let artistText = artistElement ? (artistElement.textContent || artistElement.innerText || artistElement.getAttribute('title') || '').trim() : '';

    if (trackText && artistText) {
      const separatorIndex = artistText.indexOf('•');
      if (separatorIndex !== -1) {
        artistText = artistText.substring(0, separatorIndex).trim();
      }
      if (artistText.endsWith(',')) { 
        artistText = artistText.substring(0, artistText.length - 1).trim();
      }
      const artist = artistText;
      const track = trackText;

      let albumArtUrl = null;
      if (albumArtElement && albumArtElement.src) {
        if (albumArtElement.src.startsWith('//')) {
          albumArtUrl = 'https:' + albumArtElement.src;
        } else if (albumArtElement.src.startsWith('http')) {
          albumArtUrl = albumArtElement.src;
        }
      }

      let currentTime = 0;
      let duration = 0;

      if (timeInfoElement) {
        const timeText = (timeInfoElement.textContent || timeInfoElement.innerText || '').trim();
        if (timeText) {
          const timeParts = timeText.split(' / ');
          if (timeParts.length === 2) {
            const parsePart = (str) => {
              const parts = str.trim().split(':').map(Number);
              if (parts.some(isNaN)) return 0;
              if (parts.length === 2) return parts[0] * 60 + parts[1];
              if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
              return 0;
            };
            const parsedDuration = parsePart(timeParts[1]);
            if (parsedDuration > 0) {
              duration = parsedDuration;
            }
            const parsedCurrent = parsePart(timeParts[0]);
            if (parsedCurrent > 0) {
              currentTime = parsedCurrent;
            }
          }
        }
      }

      if (videoElement) {
        if ((!duration || duration <= 0) && !isNaN(videoElement.duration) && videoElement.duration > 0 && isFinite(videoElement.duration)) {
          duration = Math.floor(videoElement.duration);
        }
        if (currentTime === 0 && !isNaN(videoElement.currentTime) && videoElement.currentTime >= 0) {
          currentTime = Math.floor(videoElement.currentTime);
        }
      }

      if (duration > 0 && currentTime >= duration) {
        currentTime = 0;
      }

      let isPlaying = false;
      if (videoElement) {
        isPlaying = !videoElement.paused && !videoElement.ended && videoElement.readyState > 1;
      }
      if (playPauseButton) {
        const titleAttr = (playPauseButton.getAttribute('title') || playPauseButton.title || '').toLowerCase();
        const ariaLabel = (playPauseButton.getAttribute('aria-label') || '').toLowerCase();
        if (titleAttr.includes('pause') || ariaLabel.includes('pause')) {
          isPlaying = true;
        } else if (titleAttr.includes('play') || ariaLabel.includes('play')) {
          if (!videoElement) isPlaying = false;
        }
      }

      return { track, artist, albumArtUrl, currentTime, duration, isPlaying, userIsSeeking };
    }
  } catch (error) {
    console.error('[YTM RPC Content] Error in getCurrentTrackInfo:', error);
  }
  return null;
}

function sendMessageToBackgroundScript(data) {
  if (!isExtensionContextStillValid()) {
    const now = Date.now();
    if (now - lastContextInvalidWarningTime > CONTEXT_INVALID_WARNING_INTERVAL) {
      lastContextInvalidWarningTime = now;
    }
    return;
  }
  
  try {
    chrome.runtime.sendMessage(data, (response) => {
      if (chrome.runtime.lastError) {
        if (chrome.runtime.lastError.message.includes('Extension context invalidated')) {
          isExtensionContextValid = false;
        }
      }
    });
  } catch (error) {
    if (error.message && error.message.includes('Extension context invalidated')) {
      isExtensionContextValid = false;
    }
  }
}

let lastSentTrack = null;
let lastSentArtist = null;
let lastSentAlbumArtUrl = null;
let lastSentDuration = null;
let lastSentIsPlaying = null;
let lastSentCurrentTime = null;
let lastSentTimestamp = null;
let updateDebounceTimer = null;
let pauseGracePeriodTimer = null;
let pauseGracePeriodExpired = false;
let consecutiveNoTrackCount = 0;

let navigationFinishListener = null;
let playerBarObserver = null;
let periodicInterval = null;
let currentObservedVideo = null;
let userIsSeeking = false;

function onUserSeekStart() {
  userIsSeeking = true;
}

function onUserSeekEnd() {
  userIsSeeking = false;
  updateTrackInfo(true);
}

function removeVideoListeners(video) {
  if (!video) return;
  video.removeEventListener('playing', onVideoEvent);
  video.removeEventListener('play', onVideoEvent);
  video.removeEventListener('pause', onVideoEvent);
  video.removeEventListener('seeking', onUserSeekStart);
  video.removeEventListener('seeked', onUserSeekEnd);
  video.removeEventListener('loadedmetadata', onVideoEvent);
  video.removeEventListener('durationchange', onVideoEvent);
  video.removeEventListener('canplay', onVideoEvent);
  video.removeEventListener('timeupdate', onVideoTimeUpdate);
}

function attachVideoListeners() {
  const video = findVideoElement();
  if (video && video !== currentObservedVideo) {
    if (currentObservedVideo) {
      removeVideoListeners(currentObservedVideo);
    }
    currentObservedVideo = video;
    video.addEventListener('playing', onVideoEvent);
    video.addEventListener('play', onVideoEvent);
    video.addEventListener('pause', onVideoEvent);
    video.addEventListener('seeking', onUserSeekStart);
    video.addEventListener('seeked', onUserSeekEnd);
    video.addEventListener('loadedmetadata', onVideoEvent);
    video.addEventListener('durationchange', onVideoEvent);
    video.addEventListener('canplay', onVideoEvent);
    video.addEventListener('timeupdate', onVideoTimeUpdate);
  }
}

function onVideoEvent() {
  updateTrackInfo(true);
}

let lastTimeUpdateCheck = 0;
function onVideoTimeUpdate() {
  const now = Date.now();
  if (now - lastTimeUpdateCheck < 500) return;
  lastTimeUpdateCheck = now;
  updateTrackInfo(false);
}

function cleanup() {
  if (updateDebounceTimer) {
    clearTimeout(updateDebounceTimer);
    updateDebounceTimer = null;
  }
  
  if (pauseGracePeriodTimer) {
    clearTimeout(pauseGracePeriodTimer);
    pauseGracePeriodTimer = null;
  }

  if (navigationFinishListener) {
    window.removeEventListener('yt-navigate-finish', navigationFinishListener);
    navigationFinishListener = null;
  }
  
  if (playerBarObserver) {
    playerBarObserver.disconnect();
    playerBarObserver = null;
  }
  
  if (periodicInterval) {
    clearInterval(periodicInterval);
    periodicInterval = null;
  }

  if (currentObservedVideo) {
    removeVideoListeners(currentObservedVideo);
    currentObservedVideo = null;
  }
  
  isExtensionContextValid = false;
}

window.addEventListener('beforeunload', () => {
  cleanup();
});

function updateTrackInfo(forceSend = false) {
  if (!isExtensionContextStillValid()) {
    const now = Date.now();
    if (now - lastContextInvalidWarningTime > CONTEXT_INVALID_WARNING_INTERVAL) {
      lastContextInvalidWarningTime = now;
    }
    return;
  }
  
  attachVideoListeners();
  clearTimeout(updateDebounceTimer);

  updateDebounceTimer = setTimeout(() => {
    if (!isExtensionContextStillValid()) return;
    
    const currentTrackInfo = getCurrentTrackInfo();

    if (currentTrackInfo) {
      consecutiveNoTrackCount = 0;
      const now = Date.now();
      const isNewTrack = currentTrackInfo.track !== lastSentTrack || currentTrackInfo.artist !== lastSentArtist;

      let isPlayingToSend = currentTrackInfo.isPlaying;

      if (currentTrackInfo.isPlaying) {
        if (pauseGracePeriodTimer) {
          clearTimeout(pauseGracePeriodTimer);
          pauseGracePeriodTimer = null;
        }
        pauseGracePeriodExpired = false;
      } else if (lastSentIsPlaying === true) {
        if (!pauseGracePeriodTimer && !pauseGracePeriodExpired) {
          pauseGracePeriodTimer = setTimeout(() => {
            pauseGracePeriodTimer = null;
            pauseGracePeriodExpired = true;
            updateTrackInfo(true);
          }, 1000);
          isPlayingToSend = true;
        } else if (pauseGracePeriodTimer) {
          isPlayingToSend = true;
        }
      }

      let isTimeShifted = false;
      if (!isNewTrack && typeof currentTrackInfo.currentTime === 'number' && typeof lastSentCurrentTime === 'number' && lastSentTimestamp !== null) {
        const elapsedSinceLastSend = (now - lastSentTimestamp) / 1000;
        const expectedCurrentTime = isPlayingToSend ? (lastSentCurrentTime + elapsedSinceLastSend) : lastSentCurrentTime;
        const timeDiff = Math.abs(currentTrackInfo.currentTime - expectedCurrentTime);

        // Ignore frozen DOM artifact (0:00) when song is progressing normally
        const isSpuriousZero = currentTrackInfo.currentTime === 0 && expectedCurrentTime > 3 && !userIsSeeking;
        if (!isSpuriousZero && timeDiff > 3.5) {
          isTimeShifted = true;
        }
      }

      const shouldSend = forceSend ||
          isNewTrack ||
          currentTrackInfo.artist !== lastSentArtist ||
          currentTrackInfo.albumArtUrl !== lastSentAlbumArtUrl ||
          currentTrackInfo.duration !== lastSentDuration ||
          isPlayingToSend !== lastSentIsPlaying ||
          isTimeShifted;

      if (shouldSend) {
        const dataToSend = { ...currentTrackInfo, isPlaying: isPlayingToSend };
        sendMessageToBackgroundScript(dataToSend);
        
        lastSentTrack = currentTrackInfo.track;
        lastSentArtist = currentTrackInfo.artist;
        lastSentAlbumArtUrl = currentTrackInfo.albumArtUrl;
        lastSentDuration = currentTrackInfo.duration;
        lastSentIsPlaying = isPlayingToSend;
        lastSentCurrentTime = currentTrackInfo.currentTime;
        lastSentTimestamp = now;
      }
    } else {
      consecutiveNoTrackCount++;
      // Wait for 3 consecutive empty polls before declaring no track
      if (consecutiveNoTrackCount >= 3) {
        if (lastSentTrack !== null || lastSentAlbumArtUrl !== null) {
          sendMessageToBackgroundScript({ type: 'NO_TRACK' });
          lastSentTrack = null;
          lastSentArtist = null;
          lastSentAlbumArtUrl = null;
          lastSentDuration = null;
          lastSentIsPlaying = null;
          lastSentCurrentTime = null;
          lastSentTimestamp = null;
          if (pauseGracePeriodTimer) {
            clearTimeout(pauseGracePeriodTimer);
            pauseGracePeriodTimer = null;
          }
          pauseGracePeriodExpired = false;
        }
      }
    }
  }, 250);
}

updateTrackInfo(true);

navigationFinishListener = () => {
  lastSentTrack = null;
  lastSentArtist = null;
  lastSentAlbumArtUrl = null;
  lastSentDuration = null;
  lastSentIsPlaying = null;
  lastSentCurrentTime = null;
  lastSentTimestamp = null;
  if (pauseGracePeriodTimer) {
    clearTimeout(pauseGracePeriodTimer);
    pauseGracePeriodTimer = null;
  }
  pauseGracePeriodExpired = false;
  updateTrackInfo(true);
};

window.addEventListener('yt-navigate-finish', navigationFinishListener);

const playerBarObserverTarget = document.querySelector('ytmusic-player-bar');
if (playerBarObserverTarget) {
  playerBarObserver = new MutationObserver(() => {
    updateTrackInfo();
  });

  playerBarObserver.observe(playerBarObserverTarget, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'title'],
    characterData: true
  });
}

attachVideoListeners();

periodicInterval = setInterval(() => {
  attachVideoListeners();
  updateTrackInfo();
}, 1500);

window.__ytmRpcCleanup = cleanup;
})();



