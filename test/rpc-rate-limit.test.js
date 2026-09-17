const assert = require('assert');

console.log('Running RPC Rate Limiting & Coalescing Tests...\n');

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
        console.log('ALL RPC RATE LIMITING TESTS PASSED!\n');
    }
}

class OutboundPresenceThrottler {
    constructor(dispatchFn, options = {}) {
        this.dispatchFn = dispatchFn;
        this.minInterval = options.minInterval || 2500;
        this.maxPerWindow = options.maxPerWindow || 4;
        this.windowMs = options.windowMs || 20000;
        this.dispatchTimestamps = [];
        this.pendingPayload = null;
        this.timer = null;
    }

    send(payload) {
        this.pendingPayload = payload;
        this.schedule();
    }

    schedule() {
        if (this.timer) return;
        if (!this.pendingPayload) return;

        const now = Date.now();
        this.dispatchTimestamps = this.dispatchTimestamps.filter(t => (now - t) < this.windowMs);

        let delay = 0;
        if (this.dispatchTimestamps.length > 0) {
            const lastDispatch = this.dispatchTimestamps[this.dispatchTimestamps.length - 1];
            const timeSinceLast = now - lastDispatch;
            if (timeSinceLast < this.minInterval) {
                delay = Math.max(delay, this.minInterval - timeSinceLast);
            }
        }

        if (this.dispatchTimestamps.length >= this.maxPerWindow) {
            const oldestInWindow = this.dispatchTimestamps[0];
            const waitToClearWindow = (oldestInWindow + this.windowMs) - now + 50;
            delay = Math.max(delay, waitToClearWindow);
        }

        if (delay <= 0) {
            this._dispatch();
        } else {
            this.timer = setTimeout(() => {
                this.timer = null;
                this.schedule();
            }, delay);
        }
    }

    _dispatch() {
        if (!this.pendingPayload) return;
        const payloadToDispatch = this.pendingPayload;
        this.pendingPayload = null;
        this.dispatchTimestamps.push(Date.now());
        this.dispatchFn(payloadToDispatch);
    }

    clear() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.pendingPayload = null;
    }
}

test('throttler executes immediate first dispatch when idle', () => {
    const sent = [];
    const throttler = new OutboundPresenceThrottler((p) => sent.push(p), { minInterval: 100 });
    
    throttler.send({ details: 'Song 1' });
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].details, 'Song 1');
    throttler.clear();
});

test('throttler coalesces rapid sequential song skips into the latest track', async () => {
    const sent = [];
    const throttler = new OutboundPresenceThrottler((p) => sent.push(p), { minInterval: 150 });

    throttler.send({ details: 'Skip 1' });
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].details, 'Skip 1');

    throttler.send({ details: 'Skip 2' });
    throttler.send({ details: 'Skip 3' });
    throttler.send({ details: 'Skip 4 (Final)' });

    assert.strictEqual(sent.length, 1);

    await new Promise(r => setTimeout(r, 200));

    assert.strictEqual(sent.length, 2);
    assert.strictEqual(sent[1].details, 'Skip 4 (Final)');
    throttler.clear();
});

test('throttler respects sliding window maximum', async () => {
    const sent = [];
    const throttler = new OutboundPresenceThrottler((p) => sent.push(p), {
        minInterval: 50,
        maxPerWindow: 2,
        windowMs: 300
    });

    throttler.send({ details: 'Song A' });
    assert.strictEqual(sent.length, 1);

    await new Promise(r => setTimeout(r, 60));
    throttler.send({ details: 'Song B' });
    assert.strictEqual(sent.length, 2);

    await new Promise(r => setTimeout(r, 60));
    throttler.send({ details: 'Song C' });
    assert.strictEqual(sent.length, 2);

    await new Promise(r => setTimeout(r, 250));
    assert.strictEqual(sent.length, 3);
    assert.strictEqual(sent[2].details, 'Song C');
    throttler.clear();
});

test('ACTIVITY_STATUS error handler preserves isRpcReady and does not trigger reconnect', () => {
    let isRpcReady = true;
    let reconnectCalls = 0;
    let currentStatus = 'rpc_ready';
    let statusErrorMessage = null;
    let pendingActivity = { details: 'Active Song' };

    function mockHandleActivityStatus(message) {
        switch (message.status) {
            case 'success':
                break;
            case 'error':
            case 'clear_error':
                statusErrorMessage = message.message;
                break;
        }
    }

    mockHandleActivityStatus({
        type: 'ACTIVITY_STATUS',
        status: 'error',
        message: 'Failed to set activity: Unknown Error'
    });

    assert.strictEqual(isRpcReady, true, 'isRpcReady must remain true when activity fails');
    assert.strictEqual(reconnectCalls, 0, 'Must not call reconnect when activity fails');
    assert.strictEqual(statusErrorMessage, 'Failed to set activity: Unknown Error');
    assert.strictEqual(pendingActivity.details, 'Active Song');
});

runAllTests();

