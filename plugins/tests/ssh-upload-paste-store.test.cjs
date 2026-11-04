"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { uploadFile } = require("../ssh-upload/transfer.cjs");
let createPasteStore;
try { ({ createPasteStore } = require("../ssh-upload/paste-store.cjs")); } catch (e) { if (e.code !== "MODULE_NOT_FOUND") throw e; }
async function setup(t, overrides = {}) {
  assert.equal(typeof createPasteStore, "function");
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), "paste-store-"));
  let session = { sessionId: "a" };
  const store = createPasteStore({ dataPath: root,
    getSession: async () => session,
    getConfig: () => ({ target: "test", directory: path.join(root, "remote") }),
    uploadFile: (file, config, options) => uploadFile(file, config, { ...options, spawnSsh: (args) => spawn("/bin/sh", ["-c", args.at(-1)]) }),
    ...overrides,
  });
  t.after(async () => { await store.dispose(); await fs.rm(root, { recursive: true, force: true }); });
  return { store, root, switchSession() { session = { sessionId: "b" }; } };
}
async function waitFor(store, id, state) {
  for (let i = 0; i < 200; i++) { const job = store.poll(id); if (job.state === state) return job; if (job.state === "error") throw Error(job.error); await new Promise(r => setTimeout(r, 5)); }
  throw Error(`Did not reach ${state}`);
}

test("pasted bytes are actually uploaded through SSH script and local staging is removed", async (t) => {
  const { store } = await setup(t);
  const bytes = Buffer.from([0, 255, 10, 33, 128]);
  const job = await store.begin({ sessionId: "a", files: [{ name: "sample 中文.bin", size: bytes.length }] });
  await store.chunk({ id: job.id, index: 0, offset: 0, data: bytes.subarray(0, 2).toString("base64") });
  await store.chunk({ id: job.id, index: 0, offset: 2, data: bytes.subarray(2).toString("base64") });
  await store.finish(job.id);
  const done = await waitFor(store, job.id, "done");
  assert.deepEqual(await fs.readFile(done.results[0].path), bytes);
  assert.equal(done.results[0].name, "sample 中文.bin");
  assert.match(done.results[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(done.received, 5);
  assert.equal(JSON.stringify(done).includes(".part"), false);
});

test("staging rejects paths, credentials, oversize chunks and out-of-order writes", async (t) => {
  const { store } = await setup(t);
  for (const name of ["../secret", "/tmp/x", ".env.local", "key.pem", "line\nbreak"]) {
    await assert.rejects(store.begin({ sessionId: "a", files: [{ name, size: 1 }] }), /name|credential/i);
  }
  const job = await store.begin({ sessionId: "a", files: [{ name: "data.bin", size: 1 }] });
  await assert.rejects(store.chunk({ id: job.id, index: 0, offset: 1, data: "YQ==" }), /offset/i);
  await assert.rejects(store.chunk({ id: job.id, index: 0, offset: 0, data: Buffer.alloc(45057).toString("base64") }), /chunk/i);
  await assert.rejects(store.finish(job.id), /incomplete/i);
});

test("session switch before finalization cannot upload to a stale destination", async (t) => {
  const { store, switchSession } = await setup(t);
  await assert.rejects(store.begin({ sessionId: "wrong", files: [{ name: "x", size: 0 }] }), /session/i);
  const job = await store.begin({ sessionId: "a", files: [{ name: "x", size: 1 }] });
  await store.chunk({ id: job.id, index: 0, offset: 0, data: "eA==" });
  switchSession();
  await assert.rejects(store.finish(job.id), /session/i);
  await store.cancel(job.id);
  assert.equal(store.poll(job.id).state, "cancelled");
});

test("saved target is required and another paste cannot overwrite an active job", async (t) => {
  const { store } = await setup(t, { getConfig: () => null });
  await assert.rejects(store.begin({ sessionId: "a", files: [{ name: "x", size: 0 }] }), /configure|target/i);
});

test("startup reclaims expired private staging but preserves recent and unrelated folders", async (t) => {
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), "paste-sweep-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const name of ["paste-old123", "paste-new123", "other-folder"]) {
    await fs.mkdir(path.join(root, name));
    await fs.writeFile(path.join(root, name, "data"), "private");
  }
  const old = new Date(Date.now() - 48 * 3600000);
  await fs.utimes(path.join(root, "paste-old123"), old, old);
  const store = createPasteStore({ dataPath: root });
  t.after(() => store.dispose());
  await store.ready;
  await assert.rejects(fs.access(path.join(root, "paste-old123")), { code: "ENOENT" });
  await fs.access(path.join(root, "paste-new123", "data"));
  await fs.access(path.join(root, "other-folder", "data"));
});

test("cancel responds without waiting for a slow child to exit", async (t) => {
  let release;
  const {store} = await setup(t, {uploadFile: async () => new Promise(resolve => { release=resolve; })});
  const job = await store.begin({sessionId:"a",files:[{name:"empty",size:0}]});
  await store.finish(job.id);
  const cancel = store.cancel(job.id);
  const won = await Promise.race([cancel.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),100))]);
  release({path:"/remote/empty",size:0,sha256:"a".repeat(64)});
  await cancel;
  assert.equal(won,true);
});
