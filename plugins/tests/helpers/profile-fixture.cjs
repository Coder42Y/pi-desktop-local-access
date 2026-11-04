"use strict";
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const plugin = require(process.env.SSH_UPLOAD_TEST_PLUGIN_MAIN || "../../ssh-upload/main.js");
const oldKey = session => createHash("sha256").update(`${session.sessionId.startsWith("remote:") ? session.sessionId.split(":").slice(0,2).join(":") : "local"}\n${session.projectPath || session.sessionId || "home"}`).digest("hex");
exports.oldKey = oldKey;
exports.fixture = async (t, initial = { profiles: "{}", unrelated: "keep" }) => {
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), "ssh-profile-test-"));
  const file = path.join(root, "settings.json"); await fs.writeFile(file, JSON.stringify(initial), { mode: 0o600 });
  let session = { sessionId: "chat-a", projectPath: "remote-project:alpha" };
  let hostKey = "host-a", remoteRoot = "/remote/alpha";
  const f = { root, file, plugin, writes: 0, writeFailure: false, readGate: null, metadataGate: null, dataReads: 0,
    session: () => ({ ...session }), set(next = {}) { if (next.sessionId !== undefined) session.sessionId = next.sessionId; if (Object.hasOwn(next,"projectPath")) session.projectPath = next.projectPath; if (next.hostKey !== undefined) hostKey = next.hostKey; if (next.root !== undefined) remoteRoot = next.root; },
    async read() { return JSON.parse(await fs.readFile(file,"utf8")); },
    async replace(value) { await fs.writeFile(file,JSON.stringify(value)); },
    context: () => plugin.onRendererCall("context"),
    save: (config = { target: "fixture-a" }, extra = {}) => plugin.onRendererCall("saveConfig", { sessionId: session.sessionId, config, ...extra }),
    async reload() { await plugin.onUnload(); await plugin.onLoad(); },
  };
  global.pi = { app: { getLocale: async () => "en" }, session: { getActive: async () => ({...session}) },
    plugin: { getSettings: async () => { const value = await f.read(); f.readEntered?.(); if(f.readGate)await f.readGate; return value; }, setSettings: async partial => { f.writes++; if(f.writeFailure)throw Error("synthetic write denied"); const current=await f.read();await f.replace({...current,...partial}); }, getDataPath: async()=>{ f.dataReads++;return path.join(root,"data"); } },
    desktop: { invoke: async input => { if(input.operation!=="project/get")throw Error("Unexpected desktop capability"); const value={workspace:{path:session.projectPath,remote:{hostKey,path:remoteRoot}}};f.metadataEntered?.();if(f.metadataGate)await (typeof f.metadataGate === "function" ? f.metadataGate() : f.metadataGate);return value; } },
  };
  t.after(async()=>{await plugin.onUnload();delete global.pi;await fs.rm(root,{recursive:true,force:true});});
  await plugin.onLoad(); return f;
};
