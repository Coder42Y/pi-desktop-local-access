import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyCustomUpdateRelease } from "./check-custom-update-release.mjs";

const version = "0.21.0-local.2";
const name = `PI-Desktop-${version}-arm64-mac.zip`;
async function fixture(t) {
  const dir = await mkdtemp(join(process.env.PI_SCRATCH_DIR || tmpdir(), "custom-update-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bytes = Buffer.from("synthetic archive bytes for integrity verification");
  const sha512 = createHash("sha512").update(bytes).digest("base64");
  const manifest = { version, files: [{ url: name, sha512, size: bytes.length }], path: name, sha512 };
  await writeFile(join(dir, name), bytes);
  const save = () => writeFile(join(dir, "local-mac.yml"), JSON.stringify(manifest));
  await save();
  return { dir, manifest, save };
}

test("preflight verifies builder metadata against actual bytes and returns exact upload allowlist", async (t) => {
  const { dir } = await fixture(t);
  assert.deepEqual(await verifyCustomUpdateRelease(dir, version), { version, tag: `v${version}`, assets: [name, "local-mac.yml"] });
});
for (const [label, mutate, pattern] of [
  ["version", (m) => { m.version = "0.21.0-local.1"; }, /version mismatch/],
  ["size", (m) => { m.files[0].size++; }, /size mismatch/],
  ["hash", (m) => { m.files[0].sha512 = "A".repeat(86) + "=="; }, /checksum mismatch/],
  ["traversal", (m) => { m.files[0].url = "../private.zip"; }, /Unsafe/],
  ["absolute", (m) => { m.files[0].url = "/private.zip"; }, /Unsafe/],
  ["remote", (m) => { m.files[0].url = "https://example.test/private.zip"; }, /Unsafe/],
  ["wrong architecture", (m) => { m.files[0].url = name.replace("arm64", "riscv64"); }, /architecture mismatch/],
  ["primary", (m) => { m.sha512 = "incorrect"; }, /Primary/],
  ["empty", (m) => { m.files = []; }, /Missing/],
]) {
  test(`preflight rejects ${label}`, async (t) => {
    const { dir, manifest, save } = await fixture(t);
    mutate(manifest); await save();
    await assert.rejects(verifyCustomUpdateRelease(dir, version), pattern);
  });
}
test("preflight rejects symlink archives", async (t) => {
  const { dir } = await fixture(t);
  await rm(join(dir, name));
  await writeFile(join(dir, "outside"), "synthetic");
  await symlink(join(dir, "outside"), join(dir, name));
  await assert.rejects(verifyCustomUpdateRelease(dir, version), /regular file/);
});
test("legacy local-v release tags cannot become version identifiers", async (t) => {
  const { dir } = await fixture(t);
  await assert.rejects(verifyCustomUpdateRelease(dir, "local-v0.21.0-2"), /semver/);
});

async function wrapper(t, dir, args) {
  const { mkdir, chmod } = await import("node:fs/promises");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { fileURLToPath } = await import("node:url");
  const bin = join(dir, "bin"); await mkdir(bin);
  const executable = join(bin, "pnpm");
  await writeFile(executable, `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.ARGV_LOG, JSON.stringify(process.argv.slice(2)));\n`);
  await chmod(executable, 0o700);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ARGV_LOG: join(dir, "args.json") };
  const { rename } = await import("node:fs/promises");
  await mkdir(join(dir, "release"));
  for (const file of [name, "local-mac.yml"]) await rename(join(dir, file), join(dir, "release", file));
  const command = promisify(execFile)(process.execPath,
    [fileURLToPath(new URL("./build-desktop-release.mjs", import.meta.url)), "mac", ...args], { cwd: dir, env });
  return command;
}

test("packaging wrapper forwards architecture flags before metadata preflight", async (t) => {
  const { dir } = await fixture(t);
  await wrapper(t, dir, ["--arm64", "--x64"]);
  const { readFile } = await import("node:fs/promises");
  assert.deepEqual(JSON.parse(await readFile(join(dir, "args.json"), "utf8")),
    ["exec", "electron-builder", "--mac", "--publish", "never", "--arm64", "--x64"]);
});

test("packaging wrapper rejects malformed metadata without printing YAML contents or stacks", async (t) => {
  const { dir } = await fixture(t);
  await writeFile(join(dir, "local-mac.yml"), "version: [\nsynthetic-private-token");
  await assert.rejects(wrapper(t, dir, []), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Custom update release preflight failed/);
    assert.doesNotMatch(error.stderr, /synthetic-private|YAMLException|node:internal|at file:/);
    return true;
  });
});
