import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const desktopRequire = createRequire(new URL("apps/desktop/package.json", root));
const updaterRequire = createRequire(desktopRequire.resolve("electron-updater/package.json"));
const { load } = updaterRequire("js-yaml");
const workflow = load(readFileSync(new URL(".github/workflows/fork-release.yml", root), "utf8"));
const release = load(readFileSync(new URL(".github/workflows/release.yml", root), "utf8"));

test("fork workflow is manual, read-only, SHA-pinned and verify-gated", () => {
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(workflow.jobs), ["verify", "desktop", "pi-host"]);
  for (const [name, job] of Object.entries(workflow.jobs)) {
    const checkout = job.steps.find(step => step.uses?.startsWith("actions/checkout@"));
    assert.equal(checkout.with.ref, "${{ github.sha }}");
    assert.equal(checkout.with["persist-credentials"], false);
    if (name !== "verify") assert.equal(job.needs, "verify");
    assert.ok(!job.if?.includes("refs/heads/main"));
  }
  assert.equal(workflow.jobs.desktop.strategy.matrix.include.length, 5);
  assert.equal(workflow.jobs["pi-host"].strategy.matrix.include.length, 2);
  for (const name of ["desktop", "pi-host"]) {
    const upload = workflow.jobs[name].steps.find(step => step.uses?.startsWith("actions/upload-artifact@"));
    assert.ok(upload.with.name.startsWith(`fork-${name}-`));
    assert.match(upload.with.path, /provenance\.json/);
    assert.match(upload.with.path, /SHA256SUMS/);
  }
  assert.match(release.jobs.verify.if, /github.repository == 'vastsa\/PI-Desktop'/);
  assert.match(release.jobs.verify.if, /refs\/tags\//);
  assert.match(release.jobs.verify.if, /-local\./);
});

const guard = workflow.jobs.verify.steps.find(step => step.name?.startsWith("Guard local version")).run
  .split("<<'NODE'\n")[1].split("\nNODE")[0];

function runGuard({ version = "1.2.3-local.4", hostVersion = version, status = 404, channel = "local" } = {}) {
  const source = guard.replace("import { readFile } from 'node:fs/promises';", `
    const readFile = async path => {
      if (path.endsWith('protocol.ts')) return 'export const APP_VERSION = "${version}";';
      if (path.includes('pi-host')) return JSON.stringify({ version: '${hostVersion}' });
      return JSON.stringify({ version: '${version}', build: { extraMetadata: { version: '${version}' }, publish: [{ channel: '${channel}' }] } });
    };
    const calls = [];
    globalThis.fetch = async (url, options) => {
      if (options.method && options.method !== 'GET') throw new Error('Write request');
      calls.push(url);
      return { status: ${status} };
    };
    process.on('exit', code => { if (code === 0 && calls.length !== 2) throw new Error('Missing API checks'); });
  `);
  return spawnSync(process.execPath, ["--input-type=module"], {
    input: source,
    encoding: "utf8",
    env: { ...process.env, GITHUB_API_URL: "https://api.github.com", GITHUB_REPOSITORY: "owner/fork", GH_TOKEN: "test" },
  });
}

test("guard accepts synchronized local versions and absent tag/release", () => {
  const result = runGuard();
  assert.equal(result.status, 0, result.stderr);
});

test("guard fails closed for upstream/mismatched versions, latest feed and API responses", () => {
  for (const options of [{ version: "1.2.3" }, { hostVersion: "1.2.3-local.3" }, { channel: "latest" }, { status: 200 }, { status: 401 }, { status: 500 }]) {
    assert.notEqual(runGuard(options).status, 0, JSON.stringify(options));
  }
});
