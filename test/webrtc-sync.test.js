const assert = require('assert');

// Import the sync engine module
const {
    DRIFT_TOLERANCE_MS,
    SOFT_CATCHUP_MAX_MS,
    HARD_SEEK_THRESHOLD_MS,
    DEFAULT_ICE_SERVERS,
    calculateDrift,
    determineSyncAction,
    sanitizePacket,
    generateRoomCode,
    validateVideoId,
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
test('determineSyncAction: Perfect sync when drift < DRIFT_TOLERANCE_MS', () => {
    // 50ms drift (< 150ms tolerance)
    const action = determineSyncAction(50, true, true, 30.0);
    assert.strictEqual(action.action, 'NONE');
    assert.strictEqual(action.playbackRate, 1.0);
});

test('determineSyncAction: Soft speed-up when follower is behind (150ms - 1200ms)', () => {
    // Follower is 400ms behind host (drift = +400ms)
    const action = determineSyncAction(400, true, true, 30.0);
    assert.strictEqual(action.action, 'SOFT_SPEED_UP');
    assert.strictEqual(action.playbackRate, 1.05);
});

test('determineSyncAction: Soft slow-down when follower is ahead (-150ms to -1200ms)', () => {
    // Follower is 500ms ahead of host (drift = -500ms)
    const action = determineSyncAction(-500, true, true, 30.0);
    assert.strictEqual(action.action, 'SOFT_SLOW_DOWN');
    assert.strictEqual(action.playbackRate, 0.95);
});

test('determineSyncAction: Hard seek when drift > HARD_SEEK_THRESHOLD_MS (e.g. 3000ms)', () => {
    // Follower is 3000ms behind (e.g. host scrubbed ahead)
    const action = determineSyncAction(3000, true, true, 30.0);
    assert.strictEqual(action.action, 'HARD_SEEK');
    assert.strictEqual(action.playbackRate, 1.0);
    assert.strictEqual(action.targetTime, 33.0);
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
test('WebRtcSyncEngine: Google STUN configuration is loaded by default', () => {
    const engine = new WebRtcSyncEngine();
    assert.deepStrictEqual(engine.iceServers, DEFAULT_ICE_SERVERS);
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

runAllTests();

