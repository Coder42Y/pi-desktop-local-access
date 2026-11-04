#!/usr/bin/env node
/** Isolated Chromium + real RACP WebSocket/filesystem acceptance. No user SSH/app. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire, register } from "node:module";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

register(new URL("../apps/desktop/test/helpers/ts-import-hooks.mjs", import.meta.url));
const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(join(root, "apps/desktop/package.json"));
const { build } = createRequire(join(root, "packages/agent-runtime/package.json"))("esbuild");
const { WebSocket } = require("ws");
const { createWorkspaceFiles } = await import("../apps/pi-host/dist/workspace-files.js");
const { createHostOperations } = await import("../apps/pi-host/dist/host-operations.js");
const { bindRacpWebSocket, wsClientTransport, RacpClient } = await import("../packages/racp/dist/index.js");
const { harness, OWNER_TOKEN, VIEWER_TOKEN } = await import("../packages/racp/dist/test-harness.js");
const { createRemoteBackend } = await import("../apps/desktop/electron/main/remote/remote-backend.ts");
const { createBackendRouter } = await import("../apps/desktop/electron/main/remote/backend-router.ts");
const { IPC, RACP_WS_PATH } = await import("../packages/shared/dist/index.js");
const { catalogs } = await import("../packages/i18n/dist/index.js");
const temp = await mkdtemp(join(process.env.PI_SCRATCH_DIR || tmpdir(), "pi-ssh-preview-e2e-"));
let browser, browserExited, socket, http, binding, owner, viewer, racp;
let releaseSlow, slowStarted, slowFinished;
let holdSlow = false;
const slowSeen = new Promise(r => { slowStarted = r; });
const slowDone = new Promise(r => { slowFinished = r; });
const slowGate = new Promise(r => { releaseSlow = r; });
try {
  const workspace = join(temp, "project"), outside = join(temp, "outside");
  await mkdir(workspace); await mkdir(outside);
  const config = { workspace, note: join(outside, "note.txt"), image: join(outside, "tiny.png"), missing: join(outside, "missing.txt"), denied: join(outside, "denied.txt"), slow: join(outside, "slow.txt") };
  await writeFile(join(workspace, "project.txt"), "PROJECT_ONLY");
  await writeFile(join(workspace, "sibling.txt"), "SYNTHETIC_PROJECT_SIBLING");
  await writeFile(config.denied, "synthetic denied text"); await chmod(config.denied, 0);
  await writeFile(config.note, "SYNTHETIC_EXTERNAL_TEXT"); await writeFile(config.slow, "SYNTHETIC_LATE_RESPONSE");
  await writeFile(config.image, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"));
  const host = { async call(method, params) {
    assert.equal(method, "session.get");
    return { session: ["one", "two"].includes(params.id) ? { id: params.id, projectPath: workspace } : null };
  } };
  const operations = createHostOperations({ getHost: () => host, runtime: { compact: async () => ({ accepted: true }), isBusy: () => false } });
  racp = await harness({ operations: { workspace: operations.workspace, workspaceFiles: createWorkspaceFiles() } });
  binding = await bindRacpWebSocket({ server: racp.server, authenticator: racp.authenticator, port: 0, log() {} });
  const connect = async (token) => {
    const client = new RacpClient({ transport: wsClientTransport({ url: `ws://127.0.0.1:${binding.address.port}${RACP_WS_PATH}`, token }), client: { name: "preview-test", version: "0.21.0" }, requestTimeoutMs: 10000 });
    await client.connect(); return client;
  };
  owner = await connect(OWNER_TOKEN); viewer = await connect(VIEWER_TOKEN);
  await assert.rejects(viewer.request("workspace/preview", { sessionId: "one", operation: "read", ref: config.note }), { code: "FORBIDDEN" });
  assert.equal((await viewer.request("workspace/read", { sessionId: "one", path: "project.txt" })).content, "PROJECT_ONLY");
  await assert.rejects(viewer.request("workspace/read", { sessionId: "one", path: config.note }));
  await assert.rejects(owner.request("workspace/files", { path: workspace, operation: "list", ref: outside }));
  const router = createBackendRouter();
  const backend = createRemoteBackend({ hostKey: "fixture", client: owner });
  for (const id of ["one", "two"]) router.registerBackend(`remote:fixture:${id}`, backend);
  await build({ entryPoints: [join(root, "scripts/e2e/ssh-external-preview.jsx")], outfile: join(temp, "fixture.js"), bundle: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": JSON.stringify({ DEV: false, MODE: "test" }) }, loader: { ".css": "empty", ".gif": "dataurl", ".png": "dataurl" },
    alias: { "@pi-desktop/shared": join(root, "packages/shared/src/index.ts"), "@pi-desktop/i18n": join(root, "packages/i18n/src/index.ts"), react: join(root, "apps/desktop/node_modules/react"), "react-dom": join(root, "apps/desktop/node_modules/react-dom"), "react-i18next": join(root, "apps/desktop/node_modules/react-i18next"), i18next: join(root, "apps/desktop/node_modules/i18next") },
    nodePaths: [join(root, "apps/desktop/node_modules")], plugins: [{ name: "fixture-url", setup(b) { b.onResolve({ filter: /\?url$/ }, ({ path }) => ({ path, namespace: "url" })); b.onLoad({ filter: /.*/, namespace: "url" }, ({ path }) => ({ contents: `export default ${JSON.stringify(path)};` })); } }],
  });
  const fixture = await readFile(join(temp, "fixture.js"));
  http = createServer((req, res) => { void (async () => {
    if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(fixture); return; }
    if (req.url !== "/rpc") { res.setHeader("Content-Type", "text/html"); res.end(`<div id="root"></div><script>globalThis.fixtureConfig=${JSON.stringify(config)}</script><script src="/fixture.js"></script>`); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const { mode, channel, args } = JSON.parse(Buffer.concat(chunks).toString());
    let data;
    const input = args[0] || {};
    const slow = holdSlow && channel === IPC.invoke.fsRead && input.path === config.slow;
    if (slow) { slowStarted(); await slowGate; }
    try {
      if (mode === "legacy") data = (await router.route(channel, args)).value;
      else {
        const operation = ({ [IPC.invoke.fsResolveRef]: "resolve", [IPC.invoke.fsRead]: "read", [IPC.invoke.fsReadImageDataUrl]: "image", [IPC.invoke.fsList]: "list" })[channel];
        if (!operation) throw new Error("Unexpected local operation");
        data = await owner.request("workspace/files", { path: workspace, operation, ref: input.ref ?? input.path ?? "", ...(input.mimeType ? { mimeType: input.mimeType } : {}) });
      }
      res.end(JSON.stringify({ ok: true, data }));
    } catch (e) { res.end(JSON.stringify({ ok: false, error: { code: e.code || e.errorCode || "INTERNAL", message: e.message } })); }
    finally { if (slow) slowFinished(); }
  })().catch(e => { res.statusCode = 500; res.end(JSON.stringify({ error: String(e) })); }); });
  await new Promise(r => http.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${http.address().port}`;
  browser = spawn(process.env.PI_CHROMIUM_EXECUTABLE || "chromium", ["--headless=new", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${join(temp, "profile")}`, "--no-first-run", "--disable-background-networking", "--disable-component-update", "--disable-sync", "about:blank"], { detached: process.platform !== "win32", stdio: ["ignore", "ignore", "pipe"] });
  browserExited = new Promise(resolve => browser.once("exit", resolve));
  const devtools = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("isolated Chromium startup timed out")), 15000);
    let output = ""; browser.stderr.on("data", chunk => { output += chunk; const m = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (m) { clearTimeout(timer); resolve(m[1]); } });
    browser.once("error", reject); browser.once("exit", code => { clearTimeout(timer); reject(new Error(`isolated Chromium exited: ${code}`)); });
  });
  socket = new WebSocket(devtools); await new Promise((r,j) => { socket.once("open",r); socket.once("error",j); });
  let sequence = 0; const pending = new Map(); const events = new Map();
  socket.on("message", bytes => { const m = JSON.parse(bytes.toString()); if (m.id) { const p = pending.get(m.id); if (!p) return; pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } else events.get(m.method)?.(m); });
  const send = (method, params = {}, sessionId) => new Promise((resolve,reject) => { const id = ++sequence; pending.set(id,{resolve,reject}); socket.send(JSON.stringify({ id,method,params,...(sessionId ? {sessionId}: {}) })); });
  const target = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  const loaded = new Promise(r => events.set("Page.loadEventFired", r));
  await send("Page.navigate", { url }, sessionId); await loaded;
  const evaluate = async expression => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId); if (r.exceptionDetails) {
      const debug = await send("Runtime.evaluate", { expression: "JSON.stringify({toast:globalThis.lastToast,text:document.body.innerText,calls:globalThis.previewProbe?.calls()})", returnByValue: true }, sessionId);
      assert.fail(JSON.stringify({ expression, exception:r.exceptionDetails, fixture:debug.result.value }));
    } return r.result.value; };
  for (const mode of ["legacy", "workspace"]) {
    await evaluate(`previewProbe.initialize(${JSON.stringify(mode)})`);
    assert.equal(await evaluate("previewProbe.text()"), true);
    if (mode === "legacy") { await evaluate("previewProbe.back()"); await evaluate("previewProbe.sibling()"); await evaluate("previewProbe.back()"); }
    assert.equal(await evaluate("previewProbe.image()"), true);
    if (mode === "legacy") { await evaluate("previewProbe.back()"); await evaluate("previewProbe.denied()"); await evaluate("previewProbe.back()"); await evaluate("previewProbe.sibling()"); }
    assert.equal(await evaluate("previewProbe.missing()"), catalogs.en.chat.fileRefMissing.replace("{{name}}", config.missing));
    assert.equal(await evaluate("previewProbe.native()"), 0);
    console.log(`${mode}: text/image click-to-display, missing file and native-open denial PASS`);
  }
  await evaluate('previewProbe.initialize("legacy")'); holdSlow = true;
  await evaluate("previewProbe.slow()"); await slowSeen;
  await evaluate('previewProbe.initialize("legacy", "two")'); releaseSlow(); await slowDone;
  assert.equal(await evaluate("previewProbe.settled()"), true);
  await owner.close(); owner = null;
  await assert.rejects(backend.invoke(IPC.invoke.fsResolveRef, [{ sessionId: "remote:fixture:one", ref: config.note }]));
  console.log("Owner/viewer isolation, stale-session result rejection and disconnected-host no-fallback PASS");
} finally {
  releaseSlow?.();
  socket?.terminate();
  const terminate = signal => {
    if (!browser?.pid) return;
    try {
      if (process.platform !== "win32") process.kill(-browser.pid, signal);
      else browser.kill(signal);
    } catch (e) { if (e.code !== "ESRCH") throw e; }
  };
  terminate("SIGTERM");
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    const force = setTimeout(() => terminate("SIGKILL"), 5000);
    await browserExited; clearTimeout(force);
  }
  await owner?.close(); await viewer?.close(); await binding?.close(); racp?.server.close();
  if (http) await new Promise(r => http.close(r));
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
