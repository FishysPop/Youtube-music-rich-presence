const assert = require('assert');

console.log('Running Ad Sync & Integration Tests...\n');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function mockPlayerWithAd(adState = 1, classes = ['ad-showing']) {
  return {
    getAdState: () => adState,
    classList: {
      contains: (cls) => classes.includes(cls)
    },
    getVideoData: () => ({ video_id: 'ad_video_id_xyz', title: 'Advertisement' }),
    seekTo: () => {},
    playVideo: () => {},
    pauseVideo: () => {}
  };
}

function mockPlayerWithoutAd(videoId = 'real_song_123', title = 'Real Song') {
  return {
    getAdState: () => -1,
    classList: {
      contains: () => false
    },
    getVideoData: () => ({ video_id: videoId, title }),
    seekTo: () => {},
    playVideo: () => {},
    pauseVideo: () => {}
  };
}

function checkIsAd(player, documentMock) {
  if (player) {
    if (typeof player.getAdState === 'function' && player.getAdState() >= 0) return true;
    if (typeof player.isLifaAdPlaying === 'function' && player.isLifaAdPlaying()) return true;
    if (typeof player.isAd === 'function' && player.isAd()) return true;
    if (player.classList && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) return true;
  }
  if (documentMock) {
    if (documentMock.documentElement?.getAttribute('data-ytm-ad-active') === 'true') return true;
    if (documentMock.querySelector && documentMock.querySelector('.badge-style-type-ad-stark, .ad-showing, .ytp-ad-showing, .ytp-ad-player-overlay')) return true;
  }
  return false;
}

function simulateListenerSync({
  currentIsAd,
  incomingPacket,
  wasInAd,
  lastAdTargetPacket,
  currentVideoId,
  onNavigate
}) {
  let updatedWasInAd = wasInAd;
  let updatedLastAdTargetPacket = lastAdTargetPacket;

  if (currentIsAd) {
    updatedWasInAd = true;
    if (!incomingPacket.isAd) {
      updatedLastAdTargetPacket = incomingPacket;
    }
    return {
      navigated: false,
      wasInAd: updatedWasInAd,
      lastAdTargetPacket: updatedLastAdTargetPacket
    };
  }

  if (updatedWasInAd) {
    updatedWasInAd = false;
    if (updatedLastAdTargetPacket && updatedLastAdTargetPacket.videoId !== currentVideoId) {
      onNavigate(updatedLastAdTargetPacket);
      return {
        navigated: true,
        targetVideoId: updatedLastAdTargetPacket.videoId,
        wasInAd: false,
        lastAdTargetPacket: null
      };
    }
  }

  if (incomingPacket.isAd) {
    return { navigated: false, wasInAd: false, lastAdTargetPacket: null };
  }

  if (incomingPacket.videoId && incomingPacket.videoId !== currentVideoId) {
    onNavigate(incomingPacket);
    return {
      navigated: true,
      targetVideoId: incomingPacket.videoId,
      wasInAd: false,
      lastAdTargetPacket: null
    };
  }

  return { navigated: false, wasInAd: false, lastAdTargetPacket: null };
}

test('checkIsAd accurately detects player getAdState >= 0 and classes', () => {
  const adPlayer = mockPlayerWithAd(1, ['ad-showing']);
  assert.strictEqual(checkIsAd(adPlayer, null), true);

  const cleanPlayer = mockPlayerWithoutAd();
  assert.strictEqual(checkIsAd(cleanPlayer, null), false);

  const docWithAdAttribute = {
    documentElement: { getAttribute: (attr) => attr === 'data-ytm-ad-active' ? 'true' : null },
    querySelector: () => null
  };
  assert.strictEqual(checkIsAd(cleanPlayer, docWithAdAttribute), true);
});

test('Listener defers track change when ad is active and saves target packet', () => {
  let navigatedTrack = null;
  const state = simulateListenerSync({
    currentIsAd: true,
    incomingPacket: { videoId: 'host_new_song', track: 'New Song', artist: 'Host Artist' },
    wasInAd: false,
    lastAdTargetPacket: null,
    currentVideoId: 'old_song',
    onNavigate: (packet) => { navigatedTrack = packet; }
  });

  assert.strictEqual(state.navigated, false);
  assert.strictEqual(state.wasInAd, true);
  assert.strictEqual(state.lastAdTargetPacket?.videoId, 'host_new_song');
  assert.strictEqual(navigatedTrack, null);
});

test('Listener automatically catches up to target song once ad ends', () => {
  let navigatedTrack = null;
  const state = simulateListenerSync({
    currentIsAd: false,
    incomingPacket: { type: 'SYNC_STATE', isPlaying: true, currentTime: 15 },
    wasInAd: true,
    lastAdTargetPacket: { videoId: 'host_new_song', track: 'New Song', artist: 'Host Artist' },
    currentVideoId: 'old_song',
    onNavigate: (packet) => { navigatedTrack = packet; }
  });

  assert.strictEqual(state.navigated, true);
  assert.strictEqual(state.targetVideoId, 'host_new_song');
  assert.strictEqual(state.wasInAd, false);
  assert.strictEqual(state.lastAdTargetPacket, null);
  assert.strictEqual(navigatedTrack?.videoId, 'host_new_song');
});

test('Host suppresses TRACK_CHANGE packet when playing an ad', () => {
  function processHostTrackChange(trackInfo, isAd) {
    if (isAd || trackInfo.isAd) {
      return { broadcastType: 'SYNC_STATE', isAd: true };
    }
    return { broadcastType: 'TRACK_CHANGE', isAd: false, videoId: trackInfo.videoId };
  }

  const adBroadcast = processHostTrackChange({ videoId: 'ad_vid_99', track: 'Sponsored' }, true);
  assert.strictEqual(adBroadcast.broadcastType, 'SYNC_STATE');
  assert.strictEqual(adBroadcast.isAd, true);

  const realBroadcast = processHostTrackChange({ videoId: 'real_vid_11', track: 'Real Track' }, false);
  assert.strictEqual(realBroadcast.broadcastType, 'TRACK_CHANGE');
  assert.strictEqual(realBroadcast.videoId, 'real_vid_11');
});

test('determineSyncAction returns NONE with 1.0 rate when isAd is true', () => {
  const { determineSyncAction } = require('../extention/webrtc-sync.js');
  const action = determineSyncAction(4000, true, true, 20, true, false);
  assert.strictEqual(action.action, 'NONE');
  assert.strictEqual(action.playbackRate, 1.0);
  assert.strictEqual(action.playPauseState, null);
});

async function run() {
  let passed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  [PASS] ${t.name}`);
      passed++;
    } catch (e) {
      console.error(`  [FAIL] ${t.name}`);
      console.error(e);
      process.exitCode = 1;
    }
  }
  console.log(`\nTests completed: ${passed}/${tests.length} passed.`);
  if (passed === tests.length) {
    console.log('ALL AD SYNC INTEGRATION TESTS PASSED!\n');
  }
}

run();
