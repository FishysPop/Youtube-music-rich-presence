function extractHighestQualityArtwork(artworkList) {
  if (!Array.isArray(artworkList) || artworkList.length === 0) return null;
  let best = null;
  let maxArea = -1;
  for (const item of artworkList) {
    if (!item || !item.src) continue;
    let area = 0;
    if (item.sizes && typeof item.sizes === 'string') {
      const parts = item.sizes.split('x').map(Number);
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        area = parts[0] * parts[1];
      }
    }
    if (area > maxArea) {
      maxArea = area;
      best = item.src;
    }
  }
  if (!best && artworkList.length > 0) {
    best = artworkList[artworkList.length - 1]?.src;
  }
  if (!best) return null;
  if (best.startsWith('//')) return 'https:' + best;
  return best;
}

function extractMediaSessionInfo(mediaSession) {
  if (!mediaSession || !mediaSession.metadata) return null;
  const { title, artist, album, artwork } = mediaSession.metadata;
  if (!title || typeof title !== 'string' || !title.trim()) return null;
  if (!artist || typeof artist !== 'string' || !artist.trim()) return null;

  const track = title.trim();
  const cleanArtist = artist.trim();
  const cleanAlbum = (album && typeof album === 'string' && album.trim()) ? album.trim() : null;
  const albumArtUrl = extractHighestQualityArtwork(artwork);

  let isPlaying = null;
  if (mediaSession.playbackState === 'playing') {
    isPlaying = true;
  } else if (mediaSession.playbackState === 'paused') {
    isPlaying = false;
  }

  return {
    track,
    artist: cleanArtist,
    album: cleanAlbum,
    albumArtUrl,
    isPlaying
  };
}

function parseBylineInfo(bylineElement) {
  if (!bylineElement) return { artist: '', album: null };

  const anchorTags = typeof bylineElement.querySelectorAll === 'function'
    ? Array.from(bylineElement.querySelectorAll('a'))
    : [];

  let artist = '';
  let album = null;

  if (anchorTags.length > 0) {
    artist = (anchorTags[0].textContent || '').trim();
    if (anchorTags.length > 1) {
      album = (anchorTags[1].textContent || '').trim() || null;
    }
  }

  if (!artist) {
    const rawText = (bylineElement.textContent || bylineElement.innerText || bylineElement.title || '').trim();
    if (rawText) {
      const parts = rawText.split('•').map(p => p.trim()).filter(Boolean);
      if (parts.length > 0) {
        artist = parts[0];
        if (parts.length > 1) {
          album = parts[1];
        }
      }
    }
  }

  if (artist.endsWith(',')) {
    artist = artist.slice(0, -1).trim();
  }

  return { artist, album: album || null };
}

function extractRepeatMode(playerBarElement) {
  if (!playerBarElement || typeof playerBarElement.getAttribute !== 'function') return 'NONE';
  const mode = playerBarElement.getAttribute('repeat-mode');
  if (mode === 'ONE' || mode === 'ALL') return mode;
  return 'NONE';
}

function formatLargeImageText(track, artist, album) {
  if (album && typeof album === 'string' && album.trim()) {
    return `${track} • ${album.trim()}`;
  }
  return `${track} - ${artist}`;
}

function buildActivityButtons(track, artist, videoId, roomId, isHost) {
  const directOrSearchUrl = (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId))
    ? `https://music.youtube.com/watch?v=${videoId}`
    : `https://music.youtube.com/search?q=${encodeURIComponent(`${artist} ${track}`)}`;

  if (roomId && isHost) {
    return [
      { label: "Listen Along", url: `https://music.youtube.com/#ytm-session=${roomId}` },
      { label: "Link", url: directOrSearchUrl }
    ];
  }

  return [
    { label: "Link", url: directOrSearchUrl },
    { label: "GitHub", url: "https://github.com/FishysPop/Youtube-music-rich-presence" }
  ];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    extractHighestQualityArtwork,
    extractMediaSessionInfo,
    parseBylineInfo,
    extractRepeatMode,
    formatLargeImageText,
    buildActivityButtons
  };
}

(() => {
if (typeof window === 'undefined') return;

if (typeof window.__ytmInitLogForwarder === 'function') {
  window.__ytmInitLogForwarder();
}

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

function getCurrentVideoId() {
  try {
    const bridgeVid = document.documentElement.getAttribute('data-ytm-video-id');
    if (bridgeVid && /^[a-zA-Z0-9_-]{11}$/.test(bridgeVid)) return bridgeVid;

    const urlParams = new URLSearchParams(window.location.search);
    const v = urlParams.get('v');
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

    const pathMatch = window.location.pathname.match(/\/watch\/([a-zA-Z0-9_-]{11})/);
    if (pathMatch && pathMatch[1]) return pathMatch[1];

    const playerBar = document.querySelector('ytmusic-player-bar');
    if (playerBar) {
      const img = playerBar.querySelector('.thumbnail-image-wrapper img') || playerBar.querySelector('img.image');
      if (img && img.src) {
        const match = img.src.match(/\/vi\/([a-zA-Z0-9_-]{11})\//) || img.src.match(/\/vi_webp\/([a-zA-Z0-9_-]{11})\//);
        if (match && match[1]) return match[1];
      }

      const root = playerBar.shadowRoot || playerBar;
      const links = root.querySelectorAll('a[href*="v="], a[href*="/watch?v="]');
      for (const link of links) {
        if (link.href) {
          const match = link.href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
          if (match && match[1]) return match[1];
        }
      }
    }

    if (typeof navigator !== 'undefined' && navigator.mediaSession && navigator.mediaSession.metadata) {
      const artwork = navigator.mediaSession.metadata.artwork;
      if (Array.isArray(artwork)) {
        for (const art of artwork) {
          if (art && art.src) {
            const match = art.src.match(/\/vi\/([a-zA-Z0-9_-]{11})\//) || art.src.match(/\/vi_webp\/([a-zA-Z0-9_-]{11})\//);
            if (match && match[1]) return match[1];
          }
        }
      }
    }

    const player = document.querySelector('ytmusic-player') || document.querySelector('#player') || document.querySelector('#movie_player');
    if (player) {
      const vidAttr = player.getAttribute('video-id') || player.getAttribute('data-video-id');
      if (vidAttr && /^[a-zA-Z0-9_-]{11}$/.test(vidAttr)) return vidAttr;
    }

    const titleLink = document.querySelector('ytmusic-player-bar .middle-controls a') || 
                      document.querySelector('ytmusic-player-bar .title a') ||
                      document.querySelector('a.ytp-title-link');
    if (titleLink && titleLink.href) {
      const match = titleLink.href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      if (match && match[1]) return match[1];
    }
  } catch (e) {}
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

    const videoElement = findVideoElement();
    const videoId = getCurrentVideoId();
    const repeatMode = extractRepeatMode(playerBar);

    let mediaSessionInfo = null;
    try {
      if (typeof navigator !== 'undefined' && navigator.mediaSession) {
        mediaSessionInfo = extractMediaSessionInfo(navigator.mediaSession);
      }
    } catch (e) {}

    let track = '';
    let artist = '';
    let album = null;
    let albumArtUrl = null;
    let isPlayingFromMediaSession = null;

    if (mediaSessionInfo && mediaSessionInfo.track && mediaSessionInfo.artist) {
      track = mediaSessionInfo.track;
      artist = mediaSessionInfo.artist;
      album = mediaSessionInfo.album;
      albumArtUrl = mediaSessionInfo.albumArtUrl;
      isPlayingFromMediaSession = mediaSessionInfo.isPlaying;
    } else {
      const trackElement = root.querySelector('.title.style-scope.ytmusic-player-bar') || root.querySelector('yt-formatted-string.title') || root.querySelector('.middle-controls .title');
      const artistElement = root.querySelector('.byline.style-scope.ytmusic-player-bar') || root.querySelector('yt-formatted-string.byline') || root.querySelector('.middle-controls .byline');
      const albumArtElement = root.querySelector('img.image.style-scope.ytmusic-player-bar') || root.querySelector('.thumbnail-image-wrapper img') || root.querySelector('#thumbnail img');

      track = trackElement ? (trackElement.textContent || trackElement.innerText || trackElement.getAttribute('title') || '').trim() : '';
      const bylineInfo = parseBylineInfo(artistElement);
      artist = bylineInfo.artist;
      album = bylineInfo.album;

      if (albumArtElement && albumArtElement.src) {
        if (albumArtElement.src.startsWith('//')) {
          albumArtUrl = 'https:' + albumArtElement.src;
        } else if (albumArtElement.src.startsWith('http')) {
          albumArtUrl = albumArtElement.src;
        }
      }
    }

    if (!track || !artist) {
      return null;
    }

    const timeInfoElement = root.querySelector('.time-info.style-scope.ytmusic-player-bar') || root.querySelector('.time-info');
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
    if (isPlayingFromMediaSession !== null) {
      isPlaying = isPlayingFromMediaSession;
    } else if (videoElement) {
      isPlaying = !videoElement.paused && !videoElement.ended && videoElement.readyState > 1;
    }

    const playPauseButton = root.querySelector('#play-pause-button');
    if (playPauseButton) {
      const titleAttr = (playPauseButton.getAttribute('title') || playPauseButton.title || '').toLowerCase();
      const ariaLabel = (playPauseButton.getAttribute('aria-label') || '').toLowerCase();
      if (titleAttr.includes('pause') || ariaLabel.includes('pause')) {
        isPlaying = true;
      } else if (titleAttr.includes('play') || ariaLabel.includes('play')) {
        if (!videoElement && isPlayingFromMediaSession === null) isPlaying = false;
      }
    }

    const isAd = isAdPlaying() || isAdTrack({ track, artist });

    let playlistId = null;
    let playlistIndex = null;
    let nextVideoId = null;

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const list = urlParams.get('list');
      if (list && typeof list === 'string') {
        playlistId = list;
      }
      const idx = urlParams.get('index');
      if (idx !== null && !isNaN(Number(idx))) {
        playlistIndex = parseInt(idx, 10);
      }
    } catch (e) {}

    const app = document.querySelector('ytmusic-app');
    if (playlistIndex === null && app && typeof app.getState === 'function') {
      try {
        const q = app.getState().queue;
        if (q && typeof q.selectedItemIndex === 'number' && q.selectedItemIndex >= 0) {
          playlistIndex = q.selectedItemIndex;
        }
      } catch (e) {}
    }

    const domItems = Array.from(document.querySelectorAll('ytmusic-player-queue-item'));
    const currentIdx = domItems.findIndex(el => el.selected);
    if (playlistIndex === null && currentIdx !== -1) {
      playlistIndex = currentIdx;
    }

    let upcomingTracks = [];
    if (Array.isArray(latestPageBridgeUpcomingTracks) && latestPageBridgeUpcomingTracks.length > 0) {
      upcomingTracks = latestPageBridgeUpcomingTracks;
      if (!nextVideoId && upcomingTracks.length > 0) {
        nextVideoId = upcomingTracks[0].videoId;
      }
    } else if (currentIdx !== -1 && domItems.length > currentIdx + 1) {
      nextVideoId = (domItems[currentIdx + 1].data && domItems[currentIdx + 1].data.videoId) || null;
      upcomingTracks = domItems.slice(currentIdx + 1, currentIdx + 16).map(el => {
        const d = el.data || {};
        return {
          videoId: d.videoId,
          title: d.title ? (d.title.runs ? d.title.runs[0].text : d.title.simpleText) : '',
          artist: d.shortBylineText ? (d.shortBylineText.runs ? d.shortBylineText.runs[0].text : d.shortBylineText.simpleText) : ''
        };
      }).filter(it => it.videoId && /^[a-zA-Z0-9_-]{11}$/.test(it.videoId));
    }

    return { track, artist, album, albumArtUrl, currentTime, duration, isPlaying, userIsSeeking, videoId, repeatMode, isAd, playlistId, playlistIndex, nextVideoId, upcomingTracks };
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
let lastSentAlbum = null;
let lastSentAlbumArtUrl = null;
let lastSentDuration = null;
let lastSentIsPlaying = null;
let lastSentCurrentTime = null;
let lastSentTimestamp = null;
let lastSentRepeatMode = null;
let lastSentVideoId = null;
let remoteNavigationPendingVideoId = null;
let updateDebounceTimer = null;
let pauseGracePeriodTimer = null;
let pauseGracePeriodExpired = false;
let consecutiveNoTrackCount = 0;

let navigationFinishListener = null;
let playerBarObserver = null;
let periodicInterval = null;
let currentObservedVideo = null;
let userIsSeeking = false;

// --- WebRTC Listen Together Engine Integration ---
let syncEngine = null;
let isRemoteSyncing = false;
let lastSyncedVideoId = null;
let lastAppliedDriftMs = 0;
let currentSessionStatus = 'idle';
let localDiscordUserName = 'Anonymous';

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function updateLocalDiscordUser() {
  chrome.storage.local.get(['discordUser'], (res) => {
    if (chrome.runtime.lastError || !res || !res.discordUser) return;
    const user = res.discordUser;
    const name = user.global_name || user.username;
    if (name) {
      localDiscordUserName = name;
      if (syncEngine) {
        syncEngine.setUserName(name);
      }
    }
  });
}

let wasInAd = false;
let lastAdTargetPacket = null;

function isAdPlaying() {
  const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
  if (player && typeof player.getAdState === 'function') {
    const adState = player.getAdState();
    if (adState >= 0) return true;
    if (adState === -1) return false;
  }

  if (document.documentElement.getAttribute('data-ytm-ad-active') === 'true') {
    return true;
  }

  const pb = document.querySelector('ytmusic-player-bar');
  if (pb) {
    const root = pb.shadowRoot || pb;
    const starkBadge = root.querySelector('.badge-style-type-ad-stark');
    if (starkBadge && !starkBadge.hidden && starkBadge.offsetParent !== null) return true;
    const adBadge = root.querySelector('.badge[class*="ad"]');
    if (adBadge && !adBadge.hidden && adBadge.offsetParent !== null) return true;
  }

  if (document.querySelector('.ytp-ad-player-overlay, .video-ads.ytp-ad-module .ytp-ad-text')) return true;

  return false;
}

function isAdTrack(trackInfo) {
  if (!trackInfo) return false;
  if (trackInfo.isAd) return true;
  const t = (trackInfo.track || '').trim().toLowerCase();
  const a = (trackInfo.artist || '').trim().toLowerCase();
  if (t === 'sponsored' || t.startsWith('sponsored •') || t.startsWith('sponsored -') || t.startsWith('sponsored ·') || t === 'advertisement') {
    return true;
  }
  if (a.startsWith('sponsored •') || a.startsWith('sponsored -') || a === 'sponsored' || a === 'advertisement') {
    return true;
  }
  return false;
}

function autoSkipAd() {
  const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button.ytp-ad-skip-button-text, .ytp-ad-skip-button-container button, .ytp-ad-overlay-close-button');
  if (skipBtn && skipBtn.offsetParent !== null) {
    try {
      skipBtn.click();
      console.log('[Listen Together] Auto-clicked ad skip button');
    } catch (e) {}
  }
}

function initSyncEngine() {
  if (typeof window.WebRtcSyncEngine !== 'undefined' && !syncEngine) {
    updateLocalDiscordUser();
    syncEngine = new window.WebRtcSyncEngine({
      userName: localDiscordUserName,
      getCurrentState: () => {
        const video = findVideoElement();
        const currentVideoId = getCurrentVideoId();
        const trackInfo = getCurrentTrackInfo();
        const adPlaying = isAdPlaying() || isAdTrack(trackInfo);
        if (!trackInfo) return null;
        return {
          ...trackInfo,
          videoId: currentVideoId || trackInfo.videoId,
          currentTime: video ? video.currentTime : trackInfo.currentTime,
          isPlaying: video ? (!video.paused && !video.ended && video.readyState > 1) : trackInfo.isPlaying,
          playbackRate: video ? video.playbackRate : 1.0,
          isAd: adPlaying,
          timestamp: Date.now()
        };
      },
      onSyncAction: handleRemoteSyncAction,
      onTrackChange: handleRemoteTrackChange,
      onPeerCountChange: handlePeerCountChange,
      onPeersChange: handlePeersChange,
      onConnectionStatus: handleConnectionStatusChange
    });
  }
}

let lastTrackChangeTime = 0;
let lastKnownPeersMap = new Map();
let autoStopHostingTimeoutMinutes = 30;
let hostEmptyStartTime = null;

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  chrome.storage.local.get({ autoStopHostingTimeoutMinutes: 30 }, (res) => {
    if (res && res.autoStopHostingTimeoutMinutes !== undefined) {
      autoStopHostingTimeoutMinutes = Number(res.autoStopHostingTimeoutMinutes) || 30;
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.autoStopHostingTimeoutMinutes) {
      autoStopHostingTimeoutMinutes = Number(changes.autoStopHostingTimeoutMinutes.newValue) || 0;
    }
  });
}

function checkAutoStopIdleHosting() {
  if (!syncEngine || !syncEngine.isHost || syncEngine.role !== 'HOST') {
    hostEmptyStartTime = null;
    return;
  }

  const peerCount = syncEngine.getConnectedPeerCount();
  if (peerCount === 0) {
    if (!hostEmptyStartTime) {
      hostEmptyStartTime = Date.now();
    } else if (autoStopHostingTimeoutMinutes > 0) {
      const elapsed = Date.now() - hostEmptyStartTime;
      if (elapsed >= autoStopHostingTimeoutMinutes * 60 * 1000) {
        console.log(`[Listen Together] Auto-stopping hosting session: no listeners connected for ${autoStopHostingTimeoutMinutes}m.`);
        syncEngine.leaveRoom();
        hostEmptyStartTime = null;
        updatePlayerBarButton();
        renderPopoverContent();
        showSyncToast(`Hosting stopped (no listeners for ${autoStopHostingTimeoutMinutes}m)`);
      }
    }
  } else {
    hostEmptyStartTime = null;
  }
}

function formatTime(sec) {
  if (isNaN(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

let latestPageBridgeUpcomingTracks = [];
let lastBroadcastQueueHash = '';

function checkAndBroadcastQueueUpdate() {
  if (!syncEngine || !syncEngine.isHost || isRemoteSyncing) return;
  const hash = latestPageBridgeUpcomingTracks.map(t => t.videoId).join(',');
  if (hash && hash !== lastBroadcastQueueHash) {
    lastBroadcastQueueHash = hash;
    if (typeof syncEngine.notifyQueueSync === 'function') {
      syncEngine.notifyQueueSync({
        currentVideoId: getCurrentVideoId() || lastSentVideoId,
        upcomingTracks: latestPageBridgeUpcomingTracks
      });
    }
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return;
  if (event.data.source === 'ytm-page-bridge-log') {
    console.log(`[YTM Page Bridge] ${event.data.message}`);
  } else if (event.data.source === 'ytm-page-bridge-queue' && Array.isArray(event.data.upcomingTracks)) {
    latestPageBridgeUpcomingTracks = event.data.upcomingTracks.slice(0, 15);
    checkAndBroadcastQueueUpdate();
  }
});

function navigateToVideo(videoId, trackTitle, artist, albumArtUrl, currentTime, isPlaying, playlistId, playlistIndex, nextVideoId, upcomingTracks) {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    console.warn(`[Listen Together] Cannot navigate: invalid or missing videoId (${videoId})`);
    return;
  }

  console.log(`[Listen Together] navigateToVideo: videoId=${videoId}, title="${trackTitle}" by "${artist}", isPlaying=${isPlaying}, currentTime=${currentTime}`);

  lastSyncedVideoId = videoId;
  remoteNavigationPendingVideoId = videoId;
  lastTrackChangeTime = Date.now();
  isRemoteSyncing = true;
  setTimeout(() => {
    isRemoteSyncing = false;
    remoteNavigationPendingVideoId = null;
  }, 4500);

  console.log(`[Listen Together] Posting LOAD_VIDEO to page-bridge for videoId: ${videoId}`);
  showSyncToast(`${trackTitle || 'Track'}${artist ? ' - ' + artist : ''}`);

  window.postMessage({
    source: 'ytm-sync-isolated',
    action: 'LOAD_VIDEO',
    videoId: videoId,
    playlistId: playlistId || undefined,
    playlistIndex: typeof playlistIndex === 'number' ? playlistIndex : undefined,
    nextVideoId: nextVideoId || undefined,
    upcomingTracks: (Array.isArray(upcomingTracks) && upcomingTracks.length > 0) ? upcomingTracks : (latestPageBridgeUpcomingTracks.length > 0 ? latestPageBridgeUpcomingTracks : undefined),
    track: trackTitle,
    artist: artist,
    albumArtUrl: albumArtUrl,
    currentTime: typeof currentTime === 'number' ? currentTime : 0,
    isPlaying: typeof isPlaying === 'boolean' ? isPlaying : true
  }, '*');
}

function handleRemoteSyncAction(packet) {
  if (!syncEngine || syncEngine.isHost || isRemoteSyncing) return;

  const currentIsAd = isAdPlaying() || isAdTrack(packet);
  if (currentIsAd) {
    autoSkipAd();
    wasInAd = true;
    if (!packet.isAd && !isAdTrack(packet)) {
      lastAdTargetPacket = packet;
    }
    return;
  }

  if (wasInAd) {
    wasInAd = false;
    showSyncToast('Ad finished - catching up with session...');
    if (lastAdTargetPacket) {
      if (lastAdTargetPacket.videoId && (lastAdTargetPacket.videoId !== getCurrentVideoId() || lastAdTargetPacket.videoId !== lastSyncedVideoId)) {
        console.log(`[Listen Together Listener] Catching up after ad: navigating to ${lastAdTargetPacket.videoId}`);
        navigateToVideo(lastAdTargetPacket.videoId, lastAdTargetPacket.track, lastAdTargetPacket.artist, lastAdTargetPacket.albumArtUrl, lastAdTargetPacket.currentTime, lastAdTargetPacket.isPlaying, lastAdTargetPacket.playlistId, lastAdTargetPacket.playlistIndex, lastAdTargetPacket.nextVideoId);
        return;
      }
    }
  }

  if (packet.isAd || isAdTrack(packet)) {
    return;
  }

  if (Array.isArray(packet.upcomingTracks) && packet.upcomingTracks.length > 0) {
    window.postMessage({
      source: 'ytm-sync-isolated',
      action: 'SYNC_UPCOMING_TRACKS',
      upcomingTracks: packet.upcomingTracks
    }, '*');
  }

  if (packet.type === 'QUEUE_SYNC') {
    return;
  }

  const currentVid = getCurrentVideoId();
  if (packet.videoId && (packet.videoId !== lastSyncedVideoId || (currentVid && packet.videoId !== currentVid))) {
    console.log(`[Listen Together Listener] handleRemoteSyncAction detected track mismatch (packet.videoId=${packet.videoId}, currentVid=${currentVid}, lastSynced=${lastSyncedVideoId}). Triggering track change.`);
    handleRemoteTrackChange(packet);
    return;
  }

  if (Date.now() - lastTrackChangeTime < 3500) {
    return;
  }

  const video = findVideoElement();
  if (!video) return;

  const driftSec = window.ytmCalculateDrift ? window.ytmCalculateDrift(video.currentTime, packet) : 0;
  const driftMs = Math.round(driftSec * 1000);
  lastAppliedDriftMs = driftMs;

  const isRecentTrackChange = (Date.now() - lastTrackChangeTime < 30000);
  const preferSpeedAdjustment = isRecentTrackChange || (packet.type !== 'SEEK' && driftMs > 0 && driftMs <= 5000);

  const action = window.ytmDetermineSyncAction
    ? window.ytmDetermineSyncAction(driftMs, !video.paused, packet.isPlaying, video.currentTime, currentIsAd, preferSpeedAdjustment)
    : { action: 'NONE' };

  updatePlayerBarButton();

  if (action.playPauseState === 'PLAY' && video.paused) {
    console.log(`[Listen Together] Listener playing (host is playing, drift: ${driftMs}ms)`);
    showSyncToast('Host resumed playback');
    isRemoteSyncing = true;
    video.play().catch(() => {}).finally(() => {
      setTimeout(() => { isRemoteSyncing = false; }, 200);
    });
  } else if (action.playPauseState === 'PAUSE' && !video.paused) {
    console.log(`[Listen Together] Listener pausing (host is paused, drift: ${driftMs}ms)`);
    showSyncToast('Host paused playback');
    isRemoteSyncing = true;
    video.pause();
    setTimeout(() => { isRemoteSyncing = false; }, 200);
  }

  if (action.action === 'SOFT_SPEED_UP') {
    video.playbackRate = action.playbackRate || 1.05;
  } else if (action.action === 'SOFT_SLOW_DOWN') {
    video.playbackRate = action.playbackRate || 0.95;
  } else if (action.action === 'NONE') {
    if (video.playbackRate !== 1.0) {
      video.playbackRate = 1.0;
    }
  } else if (action.action === 'HARD_SEEK' && typeof action.targetTime === 'number') {
    console.log(`[Listen Together] Listener hard seeking to ${action.targetTime.toFixed(1)}s (drift: ${driftMs}ms)`);
    if (packet.type === 'SEEK' && (Date.now() - lastTrackChangeTime > 4000) && action.targetTime > 3) {
      showSyncToast(`Host seeked to ${formatTime(action.targetTime)}`);
    }
    isRemoteSyncing = true;
    video.currentTime = action.targetTime;
    setTimeout(() => { isRemoteSyncing = false; }, 350);
  }
}

function handleRemoteTrackChange(packet) {
  if (!syncEngine || syncEngine.isHost) return;
  if (packet.isAd || isAdTrack(packet)) return;

  if (isAdPlaying()) {
    wasInAd = true;
    lastAdTargetPacket = packet;
    autoSkipAd();
    return;
  }

  if (Array.isArray(packet.upcomingTracks) && packet.upcomingTracks.length > 0) {
    window.postMessage({
      source: 'ytm-sync-isolated',
      action: 'SYNC_UPCOMING_TRACKS',
      upcomingTracks: packet.upcomingTracks
    }, '*');
  }

  const currentVid = getCurrentVideoId();
  console.log(`[Listen Together Listener] handleRemoteTrackChange: packet.videoId=${packet.videoId}, currentVid=${currentVid}, lastSyncedVideoId=${lastSyncedVideoId}`);

  if (packet.videoId && (packet.videoId !== lastSyncedVideoId || (currentVid && packet.videoId !== currentVid))) {
    console.log(`[Listen Together Listener] Triggering navigation for: "${packet.track}" (ID: ${packet.videoId})`);
    navigateToVideo(packet.videoId, packet.track, packet.artist, packet.albumArtUrl, packet.currentTime, packet.isPlaying, packet.playlistId, packet.playlistIndex, packet.nextVideoId, packet.upcomingTracks);
  }
}

function handlePeerCountChange(count) {
  if (syncEngine && syncEngine.isHost) {
    if (count === 0) {
      if (!hostEmptyStartTime) hostEmptyStartTime = Date.now();
    } else {
      hostEmptyStartTime = null;
    }
  } else {
    hostEmptyStartTime = null;
  }

  updatePlayerBarButton();
  sendMessageToBackgroundScript({
    type: 'LISTEN_SESSION_UPDATE',
    role: syncEngine ? syncEngine.role : 'NONE',
    roomId: syncEngine ? syncEngine.roomId : null,
    peerCount: count,
    hostName: syncEngine ? syncEngine.hostName : null,
    peers: syncEngine ? syncEngine.getConnectedPeerList() : []
  });
}

function handlePeersChange(data) {
  const currentPeers = (data && data.peers) || (syncEngine ? syncEngine.getConnectedPeerList() : []);
  const currentPeerMap = new Map();
  for (const p of currentPeers) {
    currentPeerMap.set(p.id, p.name);
  }

  if (lastKnownPeersMap.size > 0) {
    for (const [id, name] of currentPeerMap) {
      if (!lastKnownPeersMap.has(id)) {
        showSyncToast(`${name} joined`);
      }
    }
    for (const [id, name] of lastKnownPeersMap) {
      if (!currentPeerMap.has(id)) {
        showSyncToast(`${name} left`);
      }
    }
  }

  lastKnownPeersMap = currentPeerMap;

  updatePlayerBarButton();
  sendMessageToBackgroundScript({
    type: 'LISTEN_SESSION_UPDATE',
    role: syncEngine ? syncEngine.role : 'NONE',
    roomId: syncEngine ? syncEngine.roomId : null,
    peerCount: data ? data.count : (syncEngine ? syncEngine.getConnectedPeerCount() : 0),
    hostName: data ? data.hostName : (syncEngine ? syncEngine.hostName : null),
    peers: currentPeers
  });
}

function handleConnectionStatusChange(status, roomId) {
  currentSessionStatus = status;
  if (status === 'conflict_resolved' && roomId) {
    showSyncToast(`Room updated: ${roomId}`);
    renderPopoverContent();
  }
  updatePlayerBarButton();
  sendMessageToBackgroundScript({
    type: 'LISTEN_SESSION_STATUS',
    status,
    roomId,
    role: syncEngine ? syncEngine.role : 'NONE',
    peerCount: syncEngine ? syncEngine.getConnectedPeerCount() : 0
  });
}

function showSyncToast(message) {
  let toast = document.getElementById('ytm-sync-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'ytm-sync-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 90px;
      right: 20px;
      background: #282828;
      color: #ffffff;
      padding: 10px 16px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      font-family: 'Roboto', 'YouTube Sans', sans-serif;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      z-index: 999999;
      opacity: 0;
      transition: opacity 0.3s ease, transform 0.3s ease;
      transform: translateY(10px);
    `;
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
  }, 3500);
}

let isPopoverOpen = false;

function ensurePlayerBarButton() {
  const playerBar = document.querySelector('ytmusic-player-bar');
  if (!playerBar) return null;

  let root = playerBar.shadowRoot || playerBar;
  let btn = root.querySelector('#ytm-listen-together-bar-btn') || document.querySelector('#ytm-listen-together-bar-btn');

  const repeatBtn = root.querySelector('.repeat') || 
                    root.querySelector('#repeat-button') || 
                    root.querySelector('[title*="Repeat"]') ||
                    root.querySelector('tp-yt-paper-icon-button.repeat');

  const container = (repeatBtn && repeatBtn.parentNode) ||
                    root.querySelector('.right-controls-buttons') || 
                    root.querySelector('.right-controls') || 
                    root.querySelector('#right-controls') ||
                    root.querySelector('.middle-controls');
  if (!container) return null;

  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'ytm-listen-together-bar-btn';
    btn.title = 'Listen Together';
    btn.setAttribute('aria-label', 'Listen Together');

btn.style.cssText = `
      background: transparent;
      border: none;
      outline: none;
      cursor: pointer;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      align-self: center;
      box-sizing: border-box;
      padding: 0;
      margin: 0;
      color: var(--ytmusic-icon-inactive, #909090);
      transition: color 0.15s ease, background-color 0.15s ease;
      line-height: 0;
      flex-shrink: 0;
      position: relative !important;
      top: -2px !important;
    `;

    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" style="pointer-events: none; display: block; margin: auto; width: 24px; height: 24px;">
        <path d="M12 3a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h3v-8H5v-2a7 7 0 1 1 14 0v2h-4v8h3a3 3 0 0 0 3-3v-7a9 9 0 0 0-9-9z"/>
      </svg>
    `;

    btn.onmouseenter = () => {
      btn.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
      btn.style.color = '#ffffff';
    };

    btn.onmouseleave = () => {
      btn.style.backgroundColor = 'transparent';
      btn.style.color = (syncEngine && syncEngine.role !== 'NONE') ? '#ffffff' : 'var(--ytmusic-icon-inactive, #909090)';
    };

    btn.onclick = (e) => {
      e.stopPropagation();
      togglePlayerBarPopover();
    };
  }

  if (repeatBtn && btn.nextSibling !== repeatBtn) {
    repeatBtn.parentNode.insertBefore(btn, repeatBtn);
  } else if (!btn.parentNode) {
    container.appendChild(btn);
  }

  return btn;
}

function updatePlayerBarButton() {
  const oldFloating = document.getElementById('ytm-sync-floating-badge');
  if (oldFloating) oldFloating.remove();

  const btn = ensurePlayerBarButton();
  if (!btn) return;

  if (syncEngine && syncEngine.role !== 'NONE') {
    btn.style.color = '#ffffff';
  } else {
    btn.style.color = 'var(--ytmusic-icon-inactive, #909090)';
  }

  if (isPopoverOpen) {
    renderPopoverContent();
  }
}

function togglePlayerBarPopover() {
  isPopoverOpen = !isPopoverOpen;
  let popover = document.getElementById('ytm-listen-together-popover');

  if (!isPopoverOpen) {
    if (popover) popover.style.display = 'none';
    return;
  }

  if (!popover) {
    popover = document.createElement('div');
    popover.id = 'ytm-listen-together-popover';
    popover.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 30px;
      background: #212121;
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 4px;
      box-shadow: 0 16px 24px 2px rgba(0,0,0,0.14), 0 6px 30px 5px rgba(0,0,0,0.12), 0 8px 10px -5px rgba(0,0,0,0.4);
      z-index: 1000000;
      padding: 0;
      min-width: 270px;
      box-sizing: border-box;
      font-family: 'Roboto', 'Noto Sans', sans-serif;
      font-size: 14px;
      user-select: none;
      overflow: hidden;
    `;

    document.addEventListener('click', (e) => {
      const btn = ensurePlayerBarButton();
      if (popover && !popover.contains(e.target) && e.target !== btn && (!btn || !btn.contains(e.target))) {
        isPopoverOpen = false;
        popover.style.display = 'none';
      }
    });

    document.body.appendChild(popover);
  }

  const btn = ensurePlayerBarButton();
  if (btn) {
    const rect = btn.getBoundingClientRect();
    let rightPos = Math.max(16, window.innerWidth - rect.right - 10);
    popover.style.bottom = `${Math.max(75, window.innerHeight - rect.top + 8)}px`;
    popover.style.right = `${rightPos}px`;
  }

  popover.style.display = 'block';
  renderPopoverContent();
}

function renderPopoverContent() {
  const popover = document.getElementById('ytm-listen-together-popover');
  if (!popover) return;

  if (syncEngine && syncEngine.role !== 'NONE') {
    const isHost = syncEngine.isHost;
    const roomId = syncEngine.roomId || '';
    const count = syncEngine.getConnectedPeerCount();
    const peerList = syncEngine.getConnectedPeerList();
    const roleText = isHost ? (count > 0 ? 'Hosting' : 'Waiting') : 'Synced';
    
    let membersHtml = '';
    if (isHost) {
      if (peerList.length > 0) {
        const names = peerList.map(p => escapeHtml(p.name)).join(', ');
        membersHtml = `<div style="padding:4px 16px 8px 16px; font-size:13px; color:rgba(255, 255, 255, 0.7); line-height:1.4;"><strong style="color:#ffffff;">Listening:</strong> ${names}</div>`;
      } else {
        membersHtml = `<div style="padding:4px 16px 8px 16px; font-size:13px; color:rgba(255, 255, 255, 0.5);">Waiting for friends to join...</div>`;
      }
    } else {
      const hostName = syncEngine.hostName || 'Host';
      membersHtml = `<div style="padding:4px 16px 4px 16px; font-size:13px; color:rgba(255, 255, 255, 0.7); line-height:1.4;"><strong style="color:#ffffff;">Host:</strong> ${escapeHtml(hostName)}</div>`;
      if (peerList.length > 1) {
        const otherNames = peerList.filter(p => p.id !== syncEngine.peerId).map(p => escapeHtml(p.name)).join(', ');
        if (otherNames) {
          membersHtml += `<div style="padding:0 16px 6px 16px; font-size:12px; color:rgba(255, 255, 255, 0.5);">Also listening: ${otherNames}</div>`;
        }
      }
    }

    const driftInfo = !isHost ? `<div style="padding:0 16px 8px 16px; font-size:12px; color:rgba(255, 255, 255, 0.5);">Synced (${Math.abs(lastAppliedDriftMs)}ms drift)</div>` : '';

    popover.innerHTML = `
      <div style="padding:12px 16px 8px 16px; border-bottom:1px solid rgba(255, 255, 255, 0.08); display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:10px;">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="color:rgba(255,255,255,0.7); display:block;">
            <path d="M12 3a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h3v-8H5v-2a7 7 0 1 1 14 0v2h-4v8h3a3 3 0 0 0 3-3v-7a9 9 0 0 0-9-9z"/>
          </svg>
          <span style="font-weight:500; color:#ffffff; font-size:14px;">Listen Together</span>
        </div>
        <span style="background:rgba(255, 255, 255, 0.1); color:rgba(255, 255, 255, 0.7); font-size:11px; font-weight:500; padding:2px 6px; border-radius:2px; text-transform:uppercase; letter-spacing:0.5px;">
          ${roleText}
        </span>
      </div>

      <div style="padding:10px 16px 8px 16px; display:flex; gap:8px; align-items:center;">
        <input type="text" readonly value="${roomId}" id="ytm-popover-room-input" title="Room Code" style="background:#181818; border:1px solid rgba(255, 255, 255, 0.15); border-radius:4px; height:32px; padding:0 10px; color:#ffffff; font-size:13px; letter-spacing:0.5px; font-family:monospace; font-weight:600; outline:none; flex:1; box-sizing:border-box; min-width:0; cursor:text; user-select:all; -webkit-user-select:all;">
        <button id="ytm-popover-copy-btn" style="background:transparent; color:#3ea6ff; border:none; border-radius:2px; height:32px; padding:0 8px; font-size:12px; font-weight:500; cursor:pointer; text-transform:uppercase; letter-spacing:0.3px; transition:background 0.15s; flex-shrink:0;">
          Copy Link
        </button>
      </div>

      ${membersHtml}
      ${driftInfo}

      <div id="ytm-popover-leave-row" style="height:44px; padding:0 16px; display:flex; align-items:center; gap:16px; cursor:pointer; color:#ff4e45; font-size:14px; font-weight:400; border-top:1px solid rgba(255, 255, 255, 0.08); transition:background 0.1s;">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="display:block;">
          <path d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/>
        </svg>
        <span>Leave session</span>
      </div>
    `;

    const roomInput = document.getElementById('ytm-popover-room-input');
    if (roomInput) {
      roomInput.onclick = () => { roomInput.select(); };
      roomInput.onfocus = () => { roomInput.select(); };
    }

    const copyBtn = document.getElementById('ytm-popover-copy-btn');
    if (copyBtn) {
      copyBtn.onmouseenter = () => { copyBtn.style.background = 'rgba(62, 166, 255, 0.1)'; };
      copyBtn.onmouseleave = () => { copyBtn.style.background = 'transparent'; };
      copyBtn.onclick = () => {
        const url = `https://music.youtube.com/#ytm-session=${roomId}`;
        navigator.clipboard.writeText(url).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy Link'; }, 2000);
        });
      };
    }

    const leaveRow = document.getElementById('ytm-popover-leave-row');
    if (leaveRow) {
      leaveRow.onmouseenter = () => { leaveRow.style.background = 'rgba(255, 78, 69, 0.08)'; };
      leaveRow.onmouseleave = () => { leaveRow.style.background = 'transparent'; };
      leaveRow.onclick = () => {
        hostEmptyStartTime = null;
        chrome.storage.local.remove('listenTogetherSession');
        if (syncEngine) syncEngine.leaveRoom();
        updatePlayerBarButton();
        renderPopoverContent();
        showSyncToast('Left Listen Together session');
      };
    }
  } else {
    popover.innerHTML = `
      <div style="padding:12px 16px 8px 16px; border-bottom:1px solid rgba(255, 255, 255, 0.08); display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:10px;">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="color:rgba(255,255,255,0.7); display:block;">
            <path d="M12 3a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h3v-8H5v-2a7 7 0 1 1 14 0v2h-4v8h3a3 3 0 0 0 3-3v-7a9 9 0 0 0-9-9z"/>
          </svg>
          <span style="font-weight:500; color:#ffffff; font-size:14px;">Listen Together</span>
        </div>
        <span style="background:rgba(255, 255, 255, 0.08); color:rgba(255, 255, 255, 0.5); font-size:11px; font-weight:500; padding:2px 6px; border-radius:2px; text-transform:uppercase; letter-spacing:0.5px;">
          Idle
        </span>
      </div>

      <div id="ytm-popover-start-row" style="height:44px; padding:0 16px; display:flex; align-items:center; gap:16px; cursor:pointer; color:#ffffff; font-size:14px; font-weight:400; transition:background 0.1s;">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="color:rgba(255,255,255,0.7); display:block;">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
        </svg>
        <span>Start hosting session</span>
      </div>

      <div style="padding:10px 16px 12px 16px; border-top:1px solid rgba(255, 255, 255, 0.08);">
        <div style="font-size:12px; color:rgba(255, 255, 255, 0.6); margin-bottom:8px;">Join with room code</div>
        <div style="display:flex; gap:8px; align-items:center;">
          <input type="text" id="ytm-popover-join-input" placeholder="YTM-XXXXXX" style="background:#181818; border:1px solid rgba(255, 255, 255, 0.15); border-radius:4px; height:34px; padding:0 10px; color:#ffffff; font-size:13px; letter-spacing:0.5px; text-transform:uppercase; outline:none; flex:1; box-sizing:border-box; min-width:0;">
          <button id="ytm-popover-join-btn" style="background:transparent; color:#3ea6ff; border-radius:2px; height:34px; padding:0 10px; font-weight:500; font-size:13px; text-transform:uppercase; letter-spacing:0.5px; border:none; cursor:pointer; transition:background 0.15s; flex-shrink:0;">
            Join
          </button>
        </div>
      </div>
    `;

    const startRow = document.getElementById('ytm-popover-start-row');
    if (startRow) {
      startRow.onmouseenter = () => { startRow.style.background = 'rgba(255, 255, 255, 0.1)'; };
      startRow.onmouseleave = () => { startRow.style.background = 'transparent'; };
      startRow.onclick = () => {
        initSyncEngine();
        if (syncEngine) {
          chrome.storage.local.remove('listenTogetherSession');
          const roomId = syncEngine.createRoom();
          hostEmptyStartTime = Date.now();
          const trackInfo = getCurrentTrackInfo();
          if (trackInfo) syncEngine.updateHostState(trackInfo);
          updatePlayerBarButton();
          renderPopoverContent();
          showSyncToast(`Session created: ${roomId}`);
        }
      };
    }

    const joinBtn = document.getElementById('ytm-popover-join-btn');
    const joinInput = document.getElementById('ytm-popover-join-input');
    if (joinBtn && joinInput) {
      joinBtn.onmouseenter = () => { joinBtn.style.background = 'rgba(62, 166, 255, 0.1)'; };
      joinBtn.onmouseleave = () => { joinBtn.style.background = 'transparent'; };
      joinBtn.onclick = () => {
        const code = joinInput.value.trim().toUpperCase();
        if (!code) return;
        initSyncEngine();
        if (syncEngine) {
          hostEmptyStartTime = null;
          const roomId = syncEngine.joinRoom(code);
          chrome.storage.local.set({ listenTogetherSession: { role: 'LISTENER', roomId: roomId } });
          updatePlayerBarButton();
          renderPopoverContent();
          showSyncToast(`Joining session: ${roomId}`);
        }
      };
    }
  }
}

function checkUrlHashSession() {
  const hash = window.location.hash || '';
  const match = hash.match(/ytm-session=([A-Za-z0-9_-]+)/i);
  if (match && match[1]) {
    initSyncEngine();
    if (syncEngine) {
      const roomId = match[1].toUpperCase();
      chrome.storage.local.set({ listenTogetherSession: { role: 'LISTENER', roomId: roomId } });
      syncEngine.joinRoom(roomId);
      updatePlayerBarButton();
      showSyncToast(`Joining session: ${roomId}`);
      try {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch (e) {}
    }
  }
}

let lastHostTrackChangeTime = 0;
let userIsDraggingProgressBar = false;

function setupProgressBarListeners() {
  const progressBar = document.querySelector('ytmusic-player-bar #progress-bar') ||
                      document.querySelector('ytmusic-player-bar tp-yt-paper-slider') ||
                      document.querySelector('#progress-bar');
  if (progressBar && !progressBar.__ytmSeekAttached) {
    progressBar.__ytmSeekAttached = true;
    const onStart = () => {
      userIsSeeking = true;
      userIsDraggingProgressBar = true;
    };
    const onEnd = () => {
      if (userIsDraggingProgressBar) {
        userIsDraggingProgressBar = false;
        userIsSeeking = false;
        setTimeout(() => {
          updateTrackInfo(true);
          if (syncEngine && syncEngine.isHost && !isRemoteSyncing && (Date.now() - lastHostTrackChangeTime > 5000)) {
            const video = findVideoElement();
            if (video && video.currentTime > 2) {
              syncEngine.notifySeek(video.currentTime);
            }
          }
        }, 150);
      }
    };

    progressBar.addEventListener('pointerdown', onStart, { passive: true });
    progressBar.addEventListener('mousedown', onStart, { passive: true });
    window.addEventListener('pointerup', onEnd, { passive: true });
    window.addEventListener('mouseup', onEnd, { passive: true });
  }
}

function removeVideoListeners(video) {
  if (!video) return;
  video.removeEventListener('playing', onVideoEvent);
  video.removeEventListener('play', onVideoEvent);
  video.removeEventListener('pause', onVideoEvent);
  video.removeEventListener('loadedmetadata', onVideoEvent);
  video.removeEventListener('durationchange', onVideoEvent);
  video.removeEventListener('canplay', onVideoEvent);
  video.removeEventListener('seeked', onVideoSeeked);
  video.removeEventListener('timeupdate', onVideoTimeUpdate);
}

function attachVideoListeners() {
  setupProgressBarListeners();
  const video = findVideoElement();
  if (video && video !== currentObservedVideo) {
    if (currentObservedVideo) {
      removeVideoListeners(currentObservedVideo);
    }
    currentObservedVideo = video;
    video.addEventListener('playing', onVideoEvent);
    video.addEventListener('play', onVideoEvent);
    video.addEventListener('pause', onVideoEvent);
    video.addEventListener('loadedmetadata', onVideoEvent);
    video.addEventListener('durationchange', onVideoEvent);
    video.addEventListener('canplay', onVideoEvent);
    video.addEventListener('seeked', onVideoSeeked);
    video.addEventListener('timeupdate', onVideoTimeUpdate);
  }
}

function onVideoSeeked() {
  updateTrackInfo(true);
  if (syncEngine && syncEngine.isHost && !isRemoteSyncing) {
    const video = findVideoElement();
    if (video && video.currentTime > 0) {
      syncEngine.notifySeek(video.currentTime);
    }
  }
}

function onVideoEvent(e) {
  updateTrackInfo(true);

  if (syncEngine && syncEngine.isHost && !isRemoteSyncing) {
    const video = findVideoElement();
    if (video) {
      if (e && e.type === 'play') {
        syncEngine.notifyPlay(video.currentTime);
      } else if (e && e.type === 'pause') {
        syncEngine.notifyPause(video.currentTime);
      }
    }
  }
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

  if (syncEngine) {
    syncEngine.leaveRoom();
    syncEngine = null;
  }
  lastSyncedVideoId = null;
  hostEmptyStartTime = null;

  const popover = document.getElementById('ytm-sync-popover');
  if (popover && popover.parentNode) {
    popover.parentNode.removeChild(popover);
  }

  const toast = document.getElementById('ytm-sync-toast');
  if (toast && toast.parentNode) {
    toast.parentNode.removeChild(toast);
  }

  const btn = document.getElementById('ytm-listen-together-btn');
  if (btn && btn.parentNode) {
    btn.parentNode.removeChild(btn);
  }

  const progressBar = document.querySelector('ytmusic-player-bar #progress-bar') ||
                      document.querySelector('ytmusic-player-bar tp-yt-paper-slider') ||
                      document.querySelector('#progress-bar');
  if (progressBar) {
    progressBar.__ytmSeekAttached = false;
  }
  
  if (window.__ytmLogForwarder && typeof window.__ytmLogForwarder.flush === 'function') {
    window.__ytmLogForwarder.flush();
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
      const isNewTrack = (currentTrackInfo.videoId && currentTrackInfo.videoId !== lastSentVideoId) ||
                         currentTrackInfo.track !== lastSentTrack ||
                         currentTrackInfo.artist !== lastSentArtist;
      const isAd = currentTrackInfo.isAd || isAdPlaying() || isAdTrack(currentTrackInfo);

      if (isAd) {
        if (syncEngine && syncEngine.isHost && !isRemoteSyncing) {
          syncEngine.updateHostState({ ...currentTrackInfo, isAd: true });
        }
        return;
      }

      if (wasInAd && !isAd && syncEngine && !syncEngine.isHost && syncEngine.role === 'LISTENER') {
        wasInAd = false;
        if (lastAdTargetPacket && lastAdTargetPacket.videoId) {
          const currentVid = getCurrentVideoId();
          if (lastAdTargetPacket.videoId !== currentVid || lastAdTargetPacket.videoId !== lastSyncedVideoId) {
            console.log(`[Listen Together Listener] Catching up after ad in updateTrackInfo: navigating to ${lastAdTargetPacket.videoId}`);
            showSyncToast('Ad finished - catching up with session...');
            navigateToVideo(
              lastAdTargetPacket.videoId,
              lastAdTargetPacket.track,
              lastAdTargetPacket.artist,
              lastAdTargetPacket.albumArtUrl,
              lastAdTargetPacket.currentTime,
              lastAdTargetPacket.isPlaying,
              lastAdTargetPacket.playlistId,
              lastAdTargetPacket.playlistIndex,
              lastAdTargetPacket.nextVideoId,
              lastAdTargetPacket.upcomingTracks
            );
            return;
          }
        }
      }

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

        const isSpuriousZero = currentTrackInfo.currentTime === 0 && expectedCurrentTime > 3 && !userIsSeeking;
        if (!isSpuriousZero && timeDiff > 3.5) {
          isTimeShifted = true;
        }
      }

      const shouldSend = forceSend ||
          isNewTrack ||
          currentTrackInfo.artist !== lastSentArtist ||
          currentTrackInfo.album !== lastSentAlbum ||
          currentTrackInfo.albumArtUrl !== lastSentAlbumArtUrl ||
          currentTrackInfo.duration !== lastSentDuration ||
          isPlayingToSend !== lastSentIsPlaying ||
          currentTrackInfo.repeatMode !== lastSentRepeatMode ||
          isTimeShifted;

      if (shouldSend) {
        const dataToSend = { ...currentTrackInfo, isPlaying: isPlayingToSend };
        sendMessageToBackgroundScript(dataToSend);
        
        lastSentTrack = currentTrackInfo.track;
        lastSentArtist = currentTrackInfo.artist;
        lastSentAlbum = currentTrackInfo.album;
        lastSentAlbumArtUrl = currentTrackInfo.albumArtUrl;
        lastSentDuration = currentTrackInfo.duration;
        lastSentIsPlaying = isPlayingToSend;
        lastSentCurrentTime = currentTrackInfo.currentTime;
        lastSentRepeatMode = currentTrackInfo.repeatMode;
        lastSentVideoId = currentTrackInfo.videoId || null;
        lastSentTimestamp = now;

        if (syncEngine && syncEngine.isHost && !isRemoteSyncing) {
          if (isNewTrack) {
            console.log(`[Listen Together Host] Track change detected! Title: "${dataToSend.track}" by "${dataToSend.artist}" (videoId: ${dataToSend.videoId}). Broadcasting TRACK_CHANGE.`);
            lastHostTrackChangeTime = Date.now();
            syncEngine.notifyTrackChange(dataToSend);
          } else {
            syncEngine.updateHostState(dataToSend);
          }
        } else if (syncEngine && !syncEngine.isHost && syncEngine.role === 'LISTENER' && !isRemoteSyncing && !remoteNavigationPendingVideoId && isNewTrack) {
          const currentVid = getCurrentVideoId();
          if (lastSyncedVideoId && currentVid && currentVid !== lastSyncedVideoId && (Date.now() - lastTrackChangeTime > 6000)) {
            console.log(`[Listen Together] User manually selected a different track ("${currentTrackInfo.track}"). Leaving Listen Together session.`);
            chrome.storage.local.remove('listenTogetherSession');
            syncEngine.leaveRoom();
            lastSyncedVideoId = null;
            updatePlayerBarButton();
            showSyncToast('Left Listen Together session (changed track)');
          }
        }
      }
    } else {
      consecutiveNoTrackCount++;
      if (consecutiveNoTrackCount >= 3) {
        if (lastSentTrack !== null || lastSentAlbumArtUrl !== null) {
          sendMessageToBackgroundScript({ type: 'NO_TRACK' });
          lastSentTrack = null;
          lastSentArtist = null;
          lastSentAlbum = null;
          lastSentAlbumArtUrl = null;
          lastSentDuration = null;
          lastSentIsPlaying = null;
          lastSentCurrentTime = null;
          lastSentRepeatMode = null;
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

function restoreActiveSession() {
  chrome.storage.local.get(['listenTogetherSession'], (res) => {
    if (chrome.runtime.lastError) return;
    const session = res.listenTogetherSession;
    if (session && session.roomId && session.role && session.role !== 'NONE') {
      if (session.role === 'HOST') {
        chrome.storage.local.remove('listenTogetherSession');
        return;
      }
      initSyncEngine();
      if (syncEngine && syncEngine.role === 'NONE') {
        if (session.role === 'LISTENER') {
          console.log(`[Listen Together] Restoring listener session from storage: ${session.roomId}`);
          syncEngine.joinRoom(session.roomId);
        }
      }
    }
  });
}

// Listen for messages from popup / background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;

  initSyncEngine();

  if (message.type === 'START_LISTEN_SESSION') {
    if (syncEngine) {
      chrome.storage.local.remove('listenTogetherSession');
      const roomId = syncEngine.createRoom(message.roomId);
      hostEmptyStartTime = Date.now();
      showSyncToast(`Session created: ${roomId}`);
      const trackInfo = getCurrentTrackInfo();
      if (trackInfo) syncEngine.updateHostState(trackInfo);
      if (sendResponse) sendResponse({ success: true, roomId, isHost: true });
    } else {
      if (sendResponse) sendResponse({ success: false, error: 'Sync engine unavailable' });
    }
    return false;
  } else if (message.type === 'JOIN_LISTEN_SESSION') {
    if (syncEngine && message.roomId) {
      hostEmptyStartTime = null;
      const roomId = syncEngine.joinRoom(message.roomId);
      chrome.storage.local.set({ listenTogetherSession: { role: 'LISTENER', roomId: roomId } });
      showSyncToast(`Joining session: ${roomId}`);
      if (sendResponse) sendResponse({ success: true, roomId, isHost: false });
    } else {
      if (sendResponse) sendResponse({ success: false, error: 'Sync engine or room ID missing' });
    }
    return false;
  } else if (message.type === 'LEAVE_LISTEN_SESSION') {
    hostEmptyStartTime = null;
    chrome.storage.local.remove('listenTogetherSession');
    lastSyncedVideoId = null;
    if (syncEngine) {
      syncEngine.leaveRoom();
      showSyncToast('Left Listen Together session');
    }
    if (sendResponse) sendResponse({ success: true });
    return false;
  } else if (message.type === 'GET_LISTEN_SESSION_STATUS') {
    if (sendResponse) {
      sendResponse({
        role: syncEngine ? syncEngine.role : 'NONE',
        roomId: syncEngine ? syncEngine.roomId : null,
        isHost: syncEngine ? syncEngine.isHost : false,
        peerCount: syncEngine ? syncEngine.getConnectedPeerCount() : 0,
        hostName: syncEngine ? syncEngine.hostName : null,
        peers: syncEngine ? syncEngine.getConnectedPeerList() : [],
        userName: syncEngine ? syncEngine.userName : localDiscordUserName,
        lastDriftMs: lastAppliedDriftMs,
        status: currentSessionStatus
      });
    }
    return false;
  }

  return false;
});

initSyncEngine();
checkUrlHashSession();
restoreActiveSession();
updateTrackInfo(true);

navigationFinishListener = () => {
  lastSentTrack = null;
  lastSentArtist = null;
  lastSentAlbum = null;
  lastSentAlbumArtUrl = null;
  lastSentDuration = null;
  lastSentIsPlaying = null;
  lastSentCurrentTime = null;
  lastSentRepeatMode = null;
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
updatePlayerBarButton();

periodicInterval = setInterval(() => {
  const adActive = isAdPlaying();
  if (adActive) {
    autoSkipAd();
  } else if (wasInAd && syncEngine && syncEngine.role === 'LISTENER' && lastAdTargetPacket) {
    wasInAd = false;
    showSyncToast('Ad finished - catching up with session...');
    if (lastAdTargetPacket.videoId && lastAdTargetPacket.videoId !== getCurrentVideoId()) {
      navigateToVideo(lastAdTargetPacket.videoId, lastAdTargetPacket.track, lastAdTargetPacket.artist, lastAdTargetPacket.albumArtUrl, lastAdTargetPacket.currentTime, lastAdTargetPacket.isPlaying);
    }
  }
  attachVideoListeners();
  updateTrackInfo();
  updatePlayerBarButton();
  checkAutoStopIdleHosting();
}, 1000);

window.__ytmRpcCleanup = cleanup;
})();
