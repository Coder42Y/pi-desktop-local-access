"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs/promises"),path=require("node:path"),os=require("node:os"),{spawnSync}=require("node:child_process");
test("saved connection and per-project directory survive independent cold processes",async t=>{
 const root=await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR||os.tmpdir(),"ssh-cold-profile-"));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,"settings.json");await fs.writeFile(file,JSON.stringify({profiles:"{}",unrelated:"keep"}),{mode:0o600});
 const a={sessionId:"first-chat",projectPath:"remote-project:alpha",hostKey:"host-a",root:"/remote/alpha"};
 const run=(action,context,config={})=>{const child=spawnSync(process.execPath,[path.join(__dirname,"helpers/profile-child.cjs"),file,action,JSON.stringify(context),JSON.stringify(config)],{encoding:"utf8",timeout:10000});assert.equal(child.status,0,child.stderr);return JSON.parse(child.stdout);};
 assert.equal(run("save",a,{target:"fixture-a",port:2222,identity:"/fixture/keys/id_profile"}).ok,true);
 const resumed=run("read",{...a,sessionId:"second-chat"});assert.equal(resumed.context.configured,true);assert.equal(resumed.context.config.target,"fixture-a");assert.equal(resumed.context.config.port,2222);assert.equal(resumed.writes,0);
 const b={...a,sessionId:"third-chat",projectPath:"remote-project:beta",root:"/remote/beta"};const inherited=run("read",b);assert.equal(inherited.context.configured,true);assert.equal(inherited.context.config.directory,"/remote/beta/.pi-desktop/uploads");
 assert.equal(run("save",b,{...inherited.context.config,directory:"/remote/beta/artifacts"}).ok,true);
 assert.equal(run("read",{...b,sessionId:"fourth-chat"}).context.config.directory,"/remote/beta/artifacts");
 assert.equal(run("read",a).context.config.directory,"/remote/alpha/.pi-desktop/uploads");
 assert.equal(run("read",{...b,hostKey:"host-b"}).context.configured,false);
 const stored=JSON.parse(await fs.readFile(file,"utf8"));assert.equal(stored.unrelated,"keep");
 for(const record of Object.values(JSON.parse(stored.connections).hosts))assert.deepEqual(Object.keys(record).sort(),["identity","port","target"]);
});
