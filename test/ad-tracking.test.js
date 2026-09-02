const assert = require('assert');

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

function isAdPlayingMock(domState) {
  if (domState.bridgeAdActive === true || domState.bridgeAdActive === 'true') {
    return true;
  }
  if (domState.moviePlayerClasses && (domState.moviePlayerClasses.includes('ad-showing') || domState.moviePlayerClasses.includes('ad-interrupting'))) {
    return true;
  }
  if (domState.starkBadgeVisible) {
    return true;
  }
  if (domState.adOverlayShowing) {
    return true;
  }
  if (isAdTrack(domState.trackInfo)) {
    return true;
  }
  return false;
}

function evaluateListenerTrackChange({ syncEngine, isRemoteSyncing, currentTrackInfo, lastSyncedVideoId, currentVid, isAdPlaying }) {
  if (!syncEngine || syncEngine.isHost || syncEngine.role !== 'LISTENER' || isRemoteSyncing) {
    return { shouldLeave: false, reason: 'not_applicable' };
  }

  const isAd = isAdPlaying || isAdTrack(currentTrackInfo);
  if (isAd) {
    return { shouldLeave: false, reason: 'ad_playing_preserve_session' };
  }

  if (lastSyncedVideoId && currentVid && currentVid !== lastSyncedVideoId) {
    return { shouldLeave: true, reason: 'user_navigated_away' };
  }

  return { shouldLeave: false, reason: 'same_track' };
}

function evaluateHostSyncBroadcast({ syncEngine, isRemoteSyncing, isNewTrack, currentTrackInfo, isAdPlaying }) {
  if (!syncEngine || !syncEngine.isHost || isRemoteSyncing) {
    return { action: 'NONE' };
  }

  const isAd = isAdPlaying || isAdTrack(currentTrackInfo);
  if (isAd) {
    return { action: 'UPDATE_HOST_STATE', isAd: true };
  }

  if (isNewTrack) {
    return { action: 'NOTIFY_TRACK_CHANGE', isAd: false };
  }

  return { action: 'UPDATE_HOST_STATE', isAd: false };
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(err);
    process.exit(1);
  }
}

console.log('Running Ad Tracking & Resilience Tests...\n');

test('isAdTrack detects "Sponsored" titles and variations', () => {
  assert.strictEqual(isAdTrack({ track: 'Sponsored', artist: 'Young Stoner Life and Young Thug' }), true);
  assert.strictEqual(isAdTrack({ track: 'Sponsored • Young Stoner Life', artist: 'Artist' }), true);
  assert.strictEqual(isAdTrack({ track: 'Advertisement', artist: 'Brand' }), true);
  assert.strictEqual(isAdTrack({ track: 'Normal Song', artist: 'Sponsored • Brand' }), true);
  assert.strictEqual(isAdTrack({ track: 'Normal Song', artist: 'Normal Artist' }), false);
});

test('isAdPlayingMock detects ads across all DOM and bridge signals', () => {
  assert.strictEqual(isAdPlayingMock({ bridgeAdActive: 'true' }), true);
  assert.strictEqual(isAdPlayingMock({ moviePlayerClasses: ['ad-showing'] }), true);
  assert.strictEqual(isAdPlayingMock({ moviePlayerClasses: ['ad-interrupting'] }), true);
  assert.strictEqual(isAdPlayingMock({ starkBadgeVisible: true }), true);
  assert.strictEqual(isAdPlayingMock({ adOverlayShowing: true }), true);
  assert.strictEqual(isAdPlayingMock({ trackInfo: { track: 'Sponsored', artist: 'Ad Artist' } }), true);
  assert.strictEqual(isAdPlayingMock({
    bridgeAdActive: 'false',
    moviePlayerClasses: ['playing-mode'],
    starkBadgeVisible: false,
    adOverlayShowing: false,
    trackInfo: { track: 'Izospana', artist: 'Sam Deep' }
  }), false);
});

test('evaluateListenerTrackChange: Listener NEVER leaves session during an ad', () => {
  const result = evaluateListenerTrackChange({
    syncEngine: { isHost: false, role: 'LISTENER' },
    isRemoteSyncing: false,
    currentTrackInfo: { track: 'Sponsored', artist: 'Young Stoner Life and Young Thug' },
    lastSyncedVideoId: 'realVideoId123',
    currentVid: 'adVideoId456',
    isAdPlaying: true
  });

  assert.strictEqual(result.shouldLeave, false);
  assert.strictEqual(result.reason, 'ad_playing_preserve_session');
});

test('evaluateListenerTrackChange: Listener leaves session when user manually clicks another song', () => {
  const result = evaluateListenerTrackChange({
    syncEngine: { isHost: false, role: 'LISTENER' },
    isRemoteSyncing: false,
    currentTrackInfo: { track: 'Another Song', artist: 'Another Artist' },
    lastSyncedVideoId: 'realVideoId123',
    currentVid: 'userClickedId789',
    isAdPlaying: false
  });

  assert.strictEqual(result.shouldLeave, true);
  assert.strictEqual(result.reason, 'user_navigated_away');
});

test('evaluateHostSyncBroadcast: Host broadcasts isAd: true without firing NOTIFY_TRACK_CHANGE', () => {
  const adResult = evaluateHostSyncBroadcast({
    syncEngine: { isHost: true, role: 'HOST' },
    isRemoteSyncing: false,
    isNewTrack: true,
    currentTrackInfo: { track: 'Sponsored', artist: 'Young Stoner Life' },
    isAdPlaying: true
  });

  assert.strictEqual(adResult.action, 'UPDATE_HOST_STATE');
  assert.strictEqual(adResult.isAd, true);

  const songResult = evaluateHostSyncBroadcast({
    syncEngine: { isHost: true, role: 'HOST' },
    isRemoteSyncing: false,
    isNewTrack: true,
    currentTrackInfo: { track: 'Beat It', artist: 'Michael Jackson' },
    isAdPlaying: false
  });

  assert.strictEqual(songResult.action, 'NOTIFY_TRACK_CHANGE');
  assert.strictEqual(songResult.isAd, false);
});

console.log(`\nTests completed: ${passed}/5 passed.\nALL AD TRACKING TESTS PASSED!\n`);
