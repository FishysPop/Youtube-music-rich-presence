
function getCurrentTrackInfo() {
  try {
    const trackElement = document.querySelector('.title.style-scope.ytmusic-player-bar');
    const artistElement = document.querySelector('.byline.style-scope.ytmusic-player-bar');
    const albumArtElement = document.querySelector('ytmusic-player-bar img.image');

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

      return { track, artist, albumArtUrl }; 
    }
  } catch (error) {
    console.error('ContentScript: Error in getCurrentTrackInfo:', error);
  }
  return null;
}

function sendMessageToBackgroundScript(data) {
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
let lastSentAlbumArtUrl = null; 
let updateDebounceTimer = null;

function updateTrackInfo(forceSend = false) {
  clearTimeout(updateDebounceTimer);

  updateDebounceTimer = setTimeout(() => {
    const currentTrackInfo = getCurrentTrackInfo();

    if (currentTrackInfo) {
      if (forceSend ||
          currentTrackInfo.track !== lastSentTrack ||
          currentTrackInfo.artist !== lastSentArtist ||
          currentTrackInfo.albumArtUrl !== lastSentAlbumArtUrl) { 
        sendMessageToBackgroundScript(currentTrackInfo);
        lastSentTrack = currentTrackInfo.track;
        lastSentArtist = currentTrackInfo.artist;
        lastSentAlbumArtUrl = currentTrackInfo.albumArtUrl; 
      } else {
      }
    } else {
      if (lastSentTrack !== null || lastSentAlbumArtUrl !== null) { 
        sendMessageToBackgroundScript({ type: 'NO_TRACK' });
        lastSentTrack = null;
        lastSentArtist = null;
        lastSentAlbumArtUrl = null; 
      } else {
      }
    }
  }, 150); 
}


console.log("[YTMusicRPC Content] Script loaded. Initializing...");

updateTrackInfo(true);

window.addEventListener('yt-navigate-finish', () => {
    lastSentTrack = null; 
    lastSentArtist = null;
    lastSentAlbumArtUrl = null; 
    updateTrackInfo(true);
});

const playerBar = document.querySelector('ytmusic-player-bar');
if (playerBar) {
    const observer = new MutationObserver((mutationsList, observer) => {
        updateTrackInfo();
    });

    observer.observe(playerBar, {
        childList: true,   
        subtree: true,      
        attributes: true,   
        attributeFilter: ['src', 'title', 'href'],
        characterData: true 
    });
} else {
    console.warn("[YTMusicRPC Content] ytmusic-player-bar not found for MutationObserver. Falling back to setInterval.");
    setInterval(() => updateTrackInfo(), 3000); 
}
