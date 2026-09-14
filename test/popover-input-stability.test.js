const assert = require('assert');

console.log('Running Popover Input Stability & Session Transition Tests...\n');

class MockElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.parentNode = null;
    this._innerHTML = '';
    this.value = '';
    this.textContent = '';
    this.onclick = null;
    this.onmouseenter = null;
    this.onmouseleave = null;
    this.onkeydown = null;
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(html) {
    this._innerHTML = html;
    this._parseMockChildren(html);
  }

  _parseMockChildren(html) {
    for (const child of this.children) {
      if (child.id && mockDocument.elementsById[child.id] === child) {
        delete mockDocument.elementsById[child.id];
      }
    }
    this.children = [];
    const elementRegex = /<([a-z0-9]+)[^>]*id=["']([^"']+)["'][^>]*>(?:([\s\S]*?)<\/\1>)?/gi;
    let match;
    while ((match = elementRegex.exec(html)) !== null) {
      const tag = match[1].toLowerCase();
      const id = match[2];
      const fullTag = match[0];
      const inner = match[3] || '';

      const child = new MockElement(tag, id);
      child.parentNode = this;
      child.textContent = inner.replace(/<[^>]+>/g, '').trim();

      const valMatch = fullTag.match(/value=["']([^"']*)["']/i);
      if (valMatch) {
        child.value = valMatch[1];
      }

      this.children.push(child);
      mockDocument.elementsById[id] = child;
    }
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    if (child.id) mockDocument.elementsById[child.id] = child;
  }
}

const mockDocument = {
  elementsById: {},
  activeElement: null,
  getElementById(id) {
    return this.elementsById[id] || null;
  }
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function createPopoverController() {
  const popover = new MockElement('div', 'ytm-listen-together-popover');
  mockDocument.elementsById['ytm-listen-together-popover'] = popover;

  let syncEngine = null;
  let lastAppliedDriftMs = 0;
  let toastMessages = [];

  function showSyncToast(msg) {
    toastMessages.push(msg);
  }

  function renderPopoverContent() {
    const el = mockDocument.getElementById('ytm-listen-together-popover');
    if (!el) return;

    const isSessionActive = Boolean(syncEngine && syncEngine.role !== 'NONE');
    const targetView = isSessionActive ? (syncEngine.isHost ? 'host' : 'listener') : 'idle';

    if (targetView === 'idle') {
      const existingJoinInput = mockDocument.getElementById('ytm-popover-join-input');
      if (el.dataset.view === 'idle' && existingJoinInput) {
        return;
      }

      const preservedValue = existingJoinInput ? existingJoinInput.value : '';
      const wasFocused = (mockDocument.activeElement === existingJoinInput);

      el.dataset.view = 'idle';
      el.dataset.peerKey = '';
      el.dataset.renderedRoomId = '';

      el.innerHTML = `
        <div style="padding:12px 16px 8px 16px; border-bottom:1px solid rgba(255, 255, 255, 0.08); display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:10px;">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d=""/></svg>
            <span style="font-weight:500; color:#ffffff; font-size:14px;">Listen Together</span>
          </div>
          <span style="background:rgba(255, 255, 255, 0.08); color:rgba(255, 255, 255, 0.5); font-size:11px; font-weight:500; padding:2px 6px; border-radius:2px; text-transform:uppercase; letter-spacing:0.5px;">
            Idle
          </span>
        </div>
        <div id="ytm-popover-start-row" style="height:44px; padding:0 16px; display:flex; align-items:center; gap:16px; cursor:pointer;">
          <span>Start hosting session</span>
        </div>
        <div style="padding:10px 16px 12px 16px; border-top:1px solid rgba(255, 255, 255, 0.08);">
          <div style="font-size:12px; color:rgba(255, 255, 255, 0.6); margin-bottom:8px;">Join with room code</div>
          <div style="display:flex; gap:8px; align-items:center;">
            <input type="text" id="ytm-popover-join-input" placeholder="Room code or link">
            <button id="ytm-popover-join-btn">Join</button>
          </div>
        </div>
      `;

      const newJoinInput = mockDocument.getElementById('ytm-popover-join-input');
      if (newJoinInput) {
        if (preservedValue) newJoinInput.value = preservedValue;
        if (wasFocused) mockDocument.activeElement = newJoinInput;
      }
      return;
    }

    const isHost = syncEngine.isHost;
    const roomId = syncEngine.roomId || '';
    const count = syncEngine.getConnectedPeerCount ? syncEngine.getConnectedPeerCount() : 0;
    const peerList = syncEngine.getConnectedPeerList ? syncEngine.getConnectedPeerList() : [];
    const roleText = isHost ? (count > 0 ? 'Hosting' : 'Waiting') : 'Synced';
    const peerKey = peerList.map(p => `${p.id || ''}:${p.name || ''}`).join(',');

    let membersHtml = '';
    if (isHost) {
      if (peerList.length > 0) {
        const names = peerList.map(p => escapeHtml(p.name)).join(', ');
        membersHtml = `<div style="padding:4px 16px 8px 16px; font-size:13px; line-height:1.4;"><strong style="color:#ffffff;">Listening:</strong> ${names}</div>`;
      } else {
        membersHtml = `<div style="padding:4px 16px 8px 16px; font-size:13px; color:rgba(255, 255, 255, 0.5);">Waiting for friends to join...</div>`;
      }
    } else {
      const hostName = syncEngine.hostName || 'Host';
      membersHtml = `<div style="padding:4px 16px 4px 16px; font-size:13px; line-height:1.4;"><strong style="color:#ffffff;">Host:</strong> ${escapeHtml(hostName)}</div>`;
      if (peerList.length > 1) {
        const otherNames = peerList.filter(p => p.id !== syncEngine.peerId).map(p => escapeHtml(p.name)).join(', ');
        if (otherNames) {
          membersHtml += `<div style="padding:0 16px 6px 16px; font-size:12px; color:rgba(255, 255, 255, 0.5);">Also listening: ${otherNames}</div>`;
        }
      }
    }

    const driftText = !isHost ? `Synced (${Math.abs(lastAppliedDriftMs)}ms drift)` : '';

    if (el.dataset.view !== targetView) {
      el.dataset.view = targetView;
      el.dataset.peerKey = peerKey;
      el.dataset.renderedRoomId = roomId;

      el.innerHTML = `
        <div style="padding:12px 16px 8px 16px; border-bottom:1px solid rgba(255, 255, 255, 0.08); display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:10px;">
            <span>Listen Together</span>
          </div>
          <span id="ytm-popover-role-badge">
            ${roleText}
          </span>
        </div>
        <div style="padding:10px 16px 8px 16px; display:flex; gap:8px; align-items:center;">
          <input type="text" readonly value="${roomId}" id="ytm-popover-room-input" title="Room Code">
          <button id="ytm-popover-copy-btn">Copy Link</button>
        </div>
        <div id="ytm-popover-members">${membersHtml}</div>
        <div id="ytm-popover-drift" style="padding:0 16px 8px 16px; font-size:12px; color:rgba(255, 255, 255, 0.5); display:${driftText ? 'block' : 'none'};">${driftText}</div>
        <div id="ytm-popover-leave-row">
          <span>Leave session</span>
        </div>
      `;
      return;
    }

    const roleBadge = mockDocument.getElementById('ytm-popover-role-badge');
    if (roleBadge && roleBadge.textContent !== roleText) {
      roleBadge.textContent = roleText;
    }

    const roomInput = mockDocument.getElementById('ytm-popover-room-input');
    if (roomInput && roomInput.value !== roomId) {
      roomInput.value = roomId;
    }

    if (el.dataset.peerKey !== peerKey) {
      el.dataset.peerKey = peerKey;
      const membersContainer = mockDocument.getElementById('ytm-popover-members');
      if (membersContainer) {
        membersContainer.innerHTML = membersHtml;
      }
    }

    const driftContainer = mockDocument.getElementById('ytm-popover-drift');
    if (driftContainer && driftContainer.textContent !== driftText) {
      driftContainer.textContent = driftText;
      driftContainer.style.display = driftText ? 'block' : 'none';
    }
  }

  return {
    popover,
    renderPopoverContent,
    setSyncEngine(engine) { syncEngine = engine; },
    setDrift(ms) { lastAppliedDriftMs = ms; }
  };
}

const allTests = [];
function test(name, fn) {
  allTests.push({ name, fn });
}

test('Idle view: repeated calls do NOT recreate the join input element', () => {
  const controller = createPopoverController();
  controller.renderPopoverContent();

  const input1 = mockDocument.getElementById('ytm-popover-join-input');
  assert(input1 !== null);

  input1.value = 'YTM-MYCODE';
  mockDocument.activeElement = input1;

  for (let i = 0; i < 10; i++) {
    controller.renderPopoverContent();
  }

  const inputAfterTicks = mockDocument.getElementById('ytm-popover-join-input');
  assert.strictEqual(inputAfterTicks, input1);
  assert.strictEqual(inputAfterTicks.value, 'YTM-MYCODE');
  assert.strictEqual(mockDocument.activeElement, input1);
});

test('Session lifecycle: transitions correctly between idle, host, and listener views', () => {
  const controller = createPopoverController();
  controller.renderPopoverContent();

  assert.strictEqual(controller.popover.dataset.view, 'idle');
  assert(mockDocument.getElementById('ytm-popover-join-input') !== null);

  const mockHostEngine = {
    role: 'HOST',
    isHost: true,
    roomId: 'YTM-ROOM1',
    getConnectedPeerCount: () => 0,
    getConnectedPeerList: () => []
  };
  controller.setSyncEngine(mockHostEngine);
  controller.renderPopoverContent();

  assert.strictEqual(controller.popover.dataset.view, 'host');
  assert(mockDocument.getElementById('ytm-popover-room-input') !== null);
  assert.strictEqual(mockDocument.getElementById('ytm-popover-room-input').value, 'YTM-ROOM1');

  const hostRoomInput = mockDocument.getElementById('ytm-popover-room-input');
  for (let i = 0; i < 5; i++) {
    controller.renderPopoverContent();
  }
  assert.strictEqual(mockDocument.getElementById('ytm-popover-room-input'), hostRoomInput);

  controller.setSyncEngine(null);
  controller.renderPopoverContent();

  assert.strictEqual(controller.popover.dataset.view, 'idle');
  assert(mockDocument.getElementById('ytm-popover-join-input') !== null);
  assert(mockDocument.getElementById('ytm-popover-room-input') === null);
});

test('Peer updates: updates members list without destroying room code input', () => {
  const controller = createPopoverController();

  let peers = [];
  const mockHostEngine = {
    role: 'HOST',
    isHost: true,
    roomId: 'YTM-ROOM2',
    getConnectedPeerCount: () => peers.length,
    getConnectedPeerList: () => peers
  };
  controller.setSyncEngine(mockHostEngine);
  controller.renderPopoverContent();

  const roomInputBefore = mockDocument.getElementById('ytm-popover-room-input');
  assert(roomInputBefore !== null);

  peers = [{ id: 'peer1', name: 'Alex' }];
  controller.renderPopoverContent();

  const roomInputAfter = mockDocument.getElementById('ytm-popover-room-input');
  assert.strictEqual(roomInputAfter, roomInputBefore);
  assert.strictEqual(controller.popover.dataset.peerKey, 'peer1:Alex');

  const membersContainer = mockDocument.getElementById('ytm-popover-members');
  assert(membersContainer.innerHTML.includes('Alex'));
});

test('Listener view: surgical drift update preserves popover DOM', () => {
  const controller = createPopoverController();

  const mockListenerEngine = {
    role: 'LISTENER',
    isHost: false,
    roomId: 'YTM-ROOM3',
    hostName: 'HostDJ',
    getConnectedPeerCount: () => 1,
    getConnectedPeerList: () => [{ id: 'self', name: 'Me' }]
  };
  controller.setSyncEngine(mockListenerEngine);
  controller.setDrift(42);
  controller.renderPopoverContent();

  assert.strictEqual(controller.popover.dataset.view, 'listener');
  const driftContainer = mockDocument.getElementById('ytm-popover-drift');
  assert(driftContainer.textContent.includes('42ms drift'));

  const roomInput = mockDocument.getElementById('ytm-popover-room-input');
  controller.setDrift(120);
  controller.renderPopoverContent();

  assert.strictEqual(mockDocument.getElementById('ytm-popover-room-input'), roomInput);
  assert(mockDocument.getElementById('ytm-popover-drift').textContent.includes('120ms drift'));
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
    console.log('ALL POPOVER INPUT STABILITY TESTS PASSED!\n');
  }
}

runAllTests();
