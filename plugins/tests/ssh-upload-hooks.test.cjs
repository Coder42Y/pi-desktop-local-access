"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {createHash} = require("node:crypto");

test("real hooks stay dormant locally and persist targets only for remote conversations", async (t) => {
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), "ssh-hooks-"));
  let session = { sessionId: "local-a", projectPath: "/project-a" };
  const localKey = createHash("sha256").update("local\n/project-a").digest("hex");
  let settings = { profiles: JSON.stringify({[localKey]:{target:"legacy-local-target"}}) }, deny = false, dataReads=0;
  let mismatch = false;
  global.pi = {
    app: { getLocale: async () => "zh-CN" }, session: { getActive: async () => session },
    desktop: {invoke:async input=>{assert.equal(input.operation,'project/get');return {workspace:{path:mismatch?'remote-project:other':session.projectPath,remote:{path:'/remote/project',hostKey:'ssh-host'}}};}},
    plugin: { getSettings: async () => settings, getDataPath: async () => {dataReads++;return root;},
      setSettings: async (next) => { if (deny) throw Error("settings locked"); settings = { ...settings, ...next }; },
    },
  };
  const plugin = require("../ssh-upload/main.js");
  t.after(async () => { await plugin.onUnload(); delete global.pi; await fs.rm(root, { recursive: true, force: true }); });
  await plugin.onLoad();
  const local = await plugin.onRendererCall("context");
  assert.equal(local.isRemote,false);
  assert.equal(local.config.target,"");
  assert.equal(dataReads,0);
  for(const [method,args] of [
    ["saveConfig",{sessionId:"local-a",config:{target:"server"}}],
    ["pasteBegin",{sessionId:"local-a",files:[{name:"x",size:0}]}],
    ["select",{}],
    ["start",{id:"none",config:{target:"server"}}],
  ]) await assert.rejects(plugin.onRendererCall(method,args),/remote/i);
  assert.equal(dataReads,0);
  session={sessionId:'11111111-1111-4111-8111-111111111111',projectPath:'remote-project:22222222-2222-4222-8222-222222222222'};
  const ssh=await plugin.onRendererCall('context');
  assert.equal(ssh.isRemote,true);
  assert.equal(ssh.config.directory,'/remote/project/.pi-desktop/uploads');
  assert.equal(ssh.configured,false);
  assert.equal(ssh.suggestedConfig.target,'legacy-local-target');
  await plugin.onRendererCall('saveConfig',{sessionId:session.sessionId,config:{target:'ssh-project-host'}});
  const configured=await plugin.onRendererCall('context');
  assert.equal(configured.configured,true);
  assert.equal(configured.config.workspaceRoot,'/remote/project');
  const staged=await plugin.onRendererCall('pasteBegin',{sessionId:session.sessionId,files:[{name:'REPORT.md',size:0}]});
  await plugin.onRendererCall('pasteCancel',{id:staged.id});
  mismatch=true;
  const rejected=await plugin.onRendererCall('context');
  assert.equal(rejected.configured,false);
  assert.match(rejected.configError,/project|workspace/i);
  await assert.rejects(plugin.onRendererCall('saveConfig',{sessionId:session.sessionId,config:{target:'wrong'}}),/project|workspace/i);
  mismatch=false;
  session = {sessionId:"remote:host-a:a",projectPath:"/project-a"};
  assert.equal((await plugin.onRendererCall("context")).isRemote,true);
  await plugin.onRendererCall("saveConfig", { sessionId: session.sessionId, config: { target: "server-a" } });
  assert.equal((await plugin.onRendererCall("context")).config.target, "server-a");
  await plugin.onUnload(); await plugin.onLoad();
  assert.equal((await plugin.onRendererCall("context")).config.target, "server-a");
  session = { sessionId: "remote:host-b:b", projectPath: "/project-b" };
  assert.equal((await plugin.onRendererCall("context")).config.target, "");
  await assert.rejects(plugin.onRendererCall("saveConfig", { sessionId: "remote:host-a:a", config: { target: "wrong-host" } }), /session/i);
  await assert.rejects(plugin.onRendererCall("start", { id: "unknown-job", config: { target: "wrong-host" } }), /job/i);
  assert.equal((await plugin.onRendererCall("context")).config.target, "");
  deny = true;
  await assert.rejects(plugin.onRendererCall("saveConfig", { sessionId: session.sessionId, config: { target: "server-b" } }), /locked/);
  assert.equal((await plugin.onRendererCall("context")).config.target, "");
});
