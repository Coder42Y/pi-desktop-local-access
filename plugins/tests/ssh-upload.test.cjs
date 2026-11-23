"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
let api = {};
try { api = require("../ssh-upload/transfer.cjs"); } catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
}

test("validates SSH destination without allowing option or shell injection", () => {
  assert.equal(typeof api.validateConfig, "function");
  assert.deepEqual(api.validateConfig({ target: "user@build-box", port: "2222", directory: "~/uploads" }), {
    target: "user@build-box", port: 2222, directory: "~/uploads", identity: "",
  });
  for (const target of ["-oProxyCommand=evil", "host;touch /tmp/bad", "host\nnext", "user@", "a b", "ssh://server"]) {
    assert.throws(() => api.validateConfig({ target }), /target/i);
  }
  for (const port of [0, 65536, "22oops", 1.5]) {
    assert.throws(() => api.validateConfig({ target: "server", port }), /port/i);
  }
  for (const directory of ["relative/path", "/tmp/../etc", "/tmp\nfoo", "~other/files"]) {
    assert.throws(() => api.validateConfig({ target: "server", directory }), /directory/i);
  }
});

test("builds SSH arguments with strict host verification and no local shell", () => {
  assert.equal(typeof api.sshArgs, "function");
  const args = api.sshArgs(api.validateConfig({ target: "user@server", port: 2222, identity: "/Users/test/key with spaces" }), "printf ok");
  assert.ok(args.includes("BatchMode=yes"));
  assert.ok(args.includes("StrictHostKeyChecking=yes"));
  assert.deepEqual(args.slice(-3), ["--", "user@server", "printf ok"]);
  assert.ok(args.includes("/Users/test/key with spaces"));
});

test("streams exact binary bytes through the real remote shell script and verifies hash", async (t) => {
  assert.equal(typeof api.uploadFile, "function");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-upload-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source ' 中文 ; $(false).bin");
  const bytes = Buffer.concat([Buffer.from([0, 255, 1, 128]), Buffer.alloc(1024 * 1024, 173)]);
  await fs.writeFile(source, bytes);
  let sent = 0;
  const result = await api.uploadFile({ path: source, name: path.basename(source), size: bytes.length },
    api.validateConfig({ target: "test", directory: path.join(root, "remote ' folder") }), {
      spawnSsh(args) { return spawn("/bin/sh", ["-c", args.at(-1)], { stdio: ["pipe", "pipe", "pipe"] }); },
      onProgress(count) { sent = count; },
    });
  assert.deepEqual(await fs.readFile(result.path), bytes);
  assert.equal(sent, bytes.length);
  assert.equal(result.size, bytes.length);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(path.basename(result.path), path.basename(source));
  assert.equal((await fs.stat(result.path)).mode & 0o777, 0o600);
});

test("reports SSH failures instead of claiming an upload succeeded", async (t) => {
  assert.equal(typeof api.uploadFile, "function");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-upload-fail-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "data");
  await fs.writeFile(source, "hello");
  await assert.rejects(api.uploadFile({ path: source, name: "data", size: 5 }, api.validateConfig({ target: "bad" }), {
    spawnSsh() { return spawn("/bin/sh", ["-c", "echo 'Permission denied (publickey)' >&2; exit 255"]); },
  }), /Permission denied/);
});

test("rejects mismatched remote checksum", async (t) => {
  assert.equal(typeof api.uploadFile, "function");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-upload-hash-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "data");
  await fs.writeFile(source, "hello");
  await assert.rejects(api.uploadFile({ path: source, name: "data", size: 5 }, api.validateConfig({ target: "bad" }), {
    spawnSsh() { return spawn("/bin/sh", ["-c", "cat >/dev/null; printf 'PI_UPLOAD_V1\\n/tmp/file\\n'; printf '%064d\\n' 0"]); },
  }), /checksum/i);
});

test("cancellation terminates a running upload promptly", async (t) => {
  assert.equal(typeof api.uploadFile, "function");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-upload-cancel-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "data");
  await fs.writeFile(source, "hello");
  const abort = new AbortController();
  const pending = api.uploadFile({ path: source, name: "data", size: 5 }, api.validateConfig({ target: "bad" }), {
    signal: abort.signal,
    spawnSsh() { return spawn("/bin/sh", ["-c", "exec sleep 30"]); },
  });
  setTimeout(() => abort.abort(), 30);
  await assert.rejects(pending, /cancel/i);
});

test("controller binds selected files to their original session and cancels safely", async () => {
  assert.equal(typeof api.createController, "function");
  let session = { sessionId: "session-a", projectPath: "/project" };
  let release;
  const controller = api.createController({
    getSession: async () => session,
    pickFiles: async () => new Promise((resolve) => { release = resolve; }),
  });
  const job = await controller.select();
  assert.equal(controller.poll(job.id).state, "selecting");
  session = { sessionId: "session-b", projectPath: "/project" };
  await assert.rejects(controller.start(job.id, { target: "server" }), /session/i);
  controller.cancel(job.id);
  release([]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.poll(job.id).state, "cancelled");
  controller.dispose();
});

test("controller rejects unselected paths and never exposes local absolute paths", async (t) => {
  assert.equal(typeof api.createController, "function");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-upload-controller-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "selected.txt");
  await fs.writeFile(source, "hello");
  const controller = api.createController({
    getSession: async () => ({ sessionId: "a", projectPath: "/project" }),
    pickFiles: async () => [source],
    uploadFile: async () => ({ path: "/remote/file", size: 5, sha256: "a".repeat(64) }),
  });
  const job = await controller.select();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const selected = controller.poll(job.id);
  assert.equal(selected.state, "selected");
  assert.equal(selected.files[0].name, "selected.txt");
  assert.equal(JSON.stringify(selected).includes(root), false);
  await assert.rejects(controller.start("invented", { target: "server" }), /job/i);
  await controller.start(job.id, { target: "server" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.poll(job.id).state, "done");
  assert.equal(controller.poll(job.id).results[0].path, "/remote/file");
  controller.dispose();
});

test("picker output preserves spaces and cannot split a newline filename into other paths", () => {
  assert.equal(typeof api.parsePickerOutput, "function");
  assert.deepEqual(api.parsePickerOutput("/tmp/a  \0/tmp/a\n/tmp/b\0\n"), ["/tmp/a  ", "/tmp/a\n/tmp/b"]);
});

test("timeouts terminate a stalled transport", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-upload-timeout-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "data");
  await fs.writeFile(source, "hello");
  await assert.rejects(api.uploadFile({ path: source, name: "data", size: 5 }, api.validateConfig({ target: "bad" }), {
    timeoutMs: 30,
    spawnSsh() { return spawn("/bin/sh", ["-c", "exec sleep 30"]); },
  }), /timed out/i);
});

test("split UTF-8 server output preserves the exact remote path", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-upload-unicode-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "data");
  await fs.writeFile(source, "hello");
  const hash = require("node:crypto").createHash("sha256").update("hello").digest("hex");
  const result = await api.uploadFile({ path: source, name: "data", size: 5 }, api.validateConfig({ target: "test" }), {
    spawnSsh() { return spawn("/bin/sh", ["-c", `cat >/dev/null; printf 'PI_UPLOAD_V1\\n/tmp/\\344'; sleep 0.02; printf '\\270\\255\\n${hash}\\n'`]); },
  });
  assert.equal(result.path, "/tmp/中");
});

test("workspace-bound uploads reject outside paths and symlink escapes", async (t) => {
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), "ssh-upload-boundary-"));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  const workspace=path.join(root,'workspace'),outside=path.join(root,'outside');
  await fs.mkdir(workspace);await fs.mkdir(outside);
  await fs.symlink(outside,path.join(workspace,'linked'));
  const source=path.join(root,'data');await fs.writeFile(source,'hello');
  assert.throws(()=>api.validateConfig({target:'test',directory:outside,workspaceRoot:workspace}),/workspace/i);
  await assert.rejects(api.uploadFile({path:source,name:'data',size:5},
    api.validateConfig({target:'test',directory:path.join(workspace,'linked'),workspaceRoot:workspace}),
    {spawnSsh:args=>spawn('/bin/sh',['-c',args.at(-1)])}),/outside.*workspace/i);
  assert.deepEqual(await fs.readdir(outside),[]);
});
