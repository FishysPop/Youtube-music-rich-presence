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

