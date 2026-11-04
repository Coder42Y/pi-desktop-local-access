"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { build } = require("esbuild");
const { chromium, expect } = require("@playwright/test");
const { launchBrowser } = require("./helpers/browser.cjs");

test("compact SSH status retains real paste controls without a second settled text line", { timeout: 30000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), "ssh-status-ui-"));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const entry = path.resolve(__dirname, "../ssh-upload/renderer/index.mjs");
  const js = await build({ stdin: { contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { onLoad, onUnload } from ${JSON.stringify(entry)};
    window.mode = 'done'; let job;
    const editor = document.querySelector('.composer-input');
    onLoad({
      ui: { injectStyle(css) { const style=document.createElement('style');style.textContent=css;document.head.append(style); },
        openLayer() { const element=document.createElement('div');document.body.append(element);return {element,close(){element.remove();}}; } },
      slots: {register({component}) { createRoot(document.getElementById('slot')).render(React.createElement(component)); }},
      composer: {subscribeDraft(listener) { listener({text:editor.textContent,marks:[],generation:1});return ()=>{};}},
      async dispatch(action,payload) {
        if(action==='composer.readDraft')return {text:editor.textContent,marks:[],generation:1};
        const {method,args={}}=payload;
        if(method==='context') {
          if(window.mode==='context-error')throw Error('synthetic context unavailable');
          return {sessionId:window.mode==='local'?'local-session':window.fixtureSession||'remote:fixture:one',projectPath:window.mode==='local'?'/local/project':'remote-project:fixture',configured:window.mode!=='unconfigured',config:{target:'fixture-host',directory:'/remote/project/uploads',port:'',identity:''},locale:'en',job:null};
        }
        if(method==='pasteBegin')return job={id:'fixture-job',sessionId:args.sessionId,state:'receiving',received:0,total:5};
        if(method==='pasteChunk'){job.received+=atob(args.data).length;return {...job};}
        if(method==='pasteFinish'||method==='pastePoll'){if(window.mode==='detached')window.fixtureSession='remote:fixture:two';return {...job,state:window.mode==='hold'?'uploading':window.mode==='error'?'error':'done',sent:5,error:window.mode==='error'?'Synthetic permission denied':undefined,results:[{path:'/remote/project/uploads/file.txt',size:5,sha256:'a'.repeat(64)}]};}
        if(method==='pasteCancel'){window.cancelCalls=(window.cancelCalls||0)+1;return {...job,state:'cancelled'};}
        throw Error('Unexpected test boundary call: '+method);
      }
    });
    window.pasteFixture=()=>{editor.focus();const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);const data=new DataTransfer();data.items.add(new File(['hello'],'file.txt',{type:'text/plain'}));editor.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));};
    window.disposeFixture=()=>onUnload();
  `, resolveDir: path.resolve(__dirname, ".."), loader: "js" }, bundle: true, write: false, format: "iife" });
  const server = http.createServer((req,res) => {
    if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js.outputFiles[0].contents);}
    else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><style>:root{color-scheme:light;--ds-text-muted:#757575;--ds-text-primary:#222}body{font:12px system-ui;color:#222;margin:20px}.toolbar{display:flex;align-items:center;gap:12px}#neighbor{font:inherit;line-height:20px;border:0;padding:4px 0;background:transparent;color:#757575}.composer-input{padding:16px;margin-top:12px;border:1px solid #eee}</style><div class="composer-shell"><div class="toolbar"><button id="neighbor">Model</button><span id="slot"></span></div><div class="composer-input" contenteditable="true" role="textbox">Fixture draft </div><button class="send-btn">Send</button></div><script src="/app.js"></script>`);}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await launchBrowser(chromium);t.after(()=>browser.close());
  const page=await browser.newPage({locale:'en-US',viewport:{width:600,height:300}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const launch=page.locator('.su-launch');
  await expect(launch).toHaveText('SSH Upload');
  assert.equal(await launch.evaluate(el=>getComputedStyle(el).color),'rgb(117, 117, 117)');
  await page.evaluate(()=>window.pasteFixture());
  const success=page.getByRole('img',{name:'SSH uploaded · remote paths inserted'});
  await expect(success).toBeVisible();
  await expect(success.locator('svg')).toHaveCount(1);
  await expect(page.getByText('SSH uploaded · remote paths inserted',{exact:true})).toHaveCount(0);
  const geometry=await success.evaluate(el=>{const a=document.querySelector('.su-launch').getBoundingClientRect(),b=el.getBoundingClientRect(),n=document.querySelector('#neighbor').getBoundingClientRect();return {gap:b.left-a.right,dy:Math.abs((a.top+a.bottom-b.top-b.bottom)/2),neighbor:Math.abs((a.top+a.bottom-n.top-n.bottom)/2),color:getComputedStyle(el).color};});
  assert.ok(geometry.gap>=0&&geometry.gap<=12,JSON.stringify(geometry));assert.ok(geometry.dy<2&&geometry.neighbor<2,JSON.stringify(geometry));
  const green=geometry.color.match(/\d+/g).map(Number);assert.ok(green[1]>green[0]&&green[1]>green[2]);
  if(process.env.SSH_UPLOAD_UI_SCREENSHOT)await page.screenshot({path:process.env.SSH_UPLOAD_UI_SCREENSHOT});
  await page.evaluate(()=>{window.mode='detached';window.pasteFixture();});
  const resume=page.getByRole('button',{name:'Insert uploaded paths',exact:true});
  await expect(resume).toBeVisible();
  await page.evaluate(()=>{window.fixtureSession='remote:fixture:one';window.mode='done';});
  await resume.click();await expect(success).toBeVisible();await expect(resume).toHaveCount(0);
  await page.evaluate(()=>{window.mode='error';window.pasteFixture();});
  const failure=page.getByRole('button',{name:/Cancel pasted upload.*Synthetic permission denied/});
  await expect(failure).toBeVisible();await expect(failure.locator('svg')).toHaveCount(1);
  await expect(page.getByText(/SSH paste failed/)).toHaveCount(0);
  const red=(await failure.evaluate(el=>getComputedStyle(el).color)).match(/\d+/g).map(Number);assert.ok(red[0]>red[1]&&red[0]>red[2]);
  await failure.focus();await page.keyboard.press('Enter');await expect(page.getByRole('status')).toContainText('Cancelled');
  assert.ok(await page.evaluate(()=>window.cancelCalls>0));
  await page.evaluate(()=>{window.mode='hold';window.pasteFixture();});
  await expect(page.getByRole('status')).toContainText('Uploading');
  await expect(page.getByRole('img')).toHaveCount(0);
  await page.getByRole('button',{name:'Cancel pasted upload',exact:true}).click();
  await page.evaluate(()=>{window.mode='unconfigured';window.pasteFixture();});
  await expect(page.getByRole('button',{name:'Configure SSH',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Configure SSH',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
  await page.evaluate(()=>{window.mode='context-error';window.pasteFixture();});
  await expect(page.getByRole('status')).toContainText('could not be confirmed');
  await page.getByRole('button',{name:'Cancel pasted upload',exact:true}).click();
  await page.evaluate(()=>{window.mode='local';});await expect(launch).toHaveCount(0);
  await page.evaluate(()=>window.disposeFixture());assert.deepEqual(errors,[]);
});
