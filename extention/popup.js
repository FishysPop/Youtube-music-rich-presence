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
  const pauseTimeoutInput = document.getElementById("pauseTimeoutInput");

  const nativeHostStatusElement = document.getElementById("nativeHostStatus");
  const rpcStatusElement = document.getElementById("rpcStatus");
  const rpcUserElement = document.getElementById("rpcUser");
  const currentSongElement = document.getElementById("currentSong");
  const reconnectButton = document.getElementById("reconnectButton");
  const nativeHostWarningElement = document.getElementById("nativeHostWarning");

  const REQUIRED_NATIVE_HOST_VERSION = "1.0.0";

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
      chrome.storage.local.set({ autoReconnectEnabled: enabled });
    });
  }

  if (pauseTimeoutInput) {
    chrome.storage.local.get({ pauseTimeoutMinutes: -1 }, (result) => {
      pauseTimeoutInput.value = result.pauseTimeoutMinutes;
    });

    pauseTimeoutInput.addEventListener("change", () => {
      let value = parseInt(pauseTimeoutInput.value);
      if (isNaN(value) || value < -1) {
        value = -1;
        pauseTimeoutInput.value = -1;
      } else if (value > 60) {
        value = 60;
        pauseTimeoutInput.value = 60;
      }
      
      chrome.storage.local.set({ pauseTimeoutMinutes: value });
    });
  }

  function updatePopupUI(
    status,
    errorMessage = null,
    rpcUser = null,
    currentActivity = null,
    response = {}
  ) {
    let nativeHostStatusText = "Unknown";
    let rpcStatusText = "Unknown";
    let nativeHostStatusClass = "status-unknown";
    let rpcStatusClass = "status-unknown";
    let songInfoText = "Waiting for music...";
    let rpcUserText = "\u00A0";
    
    if (nativeHostWarningElement) {
      nativeHostWarningElement.style.display = 'none';
      nativeHostWarningElement.innerHTML = '';
    }

    if (reconnectButton) {
      reconnectButton.disabled = false;
    }

    switch (status) {
      case "disconnected":
        if (response && response.nativeHostInstalled === false) {
          nativeHostStatusText = "Not Installed";
          nativeHostStatusClass = "error";
        } else if (response && response.nativeHostInstalled === true) {
          nativeHostStatusText = "Installed (Idle)";
          nativeHostStatusClass = "connected";
        } else {
          nativeHostStatusText = "Disconnected";
          nativeHostStatusClass = "disconnected";
        }
        rpcStatusText = "Disconnected";
        rpcStatusClass = "disconnected";
        break;
      case "connecting_native":
        nativeHostStatusText = "Connecting...";
        rpcStatusText = "Connecting...";
        nativeHostStatusClass = "pending";
        rpcStatusClass = "pending";
        if (reconnectButton) reconnectButton.disabled = true;
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
        if (reconnectButton) reconnectButton.disabled = true;
        break;
      case "rpc_ready":
        nativeHostStatusText = "Connected";
        rpcStatusText = "Connected!";
        nativeHostStatusClass = "connected";
        rpcStatusClass = "connected";
        if (rpcUser) {
          rpcUserText = `Logged in as ${rpcUser.username}`;
        }
        if (reconnectButton) {
          reconnectButton.textContent = "Disconnect";
          reconnectButton.title = "Disconnect from Native Host and Discord";
        }
        break;
      case "error":
        nativeHostStatusText = (errorMessage && (errorMessage.toLowerCase().includes("not found") || errorMessage.toLowerCase().includes("forbidden"))) ? "Not Installed" : "Error";
        rpcStatusText = "Disconnected";
        nativeHostStatusClass = "error";
        rpcStatusClass = "disconnected";
        break;
      default:
        nativeHostStatusText = `Unknown (${status})`;
        rpcStatusText = `Unknown (${status})`;
        nativeHostStatusClass = "unknown";
        rpcStatusClass = "unknown";
    }

    if (status !== "rpc_ready" && reconnectButton) {
      reconnectButton.textContent = "Reconnect";
      reconnectButton.title = "Attempt to reconnect to Native Host";
    }

    if (nativeHostStatusElement) {
      nativeHostStatusElement.textContent = nativeHostStatusText;
      nativeHostStatusElement.className = "status-value " + nativeHostStatusClass;
    }

    if (rpcStatusElement) {
      rpcStatusElement.textContent = rpcStatusText;
      rpcStatusElement.className = "status-value " + rpcStatusClass;
    }

    if (rpcUserElement) {
      rpcUserElement.textContent = rpcUserText;
    }

    if (currentActivity && currentActivity.details) {
      songInfoText = `${currentActivity.details} - ${currentActivity.state}`;
    } else {
      songInfoText = "Waiting for music...";
    }

    if (currentSongElement) {
      currentSongElement.textContent = songInfoText;
    }

    if (nativeHostWarningElement) {
      const isHostNotFound = (errorMessage && (errorMessage.toLowerCase().includes("not found") || errorMessage.toLowerCase().includes("forbidden"))) || (response && response.nativeHostInstalled === false);
      if (isHostNotFound && status !== "connecting_native") {
        nativeHostWarningElement.innerHTML = `<strong>Warning:</strong> Native host application is not installed. <a href="#" id="nativeHostUpdateLink" style="color: #9ec5fe; font-weight: 600; text-decoration: underline;">Download Installer</a>`;
        nativeHostWarningElement.style.display = 'block';
        const updateLink = document.getElementById("nativeHostUpdateLink");
        if (updateLink) {
          updateLink.addEventListener("click", (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: "https://github.com/FishysPop/Youtube-music-rich-presence/releases" });
          });
        }
      } else if (response.nativeHostVersion !== undefined && response.nativeHostVersionMismatch && status !== "connecting_native") {
        let warningMessage = "Native Host version mismatch. Please update your native host application.";
        if (response.nativeHostVersion) {
          warningMessage += ` Current: ${response.nativeHostVersion}. Required: ${REQUIRED_NATIVE_HOST_VERSION}.`;
        }
        nativeHostWarningElement.innerHTML = `<strong>Warning:</strong> ${warningMessage} <a href="#" id="nativeHostUpdateLink" style="color: #9ec5fe; font-weight: 600; text-decoration: underline;">Click here for instructions.</a>`;
        nativeHostWarningElement.style.display = 'block';
        const updateLink = document.getElementById("nativeHostUpdateLink");
        if (updateLink) {
          updateLink.addEventListener("click", (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: "https://github.com/FishysPop/Youtube-music-rich-presence/releases" });
          });
        }
      } else {
        nativeHostWarningElement.style.display = 'none';
      }
    }
  }

  chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
    if (chrome.runtime.lastError) {
      updatePopupUI(
        "error",
        `Failed to get status: ${chrome.runtime.lastError.message}`
      );
    } else if (response && response.type === "STATUS_RESPONSE") {
      updatePopupUI(
        response.status,
        response.errorMessage,
        response.rpcUser,
        response.currentActivity,
        response
      );
    } else {
      updatePopupUI("error", "Received unexpected status response.", null, null, response);
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "STATUS_UPDATE") {
      updatePopupUI(
        message.status,
        message.errorMessage,
        message.rpcUser,
        message.currentActivity,
        message
      );
    }
  });

  if (reconnectButton) {
    reconnectButton.addEventListener("click", () => {
      if (nativeHostWarningElement) {
        nativeHostWarningElement.style.display = 'none';
      }

      if (reconnectButton.textContent === "Disconnect") {
        if (nativeHostStatusElement) {
          nativeHostStatusElement.textContent = "Disconnecting...";
          nativeHostStatusElement.className = "status-value pending";
        }
        if (rpcStatusElement) {
          rpcStatusElement.textContent = "Disconnecting...";
          rpcStatusElement.className = "status-value pending";
        }
        reconnectButton.disabled = true;

        chrome.runtime.sendMessage({ type: "DISCONNECT_NATIVE_HOST" });
      } else {
        updatePopupUI("connecting_native");
        reconnectButton.disabled = true;
        chrome.runtime.sendMessage({ type: "RECONNECT_NATIVE_HOST" });
      }
    });
  }
});

