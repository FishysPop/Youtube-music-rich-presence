const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const assert = require('assert');

const extPath = path.resolve(__dirname, '..', 'extention');
const pageBridgeScript = fs.readFileSync(path.join(extPath, 'page-bridge.js'), 'utf-8');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function cdpRequest(port, endpoint) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${endpoint}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    }).on('error', reject);
  });
}

let cmdSeq = 1;
function sendCommand(ws, method, params = {}) {
  const id = ++cmdSeq;
  return new Promise((resolve, reject) => {
    const msg = JSON.stringify({ id, method, params });
    const onMessage = (evt) => {
      try {
        const resp = JSON.parse(evt.data);
        if (resp.id === id) {
          ws.removeEventListener('message', onMessage);
          if (resp.error) reject(resp.error);
          else resolve(resp.result);
        }
      } catch (e) {}
    };
    ws.addEventListener('message', onMessage);
    ws.send(msg);
  });
}

async function launchBrowserInstance(port, profileName) {
  const userDataDir = path.join(os.tmpdir(), `ytm_test_${profileName}_${Date.now()}`);
  const proc = spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--load-extension=${extPath}`,
    `--disable-extensions-except=${extPath}`,
    '--headless=new',
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ], { detached: false });

  let wsUrl = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const targets = await cdpRequest(port, '/json/list');
      const page = targets.find(t => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch (e) {}
  }

  if (!wsUrl) {
    proc.kill();
    throw new Error(`Failed to connect to Chrome on port ${port}`);
  }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  await sendCommand(ws, 'Page.enable');
  await sendCommand(ws, 'Runtime.enable');
  await sendCommand(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: pageBridgeScript });

  return { proc, ws };
}

async function runDualBrowserTest() {
  console.log('Starting Dual-Browser Listen Together & Supermix Sync Test...\n');
  let host = null;
  let listener = null;
  let hostSyncEngine = null;
  let listenerSyncEngine = null;

  try {
    console.log('[1/6] Launching Host browser instance on port 9222...');
    host = await launchBrowserInstance(9222, 'host');
    console.log('[Host] Launched successfully.');

    console.log('[2/6] Launching Listener browser instance on port 9223...');
    listener = await launchBrowserInstance(9223, 'listener');
    console.log('[Listener] Launched successfully.\n');

    console.log('[3/6] Navigating Host to YouTube Music Supermix / Radio queue...');
    await sendCommand(host.ws, 'Page.navigate', {
      url: 'https://music.youtube.com/watch?v=kJQP7kiw5Fk&list=RDAMVMkJQP7kiw5Fk'
    });

    console.log('[Host] Waiting for watch page and queue store initialization (8s)...');
    await new Promise(r => setTimeout(r, 8000));

async function waitForAdToFinishOrSkip(ws, targetExpectedVid, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await sendCommand(ws, 'Runtime.evaluate', {
      expression: `
        (() => {
          const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
          let isAd = false;
          if (player && typeof player.getAdState === 'function') {
            const adState = player.getAdState();
            if (adState >= 0) isAd = true;
          } else if (document.documentElement.getAttribute('data-ytm-ad-active') === 'true') {
            isAd = true;
          }

          if (isAd) {
            const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button.ytp-ad-skip-button-text, .ytp-ad-skip-button-container button');
            if (skipBtn && skipBtn.offsetParent !== null) {
              try { skipBtn.click(); } catch (e) {}
            }
          }

          const curVid = player && typeof player.getVideoData === 'function' ? player.getVideoData().video_id : null;
          return { isAd, curVid };
        })()
      `,
      returnByValue: true
    });

    const res = status.result?.value;
    if (res) {
      if (!res.isAd && (!targetExpectedVid || res.curVid === targetExpectedVid)) {
        return res;
      }
    }
    await new Promise(r => setTimeout(r, 400));
  }
  return null;
}

    await waitForAdToFinishOrSkip(host.ws, 'kJQP7kiw5Fk', 15000);

    const hostQueueCheck = await sendCommand(host.ws, 'Runtime.evaluate', {
      expression: `
        (() => {
          const app = document.querySelector('ytmusic-app');
          const playerBar = document.querySelector('ytmusic-player-bar');
          const queueObj = playerBar?.queue || app?.queue || null;
          const items = queueObj && typeof queueObj.getItems === 'function' ? queueObj.getItems() : [];
          const player = document.getElementById('movie_player');
          const curVid = player && player.getVideoData ? player.getVideoData().video_id : null;
          return {
            curVid,
            queueCount: items.length,
            firstFew: items.slice(0, 15).map(it => ({
              videoId: it?.playlistPanelVideoRenderer?.videoId,
              title: it?.playlistPanelVideoRenderer?.title?.runs?.[0]?.text || 'Track',
              artist: it?.playlistPanelVideoRenderer?.shortBylineText?.runs?.[0]?.text || ''
            })).filter(x => x.videoId)
          };
        })()
      `,
      returnByValue: true
    });

    console.log('[Host] Active track and queue count:', hostQueueCheck.result?.value?.curVid, hostQueueCheck.result?.value?.queueCount);
    assert.strictEqual(hostQueueCheck.result?.value?.curVid, 'kJQP7kiw5Fk', 'Host should have loaded kJQP7kiw5Fk');
    assert.ok(hostQueueCheck.result?.value?.queueCount > 1, 'Host should have populated queue items');

    const testRoomCode = `YTM-TST${Math.floor(100 + Math.random() * 900)}`;
    console.log(`\n[4/6] Initializing Host SyncEngine in room ${testRoomCode}...`);

    const { WebRtcSyncEngine } = require('../extention/webrtc-sync.js');

    hostSyncEngine = new WebRtcSyncEngine({
      userName: 'TestHost',
      onConnectionStatus: (status, code) => console.log('[Host Status]', status, code),
      onSyncAction: () => {},
      onTrackChange: () => {},
      getCurrentState: () => ({
        videoId: 'kJQP7kiw5Fk',
        track: 'Despacito',
        artist: 'Luis Fonsi',
        currentTime: 10,
        isPlaying: true,
        upcomingTracks: hostQueueCheck.result?.value?.firstFew?.slice(1) || []
      })
    });

    hostSyncEngine.createRoom(testRoomCode);
    console.log('[Host] Room created and broadcasting to MQTT broker.');

    console.log('\n[5/6] Navigating Listener to YouTube Music watch page...');
    await sendCommand(listener.ws, 'Page.navigate', {
      url: 'https://music.youtube.com/watch?v=kJQP7kiw5Fk'
    });

    console.log('[Listener] Waiting for player ready (8s)...');
    await new Promise(r => setTimeout(r, 8000));

    console.log(`[Listener] Connecting Listener SyncEngine to Room ${testRoomCode}...`);

    let resolveListenerConnected;
    const listenerConnectedPromise = new Promise((resolve, reject) => {
      resolveListenerConnected = resolve;
      setTimeout(() => reject(new Error('Timed out waiting for listener sync connection (35s)')), 35000);
    });

    listenerSyncEngine = new WebRtcSyncEngine({
      userName: 'TestListener',
      onConnectionStatus: (status, code) => {
        console.log('[Listener Status]', status, code);
        if (status === 'connected') {
          resolveListenerConnected();
        }
      },
      onSyncAction: async (packet) => {
        console.log('[Listener onSyncAction received]', packet.type, 'upcomingTracks count:', packet.upcomingTracks?.length);

        if (Array.isArray(packet.upcomingTracks) && packet.upcomingTracks.length > 0) {
          try {
            await sendCommand(listener.ws, 'Runtime.evaluate', {
              expression: `
                window.postMessage({
                  source: 'ytm-sync-isolated',
                  action: 'SYNC_UPCOMING_TRACKS',
                  upcomingTracks: ${JSON.stringify(packet.upcomingTracks)}
                }, '*');
              `
            });
          } catch (e) {}
        }
      },
      onTrackChange: async (packet) => {
        console.log('[Listener onTrackChange received]', packet.videoId, 'track:', packet.track);

        try {
          await sendCommand(listener.ws, 'Runtime.evaluate', {
            expression: `
              window.postMessage({
                source: 'ytm-sync-isolated',
                action: 'LOAD_VIDEO',
                videoId: '${packet.videoId}',
                track: '${packet.track || 'Track'}',
                artist: '${packet.artist || ''}',
                currentTime: ${packet.currentTime || 0},
                isPlaying: ${packet.isPlaying ?? true},
                upcomingTracks: ${JSON.stringify(packet.upcomingTracks || [])}
              }, '*');
            `
          });
        } catch (e) {}
      }
    });

    listenerSyncEngine.joinRoom(testRoomCode);
    console.log('[Listener] Waiting for sync handshake to connect and populate queue...');
    await listenerConnectedPromise;
    console.log('[Listener] Connected and sync handshake received!');

    // Settle Redux queue injection
    await new Promise(r => setTimeout(r, 2000));

    // Inspect listener queue to verify host upcoming tracks were injected into listener Redux queue
    const listenerQueueBefore = await sendCommand(listener.ws, 'Runtime.evaluate', {
      expression: `
        (() => {
          const app = document.querySelector('ytmusic-app');
          const playerBar = document.querySelector('ytmusic-player-bar');
          const queueObj = playerBar?.queue || app?.queue;
          const items = queueObj?.getItems?.() || [];
          const player = document.getElementById('movie_player');
          return {
            curVid: player?.getVideoData?.()?.video_id,
            queueCount: items.length,
            secondVid: items[1]?.playlistPanelVideoRenderer?.videoId,
            syncedTracksLength: window.__syncedUpcomingTracks?.length || 0
          };
        })()
      `,
      returnByValue: true
    });

    console.log('[Listener] State after connecting:', listenerQueueBefore.result?.value);
    const hostSecondTrack = hostQueueCheck.result?.value?.firstFew?.[1]?.videoId;
    console.log(`[Validation] Host expected second track: ${hostSecondTrack}`);

    console.log('\n[6/6] Host skipping to second track in Supermix...');
    const skipStart = Date.now();

    // Trigger Host skip via in-queue selection
    const hostSkipResult = await sendCommand(host.ws, 'Runtime.evaluate', {
      expression: `
        (() => {
          const queueObj = document.querySelector('ytmusic-player-bar')?.queue || document.querySelector('ytmusic-app')?.queue;
          const items = queueObj?.getItems?.() || [];
          if (items.length > 1) {
            const target = items[1];
            const targetVid = target.playlistPanelVideoRenderer?.videoId;
            const targetTitle = target.playlistPanelVideoRenderer?.title?.runs?.[0]?.text || 'Next Track';
            const targetArtist = target.playlistPanelVideoRenderer?.shortBylineText?.runs?.[0]?.text || '';
            const upcoming = items.slice(2, 17).map(it => ({
              videoId: it?.playlistPanelVideoRenderer?.videoId,
              title: it?.playlistPanelVideoRenderer?.title?.runs?.[0]?.text || '',
              artist: it?.playlistPanelVideoRenderer?.shortBylineText?.runs?.[0]?.text || ''
            })).filter(x => x.videoId);
            queueObj.selectQueueItem(target);
            return { targetVid, targetTitle, targetArtist, upcoming };
          }
          return null;
        })()
      `,
      returnByValue: true
    });

    const skipData = hostSkipResult.result?.value;
    console.log('[Host] Skipped to track:', skipData?.targetVid, `"${skipData?.targetTitle}"`);
    assert.ok(skipData && skipData.targetVid, 'Host should have successfully selected second queue item');

    hostSyncEngine.notifyTrackChange({
      videoId: skipData.targetVid,
      track: skipData.targetTitle,
      artist: skipData.targetArtist,
      currentTime: 0,
      isPlaying: true,
      upcomingTracks: skipData.upcoming
    });

    // Monitor listener transition speed
    let listenerSwitched = false;
    let listenerActiveVid = null;
    let elapsedMs = 0;

    let listenerEncounteredAd = false;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 200));
      const check = await sendCommand(listener.ws, 'Runtime.evaluate', {
        expression: `
          (() => {
            const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
            let isAd = false;
            if (player && typeof player.getAdState === 'function') {
              const adState = player.getAdState();
              if (adState >= 0) isAd = true;
            } else if (document.documentElement.getAttribute('data-ytm-ad-active') === 'true') {
              isAd = true;
            }

            if (isAd) {
              const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button.ytp-ad-skip-button-text, .ytp-ad-skip-button-container button');
              if (skipBtn && skipBtn.offsetParent !== null) {
                try { skipBtn.click(); } catch (e) {}
              }
            }

            return {
              curVid: player?.getVideoData?.()?.video_id,
              isAd
            };
          })()
        `,
        returnByValue: true
      });

      const res = check.result?.value;
      if (res?.isAd) {
        listenerEncounteredAd = true;
      } else {
        listenerActiveVid = res?.curVid;
        if (listenerActiveVid === hostSecondTrack) {
          elapsedMs = Date.now() - skipStart;
          listenerSwitched = true;
          break;
        }
      }
    }

    console.log(`[Result] Listener track after skip: ${listenerActiveVid} (ad encountered: ${listenerEncounteredAd})`);
    console.log(`[Result] Listener transition latency: ${elapsedMs}ms`);

    assert.strictEqual(listenerSwitched, true, `Listener should have transitioned to host track ${hostSecondTrack}`);
    if (!listenerEncounteredAd) {
      assert.ok(elapsedMs < 3500, `Listener transition latency (${elapsedMs}ms) should be fast without SPA route buffering delay`);
    }

    console.log('\n[PASS] Dual-Browser Listen Together & Supermix Sync Test succeeded perfectly!');
  } catch (err) {
    console.error('\n[FAIL] Dual-Browser Test Error:', err);
    process.exitCode = 1;
  } finally {
    if (hostSyncEngine) {
      try { hostSyncEngine.leaveRoom(); } catch (e) {}
    }
    if (listenerSyncEngine) {
      try { listenerSyncEngine.leaveRoom(); } catch (e) {}
    }
    if (host?.ws) {
      try { host.ws.close(); } catch (e) {}
    }
    if (host?.proc) {
      try { host.proc.kill(); } catch (e) {}
    }
    if (listener?.ws) {
      try { listener.ws.close(); } catch (e) {}
    }
    if (listener?.proc) {
      try { listener.proc.kill(); } catch (e) {}
    }
  }
}

runDualBrowserTest().then(() => {
  process.exit(process.exitCode || 0);
}).catch(() => {
  process.exit(1);
});
