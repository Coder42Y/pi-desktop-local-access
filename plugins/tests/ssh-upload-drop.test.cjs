"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const {createHash,randomBytes} = require("node:crypto");
const {spawn,spawnSync} = require("node:child_process");
const {build} = require("esbuild");
const {chromium,expect} = require("@playwright/test");
const {createPasteStore} = require("../ssh-upload/paste-store.cjs");
const {uploadFile,sshArgs,validateConfig} = require("../ssh-upload/transfer.cjs");

test("Finder-style drop in a UUID SSH project uploads instead of creating a native Mac attachment", {timeout:30000}, async t => {
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(),"ssh-drop-"));
  const source = path.join(root,"REPORT.md");
  const bytes = randomBytes(22101);
  await fs.writeFile(source,bytes);
  const real = process.env.SSH_UPLOAD_REAL_TEST === "1";
  let config, configured=true, release, begins=0;
  let localMode=false, releaseMetadata, metadataFail=false;
  let metadataHold=new Promise(resolve=>{releaseMetadata=resolve;});
  const hold = new Promise(resolve=>{release=resolve;});
  if(real) {
    const settings=JSON.parse(await fs.readFile(path.join(os.homedir(),".pi-desktop/plugins/data/local.ssh-upload/settings.json"),"utf8"));
    const values=Object.values(JSON.parse(settings.profiles||"{}"));
    if(values.length!==1) throw Error("Real probe requires one unambiguous configured destination");
    config=validateConfig({...values[0],directory:"/remote/project/.pi-desktop/uploads",workspaceRoot:"/remote/project"});
  } else {
    const workspaceRoot=path.join(root,"workspace");await fs.mkdir(workspaceRoot);
    config=validateConfig({target:"test",directory:path.join(workspaceRoot,".pi-desktop/uploads"),workspaceRoot});
  }
  const sessionId="11111111-1111-4111-8111-111111111111";
  const projectPath="remote-project:22222222-2222-4222-8222-222222222222";
  const store=createPasteStore({dataPath:path.join(root,"staging"),getSession:async()=>({sessionId,projectPath}),getConfig:()=>config,
    uploadFile:async(file,cfg,opts)=>{await hold;return uploadFile(file,cfg,real?opts:{...opts,spawnSsh:args=>spawn("/bin/sh",["-c",args.at(-1)])});},
  });
  const quote=value=>"'"+value.replace(/'/g,"'\"'\"'")+"'";
  const ssh=(command,binary=false)=>{
    const env={...process.env};
    if(!env.SSH_AUTH_SOCK){const p=spawnSync('/bin/launchctl',['getenv','SSH_AUTH_SOCK'],{encoding:'utf8',timeout:1000});if(p.stdout?.trim().startsWith('/'))env.SSH_AUTH_SOCK=p.stdout.trim();}
    return spawnSync('/usr/bin/ssh',sshArgs(config,command),{env,timeout:15000,maxBuffer:512*1024,...(binary?{}:{encoding:'utf8'})});
  };
  t.after(async()=>{
    releaseMetadata();release();await store.dispose();
    if(real) for(const result of store.current()?.results||[]) {
      assert.equal(path.posix.basename(result.path),'REPORT.md');
      assert.match(path.posix.dirname(result.path),/^\/home\/why\/C\/\.pi-desktop\/uploads\/pi-upload-[a-f0-9-]{36}$/);
      const cleaned=ssh(`rm -f -- ${quote(result.path)} && rmdir -- ${quote(path.posix.dirname(result.path))}`);
      assert.equal(cleaned.status,0,cleaned.stderr);
    }
    await fs.rm(root,{recursive:true,force:true});
  });
  const entry=path.resolve(__dirname,'../ssh-upload/renderer/paste.mjs');
  const built=await build({stdin:{contents:`
    import {installPasteBridge} from ${JSON.stringify(entry)};
    import {zh} from ${JSON.stringify(path.resolve(__dirname,'../ssh-upload/renderer/locales.mjs'))};
    window.nativeDrops=0;window.sends=0;window.draftGeneration=0;
    document.getElementById('editor').addEventListener('input',()=>window.draftGeneration++);
    document.addEventListener('drop',event=>{window.nativeDrops++;window.nativeFileSame=event.dataTransfer.files[0]===document.getElementById('source').files[0];});
    document.getElementById('send').addEventListener('click',()=>window.sends++);
    window.bridge=installPasteBridge({readDraft:async()=>({generation:window.draftGeneration}),call:(method,args)=>window.hostRPC(method,args),labels:()=>zh,onStatus:value=>{window.statusValue=value;}});
    window.dropReport=()=>{
      const data=new DataTransfer();data.items.add(document.getElementById('source').files[0]);
      const target=document.getElementById('drop-zone');
      target.dispatchEvent(new DragEvent('dragover',{dataTransfer:data,bubbles:true,cancelable:true}));
      return target.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));
    };
  `,resolveDir:path.resolve(__dirname,'../..')},bundle:true,write:false,format:'iife'});
  const server=http.createServer((req,res)=>{
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(built.outputFiles[0].contents);}
    else {res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><div class="composer-shell"><div id="drop-zone" class="composer-input-stage"><div id="editor" class="composer-input" role="textbox" contenteditable="true">Keep this draft. </div></div><button id="send" class="send-btn">Send</button></div><input id="source" type="file"><script src="/app.js"></script>');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await require("./helpers/browser.cjs").launchBrowser(chromium);
  t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage();page.setDefaultTimeout(4000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.exposeFunction('hostRPC',async(method,args={})=>{
    if(method==='context'){if(metadataFail)throw Error('metadata unavailable');const snapshot={sessionId:localMode?'local-id':sessionId,projectPath:localMode?'/local-project':projectPath,configured,config:configured?config:{target:''},locale:'zh-CN'};await metadataHold;return snapshot;}
    if(method==='pasteBegin'){begins++;return store.begin(args);}
    if(method==='pasteChunk')return store.chunk(args);
    if(method==='pasteFinish')return store.finish(args.id);
    if(method==='pastePoll')return store.poll(args.id);
    if(method==='pasteCancel')return store.cancel(args.id);
    throw Error('Unknown method');
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#source').setInputFiles(source);
  await page.evaluate(()=>window.dropReport());
  assert.equal(await page.evaluate(()=>window.nativeDrops),0,'Drop escaped to native attachment handling');
  releaseMetadata();await page.evaluate(()=>window.bridge.ready);
  await expect(page.locator('#editor')).toContainText('SSH-upload:');
  await page.locator('#send').click();assert.equal(await page.evaluate(()=>window.sends),0);
  release();
  await expect.poll(()=>page.evaluate(()=>window.statusValue?.state),{timeout:real?20000:5000}).toBe('done');
  const result=store.current().results[0];
  const expected=createHash('sha256').update(bytes).digest('hex');assert.equal(result.sha256,expected);
  if(real){
    const read=ssh(`cat -- ${quote(result.path)}`,true);assert.equal(read.status,0,read.stderr?.toString());
    assert.equal(createHash('sha256').update(read.stdout).digest('hex'),expected);
    t.diagnostic(`REAL SSH DROP: ${bytes.length} bytes, SHA-256 ${expected}, workspace-contained path; remote readback verified`);
  } else assert.deepEqual(await fs.readFile(result.path),bytes);
  await expect(page.locator('#editor')).toContainText(result.path);
  await expect(page.locator('#editor')).toContainText('Keep this draft.');
  localMode=true;await page.evaluate(()=>window.bridge.refresh());
  localMode=false;configured=false;
  await page.evaluate(()=>window.dropReport());
  assert.equal(await page.evaluate(()=>window.nativeDrops),0,'Unconfigured SSH project silently created a local attachment');
  assert.equal(begins,1);
  await expect.poll(()=>page.evaluate(()=>window.statusValue?.state)).toBe('unconfigured');
  localMode=true;configured=true;await page.evaluate(()=>window.bridge.refresh());
  await page.evaluate(()=>window.dropReport());
  await expect.poll(()=>page.evaluate(()=>window.nativeDrops)).toBe(1);
  assert.equal(await page.evaluate(()=>window.nativeFileSame),true,'Local replay must retain the original native File');
  assert.equal(begins,1);
  metadataFail=true;
  await page.evaluate(()=>window.dropReport());
  await expect.poll(()=>page.evaluate(()=>window.statusValue?.state)).toBe('context-error');
  assert.equal(await page.evaluate(()=>window.nativeDrops),1);
  metadataFail=false;localMode=false;
  metadataHold=new Promise(resolve=>{releaseMetadata=resolve;});
  await page.evaluate(()=>window.dropReport());
  await page.evaluate(()=>window.draftGeneration++);
  releaseMetadata();
  await expect.poll(()=>page.evaluate(()=>window.statusValue?.state)).toBe('context-error');
  assert.equal(begins,1);
  await page.evaluate(()=>window.bridge.dispose());
  assert.deepEqual(errors,[]);
});
