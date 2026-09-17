(() => {
if (typeof window !== 'undefined' && typeof window.__ytmInitLogForwarder === 'function') {
    window.__ytmInitLogForwarder();
}
const DRIFT_TOLERANCE_MS = 2500;
const SOFT_CATCHUP_MAX_MS = 5000;
const HARD_SEEK_THRESHOLD_MS = 5000;

const DEFAULT_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
];

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `YTM-${code}`;
}

function validateVideoId(videoId) {
    if (typeof videoId !== 'string') return false;
    return /^[a-zA-Z0-9_-]{11}$/.test(videoId);
}

function sanitizePacket(packet) {
    if (!packet || typeof packet !== 'object') return null;

    const allowedTypes = [
        'SYNC_STATE',
        'HEARTBEAT',
        'PLAY',
        'PAUSE',
        'SEEK',
        'TRACK_CHANGE',
        'QUEUE_SYNC',
        'PEER_JOIN',
        'PEER_LEAVE',
        'PARTY_COMMAND',
        'ROOM_INFO',
        'ANNOUNCE_JOIN',
        'ROOM_PROBE',
        'ROOM_CLAIMED',
        'HOST_LEAVE',
        'CLOCK_PING',
        'CLOCK_PONG'
    ];

    if (!allowedTypes.includes(packet.type)) return null;

    const sanitized = { type: packet.type };

    if (packet.videoId !== undefined && packet.videoId !== null) {
        if (typeof packet.videoId === 'string' && validateVideoId(packet.videoId)) {
            sanitized.videoId = packet.videoId;
        } else if (typeof packet.videoId === 'string' && packet.videoId.length === 0) {
            // Omit empty string rather than dropping packet
        } else if (typeof packet.videoId === 'string') {
            return null;
        }
    }

    if (packet.currentVideoId !== undefined && packet.currentVideoId !== null) {
        if (typeof packet.currentVideoId === 'string' && validateVideoId(packet.currentVideoId)) {
            sanitized.currentVideoId = packet.currentVideoId;
        }
    }

    if (packet.playlistId !== undefined && packet.playlistId !== null) {
        if (typeof packet.playlistId === 'string') {
            sanitized.playlistId = packet.playlistId.slice(0, 100);
        }
    }

    if (packet.playlistIndex !== undefined && packet.playlistIndex !== null) {
        const idx = Number(packet.playlistIndex);
        if (Number.isInteger(idx) && idx >= 0 && idx <= 10000) {
            sanitized.playlistIndex = idx;
        }
    }

    if (packet.nextVideoId !== undefined && packet.nextVideoId !== null) {
        if (typeof packet.nextVideoId === 'string' && validateVideoId(packet.nextVideoId)) {
            sanitized.nextVideoId = packet.nextVideoId;
        }
    }

    if (Array.isArray(packet.upcomingTracks)) {
        sanitized.upcomingTracks = packet.upcomingTracks
            .filter(item => item && typeof item.videoId === 'string' && validateVideoId(item.videoId))
            .slice(0, 15)
            .map(item => ({
                videoId: item.videoId,
                title: typeof item.title === 'string' ? item.title.slice(0, 150) : '',
                artist: typeof item.artist === 'string' ? item.artist.slice(0, 150) : '',
                durationText: typeof item.durationText === 'string' ? item.durationText.slice(0, 20) : '',
                thumbnail: (typeof item.thumbnail === 'string' && (item.thumbnail.startsWith('http://') || item.thumbnail.startsWith('https://'))) ? item.thumbnail.slice(0, 500) : ''
            }));
    }

    if (packet.currentTime !== undefined && packet.currentTime !== null) {
        const time = Number(packet.currentTime);
        if (isNaN(time) || !isFinite(time) || time < 0 || time > 86400) return null;
        sanitized.currentTime = time;
    }

    if (packet.duration !== undefined && packet.duration !== null) {
        const dur = Number(packet.duration);
        if (isNaN(dur) || !isFinite(dur) || dur < 0 || dur > 86400) return null;
        sanitized.duration = dur;
    }

    if (packet.isPlaying !== undefined && packet.isPlaying !== null) {
        sanitized.isPlaying = Boolean(packet.isPlaying);
    }

    if (packet.playbackRate !== undefined && packet.playbackRate !== null) {
        const rate = Number(packet.playbackRate);
        if (isNaN(rate) || rate < 0.25 || rate > 4.0) return null;
        sanitized.playbackRate = rate;
    }

    if (packet.track !== undefined && packet.track !== null) {
        sanitized.track = String(packet.track).slice(0, 300);
    }

    if (packet.artist !== undefined && packet.artist !== null) {
        sanitized.artist = String(packet.artist).slice(0, 300);
    }

    if (packet.albumArtUrl !== undefined && packet.albumArtUrl !== null) {
        const url = String(packet.albumArtUrl);
        if (url.startsWith('http://') || url.startsWith('https://')) {
            sanitized.albumArtUrl = url.slice(0, 1000);
        }
    }

    if (packet.timestamp !== undefined && packet.timestamp !== null) {
        const ts = Number(packet.timestamp);
        if (isNaN(ts) || !isFinite(ts) || ts <= 0) return null;
        sanitized.timestamp = ts;
    } else {
        sanitized.timestamp = Date.now();
    }

    if (packet.isAd !== undefined && packet.isAd !== null) {
        sanitized.isAd = Boolean(packet.isAd);
    }

    if (packet.peerCount !== undefined && packet.peerCount !== null) {
        sanitized.peerCount = Math.max(0, parseInt(packet.peerCount, 10) || 0);
    }

    if (packet.hostName !== undefined && packet.hostName !== null) {
        sanitized.hostName = String(packet.hostName).slice(0, 100);
    }

    if (packet.userName !== undefined && packet.userName !== null) {
        sanitized.userName = String(packet.userName).slice(0, 100);
    }

    if (Array.isArray(packet.peers)) {
        sanitized.peers = packet.peers
            .filter(p => p && typeof p === 'object')
            .map(p => ({
                id: String(p.id || '').slice(0, 100),
                name: String(p.name || 'Listener').slice(0, 100)
            }))
            .slice(0, 50);
    }

    if (packet.peerId !== undefined && packet.peerId !== null) {
        sanitized.peerId = String(packet.peerId).slice(0, 100);
    }

    if (packet.targetPeerId !== undefined && packet.targetPeerId !== null) {
        sanitized.targetPeerId = String(packet.targetPeerId).slice(0, 100);
    }

    if (packet.roomId !== undefined && packet.roomId !== null) {
        sanitized.roomId = String(packet.roomId).slice(0, 50);
    }

    if (packet.clientTime !== undefined && packet.clientTime !== null) {
        const ct = Number(packet.clientTime);
        if (!isNaN(ct) && isFinite(ct) && ct > 0) sanitized.clientTime = ct;
    }

    if (packet.hostTime !== undefined && packet.hostTime !== null) {
        const ht = Number(packet.hostTime);
        if (!isNaN(ht) && isFinite(ht) && ht > 0) sanitized.hostTime = ht;
    }

    if (packet.action !== undefined && packet.action !== null) {
        sanitized.action = String(packet.action).slice(0, 50);
    }

    return sanitized;
}

function calculateDrift(localCurrentTime, remotePacket, localNow = Date.now(), clockOffset = 0) {
    if (!remotePacket || typeof remotePacket.currentTime !== 'number' || remotePacket.isAd) return 0;

    const normalizedNow = localNow + (typeof clockOffset === 'number' ? clockOffset : 0);
    const transitLatencySec = Math.max(0, (normalizedNow - (remotePacket.timestamp || normalizedNow)) / 1000);
    const expectedHostTime = remotePacket.isPlaying
        ? remotePacket.currentTime + (transitLatencySec * (remotePacket.playbackRate || 1.0))
        : remotePacket.currentTime;

    return expectedHostTime - localCurrentTime;
}

function calculateAdCatchUpTime(packet, localNow = Date.now(), clockOffset = 0) {
    if (!packet || typeof packet.currentTime !== 'number') return 0;
    if (!packet.isPlaying) return packet.currentTime;
    const normalizedNow = localNow + (typeof clockOffset === 'number' ? clockOffset : 0);
    const elapsedSec = Math.max(0, (normalizedNow - (packet.timestamp || normalizedNow)) / 1000);
    return packet.currentTime + (elapsedSec * (packet.playbackRate || 1.0));
}

function isNearTrackEnd(currentTime, duration, thresholdSec = 0.4) {
    if (typeof currentTime !== 'number' || typeof duration !== 'number' || duration <= 0) return false;
    return currentTime >= duration - thresholdSec;
}

function determineSyncAction(driftMs, localIsPlaying, remoteIsPlaying, localCurrentTime, isAd = false, preferSpeedAdjustment = false) {
    if (isAd) {
        return {
            action: 'NONE',
            playbackRate: 1.0,
            playPauseState: null,
            driftMs: 0
        };
    }

    const playPauseState = (localIsPlaying !== remoteIsPlaying)
        ? (remoteIsPlaying ? 'PLAY' : 'PAUSE')
        : null;

    const absDrift = Math.abs(driftMs);

    if (absDrift <= DRIFT_TOLERANCE_MS) {
        return {
            action: 'NONE',
            playbackRate: 1.0,
            playPauseState,
            driftMs
        };
    }

    if (preferSpeedAdjustment && driftMs > 0 && driftMs <= 5000) {
        let playbackRate = 1.05;
        if (driftMs > 3000) playbackRate = 1.20;
        else if (driftMs > 1200) playbackRate = 1.12;

        return {
            action: 'SOFT_SPEED_UP',
            playbackRate,
            playPauseState,
            driftMs
        };
    }

    if (absDrift <= SOFT_CATCHUP_MAX_MS) {
        const playbackRate = driftMs > 0 ? 1.05 : 0.95;
        return {
            action: driftMs > 0 ? 'SOFT_SPEED_UP' : 'SOFT_SLOW_DOWN',
            playbackRate,
            playPauseState,
            driftMs
        };
    }

    const targetTime = Math.max(0, localCurrentTime + (driftMs / 1000));
    return {
        action: 'HARD_SEEK',
        playbackRate: 1.0,
        targetTime,
        playPauseState,
        driftMs
    };
}

class WebRtcSyncEngine {
    constructor(options = {}) {
        this.iceServers = options.iceServers || DEFAULT_ICE_SERVERS;
        this.role = 'NONE';
        this.roomId = null;
        this.peerId = `peer-${Math.random().toString(36).substring(2, 9)}`;
        this.isHost = false;
        this.userName = options.userName || 'Anonymous';
        this.hostName = null;
        this.peerUsers = new Map();
        this.signalingSocket = null;
        this.isSignalingReady = false;
        this.heartbeatTimer = null;
        this.livenessCheckTimer = null;
        this.lastHostActivity = 0;
        this.partyMode = false;
        this.currentTrackState = null;
        this.clockOffsetSamples = [];
        this.clockOffset = 0;
        this.clockPingTimer = null;
        this.connectionTimeoutMs = (options && typeof options.connectionTimeoutMs === 'number') ? options.connectionTimeoutMs : 10000;
        this.connectionTimeoutTimer = null;
        this.connectionStatus = 'disconnected';

        this.getCurrentState = options.getCurrentState || null;
        this.onSyncAction = options.onSyncAction || (() => {});
        this.onTrackChange = options.onTrackChange || (() => {});
        this.onPeerCountChange = options.onPeerCountChange || (() => {});
        this.onPeersChange = options.onPeersChange || (() => {});
        this.onConnectionStatus = options.onConnectionStatus || (() => {});
    }

    getEstimatedHostTime(localNow = Date.now()) {
        return localNow + (typeof this.clockOffset === 'number' ? this.clockOffset : 0);
    }

    handleClockPong(signal, receiveTime = Date.now()) {
        if (!signal || typeof signal.clientTime !== 'number' || typeof signal.hostTime !== 'number') return;
        const rtt = Math.max(0, receiveTime - signal.clientTime);
        const oneWay = rtt / 2;
        const offset = Math.round(signal.hostTime - signal.clientTime - oneWay);
        this.clockOffsetSamples.push(offset);
        if (this.clockOffsetSamples.length > 5) this.clockOffsetSamples.shift();
        const sorted = [...this.clockOffsetSamples].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        this.clockOffset = sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
    }

    startClockSync() {
        if (this.clockPingTimer) clearInterval(this.clockPingTimer);
        const sendPing = () => {
            if (this.role === 'LISTENER' && this.hostPeerId) {
                this.publishMqttPacket({
                    type: 'CLOCK_PING',
                    clientTime: Date.now(),
                    peerId: this.peerId,
                    roomId: this.roomId,
                    targetPeerId: this.hostPeerId
                });
            }
        };
        sendPing();
        this.clockPingTimer = setInterval(sendPing, 5000);
    }

    setUserName(name) {
        if (!name) return;
        const normalized = String(name).slice(0, 100);
        if (this.userName === normalized) return;
        this.userName = normalized;
        if (this.isHost) {
            this.broadcastRoomInfo();
        } else if (this.role === 'LISTENER') {
            this.broadcastPacket({
                type: 'PEER_JOIN',
                peerId: this.peerId,
                userName: this.userName
            });
        }
        this.notifyPeersChange();
    }

    handlePeerJoin(peerId, userName) {
        this.peerUsers.set(peerId, userName || 'Listener');
        this.notifyPeersChange();
    }

    handlePeerLeave(peerId) {
        this.peerUsers.delete(peerId);
        this.notifyPeersChange();
    }

    getPeerName(peerId) {
        return this.peerUsers.get(peerId) || 'Listener';
    }

    getConnectedPeerList() {
        return Array.from(this.peerUsers.entries()).map(([id, name]) => ({ id, name }));
    }

    notifyPeersChange() {
        const count = this.getConnectedPeerCount();
        this.onPeerCountChange(count);
        if (typeof this.onPeersChange === 'function') {
            this.onPeersChange({
                count,
                hostName: this.hostName || (this.isHost ? this.userName : null),
                peers: this.getConnectedPeerList()
            });
        }
    }

    broadcastRoomInfo() {
        if (!this.isHost) return;
        this.broadcastPacket({
            type: 'ROOM_INFO',
            hostName: this.userName,
            peers: this.getConnectedPeerList()
        });
    }

    getLiveHostState() {
        if (typeof this.getCurrentState === 'function') {
            try {
                const live = this.getCurrentState();
                if (live && typeof live === 'object') {
                    return {
                        ...(this.currentTrackState || {}),
                        ...live
                    };
                }
            } catch (e) {
                console.warn('[WebRTC Sync] Error getting live host state:', e);
            }
        }
        return this.currentTrackState;
    }

    createRoom(customRoomId = null) {
        this.cleanup();
        this.isHost = true;
        this.role = 'HOST';
        this.roomId = customRoomId || generateRoomCode();
        this.connectionStatus = 'connected';
        console.log(`[WebRTC Sync] Hosting room created: ${this.roomId} (peerId: ${this.peerId})`);
        this.connectSignaling();
        this.startHeartbeat();
        this.onConnectionStatus('hosting', this.roomId);
        return this.roomId;
    }

    joinRoom(roomId) {
        const normalized = roomId ? roomId.trim().toUpperCase() : '';
        if (this.isHost && this.roomId === normalized) {
            console.warn(`[WebRTC Sync] Cannot join room ${normalized}: Already hosting this room.`);
            return this.roomId;
        }
        if (this.role === 'LISTENER' && this.roomId === normalized && this.signalingSocket) {
            console.log(`[WebRTC Sync] Already joined room: ${normalized}`);
            return this.roomId;
        }
        this.cleanup();
        this.isHost = false;
        this.role = 'LISTENER';
        this.roomId = normalized;
        this.connectionStatus = 'connecting';
        this.hostPeerId = null;
        this.hostName = null;
        this.lastHostActivity = 0;
        console.log(`[WebRTC Sync] Joining room: ${this.roomId} (peerId: ${this.peerId})`);
        this.connectSignaling();
        this.startLivenessCheck();
        this.startConnectionTimeout();
        this.onConnectionStatus('joining', this.roomId);
        return this.roomId;
    }

    startConnectionTimeout() {
        this.clearConnectionTimeout();
        this.connectionTimeoutTimer = setTimeout(() => {
            if (this.role === 'LISTENER' && this.connectionStatus !== 'connected') {
                console.warn(`[WebRTC Sync] Connection timed out waiting for host in room: ${this.roomId}`);
                const timedOutRoomId = this.roomId;
                this.cleanup();
                this.role = 'NONE';
                this.roomId = null;
                this.onConnectionStatus('timeout', timedOutRoomId);
            }
        }, this.connectionTimeoutMs);
    }

    clearConnectionTimeout() {
        if (this.connectionTimeoutTimer) {
            clearTimeout(this.connectionTimeoutTimer);
            this.connectionTimeoutTimer = null;
        }
    }

    leaveRoom() {
        if (this.role === 'HOST') {
            this.broadcastPacket({ type: 'HOST_LEAVE', peerId: this.peerId, roomId: this.roomId });
        } else if (this.role === 'LISTENER') {
            this.broadcastPacket({ type: 'PEER_LEAVE', peerId: this.peerId, roomId: this.roomId });
        }
        this.cleanup();
        this.onConnectionStatus('disconnected', null);
    }

    cleanup() {
        this.clearConnectionTimeout();
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }

        if (this.livenessCheckTimer) {
            clearInterval(this.livenessCheckTimer);
            this.livenessCheckTimer = null;
        }

        if (this.signalingSocket) {
            try {
                this.signalingSocket.onopen = null;
                this.signalingSocket.onmessage = null;
                this.signalingSocket.onerror = null;
                this.signalingSocket.onclose = null;
                this.signalingSocket.close();
            } catch (e) {}
            this.signalingSocket = null;
        }

        if (this.clockPingTimer) {
            clearInterval(this.clockPingTimer);
            this.clockPingTimer = null;
        }
        this.clockOffsetSamples = [];
        this.clockOffset = 0;
        this.hostPeerId = null;

        this.isSignalingReady = false;
        this.lastHostActivity = 0;
        this.peerUsers.clear();
        this.hostName = null;
        this.connectionStatus = 'disconnected';

        this.role = 'NONE';
        this.roomId = null;
        this.isHost = false;
        this.notifyPeersChange();
    }

    connectSignaling() {
        if (typeof WebSocket === 'undefined') return;

        const relayUrl = `wss://broker.hivemq.com:8884/mqtt`;
        const clientId = `ytm_${this.peerId}_${Date.now()}`;
        const topic = `ytm/sync/${this.roomId}`;

        try {
            console.log(`[WebRTC Sync] Connecting to signaling broker: ${relayUrl}`);
            this.signalingSocket = new WebSocket(relayUrl, ['mqtt']);
            this.signalingSocket.binaryType = 'arraybuffer';

            this.signalingSocket.onopen = () => {
                console.log('[WebRTC Sync] Signaling WebSocket opened. Sending MQTT CONNECT...');
                this.sendMqttConnect(clientId);
            };

            this.signalingSocket.onmessage = (event) => {
                this.handleMqttMessage(event.data, topic);
            };

            this.signalingSocket.onerror = (err) => {
                console.warn('[WebRTC Sync] Signaling socket error:', err);
            };

            this.signalingSocket.onclose = () => {
                this.isSignalingReady = false;
                if (this.role !== 'NONE') {
                    console.log('[WebRTC Sync] Signaling socket closed. Scheduling reconnect...');
                    setTimeout(() => {
                        if (this.role !== 'NONE') {
                            this.connectSignaling();
                        }
                    }, 3000);
                }
            };
        } catch (e) {
            console.error('[WebRTC Sync] Failed to initiate signaling:', e);
        }
    }

    sendMqttConnect(clientId) {
        const protocol = 'MQTT';
        const protoLen = protocol.length;
        const clientIdBytes = new TextEncoder().encode(clientId);
        
        const varHeader = [0, protoLen, ...new TextEncoder().encode(protocol), 4, 2, 0, 60];
        const payload = [0, clientIdBytes.length, ...clientIdBytes];
        const remainingLength = varHeader.length + payload.length;

        const packet = new Uint8Array([0x10, remainingLength, ...varHeader, ...payload]);
        if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
            this.signalingSocket.send(packet.buffer);
        }
    }

    sendMqttSubscribe(topic) {
        const topicBytes = new TextEncoder().encode(topic);
        const packetId = [0, 1];
        const payload = [0, topicBytes.length, ...topicBytes, 0];
        const remainingLength = packetId.length + payload.length;

        const packet = new Uint8Array([0x82, remainingLength, ...packetId, ...payload]);
        if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
            this.signalingSocket.send(packet.buffer);
        }
    }

    publishMqttPacket(msg) {
        const sanitized = sanitizePacket(msg);
        if (!sanitized) {
            console.warn('[Listen Together Engine] publishMqttPacket dropped invalid packet:', msg);
            return;
        }

        console.log(`[Listen Together Engine] Publishing ${sanitized.type} (room: ${this.roomId}, target: ${sanitized.targetPeerId || 'all'}, videoId: ${sanitized.videoId || 'none'}, track: "${sanitized.track || ''}")`);

        const payloadString = JSON.stringify(sanitized);
        const payloadBytes = new TextEncoder().encode(payloadString);
        const topic = `ytm/sync/${this.roomId}`;
        const topicBytes = new TextEncoder().encode(topic);

        const varHeader = [0, topicBytes.length, ...topicBytes];
        const remainingLength = varHeader.length + payloadBytes.length;

        let lenBytes = [];
        let len = remainingLength;
        do {
            let digit = len % 128;
            len = Math.floor(len / 128);
            if (len > 0) digit |= 0x80;
            lenBytes.push(digit);
        } while (len > 0);

        const packet = new Uint8Array([0x30, ...lenBytes, ...varHeader, ...payloadBytes]);
        if (this.signalingSocket && this.signalingSocket.readyState === WebSocket.OPEN) {
            this.signalingSocket.send(packet.buffer);
        }
    }

    handleMqttMessage(data, topic) {
        try {
            const bytes = new Uint8Array(data);
            const packetType = bytes[0] & 0xf0;

            if (packetType === 0x20) {
                console.log(`[WebRTC Sync] MQTT Connected (CONNACK). Subscribing to: ${topic}`);
                this.sendMqttSubscribe(topic);
            } else if (packetType === 0x90) {
                console.log(`[WebRTC Sync] MQTT Subscribed (SUBACK) for room: ${this.roomId}`);
                this.isSignalingReady = true;
                if (this.isHost) {
                    console.log(`[WebRTC Sync] Host probing room for existing hosts: ${this.roomId}`);
                    this.publishMqttPacket({
                        type: 'ROOM_PROBE',
                        peerId: this.peerId,
                        roomId: this.roomId,
                        hostName: this.userName
                    });
                } else {
                    console.log('[WebRTC Sync] Listener announcing presence to host...');
                    this.publishMqttPacket({
                        type: 'ANNOUNCE_JOIN',
                        peerId: this.peerId,
                        roomId: this.roomId,
                        userName: this.userName
                    });
                }
            } else if (packetType === 0x30) {
                let idx = 1;
                let multiplier = 1;
                let remLen = 0;
                while (idx < bytes.length) {
                    const digit = bytes[idx++];
                    remLen += (digit & 0x7f) * multiplier;
                    multiplier *= 128;
                    if ((digit & 0x80) === 0) break;
                }
                const topicLen = (bytes[idx] << 8) + bytes[idx + 1];
                idx += 2 + topicLen;
                const payloadBytes = bytes.slice(idx);
                const payloadStr = new TextDecoder().decode(payloadBytes);
                const signal = JSON.parse(payloadStr);

                if (signal.peerId === this.peerId) return;

                console.log(`[Listen Together Engine] Received packet: type=${signal.type}, from=${signal.peerId}, target=${signal.targetPeerId || 'all'}, videoId=${signal.videoId || 'none'}, track="${signal.track || ''}"`);

                this.handleSignalMessage(signal);
            }
        } catch (e) {
            console.warn('[WebRTC Sync] Error parsing MQTT message:', e);
        }
    }

    async handleSignalMessage(rawSignal) {
        const signal = sanitizePacket(rawSignal);
        if (!signal) {
            console.warn('[Listen Together Engine] handleSignalMessage dropped invalid packet:', rawSignal);
            return;
        }

        const { type, peerId, targetPeerId } = signal;
        if (peerId === this.peerId) return;
        if (targetPeerId && targetPeerId !== this.peerId) {
            console.log(`[Listen Together Engine] Dropping packet targeted to ${targetPeerId} (this peer is ${this.peerId})`);
            return;
        }

        if (this.isHost) {
            if (type === 'CLOCK_PING') {
                this.publishMqttPacket({
                    type: 'CLOCK_PONG',
                    clientTime: signal.clientTime,
                    hostTime: Date.now(),
                    peerId: this.peerId,
                    roomId: this.roomId,
                    targetPeerId: peerId
                });
                return;
            } else if (type === 'ROOM_PROBE') {
                console.log(`[WebRTC Sync] Another peer probed this room. Replying ROOM_CLAIMED from host: ${this.peerId}`);
                this.publishMqttPacket({
                    type: 'ROOM_CLAIMED',
                    peerId: this.peerId,
                    hostName: this.userName,
                    roomId: this.roomId,
                    targetPeerId: peerId
                });
                return;
            } else if (type === 'ROOM_CLAIMED') {
                console.warn(`[WebRTC Sync] Room conflict detected! Room ${this.roomId} is already claimed by ${signal.hostName || signal.peerId}. Regenerating room code...`);
                const newRoomId = generateRoomCode();
                this.leaveRoom();
                this.createRoom(newRoomId);
                this.onConnectionStatus('conflict_resolved', newRoomId);
                return;
            } else if (type === 'ANNOUNCE_JOIN' || type === 'PEER_JOIN') {
                console.log(`[Listen Together] Peer joined room: "${signal.userName || 'Listener'}" (${peerId})`);
                this.handlePeerJoin(peerId, signal.userName || 'Listener');
                const liveState = this.getLiveHostState();
                if (liveState) {
                    this.sendPacketToPeer(peerId, {
                        type: 'SYNC_STATE',
                        ...liveState,
                        hostName: this.userName,
                        timestamp: Date.now()
                    });
                }
                this.broadcastRoomInfo();
            } else if (type === 'PEER_LEAVE') {
                console.log(`[Listen Together] Peer left: ${peerId}`);
                this.handlePeerLeave(peerId);
                this.broadcastRoomInfo();
            } else if (type === 'PARTY_COMMAND' && this.partyMode) {
                this.onSyncAction(signal);
            }
        } else {
            if (type === 'CLOCK_PONG') {
                this.handleClockPong(signal);
                return;
            }
            if (['ROOM_INFO', 'SYNC_STATE', 'HEARTBEAT', 'PLAY', 'PAUSE', 'SEEK', 'TRACK_CHANGE', 'QUEUE_SYNC'].includes(type)) {
                this.clearConnectionTimeout();
                const wasConnecting = (this.connectionStatus === 'connecting');
                this.connectionStatus = 'connected';
                this.lastHostActivity = Date.now();
                if (wasConnecting) {
                    this.onConnectionStatus('connected', this.roomId);
                }
            }
            if (type === 'ROOM_INFO') {
                this.hostName = signal.hostName || 'Host';
                if (peerId && (!this.clockPingTimer || this.hostPeerId !== peerId)) {
                    this.hostPeerId = peerId;
                    this.startClockSync();
                }
                this.peerUsers.clear();
                if (Array.isArray(signal.peers)) {
                    for (const p of signal.peers) {
                        if (p && p.id && p.id !== this.peerId) {
                            this.peerUsers.set(p.id, p.name || 'Listener');
                        }
                    }
                }
                this.notifyPeersChange();
            } else if (type === 'SYNC_STATE') {
                if (signal.hostName) this.hostName = signal.hostName;
                if (peerId && (!this.clockPingTimer || this.hostPeerId !== peerId)) {
                    this.hostPeerId = peerId;
                    this.startClockSync();
                }
                console.log(`[Listen Together Listener] Handling SYNC_STATE from host (${signal.hostName || peerId}): track="${signal.track}" (ID: ${signal.videoId}, time: ${signal.currentTime}, isPlaying: ${signal.isPlaying})`);
                this.onSyncAction(signal);
            } else if (type === 'HEARTBEAT') {
                if (signal.hostName) this.hostName = signal.hostName;
                this.onSyncAction(signal);
            } else if (type === 'PLAY' || type === 'PAUSE' || type === 'SEEK') {
                if (signal.hostName) this.hostName = signal.hostName;
                console.log(`[Listen Together Listener] Received ${type} from host: currentTime=${signal.currentTime}`);
                this.onSyncAction(signal);
            } else if (type === 'TRACK_CHANGE') {
                if (signal.hostName) this.hostName = signal.hostName;
                console.log(`[Listen Together Listener] Handling TRACK_CHANGE from host: track="${signal.track}" by "${signal.artist}" (ID: ${signal.videoId})`);
                this.onTrackChange(signal);
            } else if (type === 'QUEUE_SYNC') {
                if (signal.hostName) this.hostName = signal.hostName;
                console.log(`[Listen Together Listener] Received QUEUE_SYNC from host: ${signal.upcomingTracks ? signal.upcomingTracks.length : 0} upcoming tracks`);
                this.onSyncAction(signal);
            } else if (type === 'HOST_LEAVE') {
                console.log(`[Listen Together] Host left room: ${this.roomId}`);
                const leftRoomId = this.roomId;
                this.cleanup();
                this.onConnectionStatus('host_disconnected', leftRoomId);
            } else if (type === 'PEER_JOIN') {
                if (signal.peerId && signal.peerId !== this.peerId) {
                    this.handlePeerJoin(signal.peerId, signal.userName || 'Listener');
                }
            } else if (type === 'PEER_LEAVE') {
                if (signal.peerId) {
                    this.handlePeerLeave(signal.peerId);
                }
            }
        }
    }

    broadcastPacket(packet) {
        this.publishMqttPacket({
            ...packet,
            peerId: this.peerId,
            roomId: this.roomId
        });
    }

    sendPacketToPeer(peerId, packet) {
        this.publishMqttPacket({
            ...packet,
            peerId: this.peerId,
            roomId: this.roomId,
            targetPeerId: peerId
        });
    }

    updateHostState(trackState) {
        if (!this.isHost) return;
        this.currentTrackState = trackState;
        this.broadcastPacket({
            type: 'SYNC_STATE',
            ...trackState,
            hostName: this.userName,
            timestamp: Date.now()
        });
    }

    notifyTrackChange(trackInfo) {
        if (!this.isHost) return;
        this.currentTrackState = trackInfo;
        console.log(`[Listen Together Host] notifyTrackChange broadcasting: "${trackInfo.track}" by "${trackInfo.artist}" (ID: ${trackInfo.videoId})`);
        this.broadcastPacket({
            type: 'TRACK_CHANGE',
            ...trackInfo,
            hostName: this.userName,
            timestamp: Date.now()
        });
    }

    notifyQueueSync(queueData) {
        if (!this.isHost) return;
        this.broadcastPacket({
            type: 'QUEUE_SYNC',
            ...queueData,
            hostName: this.userName,
            timestamp: Date.now()
        });
    }

    notifyPlay(currentTime) {
        if (!this.isHost) return;
        this.broadcastPacket({
            type: 'PLAY',
            currentTime,
            isPlaying: true,
            hostName: this.userName,
            timestamp: Date.now()
        });
    }

    notifyPause(currentTime) {
        if (!this.isHost) return;
        this.broadcastPacket({
            type: 'PAUSE',
            currentTime,
            isPlaying: false,
            hostName: this.userName,
            timestamp: Date.now()
        });
    }

    notifySeek(currentTime) {
        if (!this.isHost) return;
        this.broadcastPacket({
            type: 'SEEK',
            currentTime,
            hostName: this.userName,
            timestamp: Date.now()
        });
    }

    startHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(() => {
            if (this.isHost) {
                const liveState = this.getLiveHostState();
                if (liveState) {
                    this.broadcastPacket({
                        type: 'HEARTBEAT',
                        ...liveState,
                        hostName: this.userName,
                        timestamp: Date.now()
                    });
                }
            }
        }, 1000);
    }

    checkHostLiveness() {
        if (this.role === 'LISTENER' && this.connectionStatus === 'connected' && this.lastHostActivity > 0) {
            if (Date.now() - this.lastHostActivity > 10000) {
                const timedOutRoomId = this.roomId;
                this.cleanup();
                this.onConnectionStatus('host_disconnected', timedOutRoomId);
            }
        }
    }

    startLivenessCheck() {
        if (this.livenessCheckTimer) clearInterval(this.livenessCheckTimer);
        this.livenessCheckTimer = setInterval(() => {
            this.checkHostLiveness();
        }, 3000);
    }

    getConnectedPeerCount() {
        return this.peerUsers.size;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        DRIFT_TOLERANCE_MS,
        SOFT_CATCHUP_MAX_MS,
        HARD_SEEK_THRESHOLD_MS,
        DEFAULT_ICE_SERVERS,
        generateRoomCode,
        validateVideoId,
        sanitizePacket,
        calculateDrift,
        calculateAdCatchUpTime,
        isNearTrackEnd,
        determineSyncAction,
        WebRtcSyncEngine,
        BrokerSyncEngine: WebRtcSyncEngine
    };
}

if (typeof window !== 'undefined') {
    window.WebRtcSyncEngine = WebRtcSyncEngine;
    window.BrokerSyncEngine = WebRtcSyncEngine;
    window.ytmGenerateRoomCode = generateRoomCode;
    window.ytmValidateVideoId = validateVideoId;
    window.ytmSanitizePacket = sanitizePacket;
    window.ytmCalculateDrift = calculateDrift;
    window.ytmCalculateAdCatchUpTime = calculateAdCatchUpTime;
    window.ytmIsNearTrackEnd = isNearTrackEnd;
    window.ytmDetermineSyncAction = determineSyncAction;
}
})();
