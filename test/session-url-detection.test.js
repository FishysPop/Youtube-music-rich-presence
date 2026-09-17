const assert = require('assert');

function parseSessionFromUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;

    try {
        const urlObj = new URL(rawUrl, 'https://music.youtube.com');

        const searchParam = urlObj.searchParams.get('ytm-session') || urlObj.searchParams.get('session');
        if (searchParam && /^[a-zA-Z0-9_-]+$/.test(searchParam)) {
            return searchParam.toUpperCase();
        }

        const hash = urlObj.hash || '';
        const hashMatch = hash.match(/(?:ytm-session|session)=([a-zA-Z0-9_-]+)/i);
        if (hashMatch && hashMatch[1]) {
            return hashMatch[1].toUpperCase();
        }

        const rawMatch = rawUrl.match(/[?#&](?:ytm-session|session)=([a-zA-Z0-9_-]+)/i);
        if (rawMatch && rawMatch[1]) {
            return rawMatch[1].toUpperCase();
        }
    } catch (e) {
        const rawMatch = rawUrl.match(/[?#&](?:ytm-session|session)=([a-zA-Z0-9_-]+)/i);
        if (rawMatch && rawMatch[1]) {
            return rawMatch[1].toUpperCase();
        }
    }

    return null;
}

function parseSessionInput(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') return null;
    const input = rawInput.trim();
    if (!input) return null;

    if (/^https?:\/\//i.test(input) || input.includes('://')) {
        try {
            const u = new URL(input);
            const q = u.searchParams.get('ytm-session') || u.searchParams.get('session');
            if (q && /^[a-zA-Z0-9_-]+$/.test(q)) return q.toUpperCase();

            const h = u.hash || '';
            const m = h.match(/(?:ytm-session|session)=([a-zA-Z0-9_-]+)/i);
            if (m && m[1]) return m[1].toUpperCase();
        } catch (e) {}
    }

    const paramMatch = input.match(/(?:[?#&]|^)(?:ytm-session|session)=([a-zA-Z0-9_-]+)/i);
    if (paramMatch && paramMatch[1]) {
        return paramMatch[1].toUpperCase();
    }

    const ytmMatch = input.match(/\b(YTM-[a-zA-Z0-9_-]+)\b/i);
    if (ytmMatch && ytmMatch[1]) {
        return ytmMatch[1].toUpperCase();
    }

    if (/^[a-zA-Z0-9]{6}$/.test(input)) {
        return `YTM-${input.toUpperCase()}`;
    }

    if (/^[a-zA-Z0-9_-]{3,32}$/.test(input)) {
        return input.toUpperCase();
    }

    return null;
}

function resolveYouTubeMusicTabAction(existingTabs, currentTabId = null) {
    const validTabs = (existingTabs || []).filter(tab => {
        if (!tab || !tab.url) return false;
        if (currentTabId !== null && tab.id === currentTabId) return false;
        try {
            const parsed = new URL(tab.url);
            return parsed.hostname === 'music.youtube.com';
        } catch (e) {
            return tab.url.includes('music.youtube.com');
        }
    });

    if (validTabs.length > 0) {
        const activeTab = validTabs.find(t => t.active) || validTabs[0];
        return {
            action: 'FOCUS_EXISTING',
            tabId: activeTab.id,
            windowId: activeTab.windowId
        };
    }

    return {
        action: 'CREATE_NEW'
    };
}

function resolveGatewaySessionAction(activeRole, activeRoomId, incomingRoomId, existingTabs, currentTabId = null) {
    const normalizedIncoming = incomingRoomId ? incomingRoomId.trim().toUpperCase() : null;
    const normalizedActive = activeRoomId ? activeRoomId.trim().toUpperCase() : null;

    const tabRouting = resolveYouTubeMusicTabAction(existingTabs, currentTabId);

    if (normalizedIncoming && normalizedActive && normalizedIncoming === normalizedActive) {
        if (activeRole === 'HOST') {
            return {
                action: 'ALREADY_HOST',
                shouldSendJoin: false,
                toast: `You are already hosting session ${normalizedIncoming}`,
                tabRouting
            };
        }
        if (activeRole === 'LISTENER') {
            return {
                action: 'ALREADY_LISTENING',
                shouldSendJoin: false,
                toast: `Already connected to session ${normalizedIncoming}`,
                tabRouting
            };
        }
    }

    return {
        action: 'JOIN',
        shouldSendJoin: true,
        roomId: normalizedIncoming,
        tabRouting
    };
}

let testCount = 0;
let passedCount = 0;

function test(name, fn) {
    testCount++;
    try {
        fn();
        passedCount++;
        console.log(`  [PASS] ${name}`);
    } catch (err) {
        console.error(`  [FAIL] ${name}:`, err);
        throw err;
    }
}

console.log('Running Session URL Detection and Tab Routing Tests...');

test('parseSessionFromUrl extracts session from GitHub Pages gateway query param', () => {
    const url = 'https://fishyspop.github.io/Youtube-music-rich-presence/?ytm-session=YTM-MCESHE';
    assert.strictEqual(parseSessionFromUrl(url), 'YTM-MCESHE');
});

test('parseSessionFromUrl extracts session from GitHub Pages short session query param', () => {
    const url = 'https://fishyspop.github.io/Youtube-music-rich-presence/?session=YTM-MCESHE';
    assert.strictEqual(parseSessionFromUrl(url), 'YTM-MCESHE');
});

test('parseSessionFromUrl extracts session from GitHub Pages hash', () => {
    const url = 'https://fishyspop.github.io/Youtube-music-rich-presence/#ytm-session=YTM-ABC123';
    assert.strictEqual(parseSessionFromUrl(url), 'YTM-ABC123');
});

test('parseSessionFromUrl extracts session from YouTube Music root hash', () => {
    const url = 'https://music.youtube.com/#ytm-session=YTM-MCESHE';
    assert.strictEqual(parseSessionFromUrl(url), 'YTM-MCESHE');
});

test('parseSessionFromUrl extracts session from YouTube Music root query param', () => {
    const url = 'https://music.youtube.com/?ytm-session=YTM-MCESHE';
    assert.strictEqual(parseSessionFromUrl(url), 'YTM-MCESHE');
});

test('parseSessionFromUrl extracts session from YouTube Music watch page query param', () => {
    const url = 'https://music.youtube.com/watch?v=5NV6Rdv1a3I&ytm-session=YTM-MCESHE';
    assert.strictEqual(parseSessionFromUrl(url), 'YTM-MCESHE');
});

test('parseSessionFromUrl normalizes room code to uppercase', () => {
    const url = 'https://music.youtube.com/?ytm-session=ytm-mceshe';
    assert.strictEqual(parseSessionFromUrl(url), 'YTM-MCESHE');
});

test('parseSessionFromUrl rejects malformed or invalid inputs safely', () => {
    assert.strictEqual(parseSessionFromUrl(null), null);
    assert.strictEqual(parseSessionFromUrl(''), null);
    assert.strictEqual(parseSessionFromUrl('https://music.youtube.com/'), null);
    assert.strictEqual(parseSessionFromUrl('https://music.youtube.com/?foo=bar'), null);
    assert.strictEqual(parseSessionFromUrl('https://music.youtube.com/#invalid$code'), null);
});

test('resolveYouTubeMusicTabAction focuses existing active tab if one exists', () => {
    const tabs = [
        { id: 101, windowId: 1, url: 'https://google.com', active: false },
        { id: 102, windowId: 1, url: 'https://music.youtube.com/watch?v=abc', active: true }
    ];
    const decision = resolveYouTubeMusicTabAction(tabs, 999);
    assert.strictEqual(decision.action, 'FOCUS_EXISTING');
    assert.strictEqual(decision.tabId, 102);
});

test('resolveYouTubeMusicTabAction ignores current tab id to prevent self-focus loop', () => {
    const tabs = [
        { id: 102, windowId: 1, url: 'https://music.youtube.com/#ytm-session=YTM-123', active: true }
    ];
    const decision = resolveYouTubeMusicTabAction(tabs, 102);
    assert.strictEqual(decision.action, 'CREATE_NEW');
});

test('resolveYouTubeMusicTabAction requests CREATE_NEW when no YouTube Music tab is open', () => {
    const tabs = [
        { id: 101, windowId: 1, url: 'https://discord.com', active: true },
        { id: 103, windowId: 1, url: 'https://github.com', active: false }
    ];
    const decision = resolveYouTubeMusicTabAction(tabs, null);
    assert.strictEqual(decision.action, 'CREATE_NEW');
});

test('parseSessionFromUrl extracts session when GitHub Pages returns 404 with query parameters', () => {
    const url = 'https://fishyspop.github.io/Youtube-music-rich-presence/?ytm-session=YTM-MCESHE';
    assert.strictEqual(parseSessionFromUrl(url), 'YTM-MCESHE');
});

test('parseSessionFromUrl handles trailing paths and query strings on gateway domain', () => {
    const url = 'https://fishyspop.github.io/some/missing/path?ytm-session=YTM-REC999';
    assert.strictEqual(parseSessionFromUrl(url), 'YTM-REC999');
});

test('resolveGatewaySessionAction prevents host from connecting to self and demoting role', () => {
    const tabs = [
        { id: 201, windowId: 1, url: 'https://music.youtube.com/', active: true }
    ];
    const decision = resolveGatewaySessionAction('HOST', 'YTM-MCESHE', 'YTM-MCESHE', tabs, 999);
    assert.strictEqual(decision.action, 'ALREADY_HOST');
    assert.strictEqual(decision.shouldSendJoin, false);
    assert.strictEqual(decision.toast, 'You are already hosting session YTM-MCESHE');
    assert.strictEqual(decision.tabRouting.action, 'FOCUS_EXISTING');
    assert.strictEqual(decision.tabRouting.tabId, 201);
});

test('resolveGatewaySessionAction prevents listener from re-joining already active room', () => {
    const tabs = [
        { id: 202, windowId: 1, url: 'https://music.youtube.com/', active: true }
    ];
    const decision = resolveGatewaySessionAction('LISTENER', 'YTM-ABC123', 'YTM-ABC123', tabs, 999);
    assert.strictEqual(decision.action, 'ALREADY_LISTENING');
    assert.strictEqual(decision.shouldSendJoin, false);
    assert.strictEqual(decision.toast, 'Already connected to session YTM-ABC123');
    assert.strictEqual(decision.tabRouting.action, 'FOCUS_EXISTING');
});

test('resolveGatewaySessionAction allows join when switching to a different room code', () => {
    const tabs = [
        { id: 201, windowId: 1, url: 'https://music.youtube.com/', active: true }
    ];
    const decision = resolveGatewaySessionAction('HOST', 'YTM-OLD111', 'YTM-NEW222', tabs, 999);
    assert.strictEqual(decision.action, 'JOIN');
    assert.strictEqual(decision.shouldSendJoin, true);
    assert.strictEqual(decision.roomId, 'YTM-NEW222');
});

test('parseSessionInput extracts session from full GitHub Pages gateway URL', () => {
    const input = 'https://fishyspop.github.io/Youtube-music-rich-presence/?ytm-session=YTM-MCESHE';
    assert.strictEqual(parseSessionInput(input), 'YTM-MCESHE');
});

test('parseSessionInput extracts session from GitHub Pages hash URL', () => {
    const input = 'https://fishyspop.github.io/Youtube-music-rich-presence/#ytm-session=YTM-ABC123';
    assert.strictEqual(parseSessionInput(input), 'YTM-ABC123');
});

test('parseSessionInput extracts session from YouTube Music hash URL', () => {
    const input = 'https://music.youtube.com/#ytm-session=YTM-MCESHE';
    assert.strictEqual(parseSessionInput(input), 'YTM-MCESHE');
});

test('parseSessionInput extracts session from YouTube Music query URL with watch parameters', () => {
    const input = 'https://music.youtube.com/watch?v=5NV6Rdv1a3I&ytm-session=YTM-MCESHE';
    assert.strictEqual(parseSessionInput(input), 'YTM-MCESHE');
});

test('parseSessionInput handles direct room codes with or without YTM- prefix', () => {
    assert.strictEqual(parseSessionInput('YTM-MCESHE'), 'YTM-MCESHE');
    assert.strictEqual(parseSessionInput('ytm-mceshe'), 'YTM-MCESHE');
    assert.strictEqual(parseSessionInput('MCESHE'), 'YTM-MCESHE');
    assert.strictEqual(parseSessionInput('mceshe'), 'YTM-MCESHE');
});

test('parseSessionInput handles query fragments and whitespace', () => {
    assert.strictEqual(parseSessionInput('  ?ytm-session=YTM-MCESHE  '), 'YTM-MCESHE');
    assert.strictEqual(parseSessionInput('#ytm-session=YTM-MCESHE'), 'YTM-MCESHE');
    assert.strictEqual(parseSessionInput('ytm-session=YTM-MCESHE'), 'YTM-MCESHE');
});

test('parseSessionInput safely rejects empty and invalid inputs', () => {
    assert.strictEqual(parseSessionInput(''), null);
    assert.strictEqual(parseSessionInput(null), null);
    assert.strictEqual(parseSessionInput('   '), null);
    assert.strictEqual(parseSessionInput('invalid!!'), null);
});

function isGatewayUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return false;
    try {
        const u = new URL(urlStr);
        return u.protocol === 'https:' &&
               u.hostname === 'fishyspop.github.io' &&
               (u.pathname === '/Youtube-music-rich-presence' || u.pathname.startsWith('/Youtube-music-rich-presence/'));
    } catch (e) {
        return false;
    }
}

function isYouTubeMusicUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return false;
    try {
        const u = new URL(urlStr);
        return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname === 'music.youtube.com';
    } catch (e) {
        return false;
    }
}

test('isGatewayUrl strictly validates authentic GitHub Pages gateway URLs', () => {
    assert.strictEqual(isGatewayUrl('https://fishyspop.github.io/Youtube-music-rich-presence/?ytm-session=YTM-ABC123'), true);
    assert.strictEqual(isGatewayUrl('https://fishyspop.github.io/Youtube-music-rich-presence/#session=YTM-ABC123'), true);
    assert.strictEqual(isGatewayUrl('https://fishyspop.github.io/Youtube-music-rich-presence'), true);
    assert.strictEqual(isGatewayUrl('https://fishyspop.github.io/Youtube-music-rich-presence/'), true);
});

test('isGatewayUrl rejects rogue, spoofed, or non-HTTPS domains', () => {
    assert.strictEqual(isGatewayUrl('https://evil-fishyspop.github.io.attacker.com/?session=YTM-ABC123'), false);
    assert.strictEqual(isGatewayUrl('https://attacker.com/fishyspop.github.io/?session=YTM-ABC123'), false);
    assert.strictEqual(isGatewayUrl('https://attacker.com/Youtube-music-rich-presence/?session=YTM-ABC123'), false);
    assert.strictEqual(isGatewayUrl('http://fishyspop.github.io/Youtube-music-rich-presence/'), false);
    assert.strictEqual(isGatewayUrl('https://fishyspop.github.io/other-project/?session=YTM-ABC123'), false);
    assert.strictEqual(isGatewayUrl('javascript:alert(1)'), false);
    assert.strictEqual(isGatewayUrl(''), false);
    assert.strictEqual(isGatewayUrl(null), false);
});

test('isYouTubeMusicUrl strictly validates music.youtube.com domain', () => {
    assert.strictEqual(isYouTubeMusicUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), true);
    assert.strictEqual(isYouTubeMusicUrl('https://music.youtube.com/'), true);
    assert.strictEqual(isYouTubeMusicUrl('https://evil.music.youtube.com.attacker.com/'), false);
    assert.strictEqual(isYouTubeMusicUrl('https://attacker.com/music.youtube.com'), false);
});

console.log(`\nTests completed: ${passedCount}/${testCount} passed.`);

