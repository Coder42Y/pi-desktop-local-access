import { randomUUID } from "node:crypto";
import { createSessionCollaborationDelivery } from "@pi-desktop/host-runtime";
import type {
  AgentStatus,
  AppSettings,
  SessionCollaborationMessage,
  SessionCollaborationSummary,
} from "@pi-desktop/shared";
import { DESKTOP_PRINCIPAL, type AgentHostBridge } from "../agent-host-bridge";
import { listReadyPluginModels, parsePluginModelKey } from "../plugin-agent-complete";
import type { McpControlInvokeInput } from "../mcp-control";

type Host = { call<T>(method: string, params?: Record<string, unknown>): Promise<T> };
type Sidecar = { call<T>(method: string, params: Record<string, unknown>): Promise<T> };

/** Shared by the plugin and the sidebar: durable outcomes plus live activity. */
export async function readSessionCollaboration(
  host: Host,
  sidecar: Sidecar | null,
  sessionId: string,
): Promise<SessionCollaborationSummary> {
  const [summary, live] = await Promise.all([
    host.call<SessionCollaborationSummary>("session.collaboration.status", { sessionId }),
    sidecar?.call<{ status: AgentStatus }>("agent.getStatus", { sessionId }),
  ]);
  if (live?.status.sessionId === sessionId && live.status.isRunning) {
    return {
      ...summary,
      status: live.status.pendingToolConfirmations > 0 ? "waiting_permission" : "running",
      observedAt: new Date().toISOString(),
    };
  }
  return summary;
}

export type SessionCollaborationDependencies = {
  getHost: () => Host | null;
  getSidecar: () => Sidecar | null;
  getBridge: () => AgentHostBridge | null;
  getActiveTurn: (sessionId: string) => string | undefined;
  flushTranscript: () => Promise<boolean>;
  isPluginLoaded: (pluginId: string) => boolean;
  isQuitting: () => boolean;
  onChanged: () => void;
  log: (message: string, data: Record<string, unknown>) => void;
};

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code, errorCode: code });
}

function text(input: Record<string, unknown>, key: string, required = true): string | undefined {
  const value = input[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value.trim()) fail("INVALID_ARGUMENT", `${key} must be a nonempty string`);
  return value.trim();
}

function messageKind(value: unknown): "task" | "message" {
  if (value === undefined) return "message";
  if (value !== "task" && value !== "message") fail("INVALID_ARGUMENT", "kind must be task or message");
  return value;
}

/** Plugin entry authorization stays in Main; delivery is Host-independent. */
export function createSessionCollaborationService(deps: SessionCollaborationDependencies) {
  const { dispatch, cancel, drain, changed, settle } = createSessionCollaborationDelivery({
    ...deps, principal: DESKTOP_PRINCIPAL,
  });
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

  function sender(input: McpControlInvokeInput): { pluginId: string; sourceSessionId: string; sourceTurnId: string } {
    const context = input.pluginContext;
    if (!context?.sessionId || !context.turnId || !context.invocationId
      || deps.getActiveTurn(context.sessionId) !== context.turnId) {
      fail("PERMISSION_DENIED", "Sending requires an active, host-authenticated Agent tool invocation");
    }
    return { pluginId: context.pluginId, sourceSessionId: context.sessionId, sourceTurnId: context.turnId };
  }

  return {
    changed,
    async invoke(input: McpControlInvokeInput): Promise<unknown> {
      if (input.source !== "plugin" || !input.pluginContext?.pluginId) {
        fail("PERMISSION_DENIED", "Session collaboration requires a trusted plugin context");
      }
      const args = input.args?.[0];
      if (input.args?.length !== 1 || !args || typeof args !== "object" || Array.isArray(args)) {
        fail("INVALID_ARGUMENT", "One session operation object is required");
      }
      const data = args as Record<string, unknown>;
      const host = requireHost();
      checkCurrent(host, input.signal);
      switch (input.operation) {
        case "session/collaboration/status":
          await drain();
          return readSessionCollaboration(host, deps.getSidecar(), text(data, "sessionId")!);
        case "session/collaboration/list":
          await drain();
          return host.call("session.collaboration.list", {});
        case "session/collaboration/result":
          await drain();
          return host.call("session.collaboration.result", {
            sessionId: text(data, "sessionId"), messageId: text(data, "messageId", false), turnId: text(data, "turnId", false),
          });
        case "session/collaboration/cancel": {
          const result = await cancel(host, {
            sessionId: text(data, "sessionId"), messageId: text(data, "messageId", false),
            pluginId: input.pluginContext.pluginId,
            ...(input.pluginContext.sessionId ? { sourceSessionId: input.pluginContext.sessionId } : {}),
          });
          await drain();
          return result;
        }
        case "session/collaboration/spawn":
        case "session/collaboration/send": {
          const source = sender(input);
          const spawn = input.operation.endsWith("/spawn");
          const content = text(data, spawn ? "task" : "content");
          const notify = data.notifyOnCompletion;
          if (notify !== undefined && typeof notify !== "boolean") fail("INVALID_ARGUMENT", "notifyOnCompletion must be a boolean");
          let model: { providerId: string; modelId: string } | null = null;
          if (spawn) {
            const [listed, settings] = await Promise.all([
              host.call<{ providers: Parameters<typeof listReadyPluginModels>[0] }>("providers.list", { includeDisabled: false }),
              host.call<AppSettings>("settings.get"),
            ]);
            checkCurrent(host, input.signal);
            const models = listReadyPluginModels(listed.providers, settings);
            const requested = text(data, "modelKey", false);
            // No isDefault fallback here: naming a default the user never
            // opted into delegation would spend a model the Task gate
            // refuses (issue #1183). Omitting modelKey must fall back to the
            // spawn path's own inheritance, not to an un opted-in default.
            const chosen = requested
              ? models.find((item) => item.key === requested)
              : models.find((item) => item.availableForSubagents);
            if (!chosen) fail("MODEL_NOT_CONFIGURED", "No matching configured model is available");
            // A worker the agent starts is AI-driven delegation, so naming a model here
            // needs that model's own `availableForSubagents` opt-in — the gate `Task.model`
            // already applies (ADR subagent-model-opt-in; #386). Inheriting stays open, and
            // naming the default is that inheritance spelled out, the way repeating a
            // definition's own pin is on the Task path.
            if (requested && !chosen.availableForSubagents && !chosen.isDefault) {
              fail("PERMISSION_DENIED", `Model "${requested}" is not enabled for AI delegation. Turn on "Available for AI delegation" for it in model settings, or omit modelKey to inherit.`);
            }
            model = parsePluginModelKey(chosen.key);
          }
          checkCurrent(host, input.signal);
          sender(input);
          const response = await host.call<{ message: SessionCollaborationMessage }>(`session.collaboration.${spawn ? "spawn" : "send"}`, {
            ...source, content,
            idempotencyKey: text(data, "idempotencyKey", false) ?? randomUUID(),
            ...(typeof notify === "boolean" ? { notifyOnCompletion: notify } : {}),
            ...(spawn ? { ...model, title: text(data, "title", false) }
              : { sessionId: text(data, "sessionId"), kind: messageKind(data.kind) }),
          });
          return dispatch(response.message, input.signal);
        }
        default: fail("NOT_FOUND", "Unknown session collaboration operation");
      }
    },
    settle,
    drain,
  };
}
