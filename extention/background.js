const nativeHostName = 'com.fishypop.ytmusic_rpc';
const REQUIRED_NATIVE_HOST_VERSION = "1.0.0"; 

let port = null;
let connectRetryTimeout = null;
let periodicCheckIntervalId = null;
const PERIODIC_CHECK_INTERVAL = 1200000;

// --- Dynamic Reconnection Timer ---
let reconnectAttempts = 0;
const INITIAL_RECONNECT_DELAY = 5000; // 5 seconds
const MAX_RECONNECT_DELAY = 180000; // 3 minutes

// --- State Management ---
let currentStatus = 'disconnected'; // Overall status: disconnected, connecting_native, native_connected, rpc_ready, error
let statusErrorMessage = null;
let currentActivity = null; 
let currentRpcUser = null;
let isRpcReady = false; 
let pendingActivity = null; 
let isManuallyDisconnected = false; 
let nativeHostVersion = null; 
let nativeHostVersionMismatch = false; 

let currentSongActivity = null; 
let pausedTimestamp = null; 
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
        nativeHostVersionMismatch: nativeHostVersionMismatch
    }).catch(err => {
        if (!err.message.includes("Receiving end does not exist")) {
            console.warn("Background: Error sending STATUS_UPDATE to popup, likely no popup open:", err.message);
        }
    });

    if (newStatus === 'disconnected' || newStatus === 'error') {
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
        console.warn('Background: Attempted to send SET_ACTIVITY, but native host port is not connected.');
        return;
    }
    try {
        port.postMessage({ type: 'SET_ACTIVITY', data: activityData });
        console.log('Background: Sent SET_ACTIVITY to native host:', activityData);
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
    updateStatus('disconnected', disconnectMsg, null, pendingActivity || currentActivity, null, false); // Clear version and reset mismatch on disconnection

    chrome.storage.local.get({ autoReconnectEnabled: true }, (result) => {
        if (result.autoReconnectEnabled) {
            if (isManuallyDisconnected) {
                console.log('Background: Auto-reconnect skipped due to manual disconnect.');
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

  if (isManuallyDisconnected) {
      console.log('Background: Not attempting to connect to native host because it was manually disconnected.');
      updateStatus('disconnected', 'Manually disconnected by user.', null, pendingActivity || currentActivity);
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
            updateStatus('native_connected', null, null, pendingActivity || currentActivity, message.version, versionMismatch);
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
                        console.log('Background: Auto-reconnect ON. Scheduling RPC reconnect due to RPC disconnect.');
                        scheduleReconnect(reconnectDiscordRpcOnly); // Use the backoff mechanism
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
                    console.log('Background: Auto-reconnect ON. Scheduling RPC reconnect due to RPC error.');
                    if (message.errorType === 'AUTHENTICATION_ERROR') {
                        console.log('Background: Authentication error detected. Using longer retry delays.');
                        scheduleReconnect(reconnectDiscordRpcOnly, true)
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
                    break;
                case 'error':
                case 'clear_error':
                    isRpcReady = false;
                    updateStatus('native_connected', message.message, null, pendingActivity || currentActivity, nativeHostVersion, nativeHostVersionMismatch);
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

function processNewActivity(message) {
    if (!currentSongActivity || currentSongActivity.details !== message.track || currentSongActivity.state !== message.artist) {
        currentSongActivity = {
            details: message.track,
            state: message.artist,
            largeImageKey: message.albumArtUrl ? message.albumArtUrl.replace(/w\d+-h\d+/, 'w512-h512') : null, // Increase resolution
            largeImageText: message.albumArtUrl ? `${message.track} - ${message.artist}` : 'YouTube Music',
            smallImageKey: 'play',
            smallImageText: 'Playing',
            albumArtUrl: message.albumArtUrl || null,
            buttons: [
                { label: "Link", url: `https://music.youtube.com/search?q=${encodeURIComponent(`${message.artist} ${message.track}`)}` },
                { label: "GitHub", url: "https://github.com/FishysPop/Youtube-music-rich-presence" }
            ],
            statusDisplayType : 2,
            type: 2
        };
        currentSongActivity.startTimestamp = Math.floor(Date.now()) - (message.currentTime * 1000);
        pausedTimestamp = null;
    } else if (message.currentTime !== undefined) {
        const expectedCurrentTime = (Math.floor(Date.now()) - currentSongActivity.startTimestamp) / 1000;
        const timeDifference = Math.abs(message.currentTime - expectedCurrentTime);
        
        if (timeDifference > 2) {
            currentSongActivity.startTimestamp = Math.floor(Date.now()) - (message.currentTime * 1000);
        }
    }

    if (!message.isPlaying && pausedTimestamp === null) { 
        pausedTimestamp = Math.floor(Date.now());
        delete currentSongActivity.endTimestamp;
        currentSongActivity.smallImageKey = 'https://cdn.rcd.gg/PreMiD/resources/pause.png';
        currentSongActivity.smallImageText = 'Paused';
    } else if (message.isPlaying && pausedTimestamp !== null) { 
        const pauseDuration = Math.floor(Date.now()) - pausedTimestamp;
        currentSongActivity.startTimestamp += pauseDuration;
        pausedTimestamp = null;
        currentSongActivity.smallImageKey = 'play';
        currentSongActivity.smallImageText = 'Playing';
    }

    if (message.isPlaying && message.duration) {
        currentSongActivity.endTimestamp = currentSongActivity.startTimestamp + (message.duration * 1000);
    } else if (!message.isPlaying && currentSongActivity && currentSongActivity.endTimestamp) {
        delete currentSongActivity.endTimestamp;
    }

    pendingActivity = currentSongActivity;
    updateStatus(currentStatus, statusErrorMessage, currentRpcUser, pendingActivity, nativeHostVersion, nativeHostVersionMismatch);

    if (isRpcReady && port) {
        _sendSetActivityToNativeHost(pendingActivity);
    } else {
        console.log('Background: RPC not ready or port not connected. Activity is pending.');
        if (!port && !connectRetryTimeout) {
            if (isManuallyDisconnected) {
                console.log('Background: Not attempting to connect to native host because it was manually disconnected.');
                return;
            }
            console.log('Background: Port not connected and no retry scheduled. Attempting to connect native host.');
            connectToNativeHost();
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
        } catch (e) {
            console.warn('Background: Failed to send RECONNECT_RPC, will reconnect native host instead.', e.message);
            scheduleReconnect();
        }
    } else {
        scheduleReconnect();
    }
}

function processClearActivity() {
  currentActivity = null; 
  pendingActivity = null;
  currentSongActivity = null; 
  pausedTimestamp = null; 

  updateStatus(currentStatus, statusErrorMessage, currentRpcUser, null, nativeHostVersion, nativeHostVersionMismatch);

  if (isRpcReady && port) {
    _sendClearActivityToNativeHost();
  } else {
    console.log('Background: RPC not ready or port not connected for clear. Will clear when RPC is ready.');
    if (!port && !connectRetryTimeout) {
        if (isManuallyDisconnected) {
            console.log('Background: Not attempting to connect to native host because it was manually disconnected.');
            return;
        }
        console.log('Background: Port not connected and no retry scheduled for clear. Attempting to connect native host.');
        connectToNativeHost();
    }
  }
}

function periodicConnectionCheck() {
    console.log(`Background (Periodic Check): Status: ${currentStatus}, Port: ${!!port}, RPC Ready: ${isRpcReady}, Retry Scheduled: ${!!connectRetryTimeout}, Manually Disconnected: ${isManuallyDisconnected}`);

    if (isManuallyDisconnected) {
        console.log('Background (Periodic Check): Skipping periodic check due to manual disconnect.');
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
  if (sender.tab && sender.tab.url && sender.tab.url.includes("music.youtube.com")) {
    isManuallyDisconnected = false;
    if (message && message.track && message.artist) {
      processNewActivity(message);
      if (sendResponse) sendResponse({ status: "Activity info processed by background" });
      return false; 
    } else if (message && message.type === 'NO_TRACK') {
        processClearActivity();
        if (sendResponse) sendResponse({ status: "No track detected, clear processed by background" });
        return false; 
    } else {
    }
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
              nativeHostVersionMismatch: nativeHostVersionMismatch
          });
      }
      return true;
  } else if (message && message.type === 'RECONNECT_NATIVE_HOST') {
      isManuallyDisconnected = false;
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
    if (!pendingActivity && currentActivity) {
        pendingActivity = currentActivity;
    }
    updateStatus('disconnected', 'Manually disconnected by user.', null, pendingActivity, null, true);
    if (sendResponse) sendResponse({ status: "Native host disconnect initiated and state updated" });
    return true;
  } else if (message && message.type === 'OPEN_OPTIONS_PAGE') {
      chrome.runtime.openOptionsPage();
      if (sendResponse) sendResponse({ status: "Options page open request sent" });
      return true;
  } else {
  }
  return false;
});

function reInjectContentScripts() {
  chrome.tabs.query({ url: "*://music.youtube.com/*", status: "complete" }, (tabs) => {
    if (chrome.runtime.lastError) {
      console.warn("Background: Error querying YouTube Music tabs for re-injection:", chrome.runtime.lastError.message);
      return;
    }
    if (tabs && tabs.length > 0) {
      console.log(`Background: Found ${tabs.length} YouTube Music tab(s) to potentially re-inject content script.`);
      tabs.forEach((tab) => {
        if (tab.id) {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          }).then(() => {
            console.log(`Background: Successfully re-injected content script into tab ${tab.id} (${tab.url ? tab.url.substring(0, 50) + '...' : 'URL not available'}).`);
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
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Background: Extension installed or updated:', details.reason);
  currentActivity = null;
  pendingActivity = null;
  isManuallyDisconnected = false; 
  currentSongActivity = null;
  pausedTimestamp = null; 
  connectToNativeHost();
  reInjectContentScripts(); 
});

chrome.runtime.onStartup.addListener(() => {
  console.log('Background: Browser started.');
  currentActivity = null;
  pendingActivity = null;
  isManuallyDisconnected = false; 
  currentSongActivity = null;
  pausedTimestamp = null; 
  connectToNativeHost();
  reInjectContentScripts(); 
});

connectToNativeHost();

if (periodicCheckIntervalId) {
    clearInterval(periodicCheckIntervalId);
}
periodicCheckIntervalId = setInterval(periodicConnectionCheck, PERIODIC_CHECK_INTERVAL);
console.log('Background: YouTube Music Rich Presence background script initialized.');
