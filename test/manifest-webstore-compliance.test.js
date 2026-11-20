const fs = require('fs');
const path = require('path');
const assert = require('assert');

function runAllTests() {
  const extDir = path.resolve(__dirname, '..', 'extention');
  const manifestPath = path.join(extDir, 'manifest.json');

  console.log('Running Chrome Web Store Compliance & Manifest Tests...\n');

  assert.strictEqual(fs.existsSync(manifestPath), true, 'manifest.json must exist');
  const rawManifest = fs.readFileSync(manifestPath, 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(rawManifest);
  } catch (err) {
    assert.fail(`manifest.json is not valid JSON: ${err.message}`);
  }

  // 1. Manifest V3 & Core Metadata
  assert.strictEqual(manifest.manifest_version, 3, 'manifest_version must be 3');
  assert.strictEqual(typeof manifest.name, 'string', 'name must be a string');
  assert.strictEqual(manifest.name.length > 0 && manifest.name.length <= 75, true, 'name must be <= 75 chars');
  assert.strictEqual(typeof manifest.description, 'string', 'description must be a string');
  assert.strictEqual(manifest.description.length > 0 && manifest.description.length <= 132, true, 'description must be <= 132 chars');
  assert.strictEqual(typeof manifest.version, 'string', 'version must be a string');

  // 2. Permissions validation (Principle of Least Privilege)
  assert.strictEqual(Array.isArray(manifest.permissions), true, 'permissions must be an array');
  assert.strictEqual(manifest.permissions.includes('activeTab'), false, 'activeTab must not be requested as host_permissions covers target origins');
  const expectedPermissions = ['tabs', 'scripting', 'storage', 'nativeMessaging', 'alarms'];
  for (const perm of manifest.permissions) {
    assert.strictEqual(expectedPermissions.includes(perm), true, `Unexpected permission requested: ${perm}`);
  }

  // 3. Icons existence and dimension validation
  assert.strictEqual(typeof manifest.icons, 'object', 'icons object must exist');
  const requiredIconSizes = ['16', '32', '48', '128'];
  for (const size of requiredIconSizes) {
    assert.strictEqual(typeof manifest.icons[size], 'string', `Icon for size ${size} must be defined`);
    const iconFilePath = path.join(extDir, manifest.icons[size]);
    assert.strictEqual(fs.existsSync(iconFilePath), true, `Icon file must exist: ${manifest.icons[size]}`);
    
    // Validate PNG signature and header dimensions (IHDR at byte 16-24: 4 bytes width, 4 bytes height)
    const buf = fs.readFileSync(iconFilePath);
    assert.strictEqual(buf.length >= 24, true, 'Icon file too small for PNG header');
    const pngMagic = buf.slice(0, 8);
    const expectedMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.deepStrictEqual(pngMagic, expectedMagic, `Icon file must be valid PNG: ${manifest.icons[size]}`);
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    assert.strictEqual(width, parseInt(size, 10), `Icon width mismatch for size ${size}: got ${width}`);
    assert.strictEqual(height, parseInt(size, 10), `Icon height mismatch for size ${size}: got ${height}`);
  }

  // 4. Action default_icon check
  if (manifest.action && manifest.action.default_icon) {
    const actionIcons = manifest.action.default_icon;
    for (const [s, relPath] of Object.entries(actionIcons)) {
      const p = path.join(extDir, relPath);
      assert.strictEqual(fs.existsSync(p), true, `Action icon must exist: ${relPath}`);
    }
  }

  // 5. Scripts existence check
  assert.strictEqual(typeof manifest.background, 'object', 'background must be defined');
  assert.strictEqual(typeof manifest.background.service_worker, 'string', 'service_worker must be defined');
  assert.strictEqual(fs.existsSync(path.join(extDir, manifest.background.service_worker)), true, 'service_worker script must exist');

  if (manifest.action && manifest.action.default_popup) {
    assert.strictEqual(fs.existsSync(path.join(extDir, manifest.action.default_popup)), true, 'popup HTML must exist');
  }

  assert.strictEqual(Array.isArray(manifest.content_scripts), true, 'content_scripts must be an array');
  for (const cs of manifest.content_scripts) {
    if (Array.isArray(cs.js)) {
      for (const jsFile of cs.js) {
        assert.strictEqual(fs.existsSync(path.join(extDir, jsFile)), true, `content_script js file must exist: ${jsFile}`);
      }
    }
  }

  console.log('  [PASS] manifest.json conforms to Manifest V3 specification');
  console.log('  [PASS] Description and Name meet strict Chrome Web Store length constraints');
  console.log('  [PASS] Permissions conform to Least Privilege with redundant activeTab eliminated');
  console.log('  [PASS] Dedicated pixel-perfect PNG icons (16, 32, 48, 128) validated for existence and exact dimensions');
  console.log('  [PASS] Service worker, content scripts, and popup HTML confirmed on disk');
  console.log('\nALL MANIFEST & STORE COMPLIANCE TESTS PASSED!\n');
}

runAllTests();
