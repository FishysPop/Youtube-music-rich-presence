(() => {
function safeSerializeArg(arg, depth = 0, seen = new WeakSet()) {
  if (arg === null || arg === undefined) {
    return arg;
  }
  const type = typeof arg;
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return arg;
  }
  if (type === 'bigint') {
    return `${arg.toString()}n`;
  }
  if (type === 'symbol') {
    return arg.toString();
  }
  if (type === 'function') {
    return `[Function: ${arg.name || 'anonymous'}]`;
  }
  if (arg instanceof Error) {
    return arg.stack || `${arg.name}: ${arg.message}`;
  }
  if (typeof Node !== 'undefined' && arg instanceof Node) {
    const tag = (arg.nodeName || 'NODE').toLowerCase();
    const id = arg.id ? `#${arg.id}` : '';
    const className = arg.className && typeof arg.className === 'string'
      ? `.${arg.className.trim().replace(/\s+/g, '.')}`
      : '';
    return `<${tag}${id}${className}>`;
  }
  if (depth > 4) {
    return '[Object]';
  }
  if (type === 'object') {
    if (seen.has(arg)) {
      return '[Circular]';
    }
    seen.add(arg);
    if (Array.isArray(arg)) {
      return arg.map(item => safeSerializeArg(item, depth + 1, seen));
    }
    const res = {};
    for (const key of Object.keys(arg)) {
      try {
        res[key] = safeSerializeArg(arg[key], depth + 1, seen);
      } catch {
        res[key] = '[Unserializable]';
      }
    }
    return res;
  }
  return String(arg);
}

function createLogForwarder(options = {}) {
  const targetConsole = options.targetConsole || (typeof console !== 'undefined' ? console : null);
  const getRuntime = () => options.chromeRuntime || (typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime : null);
  const batchIntervalMs = typeof options.batchIntervalMs === 'number' ? options.batchIntervalMs : 40;

  let logQueue = [];
  let flushTimer = null;
  let isForwarding = false;
  let installed = false;

  const originalConsole = targetConsole ? {
    log: targetConsole.log ? targetConsole.log.bind(targetConsole) : () => {},
    warn: targetConsole.warn ? targetConsole.warn.bind(targetConsole) : () => {},
    error: targetConsole.error ? targetConsole.error.bind(targetConsole) : () => {},
    info: targetConsole.info ? targetConsole.info.bind(targetConsole) : () => {},
    debug: targetConsole.debug ? targetConsole.debug.bind(targetConsole) : () => {}
  } : null;

  function flush() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (logQueue.length === 0) return;
    const batch = logQueue;
    logQueue = [];

    const runtime = getRuntime();
    if (!runtime || typeof runtime.sendMessage !== 'function') return;

    try {
      if (runtime.id === undefined) return;
      const response = runtime.sendMessage({
        type: 'FORWARD_LOG_BATCH',
        logs: batch
      });
      if (response && typeof response.catch === 'function') {
        response.catch(() => {});
      }
    } catch {
      // Ignore extension context invalidation
    }
  }

  function enqueue(level, rawArgs) {
    if (isForwarding) return;
    isForwarding = true;
    try {
      const serialized = rawArgs.map(a => safeSerializeArg(a));
      logQueue.push({
        level,
        args: serialized,
        timestamp: Date.now()
      });

      if (level === 'error' || logQueue.length >= 25) {
        flush();
      } else if (!flushTimer) {
        flushTimer = setTimeout(flush, batchIntervalMs);
      }
    } catch {
      // Suppress internal enqueue errors
    } finally {
      isForwarding = false;
    }
  }

  function install() {
    if (!targetConsole || installed) return;
    installed = true;

    const methods = ['log', 'warn', 'error', 'info', 'debug'];
    for (const method of methods) {
      const orig = originalConsole[method];
      targetConsole[method] = function(...args) {
        orig(...args);
        enqueue(method, args);
      };
    }
  }

  function uninstall() {
    if (!targetConsole || !installed) return;
    installed = false;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const methods = ['log', 'warn', 'error', 'info', 'debug'];
    for (const method of methods) {
      if (originalConsole[method]) {
        targetConsole[method] = originalConsole[method];
      }
    }
  }

  return {
    install,
    uninstall,
    flush,
    enqueue,
    getQueue: () => logQueue
  };
}

function handleForwardedLogMessage(message, sender, targetConsole = console) {
  if (!message || typeof message !== 'object') return false;

  const tabLabel = sender && sender.tab && sender.tab.id ? `[Tab ${sender.tab.id}]` : '[Content]';

  if (message.type === 'FORWARD_LOG_BATCH' && Array.isArray(message.logs)) {
    for (const item of message.logs) {
      const level = item.level && typeof targetConsole[item.level] === 'function' ? item.level : 'log';
      const args = Array.isArray(item.args) ? item.args : [item.args];
      targetConsole[level](tabLabel, ...args);
    }
    return true;
  }

  if (message.type === 'FORWARD_LOG') {
    const level = message.level && typeof targetConsole[message.level] === 'function' ? message.level : 'log';
    const args = Array.isArray(message.args) ? message.args : [message.args];
    targetConsole[level](tabLabel, ...args);
    return true;
  }

  return false;
}

function initLogForwarder() {
  if (typeof window === 'undefined') return null;
  if (window.__ytmLogForwarderInstalled && window.__ytmLogForwarder) {
    return window.__ytmLogForwarder;
  }

  const forwarder = createLogForwarder();
  forwarder.install();
  window.__ytmLogForwarder = forwarder;
  window.__ytmLogForwarderInstalled = true;

  window.addEventListener('beforeunload', () => {
    forwarder.flush();
  });

  return forwarder;
}

if (typeof window !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime) {
  initLogForwarder();
}

if (typeof window !== 'undefined') {
  window.__ytmInitLogForwarder = initLogForwarder;
  window.__ytmSafeSerializeArg = safeSerializeArg;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    safeSerializeArg,
    createLogForwarder,
    initLogForwarder,
    handleForwardedLogMessage
  };
}
})();
