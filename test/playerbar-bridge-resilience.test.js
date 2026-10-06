const assert = require('assert');

console.log('Running PlayerBar & Bridge Resilience Tests...\n');

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
    console.log('ALL RESILIENCE TESTS PASSED!\n');
  }
}

test('getBridgeMediaData extracts metadata from navigator.mediaSession when present', () => {
  const { getBridgeMediaData } = require('../extention/page-bridge.js');
  
  const originalNavDesc = Object.getOwnPropertyDescriptor(global, 'navigator');
  const originalDoc = global.document;

  Object.defineProperty(global, 'navigator', {
    value: {
      mediaSession: {
        playbackState: 'playing',
        metadata: {
          title: 'Lilac Wine',
          artist: 'Jeff Buckley',
          album: 'Grace',
          artwork: [
            { src: 'https://lh3.googleusercontent.com/small=w120-h120', sizes: '120x120' },
            { src: 'https://lh3.googleusercontent.com/large=w544-h544', sizes: '544x544' }
          ]
        }
      }
    },
    configurable: true,
    writable: true
  });

  global.document = {
    getElementById: (id) => {
      if (id === 'movie_player') {
        return {
          getVideoData: () => ({ video_id: '7wj0zxFcHQA', author: 'Jeff Buckley', title: 'Lilac Wine' }),
          getPlayerState: () => 1,
          getCurrentTime: () => 139.5,
          getDuration: () => 273.0
        };
      }
      return null;
    },
    querySelector: () => null
  };

  try {
    const data = getBridgeMediaData();
    assert.strictEqual(data.title, 'Lilac Wine');
    assert.strictEqual(data.artist, 'Jeff Buckley');
    assert.strictEqual(data.album, 'Grace');
    assert.strictEqual(data.artwork, 'https://lh3.googleusercontent.com/large=w544-h544');
    assert.strictEqual(data.isPlaying, true);
    assert.strictEqual(data.videoId, '7wj0zxFcHQA');
    assert.strictEqual(data.currentTime, 139);
    assert.strictEqual(data.duration, 273);
  } finally {
    if (originalNavDesc) {
      Object.defineProperty(global, 'navigator', originalNavDesc);
    } else {
      delete global.navigator;
    }
    global.document = originalDoc;
  }
});

test('getBridgeMediaData falls back to movie_player when mediaSession is empty', () => {
  const { getBridgeMediaData } = require('../extention/page-bridge.js');
  
  const originalNavDesc = Object.getOwnPropertyDescriptor(global, 'navigator');
  const originalDoc = global.document;

  Object.defineProperty(global, 'navigator', {
    value: { mediaSession: null },
    configurable: true,
    writable: true
  });
  global.document = {
    getElementById: (id) => {
      if (id === 'movie_player') {
        return {
          getVideoData: () => ({ video_id: 'FO8uIelNYQM', author: 'PAON', title: 'Métamorphose' }),
          getPlayerState: () => 2,
          getCurrentTime: () => 20.0,
          getDuration: () => 269.0
        };
      }
      return null;
    },
    querySelector: () => null
  };

  try {
    const data = getBridgeMediaData();
    assert.strictEqual(data.title, 'Métamorphose');
    assert.strictEqual(data.artist, 'PAON');
    assert.strictEqual(data.album, null);
    assert.strictEqual(data.isPlaying, false);
    assert.strictEqual(data.videoId, 'FO8uIelNYQM');
    assert.strictEqual(data.currentTime, 20);
    assert.strictEqual(data.duration, 269);
  } finally {
    if (originalNavDesc) {
      Object.defineProperty(global, 'navigator', originalNavDesc);
    } else {
      delete global.navigator;
    }
    global.document = originalDoc;
  }
});

test('findVideoElement detects HTML5 audio elements when video is absent', () => {
  const { findVideoElement } = require('../extention/content.js');
  const originalDoc = global.document;

  const mockAudio = { tagName: 'AUDIO', className: 'video-stream', paused: false };

  global.document = {
    querySelector: (sel) => {
      if (sel.includes('video.html5-main-video') || sel === 'video') return null;
      if (sel.includes('audio.video-stream') || sel === 'audio') return mockAudio;
      return null;
    },
    getElementById: () => null
  };

  try {
    const found = findVideoElement();
    assert.strictEqual(found, mockAudio);
  } finally {
    global.document = originalDoc;
  }
});

test('isAdPlaying does not false-positive on explicit badges or generic badge containers', () => {
  const { isAdPlaying } = require('../extention/content.js');
  const originalDoc = global.document;

  global.document = {
    documentElement: {
      getAttribute: () => null
    },
    querySelector: (sel) => {
      if (sel === 'ytmusic-player-bar') {
        return {
          shadowRoot: null,
          querySelector: (sub) => {
            if (sub === '.badge-style-type-ad-stark') return null;
            if (sub.includes('badge-style-type-ad')) return null;
            return null;
          }
        };
      }
      return null;
    }
  };

  try {
    assert.strictEqual(isAdPlaying(), false);
  } finally {
    global.document = originalDoc;
  }
});

test('getCurrentTrackInfo successfully extracts track when playerBar is null', () => {
  const { getCurrentTrackInfo, bridgeState } = require('../extention/content.js');
  const originalDoc = global.document;
  const originalNavDesc = Object.getOwnPropertyDescriptor(global, 'navigator');

  const mockVideo = {
    paused: false,
    ended: false,
    readyState: 4,
    currentTime: 139.5,
    duration: 273.0
  };

  const bridgeData = {
    title: 'Lilac Wine',
    artist: 'Jeff Buckley',
    album: 'Grace',
    artwork: 'https://yt3.googleusercontent.com/sample',
    isPlaying: true,
    videoId: '7wj0zxFcHQA',
    currentTime: 139,
    duration: 273
  };

  global.document = {
    documentElement: {
      getAttribute: (attr) => {
        if (attr === 'data-ytm-media-data') return JSON.stringify(bridgeData);
        if (attr === 'data-ytm-video-id') return '7wj0zxFcHQA';
        if (attr === 'data-ytm-ad-active') return 'false';
        return null;
      }
    },
    querySelector: (sel) => {
      if (sel === 'ytmusic-player-bar') return null;
      if (sel.includes('video.html5-main-video') || sel === 'video') return mockVideo;
      return null;
    },
    querySelectorAll: () => [],
    getElementById: () => null
  };
  Object.defineProperty(global, 'navigator', {
    value: { mediaSession: null },
    configurable: true,
    writable: true
  });

  try {
    const trackInfo = getCurrentTrackInfo();
    assert.notStrictEqual(trackInfo, null);
    assert.strictEqual(trackInfo.track, 'Lilac Wine');
    assert.strictEqual(trackInfo.artist, 'Jeff Buckley');
    assert.strictEqual(trackInfo.album, 'Grace');
    assert.strictEqual(trackInfo.albumArtUrl, 'https://yt3.googleusercontent.com/sample');
    assert.strictEqual(trackInfo.videoId, '7wj0zxFcHQA');
    assert.strictEqual(trackInfo.isPlaying, true);
    assert.strictEqual(trackInfo.duration, 273);
    assert.strictEqual(trackInfo.currentTime, 139);
  } finally {
    global.document = originalDoc;
    if (originalNavDesc) {
      Object.defineProperty(global, 'navigator', originalNavDesc);
    } else {
      delete global.navigator;
    }
    bridgeState.lastKnownVideoId = null;
    bridgeState.mediaData = null;
  }
});

test('getCurrentTrackInfo extracts track when bridgeState.mediaData is populated directly', () => {
  const { getCurrentTrackInfo, bridgeState } = require('../extention/content.js');
  const originalDoc = global.document;

  const mockVideo = {
    paused: false,
    ended: false,
    readyState: 4,
    currentTime: 45,
    duration: 180
  };

  bridgeState.mediaData = {
    title: 'Hallelujah',
    artist: 'Jeff Buckley',
    album: 'Grace',
    artwork: 'https://yt3.googleusercontent.com/sample2',
    isPlaying: true,
    videoId: 'y8AWFf7EAc4',
    currentTime: 45,
    duration: 180
  };

  global.document = {
    documentElement: {
      getAttribute: () => null
    },
    querySelector: (sel) => {
      if (sel === 'ytmusic-player-bar') return null;
      if (sel.includes('video.html5-main-video') || sel === 'video') return mockVideo;
      return null;
    },
    querySelectorAll: () => [],
    getElementById: () => null
  };

  try {
    const trackInfo = getCurrentTrackInfo();
    assert.notStrictEqual(trackInfo, null);
    assert.strictEqual(trackInfo.track, 'Hallelujah');
    assert.strictEqual(trackInfo.artist, 'Jeff Buckley');
    assert.strictEqual(trackInfo.album, 'Grace');
    assert.strictEqual(trackInfo.videoId, 'y8AWFf7EAc4');
  } finally {
    bridgeState.mediaData = null;
    global.document = originalDoc;
  }
});

test('sanitizeActivityData preserves buttons when disableButtons is false', () => {
  const { sanitizeActivityData } = require('../extention/background.js');
  const activity = {
    details: 'Lilac Wine',
    state: 'Jeff Buckley',
    buttons: [
      { label: 'Link', url: 'https://music.youtube.com/watch?v=7wj0zxFcHQA' },
      { label: 'GitHub', url: 'https://github.com/FishysPop/Youtube-music-rich-presence' }
    ]
  };

  const result = sanitizeActivityData(activity, false);
  assert.strictEqual(Array.isArray(result.buttons), true);
  assert.strictEqual(result.buttons.length, 2);
  assert.strictEqual(result.buttons[0].label, 'Link');
  assert.strictEqual(result.buttons[1].label, 'GitHub');
});

test('sanitizeActivityData strips buttons when disableButtons is true', () => {
  const { sanitizeActivityData } = require('../extention/background.js');
  const activity = {
    details: 'Lilac Wine',
    state: 'Jeff Buckley',
    buttons: [
      { label: 'Link', url: 'https://music.youtube.com/watch?v=7wj0zxFcHQA' },
      { label: 'GitHub', url: 'https://github.com/FishysPop/Youtube-music-rich-presence' }
    ]
  };

  const result = sanitizeActivityData(activity, true);
  assert.strictEqual(result.buttons, undefined);
  assert.strictEqual('buttons' in result, false);
});

test('sanitizeActivityData truncates buttons to Discord limit of 2 when enabled', () => {
  const { sanitizeActivityData } = require('../extention/background.js');
  const activity = {
    details: 'Lilac Wine',
    state: 'Jeff Buckley',
    buttons: [
      { label: 'Btn 1', url: 'https://example.com/1' },
      { label: 'Btn 2', url: 'https://example.com/2' },
      { label: 'Btn 3', url: 'https://example.com/3' }
    ]
  };

  const result = sanitizeActivityData(activity, false);
  assert.strictEqual(result.buttons.length, 2);
  assert.strictEqual(result.buttons[0].label, 'Btn 1');
  assert.strictEqual(result.buttons[1].label, 'Btn 2');
});

test('resolveTimeoutSelection maps presets and negative/zero values to standard selections', () => {
  const { resolveTimeoutSelection } = require('../extention/popup.js');
  const presets = [0, 1, 5, 15, 30];

  assert.deepStrictEqual(resolveTimeoutSelection(-1, presets), { isCustom: false, selectValue: '0', customValue: null });
  assert.deepStrictEqual(resolveTimeoutSelection(0, presets), { isCustom: false, selectValue: '0', customValue: null });
  assert.deepStrictEqual(resolveTimeoutSelection('0', presets), { isCustom: false, selectValue: '0', customValue: null });
  assert.deepStrictEqual(resolveTimeoutSelection(5, presets), { isCustom: false, selectValue: '5', customValue: '5' });
  assert.deepStrictEqual(resolveTimeoutSelection('15', presets), { isCustom: false, selectValue: '15', customValue: '15' });
  assert.deepStrictEqual(resolveTimeoutSelection(NaN, presets), { isCustom: false, selectValue: '0', customValue: null });
});

test('resolveTimeoutSelection maps arbitrary numbers to custom selection with customValue', () => {
  const { resolveTimeoutSelection } = require('../extention/popup.js');
  const presets = [0, 15, 30, 60];

  assert.deepStrictEqual(resolveTimeoutSelection(7, presets), { isCustom: true, selectValue: 'custom', customValue: '7' });
  assert.deepStrictEqual(resolveTimeoutSelection(45, presets), { isCustom: true, selectValue: 'custom', customValue: '45' });
  assert.deepStrictEqual(resolveTimeoutSelection('90', presets), { isCustom: true, selectValue: 'custom', customValue: '90' });
});

test('resolvePauseTargetTime computes targetTime and expiration accurately for custom minutes', () => {
  const { resolvePauseTargetTime } = require('../extention/background.js');
  const basePausedAt = 1000000;

  const res1 = resolvePauseTargetTime(basePausedAt, 10, basePausedAt + 2 * 60 * 1000);
  assert.strictEqual(res1.targetTime, basePausedAt + 10 * 60 * 1000);
  assert.strictEqual(res1.remainingMs, 8 * 60 * 1000);
  assert.strictEqual(res1.isExpired, false);

  const resExpired = resolvePauseTargetTime(basePausedAt, 5, basePausedAt + 6 * 60 * 1000);
  assert.strictEqual(resExpired.targetTime, basePausedAt + 5 * 60 * 1000);
  assert.strictEqual(resExpired.remainingMs < 0, true);
  assert.strictEqual(resExpired.isExpired, true);
});

test('resolvePauseTargetTime returns null targetTime when disabled or non-positive', () => {
  const { resolvePauseTargetTime } = require('../extention/background.js');
  assert.deepStrictEqual(resolvePauseTargetTime(1000000, 0), { targetTime: null, remainingMs: null, isExpired: false });
  assert.deepStrictEqual(resolvePauseTargetTime(1000000, -1), { targetTime: null, remainingMs: null, isExpired: false });
  assert.deepStrictEqual(resolvePauseTargetTime(null, 10), { targetTime: null, remainingMs: null, isExpired: false });
});

runAllTests();
