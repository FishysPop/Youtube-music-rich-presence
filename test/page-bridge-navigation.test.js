const assert = require('assert');

console.log('Running Page-Bridge Navigation & Listen Together Tests...\n');

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
    console.log('ALL PAGE-BRIDGE NAVIGATION TESTS PASSED!\n');
  }
}

function buildWatchEndpoint(videoId, currentTime, playlistId, playlistIndex) {
  const seconds = Math.floor(currentTime || 0);
  const endpoint = {
    watchEndpoint: {
      videoId: videoId
    }
  };
  if (seconds > 0) {
    endpoint.watchEndpoint.startTimeSeconds = seconds;
  }
  if (playlistId && typeof playlistId === 'string') {
    endpoint.watchEndpoint.playlistId = playlistId;
  }
  if (typeof playlistIndex === 'number' && Number.isInteger(playlistIndex) && playlistIndex >= 0) {
    endpoint.watchEndpoint.index = playlistIndex;
  }
  return endpoint;
}

function shouldCollapsePlayerPage(wasPlayerPageOpen, currentPath) {
  if (wasPlayerPageOpen) return false;
  if (currentPath && currentPath.startsWith('/watch')) return false;
  return true;
}

function buildLoadVideoMessage(videoId, trackTitle, artist, albumArtUrl, currentTime, isPlaying, playlistId, playlistIndex, nextVideoId) {
  const msg = {
    source: 'ytm-sync-isolated',
    action: 'LOAD_VIDEO',
    videoId: videoId,
    track: trackTitle,
    artist: artist,
    albumArtUrl: albumArtUrl,
    currentTime: typeof currentTime === 'number' ? currentTime : 0,
    isPlaying: typeof isPlaying === 'boolean' ? isPlaying : true
  };
  if (playlistId && typeof playlistId === 'string') {
    msg.playlistId = playlistId;
  }
  if (typeof playlistIndex === 'number' && Number.isInteger(playlistIndex) && playlistIndex >= 0) {
    msg.playlistIndex = playlistIndex;
  }
  if (nextVideoId && typeof nextVideoId === 'string') {
    msg.nextVideoId = nextVideoId;
  }
  return msg;
}

function determineSkipStrategy({ targetVideoId, currentIdx, queueItems }) {
  if (!targetVideoId) return 'none';
  if (!Array.isArray(queueItems) || queueItems.length === 0) return 'endpoint_navigation';

  const nextItem = currentIdx >= 0 && currentIdx + 1 < queueItems.length ? queueItems[currentIdx + 1] : null;
  if (nextItem && nextItem.videoId === targetVideoId) {
    return 'native_next';
  }

  const prevItem = currentIdx > 0 && currentIdx - 1 < queueItems.length ? queueItems[currentIdx - 1] : null;
  if (prevItem && prevItem.videoId === targetVideoId) {
    return 'native_prev';
  }

  const matchIdx = queueItems.findIndex((item, idx) => idx !== currentIdx && item.videoId === targetVideoId);
  if (matchIdx !== -1) {
    return 'queue_jump';
  }

  return 'endpoint_navigation';
}

function executeTieredNavigation(app, watchEndpoint, windowObj) {
  if (app && typeof app.handleNavigationEndpoint === 'function') {
    try {
      app.handleNavigationEndpoint({ watchEndpoint });
      return 'handleNavigationEndpoint';
    } catch (e) {}
  }

  if (app && typeof app.dispatchEvent === 'function') {
    try {
      let dispatched = false;
      const ev = {
        type: 'yt-navigate',
        bubbles: true,
        composed: true,
        detail: {
          endpoint: { watchEndpoint }
        }
      };
      app.dispatchEvent(ev);
      return 'dispatchEvent';
    } catch (e) {}
  }

  if (app && app.navigator && typeof app.navigator.navigate === 'function') {
    try {
      app.navigator.navigate({ watchEndpoint });
      return 'navigator.navigate';
    } catch (e) {}
  }

  if (windowObj && windowObj.location && typeof windowObj.location.assign === 'function') {
    const searchParams = new URLSearchParams();
    searchParams.set('v', watchEndpoint.videoId);
    if (watchEndpoint.startTimeSeconds > 0) {
      searchParams.set('t', watchEndpoint.startTimeSeconds);
    }
    if (watchEndpoint.playlistId) {
      searchParams.set('list', watchEndpoint.playlistId);
    }
    windowObj.location.assign(`/watch?${searchParams.toString()}`);
    return 'location.assign';
  }

  return 'none';
}

function handleBridgeLoadVideo({ currentVid, videoId, currentTime, isPlaying, playlistId, playlistIndex, queueItems, currentQueueIdx, nextBtn, prevBtn, player, app, windowObj }) {
  if (currentVid === videoId) {
    if (typeof currentTime === 'number' && player && typeof player.seekTo === 'function') {
      player.seekTo(currentTime, true);
    }
    if (isPlaying === false) {
      if (player && typeof player.pauseVideo === 'function') player.pauseVideo();
    } else if (isPlaying === true) {
      if (player && typeof player.playVideo === 'function') player.playVideo();
    }
    return { actionTaken: 'same_video_in_place' };
  }

  const items = Array.isArray(queueItems) ? queueItems : [];
  const curIdx = typeof currentQueueIdx === 'number' ? currentQueueIdx : -1;

  const nextItem = curIdx !== -1 && curIdx + 1 < items.length ? items[curIdx + 1] : null;
  if (nextItem && nextItem.videoId === videoId) {
    if (nextBtn && typeof nextBtn.click === 'function') {
      nextBtn.click();
      return { actionTaken: 'native_next' };
    }
  }

  const prevItem = curIdx > 0 && curIdx - 1 < items.length ? items[curIdx - 1] : null;
  if (prevItem && prevItem.videoId === videoId) {
    if (prevBtn && typeof prevBtn.click === 'function') {
      prevBtn.click();
      return { actionTaken: 'native_prev' };
    }
  }

  if (items.length > 0) {
    const matchingItem = items.find(it => it.videoId === videoId);
    if (matchingItem && matchingItem.playBtn && typeof matchingItem.playBtn.click === 'function') {
      matchingItem.playBtn.click();
      return { actionTaken: 'queue_jump' };
    }
  }

  const watchEndpoint = buildWatchEndpoint(videoId, currentTime, playlistId, playlistIndex).watchEndpoint;
  const navMethod = executeTieredNavigation(app, watchEndpoint, windowObj);

  return { actionTaken: 'navigated', navMethod, watchEndpoint };
}

test('buildWatchEndpoint creates valid watchEndpoint with videoId', () => {
  const ep = buildWatchEndpoint('kJQP7kiw5Fk', 0);
  assert.deepStrictEqual(ep, {
    watchEndpoint: { videoId: 'kJQP7kiw5Fk' }
  });
});

test('buildWatchEndpoint includes startTimeSeconds when currentTime > 0', () => {
  const ep = buildWatchEndpoint('kJQP7kiw5Fk', 45.7);
  assert.deepStrictEqual(ep, {
    watchEndpoint: { videoId: 'kJQP7kiw5Fk', startTimeSeconds: 45 }
  });
});

test('shouldCollapsePlayerPage returns true when user is on browse page and player page was closed', () => {
  const result = shouldCollapsePlayerPage(false, '/');
  assert.strictEqual(result, true);

  const libraryResult = shouldCollapsePlayerPage(false, '/library');
  assert.strictEqual(libraryResult, true);

  const exploreResult = shouldCollapsePlayerPage(false, '/explore');
  assert.strictEqual(exploreResult, true);
});

test('shouldCollapsePlayerPage returns false when user is already on watch page', () => {
  const result = shouldCollapsePlayerPage(true, '/');
  assert.strictEqual(result, false);

  const watchResult = shouldCollapsePlayerPage(false, '/watch?v=kJQP7kiw5Fk');
  assert.strictEqual(watchResult, false);
});

function shouldTriggerRemoteTrackChange(packetVideoId, currentVid, lastSyncedVideoId) {
  if (!packetVideoId) return false;
  return packetVideoId !== lastSyncedVideoId || (!!currentVid && packetVideoId !== currentVid);
}

function isHostTrackChangeDetected(currentTrackInfo, lastSentTrack, lastSentArtist, lastSentVideoId) {
  if (!currentTrackInfo) return false;
  return (currentTrackInfo.videoId && currentTrackInfo.videoId !== lastSentVideoId) ||
         currentTrackInfo.track !== lastSentTrack ||
         currentTrackInfo.artist !== lastSentArtist;
}

function shouldPreserveListenerSessionDuringRemoteNavigation(isRemoteSyncing, remoteNavigationPendingVideoId, elapsedSinceTrackChange) {
  if (isRemoteSyncing) return true;
  if (remoteNavigationPendingVideoId) return true;
  if (elapsedSinceTrackChange <= 6000) return true;
  return false;
}

test('buildLoadVideoMessage creates complete message payload with currentTime and isPlaying', () => {
  const msg = buildLoadVideoMessage('kJQP7kiw5Fk', 'Song Title', 'Artist Name', 'https://example.com/art.jpg', 32.5, false);
  assert.strictEqual(msg.source, 'ytm-sync-isolated');
  assert.strictEqual(msg.action, 'LOAD_VIDEO');
  assert.strictEqual(msg.videoId, 'kJQP7kiw5Fk');
  assert.strictEqual(msg.track, 'Song Title');
  assert.strictEqual(msg.artist, 'Artist Name');
  assert.strictEqual(msg.albumArtUrl, 'https://example.com/art.jpg');
  assert.strictEqual(msg.currentTime, 32.5);
  assert.strictEqual(msg.isPlaying, false);
});

test('buildLoadVideoMessage provides safe defaults for missing currentTime and isPlaying', () => {
  const msg = buildLoadVideoMessage('kJQP7kiw5Fk', 'Song Title', 'Artist Name', null, undefined, undefined);
  assert.strictEqual(msg.currentTime, 0);
  assert.strictEqual(msg.isPlaying, true);
});

test('shouldTriggerRemoteTrackChange correctly triggers when currentVid or lastSyncedVideoId differs', () => {
  // New video incoming
  assert.strictEqual(shouldTriggerRemoteTrackChange('vid22222222', 'vid11111111', 'vid11111111'), true);

  // Video was previously synced speculatively, but DOM player is still on old video
  assert.strictEqual(shouldTriggerRemoteTrackChange('vid22222222', 'vid11111111', 'vid22222222'), true);

  // Both DOM and lastSynced already match incoming packet
  assert.strictEqual(shouldTriggerRemoteTrackChange('vid22222222', 'vid22222222', 'vid22222222'), false);

  // Missing packet video ID cannot trigger
  assert.strictEqual(shouldTriggerRemoteTrackChange(null, 'vid11111111', 'vid11111111'), false);
});

test('isHostTrackChangeDetected detects changes by videoId even when title and artist match', () => {
  const track = { videoId: 'vid22222222', track: 'Remix Song', artist: 'Artist A' };
  
  // videoId changed (e.g. remix or album version with identical titles)
  assert.strictEqual(isHostTrackChangeDetected(track, 'Remix Song', 'Artist A', 'vid11111111'), true);

  // title changed
  assert.strictEqual(isHostTrackChangeDetected(track, 'Original Song', 'Artist A', 'vid22222222'), true);

  // identical track
  assert.strictEqual(isHostTrackChangeDetected(track, 'Remix Song', 'Artist A', 'vid22222222'), false);
});

test('shouldPreserveListenerSessionDuringRemoteNavigation protects listener from leaving room during song transitions', () => {
  // Remote sync active
  assert.strictEqual(shouldPreserveListenerSessionDuringRemoteNavigation(true, null, 10000), true);

  // Remote navigation pending
  assert.strictEqual(shouldPreserveListenerSessionDuringRemoteNavigation(false, 'vid22222222', 10000), true);

  // Within 6 second buffer
  assert.strictEqual(shouldPreserveListenerSessionDuringRemoteNavigation(false, null, 3000), true);

  // Safe to detect true user manual departure
  assert.strictEqual(shouldPreserveListenerSessionDuringRemoteNavigation(false, null, 8000), false);
});

test('buildWatchEndpoint includes playlistId when provided', () => {
  const ep = buildWatchEndpoint('kJQP7kiw5Fk', 12, 'RDAMVMkJQP7kiw5Fk');
  assert.deepStrictEqual(ep, {
    watchEndpoint: {
      videoId: 'kJQP7kiw5Fk',
      startTimeSeconds: 12,
      playlistId: 'RDAMVMkJQP7kiw5Fk'
    }
  });
});

test('buildLoadVideoMessage includes playlistId when provided', () => {
  const msg = buildLoadVideoMessage('kJQP7kiw5Fk', 'Song', 'Artist', null, 10, true, 'PL12345');
  assert.strictEqual(msg.playlistId, 'PL12345');
});

test('executeTieredNavigation uses primary handleNavigationEndpoint when available', () => {
  let captured = null;
  const app = {
    handleNavigationEndpoint: (payload) => {
      captured = payload;
    }
  };
  const ep = { videoId: 'kJQP7kiw5Fk', startTimeSeconds: 15 };
  const method = executeTieredNavigation(app, ep, null);
  assert.strictEqual(method, 'handleNavigationEndpoint');
  assert.deepStrictEqual(captured, { watchEndpoint: ep });
});

test('executeTieredNavigation falls back to dispatchEvent yt-navigate if handleNavigationEndpoint throws or missing', () => {
  let capturedEvent = null;
  const app = {
    dispatchEvent: (ev) => {
      capturedEvent = ev;
      return true;
    }
  };
  const ep = { videoId: 'kJQP7kiw5Fk' };
  const method = executeTieredNavigation(app, ep, null);
  assert.strictEqual(method, 'dispatchEvent');
  assert.strictEqual(capturedEvent.type, 'yt-navigate');
  assert.deepStrictEqual(capturedEvent.detail.endpoint, { watchEndpoint: ep });
});

test('executeTieredNavigation falls back to navigator.navigate when DOM event fails', () => {
  let captured = null;
  const app = {
    navigator: {
      navigate: (payload) => {
        captured = payload;
      }
    }
  };
  const ep = { videoId: 'kJQP7kiw5Fk' };
  const method = executeTieredNavigation(app, ep, null);
  assert.strictEqual(method, 'navigator.navigate');
  assert.deepStrictEqual(captured, { watchEndpoint: ep });
});

test('executeTieredNavigation falls back to window.location.assign as last resort', () => {
  let assignedUrl = null;
  const windowObj = {
    location: {
      assign: (url) => {
        assignedUrl = url;
      }
    }
  };
  const ep = { videoId: 'kJQP7kiw5Fk', startTimeSeconds: 40, playlistId: 'PLabc' };
  const method = executeTieredNavigation(null, ep, windowObj);
  assert.strictEqual(method, 'location.assign');
  assert.strictEqual(assignedUrl, '/watch?v=kJQP7kiw5Fk&t=40&list=PLabc');
});

test('handleBridgeLoadVideo performs in-place seek without navigation if video is already active', () => {
  let seekTime = null;
  let played = false;
  const player = {
    seekTo: (t) => { seekTime = t; },
    playVideo: () => { played = true; }
  };
  let navCalled = false;
  const app = {
    handleNavigationEndpoint: () => { navCalled = true; }
  };

  const res = handleBridgeLoadVideo({
    currentVid: 'kJQP7kiw5Fk',
    videoId: 'kJQP7kiw5Fk',
    currentTime: 30,
    isPlaying: true,
    player,
    app
  });

  assert.strictEqual(res.actionTaken, 'same_video_in_place');
  assert.strictEqual(seekTime, 30);
  assert.strictEqual(played, true);
  assert.strictEqual(navCalled, false);
});

test('handleBridgeLoadVideo triggers SPA navigation when a new videoId is received', () => {
  let navPayload = null;
  const app = {
    handleNavigationEndpoint: (p) => { navPayload = p; }
  };

  const res = handleBridgeLoadVideo({
    currentVid: 'oldVideo1111',
    videoId: 'newVideo2222',
    currentTime: 5,
    isPlaying: true,
    playlistId: 'RDmix123',
    app
  });

  assert.strictEqual(res.actionTaken, 'navigated');
  assert.strictEqual(res.navMethod, 'handleNavigationEndpoint');
  assert.deepStrictEqual(navPayload, {
    watchEndpoint: {
      videoId: 'newVideo2222',
      startTimeSeconds: 5,
      playlistId: 'RDmix123'
    }
  });
});

test('buildWatchEndpoint includes playlistIndex when valid integer >= 0', () => {
  const ep = buildWatchEndpoint('kJQP7kiw5Fk', 0, 'PL12345', 4);
  assert.strictEqual(ep.watchEndpoint.index, 4);

  const epNoIndex = buildWatchEndpoint('kJQP7kiw5Fk', 0, 'PL12345', null);
  assert.strictEqual(epNoIndex.watchEndpoint.index, undefined);

  const epNegIndex = buildWatchEndpoint('kJQP7kiw5Fk', 0, 'PL12345', -1);
  assert.strictEqual(epNegIndex.watchEndpoint.index, undefined);
});

test('buildLoadVideoMessage includes playlistIndex and nextVideoId when provided', () => {
  const msg = buildLoadVideoMessage('kJQP7kiw5Fk', 'Title', 'Artist', null, 0, true, 'PL12345', 2, 'nextVid1111');
  assert.strictEqual(msg.playlistIndex, 2);
  assert.strictEqual(msg.nextVideoId, 'nextVid1111');
});

test('determineSkipStrategy selects native_next when target is immediate next song', () => {
  const queueItems = [
    { videoId: 'vid0' },
    { videoId: 'vid1' },
    { videoId: 'vid2' }
  ];
  const strat = determineSkipStrategy({
    targetVideoId: 'vid2',
    currentIdx: 1,
    queueItems
  });
  assert.strictEqual(strat, 'native_next');
});

test('determineSkipStrategy selects native_prev when target is immediate previous song', () => {
  const queueItems = [
    { videoId: 'vid0' },
    { videoId: 'vid1' },
    { videoId: 'vid2' }
  ];
  const strat = determineSkipStrategy({
    targetVideoId: 'vid0',
    currentIdx: 1,
    queueItems
  });
  assert.strictEqual(strat, 'native_prev');
});

test('determineSkipStrategy selects queue_jump when target is elsewhere in queue', () => {
  const queueItems = [
    { videoId: 'vid0' },
    { videoId: 'vid1' },
    { videoId: 'vid2' },
    { videoId: 'vid3' },
    { videoId: 'vid4' }
  ];
  const strat = determineSkipStrategy({
    targetVideoId: 'vid4',
    currentIdx: 1,
    queueItems
  });
  assert.strictEqual(strat, 'queue_jump');
});

test('determineSkipStrategy falls back to endpoint_navigation when target is not in queue', () => {
  const queueItems = [
    { videoId: 'vid0' },
    { videoId: 'vid1' }
  ];
  const strat = determineSkipStrategy({
    targetVideoId: 'vidUnqueued',
    currentIdx: 0,
    queueItems
  });
  assert.strictEqual(strat, 'endpoint_navigation');

  const emptyStrat = determineSkipStrategy({
    targetVideoId: 'vidUnqueued',
    currentIdx: -1,
    queueItems: []
  });
  assert.strictEqual(emptyStrat, 'endpoint_navigation');
});

test('handleBridgeLoadVideo clicks native next button when target is next track', () => {
  let nextClicked = false;
  const nextBtn = { click: () => { nextClicked = true; } };
  const queueItems = [{ videoId: 'vid1' }, { videoId: 'vid2' }];

  const res = handleBridgeLoadVideo({
    currentVid: 'vid1',
    videoId: 'vid2',
    queueItems,
    currentQueueIdx: 0,
    nextBtn
  });

  assert.strictEqual(res.actionTaken, 'native_next');
  assert.strictEqual(nextClicked, true);
});

test('handleBridgeLoadVideo clicks native previous button when target is previous track', () => {
  let prevClicked = false;
  const prevBtn = { click: () => { prevClicked = true; } };
  const queueItems = [{ videoId: 'vid1' }, { videoId: 'vid2' }];

  const res = handleBridgeLoadVideo({
    currentVid: 'vid2',
    videoId: 'vid1',
    queueItems,
    currentQueueIdx: 1,
    prevBtn
  });

  assert.strictEqual(res.actionTaken, 'native_prev');
  assert.strictEqual(prevClicked, true);
});

test('handleBridgeLoadVideo clicks in-queue item play button when target is elsewhere in queue', () => {
  let playClicked = false;
  const queueItems = [
    { videoId: 'vid0' },
    { videoId: 'vid1' },
    { videoId: 'vid2', playBtn: { click: () => { playClicked = true; } } }
  ];

  const res = handleBridgeLoadVideo({
    currentVid: 'vid0',
    videoId: 'vid2',
    queueItems,
    currentQueueIdx: 0
  });

  assert.strictEqual(res.actionTaken, 'queue_jump');
  assert.strictEqual(playClicked, true);
});

test('handleBridgeLoadVideo navigates with playlistId and index when unqueued', () => {
  let navPayload = null;
  const app = {
    handleNavigationEndpoint: (p) => { navPayload = p; }
  };

  const res = handleBridgeLoadVideo({
    currentVid: 'vid0',
    videoId: 'vidUnqueued',
    playlistId: 'PLmix999',
    playlistIndex: 5,
    queueItems: [{ videoId: 'vid0' }],
    currentQueueIdx: 0,
    app
  });

  assert.strictEqual(res.actionTaken, 'navigated');
  assert.deepStrictEqual(navPayload, {
    watchEndpoint: {
      videoId: 'vidUnqueued',
      playlistId: 'PLmix999',
      index: 5
    }
  });
});

runAllTests();
