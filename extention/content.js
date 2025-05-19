function getCurrentTrackInfo() {
  try {
    const trackElement = document.querySelector('.title.style-scope.ytmusic-player-bar');
    const artistElement = document.querySelector('.byline.style-scope.ytmusic-player-bar');

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
      return { track, artist };
    }
  } catch (error) {
    console.error('ContentScript: Error in getCurrentTrackInfo:', error);
  }
  return null;
}

function sendMessageToBackgroundScript(data) {
  console.log('ContentScript: Attempting to send message to background:', data);
  try {
    chrome.runtime.sendMessage(data, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('ContentScript: Error sending message to background or no listener:', chrome.runtime.lastError.message, 'Data:', data);
      } else {
      }
    });
  } catch (error) {
    console.error('ContentScript: Synchronous error sending message to background script:', error, 'Data:', data);
  }
}

let lastSentTrack = null;
let lastSentArtist = null;
let updateDebounceTimer = null;

function updateTrackInfo(forceSend = false) {
  clearTimeout(updateDebounceTimer); 

  updateDebounceTimer = setTimeout(() => {
    const currentTrackInfo = getCurrentTrackInfo();
    console.log('[YTMusicRPC Content] updateTrackInfo called. Force send:', forceSend);
    console.log('[YTMusicRPC Content] Current track info found:', currentTrackInfo);
    console.log('[YTMusicRPC Content] Last sent track:', lastSentTrack, 'Artist:', lastSentArtist);

    if (currentTrackInfo) {
      if (forceSend || currentTrackInfo.track !== lastSentTrack || currentTrackInfo.artist !== lastSentArtist) {
        console.log('[YTMusicRPC Content] Conditions met. Sending new track info to background:', currentTrackInfo);
        sendMessageToBackgroundScript(currentTrackInfo);
        lastSentTrack = currentTrackInfo.track;
        lastSentArtist = currentTrackInfo.artist;
      } else {
        console.log('[YTMusicRPC Content] Track info unchanged, not sending.');
      }
    } else { 
      if (lastSentTrack !== null) { 
        console.log('[YTMusicRPC Content] No track found, sending NO_TRACK to background.');
        sendMessageToBackgroundScript({ type: 'NO_TRACK' });
        lastSentTrack = null;
        lastSentArtist = null;
      } else {
      }
    }
  }, 150); 
}


console.log("[YTMusicRPC Content] Script loaded. Initializing...");

updateTrackInfo(true);

window.addEventListener('yt-navigate-finish', () => {
    console.log("[YTMusicRPC Content] yt-navigate-finish event triggered. Resetting last sent info and forcing update.");
    lastSentTrack = null;
    lastSentArtist = null;
    updateTrackInfo(true); // Force send after navigation
});

const playerBar = document.querySelector('ytmusic-player-bar');
if (playerBar) {
    console.log("[YTMusicRPC Content] Player bar found. Setting up MutationObserver.");
    const observer = new MutationObserver((mutationsList, observer) => {
        updateTrackInfo();
    });

    observer.observe(playerBar, {
        childList: true,   
        subtree: true,     
        characterData: true 
    });
} else {
    console.warn("[YTMusicRPC Content] ytmusic-player-bar not found for MutationObserver. Falling back to setInterval.");
    setInterval(() => updateTrackInfo(), 3000); 
}
