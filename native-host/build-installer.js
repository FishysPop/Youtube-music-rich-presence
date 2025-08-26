const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

const NATIVE_HOST_NAME = 'com.fishypop.ytmusic_rpc';
const EXTENSION_ID = process.env.YTM_RPC_EXTENSION_ID || 'nnkdglgpmblpcmnojjekboafalidkmkb'; // Use env var or default to published ID
const APP_NAME = 'YouTubeMusicRPCHelper';
const COMPANY_NAME = 'FishyPop'; // Define company name here
const OUTPUT_SETUP_FILENAME = 'YouTubeMusicRPCSetup.exe';
const PKG_NATIVE_HOST_EXE_NAME = 'ytm-rpc-host.exe'; // This is the output of pkg
const NATIVE_HOST_MANIFEST_FILENAME = `${NATIVE_HOST_NAME}.json`;
// NATIVE_HOST_EXE_FILENAME for the manifest 'path' and !define will be PKG_NATIVE_HOST_EXE_NAME

async function buildInstaller() {
  try {
    console.log('Starting installer build process...');

    const projectRoot = __dirname; // This is native-host directory
    const buildDir = path.join(projectRoot, 'build');
    const installerOutputDir = path.join(buildDir, 'installer');

    if (await fs.pathExists(buildDir)) {
      console.log(`Cleaning up existing build directory: ${buildDir}`);
      await fs.remove(buildDir);
    }

    await fs.ensureDir(buildDir);
    await fs.ensureDir(installerOutputDir);

    const nativeHostScriptPath = path.join(projectRoot, 'native-host.js');
    const packagedHostPath = path.join(buildDir, PKG_NATIVE_HOST_EXE_NAME);

    console.log('Packaging native host script with pkg...');
    console.log(`  Input file: ${nativeHostScriptPath}`);
    console.log(`  Output file: ${packagedHostPath}`);

    execSync(`npx pkg "${nativeHostScriptPath}" --targets node18-win-x64 --output "${packagedHostPath}"`, { stdio: 'inherit' });

    console.log(`Native host packaged to: ${packagedHostPath}`);

    const installDirNSIS = `$LOCALAPPDATA\\${APP_NAME}`;
    const nsisTemplateFilePath = path.join(projectRoot, 'installer.template.nsi');
    let nsisScriptContent = await fs.readFile(nsisTemplateFilePath, 'utf8');

    const replacements = {
      '%%APPNAME%%': APP_NAME,
      '%%COMPANYNAME%%': COMPANY_NAME,
      '%%NATIVE_HOST_NAME%%': NATIVE_HOST_NAME,
      '%%NATIVE_HOST_MANIFEST_FILENAME%%': NATIVE_HOST_MANIFEST_FILENAME,
      '%%NATIVE_HOST_EXE_FILENAME%%': PKG_NATIVE_HOST_EXE_NAME, // The actual .exe name for !define
      '%%EXTENSION_ID%%': EXTENSION_ID.trim(), // Trim whitespace/newlines
      '%%OUTPUT_FILENAME%%': OUTPUT_SETUP_FILENAME, // For !define OUTPUT_FILENAME
      '%%OUTFILE_PATH%%': path.join(installerOutputDir, OUTPUT_SETUP_FILENAME).replace(/\\/g, '\\\\'),
      '%%INSTALL_DIR_NSIS%%': installDirNSIS,
      '%%PACKAGED_HOST_PATH%%': packagedHostPath.replace(/\\/g, '\\\\'), // Path to the .exe built by pkg
    };

    for (const placeholder in replacements) {
      // Escape special characters in placeholder for regex and replace globally
      const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      nsisScriptContent = nsisScriptContent.replace(new RegExp(escapedPlaceholder, 'g'), replacements[placeholder]);
    }

    const nsisScriptPath = path.join(buildDir, 'installer.nsi');
    await fs.writeFile(nsisScriptPath, nsisScriptContent); // No trim needed if template is clean
    console.log(`NSIS script generated at: ${nsisScriptPath}`);

    console.log('Compiling NSIS script...');
    // Ensure NSIS path is correct for your system or is in PATH
    // Example: "C:\\Program Files (x86)\\NSIS\\makensis.exe"
    // If makensis is in your PATH, you can just use "makensis"
    execSync(`"C:\\Program Files (x86)\\NSIS\\makensis.exe" "${nsisScriptPath}"`, { stdio: 'inherit' });
    console.log(`Installer created at: ${path.join(installerOutputDir, OUTPUT_SETUP_FILENAME)}`);

    console.log('Installer build process completed successfully!');

  } catch (error) {
    console.error('Error during installer build process:', error);
    process.exit(1);
  }
}

buildInstaller();
