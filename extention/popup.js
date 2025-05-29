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
    let rpcUserText = "\u00A0"; 

    if (nativeHostWarningElement) {
      nativeHostWarningElement.style.display = 'none'; // Hide warning by default
    }

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
        rpcStatusText = "Disconnected"; 
        nativeHostStatusClass = "pending";
        rpcStatusClass = "disconnected";
        reconnectButton.disabled = true;
        break;
      case "native_connected":
        nativeHostStatusText = "Connected";
        rpcStatusText = "Connecting..."; 
        nativeHostStatusClass = "connected";
        rpcStatusClass = "pending";
        break;
      case "rpc_connecting":
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

    if (nativeHostWarningElement && (status === "disconnected" || status === "error")) {
      let showWarning = false;
      if (errorMessage) {
          const lowerErrorMessage = errorMessage.toLowerCase();
          const isManualAction = lowerErrorMessage.includes("manual");

          if (!isManualAction) {
              if (
                  lowerErrorMessage.includes("native host") ||
                  lowerErrorMessage.includes("connection error:") || 
                  lowerErrorMessage.includes("port error:") 
              ) {
                  showWarning = true;
              }
          }
      }
      nativeHostWarningElement.style.display = showWarning ? 'block' : 'none';
    }
  }

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
