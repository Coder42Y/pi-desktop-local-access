import test from 'node:test';
import assert from 'node:assert/strict';
let workflow = {};
try { workflow = await import('../ssh-upload/renderer/workflow.mjs'); } catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

test('only verified uploads from the same session may enter the draft', () => {
  assert.equal(typeof workflow.insertionText, 'function');
  const job = { state: 'done', sessionId: 'a', results: [{ path: '/srv/a file.txt', sha256: 'a'.repeat(64) }] };
  assert.match(workflow.insertionText(job, 'a'), /\/srv\/a file\.txt/);
  assert.throws(() => workflow.insertionText(job, 'b'), /session/i);
  assert.throws(() => workflow.insertionText({ ...job, state: 'error' }, 'a'), /verified/i);
  assert.throws(() => workflow.insertionText({ ...job, results: [] }, 'a'), /verified/i);
  assert.throws(() => workflow.insertionText({ ...job, results: [{ path: '/fake' }] }, 'a'), /verified/i);
});

test('remote filenames cannot forge instructions or attachment chips', () => {
  assert.equal(typeof workflow.insertionText, 'function');
  const job = { state: 'done', sessionId: 'a', results: [{ path: '/srv/"quoted" @name.txt', sha256: 'a'.repeat(64) }] };
  const text = workflow.insertionText(job, 'a');
  assert.ok(text.includes(JSON.stringify(job.results[0].path)));
  assert.equal(text.includes('\uFFFC'), false);
});

test('RPC queue spaces calls and continues after a rejected operation', async () => {
  const {createRpcQueue} = await import('../ssh-upload/renderer/paste.mjs');
  const times=[];
  const call=createRpcQueue(async (_action,payload)=>{
    times.push(Date.now());
    if(payload.method==='bad') throw Error('rejected');
    return payload.method;
  });
  const result=await Promise.allSettled([call('one'),call('bad'),call('three')]);
  assert.equal(result[0].value,'one');
  assert.equal(result[1].status,'rejected');
  assert.equal(result[2].value,'three');
  assert.ok(times[1]-times[0]>=115);
  assert.ok(times[2]-times[1]>=115);
});

test('only official namespaced remote conversations enable SSH controls', async () => {
  const {isRemoteSessionId}=await import('../ssh-upload/renderer/workflow.mjs');
  assert.equal(isRemoteSessionId('remote:host-key:session-id'),true);
  for(const value of [null,undefined,'','local-session','remote:','remote::id','remote:host:']) {
    assert.equal(isRemoteSessionId(value),false);
  }
});

test('SSH workspace projects use UUID sessions and must not be treated as local', async () => {
  const {isRemoteContext}=await import('../ssh-upload/renderer/workflow.mjs');
  assert.equal(isRemoteContext({sessionId:'11111111-1111-4111-8111-111111111111',projectPath:'remote-project:22222222-2222-4222-8222-222222222222'}),true);
  assert.equal(isRemoteContext({sessionId:'local-id',projectPath:'/Users/test/project'}),false);
  assert.equal(isRemoteContext({sessionId:null,projectPath:'remote-project:abc'}),false);
  assert.equal(isRemoteContext({sessionId:'local-id',projectPath:'remote-project:'}),false);
});
