#!/usr/bin/env node
/** Real isolated Host process: explicit reads, scoped consent before mutation,
 * conversation reuse/revoke and no cross-session authority. No user files.
 */
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readNdjsonLines } from "../packages/shared/dist/ndjson.js";
import { Host, resolveHostBinary } from "./e2e/host.mjs";

const root = await mkdtemp(join(process.env.PI_SCRATCH_DIR || tmpdir(), "pi-external-access-"));
const project = join(root, "project");
await mkdir(project);
const outside = join(root, "outside.txt");
await writeFile(outside, "external-read-fixture\n");
const host = new Host(resolveHostBinary(), join(root, "data"));
const bus = new EventEmitter();
const notices = [];
let observer;
let shell;
const turns = new Map();
async function session() {
  const { session } = await host.call("session.create", { projectPath: project, mode: "agent" });
  await host.call("session.configure", { id: session.id, mode: "agent", permissionMode: "auto" });
  turns.set(session.id, (await host.call("session.beginTurn", { sessionId: session.id })).turnId);
  return session.id;
}
async function tool(sessionId, toolName, args) {
  return host.call("tools.execute", { sessionId, toolCallId: randomUUID(), turnId: turns.get(sessionId),
    toolName, args, mode: "agent", expectedCommandShellId: shell.id,
    expectedCommandShellDialect: shell.dialect }, 10000);
}
async function prompted(sessionId, toolName, args, decision) {
  const notice = once(bus, "permission");
  const operation = tool(sessionId, toolName, args);
  const request = await Promise.race([notice.then(([value]) => value), operation.then((result) => {
    throw new Error("Operation did not wait for explicit authorization: " + JSON.stringify(result));
  })]);
  assert.deepEqual(request.externalAccess, { kind: "filesystem-write" });
  if (args.path) await assert.rejects(access(args.path), "file was modified before explicit consent");
  await host.call("permissions.resolve", { requestId: request.requestId, decision });
  return operation;
}
try {
  await host.start(11);
  observer = readNdjsonLines(host.child.stdout, (line) => {
    const message = JSON.parse(line);
    if (message.method === "permissions.request") {
      notices.push(message.params); bus.emit("permission", message.params);
    }
  });
  shell = (await host.call("commandShells.list")).effective;
  const a = await session();
  assert.equal((await tool(a, "Read", { path: outside })).ok, true);
  assert.equal((await tool(a, "Grep", { path: outside, pattern: "external-read" })).ok, true);
  assert.equal((await tool(a, "Glob", { path: root, pattern: "outside.txt" })).ok, true);
  assert.equal(notices.length, 0, "explicit reads and searches never request write authority");
  const written = join(root, "written.txt");
  assert.equal((await prompted(a, "Write", { path: written, content: "before\n" }, "allow-session")).ok, true);
  assert.equal(await readFile(written, "utf8"), "before\n");
  const read = await tool(a, "Read", { path: written });
  assert.equal((await tool(a, "Edit", { path: written, tag: read.content.tag, ops: "PUT 1.=1:\n+after" })).ok, true);
  assert.match(await readFile(written, "utf8"), /^after/);
  assert.equal((await tool(a, "Write", { path: join(root, "second.txt"), content: "second" })).ok, true);
  if (shell.dialect === "posix") {
    assert.equal((await tool(a, "Bash", { command: `printf shell > '${join(root, "shell.txt")}'` })).ok, true);
    assert.equal(await readFile(join(root, "shell.txt"), "utf8"), "shell");
  }
  assert.equal(notices.length, 1, "one grant covers subsequent native external changes");
  const b = await session();
  const denied = join(root, "denied.txt");
  assert.equal((await prompted(b, "Write", { path: denied, content: "denied" }, "deny")).ok, false);
  await assert.rejects(access(denied));
  await host.call("permissions.clearSessionGrants", { sessionId: a });
  const revoked = join(root, "revoked.txt");
  assert.equal((await prompted(a, "Write", { path: revoked, content: "revoked" }, "deny")).ok, false);
  await assert.rejects(access(revoked));
  assert.equal(notices.length, 3);
  console.log("PASS E2E-SECURITY-external-filesystem-consent: free reads, pre-write Auto consent, one grant, Edit/Write/Bash reuse, deny, revoke and session isolation");
} finally {
  observer?.close(); await host.stop(); await rm(root, { recursive: true, force: true });
}
