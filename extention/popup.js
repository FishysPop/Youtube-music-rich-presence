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

if (openOptionsButton && optionsPanel && logContent && hideOptionsButton) {
  openOptionsButton.addEventListener("click", () => {
    logContent.textContent = errorLogs.join("\n") || "No errors yet.";
    optionsPanel.style.display = "block";
  });
  hideOptionsButton.addEventListener("click", () => {
    optionsPanel.style.display = "none";
  });
}
}
);
  // Get the UI elements from popup.html
  const nativeHostStatusElement = document.getElementById("nativeHostStatus");
  const rpcStatusElement = document.getElementById("rpcStatus");
  const rpcUserElement = document.getElementById("rpcUser");
  const currentSongElement = document.getElementById("currentSong");
  const reconnectButton = document.getElementById("reconnectButton");

  // Function to update the popup UI based on status and data from background
  function updatePopupUI(
    status,
    errorMessage = null,
    rpcUser = null,
    currentActivity = null
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
    let rpcUserText = "\u00A0"; // Non-breaking space to maintain height

    // Map the single background status to the two UI status elements
    switch (status) {
      case "disconnected":
        nativeHostStatusText = "Disconnected";
        rpcStatusText = "Disconnected";
        nativeHostStatusClass = "disconnected";
        rpcStatusClass = "disconnected";
        break;
      case "connecting_native":
        nativeHostStatusText = "Connecting...";
        rpcStatusText = "Disconnected"; // RPC is not connected yet
        nativeHostStatusClass = "pending";
        rpcStatusClass = "disconnected";
        break;
      case "native_connected":
        nativeHostStatusText = "Connected";
        rpcStatusText = "Connecting..."; // Native host connected, now trying RPC
        nativeHostStatusClass = "connected";
        rpcStatusClass = "pending";
        break;
      case "rpc_connecting":
        nativeHostStatusText = "Connected";
        rpcStatusText = "Connecting..."; // Explicitly connecting RPC
        nativeHostStatusClass = "connected";
        rpcStatusClass = "pending";
        break;
      case "rpc_ready":
        nativeHostStatusText = "Connected";
        rpcStatusText = "Connected!";
        nativeHostStatusClass = "connected";
        rpcStatusClass = "connected";
        if (rpcUser) {
          rpcUserText = `Logged in as ${rpcUser.username}`;
        }
        break;
  case "error":
    nativeHostStatusText = "Disconnected";
    rpcStatusText = "Disconnected";
    nativeHostStatusClass = "disconnected";
    rpcStatusClass = "disconnected";
    console.error("Popup: Received error status:", errorMessage);
    break;
      default:
        nativeHostStatusText = `Unknown (${status})`;
        rpcStatusText = `Unknown (${status})`;
        nativeHostStatusClass = "unknown";
        rpcStatusClass = "unknown";
    }

    // Update Native Host Status UI
    nativeHostStatusElement.textContent = nativeHostStatusText;
    // Remove previous status classes and add the new one
    nativeHostStatusElement.className = "status-value " + nativeHostStatusClass;

    // Update Discord RPC Status UI
    rpcStatusElement.textContent = rpcStatusText;
    // Remove previous status classes and add the new one
    rpcStatusElement.className = "status-value " + rpcStatusClass;

    // Update RPC User Info
    rpcUserElement.textContent = rpcUserText;

    // Update Current Song Info
    if (currentActivity && currentActivity.details) {
      songInfoText = `${currentActivity.details} - ${currentActivity.state}`;
    } else {
      songInfoText = "Waiting for music...";
    }
    currentSongElement.textContent = songInfoText;
  }

  // 1. Request initial status when the popup opens
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
      console.log("[POPUP_DEBUG] Initial GET_STATUS response:", response); // Log the whole response
      updatePopupUI(
        response.status,
        response.errorMessage,
        response.rpcUser,
        response.currentActivity
      );
    } else {
      console.warn(
        "Popup: Received unexpected response for GET_STATUS:",
        response
      );
      updatePopupUI("error", "Received unexpected status response.");
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "STATUS_UPDATE") {
      console.log("[POPUP_DEBUG] Received STATUS_UPDATE message:", message);
      updatePopupUI(
        message.status,
        message.errorMessage,
        message.rpcUser,
        message.currentActivity
      );
    }
  });

  if (reconnectButton) {
    reconnectButton.addEventListener("click", () => {
      console.log("Popup: Reconnect button clicked.");
      // Optionally update UI immediately to show "Connecting..."
      updatePopupUI("connecting_native");
      chrome.runtime.sendMessage(
        { type: "RECONNECT_NATIVE_HOST" },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error(
              "Popup: Error sending RECONNECT_NATIVE_HOST message:",
              chrome.runtime.lastError.message
            );
            // Revert status or show specific error if message sending failed
            updatePopupUI(
              "error",
              `Failed to send reconnect command: ${chrome.runtime.lastError.message}`
            );
          } else {
            console.log("Popup: RECONNECT_NATIVE_HOST message sent.", response);
            // Background script will send STATUS_UPDATE messages as it attempts connection
          }
        }
      );
    });
  }

if (openOptionsButton) {
  openOptionsButton.addEventListener("click", () => {
    console.log("Popup: Options button clicked.");
    chrome.runtime.sendMessage({ type: "OPEN_OPTIONS_PAGE" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error(
          "Popup: Error sending OPEN_OPTIONS_PAGE message:",
          chrome.runtime.lastError.message
        );
      } else {
        console.log("Popup: OPEN_OPTIONS_PAGE message sent.", response);
      }
    });
  });
}
