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
        setTimeout(() => {
          optionsPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }, 30);
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
      songInfoText = currentActivity.album
        ? `${currentActivity.details} - ${currentActivity.state} (${currentActivity.album})`
        : `${currentActivity.details} - ${currentActivity.state}`;
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

  // --- Listen Together UI Elements ---
  const listenSessionBadge = document.getElementById("listenSessionBadge");
  const listenIdleView = document.getElementById("listenIdleView");
  const listenActiveView = document.getElementById("listenActiveView");
  const startSessionBtn = document.getElementById("startSessionBtn");
  const joinRoomInput = document.getElementById("joinRoomInput");
  const joinSessionBtn = document.getElementById("joinSessionBtn");
  const activeRoomCode = document.getElementById("activeRoomCode");
  const copyInviteBtn = document.getElementById("copyInviteBtn");
  const sessionStatusDetail = document.getElementById("sessionStatusDetail");
  const leaveSessionBtn = document.getElementById("leaveSessionBtn");
  const autoStopSelect = document.getElementById("autoStopSelect");

  if (autoStopSelect) {
    chrome.storage.local.get({ autoStopHostingTimeoutMinutes: 30 }, (result) => {
      autoStopSelect.value = String(result.autoStopHostingTimeoutMinutes ?? 30);
    });

    autoStopSelect.addEventListener("change", () => {
      const val = parseInt(autoStopSelect.value, 10);
      chrome.storage.local.set({ autoStopHostingTimeoutMinutes: isNaN(val) ? 30 : val });
    });
  }

  function updateListenSessionUI(state) {
    if (!listenSessionBadge || !listenIdleView || !listenActiveView) return;

    if (!state || state.role === 'NONE' || !state.roomId) {
      listenSessionBadge.textContent = "BETA";
      listenSessionBadge.className = "status-value beta";
      listenIdleView.style.display = "block";
      listenActiveView.style.display = "none";
    } else if (state.isHost) {
      const count = state.peerCount || 0;
      listenSessionBadge.textContent = count > 0 ? "Hosting" : "Waiting";
      listenSessionBadge.className = count > 0 ? "status-value connected" : "status-value pending";
      listenIdleView.style.display = "none";
      listenActiveView.style.display = "block";
      if (activeRoomCode) activeRoomCode.textContent = state.roomId;
      if (sessionStatusDetail) {
        if (state.peers && state.peers.length > 0) {
          const names = state.peers.map(p => p.name).join(', ');
          sessionStatusDetail.textContent = `Listeners: ${names}`;
        } else {
          sessionStatusDetail.textContent = count > 0 
            ? `${count} friend${count === 1 ? '' : 's'} connected` 
            : "Waiting for friends to join...";
        }
      }
    } else {
      const isConnected = state.status === 'connected' || (state.peerCount && state.peerCount > 0);
      listenSessionBadge.textContent = isConnected ? "Synced" : "Connecting";
      listenSessionBadge.className = isConnected ? "status-value connected" : "status-value pending";
      listenIdleView.style.display = "none";
      listenActiveView.style.display = "block";
      if (activeRoomCode) activeRoomCode.textContent = state.roomId;
      if (leaveSessionBtn) {
        leaveSessionBtn.textContent = isConnected ? "Leave Session" : "Cancel Connection";
      }
      if (sessionStatusDetail) {
        if (isConnected) {
          const hostName = state.hostName || 'Host';
          sessionStatusDetail.textContent = `Listening with ${hostName}`;
        } else {
          sessionStatusDetail.textContent = "Connecting to host...";
        }
      }
    }
  }

  function queryListenSessionStatus() {
    chrome.runtime.sendMessage({ type: "GET_LISTEN_SESSION_STATUS" }, (res) => {
      const err = chrome.runtime.lastError;
      if (!err && res && res.role) {
        updateListenSessionUI(res);
      } else {
        updateListenSessionUI(null);
      }
    });
  }

  queryListenSessionStatus();

  if (startSessionBtn) {
    startSessionBtn.addEventListener("click", () => {
      startSessionBtn.disabled = true;
      chrome.runtime.sendMessage({ type: "START_LISTEN_SESSION" }, (res) => {
        const err = chrome.runtime.lastError;
        startSessionBtn.disabled = false;
        queryListenSessionStatus();
      });
    });
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

  const executeJoin = () => {
    const code = parseSessionInput(joinRoomInput.value);
    if (!code) return;
    joinSessionBtn.disabled = true;
    chrome.runtime.sendMessage({ type: "JOIN_LISTEN_SESSION", roomId: code }, (res) => {
      const err = chrome.runtime.lastError;
      joinSessionBtn.disabled = false;
      joinRoomInput.value = "";
      queryListenSessionStatus();
    });
  };

  if (joinSessionBtn && joinRoomInput) {
    joinSessionBtn.addEventListener("click", executeJoin);
    joinRoomInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        executeJoin();
      }
    });
  }

  if (leaveSessionBtn) {
    leaveSessionBtn.addEventListener("click", () => {
      leaveSessionBtn.disabled = true;
      chrome.runtime.sendMessage({ type: "LEAVE_LISTEN_SESSION" }, () => {
        const err = chrome.runtime.lastError;
        leaveSessionBtn.disabled = false;
        queryListenSessionStatus();
      });
    });
  }

  if (copyInviteBtn && activeRoomCode) {
    copyInviteBtn.addEventListener("click", () => {
      const code = activeRoomCode.textContent.trim();
      const inviteUrl = `https://fishyspop.github.io/Youtube-music-rich-presence/?ytm-session=${code}`;
      navigator.clipboard.writeText(inviteUrl).then(() => {
        copyInviteBtn.textContent = "Copied!";
        setTimeout(() => {
          copyInviteBtn.textContent = "Copy Link";
        }, 2000);
      }).catch(() => {
        prompt("Copy invite link:", inviteUrl);
      });
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message && (message.type === "LISTEN_SESSION_UPDATE" || message.type === "LISTEN_SESSION_STATUS")) {
      queryListenSessionStatus();
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

