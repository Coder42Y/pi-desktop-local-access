import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const { GITHUB_REPOSITORY: repo, GITHUB_RUN_ID, RELEASE_TAG: tag, SOURCE_SHA } = process.env;
const dir = process.argv[2];
const manifest = JSON.parse(await readFile(join(dir, 'release-manifest.json'), 'utf8'));
assert.equal(manifest.commit, SOURCE_SHA);
assert.equal('v' + manifest.version, tag);
assert.equal(manifest.assets.length, 16);
const notes = join(dir, 'release-notes.md');
await writeFile(notes, await readFile('scripts/release-staging/release-notes.md', 'utf8'));
await appendFile(notes, `- [Release asset verification](https://github.com/${repo}/actions/runs/${GITHUB_RUN_ID}).\n`);
await import('./guard-release.mjs');
const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
gh(['release', 'create', tag, '--repo', repo, '--draft', '--prerelease', '--target', SOURCE_SHA,
  '--title', '0.21.0-local.4 — Quotes, file links and background Bash', '--notes-file', notes]);
const findRelease = () => gh(['api', `repos/${repo}/releases`, '--paginate', '--jq',
  `.[] | select(.tag_name == "${tag}") | .id`]);
const id = findRelease();
assert.match(id, /^\d+$/);
const get = () => JSON.parse(gh(['api', `repos/${repo}/releases/${id}`]));
const initial = get();
assert(initial.draft && initial.prerelease);
assert.equal(initial.target_commitish, SOURCE_SHA);
assert.equal(initial.assets.length, 0);
function checkAsset(file, uploaded) {
  assert.equal(uploaded.state, 'uploaded', file.name);
  assert.equal(uploaded.size, file.size, file.name);
  assert.equal(uploaded.digest, 'sha256:' + file.sha256, file.name);
}
for (const file of manifest.assets) {
  const path = join(dir, 'publish', file.name);
  let uploaded;
  for (let attempt = 0; attempt < 3; attempt++) {
    uploaded = get().assets.find(asset => asset.name === file.name);
    if (uploaded) break;
    try {
      gh(['release', 'upload', tag, path, '--repo', repo]);
    } catch (error) {
      if (attempt === 2) throw error;
    }
    await setTimeout(1000);
  }
  uploaded = get().assets.find(asset => asset.name === file.name);
  assert(uploaded, file.name + ': missing after upload');
  checkAsset(file, uploaded);
  console.log(`Verified uploaded asset ${file.name} (${file.size} bytes)`);
}
const result = get();
assert(result.draft && result.prerelease);
assert.equal(result.target_commitish, SOURCE_SHA);
assert.equal(result.assets.length, 16);
for (const file of manifest.assets) checkAsset(file, result.assets.find(asset => asset.name === file.name));
await writeFile(join(dir, 'upload-verification.json'), JSON.stringify({
  releaseId: result.id, tag, source: SOURCE_SHA, draft: true,
  assets: result.assets.map(({ name, size, digest }) => ({ name, size, digest })),
}, null, 2) + '\n');
console.log(`Verified draft ${result.html_url} with 16 assets`);
