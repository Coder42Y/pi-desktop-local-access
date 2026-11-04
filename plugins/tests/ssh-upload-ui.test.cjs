"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { build } = require("esbuild");
const { chromium, expect } = require("@playwright/test");

test("composer control handles success, failures, cancellation and session switches", { timeout: 30000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), "ssh-upload-ui-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const entry = path.resolve(__dirname, "../ssh-upload/renderer/index.mjs");
  const js = await build({ stdin: { contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {onLoad} from ${JSON.stringify(entry)};
    window.fixture = { sessionId: '11111111-1111-4111-8111-111111111111', projectPath:'remote-project:22222222-2222-4222-8222-222222222222', job: null, fail: false, inserts: [], generation: 1, race: false };
    onLoad({
      ui: { injectStyle(css) { const el=document.createElement('style'); el.textContent=css; document.head.append(el); },
        openLayer() { const element=document.createElement('div'); document.body.append(element); return {element,close(){element.remove()}}; } },
      composer: {subscribeDraft(listener) {window.fixture.listener=listener; listener({text:'existing draft ',marks:[],generation:window.fixture.generation}); return ()=>{window.fixture.listener=null};}},
      slots: {register({component}) { createRoot(document.getElementById('slot')).render(React.createElement(component)); }},
      async dispatch(action, payload) {
        const f=window.fixture;
        if (action === 'composer.insertText' || action === 'composer.replaceDraft') {
          if(f.race) {f.race=false; f.sessionId='remote:test:b'; f.generation++; f.listener?.({text:'other draft',marks:[],generation:f.generation});}
          if(action === 'composer.replaceDraft' && payload.expectedGeneration !== f.generation) throw Error('Draft changed; retry insertion.');
          f.inserts.push(payload.text); f.generation++; f.listener?.({text:payload.text,marks:[],generation:f.generation}); return {ok:true};
        }
        const {method,args}=payload;
        if(method === 'saveConfig') {f.saved=args.config; return {config:args.config};}
        if(method === 'context') return {sessionId:f.sessionId,projectPath:f.sessionId==='local-session'?'/local-project':f.projectPath,config:{target:f.sessionId==='remote:test:b'?'other@server':'',port:'',directory:'/remote/project/.pi-desktop/uploads',identity:''},locale:'zh-CN',job:f.job};
        if(method === 'select') return f.job={id:'job',state:'selected',sessionId:f.sessionId,files:[{name:'data.bin',size:5}],results:[],sent:0,total:5};
        if(method === 'cancel') { f.job.state='cancelled'; return {...f.job}; }
        if(method === 'start') {
          f.lastConfig=args.config;
          f.job.state='uploading';
          setTimeout(()=>{f.job.state=f.fail?'error':'done';f.job.error=f.fail?'Permission denied (publickey)':null;
            if(!f.fail) f.job.results=[{path:'/srv/uploads/data.bin',sha256:'a'.repeat(64),size:5}];},80);
          return {...f.job};
        }
        if(method === 'verifySession') { if(f.sessionId!==f.job.sessionId) throw Error('Session changed'); return {sessionId:f.sessionId}; }
        throw Error('Unknown method');
      }
    });
  `, resolveDir: path.resolve(__dirname, "../.."), loader: "js" }, bundle: true, write: false, format: "iife" });
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") { res.setHeader("Content-Type", "text/javascript"); res.end(js.outputFiles[0].contents); }
    else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="slot"></div><script src="/app.js"></script></body></html>'); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await require("./helpers/browser.cjs").launchBrowser(chromium);
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1000, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole("button", { name: "SSH 上传" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("SSH 目标", { exact: true }).fill("user@server");
  await page.getByRole("button", { name: "保存 SSH 目标" }).click();
  await expect(page.getByText("已保存，现在可直接在聊天输入框粘贴文件。", { exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => window.fixture.saved.target), "user@server");
  await page.getByRole("button", { name: "选择文件" }).click();
  await page.getByRole("button", { name: "上传文件", exact: true }).click();
  await expect(page.getByRole("button", { name: "插入远端路径" })).toBeVisible();
  await page.getByRole("button", { name: "插入远端路径" }).click();
  assert.match(await page.evaluate(() => window.fixture.inserts[0]), /\/srv\/uploads\/data.bin/);
  await page.evaluate(() => { window.fixture.race = true; });
  await page.getByRole("button", { name: "插入远端路径" }).click();
  await expect(page.getByRole("alert").first()).toContainText(/Draft changed|另一个会话/);
  assert.equal(await page.evaluate(() => window.fixture.inserts.length), 1);
  await page.evaluate(() => { window.fixture.sessionId = "remote:test:b"; });
  await expect(page.getByRole("button", { name: "插入远端路径" })).toBeDisabled();
  await expect(page.getByLabel("SSH 目标", { exact: true })).toHaveValue("other@server");
  await expect(page.getByRole("alert").filter({ hasText: "另一个会话" })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 740 });
  const layout = await page.getByRole("dialog").evaluate((el) => ({ width: el.getBoundingClientRect().width, scroll: el.scrollWidth, client: el.clientWidth }));
  assert.ok(layout.width <= 375);
  assert.ok(layout.scroll <= layout.client + 1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => { window.fixture.sessionId = "remote:test:a"; window.fixture.job = null; window.fixture.fail = true; });
  await page.getByRole("button", { name: "SSH 上传" }).click();
  await page.getByLabel("SSH 目标", { exact: true }).fill("user@server");
  await page.getByRole("button", { name: "选择文件" }).click();
  await page.getByRole("button", { name: "取消上传" }).click();
  await expect(page.getByText("已取消", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "选择文件" }).click();
  await page.getByRole("button", { name: "上传文件", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Permission denied");
  await expect(page.getByRole("button", { name: "插入远端路径" })).toHaveCount(0);
  await page.evaluate(() => { window.fixture.sessionId = "local-session"; });
  await expect(page.getByRole("button", { name: "SSH 上传" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  assert.deepEqual(errors, []);
});
