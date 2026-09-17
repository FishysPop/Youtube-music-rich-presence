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

function cleanTitleForComparison(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/[\(\[][^\)\]]*(?:feat\.?|ft\.?|with|prod\.?|official|video|audio|remaster|version|deluxe|single|ep)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*-\s*(?:single(?:\s+version)?|ep|deluxe(?:\s+edition)?|remastered|official(?:\s+audio|\s+video)?)\b.*$/gi, '')
    .replace(/[^a-z0-9]/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function isActualAlbum(track, album) {
  if (!album || typeof album !== 'string' || !album.trim()) return false;
  if (!track || typeof track !== 'string' || !track.trim()) return false;

  const cleanAlbum = album.trim();
  const cleanTrack = track.trim();

  if (cleanAlbum.toLowerCase() === cleanTrack.toLowerCase()) {
    return false;
  }

  const normAlbum = cleanTitleForComparison(cleanAlbum);
  const normTrack = cleanTitleForComparison(cleanTrack);

  if (!normAlbum || !normTrack) {
    return false;
  }

  if (normAlbum === normTrack) {
    return false;
  }

  return true;
}

function formatLargeImageText(track, artist, album) {
  if (isActualAlbum(track, album)) {
    return album.trim();
  }
  return null;
}

function buildActivityButtons(track, artist, videoId, roomId, isHost) {
  const directOrSearchUrl = (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId))
    ? `https://music.youtube.com/watch?v=${videoId}`
    : `https://music.youtube.com/search?q=${encodeURIComponent(`${artist} ${track}`)}`;

  if (roomId && isHost) {
    return [
      { label: "Listen Along", url: `https://fishyspop.github.io/Youtube-music-rich-presence/?ytm-session=${roomId}` },
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
    cleanTitleForComparison,
    isActualAlbum,
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

let lastKnownVideoId = null;

function getCurrentVideoId() {
  try {
    const bridgeVid = document.documentElement.getAttribute('data-ytm-video-id');
    if (bridgeVid && /^[a-zA-Z0-9_-]{11}$/.test(bridgeVid)) {
      lastKnownVideoId = bridgeVid;
      return bridgeVid;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const v = urlParams.get('v');
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) {
      lastKnownVideoId = v;
      return v;
    }

    const pathMatch = window.location.pathname.match(/\/watch\/([a-zA-Z0-9_-]{11})/);
    if (pathMatch && pathMatch[1]) {
      lastKnownVideoId = pathMatch[1];
      return pathMatch[1];
    }

    const playerBar = document.querySelector('ytmusic-player-bar');
    if (playerBar) {
      const img = playerBar.querySelector('.thumbnail-image-wrapper img') || playerBar.querySelector('img.image');
      if (img && img.src) {
        const match = img.src.match(/\/vi\/([a-zA-Z0-9_-]{11})\//) || img.src.match(/\/vi_webp\/([a-zA-Z0-9_-]{11})\//);
        if (match && match[1]) {
          lastKnownVideoId = match[1];
          return match[1];
        }
      }

      const root = playerBar.shadowRoot || playerBar;
      const links = root.querySelectorAll('a[href*="v="], a[href*="/watch?v="]');
      for (const link of links) {
        if (link.href) {
          const match = link.href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
          if (match && match[1]) {
            lastKnownVideoId = match[1];
            return match[1];
          }
        }
      }
    }

    if (typeof navigator !== 'undefined' && navigator.mediaSession && navigator.mediaSession.metadata) {
      const artwork = navigator.mediaSession.metadata.artwork;
      if (Array.isArray(artwork)) {
        for (const art of artwork) {
          if (art && art.src) {
            const match = art.src.match(/\/vi\/([a-zA-Z0-9_-]{11})\//) || art.src.match(/\/vi_webp\/([a-zA-Z0-9_-]{11})\//);
            if (match && match[1]) {
              lastKnownVideoId = match[1];
              return match[1];
            }
          }
        }
      }
    }

    const player = document.querySelector('ytmusic-player') || document.querySelector('#player') || document.querySelector('#movie_player');
    if (player) {
      const vidAttr = player.getAttribute('video-id') || player.getAttribute('data-video-id');
      if (vidAttr && /^[a-zA-Z0-9_-]{11}$/.test(vidAttr)) {
        lastKnownVideoId = vidAttr;
        return vidAttr;
      }
    }

    const titleLink = document.querySelector('ytmusic-player-bar .middle-controls a') || 
                      document.querySelector('ytmusic-player-bar .title a') ||
                      document.querySelector('a.ytp-title-link');
    if (titleLink && titleLink.href) {
      const match = titleLink.href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      if (match && match[1]) {
        lastKnownVideoId = match[1];
        return match[1];
      }
    }
  } catch (e) {}

  const video = findVideoElement();
  if (lastKnownVideoId && video && (video.readyState > 0 || video.src) && !video.ended) {
    return lastKnownVideoId;
  }
  return null;
}

function extractQueueTrackItem(it) {
  if (!it || typeof it !== 'object') return null;

  let r = it.playlistPanelVideoRenderer || null;
  if (!r && it.playlistPanelVideoWrapperRenderer) {
    const wrapper = it.playlistPanelVideoWrapperRenderer;
    r = wrapper.primaryRenderer?.playlistPanelVideoRenderer ||
        wrapper.primaryRenderer ||
        wrapper.playlistPanelVideoRenderer ||
        wrapper.counterpart?.[0]?.counterpartRenderer?.playlistPanelVideoRenderer ||
        wrapper.counterpart?.[0]?.counterpartRenderer ||
        null;
  }
  if (!r && it.musicResponsiveListItemRenderer) {
    r = it.musicResponsiveListItemRenderer;
  }
  if (!r && (it.videoId || (it.navigationEndpoint?.watchEndpoint?.videoId))) {
    r = it;
  }

  if (!r) return null;

  const videoId = r.videoId ||
                  r.playlistItemData?.videoId ||
                  r.navigationEndpoint?.watchEndpoint?.videoId ||
                  r.onTap?.watchEndpoint?.videoId ||
                  it.videoId ||
                  null;

  if (!videoId || typeof videoId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return null;
  }

  function getText(obj) {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    if (Array.isArray(obj.runs)) {
      return obj.runs.map(run => (run && typeof run.text === 'string') ? run.text : '').join('');
    }
    if (typeof obj.simpleText === 'string') return obj.simpleText;
    return '';
  }

  const title = getText(r.title) ||
                getText(r.headline) ||
                getText(r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text) ||
                '';

  const artist = getText(r.shortBylineText) ||
                 getText(r.longBylineText) ||
                 getText(r.bylineText) ||
                 getText(r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text) ||
                 '';

  const durationText = getText(r.lengthText) ||
                       getText(r.durationText) ||
                       getText(r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text) ||
                       '';

  let thumbnail = null;
  if (typeof r.thumbnail === 'string') {
    thumbnail = r.thumbnail;
  } else if (r.thumbnail?.thumbnails && Array.isArray(r.thumbnail.thumbnails) && r.thumbnail.thumbnails.length > 0) {
    thumbnail = r.thumbnail.thumbnails[0]?.url || null;
  }
  if (!thumbnail && typeof r.albumArtUrl === 'string') {
    thumbnail = r.albumArtUrl;
  }
  if (!thumbnail) {
    thumbnail = `https://i.ytimg.com/vi/${videoId}/default.jpg`;
  }

  return {
    videoId,
    title: title.trim(),
    artist: artist.trim(),
    durationText: durationText.trim(),
    thumbnail
  };
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

    if (!album) {
      const artistElement = root.querySelector('.byline.style-scope.ytmusic-player-bar') || root.querySelector('yt-formatted-string.byline') || root.querySelector('.middle-controls .byline');
      const bylineInfo = parseBylineInfo(artistElement);
      if (bylineInfo.album && isActualAlbum(track, bylineInfo.album)) {
        album = bylineInfo.album;
      }
    }

    if (album && !isActualAlbum(track, album)) {
      album = null;
    }

    if (!albumArtUrl) {
      const albumArtElement = root.querySelector('img.image.style-scope.ytmusic-player-bar') || root.querySelector('.thumbnail-image-wrapper img') || root.querySelector('#thumbnail img');
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

    const bridgeList = document.documentElement.getAttribute('data-ytm-playlist-id');
    if (bridgeList && /^[a-zA-Z0-9_-]+$/.test(bridgeList)) {
      playlistId = bridgeList;
    }
    const bridgeIdx = document.documentElement.getAttribute('data-ytm-playlist-index');
    if (bridgeIdx !== null && !isNaN(Number(bridgeIdx))) {
      playlistIndex = parseInt(bridgeIdx, 10);
    }

    if (!playlistId && typeof latestPageBridgePlaylistId === 'string' && latestPageBridgePlaylistId) {
      playlistId = latestPageBridgePlaylistId;
    }
    if (playlistIndex === null && typeof latestPageBridgePlaylistIndex === 'number' && latestPageBridgePlaylistIndex >= 0) {
      playlistIndex = latestPageBridgePlaylistIndex;
    }

    if (!playlistId) {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const list = urlParams.get('list');
        if (list && typeof list === 'string' && /^[a-zA-Z0-9_-]+$/.test(list)) {
          playlistId = list;
        }
        const idx = urlParams.get('index');
        if (idx !== null && !isNaN(Number(idx))) {
          playlistIndex = parseInt(idx, 10);
        }
      } catch (e) {}
    }

    if (!playlistId) {
      const domLink = document.querySelector('ytmusic-player-page a[href*="list="], ytmusic-player-bar a[href*="list="], ytmusic-player-queue a[href*="list="]');
      if (domLink && domLink.href) {
        const m = domLink.href.match(/[?&]list=([a-zA-Z0-9_-]+)/);
        if (m && m[1]) {
          playlistId = m[1];
        }
      }
    }

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
    const currentIdx = domItems.findIndex(el =>
      el.hasAttribute('selected') ||
      el.classList.contains('selected') ||
      el.selected ||
      (videoId && extractQueueTrackItem(el.data)?.videoId === videoId) ||
      Boolean(videoId && el.querySelector && el.querySelector(`a[href*="v=${videoId}"]`))
    );
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
      const upcoming = [];
      for (let i = currentIdx + 1; i < domItems.length && upcoming.length < 15; i++) {
        const el = domItems[i];
        let item = extractQueueTrackItem(el.data);
        if (!item) {
          const titleEl = el.querySelector && el.querySelector('.song-title, yt-formatted-string.song-title, .title');
          const artistEl = el.querySelector && el.querySelector('.byline, yt-formatted-string.byline, .subtitle');
          const durEl = el.querySelector && el.querySelector('.duration, yt-formatted-string.duration, span.duration');
          const imgEl = el.querySelector && el.querySelector('img.image, yt-img-shadow img, img');
          const link = el.querySelector && el.querySelector('a[href*="v="], a.yt-simple-endpoint[href*="watch"]');
          let vId = null;
          if (link && link.href) {
            const match = link.href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
            if (match) vId = match[1];
          }
          if (!vId && imgEl && imgEl.src) {
            const match = imgEl.src.match(/\/(?:vi|vi_webp)\/([a-zA-Z0-9_-]{11})\//);
            if (match) vId = match[1];
          }
          if (vId) {
            item = {
              videoId: vId,
              title: (titleEl ? titleEl.textContent : '').trim(),
              artist: (artistEl ? artistEl.textContent : '').trim(),
              durationText: (durEl ? durEl.textContent : '').trim(),
              thumbnail: imgEl ? imgEl.src : `https://i.ytimg.com/vi/${vId}/default.jpg`
            };
          }
        }
        if (item && item.videoId) {
          upcoming.push(item);
        }
      }
      upcomingTracks = upcoming;
      if (!nextVideoId && upcomingTracks.length > 0) {
        nextVideoId = upcomingTracks[0].videoId;
      }
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
const suppression = {
  play: 0,
  pause: 0,
  seek: 0,
  pendingTrackId: null
};
let lastSyncedVideoId = null;
let lastAppliedDriftMs = 0;
let currentSessionStatus = 'idle';
let lastConnectionError = null;
let lastAttemptedRoomId = '';
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
let hasSeenListenTogetherGuide = false;
let isGuideDismissedThisSession = false;

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  chrome.storage.local.get({ autoStopHostingTimeoutMinutes: 30, hasSeenListenTogetherGuide: false }, (res) => {
    if (res) {
      if (res.autoStopHostingTimeoutMinutes !== undefined) {
        autoStopHostingTimeoutMinutes = Number(res.autoStopHostingTimeoutMinutes) || 30;
      }
      if (res.hasSeenListenTogetherGuide) {
        hasSeenListenTogetherGuide = true;
      }
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.autoStopHostingTimeoutMinutes) {
        autoStopHostingTimeoutMinutes = Number(changes.autoStopHostingTimeoutMinutes.newValue) || 0;
      }
      if (changes.hasSeenListenTogetherGuide) {
        hasSeenListenTogetherGuide = Boolean(changes.hasSeenListenTogetherGuide.newValue);
      }
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
let latestPageBridgePlaylistId = null;
let latestPageBridgePlaylistIndex = null;
let latestSessionUpcomingTracks = [];
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
  } else if (event.data.source === 'ytm-page-bridge-queue') {
    if (Array.isArray(event.data.upcomingTracks)) {
      latestPageBridgeUpcomingTracks = event.data.upcomingTracks.slice(0, 15);
    }
    if (event.data.playlistId && typeof event.data.playlistId === 'string') {
      latestPageBridgePlaylistId = event.data.playlistId;
    }
    if (typeof event.data.playlistIndex === 'number' && event.data.playlistIndex >= 0) {
      latestPageBridgePlaylistIndex = event.data.playlistIndex;
    }
    checkAndBroadcastQueueUpdate();
  }
});

function renderSessionQueuePanel() {
  const panelId = 'ytm-session-queue-panel';
  const styleId = 'ytm-session-queue-style';
  const isListener = Boolean(syncEngine && syncEngine.role === 'LISTENER' && !syncEngine.isHost);
  const hasTracks = Array.isArray(latestSessionUpcomingTracks) && latestSessionUpcomingTracks.length > 0;

  let existingPanel = document.getElementById(panelId);
  let styleEl = document.getElementById(styleId);

  if (!isListener || !hasTracks) {
    if (existingPanel) existingPanel.remove();
    if (styleEl) styleEl.remove();
    return;
  }

  const queueContainer = document.querySelector('ytmusic-player-queue') ||
                         document.querySelector('#queue') ||
                         document.querySelector('ytmusic-player-page #queue');
  if (!queueContainer) return;

  const contents = queueContainer.querySelector('#contents') || queueContainer.firstElementChild;

  if (!existingPanel) {
    existingPanel = document.createElement('div');
    existingPanel.id = panelId;
    existingPanel.style.cssText = 'width: 100%; box-sizing: border-box; background: transparent; border: none; margin: 0; padding: 0; font-family: Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;';

    if (contents && contents.parentNode === queueContainer) {
      if (contents.nextSibling) {
        queueContainer.insertBefore(existingPanel, contents.nextSibling);
      } else {
        queueContainer.appendChild(existingPanel);
      }
    } else {
      queueContainer.appendChild(existingPanel);
    }
  }

  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = `
      ytmusic-player-queue #contents ytmusic-player-queue-item:not([selected]):not(.selected) {
        display: none !important;
      }
      .ytm-session-queue-row:hover {
        background-color: rgba(255, 255, 255, 0.08) !important;
      }
    `;
    document.head.appendChild(styleEl);
  }

  const hostName = (syncEngine && syncEngine.hostName) ? syncEngine.hostName : 'Host';
  const trackItemsHtml = latestSessionUpcomingTracks.map((t) => {
    const sanitizeImg = window.ytmSanitizeImageUrl || ((u, v) => (v ? `https://i.ytimg.com/vi/${v}/default.jpg` : ''));
    const thumbUrl = sanitizeImg(t.albumArtUrl || t.thumbnail, t.videoId);
    const thumbHtml = thumbUrl
      ? `<img src="${escapeHtml(thumbUrl)}" style="width:40px; height:40px; border-radius:4px; object-fit:cover; margin-right:16px; flex-shrink:0; background:#1f1f1f;" />`
      : `<div style="width:40px; height:40px; border-radius:4px; margin-right:16px; flex-shrink:0; background:#1f1f1f;"></div>`;

    const dur = t.durationText || (typeof t.duration === 'number' && t.duration > 0 ? formatTime(t.duration) : '');
    const durHtml = dur
      ? `<div style="font-size:12px; font-weight:400; color:rgba(255, 255, 255, 0.7); margin-left:auto; padding-left:12px; flex-shrink:0; white-space:nowrap;">${escapeHtml(dur)}</div>`
      : '';

    return `
      <div class="ytm-session-queue-row" style="display:flex; flex-direction:row; align-items:center; height:56px; padding:0 16px; cursor:default; transition:background-color 0.15s ease; user-select:none; box-sizing:border-box; border-radius:4px;">
        ${thumbHtml}
        <div style="display:flex; flex-direction:column; justify-content:center; min-width:0; flex:1;">
          <div style="font-size:14px; font-weight:400; color:#ffffff; line-height:1.3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(t.title || 'Track')}</div>
          <div style="font-size:12px; font-weight:400; color:rgba(255, 255, 255, 0.7); line-height:1.3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:3px;">${escapeHtml(t.artist || '')}</div>
        </div>
        ${durHtml}
      </div>
    `;
  }).join('');

  existingPanel.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; padding:16px 16px 8px 16px; box-sizing:border-box;">
      <span style="font-size:14px; font-weight:500; color:#ffffff; letter-spacing:0.1px;">Up next from ${escapeHtml(hostName)}</span>
      <span style="font-size:12px; color:rgba(255, 255, 255, 0.7);">${latestSessionUpcomingTracks.length} song${latestSessionUpcomingTracks.length === 1 ? '' : 's'}</span>
    </div>
    <div style="width:100%; box-sizing:border-box;">
      ${trackItemsHtml}
    </div>
  `;

  disableAutoplayForConnectedClient();
}

function disableAutoplayForConnectedClient() {
  const isListener = Boolean(syncEngine && syncEngine.role === 'LISTENER' && !syncEngine.isHost);
  if (!isListener) return;

  try {
    const queueContainers = [
      document.querySelector('ytmusic-player-queue'),
      document.querySelector('ytmusic-player-page #queue'),
      document.querySelector('#queue'),
      document
    ].filter(Boolean);

    for (const container of queueContainers) {
      const toggles = container.querySelectorAll(
        'tp-yt-paper-toggle-button, paper-toggle-button'
      );

      for (const toggle of toggles) {
        const parent = toggle.closest('ytmusic-player-queue-header-renderer') ||
                       toggle.closest('#automix') ||
                       toggle.closest('#automix-contents') ||
                       toggle.closest('[class*="automix"]') ||
                       toggle.closest('[class*="autoplay"]') ||
                       toggle.parentElement;

        const containerText = ((parent ? parent.textContent : '') + ' ' + (toggle.getAttribute('aria-label') || '')).toLowerCase();
        const isAutoplay = containerText.includes('auto-play') ||
                           containerText.includes('autoplay') ||
                           containerText.includes('automix') ||
                           containerText.includes('add similar content') ||
                           toggle.id === 'automix-toggle' ||
                           toggle.id === 'autoplay-toggle';

        if (isAutoplay) {
          const isChecked = Boolean(toggle.checked || toggle.hasAttribute('checked') || toggle.getAttribute('aria-pressed') === 'true');
          if (isChecked) {
            toggle.click();
            if (toggle.checked) {
              toggle.checked = false;
              toggle.dispatchEvent(new CustomEvent('change', { bubbles: true }));
            }
            console.log('[Listen Together] Automatically turned off autoplay for connected client');
          }
        }
      }
    }
  } catch (e) {}
}

function cmdNext() {
  suppression.seek++;
  suppression.play++;
  const nextBtn = document.querySelector('ytmusic-player-bar .next-button button') ||
                  document.querySelector('ytmusic-player-bar #next-button button') ||
                  document.querySelector('ytmusic-player-bar .next-button');
  if (nextBtn && typeof nextBtn.click === 'function') {
    nextBtn.click();
    return true;
  }
  return false;
}

function cmdPrevious() {
  suppression.seek++;
  suppression.play++;
  const prevBtn = document.querySelector('ytmusic-player-bar .previous-button button') ||
                  document.querySelector('ytmusic-player-bar #previous-button button') ||
                  document.querySelector('ytmusic-player-bar .previous-button');
  if (prevBtn && typeof prevBtn.click === 'function') {
    prevBtn.click();
    return true;
  }
  return false;
}

function cmdPlay(targetTime) {
  const video = findVideoElement();
  if (!video) return;
  if (typeof targetTime === 'number') {
    suppression.seek++;
    video.currentTime = targetTime;
  }
  if (video.paused) {
    suppression.play++;
    video.play().catch(() => {
      suppression.play = Math.max(0, suppression.play - 1);
      setTimeout(() => {
        const v = findVideoElement();
        if (v && v.paused) {
          suppression.play++;
          v.play().catch(() => {
            suppression.play = Math.max(0, suppression.play - 1);
          });
        }
      }, 500);
    });
  }
}

function cmdPause() {
  const video = findVideoElement();
  if (!video || video.paused) return;
  suppression.pause++;
  const playPauseBtn = document.querySelector('ytmusic-player-bar #play-pause-button button') ||
                       document.querySelector('#play-pause-button button');
  if (playPauseBtn && typeof playPauseBtn.click === 'function') {
    playPauseBtn.click();
  } else {
    video.pause();
  }
}

function cmdSeek(targetTime) {
  const video = findVideoElement();
  if (!video || typeof targetTime !== 'number') return;
  suppression.seek++;
  video.currentTime = targetTime;
}

function cmdChangeTrack(videoId, currentTime) {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return;

  const video = findVideoElement();
  if (video && video.paused) {
    video.play().catch(() => {});
  }

  suppression.pendingTrackId = videoId;
  suppression.play++;
  suppression.pause++;
  suppression.seek++;

  const onLoadedMetadata = (e) => {
    if (!e || e.target instanceof HTMLMediaElement || e.target?.tagName === 'VIDEO') {
      document.removeEventListener('loadedmetadata', onLoadedMetadata, true);
      if (suppression.pendingTrackId === videoId) {
        suppression.play = 0;
        suppression.pause = 0;
        suppression.seek = 0;
        suppression.pendingTrackId = null;
        isRemoteSyncing = false;
        remoteNavigationPendingVideoId = null;
      }
    }
  };
  document.addEventListener('loadedmetadata', onLoadedMetadata, { capture: true });

  setTimeout(() => {
    document.removeEventListener('loadedmetadata', onLoadedMetadata, true);
    if (suppression.pendingTrackId === videoId) {
      suppression.play = 0;
      suppression.pause = 0;
      suppression.seek = 0;
      suppression.pendingTrackId = null;
      isRemoteSyncing = false;
      remoteNavigationPendingVideoId = null;
    }
  }, 4000);

  const startSec = Math.floor(currentTime || 0);
  const watchEndpoint = { videoId };
  if (startSec > 0) watchEndpoint.startTimeSeconds = startSec;

  const endpointDetail = {
    endpoint: {
      clickTrackingParams: '',
      watchEndpoint
    }
  };

  const cloneFn = globalThis.cloneInto;
  const payload = cloneFn ? cloneFn(endpointDetail, window) : endpointDetail;

  document.dispatchEvent(new CustomEvent('yt-navigate', {
    detail: payload,
    bubbles: true,
    composed: true
  }));
}

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

  showSyncToast(`${trackTitle || 'Track'}${artist ? ' - ' + artist : ''}`);

  if (syncEngine && syncEngine.role === 'LISTENER' && syncEngine.roomId) {
    chrome.storage.local.set({ listenTogetherSession: { role: 'LISTENER', roomId: syncEngine.roomId } });
  }

  if (Array.isArray(upcomingTracks) && upcomingTracks.length > 0) {
    latestSessionUpcomingTracks = upcomingTracks;
    renderSessionQueuePanel();
  }

  cmdChangeTrack(videoId, currentTime);
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

  const video = findVideoElement();
  const clockOffset = (syncEngine && typeof syncEngine.clockOffset === 'number') ? syncEngine.clockOffset : 0;

  if (wasInAd) {
    wasInAd = false;
    showSyncToast('Ad finished - catching up with session...');
    if (lastAdTargetPacket) {
      const targetTime = window.ytmCalculateAdCatchUpTime
        ? window.ytmCalculateAdCatchUpTime(lastAdTargetPacket.currentTime, lastAdTargetPacket.timestamp, clockOffset)
        : lastAdTargetPacket.currentTime;

      if (lastAdTargetPacket.videoId && (lastAdTargetPacket.videoId !== getCurrentVideoId() || lastAdTargetPacket.videoId !== lastSyncedVideoId)) {
        console.log(`[Listen Together Listener] Catching up after ad: navigating to ${lastAdTargetPacket.videoId} at ${targetTime}s`);
        navigateToVideo(lastAdTargetPacket.videoId, lastAdTargetPacket.track, lastAdTargetPacket.artist, lastAdTargetPacket.albumArtUrl, targetTime, lastAdTargetPacket.isPlaying, lastAdTargetPacket.playlistId, lastAdTargetPacket.playlistIndex, lastAdTargetPacket.nextVideoId, lastAdTargetPacket.upcomingTracks);
        return;
      } else if (video && typeof targetTime === 'number') {
        suppression.seek++;
        video.currentTime = targetTime;
      }
    }
  }

  if (packet.isAd || isAdTrack(packet)) {
    return;
  }

  if (Array.isArray(packet.upcomingTracks) && packet.upcomingTracks.length > 0) {
    latestSessionUpcomingTracks = packet.upcomingTracks;
    renderSessionQueuePanel();
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
  const hasActivePlayer = Boolean(currentVid && video && (video.readyState > 0 || video.src));

  const needsNavigation = Boolean(
    packet.videoId && (
      (!hasActivePlayer && !lastSyncedVideoId) ||
      currentVid !== packet.videoId ||
      lastSyncedVideoId !== packet.videoId
    )
  );

  if (needsNavigation) {
    console.log(`[Listen Together Listener] handleRemoteSyncAction detected track change (packet.videoId=${packet.videoId}, currentVid=${currentVid}, lastSynced=${lastSyncedVideoId}, hasActivePlayer=${hasActivePlayer}). Triggering track change.`);
    handleRemoteTrackChange(packet);
    return;
  }

  if (Date.now() - lastTrackChangeTime < 3500) {
    return;
  }

  if (!video) return;

  const driftSec = window.ytmCalculateDrift ? window.ytmCalculateDrift(video.currentTime, packet, clockOffset) : 0;
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
    cmdPlay();
    setTimeout(() => { isRemoteSyncing = false; }, 200);
  } else if (action.playPauseState === 'PAUSE' && !video.paused) {
    console.log(`[Listen Together] Listener pausing (host is paused, drift: ${driftMs}ms)`);
    showSyncToast('Host paused playback');
    isRemoteSyncing = true;
    cmdPause();
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
    cmdSeek(action.targetTime);
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
    latestSessionUpcomingTracks = packet.upcomingTracks;
    renderSessionQueuePanel();
    window.postMessage({
      source: 'ytm-sync-isolated',
      action: 'SYNC_UPCOMING_TRACKS',
      upcomingTracks: packet.upcomingTracks
    }, '*');
  }

  const currentVid = getCurrentVideoId();
  const video = findVideoElement();
  const hasActivePlayer = Boolean(currentVid && video && (video.readyState > 0 || video.src));

  const needsNavigation = Boolean(
    packet.videoId && (
      (!hasActivePlayer && !lastSyncedVideoId) ||
      currentVid !== packet.videoId ||
      lastSyncedVideoId !== packet.videoId
    )
  );

  console.log(`[Listen Together Listener] handleRemoteTrackChange: packet.videoId=${packet.videoId}, currentVid=${currentVid}, lastSyncedVideoId=${lastSyncedVideoId}, hasActivePlayer=${hasActivePlayer}`);

  if (needsNavigation) {
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
  if (currentSessionStatus === status && status === 'connected') {
    return;
  }
  currentSessionStatus = status;
  if (status === 'conflict_resolved' && roomId) {
    showSyncToast(`Room updated: ${roomId}`);
    renderPopoverContent();
  } else if (status === 'connected') {
    lastConnectionError = null;
    showSyncToast(`Connected to session ${roomId}`);
    renderPopoverContent();
    disableAutoplayForConnectedClient();
    window.postMessage({
      source: 'ytm-sync-isolated',
      action: 'SET_CLIENT_ROLE',
      role: syncEngine ? syncEngine.role : 'NONE'
    }, '*');
  } else if (status === 'joining') {
    lastConnectionError = null;
    renderPopoverContent();
    disableAutoplayForConnectedClient();
    window.postMessage({
      source: 'ytm-sync-isolated',
      action: 'SET_CLIENT_ROLE',
      role: syncEngine ? syncEngine.role : 'NONE'
    }, '*');
  } else if (status === 'timeout') {
    currentSessionStatus = 'idle';
    lastConnectionError = `Could not connect to room "${roomId}". Host is offline or room does not exist.`;
    lastAttemptedRoomId = roomId;
    chrome.storage.local.remove('listenTogetherSession');
    latestSessionUpcomingTracks = [];
    renderSessionQueuePanel();
    showSyncToast(`Connection timed out: room "${roomId}" not found`);
    renderPopoverContent();
    window.postMessage({
      source: 'ytm-sync-isolated',
      action: 'SET_CLIENT_ROLE',
      role: 'NONE'
    }, '*');
  } else if (status === 'host_disconnected') {
    currentSessionStatus = 'idle';
    lastConnectionError = `Host left session "${roomId || ''}".`.trim();
    chrome.storage.local.remove('listenTogetherSession');
    latestSessionUpcomingTracks = [];
    renderSessionQueuePanel();
    showSyncToast(`Host left the session`);
    renderPopoverContent();
    window.postMessage({
      source: 'ytm-sync-isolated',
      action: 'SET_CLIENT_ROLE',
      role: 'NONE'
    }, '*');
  } else if (status === 'disconnected' || status === 'left') {
    currentSessionStatus = 'idle';
    latestSessionUpcomingTracks = [];
    renderSessionQueuePanel();
    renderPopoverContent();
    window.postMessage({
      source: 'ytm-sync-isolated',
      action: 'SET_CLIENT_ROLE',
      role: 'NONE'
    }, '*');
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

let currentGuidePage = 1;

function dismissListenTogetherGuide() {
  hasSeenListenTogetherGuide = true;
  isGuideDismissedThisSession = true;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ hasSeenListenTogetherGuide: true });
  }
  const guide = document.getElementById('ytm-listen-together-guide');
  if (guide) guide.remove();
}

function positionListenTogetherGuide() {
  const guide = document.getElementById('ytm-listen-together-guide');
  const btn = ensurePlayerBarButton();
  if (!guide || !btn) return;

  const rect = btn.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;

  const guideWidth = guide.offsetWidth || 300;
  const btnCenterX = rect.left + rect.width / 2;
  const bottomPos = Math.max(75, window.innerHeight - rect.top + 12);
  const rightPos = Math.max(16, window.innerWidth - btnCenterX - (guideWidth / 2));

  guide.style.bottom = `${bottomPos}px`;
  guide.style.right = `${rightPos}px`;

  const arrow = document.getElementById('ytm-listen-together-guide-arrow');
  if (arrow) {
    const guideLeft = window.innerWidth - rightPos - guideWidth;
    const arrowLeft = Math.max(16, Math.min(guideWidth - 16, btnCenterX - guideLeft));
    arrow.style.left = `${arrowLeft}px`;
  }
}

function renderListenTogetherGuideContent() {
  const guide = document.getElementById('ytm-listen-together-guide');
  if (!guide) return;

  const isPage1 = currentGuidePage === 1;

  let bodyHtml = '';
  let buttonsHtml = '';

  if (isPage1) {
    bodyHtml = `
      <div style="font-weight:600; font-size:14px; margin-bottom:6px; color:#ffffff;">Sync music with friends</div>
      <div style="font-size:12.5px; color:rgba(255,255,255,0.92); line-height:1.45; margin-bottom:14px;">
        Listen to tracks at the exact same time with friends across computers. Track changes, play, pause, and seek stay synchronized.
      </div>
    `;
    buttonsHtml = `
      <button id="ytm-guide-got-it-btn" style="background:transparent; border:none; color:rgba(255,255,255,0.85); font-size:12px; font-weight:500; cursor:pointer; padding:6px 10px; border-radius:4px; transition:background 0.1s;">Got it</button>
      <button id="ytm-guide-next-btn" style="background:#ffffff; border:none; color:#065fd4; font-size:12px; font-weight:600; cursor:pointer; padding:6px 14px; border-radius:4px; transition:opacity 0.1s;">Next &rarr;</button>
    `;
  } else {
    bodyHtml = `
      <div style="font-weight:600; font-size:14px; margin-bottom:6px; color:#ffffff;">How to host or join</div>
      <div style="font-size:12px; color:rgba(255,255,255,0.92); line-height:1.5; margin-bottom:14px;">
        <div style="margin-bottom:6px;"><strong style="color:#ffffff;">1. Open menu:</strong> Click the headphones button on the player bar anytime.</div>
        <div style="margin-bottom:6px;"><strong style="color:#ffffff;">2. Host:</strong> Click <em>Start hosting session</em> and copy your room link to share.</div>
        <div><strong style="color:#ffffff;">3. Join:</strong> Paste any friend's room code or link and click <em>Join</em>.</div>
      </div>
    `;
    buttonsHtml = `
      <button id="ytm-guide-back-btn" style="background:transparent; border:none; color:rgba(255,255,255,0.85); font-size:12px; font-weight:500; cursor:pointer; padding:6px 10px; border-radius:4px; transition:background 0.1s;">&larr; Back</button>
      <button id="ytm-guide-try-btn" style="background:#ffffff; border:none; color:#065fd4; font-size:12px; font-weight:600; cursor:pointer; padding:6px 14px; border-radius:4px; transition:opacity 0.1s;">Try it now</button>
    `;
  }

  guide.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
      <div style="display:flex; align-items:center; gap:6px;">
        <span style="font-size:13px; font-weight:600; color:#ffffff;">Listen Together</span>
        <span style="background:rgba(255,255,255,0.2); color:#ffffff; font-size:9.5px; font-weight:700; padding:1px 5px; border-radius:3px; letter-spacing:0.5px; text-transform:uppercase;">BETA</span>
        <a href="https://github.com/FishysPop/Youtube-music-rich-presence/issues" target="_blank" rel="noopener noreferrer" style="color:rgba(255,255,255,0.7); font-size:11px; text-decoration:underline; cursor:pointer;" onmouseenter="this.style.color='#ffffff'" onmouseleave="this.style.color='rgba(255,255,255,0.7)'">Issues?</a>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="background:rgba(255,255,255,0.18); font-size:10.5px; font-weight:600; padding:1px 6px; border-radius:10px; letter-spacing:0.5px; color:#ffffff;">${currentGuidePage} of 2</span>
        <button id="ytm-guide-close-btn" style="background:transparent; border:none; color:rgba(255,255,255,0.7); font-size:16px; line-height:1; cursor:pointer; padding:0 2px; margin:0;">✕</button>
      </div>
    </div>
    ${bodyHtml}
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <div style="display:flex; gap:4px; align-items:center;">
        <span style="width:6px; height:6px; border-radius:50%; background:${isPage1 ? '#ffffff' : 'rgba(255,255,255,0.35)'}; display:inline-block;"></span>
        <span style="width:6px; height:6px; border-radius:50%; background:${!isPage1 ? '#ffffff' : 'rgba(255,255,255,0.35)'}; display:inline-block;"></span>
      </div>
      <div style="display:flex; gap:6px; align-items:center;">
        ${buttonsHtml}
      </div>
    </div>
    <div id="ytm-listen-together-guide-arrow" style="position:absolute; bottom:-8px; width:0; height:0; border-left:8px solid transparent; border-right:8px solid transparent; border-top:8px solid #065fd4; transform:translateX(-50%);"></div>
  `;

  positionListenTogetherGuide();

  const closeBtn = document.getElementById('ytm-guide-close-btn');
  if (closeBtn) {
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      dismissListenTogetherGuide();
    };
  }

  const gotItBtn = document.getElementById('ytm-guide-got-it-btn');
  if (gotItBtn) {
    gotItBtn.onmouseenter = () => { gotItBtn.style.background = 'rgba(255,255,255,0.15)'; };
    gotItBtn.onmouseleave = () => { gotItBtn.style.background = 'transparent'; };
    gotItBtn.onclick = (e) => {
      e.stopPropagation();
      dismissListenTogetherGuide();
    };
  }

  const nextBtn = document.getElementById('ytm-guide-next-btn');
  if (nextBtn) {
    nextBtn.onmouseenter = () => { nextBtn.style.opacity = '0.9'; };
    nextBtn.onmouseleave = () => { nextBtn.style.opacity = '1'; };
    nextBtn.onclick = (e) => {
      e.stopPropagation();
      currentGuidePage = 2;
      renderListenTogetherGuideContent();
    };
  }

  const backBtn = document.getElementById('ytm-guide-back-btn');
  if (backBtn) {
    backBtn.onmouseenter = () => { backBtn.style.background = 'rgba(255,255,255,0.15)'; };
    backBtn.onmouseleave = () => { backBtn.style.background = 'transparent'; };
    backBtn.onclick = (e) => {
      e.stopPropagation();
      currentGuidePage = 1;
      renderListenTogetherGuideContent();
    };
  }

  const tryBtn = document.getElementById('ytm-guide-try-btn');
  if (tryBtn) {
    tryBtn.onmouseenter = () => { tryBtn.style.opacity = '0.9'; };
    tryBtn.onmouseleave = () => { tryBtn.style.opacity = '1'; };
    tryBtn.onclick = (e) => {
      e.stopPropagation();
      dismissListenTogetherGuide();
      if (!isPopoverOpen) togglePlayerBarPopover();
    };
  }
}

function checkAndShowListenTogetherGuide() {
  if (hasSeenListenTogetherGuide || isGuideDismissedThisSession) return;
  if (syncEngine && syncEngine.role !== 'NONE') {
    dismissListenTogetherGuide();
    return;
  }
  if (document.getElementById('ytm-listen-together-guide')) return;

  const btn = ensurePlayerBarButton();
  if (!btn) return;

  const guide = document.createElement('div');
  guide.id = 'ytm-listen-together-guide';
  guide.style.cssText = `
    position: fixed;
    z-index: 1000002;
    background: #065fd4;
    color: #ffffff;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    padding: 16px 18px;
    width: 300px;
    box-sizing: border-box;
    font-family: 'Roboto', 'Noto Sans', sans-serif;
    user-select: none;
    line-height: 1.4;
  `;

  guide.onclick = (e) => {
    e.stopPropagation();
  };

  document.body.appendChild(guide);
  currentGuidePage = 1;
  renderListenTogetherGuideContent();
}

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
      dismissListenTogetherGuide();
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
    const isHost = syncEngine.isHost;
    const isConnected = isHost || Boolean((syncEngine.connectionStatus === 'connected' || currentSessionStatus === 'connected') && syncEngine.hostPeerId);
    btn.style.color = isConnected ? '#ffffff' : '#fbc02d';
    btn.title = isConnected
      ? (isHost ? 'Listen Together (Hosting)' : 'Listen Together (Synced)')
      : 'Listen Together (Connecting...)';
  } else {
    btn.style.color = 'var(--ytmusic-icon-inactive, #909090)';
    btn.title = 'Listen Together';
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

    popover.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    document.addEventListener('click', (e) => {
      if (!isPopoverOpen || !popover) return;
      const btn = ensurePlayerBarButton();
      if (popover.contains(e.target) || (e.composedPath && e.composedPath().includes(popover))) return;
      if (btn && (e.target === btn || btn.contains(e.target) || (e.composedPath && e.composedPath().includes(btn)))) return;
      if (e.target && e.target.ownerDocument && !e.target.ownerDocument.contains(e.target)) return;
      isPopoverOpen = false;
      popover.style.display = 'none';
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

  if (!document.getElementById('ytm-spin-style')) {
    const spinStyle = document.createElement('style');
    spinStyle.id = 'ytm-spin-style';
    spinStyle.textContent = '@keyframes ytm-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
    document.head.appendChild(spinStyle);
  }

  const isSessionActive = Boolean(syncEngine && syncEngine.role !== 'NONE');
  const targetView = isSessionActive ? (syncEngine.isHost ? 'host' : 'listener') : 'idle';

  if (targetView === 'idle') {
    const existingErrorBanner = document.getElementById('ytm-popover-error-banner');
    const hasErrorChanged = Boolean(lastConnectionError) !== Boolean(existingErrorBanner);
    const existingJoinInput = document.getElementById('ytm-popover-join-input');
    if (popover.dataset.view === 'idle' && existingJoinInput && !hasErrorChanged) {
      return;
    }

    const preservedValue = existingJoinInput ? existingJoinInput.value : '';
    const wasFocused = (document.activeElement === existingJoinInput);

    popover.dataset.view = 'idle';
    popover.dataset.peerKey = '';
    popover.dataset.renderedRoomId = '';

    popover.innerHTML = `
      <div style="padding:12px 16px 8px 16px; border-bottom:1px solid rgba(255, 255, 255, 0.08); display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:10px;">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="color:rgba(255,255,255,0.7); display:block;">
            <path d="M12 3a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h3v-8H5v-2a7 7 0 1 1 14 0v2h-4v8h3a3 3 0 0 0 3-3v-7a9 9 0 0 0-9-9z"/>
          </svg>
          <span style="font-weight:500; color:#ffffff; font-size:14px;">Listen Together</span>
        </div>
        <span style="background:rgba(62, 166, 255, 0.15); color:#3ea6ff; font-size:11px; font-weight:700; padding:2px 6px; border-radius:2px; text-transform:uppercase; letter-spacing:0.5px;">
          BETA
        </span>
      </div>
      ${lastConnectionError ? `
        <div id="ytm-popover-error-banner" style="margin:10px 16px 0 16px; padding:8px 10px; background:rgba(255, 78, 69, 0.12); border:1px solid rgba(255, 78, 69, 0.3); border-radius:4px; font-size:12px; color:#ff8983; line-height:1.4; display:flex; align-items:flex-start; gap:8px;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="flex-shrink:0; margin-top:1px;">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
          <span>${escapeHtml(lastConnectionError)}</span>
        </div>
      ` : ''}

      <div id="ytm-popover-start-row" style="height:44px; padding:0 16px; display:flex; align-items:center; gap:16px; cursor:pointer; color:#ffffff; font-size:14px; font-weight:400; transition:background 0.1s;">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="color:rgba(255,255,255,0.7); display:block;">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
        </svg>
        <span>Start hosting session</span>
      </div>

      <div style="padding:10px 16px 12px 16px; border-top:1px solid rgba(255, 255, 255, 0.08);">
        <div style="font-size:12px; color:rgba(255, 255, 255, 0.6); margin-bottom:8px;">Join with room code</div>
        <div style="display:flex; gap:8px; align-items:center;">
          <input type="text" id="ytm-popover-join-input" placeholder="Room code or link" style="background:#181818; border:1px solid rgba(255, 255, 255, 0.15); border-radius:4px; height:34px; padding:0 10px; color:#ffffff; font-size:13px; letter-spacing:0.5px; outline:none; flex:1; box-sizing:border-box; min-width:0;">
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
      startRow.onclick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        lastConnectionError = null;
        dismissListenTogetherGuide();
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
      const initialValue = preservedValue || lastAttemptedRoomId || '';
      if (initialValue) joinInput.value = initialValue;
      if (wasFocused) joinInput.focus();

      joinInput.oninput = () => {
        if (lastConnectionError) {
          lastConnectionError = null;
          const banner = document.getElementById('ytm-popover-error-banner');
          if (banner) banner.remove();
        }
      };

      const handlePopoverJoin = () => {
        const code = parseSessionInput(joinInput.value);
        if (!code) return;
        lastConnectionError = null;
        initSyncEngine();
        if (syncEngine) {
          if (syncEngine.isHost && syncEngine.roomId === code) {
            showSyncToast(`You are already hosting session ${code}`);
            return;
          }
          if (syncEngine.role === 'LISTENER' && syncEngine.roomId === code) {
            showSyncToast(`Already connected to session ${code}`);
            return;
          }
          hostEmptyStartTime = null;
          const roomId = syncEngine.joinRoom(code);
          chrome.storage.local.set({ listenTogetherSession: { role: 'LISTENER', roomId: roomId } });
          updatePlayerBarButton();
          renderPopoverContent();
          showSyncToast(`Joining session: ${roomId}`);
        }
      };

      joinBtn.onmouseenter = () => { joinBtn.style.background = 'rgba(62, 166, 255, 0.1)'; };
      joinBtn.onmouseleave = () => { joinBtn.style.background = 'transparent'; };
      joinBtn.onclick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        dismissListenTogetherGuide();
        handlePopoverJoin();
      };
      joinInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handlePopoverJoin();
        }
      };
    }
    return;
  }

  const isHost = syncEngine.isHost;
  const roomId = syncEngine.roomId || '';
  const count = syncEngine.getConnectedPeerCount ? syncEngine.getConnectedPeerCount() : 0;
  const peerList = syncEngine.getConnectedPeerList ? syncEngine.getConnectedPeerList() : [];
  const isConnected = isHost || Boolean(syncEngine && (syncEngine.connectionStatus === 'connected' || currentSessionStatus === 'connected') && syncEngine.hostPeerId);

  let roleText = 'Connecting';
  let badgeStyle = 'background:rgba(251, 192, 45, 0.15); color:#fbc02d;';
  if (isHost) {
    roleText = count > 0 ? 'Hosting' : 'Waiting';
    badgeStyle = count > 0
      ? 'background:rgba(43, 166, 64, 0.15); color:#2ba640;'
      : 'background:rgba(255, 255, 255, 0.1); color:rgba(255, 255, 255, 0.7);';
  } else if (isConnected) {
    roleText = 'Synced';
    badgeStyle = 'background:rgba(43, 166, 64, 0.15); color:#2ba640;';
  }

  const leaveButtonText = (!isHost && !isConnected) ? 'Cancel connection' : 'Leave session';
  const peerKey = `${isConnected ? '1' : '0'}:${peerList.map(p => `${p.id || ''}:${p.name || ''}`).join(',')}:${(!isHost && isConnected) ? (syncEngine.hostName || '') : ''}`;

  let membersHtml = '';
  if (isHost) {
    if (peerList.length > 0) {
      const names = peerList.map(p => escapeHtml(p.name)).join(', ');
      membersHtml = `<div style="padding:4px 16px 8px 16px; font-size:13px; color:rgba(255, 255, 255, 0.7); line-height:1.4;"><strong style="color:#ffffff;">Listening:</strong> ${names}</div>`;
    } else {
      membersHtml = `<div style="padding:4px 16px 8px 16px; font-size:13px; color:rgba(255, 255, 255, 0.5);">Waiting for friends to join...</div>`;
    }
  } else if (!isConnected) {
    membersHtml = `
      <div style="padding:6px 16px 10px 16px; display:flex; align-items:center; gap:10px;">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fbc02d" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="31.4" stroke-dashoffset="10" style="animation: ytm-spin 1s linear infinite; flex-shrink:0;">
          <circle cx="12" cy="12" r="9.5"/>
        </svg>
        <div>
          <div style="font-size:13px; font-weight:500; color:#ffffff;">Connecting to host...</div>
          <div style="font-size:11px; color:rgba(255, 255, 255, 0.5); margin-top:2px;">Waiting for host in room ${escapeHtml(roomId)} to respond</div>
        </div>
      </div>
    `;
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

  const driftText = (!isHost && isConnected) ? `Synced (${Math.abs(lastAppliedDriftMs)}ms drift)` : '';

  if (popover.dataset.view !== targetView) {
    popover.dataset.view = targetView;
    popover.dataset.peerKey = peerKey;
    popover.dataset.renderedRoomId = roomId;

    popover.innerHTML = `
      <div style="padding:12px 16px 8px 16px; border-bottom:1px solid rgba(255, 255, 255, 0.08); display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:10px;">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="color:rgba(255,255,255,0.7); display:block;">
            <path d="M12 3a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h3v-8H5v-2a7 7 0 1 1 14 0v2h-4v8h3a3 3 0 0 0 3-3v-7a9 9 0 0 0-9-9z"/>
          </svg>
          <span style="font-weight:500; color:#ffffff; font-size:14px;">Listen Together</span>
        </div>
        <span id="ytm-popover-role-badge" style="font-size:11px; font-weight:500; padding:2px 6px; border-radius:2px; text-transform:uppercase; letter-spacing:0.5px; ${badgeStyle}">
          ${roleText}
        </span>
      </div>

      <div style="padding:10px 16px 8px 16px; display:flex; gap:8px; align-items:center;">
        <input type="text" readonly value="${escapeHtml(roomId)}" id="ytm-popover-room-input" title="Room Code" style="background:#181818; border:1px solid rgba(255, 255, 255, 0.15); border-radius:4px; height:32px; padding:0 10px; color:#ffffff; font-size:13px; letter-spacing:0.5px; font-family:monospace; font-weight:600; outline:none; flex:1; box-sizing:border-box; min-width:0; cursor:text; user-select:all; -webkit-user-select:all;">
        <button id="ytm-popover-copy-btn" style="background:transparent; color:#3ea6ff; border:none; border-radius:2px; height:32px; padding:0 8px; font-size:12px; font-weight:500; cursor:pointer; text-transform:uppercase; letter-spacing:0.3px; transition:background 0.15s; flex-shrink:0;">
          Copy Link
        </button>
      </div>

      <div id="ytm-popover-members">${membersHtml}</div>
      <div id="ytm-popover-drift" style="padding:0 16px 8px 16px; font-size:12px; color:rgba(255, 255, 255, 0.5); display:${driftText ? 'block' : 'none'};">${driftText}</div>

      <div id="ytm-popover-leave-row" style="height:44px; padding:0 16px; display:flex; align-items:center; gap:16px; cursor:pointer; color:#ff4e45; font-size:14px; font-weight:400; border-top:1px solid rgba(255, 255, 255, 0.08); transition:background 0.1s;">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="display:block;">
          <path d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/>
        </svg>
        <span id="ytm-popover-leave-text">${leaveButtonText}</span>
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
      copyBtn.onclick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        const url = `https://fishyspop.github.io/Youtube-music-rich-presence/?ytm-session=${encodeURIComponent(roomId)}`;
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
      leaveRow.onclick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        const wasConnecting = (!isHost && !isConnected);
        hostEmptyStartTime = null;
        chrome.storage.local.remove('listenTogetherSession');
        if (syncEngine) syncEngine.leaveRoom();
        updatePlayerBarButton();
        renderPopoverContent();
        showSyncToast(wasConnecting ? 'Cancelled connection' : 'Left Listen Together session');
      };
    }
    return;
  }

  const roleBadge = document.getElementById('ytm-popover-role-badge');
  if (roleBadge) {
    if (roleBadge.textContent.trim() !== roleText) {
      roleBadge.textContent = roleText;
    }
    roleBadge.style.cssText = `font-size:11px; font-weight:500; padding:2px 6px; border-radius:2px; text-transform:uppercase; letter-spacing:0.5px; ${badgeStyle}`;
  }

  const roomInput = document.getElementById('ytm-popover-room-input');
  if (roomInput && roomInput.value !== roomId) {
    roomInput.value = roomId;
  }

  if (popover.dataset.peerKey !== peerKey) {
    popover.dataset.peerKey = peerKey;
    const membersContainer = document.getElementById('ytm-popover-members');
    if (membersContainer) {
      membersContainer.innerHTML = membersHtml;
    }
  }

  const leaveTextEl = document.getElementById('ytm-popover-leave-text');
  if (leaveTextEl && leaveTextEl.textContent !== leaveButtonText) {
    leaveTextEl.textContent = leaveButtonText;
  }

  const driftContainer = document.getElementById('ytm-popover-drift');
  if (driftContainer && driftContainer.textContent !== driftText) {
    driftContainer.textContent = driftText;
    driftContainer.style.display = driftText ? 'block' : 'none';
  }
}

function parseSessionInput(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return null;
  const input = rawInput.trim();
  if (!input) return null;

  if (/^https?:\/\//i.test(input) || input.includes('://')) {
    try {
      const u = new URL(input);
      const q = u.searchParams.get('ytm-session') || u.searchParams.get('session');
      if (q && /^[a-zA-Z0-9_-]+$/.test(q)) return q.toUpperCase();

      const h = u.hash || '';
      const m = h.match(/(?:ytm-session|session)=([a-zA-Z0-9_-]+)/i);
      if (m && m[1]) return m[1].toUpperCase();
    } catch (e) {}
  }

  const paramMatch = input.match(/(?:[?#&]|^)(?:ytm-session|session)=([a-zA-Z0-9_-]+)/i);
  if (paramMatch && paramMatch[1]) {
    return paramMatch[1].toUpperCase();
  }

  const ytmMatch = input.match(/\b(YTM-[a-zA-Z0-9_-]+)\b/i);
  if (ytmMatch && ytmMatch[1]) {
    return ytmMatch[1].toUpperCase();
  }

  if (/^[a-zA-Z0-9]{6}$/.test(input)) {
    return `YTM-${input.toUpperCase()}`;
  }

  if (/^[a-zA-Z0-9_-]{3,32}$/.test(input)) {
    return input.toUpperCase();
  }

  return null;
}

function extractSessionFromUrl(rawUrl) {
  return parseSessionInput(rawUrl);
}

function cleanSessionUrl() {
  try {
    const cleanUrl = new URL(window.location.href);
    let changed = false;
    if (cleanUrl.searchParams.has('ytm-session')) {
      cleanUrl.searchParams.delete('ytm-session');
      changed = true;
    }
    if (cleanUrl.searchParams.has('session')) {
      cleanUrl.searchParams.delete('session');
      changed = true;
    }
    if (cleanUrl.hash.includes('ytm-session') || cleanUrl.hash.includes('session=')) {
      cleanUrl.hash = '';
      changed = true;
    }
    if (changed) {
      history.replaceState(null, '', cleanUrl.pathname + (cleanUrl.search || '') + cleanUrl.hash);
    }
  } catch (e) {}
}

function joinListenerSession(roomId) {
  if (!roomId) return;
  const normalizedId = parseSessionInput(roomId) || (typeof roomId === 'string' ? roomId.trim().toUpperCase() : null);
  if (!normalizedId) return;
  initSyncEngine();
  if (syncEngine) {
    if (syncEngine.isHost && syncEngine.roomId === normalizedId) {
      showSyncToast(`You are already hosting session ${normalizedId}`);
      cleanSessionUrl();
      return;
    }
    if (syncEngine.role === 'LISTENER' && syncEngine.roomId === normalizedId) {
      showSyncToast(`Already connected to session ${normalizedId}`);
      cleanSessionUrl();
      return;
    }
    hostEmptyStartTime = null;
    lastConnectionError = null;
    chrome.storage.local.set({ listenTogetherSession: { role: 'LISTENER', roomId: normalizedId } });
    syncEngine.joinRoom(normalizedId);
    updatePlayerBarButton();
    showSyncToast(`Joining session: ${normalizedId}`);
    cleanSessionUrl();
  }
}

function checkUrlSession() {
  let roomId = null;

  if (window.__ytmPendingSession) {
    roomId = window.__ytmPendingSession;
    window.__ytmPendingSession = null;
  }

  if (!roomId) {
    try {
      const stored = sessionStorage.getItem('__ytm_pending_session');
      if (stored) {
        roomId = stored;
        sessionStorage.removeItem('__ytm_pending_session');
      }
    } catch (e) {}
  }

  if (!roomId) {
    roomId = extractSessionFromUrl(window.location.href);
  }

  if (roomId) {
    joinListenerSession(roomId);
    return;
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['__ytm_pending_session'], (res) => {
      if (res && res.__ytm_pending_session) {
        const pending = res.__ytm_pending_session;
        chrome.storage.local.remove('__ytm_pending_session');
        joinListenerSession(pending);
      }
    });
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
  if (suppression.pendingTrackId !== null) {
    return;
  }
  if (suppression.seek > 0) {
    suppression.seek--;
    return;
  }
  updateTrackInfo(true);
  if (syncEngine && syncEngine.isHost && !isRemoteSyncing) {
    const video = findVideoElement();
    if (video && video.currentTime > 0) {
      syncEngine.notifySeek(video.currentTime);
    }
  }
}

function onVideoEvent(e) {
  if (suppression.pendingTrackId !== null) {
    return;
  }
  if (!e) return;
  if (e.type === 'play') {
    if (suppression.play > 0) {
      suppression.play--;
      return;
    }
    updateTrackInfo(true);
    if (syncEngine && syncEngine.isHost && !isRemoteSyncing) {
      const video = findVideoElement();
      if (video) {
        syncEngine.notifyPlay(video.currentTime);
      }
    }
  } else if (e.type === 'pause') {
    if (suppression.pause > 0) {
      suppression.pause--;
      return;
    }
    updateTrackInfo(true);
    if (syncEngine && syncEngine.isHost && !isRemoteSyncing) {
      const video = findVideoElement();
      if (video) {
        syncEngine.notifyPause(video.currentTime);
      }
    }
  } else {
    updateTrackInfo(false);
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
  latestSessionUpcomingTracks = [];
  const sessionQueuePanel = document.getElementById('ytm-session-queue-panel');
  if (sessionQueuePanel && sessionQueuePanel.parentNode) {
    sessionQueuePanel.parentNode.removeChild(sessionQueuePanel);
  }
  const sessionQueueStyle = document.getElementById('ytm-session-queue-style');
  if (sessionQueueStyle && sessionQueueStyle.parentNode) {
    sessionQueueStyle.parentNode.removeChild(sessionQueueStyle);
  }
  lastSyncedVideoId = null;
  hostEmptyStartTime = null;

  const guide = document.getElementById('ytm-listen-together-guide');
  if (guide && guide.parentNode) {
    guide.parentNode.removeChild(guide);
  }

  const popover = document.getElementById('ytm-listen-together-popover') || document.getElementById('ytm-sync-popover');
  if (popover && popover.parentNode) {
    popover.parentNode.removeChild(popover);
  }

  const toast = document.getElementById('ytm-sync-toast');
  if (toast && toast.parentNode) {
    toast.parentNode.removeChild(toast);
  }

  const btn = document.getElementById('ytm-listen-together-bar-btn') || document.getElementById('ytm-listen-together-btn');
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

  const doUpdate = () => {
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
            const clockOffset = (syncEngine && typeof syncEngine.clockOffset === 'number') ? syncEngine.clockOffset : 0;
            const targetTime = window.ytmCalculateAdCatchUpTime
              ? window.ytmCalculateAdCatchUpTime(lastAdTargetPacket.currentTime, lastAdTargetPacket.timestamp, clockOffset)
              : lastAdTargetPacket.currentTime;

            console.log(`[Listen Together Listener] Catching up after ad in updateTrackInfo: navigating to ${lastAdTargetPacket.videoId} at ${targetTime}s`);
            showSyncToast('Ad finished - catching up with session...');
            navigateToVideo(
              lastAdTargetPacket.videoId,
              lastAdTargetPacket.track,
              lastAdTargetPacket.artist,
              lastAdTargetPacket.albumArtUrl,
              targetTime,
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
            latestSessionUpcomingTracks = [];
            renderSessionQueuePanel();
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
  };

  if (forceSend) {
    if (updateDebounceTimer) {
      clearTimeout(updateDebounceTimer);
      updateDebounceTimer = null;
    }
    doUpdate();
  } else {
    clearTimeout(updateDebounceTimer);
    updateDebounceTimer = setTimeout(doUpdate, 200);
  }
}

function restoreActiveSession() {
  if (syncEngine && syncEngine.role !== 'NONE') return;
  chrome.storage.local.get(['listenTogetherSession'], (res) => {
    if (chrome.runtime.lastError) return;
    if (syncEngine && syncEngine.role !== 'NONE') return;
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
  } else if (message.type === 'SHOW_TOAST') {
    if (message.message) {
      showSyncToast(message.message);
    }
    if (sendResponse) sendResponse({ success: true });
    return false;
  } else if (message.type === 'JOIN_LISTEN_SESSION' || message.type === 'JOIN_SESSION') {
    if (syncEngine && message.roomId) {
      const targetRoomId = parseSessionInput(message.roomId) || (typeof message.roomId === 'string' ? message.roomId.trim().toUpperCase() : null);
      if (!targetRoomId) {
        if (sendResponse) sendResponse({ success: false, error: 'Invalid room ID or link' });
        return false;
      }
      if (syncEngine.isHost && syncEngine.roomId === targetRoomId) {
        showSyncToast(`You are already hosting session ${targetRoomId}`);
        if (sendResponse) sendResponse({ success: true, roomId: targetRoomId, isHost: true, alreadyConnected: true });
        return false;
      }
      if (syncEngine.role === 'LISTENER' && syncEngine.roomId === targetRoomId) {
        showSyncToast(`Already connected to session ${targetRoomId}`);
        if (sendResponse) sendResponse({ success: true, roomId: targetRoomId, isHost: false, alreadyConnected: true });
        return false;
      }
      hostEmptyStartTime = null;
      waitForYouTubeMusicReady(() => {
        const roomId = syncEngine.joinRoom(targetRoomId);
        chrome.storage.local.set({ listenTogetherSession: { role: 'LISTENER', roomId: roomId } });
        showSyncToast(`Joining session: ${roomId}`);
        updatePlayerBarButton();
      });
      if (sendResponse) sendResponse({ success: true, roomId: targetRoomId, isHost: false });
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

function waitForYouTubeMusicReady(callback) {
  let done = false;
  let timer = null;
  let pollInterval = null;

  function finish() {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    if (pollInterval) clearInterval(pollInterval);
    window.removeEventListener('yt-page-data-updated', check);
    window.removeEventListener('yt-navigate-finish', check);
    window.removeEventListener('load', check);
    callback();
  }

  function check() {
    const isDocComplete = document.readyState === 'complete';
    const app = document.querySelector('ytmusic-app');
    const playerBar = document.querySelector('ytmusic-player-bar');
    const player = document.getElementById('movie_player') || document.querySelector('video');
    if (isDocComplete && app && playerBar && player) {
      finish();
    }
  }

  const isDocComplete = document.readyState === 'complete';
  const app = document.querySelector('ytmusic-app');
  const playerBar = document.querySelector('ytmusic-player-bar');
  const player = document.getElementById('movie_player') || document.querySelector('video');
  const perfNow = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : 0;

  if (isDocComplete && app && playerBar && player && perfNow > 2000) {
    callback();
    return;
  }

  window.addEventListener('yt-page-data-updated', check);
  window.addEventListener('yt-navigate-finish', check);
  window.addEventListener('load', check);

  pollInterval = setInterval(check, 150);
  timer = setTimeout(finish, 4000);
}

initSyncEngine();
updateTrackInfo(true);
waitForYouTubeMusicReady(() => {
  checkUrlSession();
  restoreActiveSession();
  updateTrackInfo(true);
  updatePlayerBarButton();
  setTimeout(checkAndShowListenTogetherGuide, 1500);
});

window.addEventListener('resize', positionListenTogetherGuide);

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
  checkUrlSession();
  updateTrackInfo(false);
  disableAutoplayForConnectedClient();
};

window.addEventListener('yt-navigate-finish', navigationFinishListener);
window.addEventListener('hashchange', checkUrlSession);

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
      navigateToVideo(lastAdTargetPacket.videoId, lastAdTargetPacket.track, lastAdTargetPacket.artist, lastAdTargetPacket.albumArtUrl, lastAdTargetPacket.currentTime, lastAdTargetPacket.isPlaying, lastAdTargetPacket.playlistId, lastAdTargetPacket.playlistIndex, lastAdTargetPacket.nextVideoId, lastAdTargetPacket.upcomingTracks);
    }
  }
  attachVideoListeners();
  updateTrackInfo();
  updatePlayerBarButton();
  checkAutoStopIdleHosting();
  renderSessionQueuePanel();
  disableAutoplayForConnectedClient();
}, 1000);

window.__ytmRpcCleanup = cleanup;
})();
