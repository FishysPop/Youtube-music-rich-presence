document.addEventListener("DOMContentLoaded", () => {
let errorLogs = [];
function addToLog(msg) {
  const timestamp = new Date().toLocaleTimeString();
  errorLogs.push(`[${timestamp}] ${msg}`);
  if (errorLogs.length > 50) errorLogs.shift();
}
const origError = console.error;
console.error = function(...args) {
  addToLog(args.join(' '));
  origError.apply(console, args);
};
const origWarn = console.warn;
console.warn = function(...args) {
  addToLog(args.join(' '));
  origWarn.apply(console, args);
};

const openOptionsButton = document.getElementById("openOptionsButton");
const optionsPanel = document.getElementById("optionsPanel");
const logContent = document.getElementById("logContent");
const hideOptionsButton = document.getElementById("hideOptionsButton");
  const autoReconnectCheckbox = document.getElementById("autoReconnectCheckbox");

if (openOptionsButton && optionsPanel && logContent && hideOptionsButton) {
  openOptionsButton.addEventListener("click", () => {
    if (optionsPanel.style.display === "block") {
      optionsPanel.style.display = "none";
    } else {
      logContent.textContent = errorLogs.join("\n") || "No errors yet.";
      optionsPanel.style.display = "block";
      logContent.scrollTop = logContent.scrollHeight; 
    }
  });
  hideOptionsButton.addEventListener("click", () => {
    optionsPanel.style.display = "none";
  });
}

  if (autoReconnectCheckbox) {
    chrome.storage.local.get({ autoReconnectEnabled: true }, (result) => {
      autoReconnectCheckbox.checked = result.autoReconnectEnabled;
    });

    autoReconnectCheckbox.addEventListener("change", () => {
      const enabled = autoReconnectCheckbox.checked;
      chrome.storage.local.set({ autoReconnectEnabled: enabled }, () => {
        console.log(`Popup: Auto Reconnect set to ${enabled}`);
      });
    });
  }

}
);
  const nativeHostStatusElement = document.getElementById("nativeHostStatus");
  const rpcStatusElement = document.getElementById("rpcStatus");
  const rpcUserElement = document.getElementById("rpcUser");
  const currentSongElement = document.getElementById("currentSong");
  const reconnectButton = document.getElementById("reconnectButton");
  const nativeHostWarningElement = document.getElementById("nativeHostWarning");

  function updatePopupUI(
    status,
    errorMessage = null,
    rpcUser = null,
    currentActivity = null,
    response = {} // Add response object as a parameter
  ) {
    console.log(
      "[POPUP_DEBUG] updatePopupUI called with currentActivity:",
      currentActivity,
      "Status:",
      status
    );
    let nativeHostStatusText = "Unknown";
    let rpcStatusText = "Unknown";
    let nativeHostStatusClass = "status-unknown";
    let rpcStatusClass = "status-unknown";
    let songInfoText = "Waiting for music...";
    let rpcUserText = "\u00A0";
    
    // Always hide warning by default, will be shown if needed later
    nativeHostWarningElement.style.display = 'none';
    nativeHostWarningElement.innerHTML = ''; // Clear previous message

    reconnectButton.disabled = false;

    switch (status) {
      case "disconnected":
        nativeHostStatusText = "Disconnected";
        rpcStatusText = "Disconnected";
        nativeHostStatusClass = "disconnected";
        rpcStatusClass = "disconnected";
        break;
      case "connecting_native":
        nativeHostStatusText = "Connecting...";
        rpcStatusText = "Connecting...";
        nativeHostStatusClass = "pending";
        rpcStatusClass = "pending"; // RPC is also attempting to connect
        reconnectButton.disabled = true;
        break;
      case "native_connected":
        nativeHostStatusText = "Connected";
        rpcStatusText = "Connecting...";
        nativeHostStatusClass = "connected";
        rpcStatusClass = "pending";
        break;
      case "rpc_connecting": // This state is likely redundant if native_connected already implies RPC connecting
        nativeHostStatusText = "Connected";
        rpcStatusText = "Connecting...";
        nativeHostStatusClass = "connected";
        rpcStatusClass = "pending";
        reconnectButton.disabled = true;
        break;
      case "rpc_ready":
        nativeHostStatusText = "Connected";
        rpcStatusText = "Connected!";
        nativeHostStatusClass = "connected";
        rpcStatusClass = "connected";
        if (rpcUser) {
          rpcUserText = `Logged in as ${rpcUser.username}`;
        }
        reconnectButton.textContent = "Disconnect";
        reconnectButton.title = "Disconnect from Native Host and Discord";
        break;
  case "error": // This signifies a critical error with the native host itself
    nativeHostStatusText = "Error";
    rpcStatusText = "Disconnected";
    nativeHostStatusClass = "error";
    rpcStatusClass = "disconnected";
    console.error("Popup: Received error status:", errorMessage);
    break;
      default:
        nativeHostStatusText = `Unknown (${status})`;
        rpcStatusText = `Unknown (${status})`;
        nativeHostStatusClass = "unknown";
        rpcStatusClass = "unknown";
    }

    if (status !== "rpc_ready") {
        reconnectButton.textContent = "Reconnect";
        reconnectButton.title = "Attempt to reconnect to Native Host";
    }
    nativeHostStatusElement.textContent = nativeHostStatusText;
    nativeHostStatusElement.className = "status-value " + nativeHostStatusClass;

    rpcStatusElement.textContent = rpcStatusText;
    rpcStatusElement.className = "status-value " + rpcStatusClass;

    rpcUserElement.textContent = rpcUserText;

    if (currentActivity && currentActivity.details) {
      songInfoText = `${currentActivity.details} - ${currentActivity.state}`;
    } else {
      songInfoText = "Waiting for music...";
    }
    currentSongElement.textContent = songInfoText;

    if (nativeHostWarningElement) {
      // Only show version mismatch warning if host version information is available and indicates a mismatch
      // Only show version mismatch warning if host version information is available and indicates a mismatch
      // AND we are not currently in a "connecting" state (to prevent flashing during reconnection)
      if (response.nativeHostVersion !== undefined && response.nativeHostVersionMismatch && status !== "connecting_native") {
        let warningMessage = "Native Host version mismatch. Please update your native host application.";
        if (response.nativeHostVersion) {
            warningMessage += ` Current: ${response.nativeHostVersion}. Required: ${REQUIRED_NATIVE_HOST_VERSION}.`;
        }
        nativeHostWarningElement.innerHTML = `<strong>Warning:</strong> ${warningMessage} <a href="#" id="nativeHostUpdateLink">Click here for instructions.</a>`;
        nativeHostWarningElement.style.display = 'block';
        // Add event listener for the update link
        const updateLink = document.getElementById("nativeHostUpdateLink");
        if (updateLink) {
          updateLink.addEventListener("click", (e) => {
            e.preventDefault();
            // Open a new tab with instructions or a download link
            chrome.tabs.create({ url: "https://github.com/FishysPop/Youtube-music-rich-presence/releases" }); // Replace with actual update instructions URL
          });
        }
      } else {
        // Ensure warning is hidden if not explicitly for version mismatch or if connecting
        nativeHostWarningElement.style.display = 'none';
      }
}
    } // This brace closes the updatePopupUI function.

  // Define REQUIRED_NATIVE_HOST_VERSION in popup.js as well for comparison
  const REQUIRED_NATIVE_HOST_VERSION = "1.0.0"; // Must match the version in background.js

  chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error(
        "Popup: Error getting initial status:",
        chrome.runtime.lastError.message
      );
      updatePopupUI(
        "error",
        `Failed to get status: ${chrome.runtime.lastError.message}`
      );
    } else if (response && response.type === "STATUS_RESPONSE") {
      console.log("[POPUP_DEBUG] Initial GET_STATUS response:", response);
      updatePopupUI(
        response.status,
        response.errorMessage,
        response.rpcUser,
        response.currentActivity,
        response // Pass the entire response object to updatePopupUI for version info
      );
    } else {
      console.warn(
        "Popup: Received unexpected response for GET_STATUS:",
        response
      );
      updatePopupUI("error", "Received unexpected status response.", null, null, response); // Pass response for version info
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "STATUS_UPDATE") {
      console.log("[POPUP_DEBUG] Received STATUS_UPDATE message:", message);
      updatePopupUI(
        message.status,
        message.errorMessage,
        message.rpcUser,
        message.currentActivity,
        message // Pass the entire message object to updatePopupUI for version info
      );
    }
  });

  if (reconnectButton) {
    reconnectButton.addEventListener("click", () => {
      // Immediately hide the warning when reconnect is triggered
      if (nativeHostWarningElement) {
        nativeHostWarningElement.style.display = 'none';
      }

      if (reconnectButton.textContent === "Disconnect") {
        console.log("Popup: Disconnect button clicked.");
        nativeHostStatusElement.textContent = "Disconnecting...";
        nativeHostStatusElement.className = "status-value pending";
        rpcStatusElement.textContent = "Disconnecting...";
        rpcStatusElement.className = "status-value pending";
        reconnectButton.disabled = true;

        chrome.runtime.sendMessage({ type: "DISCONNECT_NATIVE_HOST" }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Popup: Error sending DISCONNECT_NATIVE_HOST message:", chrome.runtime.lastError.message);
            } else {
                console.log("Popup: DISCONNECT_NATIVE_HOST message sent.", response);
            }
        });
      } else {
        console.log("Popup: Reconnect button clicked.");
        updatePopupUI("connecting_native");
        reconnectButton.disabled = true;
        chrome.runtime.sendMessage(
          { type: "RECONNECT_NATIVE_HOST" },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error(
                "Popup: Error sending RECONNECT_NATIVE_HOST message:",
                chrome.runtime.lastError.message
              );
            } else {
              console.log("Popup: RECONNECT_NATIVE_HOST message sent.", response);
            }
          }
        );
      }
    });
  }

if (openOptionsButton) {
  openOptionsButton.addEventListener("click", () => {
    console.log("Popup: Options button clicked.");
    // The logic to toggle optionsPanel is already handled by the first event listener
    // No need to send OPEN_OPTIONS_PAGE message as per user's request to revert old behavior
  });
}
