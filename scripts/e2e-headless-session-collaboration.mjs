#!/usr/bin/env node
/** Real startPiHost composition + Rust/sidecar, isolated HOME and local SSE.
 * Accepted native sends/spawns must execute and return durable reports/results.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Host, resolveHostBinary } from "./e2e/host.mjs";

const root = await mkdtemp(join(process.env.PI_SCRATCH_DIR || tmpdir(), "pi-headless-collab-"));
const data = join(root, "data"), project = join(root, "project"), home = join(root, "home");
await mkdir(data, { mode: 0o700 }); await mkdir(project); await mkdir(home);
await writeFile(join(project, "README.md"), "HEADLESS_NATIVE_CONTEXT");
process.env.HOME = home; process.env.USERPROFILE = home;
const { startPiHost } = await import("../apps/pi-host/dist/app.js");
const prep = new Host(resolveHostBinary(), data);
const owner = { subject: "fixture-owner", roles: ["owner"], pairedDevice: true };
const reports = new Map();
const completedWorkers = new Set();
const nativeCalls = { SessionSpawn: 0, SendMessage: 0, SessionReport: 0 };
let coordinator, existingWorker, app, sourceEnds = 0, fixtureError;
let resolveDone, rejectDone;
const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
// The cleanup path below observes the rejection even if startup fails first.
done.catch(() => {});
function text(content) { return typeof content === "string" ? content : content.map(block => block.text || "").join("\n"); }
const model = createServer(async (request, response) => {
  try {
    let body = ""; for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    const current = text(input.messages.filter(message => message.role === "user").at(-1).content);
    const incoming = current.includes("[Session communication")
      ? JSON.parse(current.split("\n").find(line => line.startsWith("{"))) : undefined;
    const calls = input.messages.flatMap(message => message.tool_calls || []).map(call => call.function.name);
    const available = new Set((input.tools || []).map(tool => tool.function.name));
    let call, result;
    const ensure = (name, args) => available.has(name) ? { name, args } : { name: "ToolSearch", args: { query: name } };
    const phaseReport = incoming?.kind === "message" && incoming.content.startsWith("{")
      && JSON.parse(incoming.content).state === "phase_completed";
    if (incoming && (incoming.kind === "completion" || phaseReport)) {
      reports.set(incoming.messageId, incoming.kind);
      result = "HEADLESS_COORDINATOR_ACK";
    } else if (incoming) {
      assert.ok(["worker-send", "worker-spawn"].includes(incoming.content));
      if (!calls.includes("Read")) call = { name: "Read", args: { path: "README.md" } };
      else if (!calls.includes("SessionReport")) {
        assert.ok(JSON.stringify(input.messages).includes("HEADLESS_NATIVE_CONTEXT"));
        call = ensure("SessionReport", { state: "phase_completed", content: "HEADLESS_PHASE_REPORT" });
      } else result = "HEADLESS_WORKER_DONE";
    } else {
      assert.ok(current.includes("HEADLESS_COORDINATOR"));
      if (!calls.includes("SessionSpawn")) call = ensure("SessionSpawn", { task: "worker-spawn", notifyOnCompletion: true });
      else if (!calls.includes("SendMessage")) call = ensure("SendMessage", { sessionId: existingWorker, content: "worker-send", notifyOnCompletion: true });
      else result = "HEADLESS_COORDINATOR_STARTED";
    }
    if (call && Object.hasOwn(nativeCalls, call.name)) nativeCalls[call.name]++;
    response.writeHead(200, { "content-type": "text/event-stream" });
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { role: "assistant", content: result };
    response.end(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1,
      model: input.model, choices: [{ index: 0, delta, finish_reason: call ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
  } catch (error) {
    fixtureError = error; rejectDone(error);
    if (!response.headersSent) response.writeHead(400); response.end();
  }
});
model.listen(0, "127.0.0.1"); await once(model, "listening");
let deadline;
const logErrors = [];
try {
  await prep.start(11);
  const created = await prep.call("providers.create", { name: "Headless fixture", vendorKey: "custom",
    type: "openai_compatible", protocol: "openai_compatible", baseUrl: `http://127.0.0.1:${model.address().port}/v1`,
    authKind: "none", defaultModelId: "headless-fixture", apiStyle: "chat_completions" });
  const providerId = created.provider.id;
  async function session(title) {
    const { session } = await prep.call("session.create", { title, mode: "agent", projectPath: project, providerId, modelId: "headless-fixture" });
    await prep.call("session.configure", { id: session.id, mode: "agent", permissionMode: "auto" });
    return session.id;
  }
  coordinator = await session("Coordinator"); existingWorker = await session("Existing worker");
  await prep.stop();
  const logger = (level, message, details) => {
    if (level === "error") logErrors.push({ message, code: details?.errorCode });
  };
  logger.child = () => () => {};
  app = await startPiHost({ dataDir: data, host: "127.0.0.1", port: 0,
    hostCoreBinary: resolveHostBinary(), sidecarEntry: fileURLToPath(new URL("../packages/agent-runtime/dist/sidecar.js", import.meta.url)),
    nodeBinary: process.execPath, pair: false, pairingLifetimeMs: 60000, browseRoot: project, logLevel: "error" }, { log: logger });
  app.runtime.onEvent(envelope => { if (envelope.event.type === "error") rejectDone(new Error(JSON.stringify(envelope.event.error))); });
  app.runtime.onTurnEnded(info => {
    if (info.reason !== "completed" || !info.settled) { rejectDone(new Error(`Headless turn did not settle: ${info.reason}`)); return; }
    if (info.sessionId === coordinator) sourceEnds++;
    else completedWorkers.add(info.sessionId);
    if (completedWorkers.size === 2 && sourceEnds === 5 && reports.size === 4) resolveDone();
  });
  deadline = setTimeout(() => rejectDone(new Error(`Native headless deliveries did not complete: workers=${completedWorkers.size}, coordinatorTurns=${sourceEnds}, receipts=${reports.size}`)), 20000);
  await app.agentHost.startTurn(owner, { sessionId: coordinator, input: { text: "HEADLESS_COORDINATOR: spawn worker-spawn and send worker-send to the existing worker; return phase reports and results here." }, context: { requestId: "headless-native-start" } });
  await done;
  assert.equal(fixtureError, undefined);
  assert.deepEqual(nativeCalls, { SessionSpawn: 1, SendMessage: 1, SessionReport: 2 });
  assert.equal([...reports.values()].filter(kind => kind === "completion").length, 2);
  assert.equal([...reports.values()].filter(kind => kind === "message").length, 2);
  assert.equal(await app.runtime.flushTranscript(), true);
  const history = await app.agentHost.history(owner, { sessionId: coordinator, limit: 100 });
  const origins = history.items.map(item => item.content.sessionMessage).filter(Boolean);
  assert.equal(origins.filter(origin => origin.kind === "completion").length, 2);
  assert.equal(origins.filter(origin => origin.kind === "message").length, 2);
  assert.deepEqual(logErrors, []);
  console.log("PASS E2E-SESSION-headless-native-collaboration: real pi-host send/spawn execute, read context, report phases and settle exactly two completion callbacks");
} finally {
  clearTimeout(deadline); await app?.stop(); await prep.stop();
  model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
  await rm(root, { recursive: true, force: true });
}
