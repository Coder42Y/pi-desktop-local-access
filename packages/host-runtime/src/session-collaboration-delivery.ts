import type { AgentHost, Principal } from "@pi-desktop/agent-host";
import type { SessionCollaborationDelivery, SessionCollaborationMessage } from "@pi-desktop/shared";

type Host = { call<T>(method: string, params?: Record<string, unknown>): Promise<T> };
export type SessionCollaborationDeliveryBridge = {
  agentHost: Pick<AgentHost, "startTurn">;
  queue: {
    list(sessionId: string): readonly { sessionMessageId?: string }[];
    cancelSessionMessage(sessionId: string, messageId: string): Promise<unknown>;
  };
  interruptSessionMessage(sessionId: string, turnId: string): Promise<unknown>;
};
export type SessionCollaborationDeliveryDependencies = {
  getHost: () => Host | null;
  getSidecar: () => object | null;
  getBridge: () => SessionCollaborationDeliveryBridge | null;
  getActiveTurn: (sessionId: string) => string | undefined;
  flushTranscript: () => Promise<boolean>;
  isPluginLoaded: (pluginId: string) => boolean;
  isQuitting: () => boolean;
  onChanged: () => void;
  log: (message: string, data: Record<string, unknown>) => void;
  principal: Principal;
};
const BUILTIN_SESSION_OWNER = "host:workspace-sessions";
function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code, errorCode: code });
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { code?: string; errorCode?: string; data?: { errorCode?: string } };
  return value.data?.errorCode ?? value.errorCode ?? value.code;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error) ?? String(error); } catch { return String(error); }
}

function delivery(message: SessionCollaborationMessage): SessionCollaborationDelivery {
  return {
    sessionId: message.targetSessionId,
    messageId: message.id,
    status: message.status,
    ...(message.turnId ? { turnId: message.turnId } : {}),
  };
}

/** One ledger consumer for Desktop and headless Host composition. */
export function createSessionCollaborationDelivery(deps: SessionCollaborationDeliveryDependencies) {
  const dispatching = new Map<string, Promise<SessionCollaborationDelivery>>();
  // Turn IDs awaiting settlement. The host keys the receipt by the turn row in
  // its own database, so an entry orphaned by a host restart is replayed there.
  const settlements = new Set<string>();
  let draining: Promise<void> | undefined;
  let dirty = false;

  function requireHost(): Host {
    if (deps.isQuitting()) fail("ABORTED", "The application is shutting down");
    const host = deps.getHost();
    if (!host) fail("HOST_UNAVAILABLE", "The host is unavailable");
    return host;
  }

  function checkCurrent(host: Host, signal?: AbortSignal): void {
    if (signal?.aborted || deps.isQuitting()) fail("ABORTED", "The session operation was cancelled");
    if (deps.getHost() !== host) fail("HOST_UNAVAILABLE", "The host restarted during the session operation");
  }

  async function dispatch(message: SessionCollaborationMessage, signal?: AbortSignal): Promise<SessionCollaborationDelivery> {
    const existing = dispatching.get(message.id);
    if (existing) return existing;
    const operation = (async () => {
      const host = requireHost();
      try {
        checkCurrent(host, signal);
        const current = (await host.call<{ message?: SessionCollaborationMessage }>(
          "session.collaboration.message", { messageId: message.id },
        )).message;
        checkCurrent(host, signal);
        if (!current) fail("NOT_FOUND", "Session message not found");
        if (current.status !== "queued") return delivery(current);
        const bridge = deps.getBridge();
        if (!bridge || !deps.getSidecar()) fail("HOST_UNAVAILABLE", "The Agent runtime is unavailable");
        const native = current.pluginId === BUILTIN_SESSION_OWNER;
        if (native) {
          await host.call("session.collaboration.validateNative", { messageId: current.id });
          checkCurrent(host, signal);
        }
        if (bridge.queue.list(current.targetSessionId).some((entry) => entry.sessionMessageId === current.id)) {
          return delivery(current);
        }
        if (!native && !deps.isPluginLoaded(current.pluginId)) fail("ABORTED", "The sending plugin is no longer enabled");
        // beginTurn rechecks the persisted authorization ceiling at execution,
        // including when a queued turn resumes after settings have changed.
        await bridge.agentHost.startTurn(deps.principal, {
          sessionId: current.targetSessionId,
          input: { text: current.content, sessionMessageId: current.id },
          admission: "queue",
          idempotencyKey: `session-message:${current.id}`,
          context: { requestId: `session-message:${current.id}` },
        });
        checkCurrent(host);
        const accepted = (await host.call<{ message: SessionCollaborationMessage }>(
          "session.collaboration.message", { messageId: current.id },
        )).message;
        if (signal?.aborted) await cancel(host, { sessionId: current.targetSessionId, messageId: current.id });
        deps.onChanged();
        return delivery(accepted);
      } catch (error) {
        // A full queue defers accepted native deliveries and completion notices.
        // It must not turn a successfully completed original task into failure.
        if (deps.getHost() === host && !(errorCode(error) === "AGENT_BUSY"
          && (message.kind === "completion" || message.pluginId === BUILTIN_SESSION_OWNER))) {
          // The host persists free text, so the code is embedded to keep the
          // stored failure machine-readable and bounded.
          const persisted = `${errorCode(error) ?? "FAILED"}: ${errorMessage(error)}`;
          await host.call("session.collaboration.fail", {
            messageId: message.id,
            error: persisted.slice(0, 2000),
          }).catch((persistenceError: unknown) => deps.log("Session delivery failure could not be saved", {
            messageId: message.id, error: String(persistenceError),
          }));
        }
        throw error;
      }
    })();
    dispatching.set(message.id, operation);
    try { return await operation; }
    finally { if (dispatching.get(message.id) === operation) dispatching.delete(message.id); }
  }

  async function cancel(host: Host, args: Record<string, unknown>) {
    const result = await host.call<{
      sessionId: string; cancelled: true; sessionRetained: true; messageIds: string[]; runningTurnIds: string[];
    }>("session.collaboration.cancel", args);
    checkCurrent(host);
    const bridge = deps.getBridge();
    if (bridge) {
      for (const messageId of result.messageIds) await bridge.queue.cancelSessionMessage(result.sessionId, messageId);
      for (const turnId of result.runningTurnIds) {
        // The exact turn guard prevents a late cancellation from stopping a
        // newer task in this reusable session.
        if (deps.getActiveTurn(result.sessionId) === turnId) {
          await bridge.interruptSessionMessage(result.sessionId, turnId);
        }
      }
    }
    deps.onChanged();
    return { sessionId: result.sessionId, cancelled: true, sessionRetained: true };
  }

  async function drain(): Promise<void> {
    // Re-entrant, self-healing: a caller arriving while a pass is running flags
    // dirty and awaits it, then re-checks. This also closes the narrow window
    // where a settlement is queued right as a running pass decides to stop, so a
    // completion callback is never deferred to an unrelated later trigger.
    for (;;) {
      if (draining) {
        dirty = true;
        await draining;
        if (!dirty) return;
        continue;
      }
      if (!deps.getHost() || deps.isQuitting()) return;
      draining = (async () => {
        do {
          // Cleared first so a throwing pass cannot keep re-running the loop.
          dirty = false;
          const host = requireHost();
          if (settlements.size && await deps.flushTranscript()) {
            checkCurrent(host);
            for (const turnId of settlements) {
              // Settling is idempotent host-side, so entries recorded against a
              // previous host are replayed rather than dropped. A failing call
              // keeps its entry for a later drain.
              await host.call("session.collaboration.settle", { turnId });
              settlements.delete(turnId);
            }
          }
          let afterMessageId: string | undefined;
          do {
            const pending = await host.call<{ messages: SessionCollaborationMessage[]; nextCursor?: string | null }>(
              "session.collaboration.pending", afterMessageId ? { afterMessageId } : {},
            );
            checkCurrent(host);
            await Promise.all(pending.messages.map(async (message) => {
              try { await dispatch(message); }
              catch (error) {
                deps.log("Session completion delivery is pending or failed", { messageId: message.id, error: String(error) });
              }
            }));
            afterMessageId = pending.nextCursor ?? undefined;
          } while (afterMessageId);
        } while (dirty);
      })();
      try { await draining; }
      finally { draining = undefined; }
      if (dirty) continue;
      return;
    }
  }

  return {
    changed(): void {
      void drain().catch((error: unknown) => {
        deps.log("Session message drain failed", { error: String(error) });
      });
    },
    dispatch,
    cancel,
    // The session ID stays part of the runtime callback contract; the host
    // resolves the receipt from the turn ID alone.
    async settle(_sessionId: string, turnId: string): Promise<void> {
      const host = deps.getHost();
      if (!host || deps.isQuitting()) return;
      settlements.add(turnId);
      // Let final message_end enqueues from this event-loop turn reach the outbox.
      await new Promise<void>((resolve) => setImmediate(resolve));
      await drain();
      deps.onChanged();
    },
    drain,
  };
}
