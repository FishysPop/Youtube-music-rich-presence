const assert = require('assert');
const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'docs', 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');

function test(title, fn) {
  try {
    fn();
    console.log(`  [PASS] ${title}`);
  } catch (err) {
    console.error(`  [FAIL] ${title}: ${err.message}`);
    throw err;
  }
}

console.log('Running Gateway Page Tests...');

test('index.html contains all expected DOM elements used by client script', () => {
  const expectedIds = [
    'statusDot',
    'statusLabel',
    'roomTag',
    'titleText',
    'descText',
    'manualJoinRow',
    'manualJoinInput',
    'manualJoinBtn',
    'primaryBtn',
    'secondaryBtn'
  ];

  for (const id of expectedIds) {
    assert(html.includes(`id="${id}"`), `Missing element id="${id}" in docs/index.html`);
  }
});

test('manual join row styles prevent button width from collapsing input element', () => {
  assert(
    html.includes('.manual-join-row') || html.includes('#manualJoinRow'),
    'manualJoinRow should have explicit CSS rules'
  );

  const hasJoinBtnAutoWidth =
    /\.manual-join-row\s+\.btn[\s\S]*?width:\s*auto/i.test(html) ||
    /\.manual-join-btn[\s\S]*?width:\s*auto/i.test(html) ||
    /#manualJoinBtn[\s\S]*?width:\s*auto/i.test(html);

  assert(
    hasJoinBtnAutoWidth,
    'Join button inside manualJoinRow must set width: auto to avoid inheriting width: 100% and collapsing input'
  );
});

test('manual join input has focus and placeholder styling', () => {
  assert(
    /manual-join-input:focus|#manualJoinInput:focus/.test(html),
    'manual join input should have focus styling'
  );
  assert(
    /manual-join-input::placeholder|#manualJoinInput::placeholder/.test(html),
    'manual join input should have placeholder styling'
  );
});

test('uninstalled state explains that extension is required to synchronize playback', () => {
  assert(
    html.includes("titleText.textContent = 'Install Extension'") || html.includes('<h1>Install Extension</h1>'),
    'Should present Install Extension heading when extension is not installed'
  );
  assert(
    html.includes('The YouTube Music Rich Presence extension is required to synchronize playback with your friend.'),
    'Should explain that the extension is required'
  );
  assert(
    /markNotInstalled[\s\S]*?titleText\.textContent\s*=\s*['"]Install Extension['"]/.test(html),
    'markNotInstalled must set title to Install Extension'
  );
});

test('btn-disabled CSS styles are defined for unsupported browser states', () => {
  assert(
    /\.btn-disabled/.test(html),
    'docs/index.html must include .btn-disabled styling'
  );
});

test('detectBrowser dynamically detects supported and unsupported browsers', () => {
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  assert(scriptMatch, 'script tag must exist in docs/index.html');

  const scriptContent = scriptMatch[1];
  const startIdx = scriptContent.indexOf('function detectBrowser');
  assert(startIdx !== -1, 'detectBrowser function must exist in docs/index.html');
  const openBrace = scriptContent.indexOf('{', startIdx);
  let depth = 1;
  let endIdx = openBrace + 1;
  while (depth > 0 && endIdx < scriptContent.length) {
    if (scriptContent[endIdx] === '{') depth++;
    else if (scriptContent[endIdx] === '}') depth--;
    endIdx++;
  }
  const fnCode = scriptContent.slice(startIdx, endIdx);
  const detectBrowser = new Function(`${fnCode}; return detectBrowser;`)();

  const firefoxRes = detectBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0');
  assert.strictEqual(firefoxRes.name, 'Firefox');
  assert.strictEqual(firefoxRes.supported, false);

  const edgeRes = detectBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0');
  assert.strictEqual(edgeRes.name, 'Edge');
  assert.strictEqual(edgeRes.supported, true);

  const operaRes = detectBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36 OPR/109.0.0.0');
  assert.strictEqual(operaRes.name, 'Opera');
  assert.strictEqual(operaRes.supported, true);

  const vivaldiRes = detectBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36 Vivaldi/6.6.3271.57');
  assert.strictEqual(vivaldiRes.name, 'Vivaldi');
  assert.strictEqual(vivaldiRes.supported, true);

  const arcRes = detectBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36 Arc/1.2');
  assert.strictEqual(arcRes.name, 'Arc');
  assert.strictEqual(arcRes.supported, true);

  const chromeRes = detectBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36');
  assert.strictEqual(chromeRes.name, 'Chrome');
  assert.strictEqual(chromeRes.supported, true);

  const braveRes = detectBrowser('', { brands: [{ brand: 'Chromium' }, { brand: 'Brave' }] });
  assert.strictEqual(braveRes.name, 'Brave');
  assert.strictEqual(braveRes.supported, true);
});

test('uninstalled state explains that Firefox is not supported at this time', () => {
  assert(
    html.includes('Firefox is not supported at this time') || html.includes('is not supported at this time'),
    'Should inform users if their browser is not supported at this time'
  );
});

test('manualJoinRow is hidden when extension is not installed and only shown when installed without room ID', () => {
  assert(
    html.includes("manualJoinRow.style.display = 'none'") || html.includes('style="display: none;"'),
    'manualJoinRow should be hidden by default'
  );
  assert(
    /markNotInstalled[\s\S]*?manualJoinRow\.style\.display\s*=\s*['"]none['"]/.test(html),
    'markNotInstalled must keep manualJoinRow hidden when extension is not installed'
  );
  assert(
    /markInstalled[\s\S]*?manualJoinRow\.style\.display\s*=\s*['"]flex['"]/.test(html),
    'markInstalled must reveal manualJoinRow when extension is active without a room ID'
  );
});

test('secondaryBtn is hidden when extension is active to avoid duplicate Open YouTube Music buttons', () => {
  assert(
    /markInstalled[\s\S]*?secondaryBtn\.style\.display\s*=\s*['"]none['"]/.test(html),
    'markInstalled must hide secondaryBtn to prevent duplicate Open YouTube Music buttons'
  );
  assert(
    /markNotInstalled[\s\S]*?secondaryBtn\.style\.display\s*=\s*['"]flex['"]/.test(html),
    'markNotInstalled must display secondaryBtn when uninstalled'
  );
});

console.log('All Gateway Page Tests completed.');

