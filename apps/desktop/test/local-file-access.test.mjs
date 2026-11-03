import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Exercise real file IPC handlers and shared guards without launching Electron,
// native applications, an agent, or an SSH connection.
const moduleUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const sourceUrl = (path) => new URL(path, import.meta.url).href;
const reexport = (...paths) => paths.map((path) => `export * from ${JSON.stringify(sourceUrl(path))};`).join("\n");
const stub = (...names) => moduleUrl(names.map((name) => `export const ${name} = () => { throw new Error('Unexpected external call: ${name}'); };`).join("\n"));
const electron = moduleUrl(`
  export const opened = [], revealed = [];
  export const BrowserWindow = {}, dialog = {};
  export const shell = {
    openPath: async (path) => { opened.push(path); return ''; },
    showItemInFolder: (path) => { revealed.push(path); }
  };
`);
const remoteBoot = moduleUrl(`
  export const calls = [];
  export const getActiveRemoteHostsBoot = () => ({
    workspaceFiles: async (...args) => { calls.push(args); return { remote: true }; }
  });
`);
const overrides = new Map([
  ["electron", electron],
  ["@pi-desktop/shared", moduleUrl(reexport("../../../packages/shared/src/protocol.ts", "../../../packages/shared/src/errors.ts", "../../../packages/shared/src/fuzzy.ts", "../../../packages/shared/src/activation.ts"))],
  ["@pi-desktop/host-runtime", moduleUrl(`${reexport("../../../packages/host-runtime/src/workspace-files.ts", "../../../packages/host-runtime/src/chat-ref-resolve.ts", "../../../packages/host-runtime/src/fs-index.ts")}\nexport const collectWorkspaceDiff = () => { throw new Error('Unexpected diff'); };`)],
  ["@pi-desktop/agent-runtime", stub("loadComposerTemplates")],
  ["../bootstrap/remote-hosts", remoteBoot],
  ["../git-clone", stub("cloneGitRepository")],
  ["../composer-paste", stub("importComposerFiles", "saveComposerPasteFiles")],
  ["../composer-picker", stub("consumeComposerPickerSelection", "rememberComposerPickerSelection")],
  ["../browser-host", moduleUrl("export const BROWSER_PLUGIN_ID = 'test-browser';")],
]);
registerHooks({
  resolve(specifier, context, next) {
    const replacement = overrides.get(specifier);
    if (replacement) return { url: replacement, shortCircuit: true };
    try {
      return next(specifier, context);
    } catch (error) {
      if (!specifier.startsWith(".")) throw error;
      const ts = specifier.endsWith(".js") ? `${specifier.slice(0, -3)}.ts` : `${specifier}.ts`;
      const candidate = new URL(ts, context.parentURL);
      if (candidate.protocol !== "file:" || !existsSync(fileURLToPath(candidate))) throw error;
      return next(candidate.href, context);
    }
  },
});

const { registerWorkspaceIpc } = await import("../electron/main/ipc/workspace-ipc.ts");
const { IPC } = await import("@pi-desktop/shared");
const { opened, revealed } = await import(electron);
const { calls: remoteCalls } = await import(remoteBoot);
const { readOpenableFile } = await import("../../../packages/host-runtime/src/workspace-files.ts");

async function fixture(t, { remote = false, home = false } = {}) {
  const base = await mkdtemp(join(process.env.PI_SCRATCH_DIR || tmpdir(), "pi-local-file-access-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const workspace = join(base, "project");
  const desktop = join(base, "Desktop", "secmanus-smoke");
  const dataDir = join(base, "data");
  const scratch = join(dataDir, "scratch", "session");
  await Promise.all([mkdir(workspace), mkdir(desktop, { recursive: true }), mkdir(scratch, { recursive: true }), mkdir(join(dataDir, "attachments"), { recursive: true })]);
  const mail = join(desktop, "paypal-lookalike.eml");
  await writeFile(mail, "Subject: test fixture\n\nNot a real email.\n");
  const projectPath = remote ? "remote-project:test" : home ? undefined : workspace;
  const host = {
    async call(method) {
      if (method === "session.get") return { session: { projectPath } };
      if (method === "session.getScratchPath") return { path: scratch };
      if (method === "workspace.get") return { workspace: projectPath ? { path: projectPath } : null };
      if (method === "project.groups.list") return { groups: [{ primaryPath: projectPath, remote: { hostKey: "test-ssh", path: "/remote/project" } }] };
      assert.fail(`Unexpected Host request: ${method}`);
    },
  };
  const handlers = new Map();
  registerWorkspaceIpc({
    registrar: { handle: (channel, fn) => handlers.set(channel, fn), handleWithEvent() {}, assertMainWindowSender() {} },
    getMainWindow: () => null, getHost: () => host, getSidecar: () => null,
    dataDir, isDevelopmentBuild: false, plugins: {}, browserHost: {}, clipboardHistory: {},
    recordPastedClipboardFiles() {}, currentWorkspacePath: () => projectPath || null,
    setCurrentWorkspacePath() {}, withGitBranch: async (workspace) => workspace,
    stripWinLongPrefix: (path) => path,
  });
  const invoke = (name, input) => handlers.get(IPC.invoke[name])({ sessionId: "session", ...input });
  return { invoke, mail, workspace, desktop, scratch };
}

test("local IPC resolves and previews an absolute email outside the project", async (t) => {
  const { invoke, mail } = await fixture(t);
  const result = await invoke("fsResolveRef", { ref: mail });
  assert.equal(result.match?.absolutePath, mail);
  assert.equal(result.match.matchedBy, "exact-absolute");
  const preview = await invoke("fsRead", { path: mail });
  assert.equal(preview.kind, "text");
  assert.match(preview.content, /Subject: test fixture/);
});

test("local IPC opens and reveals an external file without a project", async (t) => {
  const { invoke, mail } = await fixture(t, { home: true });
  assert.equal((await invoke("fsResolveRef", { ref: mail })).match?.absolutePath, mail);
  assert.deepEqual(await invoke("fsOpen", { path: mail }), { ok: true });
  assert.equal(opened.at(-1), await realpath(mail));
  assert.deepEqual(await invoke("fsReveal", { path: mail }), { ok: true });
  assert.equal(revealed.at(-1), await realpath(mail));
});

test("external paths with spaces, line suffixes and symlinks resolve exactly", async (t) => {
  const { invoke, desktop, mail } = await fixture(t);
  const spaced = join(desktop, "mail copy.eml");
  await writeFile(spaced, "Subject: copy\n");
  assert.equal((await invoke("fsResolveRef", { ref: `@\"${spaced}\"` })).match?.absolutePath, spaced);
  assert.equal((await invoke("fsResolveRef", { ref: `${mail}:2` })).match?.absolutePath, mail);
  const link = join(desktop, "mail-link.eml");
  await symlink(mail, link);
  assert.equal((await invoke("fsResolveRef", { ref: link })).match?.absolutePath, link);
  assert.equal((await invoke("fsRead", { path: link })).kind, "text");
});

test("external images use the existing bounded image reader", async (t) => {
  const { invoke, desktop } = await fixture(t);
  const image = join(desktop, "pixel.png");
  await writeFile(image, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const result = await invoke("fsReadImageDataUrl", { ref: image });
  assert.equal(result.kind, "image");
  assert.match(result.dataUrl, /^data:image\/png;base64,/);
});

test("missing external files and directories are not resolved or opened", async (t) => {
  const { invoke, desktop } = await fixture(t);
  assert.equal((await invoke("fsResolveRef", { ref: join(desktop, "missing.eml") })).match, null);
  assert.equal((await invoke("fsResolveRef", { ref: desktop })).match, null);
  await assert.rejects(invoke("fsRead", { path: desktop }), /not a file/);
  await assert.rejects(invoke("fsOpen", { path: desktop }), /not a file/);
  await assert.rejects(invoke("fsOpen", { path: join(desktop, "missing.eml") }));
});

test("disk roots never participate in shorthand search or change shared guards", async (t) => {
  const { invoke, mail, workspace, scratch } = await fixture(t);
  assert.equal((await invoke("fsResolveRef", { ref: "paypal-lookalike.eml" })).match, null);
  const note = join(workspace, "note.md");
  await writeFile(note, "project wins");
  await writeFile(join(scratch, "note.md"), "scratch loses");
  assert.equal((await invoke("fsResolveRef", { ref: "note.md" })).match?.absolutePath, note);
  await assert.rejects(readOpenableFile(mail, workspace, []), /path outside allowed roots/);
});

test("remote sessions still route reads and references remotely and refuse local OS opening", async (t) => {
  const { invoke, mail } = await fixture(t, { remote: true });
  for (const [name, input, operation] of [
    ["fsRead", { path: mail }, "read"],
    ["fsReadImageDataUrl", { ref: mail }, "image"],
    ["fsResolveRef", { ref: mail }, "resolve"],
  ]) {
    assert.deepEqual(await invoke(name, input), { remote: true });
    assert.deepEqual(remoteCalls.at(-1), ["test-ssh", { path: "/remote/project", operation, ref: mail }]);
  }
  await assert.rejects(invoke("fsOpen", { path: mail }), /remote paths cannot be opened/);
  await assert.rejects(invoke("fsReveal", { path: mail }), /remote paths cannot be revealed/);
});

test("the renderer previews external IPC matches by absolute path outside project plugins", { timeout: 5000 }, async (t) => {
  const { invoke, mail, workspace } = await fixture(t);
  const store = moduleUrl(`
    export const state = { sessions: [], workspace: null, activeSessionId: 'session', showToast: () => {} };
    export const useAppStore = Object.assign((selector) => selector(state), { getState: () => state, setState: (update) => Object.assign(state, update) });
  `);
  const bridge = moduleUrl("export const api = {};");
  overrides.set("react", moduleUrl("export const useCallback = (callback) => callback;"));
  overrides.set("react-i18next", moduleUrl("export const useTranslation = () => ({ t: (key) => key });"));
  overrides.set("../stores/app-store", store);
  overrides.set("../lib/api", bridge);
  overrides.set("../plugins/renderer-slots/use-slots", moduleUrl("export const useSlotSessionId = () => '';"));
  overrides.set("../lib/chat-links", moduleUrl("export const isHtmlFilePath = () => false; export const toWorkspaceRel = () => { throw new Error('Unexpected relative path'); };"));
  overrides.set("../lib/open-http-url", stub("openHttpUrl"));
  const { state } = await import(store);
  state.workspace = { path: workspace };
  const { api } = await import(bridge);
  api.fsResolveRef = (ref) => invoke("fsResolveRef", { ref });
  api.listPluginViews = async () => [{ pluginId: "pi.file-manager", viewId: "manager" }];
  const destination = new Promise((resolve) => {
    state.openFileInWorkPanel = (path) => resolve({ kind: "host", path });
    state.openWorkPanelTab = (tab) => resolve({ kind: "plugin", tab });
  });
  const { useOpenChatFileRef } = await import("../src/hooks/use-preview-target.ts");
  useOpenChatFileRef()(mail);
  assert.deepEqual(await destination, { kind: "host", path: mail });
});
