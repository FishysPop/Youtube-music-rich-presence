const assert = require('assert');

function shouldPersistSession(role) {
    if (!role || role === 'HOST' || role === 'NONE') {
        return false;
    }
    return role === 'LISTENER';
}

function filterRestorableSession(session) {
    if (!session || typeof session !== 'object') return null;
    if (session.role === 'HOST') return null;
    if (session.role === 'LISTENER' && session.roomId) {
        return { role: 'LISTENER', roomId: session.roomId };
    }
    return null;
}

function evaluateAutoStopIdleHosting(isHost, peerCount, emptyStartTime, now, timeoutMinutes) {
    if (!isHost) return { shouldStop: false, newEmptyStartTime: null };
    if (!timeoutMinutes || timeoutMinutes <= 0) return { shouldStop: false, newEmptyStartTime: null };

    if (peerCount > 0) {
        return { shouldStop: false, newEmptyStartTime: null };
    }

    const currentStart = emptyStartTime || now;
    const elapsedMs = Math.max(0, now - currentStart);
    const timeoutMs = timeoutMinutes * 60 * 1000;

    if (elapsedMs >= timeoutMs) {
        return { shouldStop: true, newEmptyStartTime: null };
    }

    return { shouldStop: false, newEmptyStartTime: currentStart };
}

const allTests = [];
function test(name, fn) {
    allTests.push({ name, fn });
}

test('shouldPersistSession: NEVER persists HOST sessions to storage', () => {
    assert.strictEqual(shouldPersistSession('HOST'), false);
    assert.strictEqual(shouldPersistSession('NONE'), false);
    assert.strictEqual(shouldPersistSession(null), false);
    assert.strictEqual(shouldPersistSession(undefined), false);
    assert.strictEqual(shouldPersistSession('LISTENER'), true);
});

test('filterRestorableSession: drops HOST sessions and allows valid LISTENER sessions', () => {
    assert.strictEqual(filterRestorableSession({ role: 'HOST', roomId: 'YTM-ABC123' }), null);
    assert.strictEqual(filterRestorableSession(null), null);
    assert.strictEqual(filterRestorableSession({ role: 'INVALID', roomId: 'YTM-ABC123' }), null);

    const validListener = filterRestorableSession({ role: 'LISTENER', roomId: 'YTM-XYZ789' });
    assert.deepStrictEqual(validListener, { role: 'LISTENER', roomId: 'YTM-XYZ789' });
});

test('evaluateAutoStopIdleHosting: triggers auto-stop when 0 peers remain past timeout', () => {
    const start = 1000000;
    const timeoutMinutes = 30;
    const timeoutMs = 30 * 60 * 1000;

    const beforeTimeout = evaluateAutoStopIdleHosting(true, 0, start, start + timeoutMs - 1000, timeoutMinutes);
    assert.strictEqual(beforeTimeout.shouldStop, false);
    assert.strictEqual(beforeTimeout.newEmptyStartTime, start);

    const atTimeout = evaluateAutoStopIdleHosting(true, 0, start, start + timeoutMs, timeoutMinutes);
    assert.strictEqual(atTimeout.shouldStop, true);

    const pastTimeout = evaluateAutoStopIdleHosting(true, 0, start, start + timeoutMs + 5000, timeoutMinutes);
    assert.strictEqual(pastTimeout.shouldStop, true);
});

test('evaluateAutoStopIdleHosting: does not stop if listeners are connected', () => {
    const start = 1000000;
    const timeoutMinutes = 30;
    const timeoutMs = 30 * 60 * 1000;

    const withPeers = evaluateAutoStopIdleHosting(true, 2, start, start + timeoutMs + 10000, timeoutMinutes);
    assert.strictEqual(withPeers.shouldStop, false);
    assert.strictEqual(withPeers.newEmptyStartTime, null);
});

test('evaluateAutoStopIdleHosting: does not stop when timeout is set to 0 (Never)', () => {
    const start = 1000000;
    const timeoutMs = 60 * 60 * 1000;

    const disabled = evaluateAutoStopIdleHosting(true, 0, start, start + timeoutMs, 0);
    assert.strictEqual(disabled.shouldStop, false);
});

test('evaluateAutoStopIdleHosting: non-host never triggers auto-stop', () => {
    const start = 1000000;
    const timeoutMs = 60 * 60 * 1000;

    const listener = evaluateAutoStopIdleHosting(false, 0, start, start + timeoutMs, 30);
    assert.strictEqual(listener.shouldStop, false);
});

async function runAllTests() {
    let passedTests = 0;
    console.log('Running Auto-Stop & Session Storage Policy Tests...\n');
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
        console.log('ALL AUTO-STOP TESTS PASSED!\n');
    }
    setTimeout(() => {
        process.exit(passedTests === allTests.length ? 0 : 1);
    }, 50);
}

runAllTests();

module.exports = {
    shouldPersistSession,
    filterRestorableSession,
    evaluateAutoStopIdleHosting
};
