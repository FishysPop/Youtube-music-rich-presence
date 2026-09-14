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

function buildWatchUrl(videoId, currentTime) {
  const startSec = Math.floor(currentTime || 0);
  const searchParams = new URLSearchParams();
  searchParams.set('v', videoId);
  if (startSec > 0) searchParams.set('t', startSec);
  return `/watch?${searchParams.toString()}`;
}

function shouldCollapsePlayerPage(wasPlayerPageOpen, currentPath) {
  if (wasPlayerPageOpen) return false;
  if (currentPath && currentPath.startsWith('/watch')) return false;
  return true;
}

function buildLoadVideoMessage(videoId, trackTitle, artist, albumArtUrl, currentTime, isPlaying, playlistId, playlistIndex, nextVideoId, forceWatchNavigation) {
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
  if (typeof forceWatchNavigation === 'boolean') {
    msg.forceWatchNavigation = forceWatchNavigation;
  }
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

function formatUpcomingTrackItem(track) {
  if (!track || !track.videoId) return null;
  const thumbUrl = track.albumArtUrl || track.thumbnail || `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`;
  return {
    playlistPanelVideoRenderer: {
      title: { runs: [{ text: track.title || 'Track' }] },
      longBylineText: { runs: [{ text: track.artist || '' }] },
      shortBylineText: { runs: [{ text: track.artist || '' }] },
      videoId: track.videoId,
      selected: false,
      navigationEndpoint: {
        watchEndpoint: {
          videoId: track.videoId
        }
      }
    }
  };
}

function syncQueueProperly(targetUpcomingTracks, queueObj, store) {
  if (!Array.isArray(targetUpcomingTracks) || targetUpcomingTracks.length === 0) return false;
  if (!store || typeof store.dispatch !== 'function') return false;

  const validTracks = targetUpcomingTracks.slice(0, 15).filter(t => t && t.videoId);
  if (validTracks.length === 0) return false;

  const curIdx = (queueObj && typeof queueObj.getCurrentItemIndex === 'function') ? queueObj.getCurrentItemIndex() : 0;
  const targetStartIdx = (typeof curIdx === 'number' && curIdx >= 0) ? curIdx + 1 : 0;

  for (let i = 0; i < validTracks.length; i++) {
    const desiredTrack = validTracks[i];
    const desiredPos = targetStartIdx + i;
    const freshItems = (queueObj && typeof queueObj.getItems === 'function') ? (queueObj.getItems() || []) : [];

    const existingIdx = freshItems.findIndex((it, idx) => idx >= targetStartIdx && it?.playlistPanelVideoRenderer?.videoId === desiredTrack.videoId);

    if (existingIdx === desiredPos) {
      continue;
    } else if (existingIdx > desiredPos) {
      try {
        store.dispatch({
          type: 'MOVE_ITEM',
          payload: { fromIndex: existingIdx, toIndex: desiredPos }
        });
      } catch (e) {}
    } else {
      const formatted = formatUpcomingTrackItem(desiredTrack);
      if (formatted) {
        try {
          store.dispatch({
            type: 'ADD_ITEMS',
            payload: {
              index: desiredPos,
              items: [formatted],
              nextQueueItemId: Math.floor(Math.random() * 1000000),
              shouldAssignIds: true
            }
          });
        } catch (e) {}
      }
    }
  }
  return true;
}

function handleBridgeLoadVideo({
  currentVid,
  videoId,
  currentTime,
  isPlaying,
  queueItems,
  currentQueueIdx,
  nextBtn,
  prevBtn,
  player,
  app,
  store,
  windowObj,
  isOnWatch = true,
  hasActivePlayer = true,
  lastSyncedVideoId = null
}) {
  if (hasActivePlayer && currentVid === videoId) {
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

  // Direct browser navigation is strictly for initial connection without an active player
  if (!hasActivePlayer && !lastSyncedVideoId) {
    const targetUrl = buildWatchUrl(videoId, currentTime);
    if (windowObj && windowObj.location && typeof windowObj.location.assign === 'function') {
      windowObj.location.assign(targetUrl);
    }
    return { actionTaken: 'initial_direct_navigation', targetUrl };
  }

  const items = Array.isArray(queueItems) ? queueItems : [];
  const curIdx = typeof currentQueueIdx === 'number' ? currentQueueIdx : 0;
  const matchingIdx = items.findIndex(it => it?.videoId === videoId || it?.playlistPanelVideoRenderer?.videoId === videoId);

  if (matchingIdx !== -1) {
    if (matchingIdx === curIdx + 1) {
      if (nextBtn && typeof nextBtn.click === 'function' && !nextBtn.disabled) {
        nextBtn.click();
        return { actionTaken: 'native_next' };
      }
    } else if (matchingIdx === curIdx - 1) {
      if (prevBtn && typeof prevBtn.click === 'function' && !prevBtn.disabled) {
        prevBtn.click();
        return { actionTaken: 'native_prev' };
      }
    } else if (store && typeof store.dispatch === 'function') {
      store.dispatch({
        type: 'MOVE_ITEM',
        payload: { fromIndex: matchingIdx, toIndex: curIdx + 1 }
      });
      if (nextBtn && typeof nextBtn.click === 'function' && !nextBtn.disabled) {
        nextBtn.click();
        return { actionTaken: 'move_and_next' };
      }
    }
  }

  if (store && typeof store.dispatch === 'function') {
    const formatted = formatUpcomingTrackItem({ videoId, title: 'Track', artist: '' });
    if (formatted) {
      store.dispatch({
        type: 'ADD_ITEMS',
        payload: {
          index: curIdx + 1,
          items: [formatted],
          nextQueueItemId: 12345,
          shouldAssignIds: true
        }
      });
      if (nextBtn && typeof nextBtn.click === 'function' && !nextBtn.disabled) {
        nextBtn.click();
        return { actionTaken: 'inject_and_next' };
      }
    }
  }

  if (app && typeof app.handleNavigationEndpoint === 'function') {
    app.handleNavigationEndpoint({ watchEndpoint: { videoId } });
    return { actionTaken: 'spa_handle_navigation_endpoint' };
  }

  return { actionTaken: 'none' };
}

test('buildWatchUrl creates standard watch URL with videoId and start time but never includes list parameter', () => {
  const url = buildWatchUrl('eZXKCiUMRlc', 25);
  assert.strictEqual(url, '/watch?v=eZXKCiUMRlc&t=25');
  assert.strictEqual(url.includes('list='), false);

  const pureUrl = buildWatchUrl('eZXKCiUMRlc', 0);
  assert.strictEqual(pureUrl, '/watch?v=eZXKCiUMRlc');
  assert.strictEqual(pureUrl.includes('list='), false);
});

test('handleBridgeLoadVideo triggers initial direct navigation when joining without active player or on home screen', () => {
  let assignedUrl = null;
  const mockWindow = {
    location: {
      assign: (u) => { assignedUrl = u; }
    }
  };

  const res = handleBridgeLoadVideo({
    isOnWatch: false,
    hasActivePlayer: false,
    currentVid: null,
    videoId: 'fJ9rUzIMcZQ',
    currentTime: 10,
    windowObj: mockWindow
  });

  assert.strictEqual(res.actionTaken, 'initial_direct_navigation');
  assert.strictEqual(assignedUrl, '/watch?v=fJ9rUzIMcZQ&t=10');
  assert.strictEqual(assignedUrl.includes('list='), false);
});

test('handleBridgeLoadVideo performs in-place seek without navigation if video is already active', () => {
  let seekTime = null;
  let played = false;
  const player = {
    seekTo: (t) => { seekTime = t; },
    playVideo: () => { played = true; }
  };

  const res = handleBridgeLoadVideo({
    currentVid: 'kJQP7kiw5Fk',
    videoId: 'kJQP7kiw5Fk',
    currentTime: 30,
    isPlaying: true,
    player
  });

  assert.strictEqual(res.actionTaken, 'same_video_in_place');
  assert.strictEqual(seekTime, 30);
  assert.strictEqual(played, true);
});

test('handleBridgeLoadVideo uses internal Redux injection and native next button when track is unqueued on watch page', () => {
  let dispatchedAction = null;
  let nextClicked = false;
  let windowAssignCalled = false;

  const mockStore = {
    dispatch: (a) => { dispatchedAction = a; }
  };
  const mockNextBtn = {
    disabled: false,
    click: () => { nextClicked = true; }
  };
  const mockWindow = {
    location: { assign: () => { windowAssignCalled = true; } }
  };

  const res = handleBridgeLoadVideo({
    isOnWatch: true,
    hasActivePlayer: true,
    currentVid: 'rick1111111',
    videoId: 'despacito222',
    currentQueueIdx: 0,
    queueItems: [{ videoId: 'rick1111111' }],
    store: mockStore,
    nextBtn: mockNextBtn,
    windowObj: mockWindow
  });

  assert.strictEqual(res.actionTaken, 'inject_and_next');
  assert.strictEqual(dispatchedAction.type, 'ADD_ITEMS');
  assert.strictEqual(dispatchedAction.payload.index, 1);
  assert.strictEqual(dispatchedAction.payload.items[0].playlistPanelVideoRenderer.videoId, 'despacito222');
  assert.strictEqual(nextClicked, true);
  assert.strictEqual(windowAssignCalled, false);
});

test('handleBridgeLoadVideo triggers native next button directly when target is adjacent in queue', () => {
  let nextClicked = false;
  const mockNextBtn = {
    disabled: false,
    click: () => { nextClicked = true; }
  };

  const res = handleBridgeLoadVideo({
    isOnWatch: true,
    hasActivePlayer: true,
    currentVid: 'vid11111111',
    videoId: 'vid22222222',
    currentQueueIdx: 0,
    queueItems: [{ videoId: 'vid11111111' }, { videoId: 'vid22222222' }],
    nextBtn: mockNextBtn
  });

  assert.strictEqual(res.actionTaken, 'native_next');
  assert.strictEqual(nextClicked, true);
});

test('handleBridgeLoadVideo uses MOVE_ITEM to advance queued track and clicks nextBtn', () => {
  let dispatchedAction = null;
  let nextClicked = false;

  const mockStore = {
    dispatch: (a) => { dispatchedAction = a; }
  };
  const mockNextBtn = {
    disabled: false,
    click: () => { nextClicked = true; }
  };

  const res = handleBridgeLoadVideo({
    isOnWatch: true,
    hasActivePlayer: true,
    currentVid: 'vid0',
    videoId: 'vid3',
    currentQueueIdx: 0,
    queueItems: [
      { videoId: 'vid0' },
      { videoId: 'vid1' },
      { videoId: 'vid2' },
      { videoId: 'vid3' }
    ],
    store: mockStore,
    nextBtn: mockNextBtn
  });

  assert.strictEqual(res.actionTaken, 'move_and_next');
  assert.strictEqual(dispatchedAction.type, 'MOVE_ITEM');
  assert.strictEqual(dispatchedAction.payload.fromIndex, 3);
  assert.strictEqual(dispatchedAction.payload.toIndex, 1);
  assert.strictEqual(nextClicked, true);
});

test('handleBridgeLoadVideo falls back to app.handleNavigationEndpoint internally without triggering page reload', () => {
  let navEndpointCalled = null;
  let windowAssignCalled = false;

  const mockApp = {
    handleNavigationEndpoint: (ep) => { navEndpointCalled = ep; }
  };
  const mockWindow = {
    location: { assign: () => { windowAssignCalled = true; } }
  };

  const res = handleBridgeLoadVideo({
    isOnWatch: true,
    hasActivePlayer: true,
    currentVid: 'vid0',
    videoId: 'vidSpecial',
    currentQueueIdx: 0,
    queueItems: [{ videoId: 'vid0' }],
    app: mockApp,
    windowObj: mockWindow
  });

  assert.strictEqual(res.actionTaken, 'spa_handle_navigation_endpoint');
  assert.deepStrictEqual(navEndpointCalled, { watchEndpoint: { videoId: 'vidSpecial' } });
  assert.strictEqual(windowAssignCalled, false);
});

test('formatUpcomingTrackItem creates valid playlistPanelVideoRenderer structure', () => {
  const item = formatUpcomingTrackItem({
    videoId: 'DD9THuwNmZE',
    title: 'NIGHTMARE',
    artist: 'WesGhost'
  });
  assert.notStrictEqual(item, null);
  assert.strictEqual(item.playlistPanelVideoRenderer.videoId, 'DD9THuwNmZE');
  assert.strictEqual(item.playlistPanelVideoRenderer.title.runs[0].text, 'NIGHTMARE');
  assert.strictEqual(item.playlistPanelVideoRenderer.selected, false);
});

test('syncQueueProperly dispatches ADD_ITEMS for new upcoming tracks and MOVE_ITEM for existing', () => {
  const dispatched = [];
  const mockStore = {
    dispatch: (a) => dispatched.push(a)
  };
  const mockQueueObj = {
    getCurrentItemIndex: () => 0,
    getItems: () => [
      { playlistPanelVideoRenderer: { videoId: 'cur0' } },
      { playlistPanelVideoRenderer: { videoId: 'unrelated1' } },
      { playlistPanelVideoRenderer: { videoId: 'future2' } }
    ]
  };

  const upcoming = [
    { videoId: 'future2', title: 'Future 2' },
    { videoId: 'brandNew3', title: 'Brand New 3' }
  ];

  const ok = syncQueueProperly(upcoming, mockQueueObj, mockStore);
  assert.strictEqual(ok, true);

  const move = dispatched.find(a => a.type === 'MOVE_ITEM');
  assert.notStrictEqual(move, undefined);
  assert.strictEqual(move.payload.fromIndex, 2);
  assert.strictEqual(move.payload.toIndex, 1);

  const add = dispatched.find(a => a.type === 'ADD_ITEMS');
  assert.notStrictEqual(add, undefined);
  assert.strictEqual(add.payload.items[0].playlistPanelVideoRenderer.videoId, 'brandNew3');
});

function shouldTriggerRemoteTrackChange(packetVideoId, currentVid, lastSyncedVideoId, hasActivePlayer = true) {
  if (!packetVideoId) return false;
  if (!hasActivePlayer && !lastSyncedVideoId) return true;
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

test('shouldTriggerRemoteTrackChange correctly triggers when currentVid or lastSyncedVideoId differs', () => {
  assert.strictEqual(shouldTriggerRemoteTrackChange('vid22222222', 'vid11111111', 'vid11111111'), true);
  assert.strictEqual(shouldTriggerRemoteTrackChange('vid22222222', 'vid11111111', 'vid22222222'), true);
  assert.strictEqual(shouldTriggerRemoteTrackChange('vid22222222', 'vid22222222', 'vid22222222'), false);
  assert.strictEqual(shouldTriggerRemoteTrackChange(null, 'vid11111111', 'vid11111111'), false);
});

test('shouldTriggerRemoteTrackChange does NOT trigger when playing matching track even if on home page or minimized', () => {
  assert.strictEqual(shouldTriggerRemoteTrackChange('vid11111111', 'vid11111111', 'vid11111111', true), false);
});

test('shouldTriggerRemoteTrackChange triggers initial navigation only if hasActivePlayer is false and session not synced', () => {
  assert.strictEqual(shouldTriggerRemoteTrackChange('vid11111111', null, null, false), true);
  assert.strictEqual(shouldTriggerRemoteTrackChange('vid11111111', 'vid11111111', 'vid11111111', false), false);
});

test('handleBridgeLoadVideo on home screen with active player uses internal injection and next button, not window assign', () => {
  let dispatchedAction = null;
  let nextClicked = false;
  let windowAssignCalled = false;

  const mockStore = {
    dispatch: (a) => { dispatchedAction = a; }
  };
  const mockNextBtn = {
    disabled: false,
    click: () => { nextClicked = true; }
  };
  const mockWindow = {
    location: { assign: () => { windowAssignCalled = true; } }
  };

  const res = handleBridgeLoadVideo({
    isOnWatch: false,
    hasActivePlayer: true,
    lastSyncedVideoId: 'rick1111111',
    currentVid: 'rick1111111',
    videoId: 'despacito222',
    currentQueueIdx: 0,
    queueItems: [{ videoId: 'rick1111111' }],
    store: mockStore,
    nextBtn: mockNextBtn,
    windowObj: mockWindow
  });

  assert.strictEqual(res.actionTaken, 'inject_and_next');
  assert.strictEqual(dispatchedAction.type, 'ADD_ITEMS');
  assert.strictEqual(nextClicked, true);
  assert.strictEqual(windowAssignCalled, false);
});

test('handleBridgeLoadVideo on home screen with active player performs in-place seek without navigation', () => {
  let seekTime = null;
  let windowAssignCalled = false;
  const mockPlayer = {
    seekTo: (t) => { seekTime = t; },
    playVideo: () => {}
  };
  const mockWindow = {
    location: { assign: () => { windowAssignCalled = true; } }
  };

  const res = handleBridgeLoadVideo({
    isOnWatch: false,
    hasActivePlayer: true,
    lastSyncedVideoId: 'trackSame11',
    currentVid: 'trackSame11',
    videoId: 'trackSame11',
    currentTime: 42,
    isPlaying: true,
    player: mockPlayer,
    windowObj: mockWindow
  });

  assert.strictEqual(res.actionTaken, 'same_video_in_place');
  assert.strictEqual(seekTime, 42);
  assert.strictEqual(windowAssignCalled, false);
});

test('isHostTrackChangeDetected detects changes by videoId even when title and artist match', () => {
  const track = { videoId: 'vid22222222', track: 'Remix Song', artist: 'Artist A' };
  assert.strictEqual(isHostTrackChangeDetected(track, 'Remix Song', 'Artist A', 'vid11111111'), true);
  assert.strictEqual(isHostTrackChangeDetected(track, 'Original Song', 'Artist A', 'vid22222222'), true);
  assert.strictEqual(isHostTrackChangeDetected(track, 'Remix Song', 'Artist A', 'vid22222222'), false);
});

test('shouldPreserveListenerSessionDuringRemoteNavigation protects listener from leaving room during song transitions', () => {
  assert.strictEqual(shouldPreserveListenerSessionDuringRemoteNavigation(true, null, 10000), true);
  assert.strictEqual(shouldPreserveListenerSessionDuringRemoteNavigation(false, 'vid22222222', 10000), true);
  assert.strictEqual(shouldPreserveListenerSessionDuringRemoteNavigation(false, null, 3000), true);
  assert.strictEqual(shouldPreserveListenerSessionDuringRemoteNavigation(false, null, 8000), false);
});

function resolveAppReadinessState(isDocComplete, hasApp, hasPlayerBar, hasPlayerOrVideo, elapsedMs) {
  if (isDocComplete && hasApp && hasPlayerBar && hasPlayerOrVideo && elapsedMs >= 2000) {
    return { ready: true, delayMs: 0 };
  }
  if (isDocComplete && hasApp && hasPlayerBar && hasPlayerOrVideo) {
    return { ready: true, delayMs: 1000 };
  }
  if (elapsedMs >= 5000) {
    return { ready: true, delayMs: 300 };
  }
  return { ready: false, delayMs: 150 };
}

test('resolveAppReadinessState returns immediate ready when page is complete, elements exist, and elapsed >= 2000ms', () => {
  const res = resolveAppReadinessState(true, true, true, true, 2500);
  assert.strictEqual(res.ready, true);
  assert.strictEqual(res.delayMs, 0);
});

test('resolveAppReadinessState adds 1000ms stabilization delay for freshly loaded page to prevent premature navigation race conditions', () => {
  const res = resolveAppReadinessState(true, true, true, true, 500);
  assert.strictEqual(res.ready, true);
  assert.strictEqual(res.delayMs, 1000);
});

test('resolveAppReadinessState returns not ready when document is incomplete or player elements missing before timeout', () => {
  const res = resolveAppReadinessState(false, true, false, false, 800);
  assert.strictEqual(res.ready, false);
  assert.strictEqual(res.delayMs, 150);
});

test('resolveAppReadinessState recovers safely after 5000ms maximum timeout', () => {
  const res = resolveAppReadinessState(false, false, false, false, 5500);
  assert.strictEqual(res.ready, true);
  assert.strictEqual(res.delayMs, 300);
});

runAllTests();
