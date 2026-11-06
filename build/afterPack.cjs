// Ad-hoc code-sign the macOS app after packaging.
// Without any signature, Apple Silicon Macs refuse to open the app and report
// it as "damaged". An ad-hoc signature ("-") needs no Apple Developer account.
//
// For a universal build electron-builder first packs x64 and arm64 copies into
// "*-temp" folders and merges them. Those copies must stay unsigned (their
// signatures would differ and break the merge), so only the merged app is signed.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (/-temp$/.test(context.appOutDir)) return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing ${appPath}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' });
};
