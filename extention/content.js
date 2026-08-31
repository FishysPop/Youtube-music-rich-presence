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

    const trackElement = root.querySelector('.title.style-scope.ytmusic-player-bar');
    const artistElement = root.querySelector('.byline.style-scope.ytmusic-player-bar');
    const albumArtElement = root.querySelector('img.image.style-scope.ytmusic-player-bar');
    const timeInfoElement = root.querySelector('.time-info.style-scope.ytmusic-player-bar'); 
    const playPauseButton = root.querySelector('#play-pause-button');

    if (trackElement && trackElement.innerText && artistElement && artistElement.innerText) {
      const track = trackElement.innerText.trim();
      let artistText = artistElement.innerText.trim();

      const separatorIndex = artistText.indexOf('•');
      if (separatorIndex !== -1) {
        artistText = artistText.substring(0, separatorIndex).trim();
      }
      if (artistText.endsWith(',')) { 
        artistText = artistText.substring(0, artistText.length - 1).trim();
      }
      const artist = artistText;

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
      if (timeInfoElement && timeInfoElement.innerText) {
        const timeParts = timeInfoElement.innerText.split(' / ');
        if (timeParts.length === 2) {
          const currentTimeString = timeParts[0].trim();
          const currentTimeParts = currentTimeString.split(':').map(Number);
          if (currentTimeParts.length === 2) {
            currentTime = currentTimeParts[0] * 60 + currentTimeParts[1];
          } else if (currentTimeParts.length === 3) { 
            currentTime = currentTimeParts[0] * 3600 + currentTimeParts[1] * 60 + currentTimeParts[2];
          }
          
          const durationString = timeParts[1].trim();
          const durationParts = durationString.split(':').map(Number);
          if (durationParts.length === 2) {
            duration = durationParts[0] * 60 + durationParts[1];
          } else if (durationParts.length === 3) { 
            duration = durationParts[0] * 3600 + durationParts[1] * 60 + durationParts[2];
          }
        }
      }

      const videoElement = document.querySelector('video');
      if ((!duration || duration <= 0) && videoElement && !isNaN(videoElement.duration) && videoElement.duration > 0) {
        duration = Math.floor(videoElement.duration);
      }
      if (videoElement && !isNaN(videoElement.currentTime) && videoElement.currentTime >= 0) {
        currentTime = Math.floor(videoElement.currentTime);
      }

      let isPlaying = false;
      if (playPauseButton && playPauseButton.title) {
        isPlaying = playPauseButton.title === 'Pause'; 
      } else if (videoElement) {
        isPlaying = !videoElement.paused && !videoElement.ended;
      }

      return { track, artist, albumArtUrl, currentTime, duration, isPlaying };
    }
  } catch (error) {
    console.error('ContentScript: Error in getCurrentTrackInfo:', error);
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
let trackChangeGracePeriodActive = false;
let trackChangeGracePeriodTimer = null;
let pauseGracePeriodTimer = null;
let pauseGracePeriodExpired = false;
let durationWaitAttempts = 0;

let navigationFinishListener = null;
let playerBarObserver = null;
let periodicInterval = null;
let currentObservedVideo = null;

let trackSettlingUntil = 0;
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
  const video = document.querySelector('video');
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
  
  if (trackChangeGracePeriodTimer) {
    clearTimeout(trackChangeGracePeriodTimer);
    trackChangeGracePeriodTimer = null;
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
  
  durationWaitAttempts = 0;
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
      const now = Date.now();
      const isNewTrack = currentTrackInfo.track !== lastSentTrack;
      const videoElement = document.querySelector('video');

      if (isNewTrack) {
        trackSettlingUntil = now + 3000;
        lastSentDuration = null;
        lastSentCurrentTime = 0;
        lastSentTimestamp = now;
        currentTrackInfo.currentTime = 0;
      }

      const isSettling = now < trackSettlingUntil;
      if (isSettling && !userIsSeeking) {
        if (currentTrackInfo.currentTime > 5 || (videoElement && videoElement.currentTime > 5)) {
          currentTrackInfo.currentTime = 0;
        } else if (currentTrackInfo.currentTime <= 5 && videoElement && !videoElement.ended && videoElement.currentTime <= 5) {
          trackSettlingUntil = 0;
        }
      }

      if (currentTrackInfo.duration > 0 && currentTrackInfo.currentTime >= currentTrackInfo.duration) {
        currentTrackInfo.currentTime = 0;
      }

      if (currentTrackInfo.duration === 0 && durationWaitAttempts < 4) {
        durationWaitAttempts++;
        clearTimeout(updateDebounceTimer);
        updateDebounceTimer = setTimeout(() => updateTrackInfo(true), 150);
        return;
      }
      durationWaitAttempts = 0;

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
      if (!isSettling && currentTrackInfo.currentTime !== undefined && lastSentCurrentTime !== null && lastSentTimestamp !== null) {
        const elapsedSinceLastSend = (now - lastSentTimestamp) / 1000;
        const expectedCurrentTime = isPlayingToSend ? (lastSentCurrentTime + elapsedSinceLastSend) : lastSentCurrentTime;
        if (Math.abs(currentTrackInfo.currentTime - expectedCurrentTime) > 2) {
          isTimeShifted = true;
        }
      }

      if (forceSend ||
          isNewTrack ||
          currentTrackInfo.artist !== lastSentArtist ||
          currentTrackInfo.albumArtUrl !== lastSentAlbumArtUrl ||
          currentTrackInfo.duration !== lastSentDuration ||
          isPlayingToSend !== lastSentIsPlaying ||
          isTimeShifted) {
          
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
      if (lastSentTrack !== null || lastSentAlbumArtUrl !== null) {
        sendMessageToBackgroundScript({ type: 'NO_TRACK' });
        lastSentTrack = null;
        lastSentArtist = null;
        lastSentAlbumArtUrl = null;
        lastSentDuration = null;
        lastSentIsPlaying = null;
        lastSentCurrentTime = null;
        lastSentTimestamp = null;
        trackSettlingUntil = 0;
        if (pauseGracePeriodTimer) {
          clearTimeout(pauseGracePeriodTimer);
          pauseGracePeriodTimer = null;
        }
        pauseGracePeriodExpired = false;
      }
    }
  }, 100);
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
  clearTimeout(trackChangeGracePeriodTimer);
  trackChangeGracePeriodActive = false;
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

