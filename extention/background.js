const nativeHostName = 'com.fishypop.ytmusic_rpc';

let port = null;
let connectRetryTimeout = null;

// --- State Management ---
let currentStatus = 'disconnected'; // Overall status: disconnected, connecting_native, native_connected, rpc_ready, error
let statusErrorMessage = null;
let currentActivity = null; // Last known activity (from content script or confirmed by native host)
let currentRpcUser = null;
let isRpcReady = false; // True if native host reports RPC is connected/ready
let pendingActivity = null; // Activity data waiting to be sent when RPC is ready

/**
 * Updates the internal state and notifies the popup.
 * @param {string} newStatus - The new primary status.
 * @param {string|undefined} errorMessage - Optional error message. If undefined, existing message may persist. If null, clears.
 * @param {object|null|undefined} rpcUser - Optional Discord user object. If undefined, existing user persists. If null, clears.
 * @param {object|null|undefined} overridePopupActivity - Optional. If provided, this activity object (or null) will be sent to the popup
 *                                                      as 'currentActivity' for THIS specific status update, overriding the global currentActivity.
 */
function updateStatus(newStatus, errorMessage = undefined, rpcUser = undefined, overridePopupActivity = undefined) {
    // console.log(`Background: updateStatus called. New Status: ${newStatus}, Error: ${errorMessage}, User: ${rpcUser ? rpcUser.username : 'none'}, Override Popup Activity: ${overridePopupActivity !== undefined ? (overridePopupActivity ? overridePopupActivity.details : 'null') : 'not overridden'}`);

    currentStatus = newStatus;

    if (errorMessage !== undefined) { // Explicitly passed (null or string)
        statusErrorMessage = errorMessage;
    }
    if (rpcUser !== undefined) { // Explicitly passed (null or object)
        currentRpcUser = rpcUser;
    }
    // DO NOT modify global currentActivity here based on overridePopupActivity.
    // global currentActivity is updated by processNewActivity or native host responses.

    // If status implies success, clear error message if not explicitly set
    if ((newStatus === 'rpc_ready' || newStatus === 'native_connected') && errorMessage === undefined) {
        statusErrorMessage = null;
    }
    if (newStatus === 'rpc_ready' && rpcUser === undefined && currentRpcUser === null) {
        // console.warn("Background: updateStatus to rpc_ready without rpcUser, but currentRpcUser is null.")
    }

    // Determine what activity to show in the popup for THIS update
    // If overridePopupActivity is explicitly passed (even if null), use it. Otherwise, use the global currentActivity.
    const activityForThisPopupUpdate = overridePopupActivity !== undefined ? overridePopupActivity : currentActivity;

    chrome.runtime.sendMessage({
        type: 'STATUS_UPDATE',
        status: currentStatus,
        errorMessage: statusErrorMessage,
        rpcUser: currentRpcUser,
        currentActivity: activityForThisPopupUpdate
    }).catch(err => {
        if (!err.message.includes("Receiving end does not exist")) {
            // console.warn('Background: Error sending status update to popup:', err.message);
        }
    });
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
        updateStatus('disconnected', `Port Error: ${error.message}`, null, pendingActivity || currentActivity);

        if (!connectRetryTimeout) {
            console.log('Background: Scheduling native host reconnect due to port error in 5s.');
            connectRetryTimeout = setTimeout(() => {
                connectRetryTimeout = null;
                connectToNativeHost();
            }, 5000);
        }
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
    updateStatus('disconnected', disconnectMsg, null, pendingActivity || currentActivity);

    if (!connectRetryTimeout) {
        console.log('Background: Will attempt to reconnect to native host in 5 seconds (onPortDisconnect).');
        connectRetryTimeout = setTimeout(() => {
            connectRetryTimeout = null;
            connectToNativeHost();
        }, 5000);
    } else {
        console.log('Background: A reconnect attempt is already scheduled.');
    }
};

function connectToNativeHost() {
  if (port) {
    if (currentStatus === 'disconnected' || currentStatus === 'error') {
         updateStatus('connecting_native', undefined, null, pendingActivity || currentActivity);
    }
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
        // console.log("Background: Received message from native host:", message);
        if (message.type === 'NATIVE_HOST_STARTED') {
            console.log('Background: Native host confirmed it has started. Waiting for RPC status.');
            updateStatus('native_connected', null, null, pendingActivity || currentActivity);
        } else if (message.type === 'RPC_STATUS_UPDATE') {
            if (message.status === 'connected') {
                console.log('Background: Native host reported Discord RPC is ready (connected). User:', message.user);
                isRpcReady = true;
                // When RPC connects, send pendingActivity. Popup should reflect this pending activity.
                updateStatus('rpc_ready', undefined, message.user, pendingActivity || currentActivity);
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
                updateStatus('native_connected', 'Discord RPC disconnected by native host.', null, pendingActivity || currentActivity);
            }
        } else if (message.type === 'RPC_ERROR') {
            console.error('Background: Received RPC_ERROR from native host:', message.message, message.errorDetails || '');
            isRpcReady = false;
            updateStatus('native_connected', `RPC Error: ${message.message || 'Unknown RPC error'}`, null, pendingActivity || currentActivity);
        } else if (message.type === 'ACTIVITY_STATUS') {
            console.log('Background: Received ACTIVITY_STATUS:', message);
            switch (message.status) {
                case 'success':
                    // Native host confirmed an activity was set. This is the new authoritative currentActivity.
                    currentActivity = message.activity;
                    if (pendingActivity &&
                        message.activity &&
                        pendingActivity.details === message.activity.details &&
                        pendingActivity.state === message.activity.state &&
                        pendingActivity.startTimestamp === message.activity.startTimestamp) {
                        pendingActivity = null;
                    }
                    // Popup should see the activity that was just confirmed by the native host.
                    updateStatus('rpc_ready', undefined, currentRpcUser, currentActivity);
                    break;
                case 'cleared':
                    currentActivity = null;
                    pendingActivity = null;
                    updateStatus('rpc_ready', undefined, currentRpcUser, null); // Override popup to show cleared
                    break;
                case 'error_rpc_not_ready':
                    isRpcReady = false;
                    updateStatus('native_connected', message.message, currentRpcUser, pendingActivity || currentActivity);
                    break;
                case 'error':
                case 'clear_error':
                    isRpcReady = false;
                    updateStatus('native_connected', message.message, null, pendingActivity || currentActivity);
                    break;
                default:
                    console.warn('Background: Received unknown ACTIVITY_STATUS status:', message.status);
                    break;
            }
        } else if (message.type === 'NATIVE_HOST_ERROR') {
            console.error('Background: Received NATIVE_HOST_ERROR from native host:', message.message);
            isRpcReady = false;
            updateStatus('error', `Native Host Error: ${message.message || 'Unknown error'}`, null, pendingActivity || currentActivity);
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
    updateStatus('disconnected', `Connection Error: ${error.message}`, null, pendingActivity || currentActivity);

    if (!connectRetryTimeout) {
      console.log('Background: Will attempt to reconnect to native host (due to connection error) in 10 seconds.');
      connectRetryTimeout = setTimeout(() => {
        connectRetryTimeout = null;
        connectToNativeHost();
      }, 10000);
    }
  }
}

function processNewActivity(activityData) {
  // console.log("Background: processNewActivity called with:", activityData, "Current isRpcReady:", isRpcReady);
  currentActivity = activityData; // New song from content script becomes the current one
  pendingActivity = activityData; // This is the new desired state to send to native host

  // Update UI to reflect new song, even if RPC isn't ready yet.
  // Pass pendingActivity as the overridePopupActivity, so popup shows the latest intended state.
  updateStatus(currentStatus, statusErrorMessage, currentRpcUser, pendingActivity);

  if (isRpcReady && port) {
    _sendSetActivityToNativeHost(pendingActivity);
  } else {
    console.log('Background: RPC not ready or port not connected. Activity is pending.');
    if (!port && !connectRetryTimeout) {
        console.log('Background: Port not connected and no retry scheduled. Attempting to connect native host.');
        connectToNativeHost();
    }
  }
}

function processClearActivity() {
  // console.log("Background: processClearActivity. Current isRpcReady:", isRpcReady);
  currentActivity = null; // No track is playing
  pendingActivity = null; // Clear any pending song activity; intent is to clear on Discord

  // Update UI to reflect no song. Pass null to overridePopupActivity.
  updateStatus(currentStatus, statusErrorMessage, currentRpcUser, null);

  if (isRpcReady && port) {
    _sendClearActivityToNativeHost();
  } else {
    console.log('Background: RPC not ready or port not connected for clear. Will clear when RPC is ready.');
    if (!port && !connectRetryTimeout) {
        console.log('Background: Port not connected and no retry scheduled for clear. Attempting to connect native host.');
        connectToNativeHost();
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // --- DIAGNOSTIC LOG 1 ---
  console.log("Background: Received message in onMessage listener. Message:", JSON.stringify(message), "Sender Tab URL:", sender.tab ? sender.tab.url : "N/A", "Sender ID:", sender.id);

  if (sender.tab && sender.tab.url && sender.tab.url.includes("music.youtube.com")) {
    // --- DIAGNOSTIC LOG 2 ---
    console.log("Background: Message IS from a YouTube Music tab.");

    if (message && message.track && message.artist) { // Added 'message &&' for safety
      // --- DIAGNOSTIC LOG 3 ---
      console.log("Background: Message contains track and artist. Processing new activity.");
      const activity = {
        details: message.track,
        state: `by ${message.artist}`,
        startTimestamp: message.startTimestamp || Math.floor(Date.now() / 1000),
        largeImageKey: 'ytm_logo_new',
        largeImageText: 'YouTube Music',
        smallImageKey: 'play',
        smallImageText: 'Playing',
      };
      processNewActivity(activity);
      if (sendResponse) sendResponse({ status: "Activity info processed by background" });
      return false; // Synchronous response
    } else if (message && message.type === 'NO_TRACK') { // Added 'message &&' for safety
        // --- DIAGNOSTIC LOG 4 ---
        console.log("Background: Message is NO_TRACK. Processing clear activity.");
        processClearActivity();
        if (sendResponse) sendResponse({ status: "No track detected, clear processed by background" });
        return false; // Synchronous response
    } else {
        // --- DIAGNOSTIC LOG 5 ---
        console.warn("Background: Message from YouTube Music tab, but not recognized track/artist or NO_TRACK. Message:", JSON.stringify(message));
    }
  } else if (message && message.type === 'GET_STATUS') { // Added 'message &&' for safety
      // --- DIAGNOSTIC LOG 6 ---
      console.log("Background: Message is GET_STATUS.");
      const activityForPopup = pendingActivity || currentActivity || null;
      if (sendResponse) {
          sendResponse({
              type: 'STATUS_RESPONSE',
              status: currentStatus,
              errorMessage: statusErrorMessage,
              rpcUser: currentRpcUser,
              currentActivity: activityForPopup
          });
      }
      return true; // Asynchronous response
  } else if (message && message.type === 'RECONNECT_NATIVE_HOST') { // Added 'message &&' for safety
      // --- DIAGNOSTIC LOG 7 ---
      console.log("Background: Message is RECONNECT_NATIVE_HOST.");
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
      pendingActivity = currentActivity; // Preserve current activity as pending
      updateStatus('disconnected', 'Manual reconnect requested.', null, pendingActivity);
      connectToNativeHost();
      if (sendResponse) sendResponse({ status: "Attempting to reconnect native host" });
      return true; // Asynchronous response
  } else if (message && message.type === 'OPEN_OPTIONS_PAGE') { // Added 'message &&' for safety
      // --- DIAGNOSTIC LOG 8 ---
      console.log("Background: Message is OPEN_OPTIONS_PAGE.");
      chrome.runtime.openOptionsPage();
      if (sendResponse) sendResponse({ status: "Options page open request sent" });
      return true; // Asynchronous response
  } else {
    // --- DIAGNOSTIC LOG 9 ---
    console.warn("Background: Message not from YouTube Music tab or not a recognized type. Sender Tab URL:", sender.tab ? sender.tab.url : "N/A", "Message Type:", message ? message.type : "N/A", "Full Message:", JSON.stringify(message));
  }
  // Default return false if not handled by an async case or if sendResponse wasn't used.
  // If sendResponse was called synchronously above, this return false is fine.
  return false;
});

chrome.runtime.onInstalled.addListener((details) => {
  console.log('Background: Extension installed or updated:', details.reason);
  currentActivity = null;
  pendingActivity = null;
  connectToNativeHost();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('Background: Browser started.');
  currentActivity = null;
  pendingActivity = null;
  connectToNativeHost();
});

// Initial connection attempt when the background script loads
connectToNativeHost();
console.log('Background: YouTube Music Rich Presence background script initialized.');
