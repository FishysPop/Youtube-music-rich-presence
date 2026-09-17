const nativeHostName = 'com.fishypop.ytmusic_rpc';
const REQUIRED_NATIVE_HOST_VERSION = "1.0.0"; 

let port = null;
let connectRetryTimeout = null;
let periodicCheckIntervalId = null;
const PERIODIC_CHECK_INTERVAL = 1200000;

// --- Dynamic Reconnection Timer ---
let reconnectAttempts = 0;
const INITIAL_RECONNECT_DELAY = 3000; // 3 seconds
const MAX_RECONNECT_DELAY = 180000; // 3 minutes

// --- State Management ---
let currentStatus = 'disconnected'; // Overall status: disconnected, connecting_native, native_connected, rpc_ready, error
let statusErrorMessage = null;
let currentActivity = null;
let currentRpcUser = null;
let isRpcReady = false;
let pendingActivity = null;
let isManuallyDisconnected = false; // Used for temporary disconnects like pause timeouts
let userDisconnected = false; // Tracks if the user has explicitly disconnected via the UI
let isPauseHidden = false;
let pauseHideTargetTime = null;
let nativeHostVersion = null;
let nativeHostVersionMismatch = false;
let nativeHostInstalled = null;
let isVerifyingInstall = false;

let currentSongActivity = null;
let pausedTimestamp = null;
let pauseTimeoutId = null;

let activeSessionRole = 'NONE';
let activeSessionRoomId = null;
let activeSessionPeerCount = 0;

chrome.storage.local.get({
    userDisconnected: false,
    isPauseHidden: false,
    pausedTimestamp: null,
    pauseHideTargetTime: null,
    nativeHostInstalled: null,
    nativeHostVersion: null,
    nativeHostVersionMismatch: false
}, (res) => {
    userDisconnected = res.userDisconnected;
    isPauseHidden = res.isPauseHidden;
    pausedTimestamp = res.pausedTimestamp;
    pauseHideTargetTime = res.pauseHideTargetTime;
    nativeHostInstalled = res.nativeHostInstalled;
    if (res.nativeHostVersion) nativeHostVersion = res.nativeHostVersion;
    nativeHostVersionMismatch = res.nativeHostVersionMismatch;
});

if (chrome.alarms) {
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === 'pauseHideAlarm') {
            console.log('Background: Pause hide alarm triggered.');
            handlePauseHideTimeout();
        } else if (alarm.name === 'periodicCheckAlarm') {
            console.log('Background: Periodic check alarm triggered.');
            periodicConnectionCheck();
        }
    });
}

function setupPeriodicAlarm() {
    if (chrome.alarms) {
        chrome.alarms.get('periodicCheckAlarm', (alarm) => {
            if (!alarm) {
                chrome.alarms.create('periodicCheckAlarm', { periodInMinutes: 5 });
            }
        });
    }
}
setupPeriodicAlarm();

function handlePauseHideTimeout() {
    isPauseHidden = true;
    pauseHideTargetTime = null;
    chrome.storage.local.set({ isPauseHidden: true, pauseHideTargetTime: null });
    processClearActivity(true);
}
/**
 * Updates the internal state and notifies the popup.
 * @param {string} newStatus - The new primary status.
 * @param {string|undefined} errorMessage - Optional error message. If undefined, existing message may persist. If null, clears.
 * @param {object|null|undefined} rpcUser - Optional Discord user object. If undefined, existing user persists. If null, clears.
 * @param {object|null|undefined} overridePopupActivity - Optional. If provided, this activity object (or null) will be sent to the popup
 *                                                      as 'currentActivity' for THIS specific status update, overriding the global currentActivity.
 * @param {string|undefined} hostVersion - Optional native host version. If undefined, existing version persists. If null, clears.
 * @param {boolean|undefined} versionMismatch - Optional boolean for version mismatch.
 */
function updateStatus(newStatus, errorMessage = undefined, rpcUser = undefined, overridePopupActivity = undefined, hostVersion = undefined, versionMismatch = undefined) {

    currentStatus = newStatus;

    if (errorMessage !== undefined) {
        statusErrorMessage = errorMessage;
    }
    if (rpcUser !== undefined) {
        currentRpcUser = rpcUser;
        if (rpcUser) {
            chrome.storage.local.set({ discordUser: rpcUser });
        }
    }
    if (hostVersion !== undefined) {
        nativeHostVersion = hostVersion;
    }
    if (versionMismatch !== undefined) {
        nativeHostVersionMismatch = versionMismatch;
    }

    if ((newStatus === 'rpc_ready' || newStatus === 'native_connected') && errorMessage === undefined) {
        statusErrorMessage = null;
    }
    if (newStatus === 'rpc_ready' && rpcUser === undefined && currentRpcUser === null) {
        // console.warn("Background: updateStatus to rpc_ready without rpcUser, but currentRpcUser is null.")
    }


    const activityForThisPopupUpdate = overridePopupActivity !== undefined ? overridePopupActivity : currentActivity;

    chrome.runtime.sendMessage({
        type: 'STATUS_UPDATE',
        status: currentStatus,
        errorMessage: statusErrorMessage,
        rpcUser: currentRpcUser,
        currentActivity: activityForThisPopupUpdate,
        nativeHostVersion: nativeHostVersion,
        nativeHostVersionMismatch: nativeHostVersionMismatch,
        nativeHostInstalled: nativeHostInstalled
    }).catch(err => {
        if (!err.message.includes("Receiving end does not exist")) {
            console.warn("Background: Error sending STATUS_UPDATE to popup, likely no popup open:", err.message);
        }
    });

    if (newStatus === 'error') {
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#FF0000' }); 
    } else if (newStatus === 'connecting_native') {
        chrome.action.setBadgeText({ text: '...' });
        chrome.action.setBadgeBackgroundColor({ color: '#FFA500' }); 
    } else {
        chrome.action.setBadgeText({ text: '' }); 
    }
}

function _sendSetActivityToNativeHost(activityData) {
    if (!port) {
        console.warn('[YTM RPC Background] Attempted to send SET_ACTIVITY, but native host port is not connected.');
        return;
    }
    try {
        const sanitizedData = { ...activityData };
        if (!sanitizedData.largeImageText) {
            delete sanitizedData.largeImageText;
        }
        if (!sanitizedData.album) {
            delete sanitizedData.album;
        }
        if (Array.isArray(sanitizedData.buttons) && sanitizedData.buttons.length > 2) {
            console.warn(`[YTM RPC Background] Truncating ${sanitizedData.buttons.length} buttons to Discord's max of 2.`);
            sanitizedData.buttons = sanitizedData.buttons.slice(0, 2);
        }
        console.log('[YTM RPC Background] Posting SET_ACTIVITY to native host. Details:', {
            track: sanitizedData.details,
            artist: sanitizedData.state,
            startTimestamp: sanitizedData.startTimestamp,
            startTimestampReadable: sanitizedData.startTimestamp ? new Date(sanitizedData.startTimestamp).toLocaleTimeString() : 'none',
            endTimestamp: sanitizedData.endTimestamp,
            endTimestampReadable: sanitizedData.endTimestamp ? new Date(sanitizedData.endTimestamp).toLocaleTimeString() : 'none',
            elapsedSeconds: sanitizedData.startTimestamp ? ((Date.now() - sanitizedData.startTimestamp) / 1000).toFixed(1) : 'none',
            duration: sanitizedData.duration,
            smallImageKey: sanitizedData.smallImageKey
        });
        port.postMessage({ type: 'SET_ACTIVITY', data: sanitizedData });
        console.log('Background: Sent SET_ACTIVITY to native host:', sanitizedData);
    } catch (error) {
        console.error('Background: Error posting SET_ACTIVITY to native host:', error);
        handlePortError(error, activityData);
    }
}

function _sendClearActivityToNativeHost() {
    if (!port) {
        console.warn('Background: Attempted to send CLEAR_ACTIVITY, but native host port is not connected.');
        return;
    }
    try {
        console.log('[YTM RPC Background] Posting CLEAR_ACTIVITY to native host');
        port.postMessage({ type: 'CLEAR_ACTIVITY' });
        console.log('Background: Sent CLEAR_ACTIVITY to native host.');
    } catch (error) {
        console.error('Background: Error posting CLEAR_ACTIVITY to native host:', error);
        handlePortError(error, null);
    }
}

function handlePortError(error, activityContextIfSet) {
    if (error.message.toLowerCase().includes("disconnected port") || error.message.toLowerCase().includes("native host has exited")) {
        console.warn(`Background: Port error encountered: ${error.message}. Native host connection lost.`);
        if (port) {
            port.onDisconnect.removeListener(onPortDisconnectHandler);
            port = null;
        }
        isRpcReady = false;
        if (activityContextIfSet) {
            pendingActivity = activityContextIfSet;
        }
        updateStatus('disconnected', `Port Error: ${error.message}`, null, pendingActivity || currentActivity, null, false); // Clear version and reset mismatch on disconnection

        chrome.storage.local.get({ autoReconnectEnabled: true }, (result) => {
            if (result.autoReconnectEnabled) {
                if (isManuallyDisconnected) {
                    console.log('Background: Auto-reconnect skipped due to manual disconnect.');
                    return;
                }
                if (!currentSongActivity && !pendingActivity) {
                    console.log('Background: Auto-reconnect skipped because no music is playing.');
                    return;
                }
                console.log('Background: Auto-reconnect ON. Scheduling native host reconnect due to port error.');
                scheduleReconnect();
            } else {
                console.log('Background: Auto-reconnect OFF. Not scheduling reconnect (port error).');
            }
        });
    } else {
        updateStatus(currentStatus, `Send Error: ${error.message}`, currentRpcUser, activityContextIfSet || currentActivity);
    }
}

const onPortDisconnectHandler = () => {
    const lastError = chrome.runtime.lastError;
    let disconnectMsg = 'Disconnected from native host.';
    if (lastError) {
        disconnectMsg = `Disconnected from native host: ${lastError.message}`;
        console.warn(`Background: ${disconnectMsg}`);
    } else {
        console.log(`Background: ${disconnectMsg} (No specific error from runtime)`);
    }

    if (port) {
        port.onDisconnect.removeListener(onPortDisconnectHandler);
    }
    port = null;
    isRpcReady = false;
    const isHostNotFound = lastError && (lastError.message.includes("not found") || lastError.message.includes("forbidden"));
    if (isHostNotFound) {
        nativeHostInstalled = false;
        chrome.storage.local.set({ nativeHostInstalled: false });
    }
    updateStatus(isHostNotFound ? 'error' : 'disconnected', disconnectMsg, null, pendingActivity || currentActivity, null, false);

    chrome.storage.local.get({ autoReconnectEnabled: true }, (result) => {
        if (result.autoReconnectEnabled) {
            if (isManuallyDisconnected) {
                console.log('Background: Auto-reconnect skipped due to manual disconnect.');
                return;
            }
            if (!currentSongActivity && !pendingActivity) {
                console.log('Background: Auto-reconnect skipped because no music is playing.');
                return;
            }
            console.log('Background: Auto-reconnect ON. Will attempt to reconnect to native host (onPortDisconnect).');
            scheduleReconnect();
        } else {
            console.log('Background: Auto-reconnect OFF. Not scheduling reconnect (onPortDisconnect).');
        }
    });
};

function connectToNativeHost() {
  if (port) {
    if (currentStatus === 'disconnected' || currentStatus === 'error') {
         updateStatus('connecting_native', undefined, null, pendingActivity || currentActivity);
    }
    return;
  }

  if (userDisconnected) {
      console.log('Background: Not attempting to connect to native host because it was manually disconnected by the user.');
      updateStatus('disconnected', 'Manually disconnected by user.', null, pendingActivity || currentActivity);
      return;
  }
  // This handles the case where we disconnected due to pause timeout, etc.
  // We don't want to auto-connect in this state, we want to wait for a trigger like a new song.
  if (isManuallyDisconnected) {
      console.log('Background: Not attempting to connect to native host due to a temporary disconnect (e.g., pause timeout).');
      return;
  }

  console.log(`Background: Attempting to connect to native host: ${nativeHostName}`);
  isRpcReady = false;
  updateStatus('connecting_native', null, null, pendingActivity || currentActivity);

  try {
    port = chrome.runtime.connectNative(nativeHostName);

    if (connectRetryTimeout) {
        clearTimeout(connectRetryTimeout);
        connectRetryTimeout = null;
    }

        port.onMessage.addListener((message) => {
        if (message.type === 'NATIVE_HOST_STARTED') {
            console.log('Background: Native host confirmed it has started. Waiting for RPC status.');
            reconnectAttempts = 0;
            let versionMismatch = false;
            if (message.version) {
                console.log(`Background: Native host version received: ${message.version}`);
                if (message.version !== REQUIRED_NATIVE_HOST_VERSION) {
                    console.warn(`Background: Native host version mismatch! Expected ${REQUIRED_NATIVE_HOST_VERSION}, got ${message.version}`);
                    versionMismatch = true;
                }
            } else {
                console.warn('Background: Native host version not provided in NATIVE_HOST_STARTED message. Assuming outdated.');
                versionMismatch = true; 
            }
            nativeHostInstalled = true;
            nativeHostVersion = message.version || null;
            nativeHostVersionMismatch = versionMismatch;
            chrome.storage.local.set({
                nativeHostInstalled: true,
                nativeHostVersion: message.version || null,
                nativeHostVersionMismatch: versionMismatch
            });
            updateStatus('native_connected', null, null, pendingActivity || currentActivity, message.version, versionMismatch);

            if (isVerifyingInstall) {
                isVerifyingInstall = false;
                if (!currentSongActivity && !pendingActivity) {
                    setTimeout(() => {
                        if (!currentSongActivity && !pendingActivity && port) {
                            try {
                                port.onDisconnect.removeListener(onPortDisconnectHandler);
                                port.disconnect();
                            } catch (e) {}
                            port = null;
                            isRpcReady = false;
                            updateStatus('disconnected', null, null, null, message.version, versionMismatch);
                        }
                    }, 500);
                }
            }
        } else if (message.type === 'RPC_STATUS_UPDATE') {
            if (message.status === 'connected') {
                console.log('Background: Native host reported Discord RPC is ready (connected). User:', message.user);
                reconnectAttempts = 0; 
                isRpcReady = true;
                isManuallyDisconnected = false;
                updateStatus('rpc_ready', undefined, message.user, pendingActivity || currentActivity, nativeHostVersion, nativeHostVersionMismatch);
                if (pendingActivity) {
                    console.log('Background: RPC ready, sending pending activity:', pendingActivity);
                    _sendSetActivityToNativeHost(pendingActivity);
                } else {
                    console.log('Background: RPC ready, no pending song activity, ensuring Discord presence is cleared/updated.');
                    _sendClearActivityToNativeHost();
                }
            } else if (message.status === 'disconnected') {
                console.warn('Background: Native host reported Discord RPC disconnected.');
                isRpcReady = false;
                updateStatus('native_connected', 'Discord RPC disconnected by native host.', null, pendingActivity || currentActivity, nativeHostVersion, nativeHostVersionMismatch);

                chrome.storage.local.get({ autoReconnectEnabled: true }, (result) => {
                    if (result.autoReconnectEnabled) {
                        if (isManuallyDisconnected) {
                            console.log('Background: Auto-reconnect skipped due to manual disconnect.');
                            return;
                        }
                        if (!currentSongActivity && !pendingActivity) {
                            console.log('Background: Auto-reconnect skipped because no music is playing.');
                            return;
                        }
                        console.log('Background: Auto-reconnect ON. Scheduling RPC reconnect due to RPC disconnect.');
                        scheduleReconnect(reconnectDiscordRpcOnly);
                    } else {
                        console.log('Background: Auto-reconnect OFF. Not scheduling reconnect (RPC disconnect).');
                    }
                });
            }
        } else if (message.type === 'RPC_ERROR') {
            console.error('Background: Received RPC_ERROR from native host:', message.message, message.errorDetails || '');
            isRpcReady = false;
            updateStatus('native_connected', `RPC Error: ${message.message || 'Unknown RPC error'}`, null, pendingActivity || currentActivity, nativeHostVersion, nativeHostVersionMismatch);

            chrome.storage.local.get({ autoReconnectEnabled: true }, (result) => {
                if (result.autoReconnectEnabled) {
                    if (isManuallyDisconnected) {
                        console.log('Background: Auto-reconnect skipped due to manual disconnect.');
                        return;
                    }
                    if (!currentSongActivity && !pendingActivity) {
                        console.log('Background: Auto-reconnect skipped because no music is playing.');
                        return;
                    }
                    console.log('Background: Auto-reconnect ON. Scheduling RPC reconnect due to RPC error.');
                    if (message.errorType === 'AUTHENTICATION_ERROR') {
                        console.log('Background: Authentication error detected. Using longer retry delays.');
                        scheduleReconnect(reconnectDiscordRpcOnly, true);
                    } else if (message.errorType === 'TIMEOUT_ERROR') {
                        console.log('Background: Timeout error detected. Using aggressive retry strategy.');
                        scheduleReconnectWithAggressiveBackoff(reconnectDiscordRpcOnly);
                    } else {
                        console.log('Background: Other RPC error detected. Using standard backoff strategy.');
                        scheduleReconnect(reconnectDiscordRpcOnly); 
                    }
                } else {
                    console.log('Background: Auto-reconnect OFF. Not scheduling reconnect (RPC error).');
                }
            });
        } else if (message.type === 'ACTIVITY_STATUS') {
            console.log('Background: Received ACTIVITY_STATUS:', message);
            switch (message.status) {
                case 'success':
                    currentActivity = message.activity;
                    if (pendingActivity &&
                        message.activity &&
                        pendingActivity.details === message.activity.details &&
                        pendingActivity.state === message.activity.state &&
                        pendingActivity.startTimestamp === message.activity.startTimestamp) {
                        pendingActivity = null;
                    }
                    updateStatus('rpc_ready', undefined, currentRpcUser, currentActivity, nativeHostVersion, nativeHostVersionMismatch);
                    break;
                case 'cleared':
                    currentActivity = null;
                    pendingActivity = null;
                    updateStatus('rpc_ready', undefined, currentRpcUser, null, nativeHostVersion, nativeHostVersionMismatch);
                    break;
                case 'error_rpc_not_ready':
                    isRpcReady = false;
                    updateStatus('native_connected', message.message, currentRpcUser, pendingActivity || currentActivity, nativeHostVersion, nativeHostVersionMismatch);
                    chrome.storage.local.get({ autoReconnectEnabled: true }, (result) => {
                        if (result.autoReconnectEnabled && !isManuallyDisconnected && !userDisconnected) {
                            scheduleReconnect(reconnectDiscordRpcOnly);
                        }
                    });
                    break;
                case 'error':
                case 'clear_error':
                    isRpcReady = false;
                    updateStatus('native_connected', message.message, null, pendingActivity || currentActivity, nativeHostVersion, nativeHostVersionMismatch);
                    chrome.storage.local.get({ autoReconnectEnabled: true }, (result) => {
                        if (result.autoReconnectEnabled && !isManuallyDisconnected && !userDisconnected) {
                            scheduleReconnect(reconnectDiscordRpcOnly);
                        }
                    });
                    break;
                default:
                    console.warn('Background: Received unknown ACTIVITY_STATUS status:', message.status);
                    break;
            }
        } else if (message.type === 'NATIVE_HOST_ERROR') {
            console.error('Background: Received NATIVE_HOST_ERROR from native host:', message.message);
            isRpcReady = false;
            updateStatus('error', `Native Host Error: ${message.message || 'Unknown error'}`, null, pendingActivity || currentActivity, nativeHostVersion, true); // Set mismatch to true on native host error
        } else if (message.type === 'DEBUG_LOG') {
            console.log(`NH_DEBUG: ${message.message}`);
        }
    });

    port.onDisconnect.addListener(onPortDisconnectHandler);

  } catch (error) {
    console.error('Background: CRITICAL - Error connecting to native host:', error.message);
    isRpcReady = false;
    if (port) {
        try { port.disconnect(); } catch(e) {/*ignore*/}
        port = null;
    }
    updateStatus('disconnected', `Connection Error: ${error.message}`, null, pendingActivity || currentActivity, null, false); // Clear version and reset mismatch on connection error

    chrome.storage.local.get({ autoReconnectEnabled: true }, (result) => {
        if (result.autoReconnectEnabled) {
            if (isManuallyDisconnected) {
                console.log('Background: Auto-reconnect skipped due to manual disconnect.');
                return;
            }
            console.log('Background: Auto-reconnect ON. Will attempt to reconnect to native host (due to connection error).');
            scheduleReconnect();
        } else {
            console.log('Background: Auto-reconnect OFF. Not scheduling reconnect (connection error).');
        }
    });
  }
}

function getPauseTimeout() {
    return new Promise((resolve) => {
        chrome.storage.local.get({ pauseTimeoutMinutes: -1 }, (result) => {
            resolve(result.pauseTimeoutMinutes);
        });
    });
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

function processNewActivity(message) {
    if (message.isPlaying) {
        if (isPauseHidden) {
            isPauseHidden = false;
            chrome.storage.local.set({ isPauseHidden: false, pauseHideTargetTime: null });
        }
        if (chrome.alarms) {
            chrome.alarms.clear('pauseHideAlarm');
        }
        if (pauseTimeoutId) {
            clearTimeout(pauseTimeoutId);
            pauseTimeoutId = null;
        }
        if (isManuallyDisconnected && !userDisconnected) {
            isManuallyDisconnected = false;
        }
    } else {
        if (isPauseHidden && currentSongActivity && currentSongActivity.details === message.track && currentSongActivity.state === message.artist) {
            return;
        }
        if (pauseHideTargetTime && Date.now() >= pauseHideTargetTime && !isPauseHidden) {
            handlePauseHideTimeout();
            return;
        }
    }

    let shouldUpdatePresence = false;
    const isDifferentSong = !currentSongActivity || currentSongActivity.details !== message.track || currentSongActivity.state !== message.artist;

    if (isDifferentSong) {
        shouldUpdatePresence = true;
        const directOrSearchUrl = (message.videoId && /^[a-zA-Z0-9_-]{11}$/.test(message.videoId))
            ? `https://music.youtube.com/watch?v=${message.videoId}`
            : `https://music.youtube.com/search?q=${encodeURIComponent(`${message.artist} ${message.track}`)}`;

        const buttons = (activeSessionRoomId && activeSessionRole === 'HOST') ? [
            { label: "Listen Along", url: `https://fishyspop.github.io/Youtube-music-rich-presence/?ytm-session=${activeSessionRoomId}` },
            { label: "Link", url: directOrSearchUrl }
        ] : [
            { label: "Link", url: directOrSearchUrl },
            { label: "GitHub", url: "https://github.com/FishysPop/Youtube-music-rich-presence" }
        ];

        const actualAlbum = (message.album && isActualAlbum(message.track, message.album))
            ? message.album.trim()
            : null;
        const largeImageText = actualAlbum || null;

        const smallImageKey = message.repeatMode === 'ONE' ? 'repeat_one' : 'play';
        const smallImageText = message.repeatMode === 'ONE' ? 'On Loop' : 'Playing';

        currentSongActivity = {
            details: message.track,
            state: message.artist,
            album: actualAlbum,
            videoId: message.videoId || null,
            repeatMode: message.repeatMode || 'NONE',
            largeImageKey: message.albumArtUrl ? message.albumArtUrl.replace(/w\d+-h\d+/, 'w512-h512') : null,
            largeImageText: largeImageText,
            smallImageKey: smallImageKey,
            smallImageText: smallImageText,
            albumArtUrl: message.albumArtUrl || null,
            buttons: buttons,
            statusDisplayType: 2,
            type: 2
        };

        if (activeSessionRoomId && activeSessionRole === 'HOST') {
            currentSongActivity.partyId = activeSessionRoomId;
            currentSongActivity.partySize = activeSessionPeerCount + 1;
            currentSongActivity.partyMax = 10;
        }
        let initCurrentTime = 0;
        if (message.userIsSeeking && typeof message.currentTime === 'number' && message.currentTime > 0) {
            initCurrentTime = message.currentTime;
        } else if (!currentActivity && typeof message.currentTime === 'number' && message.currentTime > 0 && (!message.duration || message.currentTime < message.duration)) {
            initCurrentTime = message.currentTime;
        }

        currentSongActivity.startTimestamp = Math.floor(Date.now()) - (initCurrentTime * 1000);
        currentSongActivity.duration = (message.duration && message.duration > 0) ? message.duration : 0;

        pausedTimestamp = null;
        pauseHideTargetTime = null;
        isPauseHidden = false;
        chrome.storage.local.set({ pausedTimestamp: null, pauseHideTargetTime: null, isPauseHidden: false });
        if (chrome.alarms) {
            chrome.alarms.clear('pauseHideAlarm');
        }
        if (pauseTimeoutId) {
            clearTimeout(pauseTimeoutId);
            pauseTimeoutId = null;
        }
        
        if (isManuallyDisconnected && !userDisconnected) {
            isManuallyDisconnected = false;
            connectToNativeHost();
        }
    } else {
        if (message.duration && message.duration > 0 && (!currentSongActivity.duration || currentSongActivity.duration === 0)) {
            currentSongActivity.duration = message.duration;
            shouldUpdatePresence = true;
        }

        if (message.albumArtUrl && message.albumArtUrl !== currentSongActivity.albumArtUrl) {
            currentSongActivity.albumArtUrl = message.albumArtUrl;
            currentSongActivity.largeImageKey = message.albumArtUrl.replace(/w\d+-h\d+/, 'w512-h512');
            shouldUpdatePresence = true;
        }

        const newActualAlbum = (message.album && isActualAlbum(currentSongActivity.details, message.album))
            ? message.album.trim()
            : null;
        if (newActualAlbum !== currentSongActivity.album) {
            currentSongActivity.album = newActualAlbum;
            currentSongActivity.largeImageText = newActualAlbum;
            shouldUpdatePresence = true;
        }

        if (message.videoId && message.videoId !== currentSongActivity.videoId) {
            currentSongActivity.videoId = message.videoId;
            const directOrSearchUrl = `https://music.youtube.com/watch?v=${message.videoId}`;
            currentSongActivity.buttons = (activeSessionRoomId && activeSessionRole === 'HOST') ? [
                { label: "Listen Along", url: `https://fishyspop.github.io/Youtube-music-rich-presence/?ytm-session=${activeSessionRoomId}` },
                { label: "Link", url: directOrSearchUrl }
            ] : [
                { label: "Link", url: directOrSearchUrl },
                { label: "GitHub", url: "https://github.com/FishysPop/Youtube-music-rich-presence" }
            ];
            shouldUpdatePresence = true;
        }

        if (message.repeatMode && message.repeatMode !== currentSongActivity.repeatMode) {
            currentSongActivity.repeatMode = message.repeatMode;
            if (pausedTimestamp === null) {
                currentSongActivity.smallImageKey = message.repeatMode === 'ONE' ? 'repeat_one' : 'play';
                currentSongActivity.smallImageText = message.repeatMode === 'ONE' ? 'On Loop' : 'Playing';
                shouldUpdatePresence = true;
            }
        }

        if (typeof message.currentTime === 'number' && !isNaN(message.currentTime) && message.currentTime >= 0) {
            const effectiveDuration = currentSongActivity.duration || message.duration || 0;
            if (effectiveDuration === 0 || message.currentTime <= effectiveDuration) {
                const expectedCurrentTime = pausedTimestamp !== null
                    ? (pausedTimestamp - currentSongActivity.startTimestamp) / 1000
                    : (Math.floor(Date.now()) - currentSongActivity.startTimestamp) / 1000;
                const timeDifference = Math.abs(message.currentTime - expectedCurrentTime);

                const isSpuriousZero = message.currentTime === 0 && expectedCurrentTime > 3 && !message.userIsSeeking;

                if (!isSpuriousZero && timeDifference > 3.5) {
                    currentSongActivity.startTimestamp = Math.floor(Date.now()) - (message.currentTime * 1000);
                    if (pausedTimestamp !== null) {
                        pausedTimestamp = Math.floor(Date.now());
                    }
                    shouldUpdatePresence = true;
                }
            }
        }
    }

    if (!message.isPlaying && pausedTimestamp === null) {
        pausedTimestamp = Math.floor(Date.now());
        delete currentSongActivity.endTimestamp;
        currentSongActivity.smallImageKey = 'https://cdn.rcd.gg/PreMiD/resources/pause.png';
        currentSongActivity.smallImageText = 'Paused';
        shouldUpdatePresence = true;
        
        getPauseTimeout().then((timeoutMinutes) => {
            if (pauseTimeoutId) {
                clearTimeout(pauseTimeoutId);
                pauseTimeoutId = null;
            }
            if (chrome.alarms) {
                chrome.alarms.clear('pauseHideAlarm');
            }
            
            if (timeoutMinutes > 0) {
                const targetTime = Date.now() + (timeoutMinutes * 60 * 1000);
                pauseHideTargetTime = targetTime;
                chrome.storage.local.set({ pausedTimestamp, pauseHideTargetTime: targetTime });
                if (chrome.alarms) {
                    chrome.alarms.create('pauseHideAlarm', { when: targetTime });
                }
                pauseTimeoutId = setTimeout(() => {
                    handlePauseHideTimeout();
                }, timeoutMinutes * 60 * 1000);
            } else {
                chrome.storage.local.set({ pausedTimestamp, pauseHideTargetTime: null });
            }
        });
    } else if (message.isPlaying && pausedTimestamp !== null) {
        const pauseDuration = Math.floor(Date.now()) - pausedTimestamp;
        currentSongActivity.startTimestamp += pauseDuration;
        pausedTimestamp = null;
        pauseHideTargetTime = null;
        isPauseHidden = false;
        chrome.storage.local.set({ pausedTimestamp: null, pauseHideTargetTime: null, isPauseHidden: false });
        currentSongActivity.smallImageKey = currentSongActivity.repeatMode === 'ONE' ? 'repeat_one' : 'play';
        currentSongActivity.smallImageText = currentSongActivity.repeatMode === 'ONE' ? 'On Loop' : 'Playing';
        shouldUpdatePresence = true;
        
        if (pauseTimeoutId) {
            clearTimeout(pauseTimeoutId);
            pauseTimeoutId = null;
        }
        if (chrome.alarms) {
            chrome.alarms.clear('pauseHideAlarm');
        }
        
        if (isManuallyDisconnected && !userDisconnected) {
            isManuallyDisconnected = false;
            connectToNativeHost();
        }
    }

    const activeDuration = currentSongActivity.duration || message.duration;
    if (message.isPlaying && activeDuration && activeDuration > 0) {
        const calculatedEnd = currentSongActivity.startTimestamp + (activeDuration * 1000);
        if (currentSongActivity.endTimestamp !== calculatedEnd) {
            currentSongActivity.endTimestamp = calculatedEnd;
            shouldUpdatePresence = true;
        }
    } else if (!message.isPlaying && currentSongActivity && currentSongActivity.endTimestamp) {
        delete currentSongActivity.endTimestamp;
        shouldUpdatePresence = true;
    }

    pendingActivity = currentSongActivity;
    updateStatus(currentStatus, statusErrorMessage, currentRpcUser, pendingActivity, nativeHostVersion, nativeHostVersionMismatch);

    if (shouldUpdatePresence) {
        if (isRpcReady && port) {
            _sendSetActivityToNativeHost(pendingActivity);
        } else {
            if (!port && !connectRetryTimeout) {
                connectToNativeHost();
            } else if (port && !isRpcReady && !connectRetryTimeout) {
                reconnectDiscordRpcOnly();
            }
        }
    }
}

function scheduleReconnect(reconnectFn = connectToNativeHost, useLongerDelays = false) {
    if (connectRetryTimeout) {
        console.log('Background: Reconnect already scheduled.');
        return;
    }

    let delay;
    if (useLongerDelays) {
        delay = Math.min(INITIAL_RECONNECT_DELAY * 2 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY * 2);
    } else {
        delay = Math.min(INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
    }
    
    console.log(`Background: Scheduling reconnect in ${delay / 1000}s (attempt ${reconnectAttempts + 1})`);

    connectRetryTimeout = setTimeout(() => {
        connectRetryTimeout = null;
        reconnectAttempts++;
        reconnectFn();
    }, delay);
}

function scheduleReconnectWithAggressiveBackoff(reconnectFn = connectToNativeHost) {
    if (connectRetryTimeout) {
        console.log('Background: Reconnect already scheduled.');
        return;
    }

    const AGGRESSIVE_INITIAL_DELAY = 2000; 
    const AGGRESSIVE_MAX_DELAY = 60000; 
    const delay = Math.min(AGGRESSIVE_INITIAL_DELAY * Math.pow(1.5, reconnectAttempts), AGGRESSIVE_MAX_DELAY);
    
    console.log(`Background: Scheduling aggressive reconnect in ${delay / 1000}s (attempt ${reconnectAttempts + 1})`);

    connectRetryTimeout = setTimeout(() => {
        connectRetryTimeout = null;
        reconnectAttempts++;
        reconnectFn();
    }, delay);
}

function reconnectDiscordRpcOnly() {
    if (port) {
        try {
            port.postMessage({ type: 'RECONNECT_RPC' });
            console.log('Background: Sent RECONNECT_RPC to native host.');
            isManuallyDisconnected = false;
        } catch (e) {
            console.warn('Background: Failed to send RECONNECT_RPC, will reconnect native host instead.', e.message);
            scheduleReconnect();
        }
    } else {
        scheduleReconnect();
    }
}

function processClearActivity(isPauseTimeout = false) {
  currentActivity = null;
  pendingActivity = null;
  if (!isPauseTimeout) {
      currentSongActivity = null;
      pausedTimestamp = null;
      pauseHideTargetTime = null;
      isPauseHidden = false;
      chrome.storage.local.set({ pausedTimestamp: null, pauseHideTargetTime: null, isPauseHidden: false });
      if (chrome.alarms) {
          chrome.alarms.clear('pauseHideAlarm');
      }
  }

  if (port) {
      if (connectRetryTimeout) {
          clearTimeout(connectRetryTimeout);
          connectRetryTimeout = null;
          console.log('Background: Cleared connectRetryTimeout due to clear activity.');
      }

      port.onDisconnect.removeListener(onPortDisconnectHandler);

      try {
          port.disconnect();
          console.log('Background: Native port disconnected on clear activity.');
      } catch (e) {
          console.warn("Background: Error disconnecting port during clear activity:", e.message);
      }
      port = null;
  }

  isRpcReady = false;
  isManuallyDisconnected = true;
  updateStatus('disconnected', isPauseTimeout ? 'Paused timeout active' : undefined, null, null, nativeHostVersion, nativeHostVersionMismatch);
}

function periodicConnectionCheck() {
    console.log(`Background (Periodic Check): Status: ${currentStatus}, Port: ${!!port}, RPC Ready: ${isRpcReady}, Retry Scheduled: ${!!connectRetryTimeout}, Manually Disconnected: ${isManuallyDisconnected}, PauseHidden: ${isPauseHidden}, UserDisconnected: ${userDisconnected}`);

    if (userDisconnected || isPauseHidden || isManuallyDisconnected) {
        console.log('Background (Periodic Check): Skipping periodic check due to manual disconnect or pause hide.');
        return;
    }

    if (!currentSongActivity && !pendingActivity) {
        console.log('Background (Periodic Check): Skipping periodic check because no song is playing.');
        return;
    }

    if (port && !isRpcReady && currentStatus === 'native_connected') {
        console.log('Background (Periodic Check): Native host connected, but RPC not ready. Attempting to reconnect RPC.');
        reconnectDiscordRpcOnly();
        return; 
    }

    if (!port && !connectRetryTimeout && (currentStatus === 'disconnected' || currentStatus === 'error' || currentStatus === 'native_connected')) {
        console.log('Background (Periodic Check): Detected native host disconnected/error/rpc-not-ready state with no active port or retry.');
        chrome.storage.local.get({ autoReconnectEnabled: true }, (result) => {
            if (result.autoReconnectEnabled) {
                console.log('Background (Periodic Check): Auto-reconnect is ON. Attempting to connect to native host.');
                connectToNativeHost();
            } else {
                console.log('Background: Auto-reconnect OFF. Not attempting connection via periodic check.');
            }
        });
        return;
    }

    if (port && !isRpcReady && !connectRetryTimeout) {
        if (currentStatus === 'rpc_ready') { 
            console.warn('Background (Periodic Check): Inconsistent state - currentStatus is rpc_ready but isRpcReady is false. Attempting to reconnect RPC.');
            reconnectDiscordRpcOnly();
        }
    }
}


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && (message.type === 'FORWARD_LOG_BATCH' || message.type === 'FORWARD_LOG')) {
    const tabLabel = sender && sender.tab && sender.tab.id ? `[Tab ${sender.tab.id}]` : '[Content]';
    if (message.type === 'FORWARD_LOG_BATCH' && Array.isArray(message.logs)) {
      for (const item of message.logs) {
        const level = item.level && typeof console[item.level] === 'function' ? item.level : 'log';
        const args = Array.isArray(item.args) ? item.args : [item.args];
        console[level](tabLabel, ...args);
      }
    } else if (message.type === 'FORWARD_LOG') {
      const level = message.level && typeof console[message.level] === 'function' ? message.level : 'log';
      const args = Array.isArray(message.args) ? message.args : [message.args];
      console[level](tabLabel, ...args);
    }
    if (sendResponse) sendResponse({ received: true });
    return false;
  }

  if (sender.tab && sender.tab.url && sender.tab.url.includes("music.youtube.com")) {
    console.log('[YTM RPC Background] Received message from YouTube Music tab:', {
      tabId: sender.tab.id,
      tabActive: sender.tab.active,
      type: message ? message.type : undefined,
      track: message ? message.track : undefined,
      artist: message ? message.artist : undefined,
      currentTime: message ? message.currentTime : undefined,
      duration: message ? message.duration : undefined,
      isPlaying: message ? message.isPlaying : undefined
    });

    if (!userDisconnected && message && message.isPlaying) {
        isManuallyDisconnected = false;
        isPauseHidden = false;
        chrome.storage.local.set({ isPauseHidden: false });
    }

    if (message && message.track && message.artist) {
      if (activeSessionRoomId && activeSessionRole !== 'NONE') {
        console.log(`[YTM RPC Background] Activity update [Listen Together ${activeSessionRole} in ${activeSessionRoomId}]: "${message.track}" by "${message.artist}"`);
      }
      processNewActivity(message);
      if (sendResponse) sendResponse({ status: "Activity info processed by background" });
      return false; 
    } else if (message && message.type === 'NO_TRACK') {
        console.log('[YTM RPC Background] NO_TRACK message received from tab. Clearing activity.');
        processClearActivity();
        if (sendResponse) sendResponse({ status: "No track detected, clear processed by background" });
        return false; 
    } else if (message && message.type === 'LISTEN_SESSION_UPDATE') {
        console.log(`[YTM RPC Background] Listen Together update: role=${message.role}, room=${message.roomId}, peers=${message.peerCount}`);
        activeSessionRole = message.role || 'NONE';
        activeSessionRoomId = message.roomId || null;
        activeSessionPeerCount = message.peerCount || 0;
        if (currentSongActivity) {
            if (activeSessionRoomId && activeSessionRole === 'HOST') {
                currentSongActivity.buttons = [
                    { label: "Listen Along", url: `https://fishyspop.github.io/Youtube-music-rich-presence/?ytm-session=${activeSessionRoomId}` },
                    { label: "Link", url: `https://music.youtube.com/search?q=${encodeURIComponent(`${currentSongActivity.state} ${currentSongActivity.details}`)}` }
                ];
                currentSongActivity.partyId = activeSessionRoomId;
                currentSongActivity.partySize = activeSessionPeerCount + 1;
                currentSongActivity.partyMax = 10;
            } else {
                currentSongActivity.buttons = [
                    { label: "Link", url: `https://music.youtube.com/search?q=${encodeURIComponent(`${currentSongActivity.state} ${currentSongActivity.details}`)}` },
                    { label: "GitHub", url: "https://github.com/FishysPop/Youtube-music-rich-presence" }
                ];
                delete currentSongActivity.party;
                delete currentSongActivity.partyId;
                delete currentSongActivity.partySize;
                delete currentSongActivity.partyMax;
            }
            if (isRpcReady && port) {
                _sendSetActivityToNativeHost(currentSongActivity);
            }
        }
        return false;
    } else if (message && message.type === 'LISTEN_SESSION_STATUS') {
        console.log(`[YTM RPC Background] Listen Together status: status=${message.status}, role=${message.role}, room=${message.roomId}, peers=${message.peerCount}`);
        activeSessionRole = message.role || 'NONE';
        activeSessionRoomId = message.roomId || null;
        activeSessionPeerCount = message.peerCount || 0;
        return false;
    }
  } else if (message && (message.type === 'START_LISTEN_SESSION' || message.type === 'JOIN_LISTEN_SESSION' || message.type === 'LEAVE_LISTEN_SESSION' || message.type === 'GET_LISTEN_SESSION_STATUS')) {
      chrome.tabs.query({ url: "*://music.youtube.com/*" }, (tabs) => {
          if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
              if (sendResponse) sendResponse({ success: false, role: 'NONE', error: 'No YouTube Music tab found.' });
              return;
          }
          const targetTab = tabs.find(t => t.active) || tabs[0];
          chrome.tabs.sendMessage(targetTab.id, message, (resp) => {
              const err = chrome.runtime.lastError;
              if (err) {
                  if (sendResponse) sendResponse({ success: false, role: 'NONE', error: err.message });
              } else {
                  if (sendResponse) sendResponse(resp || { success: true });
              }
          });
      });
      return true;
  } else if (message && message.type === 'GET_STATUS') { 
      const activityForPopup = pendingActivity || currentActivity || null;
      if (sendResponse) {
          sendResponse({
              type: 'STATUS_RESPONSE',
              status: currentStatus,
              errorMessage: statusErrorMessage,
              rpcUser: currentRpcUser,
              currentActivity: activityForPopup,
              nativeHostVersion: nativeHostVersion,
              nativeHostVersionMismatch: nativeHostVersionMismatch,
              nativeHostInstalled: nativeHostInstalled
          });
      }
      return true;
  } else if (message && message.type === 'RECONNECT_NATIVE_HOST') {
      isManuallyDisconnected = false;
      userDisconnected = false;
      isPauseHidden = false;
      chrome.storage.local.set({ userDisconnected: false, isPauseHidden: false, pauseHideTargetTime: null });
      if (chrome.alarms) {
          chrome.alarms.clear('pauseHideAlarm');
      }
      if (port) {
          try {
            port.onDisconnect.removeListener(onPortDisconnectHandler);
            port.disconnect();
          } catch (e) { console.warn("Background: Error disconnecting port during manual reconnect:", e.message); }
          port = null;
      }
      if (connectRetryTimeout) {
          clearTimeout(connectRetryTimeout);
          connectRetryTimeout = null;
      }
      isRpcReady = false;
      pendingActivity = currentActivity;
      updateStatus('disconnected', 'Manual reconnect requested.', null, pendingActivity, null, true);
      connectToNativeHost();
      if (sendResponse) sendResponse({ status: "Attempting to reconnect native host" });
      return true;
  } else if (message && message.type === 'DISCONNECT_NATIVE_HOST') {
    console.log('Background: Received DISCONNECT_NATIVE_HOST request.');
    if (port) {
        if (connectRetryTimeout) {
            clearTimeout(connectRetryTimeout);
            connectRetryTimeout = null;
            console.log('Background: Cleared connectRetryTimeout due to manual disconnect.');
        }

        port.onDisconnect.removeListener(onPortDisconnectHandler);

        try {
            port.disconnect();
            console.log('Background: Native port disconnected manually.');
        } catch (e) {
            console.warn("Background: Error disconnecting port during manual disconnect:", e.message);
        }
        port = null;
    }

    isRpcReady = false;
    isManuallyDisconnected = true;
    userDisconnected = true;
    chrome.storage.local.set({ userDisconnected: true });
    if (!pendingActivity && currentActivity) {
        pendingActivity = currentActivity;
    }
    updateStatus('disconnected', 'Manually disconnected by user.', null, pendingActivity, null, false);
    if (sendResponse) sendResponse({ status: "Native host disconnect initiated and state updated" });
    return true;
  } else if (message && message.type === 'GATEWAY_JOIN_SESSION') {
      const senderTabId = sender && sender.tab ? sender.tab.id : null;
      handleGatewayJoinSession(message.roomId, senderTabId, sendResponse);
      return true;
  } else if (message && message.type === 'OPEN_OPTIONS_PAGE') {
      chrome.runtime.openOptionsPage();
      if (sendResponse) sendResponse({ status: "Options page open request sent" });
      return true;
  } else {
  }
  return false;
});

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

function handleGatewayJoinSession(roomId, senderTabId, sendResponse) {
  const normalizedRoomId = parseSessionInput(roomId) || (typeof roomId === 'string' ? roomId.trim().toUpperCase() : null);
  if (!normalizedRoomId) {
    if (sendResponse) sendResponse({ success: false, error: 'Missing or invalid room ID' });
    return;
  }

  const isSelfHost = (activeSessionRole === 'HOST' && activeSessionRoomId === normalizedRoomId);
  const isAlreadyListening = (activeSessionRole === 'LISTENER' && activeSessionRoomId === normalizedRoomId);

  chrome.tabs.query({ url: "*://music.youtube.com/*" }, (tabs) => {
    if (chrome.runtime.lastError) {
      if (sendResponse) sendResponse({ success: false, error: chrome.runtime.lastError.message });
      return;
    }

    const existingTabs = (tabs || []).filter(t => !senderTabId || t.id !== senderTabId);

    if (existingTabs.length > 0) {
      const targetTab = existingTabs.find(t => t.active) || existingTabs[0];
      chrome.tabs.update(targetTab.id, { active: true }, () => {
        if (targetTab.windowId) {
          chrome.windows.update(targetTab.windowId, { focused: true }).catch(() => {});
        }
        if (isSelfHost) {
          chrome.tabs.sendMessage(targetTab.id, {
            type: 'SHOW_TOAST',
            message: `You are already hosting session ${normalizedRoomId}`
          }, () => { if (chrome.runtime.lastError) {} });
        } else if (isAlreadyListening) {
          chrome.tabs.sendMessage(targetTab.id, {
            type: 'SHOW_TOAST',
            message: `Already connected to session ${normalizedRoomId}`
          }, () => { if (chrome.runtime.lastError) {} });
        } else {
          chrome.tabs.sendMessage(targetTab.id, { type: 'JOIN_LISTEN_SESSION', roomId: normalizedRoomId }, () => {
            if (chrome.runtime.lastError) {}
          });
        }
        if (senderTabId) {
          chrome.tabs.remove(senderTabId).catch(() => {});
        }
        if (sendResponse) {
          sendResponse({
            success: true,
            action: isSelfHost ? 'ALREADY_HOST' : (isAlreadyListening ? 'ALREADY_LISTENING' : 'FOCUSED_EXISTING'),
            tabId: targetTab.id
          });
        }
      });
    } else {
      if (isSelfHost || isAlreadyListening) {
        chrome.tabs.create({ url: 'https://music.youtube.com/', active: true }, (newTab) => {
          if (senderTabId) {
            chrome.tabs.remove(senderTabId).catch(() => {});
          }
          if (sendResponse) sendResponse({ success: true, action: 'OPENED_YTM', tabId: newTab ? newTab.id : null });
        });
      } else {
        chrome.storage.local.set({ __ytm_pending_session: normalizedRoomId });
        chrome.tabs.create({ url: `https://music.youtube.com/?ytm-session=${normalizedRoomId}`, active: true }, (newTab) => {
          if (senderTabId) {
            chrome.tabs.remove(senderTabId).catch(() => {});
          }
          if (sendResponse) sendResponse({ success: true, action: 'CREATED_NEW', tabId: newTab ? newTab.id : null });
        });
      }
    }
  });
}

if (chrome.runtime.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'GATEWAY_JOIN_SESSION') {
      const senderTabId = sender && sender.tab ? sender.tab.id : null;
      handleGatewayJoinSession(message.roomId, senderTabId, sendResponse);
      return true;
    }
    return false;
  });
}

if (chrome.tabs && chrome.tabs.onCreated) {
  chrome.tabs.onCreated.addListener((tab) => {
    const targetUrl = tab.pendingUrl || tab.url;
    if (!targetUrl || !targetUrl.includes('fishyspop.github.io')) return;
    const sessionMatch = targetUrl.match(/[?#&](?:ytm-session|session)=([a-zA-Z0-9_-]+)/i);
    if (sessionMatch && sessionMatch[1]) {
      handleGatewayJoinSession(sessionMatch[1].toUpperCase(), tab.id);
    }
  });
}

if (chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const targetUrl = changeInfo.url || (changeInfo.status === 'loading' ? tab.url : null);
    if (!targetUrl) return;

    const roomId = parseSessionInput(targetUrl);
    if (!roomId) return;

    if (targetUrl.includes('fishyspop.github.io')) {
      handleGatewayJoinSession(roomId, tabId);
      return;
    }

    if (targetUrl.includes('music.youtube.com')) {
      const isSelfHost = (activeSessionRole === 'HOST' && activeSessionRoomId === roomId);
      const isAlreadyListening = (activeSessionRole === 'LISTENER' && activeSessionRoomId === roomId);

      chrome.tabs.query({ url: "*://music.youtube.com/*" }, (allTabs) => {
        if (chrome.runtime.lastError || !allTabs) return;

        const otherTabs = allTabs.filter(t => t.id !== tabId);
        if (otherTabs.length > 0) {
          const existingTab = otherTabs.find(t => t.active) || otherTabs[0];
          chrome.tabs.update(existingTab.id, { active: true }, () => {
            if (existingTab.windowId) {
              chrome.windows.update(existingTab.windowId, { focused: true }).catch(() => {});
            }
            if (isSelfHost) {
              chrome.tabs.sendMessage(existingTab.id, {
                type: 'SHOW_TOAST',
                message: `You are already hosting session ${roomId}`
              }, () => { if (chrome.runtime.lastError) {} });
            } else if (isAlreadyListening) {
              chrome.tabs.sendMessage(existingTab.id, {
                type: 'SHOW_TOAST',
                message: `Already connected to session ${roomId}`
              }, () => { if (chrome.runtime.lastError) {} });
            } else {
              chrome.tabs.sendMessage(existingTab.id, { type: 'JOIN_LISTEN_SESSION', roomId: roomId }, () => {
                if (chrome.runtime.lastError) {}
              });
            }
            chrome.tabs.remove(tabId).catch(() => {});
          });
        } else if (!isSelfHost && !isAlreadyListening) {
          chrome.storage.local.set({ __ytm_pending_session: roomId });
        }
      });
    }
  });
}

function reInjectContentScripts() {
  chrome.tabs.query({ url: "*://music.youtube.com/*" }, (tabs) => {
    if (chrome.runtime.lastError) {
      console.warn("Background: Error querying YouTube Music tabs for re-injection:", chrome.runtime.lastError.message);
      return;
    }
    if (tabs && tabs.length > 0) {
      console.log(`Background: Found ${tabs.length} YouTube Music tab(s) to re-inject content script.`);
      tabs.forEach((tab) => {
        if (tab.id) {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['page-bridge.js'],
            world: 'MAIN'
          }).catch(() => {});

          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['log-forwarder.js', 'webrtc-sync.js', 'content.js']
          }).then(() => {
            console.log(`Background: Successfully re-injected content scripts into tab ${tab.id}.`);
          }).catch(err => {
            if (!err.message.toLowerCase().includes('frame with id 0 was not found') && 
                !err.message.toLowerCase().includes('cannot access a chrome extension url') &&
                !err.message.toLowerCase().includes('cannot access contents of url')) {
                 console.warn(`Background: Failed to re-inject content script into tab ${tab.id}:`, err.message);
            }
          });
        }
      });
    } else {
      console.log("Background: No active YouTube Music tabs found for content script re-injection.");
    }
  });
}

function verifyNativeHostOnInstall() {
  isVerifyingInstall = true;
  connectToNativeHost();
}

chrome.runtime.onInstalled.addListener((details) => {
  console.log('Background: Extension installed or updated:', details.reason);
  currentActivity = null;
  pendingActivity = null;
  isManuallyDisconnected = false;
  userDisconnected = false;
  isPauseHidden = false;
  currentSongActivity = null;
  pausedTimestamp = null;
  chrome.storage.local.set({ userDisconnected: false, isPauseHidden: false, pausedTimestamp: null, pauseHideTargetTime: null });
  setupPeriodicAlarm();
  verifyNativeHostOnInstall();
  reInjectContentScripts(); 
});

chrome.runtime.onStartup.addListener(() => {
  console.log('Background: Browser started.');
  currentActivity = null;
  pendingActivity = null;
  setupPeriodicAlarm();
  chrome.storage.local.get({
    userDisconnected: false,
    isPauseHidden: false,
    pausedTimestamp: null,
    pauseHideTargetTime: null
  }, (res) => {
    userDisconnected = res.userDisconnected;
    isPauseHidden = res.isPauseHidden;
    pausedTimestamp = res.pausedTimestamp;
    pauseHideTargetTime = res.pauseHideTargetTime;
  });
  reInjectContentScripts(); 
});

function checkOpenYtmTabs() {
  chrome.tabs.query({ url: "*://music.youtube.com/*" }, (tabs) => {
    if (chrome.runtime.lastError) return;
    if (!tabs || tabs.length === 0) {
      console.log('Background: No YouTube Music tabs open. Clearing activity.');
      processClearActivity();
    }
  });
}

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  checkOpenYtmTabs();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && !changeInfo.url.includes("music.youtube.com")) {
    checkOpenYtmTabs();
  }
});

setupPeriodicAlarm();
reInjectContentScripts();

if (periodicCheckIntervalId) {
    clearInterval(periodicCheckIntervalId);
}
console.log('Background: YouTube Music Rich Presence background script initialized.');
