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
// Tauri CLI stores the Minisign public-key text as BASE64 in the .key.pub
// file. The updater config requires this OUTER base64 string, not the raw
// `untrusted comment: ...` / `RW...` text. Never prepend `RW` yourself.
const suppliedPubkey = String(pubkey ?? '').trim().replace(/^\uFEFF/, '');
let candidate = suppliedPubkey;
if (/^"[\s\S]*"$/.test(candidate)) {
  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed === 'string') candidate = parsed.trim();
  } catch { /* Leave it unchanged so validation rejects it safely. */ }
}

// Support the normal Tauri-generated Base64 value, and also raw Minisign
// text if it was copied from a decoded file. Always write Base64 to config.
function minisignKeyTextValid(input) {
  const lines = input.replace(/\r\n/g, '\n').trim().split('\n');
  if (lines.length !== 2 || !lines[0].startsWith('untrusted comment: ')) return false;
  const line = lines[1].trim();
  if (!/^RW[A-Za-z0-9+/]{54}$/.test(line)) return false;
  const key = Buffer.from(line, 'base64');
  return key.length === 42 && key.subarray(0, 2).toString('ascii') === 'Ed' && key.toString('base64') === line;
}

let normalizedPubkey = '';
let detectedFormat = 'invalid';
const cleanCandidate = candidate.replace(/\r/g, '').replace(/\n$/, '');
if (/^[A-Za-z0-9+/]+={0,2}$/.test(cleanCandidate)) {
  const decoded = Buffer.from(cleanCandidate, 'base64');
  if (decoded.toString('base64') === cleanCandidate && minisignKeyTextValid(decoded.toString('utf8'))) {
    normalizedPubkey = cleanCandidate;
    detectedFormat = 'tauri-base64';
  }
}
if (!normalizedPubkey) {
  const raw = candidate.replace(/\\r\\n|\\n|\\r/g, '\n').replace(/\r/g, '');
  if (minisignKeyTextValid(raw)) {
    normalizedPubkey = Buffer.from(raw.trim() + '\n', 'utf8').toString('base64');
    detectedFormat = 'minisign-text-converted';
  }
}
console.log(`[Updater key check] supplied=${Boolean(candidate)}; length=${candidate.length}; format=${detectedFormat}`);
if (!normalizedPubkey || candidate.includes('REPLACE_')) {
  throw new Error(
    'TAURI_UPDATER_PUBLIC_KEY is invalid. Restore the EXACT original contents of the Tauri-generated .key.pub file ' +
    '(usually begins with dW50cnVzdGVk). Do not prepend RW, decode it, or use the private key or password.'
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
