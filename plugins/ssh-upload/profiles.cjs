"use strict";
const { createHash } = require("node:crypto");
const { posix } = require("node:path");
const { validateConfig } = require("./transfer.cjs");
const own = (value, key) => Object.hasOwn(value, key) ? value[key] : undefined;
const hash = value => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const HEX = /^[a-f0-9]{64}$/;
const CONFIG_FIELDS = ["target", "port", "directory", "identity", "workspaceRoot"];
const defaults = () => ({ target: "", port: "", directory: "~/.pi-desktop/uploads", identity: "" });
const failure = (code, message) => Object.assign(new Error(message), { code });
const invalid = () => failure("SSH_SETTINGS_INVALID", "Saved SSH settings have an unsupported format.");
const isSshProject = value => typeof value === "string" && /^remote-project:[a-zA-Z0-9._-]+$/.test(value);
const legacyProfileKey = session => hash(`${session?.sessionId?.startsWith("remote:") ? session.sessionId.split(":").slice(0, 2).join(":") : "local"}\n${session?.projectPath || session?.sessionId || "home"}`);
function configFor(raw, root) {
  const input = { ...defaults(), ...Object.fromEntries(Object.entries(raw || {}).filter(([key, value]) => CONFIG_FIELDS.includes(key) && value !== undefined)) };
  if (typeof input.target !== "string" || typeof input.identity !== "string" || typeof input.directory !== "string") throw invalid();
  const previousDefault = input.workspaceRoot && posix.join(input.workspaceRoot, ".pi-desktop/uploads");
  if (root && (!raw?.directory || input.directory === "~/.pi-desktop/uploads" || input.directory === previousDefault)) input.directory = posix.join(root, ".pi-desktop/uploads");
  delete input.workspaceRoot;
  if (root) input.workspaceRoot = root;
  const validated = validateConfig({ ...input, target: input.target || "validation-only" });
  return input.target ? validated : { ...validated, target: "" };
}
function createContext(session, workspace) {
  const oldKey = legacyProfileKey(session);
  if (!isSshProject(session.projectPath)) {
    const root = session.projectPath?.startsWith("/") ? session.projectPath : null;
    return { kind: "legacy", root, legacyKey: oldKey, bindingKey: hash(["legacy", oldKey, root]) };
  }
  const hostKey = workspace?.remote?.hostKey, root = workspace?.remote?.path;
  if (workspace?.path !== session.projectPath || typeof hostKey !== "string" || !hostKey.trim() || hostKey.length > 512 || /[\x00-\x1f\x7f]/.test(hostKey)
    || typeof root !== "string" || !root.startsWith("/")) throw failure("SSH_CONTEXT_CHANGED", "Active SSH project does not match the conversation.");
  const canonical = validateConfig({ target: "validation-only", directory: root, workspaceRoot: root }).workspaceRoot;
  return { kind: "workspace", root: canonical, legacyKey: oldKey, host: hash(hostKey), project: hash([hostKey, session.projectPath]), bindingKey: hash([hostKey, session.projectPath, canonical]) };
}
const configurationKey = (context, config) => config?.target ? hash([context.bindingKey, config.target, config.port, config.identity, config.directory, config.workspaceRoot]) : null;
function parse(raw, fallback) {
  if (raw === undefined) return fallback;
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 1024 * 1024) throw invalid();
  try { const value = JSON.parse(raw); if (!record(value)) throw invalid(); return value; } catch { throw invalid(); }
}
function bounded(map) { if (!record(map) || Object.keys(map).length > 1024) throw invalid(); return map; }
function relativeDirectory(value) {
  if (typeof value !== "string" || !value || value.length > 4096 || value.startsWith("/") || value.startsWith("~") || /[\x00-\x1f\x7f]/.test(value) || value.split("/").includes("..")) throw invalid();
  return posix.normalize(value);
}
function snapshot(settings) {
  const legacy = bounded(parse(settings.profiles, {}));
  for (const value of Object.values(legacy)) if (!record(value)) throw invalid();
  const connectionDoc = parse(settings.connections, { version: 1, hosts: {} });
  const projectDoc = parse(settings.projectDirectories, { version: 1, projects: {} });
  if (connectionDoc.version !== 1 || projectDoc.version !== 1 || Object.keys(connectionDoc).some(k => !["version", "hosts"].includes(k)) || Object.keys(projectDoc).some(k => !["version", "projects"].includes(k))) throw invalid();
  const hosts = bounded(connectionDoc.hosts), projects = bounded(projectDoc.projects);
  for (const [key, value] of Object.entries(hosts)) {
    if (!HEX.test(key) || !record(value) || typeof value.target !== "string" || (value.port !== null && value.port !== undefined && (typeof value.port !== "number" || !Number.isInteger(value.port))) || (value.identity !== undefined && typeof value.identity !== "string")
      || Object.keys(value).some(k => !["target", "port", "identity"].includes(k))) throw invalid();
    try { validateConfig(value); } catch { throw invalid(); }
  }
  for (const [key, value] of Object.entries(projects)) {
    if (!HEX.test(key) || !record(value) || !HEX.test(value.host) || !HEX.test(value.legacyKey) || Object.keys(value).some(k => !["host", "legacyKey", "relativeDirectory"].includes(k))) throw invalid();
    relativeDirectory(value.relativeDirectory);
  }
  return { legacy, hosts, projects };
}
/** One plugin-owned write queue. SDK owns the actual settings file. */
function createProfileStore({ readSettings, writeSettings }) {
  let active = true, tail = Promise.resolve();
  const assertActive = () => { if (!active) throw failure("SSH_PLUGIN_UNLOADED", "SSH Upload was unloaded."); };
  const serial = fn => { const result = tail.then(async () => { assertActive(); return fn(); }); tail = result.catch(() => {}); return result; };
  const read = async () => {
    assertActive(); let settings;
    try { settings = await readSettings(); } catch { throw failure("SSH_SETTINGS_READ_FAILED", "SSH settings could not be read."); }
    assertActive(); if (!record(settings)) throw invalid(); return snapshot(settings);
  };
  const resolve = context => serial(async () => {
    const state = await read();
    if (context.kind === "legacy") {
      const saved = own(state.legacy, context.legacyKey);
      const candidates = Object.values(state.legacy).filter(v => v.target);
      return { config: configFor(saved, context.root), configured: !!saved?.target,
        suggestedConfig: !saved && candidates.length === 1 ? configFor({ ...candidates[0], directory: undefined }, context.root) : null };
    }
    const connection = own(state.hosts, context.host), project = own(state.projects, context.project);
    if (project && project.host !== context.host) throw invalid();
    if (connection) return { configured: true, suggestedConfig: null, config: configFor({ ...connection, directory: posix.join(context.root, project?.relativeDirectory || ".pi-desktop/uploads") }, context.root) };
    // Old records contain no authoritative Host identity: suggest, never adopt.
    const owned = new Set(Object.values(state.projects).map(v => v.legacyKey));
    const exact = !owned.has(context.legacyKey) && own(state.legacy, context.legacyKey);
    const candidates = Object.entries(state.legacy).filter(([key, value]) => !owned.has(key) && value.target).map(([,value]) => value);
    const suggestion = exact?.target ? exact : candidates.length === 1 ? { ...candidates[0], directory: undefined } : null;
    return { configured: false, config: configFor(undefined, context.root), suggestedConfig: suggestion ? configFor(suggestion, context.root) : null };
  });
  const save = (context, raw, guard = async () => {}) => serial(async () => {
    const state = await read();
    if (!record(raw) || ["password", "privateKey", "token"].some(k => Object.hasOwn(raw, k))) throw invalid();
    const config = validateConfig(configFor(raw, context.root));
    const extra = Object.fromEntries(Object.entries(own(state.legacy, context.legacyKey) || {}).filter(([key]) => !CONFIG_FIELDS.includes(key)));
    const next = { legacy: { ...state.legacy, [context.legacyKey]: { ...extra, ...config } }, hosts: { ...state.hosts }, projects: { ...state.projects } };
    if (context.kind === "workspace") {
      next.hosts[context.host] = { target: config.target, port: config.port, identity: config.identity };
      next.projects[context.project] = { host: context.host, legacyKey: context.legacyKey, relativeDirectory: posix.relative(context.root, config.directory) || "." };
    }
    const partial = { profiles: JSON.stringify(next.legacy), connections: JSON.stringify({ version: 1, hosts: next.hosts }), projectDirectories: JSON.stringify({ version: 1, projects: next.projects }) };
    snapshot(partial);
    if (Buffer.byteLength(JSON.stringify(partial)) > 512 * 1024) throw invalid();
    await guard(); assertActive();
    try { await writeSettings(partial); } catch { throw failure("SSH_SETTINGS_SAVE_FAILED", "SSH settings write could not be confirmed."); }
    assertActive(); return config;
  });
  return { resolve, save, assertActive, dispose() { active = false; } };
}
module.exports = { createProfileStore, createContext, configurationKey, legacyProfileKey, defaults, isSshProject, failure };
