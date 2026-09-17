const assert = require('assert');

console.log('Running Popover Persistence & Guide Notification Tests...\n');

function shouldDisplayGuidePopup(hasSeenGuide, isSessionActive, isButtonMounted) {
  if (hasSeenGuide) return false;
  if (isSessionActive) return false;
  return Boolean(isButtonMounted);
}

function resolveOutsideClickAction({
  isPopoverOpen,
  target,
  popover,
  button,
  composedPath = []
}) {
  if (!isPopoverOpen || !popover) return { shouldClose: false };
  if (!target) return { shouldClose: false };

  if (target === popover || popover.contains(target) || composedPath.includes(popover)) {
    return { shouldClose: false };
  }

  if (button && (target === button || button.contains(target) || composedPath.includes(button))) {
    return { shouldClose: false };
  }

  if (target.ownerDocument && !target.ownerDocument.contains(target)) {
    return { shouldClose: false };
  }

  return { shouldClose: true };
}

class MockNode {
  constructor(id = '') {
    this.id = id;
    this.parentNode = null;
    this.ownerDocument = null;
  }

  contains(child) {
    if (!child) return false;
    let curr = child;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentNode;
    }
    return false;
  }
}

class MockDoc extends MockNode {
  constructor() {
    super('document');
    this.ownerDocument = this;
  }
}

const allTests = [];
function test(name, fn) {
  allTests.push({ name, fn });
}

test('shouldDisplayGuidePopup: only displays when unseen, inactive session, and button mounted', () => {
  assert.strictEqual(shouldDisplayGuidePopup(false, false, true), true);
  assert.strictEqual(shouldDisplayGuidePopup(true, false, true), false);
  assert.strictEqual(shouldDisplayGuidePopup(false, true, true), false);
  assert.strictEqual(shouldDisplayGuidePopup(false, false, false), false);
});

test('resolveOutsideClickAction: keeps popover open when clicking inside popover', () => {
  const doc = new MockDoc();
  const popover = new MockNode('popover');
  popover.ownerDocument = doc;
  popover.parentNode = doc;

  const btn = new MockNode('btn');
  btn.ownerDocument = doc;
  btn.parentNode = doc;

  const innerItem = new MockNode('innerItem');
  innerItem.ownerDocument = doc;
  innerItem.parentNode = popover;

  const res = resolveOutsideClickAction({
    isPopoverOpen: true,
    target: innerItem,
    popover,
    button: btn,
    composedPath: [innerItem, popover, doc]
  });
  assert.strictEqual(res.shouldClose, false);
});

test('resolveOutsideClickAction: protects detached element clicks when innerHTML swap happens', () => {
  const doc = new MockDoc();
  const popover = new MockNode('popover');
  popover.ownerDocument = doc;
  popover.parentNode = doc;

  const btn = new MockNode('btn');
  btn.ownerDocument = doc;
  btn.parentNode = doc;

  const detachedStartRow = new MockNode('startRow');
  detachedStartRow.ownerDocument = doc;
  detachedStartRow.parentNode = null;

  const res = resolveOutsideClickAction({
    isPopoverOpen: true,
    target: detachedStartRow,
    popover,
    button: btn,
    composedPath: [detachedStartRow]
  });
  assert.strictEqual(res.shouldClose, false);
});

test('resolveOutsideClickAction: closes popover when clicking genuinely outside', () => {
  const doc = new MockDoc();
  const popover = new MockNode('popover');
  popover.ownerDocument = doc;
  popover.parentNode = doc;

  const btn = new MockNode('btn');
  btn.ownerDocument = doc;
  btn.parentNode = doc;

  const outsideDiv = new MockNode('outside');
  outsideDiv.ownerDocument = doc;
  outsideDiv.parentNode = doc;

  const res = resolveOutsideClickAction({
    isPopoverOpen: true,
    target: outsideDiv,
    popover,
    button: btn,
    composedPath: [outsideDiv, doc]
  });
  assert.strictEqual(res.shouldClose, true);
});

test('resolveOutsideClickAction: keeps popover open when clicking the toggle button', () => {
  const doc = new MockDoc();
  const popover = new MockNode('popover');
  popover.ownerDocument = doc;
  popover.parentNode = doc;

  const btn = new MockNode('btn');
  btn.ownerDocument = doc;
  btn.parentNode = doc;

  const res = resolveOutsideClickAction({
    isPopoverOpen: true,
    target: btn,
    popover,
    button: btn,
    composedPath: [btn, doc]
  });
  assert.strictEqual(res.shouldClose, false);
});
function resolveGuidePageState(currentPage, action, totalPages = 2) {
  if (action === 'next') {
    return Math.min(totalPages, currentPage + 1);
  }
  if (action === 'back') {
    return Math.max(1, currentPage - 1);
  }
  return currentPage;
}

test('resolveGuidePageState: correctly navigates between page 1 and page 2', () => {
  let page = 1;
  page = resolveGuidePageState(page, 'next', 2);
  assert.strictEqual(page, 2);

  page = resolveGuidePageState(page, 'next', 2);
  assert.strictEqual(page, 2);

  page = resolveGuidePageState(page, 'back', 2);
  assert.strictEqual(page, 1);

  page = resolveGuidePageState(page, 'back', 2);
  assert.strictEqual(page, 1);
});

function formatHeaderMetaHtml({ showBadge = true, issuesUrl = 'https://github.com/FishysPop/Youtube-music-rich-presence/issues' } = {}) {
  const badgeHtml = showBadge ? '<span class="beta-badge">BETA</span>' : '';
  const issuesHtml = `<a href="${issuesUrl}" target="_blank" rel="noopener noreferrer">Issues?</a>`;
  return { badgeHtml, issuesHtml };
}

test('formatHeaderMetaHtml: formats beta badge and valid issues hyperlink', () => {
  const meta = formatHeaderMetaHtml();
  assert(meta.badgeHtml.includes('BETA'));
  assert(meta.issuesHtml.includes('Issues?'));
  assert(meta.issuesHtml.includes('https://github.com/FishysPop/Youtube-music-rich-presence/issues'));
  assert(meta.issuesHtml.includes('target="_blank"'));
  assert(meta.issuesHtml.includes('rel="noopener noreferrer"'));
});

function resolveEmbeddedRightBadge({ isSessionActive, isHost, isConnected, hostConnectedCount, roleText }) {
  if (!isSessionActive) {
    return 'BETA';
  }
  if (roleText) return roleText;
  if (isHost) {
    return hostConnectedCount > 0 ? 'HOSTING' : 'WAITING';
  }
  return isConnected ? 'SYNCED' : 'CONNECTING';
}

test('resolveEmbeddedRightBadge: displays BETA when idle, CONNECTING when joining, and SYNCED when connected', () => {
  assert.strictEqual(resolveEmbeddedRightBadge({ isSessionActive: false }), 'BETA');
  assert.strictEqual(resolveEmbeddedRightBadge({ isSessionActive: true, isHost: true, hostConnectedCount: 0 }), 'WAITING');
  assert.strictEqual(resolveEmbeddedRightBadge({ isSessionActive: true, isHost: true, hostConnectedCount: 2 }), 'HOSTING');
  assert.strictEqual(resolveEmbeddedRightBadge({ isSessionActive: true, isHost: false, isConnected: false }), 'CONNECTING');
  assert.strictEqual(resolveEmbeddedRightBadge({ isSessionActive: true, isHost: false, isConnected: true }), 'SYNCED');
});

function resolvePopupBadge(state) {
  if (!state || state.role === 'NONE' || !state.roomId) {
    return { text: 'BETA', className: 'status-value beta' };
  }
  if (state.isHost) {
    const count = state.peerCount || 0;
    return {
      text: count > 0 ? 'Hosting' : 'Waiting',
      className: count > 0 ? 'status-value connected' : 'status-value pending'
    };
  }
  const isConnected = state.status === 'connected' || (state.peerCount && state.peerCount > 0);
  return {
    text: isConnected ? 'Synced' : 'Connecting',
    className: isConnected ? 'status-value connected' : 'status-value pending'
  };
}

test('resolvePopupBadge: sets BETA badge when idle and session status when active', () => {
  assert.deepStrictEqual(resolvePopupBadge(null), { text: 'BETA', className: 'status-value beta' });
  assert.deepStrictEqual(resolvePopupBadge({ role: 'NONE' }), { text: 'BETA', className: 'status-value beta' });
  assert.deepStrictEqual(resolvePopupBadge({ role: 'HOST', isHost: true, roomId: 'YTM-TEST1', peerCount: 0 }), { text: 'Waiting', className: 'status-value pending' });
  assert.deepStrictEqual(resolvePopupBadge({ role: 'HOST', isHost: true, roomId: 'YTM-TEST1', peerCount: 2 }), { text: 'Hosting', className: 'status-value connected' });
  assert.deepStrictEqual(resolvePopupBadge({ role: 'LISTENER', isHost: false, roomId: 'YTM-TEST1', status: 'connected' }), { text: 'Synced', className: 'status-value connected' });
});

function renderPopoverViewModel({
  syncEngine,
  currentSessionStatus = 'idle',
  lastConnectionError = null,
  lastAttemptedRoomId = '',
  lastAppliedDriftMs = 0
}) {
  const isSessionActive = Boolean(syncEngine && syncEngine.role !== 'NONE');
  const isHost = Boolean(syncEngine && syncEngine.isHost);
  const roomId = syncEngine ? (syncEngine.roomId || '') : '';
  const count = syncEngine && syncEngine.getConnectedPeerCount ? syncEngine.getConnectedPeerCount() : 0;
  const targetView = isSessionActive ? (isHost ? 'host' : 'listener') : 'idle';

  if (targetView === 'idle') {
    return {
      targetView: 'idle',
      hasErrorBanner: Boolean(lastConnectionError),
      errorMessage: lastConnectionError,
      prefilledRoomId: lastAttemptedRoomId,
      badgeText: 'BETA'
    };
  }

  const isConnected = isHost || Boolean(syncEngine && (syncEngine.connectionStatus === 'connected' || currentSessionStatus === 'connected') && syncEngine.hostPeerId);
  let roleText = 'Connecting';
  let badgeTheme = 'connecting';
  if (isHost) {
    roleText = count > 0 ? 'Hosting' : 'Waiting';
    badgeTheme = count > 0 ? 'synced' : 'waiting';
  } else if (isConnected) {
    roleText = 'Synced';
    badgeTheme = 'synced';
  }

  const leaveButtonText = (!isHost && !isConnected) ? 'Cancel connection' : 'Leave session';
  const isConnectingSpinner = (!isHost && !isConnected);
  const driftText = (!isHost && isConnected) ? `Synced (${Math.abs(lastAppliedDriftMs)}ms drift)` : '';
  const hostDisplayName = (!isHost && isConnected) ? (syncEngine.hostName || 'Host') : null;

  return {
    targetView,
    isConnected,
    roleText,
    badgeTheme,
    leaveButtonText,
    isConnectingSpinner,
    driftText,
    hostDisplayName,
    roomId
  };
}

test('renderPopoverViewModel: correctly renders CONNECTING state with spinner and cancel button for listener', () => {
  const mockEngine = {
    role: 'LISTENER',
    isHost: false,
    roomId: 'YTM-XYZ123',
    connectionStatus: 'connecting',
    hostPeerId: null,
    hostName: null,
    getConnectedPeerCount: () => 0,
    getConnectedPeerList: () => []
  };

  const vm = renderPopoverViewModel({
    syncEngine: mockEngine,
    currentSessionStatus: 'joining',
    lastAppliedDriftMs: 0
  });

  assert.strictEqual(vm.targetView, 'listener');
  assert.strictEqual(vm.isConnected, false);
  assert.strictEqual(vm.roleText, 'Connecting');
  assert.strictEqual(vm.badgeTheme, 'connecting');
  assert.strictEqual(vm.isConnectingSpinner, true);
  assert.strictEqual(vm.leaveButtonText, 'Cancel connection');
  assert.strictEqual(vm.driftText, '');
});

test('renderPopoverViewModel: correctly renders SYNCED state when host responds with SYNC_STATE or ROOM_INFO', () => {
  const mockEngine = {
    role: 'LISTENER',
    isHost: false,
    roomId: 'YTM-XYZ123',
    connectionStatus: 'connected',
    hostPeerId: 'peer-host99',
    hostName: 'AliceHost',
    getConnectedPeerCount: () => 1,
    getConnectedPeerList: () => [{ id: 'peer-host99', name: 'AliceHost' }]
  };

  const vm = renderPopoverViewModel({
    syncEngine: mockEngine,
    currentSessionStatus: 'connected',
    lastAppliedDriftMs: 45
  });

  assert.strictEqual(vm.targetView, 'listener');
  assert.strictEqual(vm.isConnected, true);
  assert.strictEqual(vm.roleText, 'Synced');
  assert.strictEqual(vm.badgeTheme, 'synced');
  assert.strictEqual(vm.isConnectingSpinner, false);
  assert.strictEqual(vm.leaveButtonText, 'Leave session');
  assert.strictEqual(vm.driftText, 'Synced (45ms drift)');
  assert.strictEqual(vm.hostDisplayName, 'AliceHost');
});

test('renderPopoverViewModel: renders error banner and prefilled code on timeout transition to idle', () => {
  const vm = renderPopoverViewModel({
    syncEngine: { role: 'NONE' },
    currentSessionStatus: 'idle',
    lastConnectionError: 'Could not connect to room "YTM-GHOST". Host is offline or room does not exist.',
    lastAttemptedRoomId: 'YTM-GHOST'
  });

  assert.strictEqual(vm.targetView, 'idle');
  assert.strictEqual(vm.hasErrorBanner, true);
  assert.strictEqual(vm.errorMessage.includes('Host is offline'), true);
  assert.strictEqual(vm.prefilledRoomId, 'YTM-GHOST');
  assert.strictEqual(vm.badgeText, 'BETA');
});

test('in-place DOM mutation: transitions role badge, members and button text without full DOM destruction', () => {
  const dom = {
    roleBadge: { textContent: 'Connecting', style: '' },
    leaveText: { textContent: 'Cancel connection' },
    drift: { textContent: '', display: 'none' },
    members: { innerHTML: '<spinner/>' }
  };

  const beforeSync = renderPopoverViewModel({
    syncEngine: {
      role: 'LISTENER',
      isHost: false,
      roomId: 'YTM-ABC',
      connectionStatus: 'connecting',
      hostPeerId: null
    },
    currentSessionStatus: 'joining'
  });
  assert.strictEqual(beforeSync.roleText, 'Connecting');
  assert.strictEqual(beforeSync.leaveButtonText, 'Cancel connection');

  const afterSync = renderPopoverViewModel({
    syncEngine: {
      role: 'LISTENER',
      isHost: false,
      roomId: 'YTM-ABC',
      connectionStatus: 'connected',
      hostPeerId: 'host-1',
      hostName: 'Bob'
    },
    currentSessionStatus: 'connected',
    lastAppliedDriftMs: 12
  });

  if (dom.roleBadge.textContent !== afterSync.roleText) {
    dom.roleBadge.textContent = afterSync.roleText;
  }
  if (dom.leaveText.textContent !== afterSync.leaveButtonText) {
    dom.leaveText.textContent = afterSync.leaveButtonText;
  }
  if (dom.drift.textContent !== afterSync.driftText) {
    dom.drift.textContent = afterSync.driftText;
    dom.drift.display = afterSync.driftText ? 'block' : 'none';
  }
  if (!afterSync.isConnectingSpinner) {
    dom.members.innerHTML = `<div>Host: ${afterSync.hostDisplayName}</div>`;
  }

  assert.strictEqual(dom.roleBadge.textContent, 'Synced');
  assert.strictEqual(dom.leaveText.textContent, 'Leave session');
  assert.strictEqual(dom.drift.textContent, 'Synced (12ms drift)');
  assert.strictEqual(dom.drift.display, 'block');
  assert.strictEqual(dom.members.innerHTML.includes('Host: Bob'), true);
});

test('handleConnectionStatusChange: suppresses duplicate connected status toasts', () => {
  let toastCount = 0;
  let currentSessionStatus = 'idle';

  function mockHandleConnectionStatusChange(status, roomId) {
    if (currentSessionStatus === status && status === 'connected') {
      return;
    }
    currentSessionStatus = status;
    if (status === 'connected') {
      toastCount++;
    }
  }

  mockHandleConnectionStatusChange('joining', 'YTM-ROOM1');
  assert.strictEqual(toastCount, 0);

  mockHandleConnectionStatusChange('connected', 'YTM-ROOM1');
  assert.strictEqual(toastCount, 1);

  mockHandleConnectionStatusChange('connected', 'YTM-ROOM1');
  mockHandleConnectionStatusChange('connected', 'YTM-ROOM1');
  assert.strictEqual(toastCount, 1);
});

async function runAllTests() {
  let passed = 0;
  for (const t of allTests) {
    try {
      await t.fn();
      console.log(`  [PASS] ${t.name}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${t.name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }
  console.log(`\nTests completed: ${passed}/${allTests.length} passed.`);
  if (passed === allTests.length) {
    console.log('ALL POPOVER PERSISTENCE & GUIDE TESTS PASSED!\n');
  }
}

runAllTests();


