/** Called by the release workflow, not at runtime. Does not store secrets. */
import fs from 'node:fs';
import path from 'node:path';

const repository = process.env.GITHUB_REPOSITORY;
const releaseRepo = process.env.UPDATE_RELEASE_REPOSITORY || repository;
const pubkey = process.env.TAURI_UPDATER_PUBLIC_KEY;
const runNumber = Number(process.env.GITHUB_RUN_NUMBER);
const privateSource = process.env.SOURCE_REPO_PRIVATE === 'true';
if (!repository || !/^[-\w.]+\/[-\w.]+$/.test(releaseRepo || '')) {
  throw new Error('Set UPDATE_RELEASE_REPOSITORY to owner/public-release-repository.');
}
if (privateSource && releaseRepo === repository) {
  throw new Error('The source repo is private. Use a separate PUBLIC Releases repo and set UPDATE_RELEASE_REPOSITORY.');
}
// Recover the public key when copied through GitHub variables as one line,
// JSON-escaped text, or literal \n. Never log the key itself.
let rawPublicKey = String(pubkey ?? '').trim().replace(/^\uFEFF/, '');
try {
  if (/^"[\s\S]*"$/.test(rawPublicKey)) {
    const parsed = JSON.parse(rawPublicKey);
    if (typeof parsed === 'string') rawPublicKey = parsed;
  }
} catch { /* Ignore malformed JSON quoting. */ }
rawPublicKey = rawPublicKey.replace(/\\r\\n|\\n|\\r/g, '\n');
const keyTokens = rawPublicKey.match(/RW[A-Za-z0-9+/]{54}/g) || [];
const distinctKeys = [...new Set(keyTokens)];
const decodedKeys = distinctKeys.filter((candidate) => {
  try {
    const bytes = Buffer.from(candidate, 'base64');
    return bytes.length === 42 && bytes.toString('base64') === candidate;
  } catch { return false; }
});
const normalizedPubkey = decodedKeys.length === 1
  ? `untrusted comment: minisign public key\n${decodedKeys[0]}`
  : '';
const diagnostic = [
  `supplied=${Boolean(rawPublicKey)}`,
  `length=${rawPublicKey.length}`,
  `lines=${rawPublicKey.split(/\r?\n/).length}`,
  `has_RW_prefix=${rawPublicKey.includes('RW')}`,
  `key_candidates=${distinctKeys.length}`,
  `valid_key_candidates=${decodedKeys.length}`,
].join('; ');
console.log(`[Updater key check] ${diagnostic}`);
if (!rawPublicKey) {
  throw new Error('TAURI_UPDATER_PUBLIC_KEY is empty in this job. Check workflow env and GitHub Actions Variables.');
}
if (rawPublicKey.includes('REPLACE_') || decodedKeys.length !== 1) {
  throw new Error(
    'TAURI_UPDATER_PUBLIC_KEY is not a recognizable Minisign public key. ' +
    'Set the value to the FULL TEXT of the .key.pub file: ' +
    'untrusted comment: minisign public key, followed by the RW... line. ' +
    'Do not paste a path, private key, password, or GitHub expression. ' +
    'See [Updater key check] for safe diagnostics.'
  );
}
if (!Number.isSafeInteger(runNumber) || runNumber < 1) {
  throw new Error('GITHUB_RUN_NUMBER is required to produce a strictly increasing patch version.');
}
// Keep major/minor stable and create an increasing patch version from workflow runs.
const cfgBefore = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const m = String(cfgBefore.version || '3.0.0').match(/^(\d+)\.(\d+)\.(\d+)/);
const major = Math.max(3, Number(m?.[1] || 3));
const minor = major === Number(m?.[1]) ? Number(m?.[2] || 0) : 0;
const attempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1);
if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 99) throw new Error('Bad GITHUB_RUN_ATTEMPT');
const version = `${major}.${minor}.${10000 + runNumber * 100 + attempt}`;
const configFile = 'src-tauri/tauri.conf.json';
const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
cfg.version = version;
cfg.plugins.updater.pubkey = normalizedPubkey;
cfg.plugins.updater.endpoints = [`https://github.com/${releaseRepo}/releases/latest/download/latest.json`];
fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2) + '\n');
const cargoFile = 'src-tauri/Cargo.toml';
let cargo = fs.readFileSync(cargoFile, 'utf8');
cargo = cargo.replace(/^(\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m, `$1"${version}"`);
fs.writeFileSync(cargoFile, cargo);
const [owner, repo] = releaseRepo.split('/');
const output = process.env.GITHUB_OUTPUT;
if (output) fs.appendFileSync(output, `owner=${owner}\nrepo=${repo}\nversion=${version}\n`);
console.log(`Configured SmartScanner v${version} with feed at ${releaseRepo}/releases/latest/download/latest.json`);
