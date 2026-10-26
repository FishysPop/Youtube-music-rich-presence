const assert = require('assert');

console.log('Running Pause Hide Lifecycle & Persistence Tests...\n');

const allTests = [];
function test(name, fn) {
  allTests.push({ name, fn });
}

async function runAllTests() {
  let passedTests = 0;
  for (const t of allTests) {
    try {
      await t.fn();
      console.log(`  [PASS] ${t.name}`);
      passedTests++;
    } catch (err) {
      console.error(`  [FAIL] ${t.name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }
  console.log(`\nTests completed: ${passedTests}/${allTests.length} passed.`);
  if (passedTests === allTests.length) {
    console.log('ALL PAUSE HIDE LIFECYCLE TESTS PASSED!\n');
  }
}

// Harness recreating Background Pause-Hide state machine logic for isolated testing
function createPauseStateMachine(initialStorage = {}) {
  const storage = {
    userDisconnected: false,
    isPauseHidden: false,
    pausedTimestamp: null,
    pauseHideTargetTime: null,
    isManuallyDisconnected: false,
    currentSongActivity: null,
    pausedTrack: null,
    autoReconnectEnabled: true,
    pauseTimeoutMinutes: 15,
    ...initialStorage
  };

  let portConnected = false;
  let connectionAttempts = 0;
  let lastDispatchedActivity = null;
  let alarms = new Map();
  let timers = new Map();
  let nextTimerId = 1;

  const mockStorage = {
    get: (defaults, cb) => {
      const res = {};
      for (const k of Object.keys(defaults)) {
        res[k] = storage[k] !== undefined ? storage[k] : defaults[k];
      }
      cb(res);
    },
    set: (data, cb) => {
      Object.assign(storage, data);
      if (cb) cb();
    }
  };

  const mockAlarms = {
    create: (name, opts) => alarms.set(name, opts),
    clear: (name) => alarms.delete(name),
    get: (name, cb) => cb(alarms.get(name))
  };

  function resolvePauseTargetTime(pausedTimestamp, timeoutMinutes, now = Date.now()) {
    const minutes = Number(timeoutMinutes);
    if (!pausedTimestamp || isNaN(minutes) || minutes <= 0) {
      return { targetTime: null, remainingMs: null, isExpired: false };
    }
    const targetTime = pausedTimestamp + (minutes * 60 * 1000);
    const remainingMs = targetTime - now;
    return { targetTime, remainingMs, isExpired: remainingMs <= 0 };
  }

  function connectToNativeHost() {
    if (storage.userDisconnected) return false;
    if (storage.isManuallyDisconnected) return false;
    if (storage.isPauseHidden) return false;
    connectionAttempts++;
    portConnected = true;
    return true;
  }

  function handlePauseHideTimeout() {
    storage.isPauseHidden = true;
    storage.pauseHideTargetTime = null;
    storage.isManuallyDisconnected = true;
    const track = storage.currentSongActivity ? storage.currentSongActivity.details : (storage.pausedTrack ? storage.pausedTrack.track : null);
    const artist = storage.currentSongActivity ? storage.currentSongActivity.state : (storage.pausedTrack ? storage.pausedTrack.artist : null);
    storage.pausedTrack = { track, artist };

    mockStorage.set({
      isPauseHidden: true,
      pauseHideTargetTime: null,
      isManuallyDisconnected: true,
      pausedTrack: storage.pausedTrack
    });

    // Clear port and activity
    portConnected = false;
    lastDispatchedActivity = null;
  }

  function periodicConnectionCheck() {
    if (storage.userDisconnected || storage.isPauseHidden || storage.isManuallyDisconnected) {
      return { connected: false, reason: 'skipped_due_to_disconnect_or_hide' };
    }
    if (!storage.currentSongActivity) {
      return { connected: false, reason: 'no_song' };
    }
    if (!portConnected && storage.autoReconnectEnabled) {
      const ok = connectToNativeHost();
      return { connected: ok, reason: 'reconnected' };
    }
    return { connected: portConnected, reason: 'already_connected' };
  }

  function isSameSongAsPausedOrHidden(message) {
    if (!message || !message.track || !message.artist) return false;
    if (storage.currentSongActivity && storage.currentSongActivity.details === message.track && storage.currentSongActivity.state === message.artist) {
      return true;
    }
    if (storage.pausedTrack && storage.pausedTrack.track === message.track && storage.pausedTrack.artist === message.artist) {
      return true;
    }
    return false;
  }

  function processNewActivity(message) {
    if (message.isPlaying) {
      if (storage.isPauseHidden) {
        storage.isPauseHidden = false;
        storage.pausedTrack = null;
        mockStorage.set({ isPauseHidden: false, pauseHideTargetTime: null, pausedTrack: null });
      }
      mockAlarms.clear('pauseHideAlarm');
      if (storage.isManuallyDisconnected && !storage.userDisconnected) {
        storage.isManuallyDisconnected = false;
        mockStorage.set({ isManuallyDisconnected: false });
      }
    } else {
      if (storage.isPauseHidden && isSameSongAsPausedOrHidden(message)) {
        return { action: 'DROPPED_PAUSED_AND_HIDDEN' };
      }
      if (storage.pauseHideTargetTime && Date.now() >= storage.pauseHideTargetTime && !storage.isPauseHidden) {
        handlePauseHideTimeout();
        return { action: 'PAUSE_TIMEOUT_EXPIRED' };
      }
    }

    const isDifferentSong = !storage.currentSongActivity ||
      storage.currentSongActivity.details !== message.track ||
      storage.currentSongActivity.state !== message.artist;

    if (isDifferentSong) {
      storage.currentSongActivity = {
        details: message.track,
        state: message.artist,
        duration: message.duration || 0
      };
      storage.pausedTimestamp = null;
      storage.pauseHideTargetTime = null;
      storage.isPauseHidden = false;
      storage.pausedTrack = null;
      mockStorage.set({
        currentSongActivity: storage.currentSongActivity,
        pausedTimestamp: null,
        pauseHideTargetTime: null,
        isPauseHidden: false,
        pausedTrack: null
      });
      mockAlarms.clear('pauseHideAlarm');

      if (storage.isManuallyDisconnected && !storage.userDisconnected) {
        storage.isManuallyDisconnected = false;
        mockStorage.set({ isManuallyDisconnected: false });
        connectToNativeHost();
      }
    }

    if (!message.isPlaying && storage.pausedTimestamp === null) {
      storage.pausedTimestamp = Date.now();
      const { targetTime, remainingMs, isExpired } = resolvePauseTargetTime(storage.pausedTimestamp, storage.pauseTimeoutMinutes);
      if (targetTime) {
        storage.pauseHideTargetTime = targetTime;
        mockStorage.set({ pausedTimestamp: storage.pausedTimestamp, pauseHideTargetTime: targetTime });
        if (isExpired) {
          handlePauseHideTimeout();
          return { action: 'EXPIRED_IMMEDIATELY' };
        } else {
          mockAlarms.create('pauseHideAlarm', { when: targetTime });
        }
      }
    } else if (message.isPlaying && storage.pausedTimestamp !== null) {
      storage.pausedTimestamp = null;
      storage.pauseHideTargetTime = null;
      storage.isPauseHidden = false;
      mockStorage.set({ pausedTimestamp: null, pauseHideTargetTime: null, isPauseHidden: false });
      mockAlarms.clear('pauseHideAlarm');
      if (storage.isManuallyDisconnected && !storage.userDisconnected) {
        storage.isManuallyDisconnected = false;
        mockStorage.set({ isManuallyDisconnected: false });
        connectToNativeHost();
      }
    }

    lastDispatchedActivity = storage.currentSongActivity;
    if (!portConnected && !storage.userDisconnected && !storage.isPauseHidden && !storage.isManuallyDisconnected) {
      connectToNativeHost();
    }

    return { action: 'UPDATED', activity: lastDispatchedActivity };
  }

  function simulateServiceWorkerRestart() {
    // Port and in-memory heap are wiped on service worker restart
    portConnected = false;
    // Reload state strictly from persistent storage
    const hydratedStorage = JSON.parse(JSON.stringify(storage));
    return createPauseStateMachine(hydratedStorage);
  }

  return {
    storage,
    mockStorage,
    alarms,
    get portConnected() { return portConnected; },
    get connectionAttempts() { return connectionAttempts; },
    get lastDispatchedActivity() { return lastDispatchedActivity; },
    processNewActivity,
    handlePauseHideTimeout,
    periodicConnectionCheck,
    connectToNativeHost,
    simulateServiceWorkerRestart,
    resolvePauseTargetTime
  };
}

// Tests
test('resolvePauseTargetTime computes targetTime and expiration accurately', () => {
  const machine = createPauseStateMachine();
  const baseTime = 1000000;
  const res1 = machine.resolvePauseTargetTime(baseTime, 15, baseTime + 5 * 60 * 1000);
  assert.strictEqual(res1.targetTime, baseTime + 15 * 60 * 1000);
  assert.strictEqual(res1.remainingMs, 10 * 60 * 1000);
  assert.strictEqual(res1.isExpired, false);

  const resExpired = machine.resolvePauseTargetTime(baseTime, 15, baseTime + 16 * 60 * 1000);
  assert.strictEqual(resExpired.isExpired, true);
  assert.strictEqual(resExpired.remainingMs < 0, true);

  const resNever = machine.resolvePauseTargetTime(baseTime, 0);
  assert.strictEqual(resNever.targetTime, null);
  assert.strictEqual(resNever.isExpired, false);
});

test('handlePauseHideTimeout marks state hidden, disconnects, and persists to storage', () => {
  const machine = createPauseStateMachine();
  machine.processNewActivity({ track: 'Karma Police', artist: 'Radiohead', isPlaying: true });
  assert.strictEqual(machine.portConnected, true);

  // Pause
  machine.processNewActivity({ track: 'Karma Police', artist: 'Radiohead', isPlaying: false });
  assert.strictEqual(machine.storage.pausedTimestamp !== null, true);
  assert.strictEqual(machine.alarms.has('pauseHideAlarm'), true);

  // Trigger timeout
  machine.handlePauseHideTimeout();
  assert.strictEqual(machine.storage.isPauseHidden, true);
  assert.strictEqual(machine.storage.isManuallyDisconnected, true);
  assert.strictEqual(machine.storage.pauseHideTargetTime, null);
  assert.deepStrictEqual(machine.storage.pausedTrack, { track: 'Karma Police', artist: 'Radiohead' });
  assert.strictEqual(machine.portConnected, false);
});

test('Service worker restart preserves pause hidden state and prevents reshow on tab messages', () => {
  const initialMachine = createPauseStateMachine();
  initialMachine.processNewActivity({ track: 'No Surprises', artist: 'Radiohead', isPlaying: true });
  initialMachine.processNewActivity({ track: 'No Surprises', artist: 'Radiohead', isPlaying: false });
  initialMachine.handlePauseHideTimeout();

  assert.strictEqual(initialMachine.storage.isPauseHidden, true);
  assert.strictEqual(initialMachine.portConnected, false);

  // Simulate Service Worker termination and restart 5 minutes later
  const restartedMachine = initialMachine.simulateServiceWorkerRestart();
  assert.strictEqual(restartedMachine.storage.isPauseHidden, true);
  assert.strictEqual(restartedMachine.storage.isManuallyDisconnected, true);
  assert.deepStrictEqual(restartedMachine.storage.pausedTrack, { track: 'No Surprises', artist: 'Radiohead' });
  assert.strictEqual(restartedMachine.portConnected, false);

  // Tab sends paused update for the same track
  const res = restartedMachine.processNewActivity({ track: 'No Surprises', artist: 'Radiohead', isPlaying: false });
  assert.strictEqual(res.action, 'DROPPED_PAUSED_AND_HIDDEN');
  assert.strictEqual(restartedMachine.storage.isPauseHidden, true);
  assert.strictEqual(restartedMachine.portConnected, false);
});

test('periodicConnectionCheck does NOT reconnect when isPauseHidden or isManuallyDisconnected is true', () => {
  const machine = createPauseStateMachine({
    isPauseHidden: true,
    isManuallyDisconnected: true,
    currentSongActivity: { details: 'Fake Plastic Trees', state: 'Radiohead' }
  });

  const checkResult = machine.periodicConnectionCheck();
  assert.strictEqual(checkResult.connected, false);
  assert.strictEqual(checkResult.reason, 'skipped_due_to_disconnect_or_hide');
  assert.strictEqual(machine.portConnected, false);
});

test('connectToNativeHost refuses connection when isPauseHidden is true', () => {
  const machine = createPauseStateMachine({ isPauseHidden: true });
  const result = machine.connectToNativeHost();
  assert.strictEqual(result, false);
  assert.strictEqual(machine.portConnected, false);
});

test('Resuming playback (isPlaying = true) unhides and reconnects cleanly', () => {
  const machine = createPauseStateMachine();
  machine.processNewActivity({ track: 'Creep', artist: 'Radiohead', isPlaying: true });
  machine.processNewActivity({ track: 'Creep', artist: 'Radiohead', isPlaying: false });
  machine.handlePauseHideTimeout();
  assert.strictEqual(machine.storage.isPauseHidden, true);
  assert.strictEqual(machine.portConnected, false);

  // User presses play
  const res = machine.processNewActivity({ track: 'Creep', artist: 'Radiohead', isPlaying: true });
  assert.strictEqual(res.action, 'UPDATED');
  assert.strictEqual(machine.storage.isPauseHidden, false);
  assert.strictEqual(machine.storage.isManuallyDisconnected, false);
  assert.strictEqual(machine.portConnected, true);
});

test('Switching to a different track while paused resets pause hide and starts fresh timer', () => {
  const machine = createPauseStateMachine();
  machine.processNewActivity({ track: 'High and Dry', artist: 'Radiohead', isPlaying: true });
  machine.processNewActivity({ track: 'High and Dry', artist: 'Radiohead', isPlaying: false });
  machine.handlePauseHideTimeout();
  assert.strictEqual(machine.storage.isPauseHidden, true);

  // User clicks a different song in YouTube Music while still paused
  const res = machine.processNewActivity({ track: 'Paranoid Android', artist: 'Radiohead', isPlaying: false });
  assert.strictEqual(res.action, 'UPDATED');
  assert.strictEqual(machine.storage.isPauseHidden, false);
  assert.strictEqual(machine.storage.isManuallyDisconnected, false);
  assert.strictEqual(machine.storage.currentSongActivity.details, 'Paranoid Android');
  assert.strictEqual(machine.alarms.has('pauseHideAlarm'), true);
  assert.strictEqual(machine.portConnected, true);
});

test('extention/background.js exports isSameSongAsPausedOrHidden and handles matching accurately', () => {
  const bg = require('../extention/background.js');
  assert.strictEqual(typeof bg.isSameSongAsPausedOrHidden, 'function');
  assert.strictEqual(typeof bg.resolvePauseTargetTime, 'function');
  assert.strictEqual(typeof bg.ensureStorageInitialized, 'function');
  assert.strictEqual(typeof bg.handlePauseHideTimeout, 'function');

  // Test invalid or null message
  assert.strictEqual(bg.isSameSongAsPausedOrHidden(null), false);
  assert.strictEqual(bg.isSameSongAsPausedOrHidden({}), false);
  assert.strictEqual(bg.isSameSongAsPausedOrHidden({ track: 'Karma Police' }), false);
});

runAllTests();
