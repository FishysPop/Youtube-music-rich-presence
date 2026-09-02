const assert = require('assert');

let logForwarderModule;
try {
  logForwarderModule = require('../extention/log-forwarder.js');
} catch (e) {
  logForwarderModule = null;
}

const allTests = [];
function test(name, fn) {
  allTests.push({ name, fn });
}

async function runAllTests() {
  console.log('Running Log Forwarding Tests...\n');
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
  if (passedTests === allTests.length && allTests.length > 0) {
    console.log('ALL LOG FORWARDING TESTS PASSED!\n');
  }
}

test('Module loads successfully', () => {
  assert.ok(logForwarderModule, 'log-forwarder.js should export expected functions');
  assert.strictEqual(typeof logForwarderModule.safeSerializeArg, 'function');
  assert.strictEqual(typeof logForwarderModule.createLogForwarder, 'function');
  assert.strictEqual(typeof logForwarderModule.handleForwardedLogMessage, 'function');
});

test('safeSerializeArg preserves primitive values', () => {
  const { safeSerializeArg } = logForwarderModule;
  assert.strictEqual(safeSerializeArg('hello world'), 'hello world');
  assert.strictEqual(safeSerializeArg(12345), 12345);
  assert.strictEqual(safeSerializeArg(true), true);
  assert.strictEqual(safeSerializeArg(false), false);
  assert.strictEqual(safeSerializeArg(null), null);
  assert.strictEqual(safeSerializeArg(undefined), undefined);
});

test('safeSerializeArg formats Error objects with stack or message', () => {
  const { safeSerializeArg } = logForwarderModule;
  const err = new Error('Test error message');
  const serialized = safeSerializeArg(err);
  assert.ok(typeof serialized === 'string');
  assert.ok(serialized.includes('Test error message'));
});

test('safeSerializeArg safely serializes mock DOM nodes', () => {
  const { safeSerializeArg } = logForwarderModule;
  class MockNode {}
  global.Node = MockNode;

  const mockElement = Object.create(MockNode.prototype);
  mockElement.nodeName = 'DIV';
  mockElement.id = 'player-bar';
  mockElement.className = 'ytmusic-player-bar active';

  const serialized = safeSerializeArg(mockElement);
  assert.strictEqual(serialized, '<div#player-bar.ytmusic-player-bar.active>');
  delete global.Node;
});

test('safeSerializeArg handles circular references without throwing', () => {
  const { safeSerializeArg } = logForwarderModule;
  const obj = { name: 'test' };
  obj.self = obj;

  const serialized = safeSerializeArg(obj);
  assert.strictEqual(serialized.name, 'test');
  assert.strictEqual(serialized.self, '[Circular]');
});

test('safeSerializeArg converts functions and symbols safely', () => {
  const { safeSerializeArg } = logForwarderModule;
  function sampleFunc() {}
  assert.strictEqual(safeSerializeArg(sampleFunc), '[Function: sampleFunc]');
  assert.strictEqual(safeSerializeArg(Symbol('sym')), 'Symbol(sym)');
  assert.strictEqual(safeSerializeArg(BigInt(9999)), '9999n');
});

test('createLogForwarder intercepts console methods and passes through to original console', () => {
  const { createLogForwarder } = logForwarderModule;
  const originalCalls = [];
  const fakeConsole = {
    log: (...args) => originalCalls.push({ method: 'log', args }),
    warn: (...args) => originalCalls.push({ method: 'warn', args }),
    error: (...args) => originalCalls.push({ method: 'error', args }),
    info: (...args) => originalCalls.push({ method: 'info', args }),
    debug: (...args) => originalCalls.push({ method: 'debug', args })
  };

  const sentMessages = [];
  const fakeChrome = {
    runtime: {
      id: 'test-ext-id',
      sendMessage: (msg) => {
        sentMessages.push(msg);
        return Promise.resolve({ received: true });
      }
    }
  };

  const forwarder = createLogForwarder({
    targetConsole: fakeConsole,
    chromeRuntime: fakeChrome.runtime,
    batchIntervalMs: 20
  });

  forwarder.install();

  fakeConsole.log('[WebRTC Sync] Connecting to broker');
  fakeConsole.warn('[WebRTC Sync] Minor issue');

  assert.strictEqual(originalCalls.length, 2);
  assert.strictEqual(originalCalls[0].args[0], '[WebRTC Sync] Connecting to broker');

  forwarder.flush();

  assert.strictEqual(sentMessages.length, 1);
  assert.strictEqual(sentMessages[0].type, 'FORWARD_LOG_BATCH');
  assert.strictEqual(sentMessages[0].logs.length, 2);
  assert.strictEqual(sentMessages[0].logs[0].level, 'log');
  assert.strictEqual(sentMessages[0].logs[0].args[0], '[WebRTC Sync] Connecting to broker');
  assert.strictEqual(sentMessages[0].logs[1].level, 'warn');

  forwarder.uninstall();
});

test('createLogForwarder immediately flushes on console.error', () => {
  const { createLogForwarder } = logForwarderModule;
  const fakeConsole = {
    error: () => {}
  };

  const sentMessages = [];
  const fakeChrome = {
    runtime: {
      id: 'test-ext-id',
      sendMessage: (msg) => {
        sentMessages.push(msg);
        return Promise.resolve({ received: true });
      }
    }
  };

  const forwarder = createLogForwarder({
    targetConsole: fakeConsole,
    chromeRuntime: fakeChrome.runtime,
    batchIntervalMs: 1000
  });

  forwarder.install();
  fakeConsole.error('[YTM RPC Content] Critical error occurred');

  assert.strictEqual(sentMessages.length, 1);
  assert.strictEqual(sentMessages[0].type, 'FORWARD_LOG_BATCH');
  assert.strictEqual(sentMessages[0].logs[0].level, 'error');

  forwarder.uninstall();
});

test('createLogForwarder handles invalidated extension context gracefully', () => {
  const { createLogForwarder } = logForwarderModule;
  const fakeConsole = {
    log: () => {}
  };

  const fakeChrome = {
    runtime: {
      id: 'test-ext-id',
      sendMessage: () => {
        throw new Error('Extension context invalidated.');
      }
    }
  };

  const forwarder = createLogForwarder({
    targetConsole: fakeConsole,
    chromeRuntime: fakeChrome.runtime,
    batchIntervalMs: 10
  });

  forwarder.install();
  assert.doesNotThrow(() => {
    fakeConsole.log('Message during reload');
    forwarder.flush();
  });
  forwarder.uninstall();
});

test('handleForwardedLogMessage formats and routes logs to background console with tab identifier', () => {
  const { handleForwardedLogMessage } = logForwarderModule;
  const bgCalls = [];
  const mockBgConsole = {
    log: (...args) => bgCalls.push({ level: 'log', args }),
    warn: (...args) => bgCalls.push({ level: 'warn', args }),
    error: (...args) => bgCalls.push({ level: 'error', args })
  };

  const sender = {
    tab: {
      id: 42,
      url: 'https://music.youtube.com/'
    }
  };

  const batchMessage = {
    type: 'FORWARD_LOG_BATCH',
    logs: [
      { level: 'log', args: ['[WebRTC Sync] Room created: YTM-ABC123'] },
      { level: 'warn', args: ['[Listen Together] Drift 200ms'] }
    ]
  };

  const handled = handleForwardedLogMessage(batchMessage, sender, mockBgConsole);
  assert.strictEqual(handled, true);
  assert.strictEqual(bgCalls.length, 2);
  assert.strictEqual(bgCalls[0].level, 'log');
  assert.strictEqual(bgCalls[0].args[0], '[Tab 42]');
  assert.strictEqual(bgCalls[0].args[1], '[WebRTC Sync] Room created: YTM-ABC123');
  assert.strictEqual(bgCalls[1].level, 'warn');
  assert.strictEqual(bgCalls[1].args[0], '[Tab 42]');
});

test('handleForwardedLogMessage handles single FORWARD_LOG message', () => {
  const { handleForwardedLogMessage } = logForwarderModule;
  const bgCalls = [];
  const mockBgConsole = {
    log: (...args) => bgCalls.push({ level: 'log', args })
  };

  const sender = {};
  const singleMessage = {
    type: 'FORWARD_LOG',
    level: 'log',
    args: ['[Listen Together] Single log message']
  };

  const handled = handleForwardedLogMessage(singleMessage, sender, mockBgConsole);
  assert.strictEqual(handled, true);
  assert.strictEqual(bgCalls.length, 1);
  assert.strictEqual(bgCalls[0].args[0], '[Content]');
  assert.strictEqual(bgCalls[0].args[1], '[Listen Together] Single log message');
});

runAllTests();
