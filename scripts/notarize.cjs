const { execFileSync, spawnSync } = require('node:child_process');
const { rm } = require('node:fs/promises');
const { join } = require('node:path');

const required = process.env.RELAY_REQUIRE_NOTARIZATION === '1';

function fail(message) {
  if (required) throw new Error(`Notarization required: ${message}`);
  console.log(`Skipping notarization: ${message}`);
  return false;
}

// Runs when Apple credentials are present; local builds stay ad-hoc signed.
module.exports = async function notarize(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID, NOTARY_KEYCHAIN_PROFILE } = process.env;
  let credentials;
  if (NOTARY_KEYCHAIN_PROFILE) {
    credentials = ['--keychain-profile', NOTARY_KEYCHAIN_PROFILE];
  } else if (APPLE_ID && APPLE_APP_SPECIFIC_PASSWORD && APPLE_TEAM_ID) {
    credentials = ['--apple-id', APPLE_ID, '--password', APPLE_APP_SPECIFIC_PASSWORD, '--team-id', APPLE_TEAM_ID];
  } else {
    fail('set NOTARY_KEYCHAIN_PROFILE or APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID to enable it.');
    return;
  }
  const product = context.packager.appInfo.productFilename;
  const appPath = join(context.appOutDir, `${product}.app`);
  const archive = join(context.appOutDir, `${product}.zip`);
  const signing = spawnSync('codesign', ['-dv', '--verbose=2', appPath], { encoding: 'utf8' });
  if (!/Developer ID Application/.test(`${signing.stdout ?? ''}${signing.stderr ?? ''}`)) {
    fail('the app has no Developer ID Application signature, which notarization requires.');
    return;
  }
  const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
  run('ditto', ['-c', '-k', '--keepParent', appPath, archive]);
  try {
    run('xcrun', ['notarytool', 'submit', archive, ...credentials, '--wait']);
    run('xcrun', ['stapler', 'staple', appPath]);
  } finally {
    await rm(archive, { force: true });
  }
};
