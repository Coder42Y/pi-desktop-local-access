import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { createServer } from "vite";
import { repositoryRoot, resolveElectronBinary } from "../../../scripts/e2e/boot.mjs";

const root = repositoryRoot();
const chromiumBinary = [process.env.PI_TEST_CHROMIUM, "/snap/bin/chromium", "/usr/bin/chromium"].find((path) => path && existsSync(path));
const { build } = createRequire(join(root, "packages/agent-runtime/package.json"))("esbuild");
const fixture = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { catalogs, flattenCatalog } from "@pi-desktop/i18n";
import { PermissionCard } from "../../apps/desktop/src/components/PermissionCard";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";

await i18n.use(initReactI18next).init({ lng: "en", keySeparator: false,
  resources: Object.fromEntries(["en", "zh-CN"].map(locale =>
    [locale, { translation: flattenCatalog(catalogs[locale]) }])),
  interpolation: { escapeValue: false } });
window.piDesktop = { platform: "linux", on() { return () => {}; },
  invoke() { throw new Error("Unexpected IPC in permission card test"); } };
const decisions = [];
useAppStore.setState({ sessions: [{ id: "session", projectPath: "/workspace" }],
  resolvePermission: async (...args) => { decisions.push(args); },
  showToast: (message) => { throw new Error(message); },
});
const rootNode = createRoot(document.getElementById("root"));
const check = (condition, message) => { if (!condition) throw new Error(message); };
const buttons = () => [...document.querySelectorAll("button")];
const labels = () => buttons().map(button => button.textContent.trim());
let request = 0;
function render(externalAccess) {
  flushSync(() => rootNode.render(React.createElement(PermissionCard, {
    key: ++request,
    permission: { sessionId: "session", requestId: "request-" + request,
      toolCallId: "call", toolName: "Write", argsPreview: {}, risk: "high",
      reason: "", ...(externalAccess ? { externalAccess } : {}) },
  })));
}
async function click(label, decision) {
  const button = buttons().find(button => button.textContent.trim() === label);
  check(button, "missing action: " + label);
  const previous = decisions.length;
  flushSync(() => button.click());
  await Promise.resolve();
  check(decisions.length === previous + 1, "decision count incorrect");
  check(JSON.stringify(decisions.at(-1)) === JSON.stringify([
    "session", "request-" + request, decision]), "wrong decision scope");
}
window.permissionProbe = async () => {
  render({ kind: "filesystem-write" });
  check(decisions.length === 0, "permission was accepted automatically");
  check(JSON.stringify(labels()) === JSON.stringify([
    "Deny", "Grant outside-workspace access for this conversation"]),
    "scoped card must offer only explicit conversation grant and deny: " + labels());
  let text = document.body.textContent;
  for (const phrase of ["ANY accessible file", "modify, write, or delete", "outside the current workspace",
    "current conversation and its subagents", "this machine", "subsequent Write/Edit/Bash", "without asking again"])
    check(text.includes(phrase), "missing scope explanation: " + phrase);
  await click("Grant outside-workspace access for this conversation", "allow-session");
  const host = '<remote & {{untrusted}}>';
  render({ kind: "filesystem-write", hostKey: host });
  check(document.body.textContent.includes(host), "remote host must be shown as literal data");
  check(!document.querySelector("remote"), "host was interpreted as markup");
  check(document.body.textContent.includes("SSH host"), "remote target is not labeled");
  await click("Deny", "deny");
  render();
  check(JSON.stringify(labels()) === JSON.stringify(["Deny", "Allow for this chat", "Allow once"]),
    "legacy permission actions changed");
  check(document.body.textContent.includes("Allow Write to run?"), "legacy prompt changed");
  await click("Allow once", "allow-once");
  render();
  await click("Allow for this chat", "allow-session");
  render();
  await click("Deny", "deny");
  await i18n.changeLanguage("zh-CN");
  render({ kind: "filesystem-write" });
  text = document.body.textContent;
  for (const phrase of ["任意可访问文件", "修改、写入或删除", "当前对话及其子智能体", "本机", "Write/Edit/Bash", "不再重复询问"])
    check(text.includes(phrase), "missing Chinese scope: " + phrase);
  check(labels().length === 2, "Chinese scoped actions changed");
  await click("授权本次对话访问工作区外文件", "allow-session");
  flushSync(() => rootNode.unmount());
  return { passed: true };
};
`;
test("actual PermissionCard renders conversation-wide scope without changing legacy actions", async (t) => {
  const server = await createServer({ root: join(root, "apps/desktop"), configFile: false,
    logLevel: "silent", server: { middlewareMode: true, hmr: false, ws: false },
    esbuild: { jsx: "automatic" }, appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] } });
  t.after(() => server.close());
  const { PermissionCard } = await server.ssrLoadModule("/src/components/PermissionCard.tsx");
  const { en } = await server.ssrLoadModule("/@fs/" + join(root, "packages/i18n/src/locales/en/index.ts"));
  const { zhCN } = await server.ssrLoadModule("/@fs/" + join(root, "packages/i18n/src/locales/zh-CN/index.ts"));
  const i18n = createInstance();
  await i18n.init({ lng: "en", resources: { en: { translation: en }, "zh-CN": { translation: zhCN } } });
  const permission = { sessionId: "s", requestId: "r", toolCallId: "c", toolName: "Write",
    argsPreview: {}, risk: "high", reason: "" };
  const render = (extra = {}) => renderToStaticMarkup(createElement(I18nextProvider, { i18n },
    createElement(PermissionCard, { permission: { ...permission, ...extra } })));
  const scoped = render({ externalAccess: { kind: "filesystem-write" } });
  assert.equal((scoped.match(/<button/g) || []).length, 2);
  assert.doesNotMatch(scoped, /Allow once|Allow for this chat/);
  for (const phrase of ["ANY accessible file", "modify, write, or delete", "outside the current workspace",
    "current conversation and its subagents", "this machine", "subsequent Write/Edit/Bash", "without asking again"])
    assert.ok(scoped.includes(phrase), phrase);
  const remote = render({ externalAccess: { kind: "filesystem-write", hostKey: "<host&>" } });
  assert.match(remote, /SSH host/);
  assert.match(remote, /&lt;host&amp;&gt;/);
  const ordinary = render();
  assert.equal((ordinary.match(/<button/g) || []).length, 3);
  assert.match(ordinary, /Allow once/);
  assert.match(ordinary, /Allow for this chat/);
  assert.match(ordinary, /Deny/);
  await i18n.changeLanguage("zh-CN");
  const chinese = render({ externalAccess: { kind: "filesystem-write" } });
  for (const phrase of ["任意可访问文件", "修改、写入或删除", "当前对话及其子智能体", "本机", "Write/Edit/Bash", "不再重复询问"])
    assert.ok(chinese.includes(phrase), phrase);
  assert.equal((chinese.match(/<button/g) || []).length, 2);
  assert.match(chinese, /授权本次对话访问工作区外文件/);

});

test("external filesystem permission renders host scope and dispatches explicit decisions", {
  skip: chromiumBinary ? false : !existsSync(join(root, "apps/desktop/node_modules/electron/dist",
    process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron"))
    ? "Electron runtime not provisioned; rendered SSR coverage runs above"
    : process.platform === "linux" && !process.env.DISPLAY ? "Electron requires a display" : false,
}, async () => {
  await mkdir(process.env.PI_SCRATCH_DIR || join(root, ".pi-desktop-test"), { recursive: true });
  const temp = await mkdtemp(join(process.env.PI_SCRATCH_DIR || join(root, ".pi-desktop-test"), "pi-permission-ui-"));
  try {
    await build({
      stdin: { contents: fixture, resolveDir: join(root, "scripts/e2e"), loader: "tsx" },
      outfile: join(temp, "renderer.js"),
      bundle: true,
      platform: "browser",
      format: "esm",
      jsx: "automatic",
      loader: { ".css": "empty" },
      define: { "process.env.NODE_ENV": '"production"' },
      alias: {
        "@pi-desktop/i18n": join(root, "packages/i18n/src"),
        "@pi-desktop/shared": join(root, "packages/shared/src"),
        react: join(root, "apps/desktop/node_modules/react"),
        "react-dom": join(root, "apps/desktop/node_modules/react-dom"),
        i18next: join(root, "apps/desktop/node_modules/i18next"),
        "react-i18next": join(root, "apps/desktop/node_modules/react-i18next"),
      },
      nodePaths: [join(root, "apps/desktop/node_modules")],
    });
    await writeFile(join(temp, "index.html"),
      '<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="renderer.js"></script>');
    if (chromiumBinary) {
      await writeFile(join(temp, "index.html"), `<!doctype html><meta charset="utf-8"><div id="root"></div>
<script type="module">
try {
  await import("./renderer.js");
  await window.permissionProbe();
  await fetch("/result", { method: "POST", body: JSON.stringify({ passed: true }) });
} catch (error) {
  await fetch("/result", { method: "POST", body: JSON.stringify({ passed: false, error: String(error?.stack ?? error) }) });
}
</script>`);
      let reportResult;
      const result = new Promise((resolve) => { reportResult = resolve; });
      const server = createHttpServer(async (request, response) => {
        if (request.url === "/result" && request.method === "POST") {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          try {
            reportResult(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            response.end("ok");
          } catch {
            response.writeHead(400).end();
          }
          return;
        }
        const file = request.url === "/renderer.js" ? "renderer.js" : "index.html";
        try {
          response.setHeader("content-type", file.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8");
          response.end(await readFile(join(temp, file)));
        } catch { response.writeHead(500).end(); }
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      let child;
      let exited;
      let output = "";
      let deadline;
      try {
        child = spawn(chromiumBinary, ["--headless", "--disable-gpu", "--no-first-run",
          ...(process.platform === "linux" && process.env.CI === "true" ? ["--no-sandbox"] : []),
          "--disable-background-networking",
          `--user-data-dir=${join(temp, "chromium-profile")}`, `http://127.0.0.1:${server.address().port}/`],
          { stdio: ["ignore", "pipe", "pipe"] });
        for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => { output += chunk; });
        exited = new Promise((resolve) => {
          child.once("error", (error) => resolve({ passed: false, error: error.message }));
          child.once("close", (code) => resolve({ passed: false, error: `browser exited with ${code}` }));
        });
        const timedOut = new Promise((resolve) => {
          deadline = setTimeout(() => resolve({ passed: false, error: "browser scenario timed out" }), 60000);
        });
        const observed = await Promise.race([result, exited, timedOut]);
        assert.equal(observed.passed, true, JSON.stringify(observed) + "\n" + output.slice(-6000));
      } finally {
        clearTimeout(deadline);
        if (child && child.exitCode === null) {
          child.kill();
          const forceStop = setTimeout(() => child.kill("SIGKILL"), 5000);
          try { await exited; } finally { clearTimeout(forceStop); }
        }
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      return;
    }
    await writeFile(join(temp, "main.cjs"), `
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.setPath("userData", path.join(__dirname, "profile"));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 640, height: 480,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  try {
    await win.loadFile(path.join(__dirname, "index.html"));
    console.log("PERMISSION_PROBE " + JSON.stringify(await win.webContents.executeJavaScript("window.permissionProbe()")));
    app.exit(0);
  } catch (error) { console.error(error?.stack ?? error); app.exit(1); }
});`);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(resolveElectronBinary(root).electronBinary, [join(temp, "main.cjs")], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => { output += chunk; });
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), 45_000);
    let code;
    try {
      code = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
    } finally {
      clearTimeout(timer);
    }
    assert.equal(code, 0, output.slice(-6000));
    const line = output.split(/\r?\n/).find((item) => item.startsWith("PERMISSION_PROBE "));
    assert.ok(line, output.slice(-6000));
    assert.deepEqual(JSON.parse(line.slice("PERMISSION_PROBE ".length)), {
      passed: true,
    });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
