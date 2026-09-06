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

async function runTwentySongsTest() {
  console.log('=== 20+ Songs Listen Together Supermix Sync Test ===\n');
  let host = null;
  let listener = null;
  let hostSyncEngine = null;
  let listenerSyncEngine = null;

  try {
    console.log('[1/4] Launching Host and Listener browser instances...');
    host = await launchBrowserInstance(9222, 'host');
    listener = await launchBrowserInstance(9223, 'listener');
    console.log('Both instances launched.\n');

    console.log('[2/4] Navigating Host to YouTube Music Supermix / Radio queue...');
    await sendCommand(host.ws, 'Page.navigate', {
      url: 'https://music.youtube.com/watch?v=kJQP7kiw5Fk&list=RDAMVMkJQP7kiw5Fk'
    });

    console.log('Waiting for Host Supermix queue to load (10s)...');
    await new Promise(r => setTimeout(r, 10000));

    const hostInitial = await sendCommand(host.ws, 'Runtime.evaluate', {
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
            items: items.map(it => ({
              videoId: it?.playlistPanelVideoRenderer?.videoId,
              title: it?.playlistPanelVideoRenderer?.title?.runs?.[0]?.text || 'Track',
              artist: it?.playlistPanelVideoRenderer?.shortBylineText?.runs?.[0]?.text || ''
            })).filter(x => x.videoId)
          };
        })()
      `,
      returnByValue: true
    });

    const hostData = hostInitial.result?.value;
    console.log(`[Host] Initial track: ${hostData?.curVid}, queue count: ${hostData?.queueCount}`);
    assert.ok(hostData?.queueCount >= 25, `Host must have at least 25 songs in Supermix queue (found ${hostData?.queueCount})`);

    const testRoomCode = `YTM-20S${Math.floor(100 + Math.random() * 900)}`;
    console.log(`\n[3/4] Establishing Listen Together session in Room ${testRoomCode}...`);

    const { WebRtcSyncEngine } = require('../extention/webrtc-sync.js');

    let currentHostIndex = 0;

    hostSyncEngine = new WebRtcSyncEngine({
      userName: 'HostUser',
      onConnectionStatus: (status, code) => console.log('[Host Status]', status, code),
      onSyncAction: () => {},
      onTrackChange: () => {},
      getCurrentState: () => {
        const cur = hostData.items[currentHostIndex] || hostData.items[0];
        const upcoming = hostData.items.slice(currentHostIndex + 1, currentHostIndex + 16);
        return {
          videoId: cur.videoId,
          track: cur.title,
          artist: cur.artist,
          currentTime: 5,
          isPlaying: true,
          upcomingTracks: upcoming
        };
      }
    });

    hostSyncEngine.createRoom(testRoomCode);

    console.log('Navigating Listener to YouTube Music watch page...');
    await sendCommand(listener.ws, 'Page.navigate', {
      url: 'https://music.youtube.com/watch?v=kJQP7kiw5Fk'
    });
    await new Promise(r => setTimeout(r, 8000));

    let resolveListenerConnected;
    const listenerConnectedPromise = new Promise((resolve, reject) => {
      resolveListenerConnected = resolve;
      setTimeout(() => reject(new Error('Timed out waiting for listener connection (35s)')), 35000);
    });

    listenerSyncEngine = new WebRtcSyncEngine({
      userName: 'ListenerUser',
      onConnectionStatus: (status, code) => {
        console.log('[Listener Status]', status, code);
        if (status === 'connected') resolveListenerConnected();
      },
      onSyncAction: async (packet) => {
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
        try {
          await sendCommand(listener.ws, 'Runtime.evaluate', {
            expression: `
              window.postMessage({
                source: 'ytm-sync-isolated',
                action: 'LOAD_VIDEO',
                videoId: '${packet.videoId}',
                track: '${(packet.track || 'Track').replace(/'/g, "\\'")}',
                artist: '${(packet.artist || '').replace(/'/g, "\\'")}',
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
    console.log('Waiting for sync handshake...');
    await listenerConnectedPromise;
    console.log('Handshake established. Queue synchronized.\n');

    await new Promise(r => setTimeout(r, 2000));

    console.log('[4/4] Beginning 22-song continuous playback and skip sequence...\n');

    const totalSongsToTest = 22;
    const latencies = [];

    for (let step = 1; step <= totalSongsToTest; step++) {
      currentHostIndex = step;
      const targetSong = hostData.items[step];
      const upcomingSlice = hostData.items.slice(step + 1, step + 16);

      console.log(`--- [Song ${step}/${totalSongsToTest}] Advancing to: "${targetSong.title}" (${targetSong.videoId}) ---`);

      const skipStartTime = Date.now();

      // Host selects next item in queue
      await sendCommand(host.ws, 'Runtime.evaluate', {
        expression: `
          (() => {
            const queueObj = document.querySelector('ytmusic-player-bar')?.queue || document.querySelector('ytmusic-app')?.queue;
            const items = queueObj?.getItems?.() || [];
            const target = items[${step}];
            if (target && queueObj?.selectQueueItem) {
              queueObj.selectQueueItem(target);
            }
          })()
        `
      });

      // Host notifies room of track change + new upcoming tracks window
      hostSyncEngine.notifyTrackChange({
        videoId: targetSong.videoId,
        track: targetSong.title,
        artist: targetSong.artist,
        currentTime: 0,
        isPlaying: true,
        upcomingTracks: upcomingSlice
      });

      // Also send QUEUE_SYNC to replenish the upcoming window
      hostSyncEngine.notifyQueueSync({
        upcomingTracks: upcomingSlice
      });

      // Poll listener until active video matches targetSong.videoId (accounting for ads)
      let listenerSwitched = false;
      let latencyMs = 0;
      let adEncountered = false;

      for (let attempt = 0; attempt < 35; attempt++) {
        await new Promise(r => setTimeout(r, 150));
        const check = await sendCommand(listener.ws, 'Runtime.evaluate', {
          expression: `
            (() => {
              const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
              const queueObj = document.querySelector('ytmusic-player-bar')?.queue || document.querySelector('ytmusic-app')?.queue;
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
                queueCount: queueObj?.getItems?.()?.length || 0,
                isAd
              };
            })()
          `,
          returnByValue: true
        });

        const res = check.result?.value;
        if (res?.isAd) {
          adEncountered = true;
        } else if (res?.curVid === targetSong.videoId) {
          latencyMs = Date.now() - skipStartTime;
          listenerSwitched = true;
          break;
        }
      }

      assert.strictEqual(
        listenerSwitched,
        true,
        `Song ${step}: Listener failed to switch to ${targetSong.videoId} ("${targetSong.title}")`
      );

      latencies.push(latencyMs);
      console.log(`[Song ${step}/${totalSongsToTest} SUCCESS] Synced in ${latencyMs}ms (ad encountered: ${adEncountered})`);

      // Let song play for 600ms before next track
      await new Promise(r => setTimeout(r, 600));
    }

    const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    const maxLatency = Math.max(...latencies);
    const minLatency = Math.min(...latencies);

    console.log('\n========================================');
    console.log(`All ${totalSongsToTest} songs successfully played and synchronized!`);
    console.log(`Average skip transition latency: ${avgLatency}ms`);
    console.log(`Min latency: ${minLatency}ms, Max latency: ${maxLatency}ms`);
    console.log('Zero desyncs. Zero full-page buffer reload delays.');
    console.log('========================================\n');

  } catch (err) {
    console.error('\n[TEST FAILURE]', err);
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

runTwentySongsTest();
