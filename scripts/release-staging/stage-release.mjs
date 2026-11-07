import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const { GITHUB_API_URL, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID, GH_TOKEN,
  RELEASE_ID: id, RELEASE_TAG: tag, SOURCE_SHA } = process.env;
const dir = process.argv[2];
const manifest = JSON.parse(await readFile(join(dir, 'release-manifest.json'), 'utf8'));
assert.equal(manifest.commit, SOURCE_SHA);
assert.equal('v' + manifest.version, tag);
assert.equal(manifest.assets.length, 16);
await import('./guard-release.mjs');
const headers = { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json' };
const api = `${GITHUB_API_URL}/repos/${repo}/releases/${id}`;
const upload = `https://uploads.github.com/repos/${repo}/releases/${id}/assets`;
async function get() {
  const response = await fetch(api, { headers, redirect: 'error' });
  assert(response.ok, `Release lookup: HTTP ${response.status}`);
  const result = await response.json();
  assert(result.draft && result.prerelease);
  assert.equal(result.tag_name, tag);
  assert.equal(result.target_commitish, SOURCE_SHA);
  return result;
}
function checkAsset(file, uploaded) {
  assert(uploaded, file.name + ': missing after upload');
  assert.equal(uploaded.state, 'uploaded', file.name);
  assert.equal(uploaded.size, file.size, file.name);
  assert.equal(uploaded.digest, 'sha256:' + file.sha256, file.name);
}
const initial = await get();
assert.equal(initial.upload_url, upload + '{?name,label}');
for (const asset of initial.assets) {
  const file = manifest.assets.find(file => file.name === asset.name);
  assert(file, 'Unexpected existing release asset');
  checkAsset(file, asset);
}
for (const file of manifest.assets) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = (await get()).assets.find(asset => asset.name === file.name);
    if (existing) {
      checkAsset(file, existing);
      break;
    }
    const url = new URL(upload);
    url.searchParams.set('name', file.name);
    try {
      const response = await fetch(url, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream',
          'Content-Length': String(file.size) }, redirect: 'error',
        body: createReadStream(join(dir, 'publish', file.name)), duplex: 'half',
        signal: AbortSignal.timeout(180_000),
      });
      if (response.status === 201) {
        const asset = await response.json();
        checkAsset(file, asset);
        break;
      }
      throw new Error(`Upload returned HTTP ${response.status}`);
    } catch (error) {
      console.error(`Upload attempt ${attempt + 1} for ${file.name}: ${error.message}`);
      if (attempt === 2) throw error;
      await setTimeout(2000);
    }
  }
  console.log(`Verified uploaded asset ${file.name} (${file.size} bytes)`);
}
const result = await get();
assert.equal(result.assets.length, 16);
for (const file of manifest.assets) checkAsset(file, result.assets.find(asset => asset.name === file.name));
const notes = await readFile('scripts/release-staging/release-notes.md', 'utf8');
const response = await fetch(api, {
  method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, redirect: 'error',
  body: JSON.stringify({ body: notes + `- [Release asset verification](https://github.com/${repo}/actions/runs/${GITHUB_RUN_ID}).\n` }),
});
assert(response.ok, `Draft notes update returned HTTP ${response.status}`);
const updated = await response.json();
assert(updated.draft && updated.prerelease);
await writeFile(join(dir, 'upload-verification.json'), JSON.stringify({
  releaseId: result.id, tag, source: SOURCE_SHA, draft: true,
  assets: result.assets.map(({ name, size, digest }) => ({ name, size, digest })),
}, null, 2) + '\n');
console.log(`Verified draft ${result.html_url} with 16 assets`);
