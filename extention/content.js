let isExtensionContextValid = true;

let lastContextInvalidWarningTime = 0;
const CONTEXT_INVALID_WARNING_INTERVAL = 30000; // 30 seconds

let lastContextValidationTime = 0;
let lastContextValidationResult = true;
const CONTEXT_VALIDATION_CACHE_DURATION = 1000; // 1 second

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
          artistText = artistText.substring(0, artistText.length -1).trim();
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

      let isPlaying = false;
      if (playPauseButton && playPauseButton.title) {
          isPlaying = playPauseButton.title === 'Pause'; 
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
        } else {
          console.warn('ContentScript: Error sending message to background or no listener:', chrome.runtime.lastError.message, 'Data:', data);
        }
      } else {
      }
    });
  } catch (error) {
    if (error.message && error.message.includes('Extension context invalidated')) {
      isExtensionContextValid = false;
    } else {
      console.error('ContentScript: Synchronous error sending message to background script:', error, 'Data:', data);
    }
  }
}

let lastSentTrack = null;
let lastSentArtist = null;
let lastSentAlbumArtUrl = null;
let lastSentDuration = null;
let lastSentIsPlaying = null;
let lastSentCurrentTime = null;
let updateDebounceTimer = null;
let trackChangeGracePeriodActive = false;
let trackChangeGracePeriodTimer = null;

let navigationFinishListener = null;
let playerBarObserver = null;
let playerBarInterval = null;

function cleanup() {
  if (updateDebounceTimer) {
    clearTimeout(updateDebounceTimer);
    updateDebounceTimer = null;
  }
  
  if (trackChangeGracePeriodTimer) {
    clearTimeout(trackChangeGracePeriodTimer);
    trackChangeGracePeriodTimer = null;
  }
  
  if (navigationFinishListener) {
    window.removeEventListener('yt-navigate-finish', navigationFinishListener);
    navigationFinishListener = null;
  }
  
  if (playerBarObserver) {
    playerBarObserver.disconnect();
    playerBarObserver = null;
  }
  
  if (playerBarInterval) {
    clearInterval(playerBarInterval);
    playerBarInterval = null;
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
  
  clearTimeout(updateDebounceTimer);

  updateDebounceTimer = setTimeout(() => {
      if (!isExtensionContextStillValid()) {
        const now = Date.now();
        if (now - lastContextInvalidWarningTime > CONTEXT_INVALID_WARNING_INTERVAL) {
          lastContextInvalidWarningTime = now;
        }
        return;
      }
    
    const currentTrackInfo = getCurrentTrackInfo();

    if (currentTrackInfo) {
        if (currentTrackInfo.track !== lastSentTrack) {
            trackChangeGracePeriodActive = true;
            clearTimeout(trackChangeGracePeriodTimer);
            trackChangeGracePeriodTimer = setTimeout(() => {
                trackChangeGracePeriodActive = false;
            }, 500); 
        }

        let isPlayingToSend = currentTrackInfo.isPlaying;
        if (trackChangeGracePeriodActive && !currentTrackInfo.isPlaying) {
            isPlayingToSend = true;
        }

        if (forceSend ||
            currentTrackInfo.track !== lastSentTrack ||
            currentTrackInfo.artist !== lastSentArtist ||
            currentTrackInfo.albumArtUrl !== lastSentAlbumArtUrl ||
            isPlayingToSend !== lastSentIsPlaying ||
            (currentTrackInfo.currentTime !== undefined &&
             lastSentCurrentTime !== null &&
             Math.abs(currentTrackInfo.currentTime - lastSentCurrentTime) > 5)) {
            
            const dataToSend = { ...currentTrackInfo, isPlaying: isPlayingToSend };
            sendMessageToBackgroundScript(dataToSend);
            
            lastSentTrack = currentTrackInfo.track; 
            lastSentArtist = currentTrackInfo.artist;
            lastSentAlbumArtUrl = currentTrackInfo.albumArtUrl;
            lastSentDuration = currentTrackInfo.duration;
            lastSentIsPlaying = isPlayingToSend;
            lastSentCurrentTime = currentTrackInfo.currentTime;
        } else {
        }
    } else {
        if (lastSentTrack !== null || lastSentAlbumArtUrl !== null) {
            sendMessageToBackgroundScript({ type: 'NO_TRACK' });
            lastSentTrack = null;
            lastSentArtist = null;
            lastSentAlbumArtUrl = null;
            lastSentDuration = null;
            lastSentIsPlaying = null;
            clearTimeout(trackChangeGracePeriodTimer);
            trackChangeGracePeriodActive = false;
        } else {
        }
    }
  }, 150);
}


updateTrackInfo(true);

navigationFinishListener = () => {
    lastSentTrack = null;
    lastSentArtist = null;
    lastSentAlbumArtUrl = null;
    lastSentDuration = null;
    lastSentIsPlaying = null;
    lastSentCurrentTime = null;
    clearTimeout(trackChangeGracePeriodTimer);
    trackChangeGracePeriodActive = false;
    updateTrackInfo(true);
};

window.addEventListener('yt-navigate-finish', navigationFinishListener);

const playerBarObserverTarget = document.querySelector('ytmusic-player-bar');
if (playerBarObserverTarget) {
    playerBarObserver = new MutationObserver((mutationsList, observer) => {
        updateTrackInfo();
    });

    playerBarObserver.observe(playerBarObserverTarget, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'title', 'href'],
        characterData: true
    });
} else {
    console.warn("[YTMusicRPC Content] ytmusic-player-bar not found for MutationObserver. Falling back to setInterval.");
    playerBarInterval = setInterval(() => updateTrackInfo(), 3000);
}
