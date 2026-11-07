import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, link, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';

const root = process.argv[2];
const version = '0.21.0-local.4';
const commit = '1588e6dbfe4920a239f660635f4db8aa3e4c3d9c';
const yaml = {
  load(input) {
    return JSON.parse(execFileSync('/usr/bin/python3', ['-c',
      'import json, sys, yaml; print(json.dumps(yaml.safe_load(sys.stdin), default=lambda value: value.isoformat()))'],
      { input, encoding: 'utf8' }));
  },
  dump(value) {
    return execFileSync('/usr/bin/python3', ['-c',
      'import json, sys, yaml; print(yaml.safe_dump(json.load(sys.stdin), sort_keys=False), end="")'],
      { input: JSON.stringify(value), encoding: 'utf8' });
  },
};
const artifacts = join(root, 'artifacts');
const stage = join(root, 'publish');
await mkdir(stage, { recursive: true });

async function hash(path, algorithm, encoding = 'hex') {
  const digest = createHash(algorithm);
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest(encoding);
}

async function validateArtifact(name) {
  const directory = join(artifacts, name);
  const provenance = JSON.parse(await readFile(join(directory, 'provenance.json'), 'utf8'));
  assert.equal(provenance.commit, commit, name);
  assert.equal(provenance.version, version, name);
  const [, kind, platform, arch] = name.match(/^fork-(desktop|pi-host)-(mac|win|linux)-(arm64|x64)$/);
  assert.equal(provenance.platform, platform, name);
  assert.equal(provenance.arch, arch, name);
  if (kind === 'desktop') assert.equal(provenance.signing, 'unsigned; not notarized', name);
  const sums = (await readFile(join(directory, 'SHA256SUMS'), 'utf8')).trim().split('\n');
  for (const line of sums) {
    const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/);
    assert(match, name + ': invalid checksum row');
    assert.equal(basename(match[2]), match[2]);
    assert.equal(await hash(join(directory, match[2]), 'sha256'), match[1], match[2]);
  }
  return directory;
}

async function stageFile(directory, name) {
  const source = join(directory, name);
  assert((await stat(source)).size > 0, name);
  try { await link(source, join(stage, name)); }
  catch (error) {
    if (error.code === 'EEXIST') {
      assert.equal(await hash(source, 'sha256'), await hash(join(stage, name), 'sha256'), name);
    } else {
      if (error.code !== 'EXDEV') throw error;
      await copyFile(source, join(stage, name));
    }
  }
}

const macFeeds = [];
for (const arch of ['arm64', 'x64']) {
  const directory = await validateArtifact('fork-desktop-mac-' + arch);
  await stageFile(directory, `PI-Desktop-${version}-${arch}.dmg`);
  await stageFile(directory, `PI-Desktop-${version}-${arch}-mac.zip`);
  macFeeds.push(yaml.load(await readFile(join(directory, 'local-mac.yml'), 'utf8')));
}
const merged = { ...macFeeds[0], files: macFeeds.flatMap(feed => feed.files) };
assert.equal(new Set(merged.files.map(file => file.url)).size, 4);
await writeFile(join(stage, 'local-mac.yml'), yaml.dump(merged));

const windows = await validateArtifact('fork-desktop-win-x64');
for (const name of [`PI-Desktop-Setup-${version}.exe`, `PI-Desktop-Setup-${version}.exe.blockmap`, 'local.yml']) {
  await stageFile(windows, name);
}
for (const arch of ['arm64', 'x64']) {
  const directory = await validateArtifact('fork-desktop-linux-' + arch);
  await stageFile(directory, `PI-Desktop-${version}-linux-${arch === 'x64' ? 'x86_64' : arch}.AppImage`);
  await stageFile(directory, arch === 'x64' ? 'local-linux.yml' : 'local-linux-arm64.yml');
  const host = await validateArtifact('fork-pi-host-linux-' + arch);
  const archive = `pi-host-${version}-linux-${arch}.tar.gz`;
  await stageFile(host, archive);
  await stageFile(host, archive + '.sha256');
  const checksum = (await readFile(join(host, archive + '.sha256'), 'utf8')).trim();
  assert.equal(checksum, (await hash(join(host, archive), 'sha256')) + '  ' + archive);
}

for (const name of ['local.yml', 'local-linux.yml', 'local-linux-arm64.yml', 'local-mac.yml']) {
  const feed = yaml.load(await readFile(join(stage, name), 'utf8'));
  assert.equal(feed.version, version, name);
  assert(Array.isArray(feed.files) && feed.files.length > 0, name);
  for (const file of feed.files) {
    assert.equal(basename(file.url), file.url, name);
    const path = join(stage, file.url);
    assert.equal((await stat(path)).size, file.size, file.url);
    assert.equal(await hash(path, 'sha512', 'base64'), file.sha512, file.url);
  }
  const primary = feed.files.find(file => file.url === feed.path);
  assert(primary, name + ': missing primary payload');
  assert.equal(primary.sha512, feed.sha512, name);
}
const names = (await readdir(stage)).sort();
assert.equal(names.length, 16);
const manifest = [];
for (const name of names) manifest.push({ name, size: (await stat(join(stage, name))).size, sha256: await hash(join(stage, name), 'sha256') });
await writeFile(join(root, 'release-manifest.json'), JSON.stringify({ version, commit, assets: manifest }, null, 2) + '\n');
console.log(JSON.stringify({ version, commit, assets: names, verified: true }, null, 2));
