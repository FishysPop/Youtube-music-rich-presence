const assert = require('assert');

// Import the sync engine module
const {
    DRIFT_TOLERANCE_MS,
    SOFT_CATCHUP_MAX_MS,
    HARD_SEEK_THRESHOLD_MS,
    calculateDrift,
    determineSyncAction,
    sanitizePacket,
    generateRoomCode,
    validateVideoId,
    calculateAdCatchUpTime,
    isNearTrackEnd,
    sanitizeImageUrl,
    validateRoomId,
    hashRoomTopic,
    WebRtcSyncEngine
} = require('../extention/webrtc-sync.js');

console.log('Running WebRTC Sync Engine Tests...\n');

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
        console.log('ALL TESTS PASSED!\n');
    }
    setTimeout(() => {
        process.exit(passedTests === allTests.length ? 0 : 1);
    }, 100);
}

// 1. Room Code Generation Tests
test('generateRoomCode generates valid 6-character room code format YTM-XXXXXX', () => {
    const code = generateRoomCode();
    assert.strictEqual(typeof code, 'string');
    assert.match(code, /^YTM-[A-Z0-9]{6}$/);
    
    // Ensure randomness
    const code2 = generateRoomCode();
    assert.notStrictEqual(code, code2);
});

// 2. Video ID Validation Tests
test('validateVideoId accurately validates YouTube video IDs and rejects malicious inputs', () => {
    assert.strictEqual(validateVideoId('dQw4w9WgXcQ'), true);
    assert.strictEqual(validateVideoId('kJQP7kiw5Fk'), true);
    assert.strictEqual(validateVideoId('_a1-b2_c3-d'), true);
    
    // Malicious or invalid inputs
    assert.strictEqual(validateVideoId('javascript:alert(1)'), false);
    assert.strictEqual(validateVideoId('<script>alert(1)</script>'), false);
    assert.strictEqual(validateVideoId('https://evil.com'), false);
    assert.strictEqual(validateVideoId('short'), false);
    assert.strictEqual(validateVideoId('toolongvideoidstring12345'), false);
    assert.strictEqual(validateVideoId(null), false);
    assert.strictEqual(validateVideoId(undefined), false);
    assert.strictEqual(validateVideoId(12345), false);
});

// 3. Packet Sanitization & Validation Tests
test('sanitizePacket approves valid SYNC_STATE packet', () => {
    const validPacket = {
        type: 'SYNC_STATE',
        videoId: 'dQw4w9WgXcQ',
        track: 'Never Gonna Give You Up',
        artist: 'Rick Astley',
        currentTime: 45.2,
        duration: 213,
        isPlaying: true,
        playbackRate: 1.0,
        timestamp: Date.now()
    };

    const sanitized = sanitizePacket(validPacket);
    assert.notStrictEqual(sanitized, null);
    assert.strictEqual(sanitized.videoId, 'dQw4w9WgXcQ');
    assert.strictEqual(sanitized.track, 'Never Gonna Give You Up');
    assert.strictEqual(sanitized.currentTime, 45.2);
    assert.strictEqual(sanitized.isPlaying, true);
});

test('sanitizePacket sanitizes album art URLs and caps string lengths', () => {
    const longString = 'a'.repeat(500);
    const packet = {
        type: 'TRACK_CHANGE',
        videoId: 'dQw4w9WgXcQ',
        track: longString,
        artist: longString,
        albumArtUrl: 'https://lh3.googleusercontent.com/sample=w512-h512'
    };

    const sanitized = sanitizePacket(packet);
    assert.notStrictEqual(sanitized, null);
    assert.strictEqual(sanitized.track.length, 300);
    assert.strictEqual(sanitized.artist.length, 300);
    assert.strictEqual(sanitized.albumArtUrl, 'https://lh3.googleusercontent.com/sample=w512-h512');
});

test('sanitizePacket preserves and sanitizes playlistId', () => {
    const packet = {
        type: 'SYNC_STATE',
        videoId: 'dQw4w9WgXcQ',
        playlistId: 'RDAMVMdQw4w9WgXcQ',
        currentTime: 20,
        isPlaying: true
    };
    const sanitized = sanitizePacket(packet);
    assert.notStrictEqual(sanitized, null);
    assert.strictEqual(sanitized.playlistId, 'RDAMVMdQw4w9WgXcQ');

    const longPlaylist = {
        type: 'SYNC_STATE',
        videoId: 'dQw4w9WgXcQ',
        playlistId: 'P' + 'L'.repeat(200)
    };
    const sanitizedLong = sanitizePacket(longPlaylist);
    assert.notStrictEqual(sanitizedLong, null);
    assert.strictEqual(sanitizedLong.playlistId.length, 100);
});

test('sanitizePacket preserves and sanitizes playlistIndex and nextVideoId', () => {
    const packet = {
        type: 'SYNC_STATE',
        videoId: 'dQw4w9WgXcQ',
        playlistIndex: 3,
        nextVideoId: 'kJQP7kiw5Fk'
    };
    const sanitized = sanitizePacket(packet);
    assert.notStrictEqual(sanitized, null);
    assert.strictEqual(sanitized.playlistIndex, 3);
    assert.strictEqual(sanitized.nextVideoId, 'kJQP7kiw5Fk');

    // Rejects invalid playlistIndex (negative, NaN, non-integer)
    assert.strictEqual(sanitizePacket({ type: 'SYNC_STATE', playlistIndex: -1 }).playlistIndex, undefined);
    assert.strictEqual(sanitizePacket({ type: 'SYNC_STATE', playlistIndex: 'abc' }).playlistIndex, undefined);
    assert.strictEqual(sanitizePacket({ type: 'SYNC_STATE', playlistIndex: 3.5 }).playlistIndex, undefined);

    // Rejects invalid nextVideoId
    assert.strictEqual(sanitizePacket({ type: 'SYNC_STATE', nextVideoId: 'invalid_id!' }).nextVideoId, undefined);
});

test('sanitizePacket preserves upcomingTracks capped strictly to maximum 15 items', () => {
    const generateTracks = (n) => Array.from({ length: n }, (_, i) => ({
        videoId: `trackId${String(i).padStart(4, '0')}`,
        title: `Track ${i}`,
        artist: `Artist ${i}`
    }));

    const packet = {
        type: 'SYNC_STATE',
        videoId: 'dQw4w9WgXcQ',
        upcomingTracks: generateTracks(20)
    };
    const sanitized = sanitizePacket(packet);
    assert.notStrictEqual(sanitized, null);
    assert.strictEqual(Array.isArray(sanitized.upcomingTracks), true);
    assert.strictEqual(sanitized.upcomingTracks.length, 15);
    assert.strictEqual(sanitized.upcomingTracks[0].videoId, 'trackId0000');
    assert.strictEqual(sanitized.upcomingTracks[14].videoId, 'trackId0014');

    // Rejects items with invalid videoId
    const badPacket = {
        type: 'SYNC_STATE',
        videoId: 'dQw4w9WgXcQ',
        upcomingTracks: [
            { videoId: 'invalid_id!', title: 'Bad Track' },
            { videoId: 'kJQP7kiw5Fk', title: 'Good Track' }
        ]
    };
    const sanitizedBad = sanitizePacket(badPacket);
    assert.strictEqual(sanitizedBad.upcomingTracks.length, 1);
    assert.strictEqual(sanitizedBad.upcomingTracks[0].videoId, 'kJQP7kiw5Fk');
});

test('sanitizePacket permits QUEUE_SYNC packet type and preserves up to 15 queue items', () => {
    const queuePacket = {
        type: 'QUEUE_SYNC',
        currentVideoId: 'dQw4w9WgXcQ',
        upcomingTracks: [
            { videoId: 'kJQP7kiw5Fk', title: 'Despacito', artist: 'Luis Fonsi' },
            { videoId: 'DiItGE3eAyQ', title: 'Con Calma', artist: 'Daddy Yankee' }
        ]
    };
    const sanitized = sanitizePacket(queuePacket);
    assert.notStrictEqual(sanitized, null);
    assert.strictEqual(sanitized.type, 'QUEUE_SYNC');
    assert.strictEqual(sanitized.currentVideoId, 'dQw4w9WgXcQ');
    assert.strictEqual(sanitized.upcomingTracks.length, 2);
    assert.strictEqual(sanitized.upcomingTracks[0].videoId, 'kJQP7kiw5Fk');
});

test('sanitizePacket rejects packets with malicious or invalid fields', () => {
    // Malicious video ID
    assert.strictEqual(sanitizePacket({
        type: 'SYNC_STATE',
        videoId: '../malicious/path',
        currentTime: 10,
        timestamp: Date.now()
    }), null);

    // Negative currentTime
    assert.strictEqual(sanitizePacket({
        type: 'SYNC_STATE',
        videoId: 'dQw4w9WgXcQ',
        currentTime: -5,
        timestamp: Date.now()
    }), null);

    // Non-finite currentTime (NaN / Infinity)
    assert.strictEqual(sanitizePacket({
        type: 'SYNC_STATE',
        videoId: 'dQw4w9WgXcQ',
        currentTime: Infinity,
        timestamp: Date.now()
    }), null);

    // Unknown message type
    assert.strictEqual(sanitizePacket({
        type: 'EXECUTE_REMOTE_CODE',
        code: 'alert(1)'
    }), null);
});

// 4. Drift Calculation Tests
test('calculateDrift correctly accounts for network transit latency when playing', () => {
    const sendTime = 1000000;
    const receiveTime = 1000050; // 50ms latency
    
    const packet = {
        currentTime: 30.0,
        isPlaying: true,
        playbackRate: 1.0,
        timestamp: sendTime
    };

    // Follower is at 30.0s at receive time.
    // Host was at 30.0s 50ms ago, so Host is now at 30.05s.
    // Expected drift = 30.05 - 30.0 = +0.05s (+50ms) (Follower is 50ms behind).
    const driftSec = calculateDrift(30.0, packet, receiveTime);
    assert.strictEqual(Math.round(driftSec * 1000), 50);
});

test('calculateDrift does not advance host time when host is paused', () => {
    const sendTime = 1000000;
    const receiveTime = 1005000; // 5 seconds later
    
    const packet = {
        currentTime: 15.0,
        isPlaying: false,
        playbackRate: 1.0,
        timestamp: sendTime
    };

    // Follower is at 15.0s, host is paused at 15.0s. Drift = 0.
    const driftSec = calculateDrift(15.0, packet, receiveTime);
    assert.strictEqual(driftSec, 0);
});

// 5. 3-Tier Adaptive Speed Adjustment & Sync Action Tests
test('determineSyncAction: Perfect sync when drift < DRIFT_TOLERANCE_MS (2500ms)', () => {
    // 500ms and 1500ms drift (< 2500ms tolerance) produces NONE to prevent micro-stutter
    const action1 = determineSyncAction(500, true, true, 30.0);
    assert.strictEqual(action1.action, 'NONE');
    assert.strictEqual(action1.playbackRate, 1.0);

    const action2 = determineSyncAction(1800, true, true, 30.0);
    assert.strictEqual(action2.action, 'NONE');
    assert.strictEqual(action2.playbackRate, 1.0);
});

test('determineSyncAction: Soft speed-up when follower is behind (2500ms - 5000ms)', () => {
    // Follower is 3500ms behind host (drift = +3500ms)
    const action = determineSyncAction(3500, true, true, 30.0);
    assert.strictEqual(action.action, 'SOFT_SPEED_UP');
    assert.strictEqual(action.playbackRate, 1.05);
});

test('determineSyncAction: Soft slow-down when follower is ahead (-2500ms to -5000ms)', () => {
    // Follower is 3500ms ahead of host (drift = -3500ms)
    const action = determineSyncAction(-3500, true, true, 30.0);
    assert.strictEqual(action.action, 'SOFT_SLOW_DOWN');
    assert.strictEqual(action.playbackRate, 0.95);
});

test('determineSyncAction: Hard seek when drift > HARD_SEEK_THRESHOLD_MS (e.g. 6000ms)', () => {
    // Follower is 6000ms behind
    const action = determineSyncAction(6000, true, true, 30.0);
    assert.strictEqual(action.action, 'HARD_SEEK');
    assert.strictEqual(action.playbackRate, 1.0);
    assert.strictEqual(action.targetTime, 36.0);
});

test('determineSyncAction: uses gradual speed-up instead of hard seek when preferSpeedAdjustment is true for drift <= 5000ms', () => {
    const action = determineSyncAction(3000, true, true, 4.0, false, true);
    assert.strictEqual(action.action, 'SOFT_SPEED_UP');
    assert.strictEqual(action.playbackRate, 1.12);
    assert.strictEqual(action.targetTime, undefined);

    const actionLarge = determineSyncAction(4500, true, true, 2.0, false, true);
    assert.strictEqual(actionLarge.action, 'SOFT_SPEED_UP');
    assert.strictEqual(actionLarge.playbackRate, 1.20);

    const actionOver = determineSyncAction(6000, true, true, 2.0, false, true);
    assert.strictEqual(actionOver.action, 'HARD_SEEK');
    assert.strictEqual(actionOver.targetTime, 8.0);
});

test('determineSyncAction: Synchronizes play/pause state regardless of drift', () => {
    // Host is paused, follower is playing
    const action1 = determineSyncAction(0, true, false, 20.0);
    assert.strictEqual(action1.playPauseState, 'PAUSE');

    // Host is playing, follower is paused
    const action2 = determineSyncAction(0, false, true, 20.0);
    assert.strictEqual(action2.playPauseState, 'PLAY');
});

// 6. WebRtcSyncEngine Lifecycle & State Machine Tests
test('WebRtcSyncEngine: initializes with no ICE servers (pure broker relay)', () => {
    const engine = new WebRtcSyncEngine();
    assert.strictEqual(engine.iceServers, undefined);
    assert.strictEqual(engine.role, 'NONE');
    assert.strictEqual(engine.isHost, false);
});

test('WebRtcSyncEngine: createRoom and leaveRoom transition state correctly', () => {
    let connectionStatus = null;
    let peerCount = null;

    const engine = new WebRtcSyncEngine({
        onConnectionStatus: (status) => { connectionStatus = status; },
        onPeerCountChange: (count) => { peerCount = count; }
    });

    const roomId = engine.createRoom();
    assert.strictEqual(engine.role, 'HOST');
    assert.strictEqual(engine.isHost, true);
    assert.strictEqual(engine.roomId, roomId);
    assert.strictEqual(connectionStatus, 'hosting');

    engine.leaveRoom();
    assert.strictEqual(engine.role, 'NONE');
    assert.strictEqual(engine.isHost, false);
    assert.strictEqual(engine.roomId, null);
    assert.strictEqual(connectionStatus, 'disconnected');
    assert.strictEqual(peerCount, 0);
});

test('WebRtcSyncEngine: joinRoom sets LISTENER role', () => {
    let connectionStatus = null;

    const engine = new WebRtcSyncEngine({
        onConnectionStatus: (status) => { connectionStatus = status; }
    });

    const roomId = engine.joinRoom('YTM-ABC123');
    assert.strictEqual(engine.role, 'LISTENER');
    assert.strictEqual(engine.isHost, false);
    assert.strictEqual(engine.roomId, 'YTM-ABC123');
    assert.strictEqual(connectionStatus, 'joining');

    engine.leaveRoom();
});

test('WebRtcSyncEngine: joinRoom ignores self-join if already hosting the same room', () => {
    const engine = new WebRtcSyncEngine({});
    const hostedRoomId = engine.createRoom('YTM-HOST99');

    assert.strictEqual(engine.isHost, true);
    assert.strictEqual(engine.role, 'HOST');
    assert.strictEqual(engine.roomId, 'YTM-HOST99');

    const result = engine.joinRoom('YTM-HOST99');
    assert.strictEqual(result, 'YTM-HOST99');
    assert.strictEqual(engine.isHost, true);
    assert.strictEqual(engine.role, 'HOST');
    assert.strictEqual(engine.roomId, 'YTM-HOST99');

    engine.leaveRoom();
});

test('WebRtcSyncEngine: joinRoom ignores redundant join if already listening to the same room', () => {
    const engine = new WebRtcSyncEngine({});
    engine.joinRoom('YTM-LISTEN1');

    assert.strictEqual(engine.isHost, false);
    assert.strictEqual(engine.role, 'LISTENER');
    assert.strictEqual(engine.roomId, 'YTM-LISTEN1');

    let cleanupCalled = false;
    const origCleanup = engine.cleanup.bind(engine);
    engine.cleanup = () => {
        cleanupCalled = true;
        origCleanup();
    };

    const result = engine.joinRoom('YTM-LISTEN1');
    assert.strictEqual(result, 'YTM-LISTEN1');
    assert.strictEqual(cleanupCalled, false);
    assert.strictEqual(engine.role, 'LISTENER');

    engine.leaveRoom();
});

// 7. Extended Sanitization & Protocol Field Tests
test('sanitizePacket allows packets with null or undefined videoId without dropping the packet', () => {
    const packetWithoutVideoId = {
        type: 'SYNC_STATE',
        videoId: null,
        track: 'Song Title',
        artist: 'Artist Name',
        currentTime: 10.5,
        isPlaying: true
    };

    const sanitized = sanitizePacket(packetWithoutVideoId);
    assert.notStrictEqual(sanitized, null);
    assert.strictEqual(sanitized.type, 'SYNC_STATE');
    assert.strictEqual(sanitized.track, 'Song Title');
    assert.strictEqual(sanitized.artist, 'Artist Name');
    assert.strictEqual(sanitized.currentTime, 10.5);
    assert.strictEqual(sanitized.isPlaying, true);
    assert.strictEqual(sanitized.videoId, undefined);
});

test('sanitizePacket preserves protocol fields peerId and roomId', () => {
    const leavePacket = {
        type: 'PEER_LEAVE',
        peerId: 'peer-test123',
        roomId: 'YTM-ABCDEF'
    };

    const sanitized = sanitizePacket(leavePacket);
    assert.notStrictEqual(sanitized, null);
    assert.strictEqual(sanitized.type, 'PEER_LEAVE');
    assert.strictEqual(sanitized.peerId, 'peer-test123');
    assert.strictEqual(sanitized.roomId, 'YTM-ABCDEF');
});

// 8. Dynamic Host Live State Provider Tests
test('WebRtcSyncEngine: getLiveHostState uses getCurrentState callback when provided', () => {
    let liveTime = 42.0;
    const engine = new WebRtcSyncEngine({
        getCurrentState: () => ({
            track: 'Live Track',
            artist: 'Live Artist',
            currentTime: liveTime,
            isPlaying: true,
            playbackRate: 1.0,
            videoId: 'dQw4w9WgXcQ'
        })
    });

    const state1 = engine.getLiveHostState();
    assert.strictEqual(state1.currentTime, 42.0);
    assert.strictEqual(state1.track, 'Live Track');

    liveTime = 75.5;
    const state2 = engine.getLiveHostState();
    assert.strictEqual(state2.currentTime, 75.5);
});

// 9. Username and Peer List Tests
test('sanitizePacket preserves userName, hostName, and peers array', () => {
    const packet = {
        type: 'PEER_JOIN',
        peerId: 'peer-user1',
        userName: 'FishyPop',
        roomId: 'YTM-ABCDEF'
    };

    const sanitized = sanitizePacket(packet);
    assert.notStrictEqual(sanitized, null);
    assert.strictEqual(sanitized.userName, 'FishyPop');
    assert.strictEqual(sanitized.peerId, 'peer-user1');

    const roomInfoPacket = {
        type: 'ROOM_INFO',
        hostName: 'HostUser',
        peers: [
            { id: 'peer-1', name: 'Alice' },
            { id: 'peer-2', name: 'Bob' }
        ]
    };

    const sanitizedRoom = sanitizePacket(roomInfoPacket);
    assert.notStrictEqual(sanitizedRoom, null);
    assert.strictEqual(sanitizedRoom.hostName, 'HostUser');
    assert.strictEqual(sanitizedRoom.peers.length, 2);
    assert.strictEqual(sanitizedRoom.peers[0].name, 'Alice');
});

test('WebRtcSyncEngine: tracks peer usernames and hostName', () => {
    const engine = new WebRtcSyncEngine({
        userName: 'MyDiscordName'
    });

    assert.strictEqual(engine.userName, 'MyDiscordName');
    engine.setUserName('UpdatedName');
    assert.strictEqual(engine.userName, 'UpdatedName');

    engine.handlePeerJoin('peer-123', 'FriendUser');
    assert.strictEqual(engine.getPeerName('peer-123'), 'FriendUser');
    assert.deepStrictEqual(engine.getConnectedPeerList(), [{ id: 'peer-123', name: 'FriendUser' }]);

    engine.handlePeerLeave('peer-123');
    assert.deepStrictEqual(engine.getConnectedPeerList(), []);
});

test('sanitizePacket: preserves isAd flag and handles ad suppression', () => {
    const adPacket = {
        type: 'SYNC_STATE',
        track: 'Advertisement',
        isAd: true,
        currentTime: 5.0,
        isPlaying: true
    };

    const sanitized = sanitizePacket(adPacket);
    assert.notStrictEqual(sanitized, null);
    assert.strictEqual(sanitized.isAd, true);

    const drift = calculateDrift(10.0, sanitized);
    assert.strictEqual(drift, 0);

    const syncAction = determineSyncAction(5000, true, true, 10.0, true);
    assert.strictEqual(syncAction.action, 'NONE');
    assert.strictEqual(syncAction.driftMs, 0);
});

test('WebRtcSyncEngine: handles ROOM_CLAIMED collision and generates new room code', async () => {
    let resolvedStatus = null;
    let resolvedRoomId = null;

    const engine = new WebRtcSyncEngine({
        userName: 'HostUser',
        onConnectionStatus: (status, roomId) => {
            resolvedStatus = status;
            resolvedRoomId = roomId;
        }
    });

    const originalRoom = engine.createRoom('YTM-COLLIDE');
    assert.strictEqual(originalRoom, 'YTM-COLLIDE');

    await engine.handleSignalMessage({
        type: 'ROOM_CLAIMED',
        peerId: 'existing-host-123',
        hostName: 'ExistingHost'
    });

    assert.strictEqual(resolvedStatus, 'conflict_resolved');
    assert.notStrictEqual(resolvedRoomId, 'YTM-COLLIDE');
    assert.match(resolvedRoomId, /^YTM-[A-Z0-9]{6}$/);
    engine.leaveRoom();
});

// 10. Pure Broker Relay Handshake & Targeted Messaging Tests
test('Pure Broker Relay: Host handles ANNOUNCE_JOIN with targeted SYNC_STATE and ROOM_INFO', async () => {
    const publishedPackets = [];
    const host = new WebRtcSyncEngine({
        userName: 'HostUser',
        getCurrentState: () => ({
            track: 'Song A',
            artist: 'Artist A',
            currentTime: 15.0,
            isPlaying: true,
            videoId: 'dQw4w9WgXcQ'
        })
    });

    host.createRoom('YTM-RELAY1');
    host.publishMqttPacket = (pkt) => { publishedPackets.push(pkt); };

    await host.handleSignalMessage({
        type: 'ANNOUNCE_JOIN',
        peerId: 'listener-999',
        userName: 'ListenerBob',
        roomId: 'YTM-RELAY1'
    });

    assert.strictEqual(host.getConnectedPeerCount(), 1);
    assert.strictEqual(host.getPeerName('listener-999'), 'ListenerBob');

    // Host should have sent a targeted SYNC_STATE packet to listener-999
    const syncPkt = publishedPackets.find(p => p.type === 'SYNC_STATE');
    assert.notStrictEqual(syncPkt, undefined);
    assert.strictEqual(syncPkt.targetPeerId, 'listener-999');
    assert.strictEqual(syncPkt.track, 'Song A');
    assert.strictEqual(syncPkt.hostName, 'HostUser');

    // Host should have broadcast ROOM_INFO
    const roomInfoPkt = publishedPackets.find(p => p.type === 'ROOM_INFO');
    assert.notStrictEqual(roomInfoPkt, undefined);
    assert.strictEqual(roomInfoPkt.hostName, 'HostUser');
    assert.strictEqual(roomInfoPkt.peers.length, 1);
    assert.strictEqual(roomInfoPkt.peers[0].id, 'listener-999');

    host.leaveRoom();
});

// 11. Pure Broker Relay Target Peer Filtering Tests
test('Pure Broker Relay: Ignores packets targeted to other peers or self echoes', async () => {
    let syncActionFired = false;
    const listener = new WebRtcSyncEngine({
        userName: 'MyListener',
        onSyncAction: () => { syncActionFired = true; }
    });

    listener.joinRoom('YTM-RELAY1');

    // Packet from self (echo) - should be dropped
    await listener.handleSignalMessage({
        type: 'SYNC_STATE',
        peerId: listener.peerId,
        currentTime: 20.0,
        isPlaying: true
    });
    assert.strictEqual(syncActionFired, false);

    // Packet targeted to a different peer - should be dropped
    await listener.handleSignalMessage({
        type: 'SYNC_STATE',
        peerId: 'host-1',
        targetPeerId: 'someone-else',
        currentTime: 20.0,
        isPlaying: true
    });
    assert.strictEqual(syncActionFired, false);

    // Packet targeted to this listener - should be processed
    await listener.handleSignalMessage({
        type: 'SYNC_STATE',
        peerId: 'host-1',
        targetPeerId: listener.peerId,
        currentTime: 20.0,
        isPlaying: true
    });
    assert.strictEqual(syncActionFired, true);

    listener.leaveRoom();
});

// 12. Pure Broker Relay Playback Events Test
test('Pure Broker Relay: Listener receives PLAY, PAUSE, SEEK, and TRACK_CHANGE from host', async () => {
    const receivedActions = [];
    let receivedTrack = null;

    const listener = new WebRtcSyncEngine({
        userName: 'ListenerUser',
        onSyncAction: (pkt) => { receivedActions.push(pkt.type); },
        onTrackChange: (pkt) => { receivedTrack = pkt.track; }
    });

    listener.joinRoom('YTM-RELAY1');

    await listener.handleSignalMessage({
        type: 'PLAY',
        peerId: 'host-1',
        currentTime: 10.0,
        isPlaying: true,
        hostName: 'HostBob'
    });
    assert.strictEqual(receivedActions.includes('PLAY'), true);
    assert.strictEqual(listener.hostName, 'HostBob');

    await listener.handleSignalMessage({
        type: 'PAUSE',
        peerId: 'host-1',
        currentTime: 15.0,
        isPlaying: false
    });
    assert.strictEqual(receivedActions.includes('PAUSE'), true);

    await listener.handleSignalMessage({
        type: 'SEEK',
        peerId: 'host-1',
        currentTime: 45.0
    });
    assert.strictEqual(receivedActions.includes('SEEK'), true);

    await listener.handleSignalMessage({
        type: 'TRACK_CHANGE',
        peerId: 'host-1',
        track: 'New Song',
        artist: 'New Artist',
        videoId: 'kJQP7kiw5Fk'
    });
    assert.strictEqual(receivedTrack, 'New Song');

    listener.leaveRoom();
});

// 13. Pure Broker Relay Host Disconnect Handling Test
test('Pure Broker Relay: Listener marks host_disconnected on HOST_LEAVE', async () => {
    let lastStatus = null;
    const listener = new WebRtcSyncEngine({
        userName: 'ListenerUser',
        onConnectionStatus: (status) => { lastStatus = status; }
    });

    listener.joinRoom('YTM-RELAY1');
    assert.strictEqual(lastStatus, 'joining');

    await listener.handleSignalMessage({
        type: 'HOST_LEAVE',
        peerId: 'host-1',
        roomId: 'YTM-RELAY1'
    });

    assert.strictEqual(lastStatus, 'host_disconnected');
    listener.leaveRoom();
});

// 14. Pure Broker Relay Zero WebRTC Dependency Test
test('Pure Broker Relay: Operates entirely without RTCPeerConnection or STUN queries', () => {
    // Confirm RTCPeerConnection is undefined in Node.js and engine works without errors
    assert.strictEqual(typeof global.RTCPeerConnection, 'undefined');

    const host = new WebRtcSyncEngine();
    const roomId = host.createRoom();
    assert.strictEqual(host.role, 'HOST');
    assert.strictEqual(typeof host.roomId, 'string');

    const listener = new WebRtcSyncEngine();
    listener.joinRoom(roomId);
    assert.strictEqual(listener.role, 'LISTENER');

    host.leaveRoom();
    listener.leaveRoom();
});

// 15. Clock Sync Packet Sanitization Test
test('sanitizePacket permits CLOCK_PING and CLOCK_PONG packets with clientTime and hostTime', () => {
    const pingPacket = {
        type: 'CLOCK_PING',
        clientTime: 1700000000000,
        peerId: 'peer-abc',
        targetPeerId: 'peer-host'
    };
    const sanitizedPing = sanitizePacket(pingPacket);
    assert.notStrictEqual(sanitizedPing, null);
    assert.strictEqual(sanitizedPing.type, 'CLOCK_PING');
    assert.strictEqual(sanitizedPing.clientTime, 1700000000000);
    assert.strictEqual(sanitizedPing.peerId, 'peer-abc');
    assert.strictEqual(sanitizedPing.targetPeerId, 'peer-host');

    const pongPacket = {
        type: 'CLOCK_PONG',
        clientTime: 1700000000000,
        hostTime: 1700000000050,
        peerId: 'peer-host',
        targetPeerId: 'peer-abc'
    };
    const sanitizedPong = sanitizePacket(pongPacket);
    assert.notStrictEqual(sanitizedPong, null);
    assert.strictEqual(sanitizedPong.type, 'CLOCK_PONG');
    assert.strictEqual(sanitizedPong.clientTime, 1700000000000);
    assert.strictEqual(sanitizedPong.hostTime, 1700000000050);
});

// 16. Drift Calculation with Clock Skew Compensation Test
test('calculateDrift normalizes timestamps using clockOffset', () => {
    // Scenario: Host system clock is 2000ms AHEAD of listener system clock.
    // Host sends packet with timestamp 1002000 (its local time) and currentTime 50.0s.
    // Listener receives it when listener local time is 1000050.
    // Transit latency was 50ms.
    // Without clockOffset compensation, expectedHostTime would be 50.0 + (1000050 - 1002000)/1000 = 50.0 - 1.95s = 48.05s (completely wrong!).
    // With clockOffset = +2000ms: normalizedNow = 1000050 + 2000 = 1002050.
    // transitLatencySec = (1002050 - 1002000)/1000 = 0.05s.
    // expectedHostTime = 50.0 + 0.05 = 50.05s.
    // Listener is at 50.0s, so drift = +0.05s (+50ms).
    const packet = {
        currentTime: 50.0,
        isPlaying: true,
        playbackRate: 1.0,
        timestamp: 1002000
    };
    const driftSec = calculateDrift(50.0, packet, 1000050, 2000);
    assert.strictEqual(Math.round(driftSec * 1000), 50);
});

// 17. Ad Catch-Up Time Calculation Test
test('calculateAdCatchUpTime extrapolates current host playback position after ad', () => {
    // Host packet sent at timestamp 1000000 with currentTime = 10.0s, isPlaying: true.
    // Listener finished an ad at localNow = 1015000 (15 seconds later).
    // Clock offset = 0.
    // Expected target catch up time = 10.0 + 15.0 = 25.0s.
    const packet = {
        currentTime: 10.0,
        isPlaying: true,
        timestamp: 1000000
    };
    const catchUpSec = calculateAdCatchUpTime(packet, 1015000, 0);
    assert.strictEqual(catchUpSec, 25.0);

    // When host was paused during packet, catch up time does not advance
    const pausedPacket = {
        currentTime: 10.0,
        isPlaying: false,
        timestamp: 1000000
    };
    const pausedCatchUpSec = calculateAdCatchUpTime(pausedPacket, 1015000, 0);
    assert.strictEqual(pausedCatchUpSec, 10.0);
});

// 18. Near-End Auto-Advance Trigger Test
test('isNearTrackEnd detects when playback is within threshold of duration', () => {
    // Track duration is 180s.
    assert.strictEqual(isNearTrackEnd(179.7, 180.0, 0.4), true);
    assert.strictEqual(isNearTrackEnd(178.0, 180.0, 0.4), false);
    assert.strictEqual(isNearTrackEnd(0, 0, 0.4), false);
});

// 19. P2P Clock Sync Handshake in WebRtcSyncEngine Test
test('WebRtcSyncEngine: Host answers CLOCK_PING with CLOCK_PONG and Listener calculates median offset', async () => {
    const host = new WebRtcSyncEngine();
    host.createRoom('YTM-CLOCK1');

    let sentPacket = null;
    host.publishMqttPacket = (pkt) => { sentPacket = pkt; };

    // Listener sends CLOCK_PING to host
    await host.handleSignalMessage({
        type: 'CLOCK_PING',
        clientTime: 1000000,
        peerId: 'peer-listener-1',
        targetPeerId: host.peerId
    });

    assert.notStrictEqual(sentPacket, null);
    assert.strictEqual(sentPacket.type, 'CLOCK_PONG');
    assert.strictEqual(sentPacket.clientTime, 1000000);
    assert.strictEqual(typeof sentPacket.hostTime, 'number');
    assert.strictEqual(sentPacket.targetPeerId, 'peer-listener-1');

    const listener = new WebRtcSyncEngine();
    listener.joinRoom('YTM-CLOCK1');
    listener.hostPeerId = host.peerId;

    // Simulate listener receiving 3 pong samples
    // Sample 1: clientTime = 1000000, hostTime = 1001020, receiveTime = 1000040 (RTT 40ms, oneWay 20ms -> offset = 1001020 - 1000000 - 20 = 1000ms)
    listener.handleClockPong({ clientTime: 1000000, hostTime: 1001020 }, 1000040);
    assert.strictEqual(listener.clockOffset, 1000);

    // Sample 2: offset = 1020ms
    listener.handleClockPong({ clientTime: 1001000, hostTime: 1002040 }, 1001040);
    // Median of [1000, 1020] = (1000 + 1020)/2 = 1010ms
    assert.strictEqual(listener.clockOffset, 1010);

    // Sample 3: offset = 990ms
    listener.handleClockPong({ clientTime: 1002000, hostTime: 1003010 }, 1002040);
    // Sorted: [990, 1000, 1020] -> median is 1000ms
    assert.strictEqual(listener.clockOffset, 1000);

    host.leaveRoom();
    listener.leaveRoom();
});

test('WebRtcSyncEngine: joinRoom starts connection timeout and transitions to timeout when host does not respond', async () => {
    let lastStatus = null;
    let statusRoomId = null;

    const engine = new WebRtcSyncEngine({
        connectionTimeoutMs: 50,
        onConnectionStatus: (status, roomId) => {
            lastStatus = status;
            statusRoomId = roomId;
        }
    });

    engine.joinRoom('YTM-GHOST1');
    assert.strictEqual(engine.role, 'LISTENER');
    assert.strictEqual(engine.connectionStatus, 'connecting');
    assert.strictEqual(lastStatus, 'joining');

    await new Promise(r => setTimeout(r, 80));

    assert.strictEqual(lastStatus, 'timeout');
    assert.strictEqual(statusRoomId, 'YTM-GHOST1');
    assert.strictEqual(engine.role, 'NONE');
    assert.strictEqual(engine.roomId, null);
    assert.strictEqual(engine.connectionStatus, 'disconnected');
});

test('WebRtcSyncEngine: receiving host signal clears connection timeout and transitions to connected', async () => {
    let lastStatus = null;

    const engine = new WebRtcSyncEngine({
        connectionTimeoutMs: 80,
        onConnectionStatus: (status) => {
            lastStatus = status;
        }
    });

    engine.joinRoom('YTM-LIVE99');
    assert.strictEqual(engine.connectionStatus, 'connecting');

    // Simulate receiving ROOM_INFO from host within the timeout window
    await engine.handleSignalMessage({
        type: 'ROOM_INFO',
        peerId: 'host-peer-1',
        roomId: 'YTM-LIVE99',
        hostName: 'Alice'
    });

    assert.strictEqual(engine.connectionStatus, 'connected');
    assert.strictEqual(engine.hostPeerId, 'host-peer-1');
    assert.strictEqual(engine.hostName, 'Alice');
    assert.strictEqual(lastStatus, 'connected');

    // Wait past the original 80ms timeout window to ensure timeout was cancelled
    await new Promise(r => setTimeout(r, 100));
    assert.strictEqual(engine.connectionStatus, 'connected');
    assert.strictEqual(lastStatus, 'connected');

    engine.leaveRoom();
});

test('WebRtcSyncEngine: host inactivity triggers host_disconnected and cleans up listener', () => {
    let lastStatus = null;
    let statusRoomId = null;

    const engine = new WebRtcSyncEngine({
        onConnectionStatus: (status, roomId) => {
            lastStatus = status;
            statusRoomId = roomId;
        }
    });

    engine.joinRoom('YTM-ACTIVE1');
    engine.connectionStatus = 'connected';
    engine.hostPeerId = 'host-1';
    engine.hostName = 'Bob';

    // Simulate 12 seconds of host silence
    engine.lastHostActivity = Date.now() - 12000;
    engine.checkHostLiveness();

    assert.strictEqual(lastStatus, 'host_disconnected');
    assert.strictEqual(statusRoomId, 'YTM-ACTIVE1');
    assert.strictEqual(engine.connectionStatus, 'disconnected');
    assert.strictEqual(engine.role, 'NONE');
});

test('WebRtcSyncEngine: does not broadcast PEER_JOIN when checking liveness while host is active', () => {
    const published = [];
    const engine = new WebRtcSyncEngine({});
    engine.publishMqttPacket = (pkt) => published.push(pkt);

    engine.joinRoom('YTM-ALIVE1');
    engine.connectionStatus = 'connected';
    engine.hostPeerId = 'host-1';
    engine.hostName = 'Bob';
    published.length = 0;

    engine.lastHostActivity = Date.now() - 2000;
    engine.checkHostLiveness();

    const peerJoins = published.filter(p => p.type === 'PEER_JOIN');
    assert.strictEqual(peerJoins.length, 0);
    assert.strictEqual(engine.connectionStatus, 'connected');

    engine.leaveRoom();
});

test('WebRtcSyncEngine: transitions to connected and fires onConnectionStatus exactly once across multiple host signals', async () => {
    const statusCalls = [];
    const engine = new WebRtcSyncEngine({
        onConnectionStatus: (status, roomId) => {
            statusCalls.push({ status, roomId });
        }
    });

    engine.joinRoom('YTM-MULTI1');
    assert.strictEqual(statusCalls.length, 1);
    assert.strictEqual(statusCalls[0].status, 'joining');

    await engine.handleSignalMessage({
        type: 'ROOM_INFO',
        peerId: 'host-1',
        roomId: 'YTM-MULTI1',
        hostName: 'Alice'
    });

    await engine.handleSignalMessage({
        type: 'SYNC_STATE',
        peerId: 'host-1',
        roomId: 'YTM-MULTI1',
        track: 'Song A',
        videoId: 'otKN6C8LFzQ',
        currentTime: 10,
        isPlaying: true
    });

    await engine.handleSignalMessage({
        type: 'HEARTBEAT',
        peerId: 'host-1',
        roomId: 'YTM-MULTI1',
        track: 'Song A',
        videoId: 'otKN6C8LFzQ',
        currentTime: 11,
        isPlaying: true
    });

    await engine.handleSignalMessage({
        type: 'SYNC_STATE',
        peerId: 'host-1',
        roomId: 'YTM-MULTI1',
        track: 'Song A',
        videoId: 'otKN6C8LFzQ',
        currentTime: 12,
        isPlaying: true
    });

    const connectedCalls = statusCalls.filter(c => c.status === 'connected');
    assert.strictEqual(connectedCalls.length, 1);
    assert.strictEqual(connectedCalls[0].roomId, 'YTM-MULTI1');
    assert.strictEqual(engine.connectionStatus, 'connected');

    engine.leaveRoom();
});

test('WebRtcSyncEngine: setUserName does not broadcast PEER_JOIN if username is unchanged', () => {
    const published = [];
    const engine = new WebRtcSyncEngine({});
    engine.publishMqttPacket = (pkt) => published.push(pkt);

    engine.joinRoom('YTM-NAME1');
    engine.setUserName('Alice');
    published.length = 0;

    engine.setUserName('Alice');
    const peerJoins = published.filter(p => p.type === 'PEER_JOIN');
    assert.strictEqual(peerJoins.length, 0);

    engine.leaveRoom();
});

test('sanitizeImageUrl: permits trusted YouTube/Google domains and rejects tracking or IP-leak domains', () => {
    assert.strictEqual(sanitizeImageUrl('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.strictEqual(sanitizeImageUrl('https://i9.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'), 'https://i9.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.strictEqual(sanitizeImageUrl('https://i1.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'), 'https://i1.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.strictEqual(sanitizeImageUrl('https://lh3.googleusercontent.com/sample=w512-h512'), 'https://lh3.googleusercontent.com/sample=w512-h512');
    assert.strictEqual(sanitizeImageUrl('https://lh5.googleusercontent.com/sample=w512-h512'), 'https://lh5.googleusercontent.com/sample=w512-h512');
    assert.strictEqual(sanitizeImageUrl('https://lh1.googleusercontent.com/sample=w512-h512'), 'https://lh1.googleusercontent.com/sample=w512-h512');
    assert.strictEqual(sanitizeImageUrl('https://yt3.ggpht.com/avatar123'), 'https://yt3.ggpht.com/avatar123');

    // Reject arbitrary googleusercontent.com subdomains (Cloud Shell preview, custom containers, etc.)
    assert.strictEqual(sanitizeImageUrl('https://8080-cs-user.googleusercontent.com/pixel.png', 'dQw4w9WgXcQ'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.strictEqual(sanitizeImageUrl('https://attacker-app.googleusercontent.com/tracker.jpg', 'dQw4w9WgXcQ'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.strictEqual(sanitizeImageUrl('https://evil-googleusercontent.com/ip.png', 'dQw4w9WgXcQ'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');

    assert.strictEqual(sanitizeImageUrl('https://evil-tracking-server.com/canary.png', 'dQw4w9WgXcQ'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.strictEqual(sanitizeImageUrl('http://malicious.com/ip.jpg', 'dQw4w9WgXcQ'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.strictEqual(sanitizeImageUrl('javascript:alert(1)', 'dQw4w9WgXcQ'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.strictEqual(sanitizeImageUrl('data:image/png;base64,AAAA', 'dQw4w9WgXcQ'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.strictEqual(sanitizeImageUrl('https://evil-tracking-server.com/canary.png', null), '');
    assert.strictEqual(sanitizeImageUrl('', 'dQw4w9WgXcQ'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.strictEqual(sanitizeImageUrl(null, null), '');
});

test('sanitizePacket: sanitizes albumArtUrl and upcomingTracks thumbnail against IP leak vectors', () => {
    const maliciousPacket = {
        type: 'TRACK_CHANGE',
        videoId: 'dQw4w9WgXcQ',
        track: 'Rickroll',
        artist: 'Rick',
        albumArtUrl: 'https://evil-tracker.com/pixel.png',
        upcomingTracks: [
            { videoId: 'kJQP7kiw5Fk', title: 'Song 2', artist: 'Artist 2', thumbnail: 'https://evil-tracker.com/thumb.png' },
            { videoId: 'otKN6C8LFzQ', title: 'Song 3', artist: 'Artist 3', thumbnail: 'https://i.ytimg.com/vi/otKN6C8LFzQ/default.jpg' }
        ]
    };

    const sanitized = sanitizePacket(maliciousPacket);
    assert.strictEqual(sanitized.albumArtUrl, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.strictEqual(sanitized.upcomingTracks[0].thumbnail, 'https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg');
    assert.strictEqual(sanitized.upcomingTracks[1].thumbnail, 'https://i.ytimg.com/vi/otKN6C8LFzQ/default.jpg');
});

test('validateRoomId: validates room code formats and rejects injection, wildcards, and spaces', () => {
    assert.strictEqual(validateRoomId('YTM-ABC123'), true);
    assert.strictEqual(validateRoomId('YTM-6CHAR1'), true);
    assert.strictEqual(validateRoomId('PARTY_ROOM-99'), true);

    assert.strictEqual(validateRoomId('ytm/sync/#'), false);
    assert.strictEqual(validateRoomId('YTM+WILDCARD'), false);
    assert.strictEqual(validateRoomId('YTM-12" autofocus="'), false);
    assert.strictEqual(validateRoomId('YTM-123\n\r'), false);
    assert.strictEqual(validateRoomId('../path/traversal'), false);
    assert.strictEqual(validateRoomId('<script>'), false);
    assert.strictEqual(validateRoomId(''), false);
    assert.strictEqual(validateRoomId(null), false);
    assert.strictEqual(validateRoomId(undefined), false);
});

test('hashRoomTopic: partitions topics without predictable shared wildcard prefixes', () => {
    const topic1 = hashRoomTopic('YTM-ABC123');
    const topic2 = hashRoomTopic('YTM-XYZ789');
    assert.match(topic1, /^ytm_v2_[a-zA-Z0-9_-]+$/);
    assert.match(topic2, /^ytm_v2_[a-zA-Z0-9_-]+$/);
    assert.notStrictEqual(topic1, topic2);
    assert.strictEqual(hashRoomTopic('YTM-ABC123'), topic1);
});

test('WebRtcSyncEngine: Listener locks host peer ID and ignores host hijacking from other peers', async () => {
    const engine = new WebRtcSyncEngine({});
    engine.joinRoom('YTM-LOCK1');

    await engine.handleSignalMessage({
        type: 'ROOM_INFO',
        peerId: 'legit-host-1',
        hostName: 'LegitHost',
        roomId: 'YTM-LOCK1'
    });

    assert.strictEqual(engine.hostPeerId, 'legit-host-1');
    assert.strictEqual(engine.hostName, 'LegitHost');

    await engine.handleSignalMessage({
        type: 'SYNC_STATE',
        peerId: 'rogue-peer-99',
        hostName: 'Attacker',
        roomId: 'YTM-LOCK1',
        track: 'Hacked Song',
        videoId: 'kJQP7kiw5Fk',
        currentTime: 50,
        isPlaying: true
    });

    assert.strictEqual(engine.hostPeerId, 'legit-host-1');
    assert.strictEqual(engine.hostName, 'LegitHost');

    engine.leaveRoom();
});

test('WebRtcSyncEngine: Listener rejects control packets from rogue peers', async () => {
    let trackChangeCalled = false;
    let syncActionCalled = false;

    const listener = new WebRtcSyncEngine({
        onTrackChange: () => { trackChangeCalled = true; },
        onSyncAction: () => { syncActionCalled = true; }
    });

    listener.joinRoom('YTM-PROT1');

    const legitToken = 'tok_hostsecret1234567890';

    await listener.handleSignalMessage({
        type: 'SYNC_STATE',
        peerId: 'host-real-1',
        hostToken: legitToken,
        hostName: 'HostAlice',
        roomId: 'YTM-PROT1',
        track: 'Track 1',
        videoId: 'dQw4w9WgXcQ',
        currentTime: 10,
        isPlaying: true
    });

    trackChangeCalled = false;
    syncActionCalled = false;

    await listener.handleSignalMessage({
        type: 'TRACK_CHANGE',
        peerId: 'rogue-attacker',
        roomId: 'YTM-PROT1',
        track: 'Malicious Song',
        videoId: 'kJQP7kiw5Fk'
    });
    assert.strictEqual(trackChangeCalled, false);

    // Rogue attacker attempting to spoof host peerId but missing hostToken
    await listener.handleSignalMessage({
        type: 'TRACK_CHANGE',
        peerId: 'host-real-1',
        roomId: 'YTM-PROT1',
        track: 'Spoofed Song Missing Token',
        videoId: 'kJQP7kiw5Fk'
    });
    assert.strictEqual(trackChangeCalled, false);

    // Rogue attacker attempting to spoof host peerId with wrong hostToken
    await listener.handleSignalMessage({
        type: 'TRACK_CHANGE',
        peerId: 'host-real-1',
        hostToken: 'tok_attacker_fake_token99',
        roomId: 'YTM-PROT1',
        track: 'Spoofed Song Wrong Token',
        videoId: 'kJQP7kiw5Fk'
    });
    assert.strictEqual(trackChangeCalled, false);

    await listener.handleSignalMessage({
        type: 'PLAY',
        peerId: 'rogue-attacker',
        roomId: 'YTM-PROT1',
        currentTime: 30
    });
    assert.strictEqual(syncActionCalled, false);

    await listener.handleSignalMessage({
        type: 'PAUSE',
        peerId: 'rogue-attacker',
        roomId: 'YTM-PROT1',
        currentTime: 35
    });
    assert.strictEqual(syncActionCalled, false);

    await listener.handleSignalMessage({
        type: 'SEEK',
        peerId: 'rogue-attacker',
        roomId: 'YTM-PROT1',
        currentTime: 100
    });
    assert.strictEqual(syncActionCalled, false);

    await listener.handleSignalMessage({
        type: 'QUEUE_SYNC',
        peerId: 'rogue-attacker',
        roomId: 'YTM-PROT1',
        upcomingTracks: [{ videoId: 'kJQP7kiw5Fk', title: 'X', artist: 'Y' }]
    });
    assert.strictEqual(syncActionCalled, false);

    await listener.handleSignalMessage({
        type: 'TRACK_CHANGE',
        peerId: 'host-real-1',
        hostToken: legitToken,
        roomId: 'YTM-PROT1',
        track: 'Authorized Track',
        videoId: 'kJQP7kiw5Fk'
    });
    assert.strictEqual(trackChangeCalled, true);

    listener.leaveRoom();
});

test('WebRtcSyncEngine: Listener ignores spoofed HOST_LEAVE from rogue peers', async () => {
    let disconnectedRoom = null;
    const listener = new WebRtcSyncEngine({
        onConnectionStatus: (status, roomId) => {
            if (status === 'host_disconnected') disconnectedRoom = roomId;
        }
    });

    listener.joinRoom('YTM-LEAVE1');

    await listener.handleSignalMessage({
        type: 'ROOM_INFO',
        peerId: 'host-real-1',
        roomId: 'YTM-LEAVE1'
    });

    await listener.handleSignalMessage({
        type: 'HOST_LEAVE',
        peerId: 'rogue-attacker',
        roomId: 'YTM-LEAVE1'
    });

    assert.strictEqual(disconnectedRoom, null);
    assert.strictEqual(listener.connectionStatus, 'connected');

    await listener.handleSignalMessage({
        type: 'HOST_LEAVE',
        peerId: 'host-real-1',
        roomId: 'YTM-LEAVE1'
    });

    assert.strictEqual(disconnectedRoom, 'YTM-LEAVE1');
});

test('WebRtcSyncEngine: Host ignores ROOM_CLAIMED received after the initial probe window', async () => {
    const host = new WebRtcSyncEngine({});
    const createdRoom = host.createRoom('YTM-PROBE1');

    assert.strictEqual(host.roomId, 'YTM-PROBE1');

    host.probeWindowExpired = true;

    await host.handleSignalMessage({
        type: 'ROOM_CLAIMED',
        peerId: 'existing-host-99',
        roomId: 'YTM-PROBE1'
    });

    assert.strictEqual(host.roomId, 'YTM-PROBE1');
    assert.strictEqual(host.isHost, true);

    host.leaveRoom();
});

test('calculateDrift and calculateAdCatchUpTime: clamp transit latency and discard extreme timestamps', () => {
    const normalPacket = {
        currentTime: 100,
        isPlaying: true,
        playbackRate: 1.0,
        timestamp: 100000
    };
    const normalDrift = calculateDrift(100, normalPacket, 102000, 0);
    assert.strictEqual(normalDrift, 2);

    const staleEpochPacket = {
        currentTime: 50,
        isPlaying: true,
        playbackRate: 1.0,
        timestamp: 1000
    };
    const cappedDrift = calculateDrift(50, staleEpochPacket, 1700000000000, 0);
    assert.strictEqual(cappedDrift, 0);

    const futurePacket = {
        currentTime: 50,
        isPlaying: true,
        playbackRate: 1.0,
        timestamp: 1700000000000 + 100000
    };
    const futureDrift = calculateDrift(50, futurePacket, 1700000000000, 0);
    assert.strictEqual(futureDrift, 0);

    const normalAdPacket = {
        currentTime: 30,
        isPlaying: true,
        playbackRate: 1.0,
        timestamp: 100000
    };
    const normalAdCatchUp = calculateAdCatchUpTime(normalAdPacket, 110000, 0);
    assert.strictEqual(normalAdCatchUp, 40);

    const extremeAdPacket = {
        currentTime: 30,
        isPlaying: true,
        playbackRate: 1.0,
        timestamp: 1000
    };
    const cappedAdCatchUp = calculateAdCatchUpTime(extremeAdPacket, 1700000000000, 0);
    assert.strictEqual(cappedAdCatchUp <= 330, true);
});

test('WebRtcSyncEngine: ignores CLOCK_PONG from rogue peers and discards invalid RTT samples', async () => {
    const listener = new WebRtcSyncEngine({});
    listener.joinRoom('YTM-CLOCK2');

    await listener.handleSignalMessage({
        type: 'ROOM_INFO',
        peerId: 'host-auth-1',
        roomId: 'YTM-CLOCK2'
    });

    const now = Date.now();
    await listener.handleSignalMessage({
        type: 'CLOCK_PONG',
        peerId: 'rogue-attacker',
        clientTime: now - 50,
        hostTime: now + 50000,
        roomId: 'YTM-CLOCK2'
    });

    assert.strictEqual(listener.clockOffset, 0);
    assert.strictEqual(listener.clockOffsetSamples.length, 0);

    await listener.handleSignalMessage({
        type: 'CLOCK_PONG',
        peerId: 'host-auth-1',
        clientTime: now - 50000,
        hostTime: now,
        roomId: 'YTM-CLOCK2'
    });

    assert.strictEqual(listener.clockOffset, 0);
    assert.strictEqual(listener.clockOffsetSamples.length, 0);

    listener.leaveRoom();
});

runAllTests();


