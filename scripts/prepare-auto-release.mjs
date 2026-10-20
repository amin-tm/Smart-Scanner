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
// GitHub Actions variables may contain a real newline or literal \n after copy/paste.
// Do not expose the key material in build logs.
const normalizedPubkey = String(pubkey ?? '')
  .replace(/^\uFEFF/, '')
  .replace(/\\r\\n|\\n|\\r/g, '\n')
  .trim();
const publicKeyLines = normalizedPubkey.split(/\r?\n/).map(line => line.trim());
const keyLine = publicKeyLines.find(line => /^RW[A-Za-z0-9+/=]{20,}$/.test(line));
console.log(
  `[Updater key check] supplied=${Boolean(pubkey && pubkey.trim())}; ` +
  `length=${normalizedPubkey.length}; lines=${publicKeyLines.length}; ` +
  `minisign_key_found=${Boolean(keyLine)}`
);
if (!normalizedPubkey) {
  throw new Error(
    'TAURI_UPDATER_PUBLIC_KEY is EMPTY in this GitHub Actions job. ' +
    'Check Settings > Secrets and variables > Actions > Variables, and confirm ' +
    'the workflow step has env: TAURI_UPDATER_PUBLIC_KEY: ${{ vars.TAURI_UPDATER_PUBLIC_KEY }}. ' +
    'If it is an Environment variable, the job must declare the same environment.'
  );
}
if (normalizedPubkey.includes('REPLACE_') || !keyLine) {
  throw new Error(
    'TAURI_UPDATER_PUBLIC_KEY reached the script but is not a valid minisign public-key text. ' +
    'Paste the full contents of the .key.pub file (untrusted comment line + RW... line); ' +
    'not its file path, private key or password.'
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
