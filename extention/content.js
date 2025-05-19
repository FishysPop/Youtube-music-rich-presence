
function getCurrentTrackInfo() {
  try {
    const trackElement = document.querySelector('.title.style-scope.ytmusic-player-bar');
    const artistElement = document.querySelector('.byline.style-scope.ytmusic-player-bar');
    // Selector for the album art image in the player bar
    const albumArtElement = document.querySelector('ytmusic-player-bar img.image'); // Common selector for YTM album art

    if (trackElement && trackElement.innerText && artistElement && artistElement.innerText) {
      const track = trackElement.innerText.trim();
      let artistText = artistElement.innerText.trim();

      // Clean up artist text (remove extra info like album, year, etc.)
      const separatorIndex = artistText.indexOf('•');
      if (separatorIndex !== -1) {
        artistText = artistText.substring(0, separatorIndex).trim();
      }
      if (artistText.endsWith(',')) { // Remove trailing comma if present
          artistText = artistText.substring(0, artistText.length -1).trim();
      }
      const artist = artistText;

      let albumArtUrl = null;
      if (albumArtElement && albumArtElement.src) {
        // Ensure the URL is absolute and uses https
        if (albumArtElement.src.startsWith('//')) {
          albumArtUrl = 'https:' + albumArtElement.src;
        } else if (albumArtElement.src.startsWith('http')) {
          albumArtUrl = albumArtElement.src;
        }
        // Optional: You might want to get a higher resolution image if available.
        // YTM often uses URLs like lh3.googleusercontent.com/...=w60-h60-l90-rj
        // You could try replacing '=w60-h60-l90-rj' with something like '=w544-h544-l90-rj' for higher res,
        // but this can be brittle if the URL structure changes. For now, we'll take what's directly in the src.
        // Example: if (albumArtUrl) albumArtUrl = albumArtUrl.replace(/=w\d+-h\d+[^/]*/, '=w544-h544-l90-rj');
      }

      return { track, artist, albumArtUrl }; // Added albumArtUrl
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
        // console.log('ContentScript: Message sent to background successfully.', response);
      }
    });
  } catch (error) {
    console.error('ContentScript: Synchronous error sending message to background script:', error, 'Data:', data);
  }
}

let lastSentTrack = null;
let lastSentArtist = null;
let lastSentAlbumArtUrl = null; // Keep track of the last sent album art URL
let updateDebounceTimer = null;

function updateTrackInfo(forceSend = false) {
  clearTimeout(updateDebounceTimer);

  updateDebounceTimer = setTimeout(() => {
    const currentTrackInfo = getCurrentTrackInfo();
    // console.log('[YTMusicRPC Content] updateTrackInfo called. Force send:', forceSend);
    // console.log('[YTMusicRPC Content] Current track info found:', currentTrackInfo);
    // console.log('[YTMusicRPC Content] Last sent track:', lastSentTrack, 'Artist:', lastSentArtist, 'Art URL:', lastSentAlbumArtUrl);

    if (currentTrackInfo) {
      if (forceSend ||
          currentTrackInfo.track !== lastSentTrack ||
          currentTrackInfo.artist !== lastSentArtist ||
          currentTrackInfo.albumArtUrl !== lastSentAlbumArtUrl) { // Check album art URL change
        // console.log('[YTMusicRPC Content] Conditions met. Sending new track info to background:', currentTrackInfo);
        sendMessageToBackgroundScript(currentTrackInfo);
        lastSentTrack = currentTrackInfo.track;
        lastSentArtist = currentTrackInfo.artist;
        lastSentAlbumArtUrl = currentTrackInfo.albumArtUrl; // Update last sent album art
      } else {
        // console.log('[YTMusicRPC Content] Track info unchanged, not sending.');
      }
    } else {
      if (lastSentTrack !== null || lastSentAlbumArtUrl !== null) { // If there was a track or art playing before
        // console.log('[YTMusicRPC Content] No track found, sending NO_TRACK to background.');
        sendMessageToBackgroundScript({ type: 'NO_TRACK' });
        lastSentTrack = null;
        lastSentArtist = null;
        lastSentAlbumArtUrl = null; // Reset album art URL
      } else {
        // console.log('[YTMusicRPC Content] No track found, and no track/art was previously sent. Doing nothing.');
      }
    }
  }, 150); // Debounce time
}


console.log("[YTMusicRPC Content] Script loaded. Initializing...");

// Initial check, force send true
updateTrackInfo(true);

// Listen for navigation events in YouTube Music (SPA behavior)
window.addEventListener('yt-navigate-finish', () => {
    // console.log('[YTMusicRPC Content] yt-navigate-finish event triggered. Clearing last sent track and forcing update.');
    lastSentTrack = null; // Reset last sent track to ensure update after navigation
    lastSentArtist = null;
    lastSentAlbumArtUrl = null; // Reset last sent album art URL
    updateTrackInfo(true); // Force send after navigation
});

// Observe changes in the player bar for track updates
const playerBar = document.querySelector('ytmusic-player-bar');
if (playerBar) {
    const observer = new MutationObserver((mutationsList, observer) => {
        // console.log('[YTMusicRPC Content] MutationObserver detected changes in player bar.');
        // We can be more specific here if needed, e.g., checking if the image src changed.
        // For now, any significant change in the player bar will trigger an update.
        updateTrackInfo();
    });

    observer.observe(playerBar, {
        childList: true,    // e.g. song title/artist elements changing, or the img tag itself
        subtree: true,      // observe all descendants of playerBar, including the img tag
        attributes: true,   // observe attribute changes, especially 'src' on the img tag
        attributeFilter: ['src', 'title', 'href'], // Be more specific if performance is an issue
        characterData: true // observe text changes within nodes (for title/artist)
    });
} else {
    console.warn("[YTMusicRPC Content] ytmusic-player-bar not found for MutationObserver. Falling back to setInterval.");
    // Fallback if player bar isn't immediately available (less efficient)
    setInterval(() => updateTrackInfo(), 3000); // Check every 3 seconds
}
