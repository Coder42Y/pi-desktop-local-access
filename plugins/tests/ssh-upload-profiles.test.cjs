"use strict";
const test=require("node:test"), assert=require("node:assert/strict");
const {fixture,oldKey}=require("./helpers/profile-fixture.cjs");

test("one saved server connection serves new conversations and independent project folders",async t=>{
 const f=await fixture(t);await f.save({target:"fixture-a",port:2222,identity:""});
 f.set({sessionId:"chat-a-two"});assert.equal((await f.context()).configured,true);
 f.set({sessionId:"chat-b",projectPath:"remote-project:beta",root:"/remote/beta"});
 const b=await f.context();assert.equal(b.configured,true);assert.equal(b.config.target,"fixture-a");assert.equal(b.config.port,2222);assert.equal(b.config.directory,"/remote/beta/.pi-desktop/uploads");
 assert.equal(f.writes,1,"context reads must not rewrite settings");
 await f.save({...b.config,directory:"/remote/beta/artifacts"});
 f.set({projectPath:"remote-project:alpha",root:"/remote/alpha"});assert.equal((await f.context()).config.directory,"/remote/alpha/.pi-desktop/uploads");
 await f.reload();f.set({projectPath:"remote-project:beta",root:"/remote/beta"});assert.equal((await f.context()).config.directory,"/remote/beta/artifacts");
 f.set({root:"/remote/beta-moved"});assert.equal((await f.context()).config.directory,"/remote/beta-moved/artifacts");
 assert.equal((await f.read()).unrelated,"keep");assert.equal(f.dataReads,0);
});

test("a changed server cannot inherit the old server target even with the same project ID",async t=>{
 const f=await fixture(t);await f.save({target:"fixture-a",directory:"/remote/alpha/custom-a"});
 f.set({hostKey:"host-b"});const b=await f.context();assert.equal(b.configured,false);assert.equal(b.suggestedConfig,null);
 await f.save({target:"fixture-b",directory:"/remote/alpha/custom-b"});
 f.set({hostKey:"host-a"});const a=await f.context();assert.equal(a.config.target,"fixture-a");assert.equal(a.config.directory,"/remote/alpha/custom-a");
});

test("old project targets need one explicit promotion, then survive reload and serve another project",async t=>{
 const session={sessionId:"chat-a",projectPath:"remote-project:alpha"};
 const old={target:"old-fixture",port:2200,directory:"/remote/alpha/custom",identity:"",workspaceRoot:"/remote/alpha"};
 const initial={profiles:JSON.stringify({[oldKey(session)]:old}),unrelated:"keep"};
 const f=await fixture(t,initial);const before=await f.context();assert.equal(before.configured,false);assert.equal(before.suggestedConfig.target,"old-fixture");assert.equal(f.writes,0);
 await f.save(before.suggestedConfig);await f.reload();
 assert.equal((await f.context()).configured,true);
 f.set({sessionId:"chat-b",projectPath:"remote-project:beta",root:"/remote/beta"});const b=await f.context();assert.equal(b.configured,true);assert.equal(b.config.target,"old-fixture");assert.equal(b.config.directory,"/remote/beta/.pi-desktop/uploads");
 assert.ok(JSON.parse((await f.read()).profiles)[oldKey(session)]);
});

test("malformed saved JSON fails visibly and is not overwritten by a save",async t=>{
 const initial={profiles:"{broken",unrelated:"keep"};const f=await fixture(t,initial);
 assert.ok((await f.context()).configError);await assert.rejects(f.save());assert.deepEqual(await f.read(),initial);assert.equal(f.writes,0);
});

test("failed settings writes do not enable unsaved targets and can be retried",async t=>{
 const f=await fixture(t);await f.save({target:"fixture-a"});const before=await f.read();
 f.writeFailure=true;await assert.rejects(f.save({target:"unsaved-fixture"}));assert.deepEqual(await f.read(),before);
 assert.equal((await f.context()).config.target,"fixture-a");f.writeFailure=false;await f.save({target:"saved-fixture"});assert.equal((await f.context()).config.target,"saved-fixture");
});

test("a stale settings read cannot save into a newly selected project",{timeout:5000},async t=>{
 const f=await fixture(t);let release;f.readGate=new Promise(r=>{release=r;});
 const entered=new Promise(r=>{f.readEntered=r;});
 const pending=f.save({target:"fixture-a"});
 await entered;f.set({sessionId:"chat-b",projectPath:"remote-project:beta",root:"/remote/beta"});release();
 await assert.rejects(pending);assert.equal(f.writes,0);
});

test("legacy remote sessions retain their original per-context behavior",async t=>{
 const f=await fixture(t);f.set({sessionId:"remote:old-host:one",projectPath:null});await f.save({target:"legacy-fixture",directory:"~/uploads"});
 await f.reload();assert.equal((await f.context()).configured,true);
 f.set({sessionId:"remote:old-host:two"});assert.equal((await f.context()).configured,false);
});

test("serialized saves retain both project records without lost updates",async t=>{
 const f=await fixture(t);const {createProfileStore,createContext}=require("../ssh-upload/profiles.cjs");
 let entered,release;const firstWrite=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});let writes=0;
 const store=createProfileStore({readSettings:()=>f.read(),writeSettings:async partial=>{writes++;if(writes===1){entered();await gate;}await f.replace({...await f.read(),...partial});}});t.after(()=>store.dispose());
 const make=(id,root)=>createContext({sessionId:id,projectPath:'remote-project:'+id},{path:'remote-project:'+id,remote:{hostKey:'shared-host',path:root}});
 const a=make('alpha','/remote/alpha'),b=make('beta','/remote/beta');
 const one=store.save(a,{target:'fixture-host'}),two=store.save(b,{target:'fixture-host',directory:'/remote/beta/output'});
 await firstWrite;assert.equal(writes,1);release();await Promise.all([one,two]);
 const raw=await f.read();assert.equal(Object.keys(JSON.parse(raw.connections).hosts).length,1);assert.equal(Object.keys(JSON.parse(raw.projectDirectories).projects).length,2);
 assert.equal((await store.resolve(a)).config.directory,'/remote/alpha/.pi-desktop/uploads');assert.equal((await store.resolve(b)).config.directory,'/remote/beta/output');
});

test("unknown storage versions, unsafe directory records and password input fail closed",async t=>{
 const f=await fixture(t);await f.save();const original=await f.read();
 for(const mutate of [
  raw=>{const value=JSON.parse(raw.connections);value.version=99;raw.connections=JSON.stringify(value);},
  raw=>{const value=JSON.parse(raw.connections);Object.values(value.hosts)[0].port=[22];raw.connections=JSON.stringify(value);},
  raw=>{const value=JSON.parse(raw.projectDirectories);Object.values(value.projects)[0].relativeDirectory='../outside';raw.projectDirectories=JSON.stringify(value);},
 ]){
  const changed=structuredClone(original);mutate(changed);await f.replace(changed);const before=f.writes;
  assert.ok((await f.context()).configError);await assert.rejects(f.save(),{code:'SSH_SETTINGS_INVALID'});assert.deepEqual(await f.read(),changed);assert.equal(f.writes,before);
 }
 await f.replace(original);await assert.rejects(f.save({target:'fixture-host',password:'synthetic-not-a-real-password'}),{code:'SSH_SETTINGS_INVALID'});assert.deepEqual(await f.read(),original);
});

test("stale forms and same-session server changes cannot save a target",async t=>{
 const f=await fixture(t);const old=await f.context();f.set({hostKey:'host-b'});
 await assert.rejects(f.save({target:'fixture-host'},{bindingKey:old.bindingKey}),{code:'SSH_CONTEXT_CHANGED'});assert.equal(f.writes,0);
 let release;f.readGate=new Promise(r=>{release=r;});const entered=new Promise(r=>{f.readEntered=r;});
 const pending=f.save();await entered;f.set({hostKey:'host-c'});release();await assert.rejects(pending,{code:'SSH_CONTEXT_CHANGED'});assert.equal(f.writes,0);
});

test("an unloaded plugin cannot commit a queued old settings operation",async t=>{
 const f=await fixture(t);let release;f.readGate=new Promise(r=>{release=r;});const entered=new Promise(r=>{f.readEntered=r;});
 const pending=f.save();await entered;await f.plugin.onUnload();release();await assert.rejects(pending,{code:'SSH_PLUGIN_UNLOADED'});assert.equal(f.writes,0);
 f.readGate=null;f.readEntered=null;await f.plugin.onLoad();assert.equal((await f.context()).configured,false);
});

test("active paste blocks settings changes and a changed binding cannot finalize bytes",async t=>{
 const f=await fixture(t);await f.save();const current=await f.context();
 const job=await f.plugin.onRendererCall('pasteBegin',{sessionId:f.session().sessionId,configurationKey:current.configurationKey,files:[{name:'fixture.txt',size:0}]});
 await assert.rejects(f.save({target:'changed-host'}),{code:'SSH_SETTINGS_BUSY'});
 f.set({hostKey:'host-b'});await assert.rejects(f.plugin.onRendererCall('pasteFinish',{id:job.id}),{code:'SSH_CONFIGURATION_CHANGED'});
 assert.equal((await f.plugin.onRendererCall('pastePoll',{id:job.id})).state,'receiving');await f.plugin.onRendererCall('pasteCancel',{id:job.id});
});

test("unrelated legacy fields never enter renderer configuration",async t=>{
 const session={sessionId:'remote:old-host:one',projectPath:null};
 const initial={profiles:JSON.stringify({[oldKey(session)]:{target:'',directory:'~/uploads',unrelatedSecret:'synthetic-do-not-render'}})};
 const f=await fixture(t,initial);f.set(session);const c=await f.context();assert.equal(c.configured,false);assert.equal(Object.hasOwn(c.config,'unrelatedSecret'),false);assert.deepEqual(await f.read(),initial);
 await f.save({target:'legacy-fixture',directory:'~/uploads'});assert.equal(JSON.parse((await f.read()).profiles)[oldKey(session)].unrelatedSecret,'synthetic-do-not-render');assert.equal(Object.hasOwn((await f.context()).config,'unrelatedSecret'),false);
});

test("pending save and upload admission are mutually exclusive",{timeout:5000},async t=>{
 const f=await fixture(t);let release;f.readGate=new Promise(r=>{release=r;});const entered=new Promise(r=>{f.readEntered=r;});
 const saving=f.save();await entered;
 await assert.rejects(f.plugin.onRendererCall('pasteBegin',{sessionId:f.session().sessionId,files:[{name:'fixture.txt',size:0}]}),{code:'SSH_OPERATION_BUSY'});
 assert.equal(f.dataReads,0);release();await saving;f.readGate=null;f.readEntered=null;
 const job=await f.plugin.onRendererCall('pasteBegin',{sessionId:f.session().sessionId,files:[{name:'fixture.txt',size:0}]});
 await assert.rejects(f.save(),{code:'SSH_SETTINGS_BUSY'});assert.equal(f.writes,1);await f.plugin.onRendererCall('pasteCancel',{id:job.id});
});

test("a save cannot overtake an upload already awaiting project metadata",{timeout:5000},async t=>{
 const f=await fixture(t);await f.save();const before=await f.read();let release;f.metadataGate=new Promise(r=>{release=r;});const entered=new Promise(r=>{f.metadataEntered=r;});
 const starting=f.plugin.onRendererCall('pasteBegin',{sessionId:f.session().sessionId,files:[{name:'fixture.txt',size:0}]});await entered;
 await assert.rejects(f.save({target:'wrong-overlap'}),{code:'SSH_OPERATION_BUSY'});assert.deepEqual(await f.read(),before);
 release();const job=await starting;await f.plugin.onRendererCall('pasteCancel',{id:job.id});assert.equal(f.writes,1);
});

test("save metadata resolution excludes a newly requested paste admission",{timeout:5000},async t=>{
 const f=await fixture(t);await f.save();let entered,release;const reached=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});let first=true;
 f.metadataGate=()=>{if(first){first=false;entered();return gate;}return Promise.resolve();};
 const saving=f.save({target:'updated-fixture'});const settled=saving.catch(e=>e);await reached;
 try{await assert.rejects(f.plugin.onRendererCall('pasteBegin',{sessionId:f.session().sessionId,files:[{name:'fixture.txt',size:0}]}),{code:'SSH_OPERATION_BUSY'});assert.equal(f.dataReads,0);}
 finally{release();await settled;}
 assert.equal(f.writes,2);
});
