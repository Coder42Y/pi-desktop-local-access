import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import test from "node:test";
import ts from "typescript";

// Same loader as session-collaboration-ipc.test.mjs: transpile the Electron-main
// module to CommonJS and inject its value imports.
function load(relative, imports) {
  const file = new URL(relative, import.meta.url);
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: file.pathname,
  });
  const module = { exports: {} };
  new Function("require", "exports", "module", outputText)((id) => {
    assert.ok(Object.hasOwn(imports, id), `unexpected session collaboration dependency: ${id}`);
    return imports[id];
  }, module.exports, module);
  return module.exports;
}

// The real model helpers, not a stub: the opt-in flag has to survive the whole
// way from `providers.list` through the plugin model list into the spawn
// decision, and a hand-written stub would prove only the last step.
const pluginAgentComplete = load("../electron/main/plugin-agent-complete.ts", {
  "@pi-desktop/agent-runtime": await import("@pi-desktop/agent-runtime"),
  "@pi-desktop/shared": await import("@pi-desktop/shared"),
});

const { createSessionCollaborationService } = load("../electron/main/services/session-collaboration.ts", {
  "node:crypto": crypto,
  "@pi-desktop/host-runtime": await import("@pi-desktop/host-runtime"),
  "../agent-host-bridge": { DESKTOP_PRINCIPAL: { subject: "desktop", roles: ["owner"], pairedDevice: true } },
  "../plugin-agent-complete": pluginAgentComplete,
});

function createHost(name, respond = () => ({})) {
  const calls = [];
  return {
    name,
    calls,
    async call(method, params) {
      calls.push({ method, params });
      return respond(method, params);
    },
  };
}

function methodCalls(host, method) {
  return host.calls.filter((entry) => entry.method === method);
}

function sessionMessage(overrides = {}) {
  return {
    id: "message-1",
    pluginId: "demo-plugin",
    sourceSessionId: "source-session",
    targetSessionId: "target-session",
    content: "Please review the diff",
    kind: "message",
    status: "queued",
    ...overrides,
  };
}

function createService(overrides = {}) {
  const logs = [];
  const changes = [];
  const deps = {
    getHost: overrides.getHost ?? (() => overrides.host ?? null),
    getSidecar: () => (overrides.sidecar === undefined ? {} : overrides.sidecar),
    getBridge: () => overrides.bridge ?? null,
    getActiveTurn: (sessionId) => (overrides.activeTurns ?? {})[sessionId],
    flushTranscript: overrides.flushTranscript ?? (async () => true),
    isPluginLoaded: () => overrides.pluginLoaded ?? true,
    isQuitting: () => overrides.quitting ?? false,
    onChanged: () => changes.push({}),
    log: (message, data) => logs.push({ message, data }),
  };
  return { service: createSessionCollaborationService(deps), logs, changes };
}

function invokeSessionSend(service, args) {
  return service.invoke({
    operation: "session/collaboration/send",
    source: "plugin",
    args: [args],
    pluginContext: {
      pluginId: "demo-plugin",
      sessionId: "source-session",
      turnId: "turn-1",
      invocationId: "invocation-1",
    },
  });
}

test("a settlement arriving during an in-flight drain is settled by that same drain", async () => {
  let service;
  let pendingCalls = 0;
  let lateSettle;
  const host = createHost("host-1", async (method) => {
    if (method !== "session.collaboration.pending") return {};
    pendingCalls += 1;
    if (pendingCalls === 1) {
      // This pass has already read the settlements, so only a re-armed pass can
      // pick this arrival up.
      lateSettle = service.settle("worker-session", "turn-late").catch(() => {});
      // Let settle() reach drain() while this pass is still in flight.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    }
    return { messages: [] };
  });
  service = createService({ getHost: () => host }).service;

  await service.drain();
  await lateSettle;

  assert.equal(pendingCalls, 2, "the drain loop must re-read the outbox after a late settlement");
  assert.deepEqual(
    methodCalls(host, "session.collaboration.settle").map((entry) => entry.params),
    [{ turnId: "turn-late" }],
  );
});

test("a settlement recorded against a previous host is settled on the current host", async () => {
  const previous = createHost("host-1", () => ({ messages: [] }));
  const current = createHost("host-2", () => ({ messages: [] }));
  let host = previous;
  let flush = false;
  const { service } = createService({ getHost: () => host, flushTranscript: async () => flush });

  await service.settle("worker-session", "turn-old");
  assert.equal(methodCalls(previous, "session.collaboration.settle").length, 0);

  host = current;
  flush = true;
  await service.drain();
  assert.deepEqual(
    methodCalls(current, "session.collaboration.settle").map((entry) => entry.params),
    [{ turnId: "turn-old" }],
  );

  await service.drain();
  assert.equal(
    methodCalls(current, "session.collaboration.settle").length,
    1,
    "a successfully settled turn must not be replayed",
  );
});

test("a failed settlement keeps its entry and is retried on the next drain", async () => {
  let rejectSettle = true;
  const host = createHost("host-1", (method) => {
    if (method === "session.collaboration.settle" && rejectSettle) {
      throw Object.assign(new Error("The host is unavailable"), { code: "HOST_UNAVAILABLE" });
    }
    return { messages: [] };
  });
  const { service } = createService({ getHost: () => host });

  await assert.rejects(service.settle("worker-session", "turn-retry"), /host is unavailable/i);

  rejectSettle = false;
  await service.drain();
  const settles = methodCalls(host, "session.collaboration.settle");
  assert.equal(settles.length, 2, "the retained entry must be retried");
  assert.deepEqual(settles[1].params, { turnId: "turn-retry" });
});

async function drainBusyDelivery(kind, failure) {
  const pending = sessionMessage({ id: `message-${kind}`, kind });
  const host = createHost("host-1", (method) => {
    if (method === "session.collaboration.pending") return { messages: [pending] };
    if (method === "session.collaboration.message") return { message: pending };
    return {};
  });
  const bridge = {
    queue: { list: () => [], cancelSessionMessage: async () => {} },
    agentHost: { startTurn: async () => { throw failure; } },
    interruptSessionMessage: async () => {},
  };
  const { service, logs } = createService({ getHost: () => host, bridge });
  await service.drain();
  return { failures: methodCalls(host, "session.collaboration.fail"), logs };
}

function busyError(message) {
  return Object.assign(new Error(message), { data: { errorCode: "AGENT_BUSY" } });
}

test("a busy non-completion delivery persists a coded and bounded failure", async () => {
  const { failures } = await drainBusyDelivery("message", busyError("x".repeat(3000)));
  assert.equal(failures.length, 1);
  assert.equal(failures[0].params.messageId, "message-message");
  assert.ok(failures[0].params.error.startsWith("AGENT_BUSY: "));
  assert.equal(failures[0].params.error.length, 2000);
});

test("a busy completion delivery stays pending without persisting a failure", async () => {
  const { failures, logs } = await drainBusyDelivery("completion", busyError("Inbox is full"));
  assert.deepEqual(failures, []);
  assert.ok(logs.some((entry) => entry.message === "Session completion delivery is pending or failed"));
});

test("an uncoded delivery failure persists the FAILED fallback code", async () => {
  const { failures } = await drainBusyDelivery("message", new Error("Agent runtime restarted"));
  assert.equal(failures.length, 1);
  assert.equal(failures[0].params.error, "FAILED: Agent runtime restarted");
});

test("an invalid session message kind is rejected before any host send", async () => {
  const host = createHost("host-1", () => ({ messages: [] }));
  const { service } = createService({ getHost: () => host, activeTurns: { "source-session": "turn-1" } });

  await assert.rejects(
    invokeSessionSend(service, { sessionId: "target-session", content: "hello", kind: "broadcast" }),
    { code: "INVALID_ARGUMENT", message: "kind must be task or message" },
  );
  assert.deepEqual(host.calls, []);
});

test("an omitted session message kind defaults to message", async () => {
  for (const kind of [undefined, "task", "message"]) {
    const stored = sessionMessage({ status: "completed" });
    const host = createHost("host-1", (method) => {
      if (method === "session.collaboration.send") return { message: stored };
      if (method === "session.collaboration.message") return { message: stored };
      return {};
    });
    const { service } = createService({ getHost: () => host, activeTurns: { "source-session": "turn-1" } });

    await invokeSessionSend(service, {
      sessionId: "target-session",
      content: "hello",
      idempotencyKey: `session-message-${kind}`,
      ...(kind === undefined ? {} : { kind }),
    });

    const send = methodCalls(host, "session.collaboration.send");
    assert.equal(send.length, 1);
    assert.equal(send[0].params.kind, kind ?? "message");
  }
});

// Spawning a worker is the agent choosing a model for work it delegates, so
// the per-model "Available for AI delegation" opt-in governs it the same way
// it governs `Task.model` (#386).
const SPAWN_PROVIDERS = [
  {
    id: "provider-a",
    name: "Provider A",
    enabled: true,
    authKind: "none",
    models: [
      { id: "default-model" },
      { id: "private-model" },
      { id: "delegable-model", availableForSubagents: true },
    ],
  },
];

function spawnHost() {
  const stored = sessionMessage({ id: "spawn-message", status: "completed", kind: "task" });
  return createHost("host-1", (method) => {
    if (method === "providers.list") return { providers: SPAWN_PROVIDERS };
    if (method === "settings.get") {
      return { defaultProviderId: "provider-a", defaultModelId: "default-model" };
    }
    if (method === "session.collaboration.spawn") return { message: stored };
    if (method === "session.collaboration.message") return { message: stored };
    return { messages: [] };
  });
}

function invokeSpawn(service, args) {
  return service.invoke({
    operation: "session/collaboration/spawn",
    source: "plugin",
    args: [args],
    pluginContext: {
      pluginId: "demo-plugin",
      sessionId: "source-session",
      turnId: "turn-1",
      invocationId: "invocation-1",
    },
  });
}

function spawnService(host) {
  return createService({ getHost: () => host, activeTurns: { "source-session": "turn-1" } }).service;
}

test("spawn refuses a model the user did not enable for AI delegation (#386)", async () => {
  const host = spawnHost();

  await assert.rejects(
    invokeSpawn(spawnService(host), { task: "Review the diff", modelKey: "provider-a/private-model" }),
    { code: "PERMISSION_DENIED", message: /not enabled for AI delegation/ },
  );
  assert.deepEqual(methodCalls(host, "session.collaboration.spawn"), []);
});

test("spawn accepts a model enabled for AI delegation (#386)", async () => {
  const host = spawnHost();

  await invokeSpawn(spawnService(host), { task: "Review the diff", modelKey: "provider-a/delegable-model" });

  const spawns = methodCalls(host, "session.collaboration.spawn");
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].params.providerId, "provider-a");
  assert.equal(spawns[0].params.modelId, "delegable-model");
});

test("spawn treats the default model's own key as inheritance, not a selection (#386)", async () => {
  const host = spawnHost();

  await invokeSpawn(spawnService(host), { task: "Review the diff", modelKey: "provider-a/default-model" });

  const spawns = methodCalls(host, "session.collaboration.spawn");
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].params.modelId, "default-model");
});

test("spawn without a model key still prefers an enabled model over the default (#386)", async () => {
  const host = spawnHost();

  await invokeSpawn(spawnService(host), { task: "Review the diff" });

  const spawns = methodCalls(host, "session.collaboration.spawn");
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].params.modelId, "delegable-model");
});

test("spawn without a model key never selects an un opted-in default model (#1183)", async () => {
  // No model carries availableForSubagents, so the old isDefault fallback
  // silently spent the default model for delegation.
  const providers = [
    {
      id: "provider-a",
      name: "Provider A",
      enabled: true,
      authKind: "none",
      models: [{ id: "default-model" }, { id: "private-model" }],
    },
  ];
  const stored = sessionMessage({ id: "spawn-message", status: "completed", kind: "task" });
  const host = createHost("host-1", (method) => {
    if (method === "providers.list") return { providers };
    if (method === "settings.get") {
      return { defaultProviderId: "provider-a", defaultModelId: "default-model" };
    }
    if (method === "session.collaboration.spawn") return { message: stored };
    return { messages: [] };
  });

  await assert.rejects(
    invokeSpawn(spawnService(host), { task: "Review the diff" }),
    { code: "MODEL_NOT_CONFIGURED" },
  );
  assert.deepEqual(methodCalls(host, "session.collaboration.spawn"), []);
});


test("native workspace messages use the existing queue without a loaded plugin", async () => {
  const pending = sessionMessage({ pluginId: "host:workspace-sessions", notifyOnCompletion: false });
  const admissions = [];
  const queued = [];
  const host = createHost("host-1", (method) => {
    if (method === "session.collaboration.pending") return { messages: [pending] };
    if (method === "session.collaboration.message") return { message: pending };
    if (method === "session.collaboration.validateNative") return { ok: true };
    return {};
  });
  const bridge = {
    queue: { list: () => queued },
    agentHost: { startTurn: async (_principal, input) => {
      admissions.push(input);
      queued.push({ sessionMessageId: pending.id });
    } },
  };
  const { service } = createService({ host, bridge, pluginLoaded: false });
  await service.drain();
  await service.drain();
  assert.equal(admissions.length, 1);
  assert.equal(admissions[0].admission, "queue");
  assert.equal(admissions[0].sessionId, "target-session");
  assert.equal(admissions[0].input.sessionMessageId, pending.id);
  assert.equal(methodCalls(host, "session.collaboration.validateNative").length, 2);
  assert.deepEqual(methodCalls(host, "session.collaboration.fail"), []);
});

test("a native message moved outside its workspace is refused before queue admission", async () => {
  const pending = sessionMessage({ pluginId: "host:workspace-sessions" });
  let admitted = false;
  const host = createHost("host-1", (method) => {
    if (method === "session.collaboration.pending") return { messages: [pending] };
    if (method === "session.collaboration.message") return { message: pending };
    if (method === "session.collaboration.validateNative") {
      throw Object.assign(new Error("Workspace changed"), { errorCode: "PERMISSION_DENIED" });
    }
    return {};
  });
  const { service } = createService({ host, pluginLoaded: false, bridge: {
    queue: { list: () => [] },
    agentHost: { startTurn: async () => { admitted = true; } },
  } });
  await service.drain();
  assert.equal(admitted, false);
  assert.equal(methodCalls(host, "session.collaboration.fail")[0].params.error, "PERMISSION_DENIED: Workspace changed");
});

test("disabled plugins still cannot dispatch their queued messages", async () => {
  const pending = sessionMessage();
  const host = createHost("host-1", (method) => {
    if (method === "session.collaboration.pending") return { messages: [pending] };
    if (method === "session.collaboration.message") return { message: pending };
    return {};
  });
  const { service } = createService({ host, pluginLoaded: false, bridge: {
    queue: { list: () => [] },
    agentHost: { startTurn: async () => { assert.fail("Disabled plugin was dispatched"); } },
  } });
  await service.drain();
  assert.equal(methodCalls(host, "session.collaboration.fail")[0].params.error, "ABORTED: The sending plugin is no longer enabled");
  assert.deepEqual(methodCalls(host, "session.collaboration.validateNative"), []);
});


for (const report of [false, true]) test(`a full human queue defers a native ${report ? "phase report" : "message"} until capacity returns`, async () => {
  const { AgentHost } = await import("@pi-desktop/agent-host");
  const principal = { subject: "desktop", roles: ["owner"], pairedDevice: true };
  const pending = sessionMessage({ pluginId: "host:workspace-sessions",
    ...(report ? { content: JSON.stringify({ state: "phase_completed", content: "Done" }) } : {}),
  });
  const failures = [];
  const host = createHost("host-1", (method, params) => {
    if (method === "session.collaboration.pending") return { messages: pending.status === "queued" ? [pending] : [] };
    if (method === "session.collaboration.message") return { message: pending };
    if (method === "session.collaboration.fail") { failures.push(params); pending.status = "failed"; }
    return { ok: true };
  });
  const runtime = { async prompt() { return { turnId: "human-running" }; }, async stop() { return { requested: true }; },
    async abort() {}, async respondInput() {} };
  const agentHost = new AgentHost({ runtime,
    sessions: { async get(id) { return { id, title: "Target", mode: "agent", permissionMode: "auto", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }; },
      async history() { return { items: [], hasMore: false }; } },
    approvals: { async resolveTool() {}, async resolveContract() {}, async listPendingTools() { return []; } },
  });
  await agentHost.start();
  await agentHost.startTurn(principal, { sessionId: pending.targetSessionId, input: { text: "Human running" }, context: { requestId: "running" } });
  const humans = [];
  for (let i = 0; i < 8; i++) humans.push(await agentHost.startTurn(principal, {
    sessionId: pending.targetSessionId, input: { text: `Human queued ${i}` }, admission: "queue", context: { requestId: `human-${i}` },
  }));
  const bridge = { agentHost, queue: { list: (id) => agentHost.queueEntries(id) }, interruptSessionMessage: async () => {} };
  const { service } = createService({ host, bridge, pluginLoaded: false });
  await service.drain();
  assert.equal(pending.status, "queued");
  assert.deepEqual(failures, []);
  await agentHost.cancelTurn(principal, humans.at(-1).turn.id);
  await service.drain();
  await service.drain();
  assert.equal(agentHost.queueEntries(pending.targetSessionId).filter(entry => entry.sessionMessageId === pending.id).length, 1);
  assert.equal(agentHost.queueEntries(pending.targetSessionId).filter(entry => !entry.sessionMessageId).length, 7);
  assert.deepEqual(failures, []);
});
