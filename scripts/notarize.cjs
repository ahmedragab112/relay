const { execFileSync } = require('node:child_process');
const { rm } = require('node:fs/promises');
const { join } = require('node:path');

// Runs only when Apple credentials are present; local builds stay unsigned.
module.exports = async function notarize(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log('Skipping notarization: set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID to enable it.');
    return;
  }
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const archive = join(context.appOutDir, `${context.packager.appInfo.productFilename}.zip`);
  const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
  run('ditto', ['-c', '-k', '--keepParent', appPath, archive]);
  try {
    run('xcrun', ['notarytool', 'submit', archive, '--apple-id', APPLE_ID, '--password', APPLE_APP_SPECIFIC_PASSWORD, '--team-id', APPLE_TEAM_ID, '--wait']);
    run('xcrun', ['stapler', 'staple', appPath]);
  } finally {
    await rm(archive, { force: true });
  }
};
