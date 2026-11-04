"use strict";
const { createHash } = require("node:crypto");
const { join, posix } = require("node:path");
const { createController, validateConfig } = require("./transfer.cjs");
const { createPasteStore } = require("./paste-store.cjs");
let controller, pasteStore;
let profiles = {}, locale = "en";
const effectiveProfiles = new Map();
const isSshProject = value => typeof value === "string" && /^remote-project:[a-zA-Z0-9._-]+$/.test(value);
const isRemote = session => typeof session?.sessionId === "string" && session.sessionId.length > 0 &&
  (/^remote:[^:]+:.+$/.test(session.sessionId) || isSshProject(session.projectPath));
const profileKey = session => createHash("sha256")
  .update(`${session?.sessionId?.startsWith("remote:") ? session.sessionId.split(":").slice(0, 2).join(":") : "local"}\n${session?.projectPath || session?.sessionId || "home"}`)
  .digest("hex");
const pasteActive = () => ["receiving", "uploading"].includes(pasteStore?.current()?.state);
const manualActive = () => ["selecting", "uploading"].includes(controller?.current()?.state);
const defaults = () => ({ target: "", port: "", directory: "~/.pi-desktop/uploads", identity: "" });
async function remoteSession() {
  const session = await pi.session.getActive();
  if (!isRemote(session)) throw new Error("SSH Upload is available only in a remote host conversation or SSH project.");
  return session;
}
async function workspaceRoot(session) {
  if (isSshProject(session.projectPath)) {
    const {workspace} = await pi.desktop.invoke({ operation: "project/get", args: [] });
    if (workspace?.path !== session.projectPath || !workspace.remote?.hostKey || !workspace.remote?.path?.startsWith("/")) {
      throw new Error("Active SSH project does not match the conversation. Select its workspace before uploading.");
    }
    return workspace.remote.path;
  }
  return session.projectPath?.startsWith("/") ? session.projectPath : null;
}
function draftConfig(raw, root) {
  const input = { ...defaults(), ...raw };
  const previousDefault = input.workspaceRoot && posix.join(input.workspaceRoot, ".pi-desktop/uploads");
  if (root && (!raw?.directory || input.directory === "~/.pi-desktop/uploads" || input.directory === previousDefault)) {
    input.directory = posix.join(root, ".pi-desktop/uploads");
  }
  delete input.workspaceRoot;
  if (root) input.workspaceRoot = root;
  return input.target ? validateConfig(input) : input;
}
async function uploadConfig(session, raw) {
  const config = draftConfig(raw, await workspaceRoot(session));
  return validateConfig(config);
}
async function getPasteStore() {
  await remoteSession();
  if (!pasteStore) {
    const dataPath = join(await pi.plugin.getDataPath(), "clipboard");
    if (!controller) throw new Error("SSH Upload was unloaded.");
    pasteStore ||= createPasteStore({ dataPath, getSession: remoteSession, getConfig: session => effectiveProfiles.get(profileKey(session)) });
  }
  return pasteStore;
}
async function onLoad() {
  const settings = await pi.plugin.getSettings();
  try {
    const parsed = JSON.parse(settings.profiles || "{}");
    profiles = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { profiles = {}; }
  effectiveProfiles.clear();
  locale = await pi.app.getLocale();
  controller = createController({ getSession: remoteSession });
}
async function onUnload() {
  controller?.dispose(); controller = null;
  await pasteStore?.dispose(); pasteStore = null;
  effectiveProfiles.clear();
}
async function saveConfig(session, args) {
  if (!isRemote(session)) throw new Error("Save the SSH target inside a remote host conversation or SSH project.");
  if (args.sessionId && args.sessionId !== session.sessionId) throw new Error("Session changed. Open the target conversation and save again.");
  const config = await uploadConfig(session, args.config);
  const previous = profiles;
  profiles = Object.fromEntries(Object.entries({ ...profiles, [profileKey(session)]: config }).slice(-100));
  try { await pi.plugin.setSettings({ profiles: JSON.stringify(profiles) }); }
  catch (error) { profiles = previous; throw error; }
  effectiveProfiles.set(profileKey(session), config);
  return config;
}
async function contextFor(session) {
  const base = { sessionId: session?.sessionId || null, projectPath: session?.projectPath || null, isRemote: isRemote(session),
    locale, job: controller.current(), pastedJob: pasteStore?.current() || null, configured: false, config: defaults(), suggestedConfig: null };
  if (!base.isRemote) return base;
  try {
    const root = await workspaceRoot(session);
    const saved = profiles[profileKey(session)];
    base.config = draftConfig(saved, root);
    base.configured = !!saved?.target;
    if (!saved) {
      const candidates = Object.values(profiles).filter(value => value?.target);
      if (candidates.length === 1) base.suggestedConfig = draftConfig({ ...candidates[0], directory: undefined }, root);
    }
    return base;
  } catch (error) { return { ...base, config: defaults(), configured: false, configError: error.message }; }
}
async function onRendererCall(method, args = {}) {
  if (!controller) throw new Error("SSH Upload is not ready.");
  if (method === "pasteBegin") {
    const session = await remoteSession();
    if (session.sessionId !== args.sessionId) throw new Error("Session changed before upload started.");
    if (manualActive()) throw new Error("Finish the manual SSH upload first.");
    const saved = profiles[profileKey(session)];
    if (!saved?.target) throw new Error("Confirm and save the SSH target for this project first.");
    effectiveProfiles.set(profileKey(session), await uploadConfig(session, saved));
    return (await getPasteStore()).begin(args);
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
  if (method === "poll") return controller.poll(args.id);
  if (method === "cancel") return controller.cancel(args.id);
  if (method === "select") {
    if (pasteActive()) throw new Error("Finish or cancel the pasted SSH upload first.");
    return controller.select();
  }
  const session = await pi.session.getActive();
  if (method === "context") return contextFor(session);
  if (method === "saveConfig") return { config: await saveConfig(session, args) };
  if (!isRemote(session)) throw new Error("SSH Upload is available only in a remote host conversation or SSH project.");
  if (method === "verifySession") {
    const job = controller.poll(args.id);
    if (job.sessionId !== session.sessionId) throw new Error("Session changed. Return to the original conversation before inserting paths.");
    return { sessionId: session.sessionId };
  }
  if (method === "start") {
    if (pasteActive()) throw new Error("Finish or cancel the pasted SSH upload first.");
    const selected = controller.poll(args.id);
    if (selected.sessionId !== session.sessionId) throw new Error("Session changed before upload started.");
    if (selected.state !== "selected") throw new Error("Upload job has no selected files.");
    return controller.start(args.id, await saveConfig(session, args));
  }
  throw new Error("Unknown SSH Upload method.");
}
module.exports = { onLoad, onUnload, onRendererCall };
