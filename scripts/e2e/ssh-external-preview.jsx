import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import { remoteEn } from "../../apps/desktop/src/locales/remote";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import { useOpenPreviewTarget, useOpenChatFileRef } from "../../apps/desktop/src/hooks/use-preview-target";
import { RemoteWorkspace } from "../../apps/desktop/src/components/remote/RemoteWorkspace";
import { FilesTab } from "../../apps/desktop/src/components/workpanel/FilesTab";

const ready = i18n.use(initReactI18next).init({ lng: "en", fallbackLng: "en", resources: { en: { translation: catalogs.en, remote: remoteEn } }, interpolation: { escapeValue: false } });
const config = globalThis.fixtureConfig;
const calls = [];
let mode = "legacy";
globalThis.lastToast = null;
window.piDesktop = {
  platform: "linux", on: () => () => {},
  async invoke(channel, ...args) {
    calls.push({ channel, args });
    return fetch("/rpc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, channel, args }) }).then(r => r.json());
  },
};
const capability = { canPrompt: true, canReadWorkspace: true, canUseLocalTools: false };
function initialize(nextMode, suffix = "one") {
  mode = nextMode;
  const id = nextMode === "legacy" ? `remote:fixture:${suffix}` : `workspace-${suffix}`;
  const session = { id, ...(nextMode === "legacy" ? { source: "remote", capabilities: capability } : { remoteWorkspace: { hostKey: "fixture", path: config.workspace } }), title: "Synthetic", mode: "agent", messageCount: 0 };
  useAppStore.setState({ sessions: [session], activeSessionId: id, workPanelTabs: [], activeWorkPanelTabId: null, workPanelFileRequest: null, workPanelContexts: {},
    workspace: nextMode === "legacy" ? { path: "/unused-local-project" } : { path: "remote-project:fixture", remote: { hostKey: "fixture", path: config.workspace } },
    showToast: message => { globalThis.lastToast = message; }, pluginViews: [], workPanelOpen: true });
  globalThis.lastToast = null;
}
function View() {
  const open = useOpenPreviewTarget(); const openRef = useOpenChatFileRef();
  const session = useAppStore(s => s.sessions[0]);
  return <main data-session={session.id}><button id="text" onClick={() => open({ kind: "file", path: config.note })}>Open text</button>
    <button id="image" onClick={() => open({ kind: "file", path: config.image })}>Open image</button>
    <button id="denied" onClick={() => open({ kind: "file", path: config.denied })}>Open denied</button>
    <button id="missing" onClick={() => open({ kind: "file", path: config.missing })}>Open missing</button>
    <button id="slow" onClick={() => open({ kind: "file", path: config.slow })}>Open slow</button>
    <button id="native" onClick={() => openRef(config.note, undefined, undefined, { destination: "reveal-in-folder" })}>Native reveal</button>
    {mode === "legacy" ? <RemoteWorkspace key={session.id} session={session} width={500} /> : <FilesTab key={session.id} />}</main>;
}
function until(predicate) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    function check() {
      if (predicate()) return resolve();
      if (performance.now() - started > 10000) return reject(new Error("isolated UI assertion timed out"));
      requestAnimationFrame(check);
    }
    check();
  });
}
const root = createRoot(document.getElementById("root"));
globalThis.previewProbe = {
  async initialize(nextMode, suffix = "one") { await ready; initialize(nextMode, suffix); root.render(<View />); await until(() => document.querySelector("main[data-session]")?.getAttribute("data-session") === useAppStore.getState().activeSessionId); },
  async text() { document.getElementById("text").click(); await until(() => document.body.textContent.includes("SYNTHETIC_EXTERNAL_TEXT")); return true; },
  async image() { document.getElementById("image").click(); await until(() => [...document.querySelectorAll("img")].some(i => i.src.startsWith("data:image/png;base64,") && i.complete && i.naturalWidth === 1)); return true; },
  async back() { const b = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Back to files"); if (!b) throw new Error("preview has no return-to-files action"); b.click(); await until(() => [...document.querySelectorAll("button")].some(b => b.textContent.trim() === "sibling.txt")); },
  async sibling() { [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "sibling.txt").click(); await until(() => document.body.textContent.includes("SYNTHETIC_PROJECT_SIBLING")); },
  async denied() { document.getElementById("denied").click(); await until(() => document.querySelector('[role="alert"]')?.textContent.includes("denied")); },
  async missing() { globalThis.lastToast = null; document.getElementById("missing").click(); await until(() => globalThis.lastToast); return globalThis.lastToast; },
  async native() { globalThis.lastToast = null; document.getElementById("native").click(); await until(() => globalThis.lastToast); return calls.filter(c => /fs\/(open|reveal)$/.test(c.channel)).length; },
  slow() { document.getElementById("slow").click(); return true; },
  async settled() { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return !document.body.textContent.includes("SYNTHETIC_LATE_RESPONSE"); },
  calls() { return calls; },
};
