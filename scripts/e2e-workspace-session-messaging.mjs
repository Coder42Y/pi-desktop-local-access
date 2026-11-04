#!/usr/bin/env node
/** Public tool RPC -> real Rust process/ledger/transcript. Agent execution is
 * driven explicitly; runtime HTTP/SSE and Main admission are tested separately.
 * No Desktop instance, user data, provider credentials or paid requests.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host, resolveHostBinary } from "./e2e/host.mjs";

const scenario = "E2E-SESSION-workspace-messaging";
const data = mkdtempSync(join(tmpdir(), "pi-workspace-messages-"));
const project = mkdtempSync(join(tmpdir(), "pi-message-project-"));
const foreignProject = mkdtempSync(join(tmpdir(), "pi-message-foreign-"));
const host = new Host(resolveHostBinary(), data);
const turns = new Map();
const row = (role, content) => ({ id: randomUUID(), role, content,
  createdAt: new Date().toISOString(), status: "complete" });
async function session(title, projectPath = project) {
  const { session } = await host.call("session.create", { title, projectPath, mode: "agent" });
  await host.call("session.configure", { id: session.id, mode: "agent", permissionMode: "auto" });
  return session.id;
}
async function begin(sessionId, message) {
  const { turnId } = await host.call("session.beginTurn", { sessionId,
    ...(message ? { sessionMessageId: message.id } : {}) });
  turns.set(sessionId, turnId);
  if (message) await host.call("session.appendMessage", {
    sessionId, turnId, message: row("user", message.content),
  });
  return turnId;
}
async function finish(sessionId, text) {
  const turnId = turns.get(sessionId);
  await host.call("session.appendMessage", { sessionId, turnId, message: row("assistant", text) });
  await host.call("session.endTurn", { turnId, status: "completed", createNotification: false });
  turns.delete(sessionId);
  return host.call("session.collaboration.settle", { turnId });
}
async function tool(sessionId, toolName, args, toolCallId = randomUUID()) {
  return host.call("tools.execute", { sessionId, turnId: turns.get(sessionId), toolCallId,
    toolName, args, mode: "agent" });
}
function success(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.content;
}
try {
  await host.start(11);
  const a = await session("A coordinator");
  const b = await session("B independent");
  const outside = await session("Foreign", foreignProject);
  await begin(a);
  const list = success(await tool(a, "SessionList", {}));
  assert.ok(list.sessions.some((item) => item.id === b));
  assert.ok(!list.sessions.some((item) => item.id === outside || item.id === a));

  await begin(b);
  await host.call("session.appendMessage", {
    sessionId: b, turnId: turns.get(b), message: row("user", "B history marker"),
  });
  await finish(b, "B saved result");
  await host.call("session.rename", { id: b, title: "接口排查" });
  await host.call("session.rename", { id: outside, title: "接口排查" });
  const currentName = success(await tool(a, "SessionList", { name: "接口排查" }));
  assert.equal(currentName.resolution, "unique");
  assert.equal(currentName.sessions[0].id, b);
  assert.equal(currentName.sessions.length, 1, "same name in another workspace must not be a match");
  const former = success(await tool(a, "SessionList", { name: "B independent" }));
  assert.equal(former.resolution, "not_found");
  const duplicate = await session("接口排查");
  const ambiguous = await tool(a, "SendMessage", { sessionName: "接口排查", content: "Do not guess" });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.errorCode, "CONFLICT");
  assert.equal(ambiguous.content.candidates.length, 2);
  await host.call("session.rename", { id: duplicate, title: "Other work" });
  const count = (await host.call("session.list", {})).sessions.length;
  const missing = await tool(a, "SendMessage", { sessionName: "Missing conversation", content: "No implicit create" });
  assert.equal(missing.ok, false);
  assert.equal(missing.errorCode, "NOT_FOUND");
  assert.equal(missing.content.resolution, "not_found");
  assert.equal((await host.call("session.list", {})).sessions.length, count);
  const history = success(await tool(a, "SessionRead", { sessionName: "接口排查", limit: 1 }));
  assert.equal(history.sessionId, b);
  assert.equal(history.messages.length, 1);
  assert.equal(history.messages[0].content, "B saved result");
  assert.equal(history.hasMoreBefore, true);
  const older = success(await tool(a, "SessionRead", { sessionId: b, before: history.messageStart, limit: 1 }));
  assert.equal(older.messages[0].content, "B history marker");
  assert.equal((await tool(a, "SessionRead", { sessionId: outside })).ok, false);
  assert.equal((await tool(a, "SendMessage", { sessionId: outside, content: "No" })).ok, false);

  const sent = success(await tool(a, "SendMessage", { sessionName: "接口排查", content: "Review the phase" }, "stable-send"));
  assert.equal(sent.message.targetSessionId, b);
  assert.equal(sent.message.notifyOnCompletion, false);
  assert.equal(success(await tool(a, "SendMessage", { sessionId: b, content: "Review the phase" }, "stable-send")).message.id, sent.message.id);
  assert.equal(sent.message.sourceSessionId, a);
  assert.equal(sent.message.pluginId, "host:workspace-sessions");
  let pending = await host.call("session.collaboration.pending", {});
  assert.ok(pending.messages.some((message) => message.id === sent.message.id));
  await host.call("session.rename", { id: b, title: "接口排查·下一阶段" });
  assert.equal((await tool(a, "SessionRead", { sessionName: "接口排查" })).ok, false);
  assert.equal(success(await tool(a, "SessionRead", { sessionName: "接口排查·下一阶段" })).sessionId, b);
  await begin(b, sent.message);
  assert.equal((await tool(b, "SessionReport", { state: "waiting_input", content: "Unrequested report" })).ok, false);
  assert.equal((await finish(b, "Independent response")).callback, null);

  const spawned = success(await tool(a, "SessionSpawn", { task: "Check the next phase", title: "Bound worker" }));
  const worker = spawned.sessionId;
  assert.equal(spawned.message.notifyOnCompletion, true);
  await begin(worker, spawned.message);
  const report = success(await tool(worker, "SessionReport", { state: "waiting_input", content: "Which endpoint?" }));
  assert.equal(report.message.targetSessionId, a);
  assert.equal(report.message.notifyOnCompletion, false);
  assert.deepEqual(JSON.parse(report.message.content), { state: "waiting_input", content: "Which endpoint?" });
  assert.equal(report.message.status, "queued", "A still owns its running turn");
  const complete = await finish(worker, "Phase checked");
  assert.equal(complete.callback.targetSessionId, a);
  assert.equal(complete.callback.notifyOnCompletion, false);
  assert.equal(complete.callback.replyToMessageId, spawned.message.id);
  const repeated = await host.call("session.collaboration.settle", { turnId: complete.callback.content && JSON.parse(complete.callback.content).turnId });
  assert.equal(repeated.callback.id, complete.callback.id);
  pending = await host.call("session.collaboration.pending", { sessionId: a });
  assert.ok(pending.messages.some((message) => message.id === report.message.id));
  assert.ok(pending.messages.some((message) => message.id === complete.callback.id));
  assert.ok(host.notifications.some((notice) => notice.method === "session.collaboration.changed"));
  await finish(a, "Coordinator continues");

  await begin(a, report.message);
  const restored = success(await tool(a, "SessionRead", { sessionId: worker, limit: 20 }));
  assert.ok(restored.messages.some((message) => message.content === "Phase checked"));
  assert.ok(restored.messages.some((message) => message.sessionMessage?.sourceSessionId === a),
    "history retains authenticated agent provenance instead of pretending the task was human input");
  assert.equal((await finish(a, "Here is the requested endpoint")).callback, null);
  await begin(a, complete.callback);
  assert.equal((await finish(a, "Result incorporated")).callback, null);
  console.log(`PASS ${scenario}: discovery/read/send/spawn/report/callback, workspace isolation and idempotency`);
} finally {
  await host.stop();
  for (const path of [data, project, foreignProject]) rmSync(path, { recursive: true, force: true });
}
