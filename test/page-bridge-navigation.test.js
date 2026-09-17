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

function shouldInterceptEventListener(type, target) {
  if (type === 'beforeunload' || type === 'unload') {
    return target === 'window' || target === 'document';
  }
  return false;
}

test('shouldInterceptEventListener: drops beforeunload and unload on window and document', () => {
  assert.strictEqual(shouldInterceptEventListener('beforeunload', 'window'), true);
  assert.strictEqual(shouldInterceptEventListener('unload', 'window'), true);
  assert.strictEqual(shouldInterceptEventListener('unload', 'document'), true);
  assert.strictEqual(shouldInterceptEventListener('click', 'window'), false);
  assert.strictEqual(shouldInterceptEventListener('unload', 'button'), false);
});

function executeNavigationMock(targetVid, targetTime, { doc, app, player } = {}) {
  const startSec = Math.floor(targetTime || 0);
  const watchEndpoint = { videoId: targetVid };
  if (startSec > 0) watchEndpoint.startTimeSeconds = startSec;

  const endpointDetail = {
    clickTrackingParams: '',
    watchEndpoint
  };

  if (doc && typeof doc.dispatchEvent === 'function') {
    try {
      const navEvent = {
        type: 'yt-navigate',
        bubbles: true,
        composed: true,
        detail: { endpoint: endpointDetail }
      };
      doc.dispatchEvent(navEvent);
      return { navigated: true, method: 'document_yt_navigate', detail: endpointDetail };
    } catch (e) {}
  }

  if (app && typeof app.handleNavigationEndpoint === 'function') {
    try {
      app.handleNavigationEndpoint({ watchEndpoint });
      return { navigated: true, method: 'app_handleNavigationEndpoint', detail: { watchEndpoint } };
    } catch (e) {}
  }

  if (app && typeof app.dispatchEvent === 'function') {
    try {
      app.dispatchEvent({ type: 'yt-navigate', bubbles: true, composed: true, detail: { endpoint: endpointDetail } });
      return { navigated: true, method: 'app_yt_navigate', detail: endpointDetail };
    } catch (e) {}
  }

  if (player && typeof player.loadVideoById === 'function') {
    try {
      player.loadVideoById(targetVid, startSec);
      return { navigated: true, method: 'player_loadVideoById' };
    } catch (e) {}
  }

  return { navigated: false, method: 'none' };
}

function handleBridgeLoadVideoDecoupled({
  currentVid,
  videoId,
  currentTime,
  isPlaying,
  hasActivePlayer = true,
  player,
  doc,
  app,
  upcomingTracks,
  store,
  queueObj
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

  const navResult = executeNavigationMock(videoId, currentTime, { doc, app, player });

  let queueSynced = false;
  if (Array.isArray(upcomingTracks) && upcomingTracks.length > 0 && store) {
    queueSynced = syncQueueProperly(upcomingTracks, queueObj, store);
  }

  return {
    actionTaken: 'decoupled_navigation',
    navResult,
    queueSynced
  };
}

function handlePauseActionMock(doc, player) {
  const btn = doc?.querySelector?.('ytmusic-player-bar #play-pause-button button') || doc?.querySelector?.('#play-pause-button button');
  if (btn && typeof btn.click === 'function') {
    btn.click();
    return 'clicked_play_pause_button';
  }
  if (player && typeof player.pauseVideo === 'function') {
    player.pauseVideo();
    return 'called_pauseVideo';
  }
  return 'none';
}

class SuppressionManager {
  constructor() {
    this.suppression = {
      play: 0,
      pause: 0,
      seek: 0,
      pendingTrackId: null
    };
  }

  onPlayRemote() {
    this.suppression.play++;
  }

  onPauseRemote() {
    this.suppression.pause++;
  }

  onSeekRemote() {
    this.suppression.seek++;
  }

  onNavigateRemote(trackId) {
    this.suppression.pendingTrackId = trackId;
  }

  onLoadedMetadata() {
    this.suppression.play = 0;
    this.suppression.pause = 0;
    this.suppression.seek = 0;
    this.suppression.pendingTrackId = null;
  }

  handleLocalPlay() {
    if (this.suppression.play > 0) {
      this.suppression.play--;
      return false;
    }
    return true;
  }

  handleLocalPause() {
    if (this.suppression.pause > 0) {
      this.suppression.pause--;
      return false;
    }
    return true;
  }

  handleLocalSeek() {
    if (this.suppression.seek > 0) {
      this.suppression.seek--;
      return false;
    }
    return true;
  }
}

test('executeNavigationMock dispatches yt-navigate on document with clickTrackingParams and watchEndpoint', () => {
  let dispatched = null;
  const mockDoc = {
    dispatchEvent: (evt) => { dispatched = evt; }
  };

  const res = executeNavigationMock('abc12345678', 15, { doc: mockDoc });
  assert.strictEqual(res.navigated, true);
  assert.strictEqual(res.method, 'document_yt_navigate');
  assert.strictEqual(dispatched.type, 'yt-navigate');
  assert.strictEqual(dispatched.bubbles, true);
  assert.strictEqual(dispatched.composed, true);
  assert.strictEqual(dispatched.detail.endpoint.clickTrackingParams, '');
  assert.strictEqual(dispatched.detail.endpoint.watchEndpoint.videoId, 'abc12345678');
  assert.strictEqual(dispatched.detail.endpoint.watchEndpoint.startTimeSeconds, 15);
});

test('executeNavigationMock falls back through app.handleNavigationEndpoint and player.loadVideoById', () => {
  let endpointPassed = null;
  const mockApp = {
    handleNavigationEndpoint: (ep) => { endpointPassed = ep; }
  };

  const res = executeNavigationMock('xyz98765432', 0, { app: mockApp });
  assert.strictEqual(res.navigated, true);
  assert.strictEqual(res.method, 'app_handleNavigationEndpoint');
  assert.strictEqual(endpointPassed.watchEndpoint.videoId, 'xyz98765432');
  assert.strictEqual(endpointPassed.watchEndpoint.startTimeSeconds, undefined);

  let loadedVid = null;
  let loadedTime = null;
  const mockPlayer = {
    loadVideoById: (v, t) => { loadedVid = v; loadedTime = t; }
  };
  const playerRes = executeNavigationMock('vidFallback1', 5, { player: mockPlayer });
  assert.strictEqual(playerRes.navigated, true);
  assert.strictEqual(playerRes.method, 'player_loadVideoById');
  assert.strictEqual(loadedVid, 'vidFallback1');
  assert.strictEqual(loadedTime, 5);
});

test('handleBridgeLoadVideoDecoupled navigates directly without Redux reorder dependency and decouples queue sync', () => {
  let dispatchedEvt = null;
  const mockDoc = {
    dispatchEvent: (evt) => { dispatchedEvt = evt; }
  };
  const dispatchedStoreActions = [];
  const mockStore = {
    dispatch: (a) => dispatchedStoreActions.push(a)
  };
  const mockQueueObj = {
    getCurrentItemIndex: () => 0,
    getItems: () => []
  };

  const upcoming = [{ videoId: 'upTrack1', title: 'Upcoming 1' }];

  const res = handleBridgeLoadVideoDecoupled({
    currentVid: 'oldTrack1234',
    videoId: 'newTrack5678',
    currentTime: 0,
    isPlaying: true,
    hasActivePlayer: true,
    doc: mockDoc,
    upcomingTracks: upcoming,
    store: mockStore,
    queueObj: mockQueueObj
  });

  assert.strictEqual(res.actionTaken, 'decoupled_navigation');
  assert.strictEqual(res.navResult.method, 'document_yt_navigate');
  assert.strictEqual(dispatchedEvt.detail.endpoint.watchEndpoint.videoId, 'newTrack5678');
  assert.strictEqual(res.queueSynced, true);
  assert.strictEqual(dispatchedStoreActions.some(a => a.type === 'ADD_ITEMS'), true);
});

test('handleBridgeLoadVideoDecoupled performs in-place adjustment when videoId matches current video', () => {
  let seekTime = null;
  let paused = false;
  const mockPlayer = {
    seekTo: (t) => { seekTime = t; },
    pauseVideo: () => { paused = true; }
  };

  const res = handleBridgeLoadVideoDecoupled({
    currentVid: 'sameVid11111',
    videoId: 'sameVid11111',
    currentTime: 45,
    isPlaying: false,
    hasActivePlayer: true,
    player: mockPlayer
  });

  assert.strictEqual(res.actionTaken, 'same_video_in_place');
  assert.strictEqual(seekTime, 45);
  assert.strictEqual(paused, true);
});

test('handlePauseActionMock clicks play-pause button if available in DOM', () => {
  let clicked = false;
  const mockDoc = {
    querySelector: (sel) => {
      if (sel.includes('#play-pause-button button')) {
        return { click: () => { clicked = true; } };
      }
      return null;
    }
  };

  const res = handlePauseActionMock(mockDoc, null);
  assert.strictEqual(res, 'clicked_play_pause_button');
  assert.strictEqual(clicked, true);
});

test('handlePauseActionMock falls back to player.pauseVideo when button is missing', () => {
  let paused = false;
  const mockPlayer = {
    pauseVideo: () => { paused = true; }
  };

  const res = handlePauseActionMock(null, mockPlayer);
  assert.strictEqual(res, 'called_pauseVideo');
  assert.strictEqual(paused, true);
});

test('SuppressionManager suppresses echoed play, pause, seek events and allows user actions', () => {
  const sm = new SuppressionManager();

  sm.onPlayRemote();
  assert.strictEqual(sm.handleLocalPlay(), false);
  assert.strictEqual(sm.handleLocalPlay(), true);

  sm.onPauseRemote();
  assert.strictEqual(sm.handleLocalPause(), false);
  assert.strictEqual(sm.handleLocalPause(), true);

  sm.onSeekRemote();
  assert.strictEqual(sm.handleLocalSeek(), false);
  assert.strictEqual(sm.handleLocalSeek(), true);
});

test('SuppressionManager clears all semaphores and pendingTrackId on loadedmetadata', () => {
  const sm = new SuppressionManager();
  sm.onPlayRemote();
  sm.onPauseRemote();
  sm.onSeekRemote();
  sm.onNavigateRemote('target12345');

  assert.strictEqual(sm.suppression.play, 1);
  assert.strictEqual(sm.suppression.pause, 1);
  assert.strictEqual(sm.suppression.seek, 1);
  assert.strictEqual(sm.suppression.pendingTrackId, 'target12345');

  sm.onLoadedMetadata();

  assert.strictEqual(sm.suppression.play, 0);
  assert.strictEqual(sm.suppression.pause, 0);
  assert.strictEqual(sm.suppression.seek, 0);
  assert.strictEqual(sm.suppression.pendingTrackId, null);
  assert.strictEqual(sm.handleLocalPlay(), true);
  assert.strictEqual(sm.handleLocalPause(), true);
  assert.strictEqual(sm.handleLocalSeek(), true);
});

function cmdChangeTrackMock(videoId, currentTime, { doc, video, suppression, playlistId, playlistIndex } = {}) {
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return false;

  if (video && video.paused && typeof video.play === 'function') {
    video.play();
  }

  if (suppression) {
    suppression.pendingTrackId = videoId;
    suppression.play = (suppression.play || 0) + 1;
    suppression.pause = (suppression.pause || 0) + 1;
    suppression.seek = (suppression.seek || 0) + 1;
  }

  const startSec = Math.floor(currentTime || 0);
  const watchEndpoint = { videoId };
  if (startSec > 0) watchEndpoint.startTimeSeconds = startSec;

  const endpointDetail = {
    endpoint: {
      clickTrackingParams: '',
      watchEndpoint
    }
  };

  const navEvent = {
    type: 'yt-navigate',
    detail: endpointDetail,
    bubbles: true,
    composed: true
  };

  if (doc && typeof doc.dispatchEvent === 'function') {
    doc.dispatchEvent(navEvent);
    return true;
  }
  return false;
}

function cmdNextMock(doc, suppression) {
  if (suppression) {
    suppression.seek = (suppression.seek || 0) + 1;
    suppression.play = (suppression.play || 0) + 1;
  }
  const nextBtn = doc?.querySelector?.('ytmusic-player-bar .next-button button') ||
                  doc?.querySelector?.('ytmusic-player-bar .next-button');
  if (nextBtn && typeof nextBtn.click === 'function') {
    nextBtn.click();
    return true;
  }
  return false;
}

function cmdPreviousMock(doc, suppression) {
  if (suppression) {
    suppression.seek = (suppression.seek || 0) + 1;
    suppression.play = (suppression.play || 0) + 1;
  }
  const prevBtn = doc?.querySelector?.('ytmusic-player-bar .previous-button button') ||
                  doc?.querySelector?.('ytmusic-player-bar .previous-button');
  if (prevBtn && typeof prevBtn.click === 'function') {
    prevBtn.click();
    return true;
  }
  return false;
}

function cmdPlayMock(targetTime, { video, suppression }) {
  if (!video) return false;
  if (typeof targetTime === 'number') {
    if (suppression) suppression.seek = (suppression.seek || 0) + 1;
    video.currentTime = targetTime;
  }
  if (video.paused) {
    if (suppression) suppression.play = (suppression.play || 0) + 1;
    if (typeof video.play === 'function') video.play();
  }
  return true;
}

function cmdPauseMock({ video, suppression, playPauseBtn }) {
  if (!video || video.paused) return false;
  if (suppression) suppression.pause = (suppression.pause || 0) + 1;
  if (playPauseBtn && typeof playPauseBtn.click === 'function') {
    playPauseBtn.click();
  } else if (typeof video.pause === 'function') {
    video.pause();
  }
  return true;
}

function cmdSeekMock(targetTime, { video, suppression }) {
  if (!video || typeof targetTime !== 'number') return false;
  if (suppression) suppression.seek = (suppression.seek || 0) + 1;
  video.currentTime = targetTime;
  return true;
}

function handleVideoEventMock(e, suppression, onValidEvent) {
  if (suppression && suppression.pendingTrackId !== null) {
    return 'suppressed_pending_track';
  }
  if (!e) return 'none';
  if (e.type === 'play') {
    if (suppression && suppression.play > 0) {
      suppression.play--;
      return 'suppressed_play';
    }
    if (onValidEvent) onValidEvent(e);
    return 'handled_play';
  } else if (e.type === 'pause') {
    if (suppression && suppression.pause > 0) {
      suppression.pause--;
      return 'suppressed_pause';
    }
    if (onValidEvent) onValidEvent(e);
    return 'handled_pause';
  }
  return 'none';
}

function handleVideoSeekedMock(suppression, onValidSeek) {
  if (suppression && suppression.pendingTrackId !== null) {
    return 'suppressed_pending_track';
  }
  if (suppression && suppression.seek > 0) {
    suppression.seek--;
    return 'suppressed_seek';
  }
  if (onValidSeek) onValidSeek();
  return 'handled_seek';
}

test('cmdChangeTrackMock unlocks audio, sets pendingTrackId and semaphores, and dispatches yt-navigate directly without Redux', () => {
  let playCalled = false;
  let dispatched = null;
  const mockVideo = {
    paused: true,
    play: () => { playCalled = true; }
  };
  const mockDoc = {
    dispatchEvent: (e) => { dispatched = e; }
  };
  const supp = { pendingTrackId: null, play: 0, pause: 0, seek: 0 };

  const success = cmdChangeTrackMock('kJQP7kiw5Fk', 24, { doc: mockDoc, video: mockVideo, suppression: supp });
  assert.strictEqual(success, true);
  assert.strictEqual(playCalled, true);
  assert.strictEqual(supp.pendingTrackId, 'kJQP7kiw5Fk');
  assert.strictEqual(supp.play, 1);
  assert.strictEqual(supp.pause, 1);
  assert.strictEqual(supp.seek, 1);
  assert.strictEqual(dispatched.type, 'yt-navigate');
  assert.strictEqual(dispatched.bubbles, true);
  assert.strictEqual(dispatched.composed, true);
  assert.strictEqual(dispatched.detail.endpoint.watchEndpoint.videoId, 'kJQP7kiw5Fk');
  assert.strictEqual(dispatched.detail.endpoint.watchEndpoint.startTimeSeconds, 24);
});

test('cmdNextMock and cmdPreviousMock click native player bar skip buttons and increment semaphores', () => {
  let nextClicked = false;
  let prevClicked = false;
  const mockDoc = {
    querySelector: (sel) => {
      if (sel.includes('.next-button')) return { click: () => { nextClicked = true; } };
      if (sel.includes('.previous-button')) return { click: () => { prevClicked = true; } };
      return null;
    }
  };
  const supp = { play: 0, pause: 0, seek: 0 };

  assert.strictEqual(cmdNextMock(mockDoc, supp), true);
  assert.strictEqual(nextClicked, true);
  assert.strictEqual(supp.seek, 1);
  assert.strictEqual(supp.play, 1);

  assert.strictEqual(cmdPreviousMock(mockDoc, supp), true);
  assert.strictEqual(prevClicked, true);
  assert.strictEqual(supp.seek, 2);
  assert.strictEqual(supp.play, 2);
});

test('cmdPlayMock, cmdPauseMock, and cmdSeekMock route commands directly without breaking media window', () => {
  let playCalls = 0;
  let pauseBtnClicked = false;
  const mockVideo = {
    paused: true,
    currentTime: 0,
    play: () => { playCalls++; mockVideo.paused = false; },
    pause: () => { mockVideo.paused = true; }
  };
  const mockBtn = {
    click: () => { pauseBtnClicked = true; mockVideo.paused = true; }
  };
  const supp = { play: 0, pause: 0, seek: 0 };

  cmdPlayMock(12.5, { video: mockVideo, suppression: supp });
  assert.strictEqual(mockVideo.currentTime, 12.5);
  assert.strictEqual(mockVideo.paused, false);
  assert.strictEqual(supp.play, 1);
  assert.strictEqual(supp.seek, 1);

  cmdPauseMock({ video: mockVideo, suppression: supp, playPauseBtn: mockBtn });
  assert.strictEqual(pauseBtnClicked, true);
  assert.strictEqual(mockVideo.paused, true);
  assert.strictEqual(supp.pause, 1);

  cmdSeekMock(45, { video: mockVideo, suppression: supp });
  assert.strictEqual(mockVideo.currentTime, 45);
  assert.strictEqual(supp.seek, 2);
});

test('handleVideoEventMock and handleVideoSeekedMock strictly suppress events when pendingTrackId is set', () => {
  const supp = { pendingTrackId: 'vid123', play: 0, pause: 0, seek: 0 };
  let eventHandled = false;
  let seekHandled = false;

  const playRes = handleVideoEventMock({ type: 'play' }, supp, () => { eventHandled = true; });
  const pauseRes = handleVideoEventMock({ type: 'pause' }, supp, () => { eventHandled = true; });
  const seekRes = handleVideoSeekedMock(supp, () => { seekHandled = true; });

  assert.strictEqual(playRes, 'suppressed_pending_track');
  assert.strictEqual(pauseRes, 'suppressed_pending_track');
  assert.strictEqual(seekRes, 'suppressed_pending_track');
  assert.strictEqual(eventHandled, false);
  assert.strictEqual(seekHandled, false);

  supp.pendingTrackId = null;
  supp.play = 1;
  const playSuppRes = handleVideoEventMock({ type: 'play' }, supp, () => { eventHandled = true; });
  assert.strictEqual(playSuppRes, 'suppressed_play');
  assert.strictEqual(supp.play, 0);
  assert.strictEqual(eventHandled, false);

  const playHandledRes = handleVideoEventMock({ type: 'play' }, supp, () => { eventHandled = true; });
  assert.strictEqual(playHandledRes, 'handled_play');
  assert.strictEqual(eventHandled, true);
});

test('cmdChangeTrackMock strictly excludes playlistId and index from watchEndpoint to prevent per-user radio queue generation (&list=...)', () => {
  let dispatched = null;
  const mockDoc = {
    dispatchEvent: (e) => { dispatched = e; }
  };
  const supp = { pendingTrackId: null, play: 0, pause: 0, seek: 0 };

  const success = cmdChangeTrackMock('kJQP7kiw5Fk', 10, {
    doc: mockDoc,
    suppression: supp,
    playlistId: 'RDAMVM_dBW9bQA5PE',
    playlistIndex: 5
  });

  assert.strictEqual(success, true);
  assert.strictEqual(dispatched.type, 'yt-navigate');
  assert.strictEqual(dispatched.detail.endpoint.watchEndpoint.videoId, 'kJQP7kiw5Fk');
  assert.strictEqual(dispatched.detail.endpoint.watchEndpoint.playlistId, undefined);
  assert.strictEqual(dispatched.detail.endpoint.watchEndpoint.index, undefined);
  assert.strictEqual(dispatched.detail.endpoint.watchEndpoint.startTimeSeconds, 10);
});

function renderSessionQueuePanelMock(upcomingTracks, isListener, doc) {
  let panel = doc.getElementById('ytm-session-queue-panel');
  let styleEl = doc.getElementById('ytm-session-queue-style');
  if (!isListener || !Array.isArray(upcomingTracks) || upcomingTracks.length === 0) {
    if (panel && typeof panel.remove === 'function') panel.remove();
    if (styleEl && typeof styleEl.remove === 'function') styleEl.remove();
    return null;
  }

  const queueDrawer = doc.querySelector('ytmusic-player-queue') || doc.body;
  const contents = queueDrawer.querySelector ? queueDrawer.querySelector('#contents') : null;

  if (!panel) {
    panel = doc.createElement('div');
    panel.id = 'ytm-session-queue-panel';
    panel.style = { background: 'transparent', border: 'none', margin: '0' };
    if (contents && queueDrawer.insertBefore) {
      queueDrawer.insertBefore(panel, contents.nextSibling);
    } else if (queueDrawer.appendChild) {
      queueDrawer.appendChild(panel);
    }
  }

  if (!styleEl && doc.head && doc.createElement) {
    styleEl = doc.createElement('style');
    styleEl.id = 'ytm-session-queue-style';
    doc.head.appendChild(styleEl);
  }

  panel.items = upcomingTracks.map(t => ({
    videoId: t.videoId,
    title: t.title,
    artist: t.artist,
    durationText: t.durationText || ''
  }));
  panel.renderedCount = upcomingTracks.length;
  panel.matchesPage = panel.style.background === 'transparent' && panel.style.border === 'none';
  return panel;
}

test('renderSessionQueuePanelMock matches page styling, places after contents, and manages queue styles', () => {
  let removedPanel = false;
  let removedStyle = false;
  const queueChildren = [];
  const headChildren = [];

  const mockContents = { id: 'contents', nextSibling: null };
  queueChildren.push(mockContents);

  const mockPanel = {
    id: 'ytm-session-queue-panel',
    style: {},
    remove: () => { removedPanel = true; }
  };
  const mockStyle = {
    id: 'ytm-session-queue-style',
    remove: () => { removedStyle = true; }
  };

  const mockDrawer = {
    querySelector: (sel) => (sel === '#contents' ? mockContents : null),
    insertBefore: (el, ref) => {
      queueChildren.push(el);
      el._insertedAfter = ref;
    },
    appendChild: (el) => queueChildren.push(el)
  };

  const mockDoc = {
    getElementById: (id) => {
      if (id === 'ytm-session-queue-panel') return queueChildren.find(c => c.id === 'ytm-session-queue-panel') || null;
      if (id === 'ytm-session-queue-style') return headChildren.find(c => c.id === 'ytm-session-queue-style') || null;
      return null;
    },
    createElement: (tag) => ({ tag, id: '', style: {} }),
    querySelector: () => mockDrawer,
    head: {
      appendChild: (el) => headChildren.push(el)
    },
    body: mockDrawer
  };

  const tracks = [
    { videoId: 'vampira1234', title: 'Vampira', artist: 'Willyrodriguezwastaken', durationText: '1:54' },
    { videoId: 'routine1234', title: 'Routine', artist: 'muque', durationText: '2:32' }
  ];

  const panel = renderSessionQueuePanelMock(tracks, true, mockDoc);
  assert.notStrictEqual(panel, null);
  assert.strictEqual(panel.renderedCount, 2);
  assert.strictEqual(panel.matchesPage, true);
  assert.strictEqual(panel.items[0].title, 'Vampira');
  assert.strictEqual(panel.items[0].durationText, '1:54');
  assert.strictEqual(headChildren.length, 1);
  assert.strictEqual(headChildren[0].id, 'ytm-session-queue-style');

  renderSessionQueuePanelMock([], false, {
    getElementById: (id) => (id === 'ytm-session-queue-panel' ? mockPanel : (id === 'ytm-session-queue-style' ? mockStyle : null)),
    querySelector: () => mockDrawer,
    head: { appendChild: () => {} },
    body: mockDrawer
  });
  assert.strictEqual(removedPanel, true);
  assert.strictEqual(removedStyle, true);
});

function extractCurrentPlaylistContextMock({ searchStr, bridgeAttrList, bridgeAttrIdx, playerList, playerIdx, domLinkHref }) {
  let playlistId = null;
  let playlistIndex = null;

  if (bridgeAttrList && /^[a-zA-Z0-9_-]+$/.test(bridgeAttrList)) {
    playlistId = bridgeAttrList;
  }
  if (bridgeAttrIdx !== undefined && bridgeAttrIdx !== null && !isNaN(Number(bridgeAttrIdx))) {
    playlistIndex = parseInt(bridgeAttrIdx, 10);
  }

  if (!playlistId && searchStr) {
    const params = new URLSearchParams(searchStr);
    const list = params.get('list');
    if (list && /^[a-zA-Z0-9_-]+$/.test(list)) {
      playlistId = list;
    }
    const idx = params.get('index');
    if (idx !== null && !isNaN(Number(idx))) {
      playlistIndex = parseInt(idx, 10);
    }
  }

  if (!playlistId && playerList) {
    playlistId = playerList;
    if (typeof playerIdx === 'number') playlistIndex = playerIdx;
  }

  if (!playlistId && domLinkHref) {
    const m = domLinkHref.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (m) playlistId = m[1];
  }

  return { playlistId, playlistIndex };
}

test('extractCurrentPlaylistContextMock extracts playlistId and index with complete fallback chain', () => {
  const fromBridge = extractCurrentPlaylistContextMock({ bridgeAttrList: 'RDCLAK5uy_abc', bridgeAttrIdx: '3' });
  assert.strictEqual(fromBridge.playlistId, 'RDCLAK5uy_abc');
  assert.strictEqual(fromBridge.playlistIndex, 3);

  const fromUrl = extractCurrentPlaylistContextMock({ searchStr: '?v=123&list=RDAMVM456&index=7' });
  assert.strictEqual(fromUrl.playlistId, 'RDAMVM456');
  assert.strictEqual(fromUrl.playlistIndex, 7);

  const fromDomLink = extractCurrentPlaylistContextMock({ domLinkHref: 'https://music.youtube.com/watch?v=abc&list=PL12345' });
  assert.strictEqual(fromDomLink.playlistId, 'PL12345');
});

function extractQueueTrackItemMock(it) {
  if (!it || typeof it !== 'object') return null;

  let r = it.playlistPanelVideoRenderer || null;
  if (!r && it.playlistPanelVideoWrapperRenderer) {
    const wrapper = it.playlistPanelVideoWrapperRenderer;
    r = wrapper.primaryRenderer?.playlistPanelVideoRenderer ||
        wrapper.playlistPanelVideoRenderer ||
        wrapper.counterpart?.[0]?.counterpartRenderer?.playlistPanelVideoRenderer ||
        null;
  }
  if (!r && it.musicResponsiveListItemRenderer) {
    r = it.musicResponsiveListItemRenderer;
  }
  if (!r && (it.videoId || (it.navigationEndpoint?.watchEndpoint?.videoId))) {
    r = it;
  }

  if (!r) return null;

  const videoId = r.videoId ||
                  r.playlistItemData?.videoId ||
                  r.navigationEndpoint?.watchEndpoint?.videoId ||
                  r.onTap?.watchEndpoint?.videoId ||
                  null;

  if (!videoId || typeof videoId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return null;
  }

  function getText(obj) {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    if (Array.isArray(obj.runs)) {
      return obj.runs.map(run => (run && typeof run.text === 'string') ? run.text : '').join('');
    }
    if (typeof obj.simpleText === 'string') return obj.simpleText;
    return '';
  }

  const title = getText(r.title) ||
                getText(r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text) ||
                '';

  const artist = getText(r.shortBylineText) ||
                 getText(r.longBylineText) ||
                 getText(r.bylineText) ||
                 getText(r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text) ||
                 '';

  const durationText = getText(r.lengthText) ||
                       getText(r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text) ||
                       '';

  let thumbnail = null;
  if (typeof r.thumbnail === 'string') {
    thumbnail = r.thumbnail;
  } else if (r.thumbnail?.thumbnails && Array.isArray(r.thumbnail.thumbnails) && r.thumbnail.thumbnails.length > 0) {
    thumbnail = r.thumbnail.thumbnails[0]?.url || null;
  }
  if (!thumbnail && typeof r.albumArtUrl === 'string') {
    thumbnail = r.albumArtUrl;
  }
  if (!thumbnail) {
    thumbnail = `https://i.ytimg.com/vi/${videoId}/default.jpg`;
  }

  return {
    videoId,
    title: title.trim(),
    artist: artist.trim(),
    durationText: durationText.trim(),
    thumbnail
  };
}

function getUpcomingTracksFromQueueMock(items, currentQueueIdx, currentVid) {
  if (!items || items.length === 0) return [];
  let resolvedIdx = currentQueueIdx;
  if ((typeof resolvedIdx !== 'number' || resolvedIdx === -1) && currentVid) {
    resolvedIdx = items.findIndex(it => {
      const item = extractQueueTrackItemMock(it);
      return item && item.videoId === currentVid;
    });
  }
  if (resolvedIdx === -1) return [];
  const upcoming = [];
  for (let i = resolvedIdx + 1; i < items.length && upcoming.length < 15; i++) {
    const track = extractQueueTrackItemMock(items[i]);
    if (track) upcoming.push(track);
  }
  return upcoming;
}

test('extractQueueTrackItem extracts standard playlistPanelVideoRenderer items', () => {
  const item = {
    playlistPanelVideoRenderer: {
      videoId: 'standard001',
      title: { runs: [{ text: "Charlie's Inferno" }] },
      shortBylineText: { runs: [{ text: 'That Handsome Devil' }] },
      lengthText: { runs: [{ text: '3:01' }] },
      thumbnail: { thumbnails: [{ url: 'https://img.youtube.com/vi/standard001/default.jpg' }] }
    }
  };
  const extracted = extractQueueTrackItemMock(item);
  assert.notStrictEqual(extracted, null);
  assert.strictEqual(extracted.videoId, 'standard001');
  assert.strictEqual(extracted.title, "Charlie's Inferno");
  assert.strictEqual(extracted.artist, 'That Handsome Devil');
  assert.strictEqual(extracted.durationText, '3:01');
  assert.strictEqual(extracted.thumbnail, 'https://img.youtube.com/vi/standard001/default.jpg');
});

test('extractQueueTrackItem unpacks playlistPanelVideoWrapperRenderer (official music video wrapper)', () => {
  const item = {
    playlistPanelVideoWrapperRenderer: {
      primaryRenderer: {
        playlistPanelVideoRenderer: {
          videoId: 'spineless01',
          title: { runs: [{ text: 'Spineless' }] },
          shortBylineText: { runs: [{ text: 'loveshy' }] },
          lengthText: { simpleText: '2:45' },
          thumbnail: { thumbnails: [{ url: 'https://img.youtube.com/vi/spineless01/default.jpg' }] }
        }
      },
      counterpart: [
        { counterpartRenderer: { playlistPanelVideoRenderer: { videoId: 'spineless99' } } }
      ]
    }
  };
  const extracted = extractQueueTrackItemMock(item);
  assert.notStrictEqual(extracted, null);
  assert.strictEqual(extracted.videoId, 'spineless01');
  assert.strictEqual(extracted.title, 'Spineless');
  assert.strictEqual(extracted.artist, 'loveshy');
  assert.strictEqual(extracted.durationText, '2:45');
});

test('extractQueueTrackItem unpacks direct wrapper renderer, responsive renderer, and flat objects', () => {
  const directWrapper = {
    playlistPanelVideoWrapperRenderer: {
      playlistPanelVideoRenderer: {
        videoId: 'directWrap1',
        title: { simpleText: 'SOMEWHERE ELSE' },
        shortBylineText: { simpleText: 'Mickey Darling' },
        lengthText: { simpleText: '2:18' }
      }
    }
  };
  const extDirect = extractQueueTrackItemMock(directWrapper);
  assert.strictEqual(extDirect.videoId, 'directWrap1');
  assert.strictEqual(extDirect.title, 'SOMEWHERE ELSE');
  assert.strictEqual(extDirect.artist, 'Mickey Darling');

  const responsiveItem = {
    musicResponsiveListItemRenderer: {
      playlistItemData: { videoId: 'yoasobiGun1' },
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: '群青' }] } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'YOASOBI' }] } } }
      ],
      fixedColumns: [
        { musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: '4:08' }] } } }
      ]
    }
  };
  const extResp = extractQueueTrackItemMock(responsiveItem);
  assert.strictEqual(extResp.videoId, 'yoasobiGun1');
  assert.strictEqual(extResp.title, '群青');
  assert.strictEqual(extResp.artist, 'YOASOBI');
  assert.strictEqual(extResp.durationText, '4:08');

  const flatItem = {
    videoId: 'thxSoMch001',
    title: 'i have a secret',
    shortBylineText: 'ThxSoMch',
    lengthText: '2:15'
  };
  const extFlat = extractQueueTrackItemMock(flatItem);
  assert.strictEqual(extFlat.videoId, 'thxSoMch001');
  assert.strictEqual(extFlat.title, 'i have a secret');
  assert.strictEqual(extFlat.artist, 'ThxSoMch');
  assert.strictEqual(extFlat.durationText, '2:15');
});

test('getUpcomingTracksFromQueueMock preserves exact sequence of 13 tracks without skipping wrapper items', () => {
  const currentItem = {
    playlistPanelVideoRenderer: {
      videoId: 'milkhoney00',
      title: { simpleText: 'Milk and Honey' },
      shortBylineText: { simpleText: 'Jackson C. Frank' }
    }
  };

  const queueItems = [
    currentItem,
    { playlistPanelVideoRenderer: { videoId: 'emotengine0', title: { simpleText: 'emotion engine' }, shortBylineText: { simpleText: 'Kaiyko' }, lengthText: { simpleText: '2:30' } } },
    { playlistPanelVideoRenderer: { videoId: 'charlieinf0', title: { simpleText: "Charlie's Inferno" }, shortBylineText: { simpleText: 'That Handsome Devil' }, lengthText: { simpleText: '3:01' } } },
    { playlistPanelVideoRenderer: { videoId: 'destinyhdk0', title: { simpleText: 'MY DESTINY HARDTEKK' }, shortBylineText: { simpleText: 'Hardtekk' }, lengthText: { simpleText: '2:40' } } },
    { playlistPanelVideoWrapperRenderer: { primaryRenderer: { playlistPanelVideoRenderer: { videoId: 'spineless01', title: { simpleText: 'Spineless' }, shortBylineText: { simpleText: 'loveshy' }, lengthText: { simpleText: '2:45' } } } } },
    { playlistPanelVideoRenderer: { videoId: 'girlnextdr0', title: { simpleText: 'Girl next door' }, shortBylineText: { simpleText: 'Artist 5' }, lengthText: { simpleText: '3:10' } } },
    { playlistPanelVideoWrapperRenderer: { primaryRenderer: { playlistPanelVideoRenderer: { videoId: 'somewhere01', title: { simpleText: 'SOMEWHERE ELSE' }, shortBylineText: { simpleText: 'Mickey Darling' }, lengthText: { simpleText: '2:18' } } } } },
    { playlistPanelVideoRenderer: { videoId: 'boytoytrack', title: { simpleText: 'Boy Toy' }, shortBylineText: { simpleText: 'Artist 7' }, lengthText: { simpleText: '2:50' } } },
    { playlistPanelVideoRenderer: { videoId: 'addictionsl', title: { simpleText: 'addiction (Slowed)' }, shortBylineText: { simpleText: 'Artist 8' }, lengthText: { simpleText: '3:20' } } },
    { playlistPanelVideoWrapperRenderer: { primaryRenderer: { playlistPanelVideoRenderer: { videoId: 'yoasobiGun1', title: { simpleText: '群青' }, shortBylineText: { simpleText: 'YOASOBI' }, lengthText: { simpleText: '4:08' } } } } },
    { playlistPanelVideoWrapperRenderer: { primaryRenderer: { playlistPanelVideoRenderer: { videoId: 'thxSoMch001', title: { simpleText: 'i have a secret' }, shortBylineText: { simpleText: 'ThxSoMch' }, lengthText: { simpleText: '2:15' } } } } },
    { playlistPanelVideoRenderer: { videoId: 'wayuwantit0', title: { simpleText: "if that's the way u want it" }, shortBylineText: { simpleText: 'Artist 11' }, lengthText: { simpleText: '2:55' } } },
    { playlistPanelVideoRenderer: { videoId: 'clichetrack', title: { simpleText: 'cliche' }, shortBylineText: { simpleText: 'Artist 12' }, lengthText: { simpleText: '3:05' } } },
    { playlistPanelVideoRenderer: { videoId: 'aneater0000', title: { simpleText: 'An Eater' }, shortBylineText: { simpleText: 'Artist 13' }, lengthText: { simpleText: '2:40' } } }
  ];

  const upcoming = getUpcomingTracksFromQueueMock(queueItems, 0, 'milkhoney00');
  assert.strictEqual(upcoming.length, 13);
  assert.strictEqual(upcoming[0].title, 'emotion engine');
  assert.strictEqual(upcoming[1].title, "Charlie's Inferno");
  assert.strictEqual(upcoming[2].title, 'MY DESTINY HARDTEKK');
  assert.strictEqual(upcoming[3].title, 'Spineless');
  assert.strictEqual(upcoming[4].title, 'Girl next door');
  assert.strictEqual(upcoming[5].title, 'SOMEWHERE ELSE');
  assert.strictEqual(upcoming[6].title, 'Boy Toy');
  assert.strictEqual(upcoming[7].title, 'addiction (Slowed)');
  assert.strictEqual(upcoming[8].title, '群青');
  assert.strictEqual(upcoming[9].title, 'i have a secret');
  assert.strictEqual(upcoming[10].title, "if that's the way u want it");
  assert.strictEqual(upcoming[11].title, 'cliche');
  assert.strictEqual(upcoming[12].title, 'An Eater');
});

test('getUpcomingTracksFromQueueMock accurately resolves currentQueueIdx when active track is wrapped', () => {
  const queueItems = [
    { playlistPanelVideoRenderer: { videoId: 'prevTrack00', title: { simpleText: 'Previous' } } },
    { playlistPanelVideoWrapperRenderer: { primaryRenderer: { playlistPanelVideoRenderer: { videoId: 'spineless01', title: { simpleText: 'Spineless' } } } } },
    { playlistPanelVideoRenderer: { videoId: 'nextTrack01', title: { simpleText: 'Next Track 1' } } },
    { playlistPanelVideoWrapperRenderer: { primaryRenderer: { playlistPanelVideoRenderer: { videoId: 'nextTrack02', title: { simpleText: 'Next Track 2' } } } } }
  ];

  const upcoming = getUpcomingTracksFromQueueMock(queueItems, -1, 'spineless01');
  assert.strictEqual(upcoming.length, 2);
  assert.strictEqual(upcoming[0].videoId, 'nextTrack01');
  assert.strictEqual(upcoming[0].title, 'Next Track 1');
  assert.strictEqual(upcoming[1].videoId, 'nextTrack02');
  assert.strictEqual(upcoming[1].title, 'Next Track 2');
});

function extractDomQueueTracksMock(domItems, currentVid) {
  const currentIdx = domItems.findIndex(el =>
    el.hasAttribute?.('selected') ||
    el.selected ||
    (currentVid && extractQueueTrackItemMock(el.data)?.videoId === currentVid) ||
    Boolean(currentVid && el.querySelector?.(`a[href*="v=${currentVid}"]`))
  );

  if (currentIdx === -1 || domItems.length <= currentIdx + 1) return [];

  const upcoming = [];
  for (let i = currentIdx + 1; i < domItems.length && upcoming.length < 15; i++) {
    const el = domItems[i];
    let item = extractQueueTrackItemMock(el.data);
    if (!item) {
      const titleEl = el.querySelector?.('.song-title');
      const artistEl = el.querySelector?.('.byline');
      const durEl = el.querySelector?.('.duration');
      const imgEl = el.querySelector?.('img');
      const link = el.querySelector?.('a[href*="v="]');
      let vId = null;
      if (link && link.href) {
        const m = link.href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
        if (m) vId = m[1];
      }
      if (!vId && imgEl && imgEl.src) {
        const m = imgEl.src.match(/\/(?:vi|vi_webp)\/([a-zA-Z0-9_-]{11})\//);
        if (m) vId = m[1];
      }
      if (vId) {
        item = {
          videoId: vId,
          title: titleEl ? titleEl.textContent : '',
          artist: artistEl ? artistEl.textContent : '',
          durationText: durEl ? durEl.textContent : '',
          thumbnail: imgEl ? imgEl.src : `https://i.ytimg.com/vi/${vId}/default.jpg`
        };
      }
    }
    if (item && item.videoId) {
      upcoming.push(item);
    }
  }
  return upcoming;
}

test('extractDomQueueTracksMock extracts tracks from DOM elements with wrapper data or child fallback', () => {
  const domItems = [
    {
      data: { playlistPanelVideoRenderer: { videoId: 'playingVid1' } },
      hasAttribute: () => false
    },
    {
      data: {
        playlistPanelVideoWrapperRenderer: {
          primaryRenderer: {
            playlistPanelVideoRenderer: {
              videoId: 'wrapTrack01',
              title: { simpleText: 'Spineless' },
              shortBylineText: { simpleText: 'loveshy' }
            }
          }
        }
      }
    },
    {
      data: null,
      querySelector: (sel) => {
        if (sel === '.song-title') return { textContent: 'DOM Scraped Song' };
        if (sel === '.byline') return { textContent: 'DOM Scraped Artist' };
        if (sel === '.duration') return { textContent: '3:33' };
        if (sel === 'img') return { src: 'https://i.ytimg.com/vi/domScraped1/default.jpg' };
        if (sel === 'a[href*="v="]') return { href: 'https://music.youtube.com/watch?v=domScraped1' };
        return null;
      }
    }
  ];

  const extracted = extractDomQueueTracksMock(domItems, 'playingVid1');
  assert.strictEqual(extracted.length, 2);
  assert.strictEqual(extracted[0].videoId, 'wrapTrack01');
  assert.strictEqual(extracted[0].title, 'Spineless');
  assert.strictEqual(extracted[1].videoId, 'domScraped1');
  assert.strictEqual(extracted[1].title, 'DOM Scraped Song');
});

function disableAutoplayForConnectedClientMock(isListener, doc) {
  if (!isListener) return false;
  let clicked = false;
  const toggles = doc.querySelectorAll('tp-yt-paper-toggle-button, paper-toggle-button');
  for (const toggle of toggles) {
    const parent = toggle.parentElement;
    const text = ((parent ? parent.textContent : '') + ' ' + (toggle.ariaLabel || '')).toLowerCase();
    if (text.includes('auto-play') || text.includes('autoplay') || text.includes('add similar content')) {
      if (toggle.checked) {
        toggle.click();
        toggle.checked = false;
        clicked = true;
      }
    }
  }
  return clicked;
}

test('disableAutoplayForConnectedClientMock: clicks and disables toggle only for listener', () => {
  const makeMockToggle = (checked = true) => ({
    checked,
    ariaLabel: 'Auto-play',
    clickedCount: 0,
    parentElement: { textContent: 'Auto-play Add similar content to the end of the queue' },
    click() {
      this.clickedCount++;
    }
  });

  const activeToggle = makeMockToggle(true);
  const mockDoc = {
    querySelectorAll: (sel) => [activeToggle]
  };

  const hostResult = disableAutoplayForConnectedClientMock(false, mockDoc);
  assert.strictEqual(hostResult, false);
  assert.strictEqual(activeToggle.clickedCount, 0);
  assert.strictEqual(activeToggle.checked, true);

  const listenerResult = disableAutoplayForConnectedClientMock(true, mockDoc);
  assert.strictEqual(listenerResult, true);
  assert.strictEqual(activeToggle.clickedCount, 1);
  assert.strictEqual(activeToggle.checked, false);

  const secondRun = disableAutoplayForConnectedClientMock(true, mockDoc);
  assert.strictEqual(secondRun, false);
  assert.strictEqual(activeToggle.clickedCount, 1);
});

test('getUpcomingTracksFromQueueMock: preserves exact 11 tracks from Supermix screenshot in sequence without dropping wrapped tracks or shuffling', () => {
  const supermixItems = [
    {
      playlistPanelVideoWrapperRenderer: {
        primaryRenderer: {
          playlistPanelVideoRenderer: {
            videoId: 'shesTooPerf',
            title: { simpleText: "She's Too Perfect" },
            shortBylineText: { simpleText: 'blehh' },
            lengthText: { simpleText: '1:34' }
          }
        }
      }
    },
    {
      playlistPanelVideoWrapperRenderer: {
        primaryRenderer: {
          playlistPanelVideoRenderer: {
            videoId: 'chainsaw001',
            title: { simpleText: 'Chainsaw' },
            shortBylineText: { simpleText: 'Clark Rainbow' },
            lengthText: { simpleText: '2:42' }
          }
        }
      }
    },
    {
      playlistPanelVideoRenderer: {
        videoId: 'bloodCover1',
        title: { simpleText: 'you look good covered in my blood' },
        shortBylineText: { simpleText: 'aWannabe' },
        lengthText: { simpleText: '2:48' }
      }
    },
    {
      playlistPanelVideoWrapperRenderer: {
        primaryRenderer: {
          playlistPanelVideoRenderer: {
            videoId: 'worseProm01',
            title: { simpleText: 'it only gets worse, i promise' },
            shortBylineText: { simpleText: 'Ekkstacy' },
            lengthText: { simpleText: '2:35' }
          }
        }
      }
    },
    {
      playlistPanelVideoWrapperRenderer: {
        primaryRenderer: {
          playlistPanelVideoRenderer: {
            videoId: 'papercuts01',
            title: { simpleText: 'PAPERCUTS' },
            shortBylineText: { simpleText: 'WesGhost' },
            lengthText: { simpleText: '2:56' }
          }
        }
      }
    },
    {
      playlistPanelVideoRenderer: {
        videoId: 'lovingMeH01',
        title: { runs: [{ text: 'loving me is really hard' }] },
        shortBylineText: { runs: [{ text: 'NESYA' }] },
        lengthText: { simpleText: '2:08' }
      }
    },
    {
      playlistPanelVideoWrapperRenderer: {
        primaryRenderer: {
          playlistPanelVideoRenderer: {
            videoId: 'dropout0001',
            title: { runs: [{ text: 'dropout' }] },
            shortBylineText: { runs: [{ text: 'overtonight' }] },
            lengthText: { simpleText: '2:12' }
          }
        }
      }
    },
    {
      playlistPanelVideoWrapperRenderer: {
        primaryRenderer: {
          playlistPanelVideoRenderer: {
            videoId: 'unhinged001',
            title: { runs: [{ text: 'Unhinged' }] },
            shortBylineText: { runs: [{ text: 'ThxSoMch' }] },
            lengthText: { simpleText: '2:04' }
          }
        }
      }
    },
    {
      playlistPanelVideoRenderer: {
        videoId: 'regretful01',
        title: { simpleText: 'regretful' },
        shortBylineText: { simpleText: 'Leverfall' },
        lengthText: { simpleText: '1:23' }
      }
    },
    {
      playlistPanelVideoWrapperRenderer: {
        primaryRenderer: {
          playlistPanelVideoRenderer: {
            videoId: 'browneyes01',
            title: { runs: [{ text: 'brown eyes*' }] },
            shortBylineText: { runs: [{ text: 're6ce' }] },
            lengthText: { simpleText: '2:44' }
          }
        }
      }
    },
    {
      playlistPanelVideoWrapperRenderer: {
        primaryRenderer: {
          playlistPanelVideoRenderer: {
            videoId: 'tantrum0001',
            title: { simpleText: 'Tantrum (Pace Yourself)' },
            shortBylineText: { simpleText: 'Riovaz' },
            lengthText: { simpleText: '2:04' }
          }
        }
      }
    },
    {
      playlistPanelVideoRenderer: {
        videoId: 'unknowing01',
        title: { simpleText: 'The Unknowing' },
        shortBylineText: { simpleText: 'Jfarrari' },
        lengthText: { simpleText: '3:18' }
      }
    }
  ];

  const upcoming = getUpcomingTracksFromQueueMock(supermixItems, -1, 'shesTooPerf');
  assert.strictEqual(upcoming.length, 11);

  assert.strictEqual(upcoming[0].videoId, 'chainsaw001');
  assert.strictEqual(upcoming[0].title, 'Chainsaw');
  assert.strictEqual(upcoming[0].artist, 'Clark Rainbow');

  assert.strictEqual(upcoming[1].videoId, 'bloodCover1');
  assert.strictEqual(upcoming[1].title, 'you look good covered in my blood');
  assert.strictEqual(upcoming[1].artist, 'aWannabe');

  assert.strictEqual(upcoming[2].videoId, 'worseProm01');
  assert.strictEqual(upcoming[2].title, 'it only gets worse, i promise');
  assert.strictEqual(upcoming[2].artist, 'Ekkstacy');

  assert.strictEqual(upcoming[3].videoId, 'papercuts01');
  assert.strictEqual(upcoming[3].title, 'PAPERCUTS');
  assert.strictEqual(upcoming[3].artist, 'WesGhost');

  assert.strictEqual(upcoming[4].videoId, 'lovingMeH01');
  assert.strictEqual(upcoming[4].title, 'loving me is really hard');
  assert.strictEqual(upcoming[4].artist, 'NESYA');

  assert.strictEqual(upcoming[5].videoId, 'dropout0001');
  assert.strictEqual(upcoming[5].title, 'dropout');
  assert.strictEqual(upcoming[5].artist, 'overtonight');

  assert.strictEqual(upcoming[6].videoId, 'unhinged001');
  assert.strictEqual(upcoming[6].title, 'Unhinged');
  assert.strictEqual(upcoming[6].artist, 'ThxSoMch');

  assert.strictEqual(upcoming[7].videoId, 'regretful01');
  assert.strictEqual(upcoming[7].title, 'regretful');
  assert.strictEqual(upcoming[7].artist, 'Leverfall');

  assert.strictEqual(upcoming[8].videoId, 'browneyes01');
  assert.strictEqual(upcoming[8].title, 'brown eyes*');
  assert.strictEqual(upcoming[8].artist, 're6ce');

  assert.strictEqual(upcoming[9].videoId, 'tantrum0001');
  assert.strictEqual(upcoming[9].title, 'Tantrum (Pace Yourself)');
  assert.strictEqual(upcoming[9].artist, 'Riovaz');

  assert.strictEqual(upcoming[10].videoId, 'unknowing01');
  assert.strictEqual(upcoming[10].title, 'The Unknowing');
  assert.strictEqual(upcoming[10].artist, 'Jfarrari');
});

runAllTests();
