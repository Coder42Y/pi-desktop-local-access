"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { build } = require("esbuild");
const { chromium, expect } = require("@playwright/test");
const { createPasteStore } = require("../ssh-upload/paste-store.cjs");
const { uploadFile } = require("../ssh-upload/transfer.cjs");

test("direct composer file paste uploads exact bytes, guards sends, and does not touch other sessions", { timeout: 30000 }, async (t) => {
  const entry = path.resolve(__dirname, "../ssh-upload/renderer/paste.mjs");
  let module = {};
  try { module = await import(pathToFileURL(entry)); } catch (e) { if (e.code !== "ERR_MODULE_NOT_FOUND") throw e; }
  assert.equal(typeof module.installPasteBridge, "function");
  const root = await fs.mkdtemp(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), "auto-paste-"));
  let sessionId = "11111111-1111-4111-8111-111111111111", configured = true, release, fail = false;
  const sshProject = 'remote-project:22222222-2222-4222-8222-222222222222';
  let chunkHold = null, releaseChunk;
  let hold = new Promise(resolve => { release = resolve; });
  const store = createPasteStore({ dataPath: path.join(root, "staging"),
    getSession: async () => ({ sessionId }), getConfig: () => configured ? { target: "test", directory: path.join(root, "remote") } : null,
    uploadFile: async (file, config, opts) => { await hold; if (fail) throw Error('Permission denied (publickey)'); return uploadFile(file, config, { ...opts, spawnSsh: args => spawn("/bin/sh", ["-c", args.at(-1)]) }); },
  });
  t.after(async () => { release(); await store.dispose(); await fs.rm(root, { recursive: true, force: true }); });
  const js = await build({ stdin: { contents: `
    import {installPasteBridge} from ${JSON.stringify(entry)};
    import {zh} from ${JSON.stringify(path.resolve(__dirname, '../ssh-upload/renderer/locales.mjs'))};
    window.sends=0;window.nativePastes=0;window.inputs=0;
    const editor=document.getElementById('editor');
    editor.addEventListener('input',()=>window.inputs++);
    document.addEventListener('paste',()=>window.nativePastes++);
    document.getElementById('send').addEventListener('click',()=>window.sends++);
    editor.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey)window.sends++;});
    window.bridge=installPasteBridge({call:(method,args)=>window.hostRPC(method,args),labels:()=>zh,onStatus:status=>{
      window.lastStatus=status;document.getElementById('status').textContent=JSON.stringify(status);
    }});
    window.pasteFiles=(size=5)=>{editor.focus();const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);window.getSelection().removeAllRanges();window.getSelection().addRange(range);
      const data=new DataTransfer();data.items.add(new File([Uint8Array.from({length:size},(_,i)=>[0,255,10,33,128][i%5])],'REPORT.md',{type:'application/octet-stream'}));
      data.setData('text/plain','REPORT.md');data.setData('text/html','<a>REPORT.md</a>');
      return editor.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    };
  `, resolveDir: path.resolve(__dirname, "../..") }, bundle: true, write: false, format: "iife" });
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") { res.setHeader("Content-Type", "text/javascript"); res.end(js.outputFiles[0].contents); }
    else { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end('<!doctype html><div class="composer-shell"><div id="editor" class="composer-input" contenteditable="true" role="textbox" aria-multiline="true">Keep this text. </div><button id="send" class="send-btn">Send</button></div><input id="other"><pre id="status"></pre><script src="/app.js"></script>'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await require("./helpers/browser.cjs").launchBrowser(chromium);
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.exposeFunction("hostRPC", async (method, args = {}) => {
    if (method === "context") return { sessionId, projectPath: sessionId === 'local-session' ? '/local-project' : sshProject, configured, config: configured ? { target: "test" } : { target: "" }, locale: "zh-CN" };
    if (method === "pasteBegin") return store.begin(args);
    if (method === "pasteChunk") { const result = await store.chunk(args); if (chunkHold) await chunkHold; return result; }
    if (method === "pasteFinish") return store.finish(args.id);
    if (method === "pastePoll") return store.poll(args.id);
    if (method === "pasteCancel") return store.cancel(args.id);
    throw Error(`Unknown method ${method}`);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(() => window.bridge.ready);
  await page.evaluate(() => window.pasteFiles());
  await expect(page.locator('#editor')).toContainText('SSH-upload:');
  await page.locator('#editor').press('Enter');
  await page.locator('#send').click();
  assert.equal(await page.evaluate(() => window.sends), 0);
  assert.equal(await page.evaluate(() => window.nativePastes), 0);
  release();
  await expect.poll(() => page.evaluate(() => window.lastStatus?.state)).toBe('done');
  const remote = store.current().results[0].path;
  await expect(page.locator('#editor')).toContainText(remote);
  await expect(page.locator('#editor')).toContainText('Keep this text.');
  assert.deepEqual(await fs.readFile(remote), Buffer.from([0,255,10,33,128]));
  assert.ok(await page.evaluate(() => window.inputs >= 2));
  await page.locator('#send').click();
  assert.equal(await page.evaluate(() => window.sends), 1);
  await page.evaluate(() => window.pasteFiles(100000));
  await expect.poll(() => page.evaluate(() => window.lastStatus?.state)).toBe('done');
  assert.deepEqual(await fs.readFile(store.current().results[0].path), Buffer.from(Array.from({length:100000},(_,i)=>[0,255,10,33,128][i%5])));
  await page.evaluate(() => document.execCommand('undo'));
  await expect(page.locator('#editor')).toContainText('SSH-upload:');
  await page.evaluate(() => document.execCommand('redo'));
  await expect(page.locator('#editor')).not.toContainText('SSH-upload:');
  await page.keyboard.type(' AFTER');
  assert.ok((await page.locator('#editor').textContent()).endsWith(' AFTER'));

  // Ordinary text and other inputs must retain the host's paste behavior.
  await page.evaluate(() => { const data=new DataTransfer();data.setData('text/plain','hello');document.getElementById('editor').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true})); });
  assert.equal(await page.evaluate(() => window.nativePastes), 1);
  configured = false;
  await page.evaluate(() => window.bridge.refresh());
  await page.evaluate(() => window.pasteFiles());
  assert.equal(await page.evaluate(() => window.nativePastes), 1);
  await expect.poll(() => page.evaluate(() => window.lastStatus?.state)).toBe('unconfigured');
  configured = true;
  sessionId = 'local-session';
  await page.evaluate(() => window.bridge.refresh());
  await page.evaluate(() => window.pasteFiles());
  await expect.poll(() => page.evaluate(() => window.nativePastes)).toBe(2);
  await expect(page.locator('#editor')).not.toContainText('SSH-upload:');
  sessionId = '11111111-1111-4111-8111-111111111111';

  // Reusing the same DOM node for a new session must not receive the old result.
  configured = true;
  hold = new Promise(resolve => { release = resolve; });
  await page.evaluate(() => window.bridge.refresh());
  await page.evaluate(() => window.pasteFiles());
  await expect.poll(() => store.current()?.state).toBe('uploading');
  sessionId = 'remote:test:b';
  await page.locator('#editor').fill('Other conversation');
  release();
  await expect.poll(() => page.evaluate(() => window.lastStatus?.state)).toBe('detached');
  await expect(page.locator('#editor')).toHaveText('Other conversation');
  await page.evaluate(() => window.bridge.cancel());
  fail = true;
  sessionId = '11111111-1111-4111-8111-111111111111';
  // Failure keeps a blocking placeholder until explicitly cancelled/deleted.
  await page.evaluate(() => window.bridge.refresh());
  await page.evaluate(() => window.pasteFiles());
  await expect.poll(() => page.evaluate(() => window.lastStatus?.state)).toBe('error');
  const originalFailure = await page.locator('#editor').textContent();
  await page.locator('#editor').fill(originalFailure.replace('SSH-upload:', 'SSH-upLoad:'));
  await page.locator('#editor').press('Enter');
  await page.locator('#send').click();
  assert.equal(await page.evaluate(() => window.sends), 1);
  await page.locator('#editor').fill(originalFailure);
  await page.evaluate(() => window.bridge.cancel());
  await expect(page.locator('#editor')).not.toContainText('SSH-upload:');
  fail = false;
  chunkHold = new Promise(resolve => { releaseChunk = resolve; });
  await page.evaluate(() => window.pasteFiles());
  await expect.poll(() => store.current()?.received).toBe(5);
  await page.evaluate(() => window.bridge.cancel());
  releaseChunk();
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(await page.evaluate(() => window.lastStatus?.state), 'cancelled');
  chunkHold = null;
  await page.evaluate(() => window.bridge.dispose());
  await page.evaluate(() => window.pasteFiles());
  assert.equal(await page.evaluate(() => window.nativePastes), 3);
  assert.deepEqual(errors, []);
});
