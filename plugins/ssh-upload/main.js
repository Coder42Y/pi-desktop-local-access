"use strict";
const { join } = require("node:path");
const { createController } = require("./transfer.cjs");
const { createPasteStore } = require("./paste-store.cjs");
const { createProfileStore, createContext, configurationKey, legacyProfileKey, defaults, isSshProject, failure } = require("./profiles.cjs");
let controller, pasteStore, profilesStore, labels, activity;
let locale = "en";
const effectiveProfiles = new Map(), manualProfiles = new Map();
const isRemote = session => typeof session?.sessionId === "string" && session.sessionId.length > 0 && (/^remote:[^:]+:.+$/.test(session.sessionId) || isSshProject(session.projectPath));
const pasteActive = () => ["receiving", "uploading"].includes(pasteStore?.current()?.state);
const manualActive = () => ["selecting", "uploading"].includes(controller?.current()?.state);
function publicError(error) {
  const key = ({ SSH_SETTINGS_INVALID: "profilesInvalid", SSH_SETTINGS_READ_FAILED: "profilesReadFailed", SSH_SETTINGS_SAVE_FAILED: "profilesSaveFailed", SSH_CONTEXT_CHANGED: "configurationChanged", SSH_CONFIGURATION_CHANGED: "configurationChanged", SSH_PLUGIN_UNLOADED: "pluginUnloaded", SSH_SETTINGS_BUSY: "settingsBusy", SSH_OPERATION_BUSY: "operationBusy" })[error?.code];
  return key && labels ? Object.assign(new Error(labels[key]), { code: error.code }) : error;
}
async function remoteSession() {
  const session = await pi.session.getActive();
  if (!isRemote(session)) throw new Error("SSH Upload is available only in a remote host conversation or SSH project.");
  return session;
}
async function describe(session, store) {
  store.assertActive();
  const workspace = isSshProject(session.projectPath) ? (await pi.desktop.invoke({ operation: "project/get", args: [] })).workspace : undefined;
  store.assertActive();
  const current = await pi.session.getActive(); store.assertActive();
  if (current?.sessionId !== session.sessionId || current?.projectPath !== session.projectPath) throw failure("SSH_CONTEXT_CHANGED", "Session changed while resolving SSH project.");
  return createContext(session, workspace);
}
async function assertContext(session, expected, store) {
  const current = await describe(session, store);
  if (current.bindingKey !== expected.bindingKey) throw failure("SSH_CONTEXT_CHANGED", "SSH project binding changed.");
}
async function resolveSession(session, store) {
  const context = await describe(session, store);
  const result = await store.resolve(context);
  await assertContext(session, context, store);
  return { ...result, context, configurationKey: configurationKey(context, result.config) };
}
async function uploadSession(store) {
  const session = await remoteSession();
  const resolved = await resolveSession(session, store);
  return { ...session, configurationKey: resolved.configurationKey };
}
async function getPasteStore(store) {
  await remoteSession(); store.assertActive();
  if (!pasteStore) {
    const dataPath = join(await pi.plugin.getDataPath(), "clipboard"); store.assertActive();
    pasteStore ||= createPasteStore({ dataPath, getSession: () => uploadSession(store), getConfig: session => {
      const entry = effectiveProfiles.get(legacyProfileKey(session));
      return entry?.sessionId === session.sessionId && entry.configurationKey === session.configurationKey ? entry.config : null;
    } });
  }
  return pasteStore;
}
async function onLoad() {
  const api = pi;
  locale = await api.app.getLocale();
  labels = (await import("./renderer/locales.mjs")).labelsFor(locale);
  const store = createProfileStore({ readSettings: () => api.plugin.getSettings(), writeSettings: partial => api.plugin.setSettings(partial) });
  profilesStore = store; activity = { pending: null }; effectiveProfiles.clear(); manualProfiles.clear();
  controller = createController({ getSession: async () => {
    const session = await remoteSession();
    const context = await describe(session, store);
    return { ...session, bindingKey: context.bindingKey };
  } });
}
async function onUnload() {
  profilesStore?.dispose(); profilesStore = null; activity = null;
  controller?.dispose(); controller = null;
  await pasteStore?.dispose(); pasteStore = null;
  effectiveProfiles.clear(); manualProfiles.clear();
}
async function saveConfig(session, args, store) {
  if (!isRemote(session)) throw new Error("Save the SSH target inside a remote host conversation or SSH project.");
  if (args.sessionId && args.sessionId !== session.sessionId) throw new Error("Session changed. Open the target conversation and save again.");
  if (pasteActive() || manualActive()) throw failure("SSH_SETTINGS_BUSY", "Finish the active upload before changing settings.");
  const context = await describe(session, store);
  if (pasteActive() || manualActive()) throw failure("SSH_SETTINGS_BUSY", "Finish the active upload before changing settings.");
  if (args.bindingKey !== undefined && args.bindingKey !== context.bindingKey) throw failure("SSH_CONTEXT_CHANGED", "Stale SSH configuration form.");
  const config = await store.save(context, args.config, async () => {
    await assertContext(session, context, store);
    if (pasteActive() || manualActive()) throw failure("SSH_SETTINGS_BUSY", "Finish the active upload before changing settings.");
  });
  await assertContext(session, context, store);
  effectiveProfiles.set(legacyProfileKey(session), { sessionId: session.sessionId, config, configurationKey: configurationKey(context, config) });
  return { config, context };
}
async function contextFor(session, store, ownerController = controller) {
  const job = ownerController?.current();
  const base = { sessionId: session?.sessionId || null, projectPath: session?.projectPath || null, isRemote: isRemote(session), locale,
    job: job ? { ...job, bindingKey: manualProfiles.get(job.id)?.bindingKey } : null, pastedJob: pasteStore?.current() || null, configured: false, config: defaults(), suggestedConfig: null,
    bindingKey: null, configurationKey: null, profileScope: isSshProject(session?.projectPath) ? "server" : "legacy" };
  if (!base.isRemote) return base;
  try {
    const { context, ...result } = await resolveSession(session, store);
    return { ...base, ...result, bindingKey: context.bindingKey };
  } catch (error) { return { ...base, configError: publicError(error).message }; }
}
async function handle(method, args = {}) {
  const store = profilesStore, ownerController = controller;
  if (!ownerController || !store) throw new Error("SSH Upload is not ready.");
  if (method === "pasteBegin") {
    const session = await remoteSession();
    if (session.sessionId !== args.sessionId) throw new Error("Session changed before upload started.");
    if (manualActive()) throw new Error("Finish the manual SSH upload first.");
    const result = await resolveSession(session, store);
    if (!result.configured) throw new Error("Confirm and save the SSH target for this project first.");
    if (args.configurationKey !== undefined && args.configurationKey !== result.configurationKey) throw failure("SSH_CONFIGURATION_CHANGED", "SSH configuration changed before upload.");
    effectiveProfiles.set(legacyProfileKey(session), { sessionId: session.sessionId, config: result.config, configurationKey: result.configurationKey });
    return (await getPasteStore(store)).begin(args);
  }
  if (["pasteChunk", "pasteFinish", "pastePoll", "pasteCancel"].includes(method)) {
    if (["pasteChunk", "pasteFinish"].includes(method)) {
      const session = await remoteSession();
      if (session.sessionId !== pasteStore?.current()?.sessionId) throw new Error("Session changed during pasted upload.");
    }
    if (!pasteStore) throw new Error("Paste job not found.");
    if (method === "pasteChunk") return pasteStore.chunk(args);
    if (method === "pasteFinish") return pasteStore.finish(args.id);
    if (method === "pastePoll") return pasteStore.poll(args.id);
    return pasteStore.cancel(args.id);
  }
  if (method === "poll") return ownerController.poll(args.id);
  if (method === "cancel") return ownerController.cancel(args.id);
  if (method === "select") {
    if (pasteActive()) throw new Error("Finish or cancel the pasted SSH upload first.");
    const session = await remoteSession(), context = await describe(session, store);
    const job = await ownerController.select();
    store.assertActive();
    if (job.sessionId !== session.sessionId) { ownerController.cancel(job.id); throw failure("SSH_CONTEXT_CHANGED", "Session changed during file selection."); }
    manualProfiles.clear(); manualProfiles.set(job.id, { bindingKey: context.bindingKey }); return { ...job, bindingKey: context.bindingKey };
  }
  const session = await pi.session.getActive();
  if (method === "context") return contextFor(session, store, ownerController);
  if (method === "saveConfig") return { config: (await saveConfig(session, args, store)).config };
  if (!isRemote(session)) throw new Error("SSH Upload is available only in a remote host conversation or SSH project.");
  if (method === "verifySession") {
    const job = ownerController.poll(args.id);
    if (job.sessionId !== session.sessionId) throw new Error("Session changed. Return to the original conversation before inserting paths.");
    const resolved = await resolveSession(session, store);
    if (!manualProfiles.get(args.id)?.configurationKey || manualProfiles.get(args.id).configurationKey !== resolved.configurationKey) throw failure("SSH_CONFIGURATION_CHANGED", "SSH configuration changed after upload.");
    return { sessionId: session.sessionId, configurationKey: resolved.configurationKey };
  }
  if (method === "start") {
    if (pasteActive()) throw new Error("Finish or cancel the pasted SSH upload first.");
    const selected = ownerController.poll(args.id);
    if (selected.sessionId !== session.sessionId) throw new Error("Session changed before upload started.");
    if (selected.state !== "selected") throw new Error("Upload job has no selected files.");
    const current = await describe(session, store);
    if (manualProfiles.get(args.id)?.bindingKey !== current.bindingKey) throw failure("SSH_CONTEXT_CHANGED", "SSH project changed after selection.");
    const saved = await saveConfig(session, args, store);
    store.assertActive();
    manualProfiles.set(args.id, { bindingKey: saved.context.bindingKey, configurationKey: configurationKey(saved.context, saved.config) });
    return ownerController.start(args.id, saved.config);
  }
  throw new Error("Unknown SSH Upload method.");
}
async function onRendererCall(method, args) {
  const owner = activity;
  const exclusive = ["saveConfig", "pasteBegin", "select", "start"].includes(method);
  let acquired = false;
  try {
    if (exclusive) {
      if (!owner) throw failure("SSH_PLUGIN_UNLOADED", "SSH Upload was unloaded.");
      if (owner.pending) throw failure("SSH_OPERATION_BUSY", "Another SSH configuration or upload admission is pending.");
      owner.pending = method; acquired = true;
    }
    return await handle(method, args);
  } catch (error) { throw publicError(error); }
  finally { if (acquired) owner.pending = null; }
}
module.exports = { onLoad, onUnload, onRendererCall };
