#!/usr/bin/env node
/**
 * install-icons.mjs
 *
 * Unpacks the committed icon archives into the gitignored ios/ and android/
 * folders. Run this once after `npx cap add ios` / `npx cap add android`,
 * and again whenever you regenerate icons.
 *
 *   node scripts/install-icons.mjs
 *
 * The zips live in scripts/icons/ and are committed to the repo so the
 * native project folders (which are gitignored) can be reconstructed on
 * any machine without re-running the icon generation script.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function unzip(zipPath, destDir) {
  if (!existsSync(zipPath)) {
    console.error(`❌  Not found: ${zipPath}`);
    process.exit(1);
  }
  console.log(`📦  Unpacking ${zipPath.replace(ROOT, '.')} → ${destDir.replace(ROOT, '.')}`);
  // -o  overwrite without prompting
  // -q  quiet
  execSync(`unzip -oq "${zipPath}" -d "${ROOT}"`, { stdio: 'inherit' });
}

unzip(
  resolve(__dirname, 'icons', 'bloom-icons-ios.zip'),
  resolve(ROOT, 'ios')
);

unzip(
  resolve(__dirname, 'icons', 'bloom-icons-android.zip'),
  resolve(ROOT, 'android')
);

console.log('✅  Icons installed.');
console.log('   iOS:     ios/App/App/Assets.xcassets/AppIcon.appiconset/');
console.log('   Android: android/app/src/main/res/mipmap-*/  drawable-*/');
