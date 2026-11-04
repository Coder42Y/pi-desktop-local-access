import { insertionText, isRemoteContext } from './workflow.mjs';
const CHUNK_BYTES = 44 * 1024;
const EDITOR = '.composer-input[role="textbox"]';
const PENDING = /⟦SSH-upload:[a-f0-9-]+⟧/;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createRpcQueue(dispatch, interval = 130) {
  let tail = Promise.resolve(), next = 0;
  return (method, args = {}) => {
    const result = tail.then(async () => {
      await delay(Math.max(0, next - Date.now()));
      next = Date.now() + interval;
      return dispatch('plugin.call', { method, args });
    });
    tail = result.catch(() => {});
    return result;
  };
}

function markerRange(editor, marker) {
  const doc = editor.ownerDocument;
  const walker = doc.createTreeWalker(editor, 4);
  const parts = [];
  let text = '', node;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest('.composer-chip')) { text += '\uFFFC'; continue; }
    parts.push({ node, start: text.length, end: text.length + node.data.length });
    text += node.data;
  }
  const start = text.indexOf(marker);
  if (start < 0 || text.indexOf(marker, start + marker.length) >= 0) return null;
  const end = start + marker.length;
  const first = parts.find(part => part.end > start);
  const last = parts.find(part => part.end >= end && part.start < end);
  if (!first || !last) return null;
  const range = doc.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start);
  return range;
}

function signalInput(editor) {
  editor.dispatchEvent(new editor.ownerDocument.defaultView.InputEvent('input', { bubbles: true, inputType: 'insertText' }));
}
function replaceMarker(editor, marker, text) {
  if (!editor.isConnected || editor.getAttribute('contenteditable') !== 'true') return false;
  const range = markerRange(editor, marker);
  if (!range) return false;
  const doc = editor.ownerDocument;
  const selection = doc.getSelection();
  const saved = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  const atEnd = saved?.collapsed && range.compareBoundaryPoints(2, saved) === 0;
  if (doc.activeElement === editor && selection) {
    selection.removeAllRanges(); selection.addRange(range);
    const escaped = doc.createElement('div'); escaped.textContent = text;
    const inserted = doc.execCommand('insertHTML', false, escaped.innerHTML.replace(/\n/g, '<br>'));
    if (inserted) {
      if (saved && !atEnd && saved.commonAncestorContainer.isConnected) { selection.removeAllRanges(); selection.addRange(saved); }
      signalInput(editor);
      return true;
    }
  }
  range.deleteContents();
  if (text) {
    const node = doc.createTextNode(text); range.insertNode(node);
    if (atEnd && doc.activeElement === editor && selection) { range.setStartAfter(node); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); }
  }
  signalInput(editor);
  return true;
}
function insertMarker(editor, marker) {
  const doc = editor.ownerDocument;
  const selection = doc.getSelection();
  let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !editor.contains(range.commonAncestorContainer)) {
    range = doc.createRange(); range.selectNodeContents(editor); range.collapse(false);
    selection?.removeAllRanges(); selection?.addRange(range);
  }
  if (!doc.execCommand('insertText', false, marker)) {
    range.deleteContents();
    const node = doc.createTextNode(marker);
    range.insertNode(node); range.setStartAfter(node); range.collapse(true);
    selection?.removeAllRanges(); selection?.addRange(range);
  }
  signalInput(editor);
}

export function installPasteBridge(options) {
  const doc = options.document || globalThis.document;
  let disposed = false, context = null, current = null, pendingTransfer = null, timer;
  const replayed = new WeakSet();
  const labels = () => options.labels();
  const status = (state, message, job) => { if (!disposed) options.onStatus?.({ state, message, job }); };
  const draftNow = () => { try { return Promise.resolve(options.readDraft?.()).catch(() => null); } catch { return Promise.resolve(null); } };
  const refresh = async () => { const next = await options.call('context'); if (!disposed) context = next; return next; };
  const schedule = async () => {
    try { await refresh(); } catch { context = null; }
    finally { if (!disposed) timer = setTimeout(schedule, 1500); }
  };
  const ready = schedule();
  const cancel = async () => {
    if (pendingTransfer) { pendingTransfer.cancelled = true; pendingTransfer = null; status('cancelled', labels().cancelled); }
    const task = current;
    if (!task) return;
    task.cancelled = true;
    replaceMarker(task.editor, task.marker, '');
    current = null;
    status('cancelled', labels().cancelled);
    if (task.id) await options.call('pasteCancel', { id: task.id }).catch(() => {});
  };
  const resume = async () => {
    const task = current;
    if (!task?.result) return;
    const selected = await refresh();
    if (disposed || task.cancelled) return;
    if (task.configurationKey && selected.configurationKey !== task.configurationKey) {
      status('detached', labels().pasteConfigurationChanged, task.result);
      return;
    }
    const editor = Array.from(doc.querySelectorAll(EDITOR)).find(candidate => candidate.closest('.composer-shell') && markerRange(candidate, task.marker));
    if (selected.sessionId === task.sessionId && editor && replaceMarker(editor, task.marker, insertionText(task.result, task.sessionId, labels()))) {
      current = null;
      status('done', labels().pasteDone, task.result);
    } else status('detached', labels().pasteDetached, task.result);
  };
  const run = async (task, files) => {
    try {
      const job = await options.call('pasteBegin', { sessionId: task.sessionId, ...(task.configurationKey ? { configurationKey: task.configurationKey } : {}), files: files.map(file => ({ name: file.name || 'pasted-image.png', size: file.size })) });
      task.id = job.id;
      if (disposed || task.cancelled) { await options.call('pasteCancel', { id: job.id }).catch(() => {}); return; }
      let received = 0;
      for (const [index, file] of files.entries()) {
        for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
          if (disposed || task.cancelled) return;
          if (!task.editor.isConnected || !markerRange(task.editor, task.marker)) throw new Error(labels().pasteRemoved);
          const bytes = new Uint8Array(await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
          if (disposed || task.cancelled || current !== task) return;
          let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
          await options.call('pasteChunk', { id: job.id, index, offset, data: btoa(binary) });
          if (disposed || task.cancelled || current !== task) return;
          received += bytes.length;
          status('receiving', labels().pasteReceiving, { ...job, received });
        }
      }
      if (disposed || task.cancelled) return;
      let result = await options.call('pasteFinish', { id: job.id });
      while (!disposed && !task.cancelled && ['receiving', 'uploading'].includes(result.state)) {
        status(result.state, labels().uploading, result);
        await delay(600);
        if (disposed || task.cancelled) return;
        result = await options.call('pastePoll', { id: job.id });
      }
      if (disposed || task.cancelled) return;
      if (result.state !== 'done') throw new Error(result.error || labels().cancelled);
      task.result = result;
      await resume();
    } catch (error) {
      if (!disposed && !task.cancelled) {
        status('error', `${labels().pasteFailed} ${error.message}`, task.result);
        if (task.id) void options.call('pasteCancel', { id: task.id }).catch(() => {});
      }
    }
  };
  const onTransfer = event => {
    if (replayed.has(event)) return;
    const drop = event.type === 'drop';
    const editor = event.target?.closest?.(EDITOR) || (drop && event.target?.closest?.('.composer-shell')?.querySelector(EDITOR));
    if (!editor || !editor.closest('.composer-shell') || editor.getAttribute('contenteditable') !== 'true') return;
    const data = drop ? event.dataTransfer : event.clipboardData;
    const files = Array.from(data?.files || []);
    const items = Array.from(data?.items || []);
    const entries = items.filter(item => item.kind === 'file').map(item => { try { return item.webkitGetAsEntry?.(); } catch { return null; } });
    if (!files.length) for (const item of items) { if (item.kind === 'file') { const file = item.getAsFile(); if (file) files.push(file); } }
    const directory = drop && (entries.some(entry => entry?.isDirectory) || files.some(file => file.type === 'application/x-directory'));
    if (!files.length && !directory) return;
    if (!drop && files.length && files.every(file => file.type.toLowerCase().startsWith('image/')) && data.getData('text/plain').trim() && Array.from(data.types).includes('text/html') && !Array.from(data.types).includes('text/uri-list')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (pendingTransfer) { status('error', labels().pasteBusy); return; }
    const ticket = { editor, text: editor.textContent, cancelled: false };
    const capturedDraft = draftNow();
    pendingTransfer = ticket;
    const cloned = new doc.defaultView.DataTransfer();
    for (const type of Array.from(data.types)) if (type !== 'Files') cloned.setData(type, data.getData(type));
    files.forEach((file, index) => { const item = cloned.items.add(file); if (entries[index]) Object.defineProperty(item, 'webkitGetAsEntry', { value: () => entries[index] }); });
    const target = event.target;
    const coordinates = { clientX: event.clientX, clientY: event.clientY, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey };
    if (!current) status('checking', labels().checkingTransfer);
    void (async () => {
      try {
        const initial = await capturedDraft;
        const selected = await refresh();
        const latest = await draftNow();
        if (disposed || ticket.cancelled || pendingTransfer !== ticket) return;
        if (!editor.isConnected || editor.textContent !== ticket.text || (initial && latest && initial.generation !== latest.generation)) throw new Error(labels().transferChanged);
        if (!isRemoteContext(selected)) {
          const replay = drop ? new doc.defaultView.DragEvent('drop', { ...coordinates, dataTransfer: cloned, bubbles: true, cancelable: true })
            : new doc.defaultView.ClipboardEvent('paste', { clipboardData: cloned, bubbles: true, cancelable: true });
          replayed.add(replay); target.dispatchEvent(replay);
          if (!current) status('idle', '');
          return;
        }
        if (directory) { status('error', labels().dropDirectory); return; }
        if (!selected.config?.target || selected.configured === false) { status('unconfigured', selected.configError || labels().pasteNeedsConfig); return; }
        if (current) { status('error', labels().pasteBusy); return; }
        if (drop) {
          editor.focus();
          const range = doc.caretRangeFromPoint?.(coordinates.clientX, coordinates.clientY);
          if (range && editor.contains(range.commonAncestorContainer)) { const selection = doc.getSelection(); selection.removeAllRanges(); selection.addRange(range); }
        }
        const task = { sessionId: selected.sessionId, configurationKey: selected.configurationKey, editor, marker: `⟦SSH-upload:${crypto.randomUUID()}⟧`, cancelled: false };
        current = task; insertMarker(editor, task.marker);
        status('receiving', labels().pasteReceiving);
        void run(task, files);
      } catch (error) { if (!disposed && !ticket.cancelled) status('context-error', `${labels().contextFailed} ${error.message}`); }
      finally { if (pendingTransfer === ticket) pendingTransfer = null; }
    })();
  };
  const onDrag = event => {
    const shell = event.target?.closest?.('.composer-shell');
    if (!shell || !isRemoteContext(context)) return;
    const data = event.dataTransfer;
    if (!Array.from(data?.types || []).includes('Files') && !data?.files?.length && !Array.from(data?.items || []).some(item => item.kind === 'file')) return;
    event.preventDefault(); event.stopImmediatePropagation(); data.dropEffect = 'copy';
  };
  const blocked = editor => editor && (pendingTransfer?.editor === editor || PENDING.test(editor.textContent || '') || (current && !current.cancelled && current.sessionId === context?.sessionId && (current.editor === editor || !current.editor.isConnected)));
  const stopSend = (event) => {
    if (!pendingTransfer && !isRemoteContext(context)) return;
    let editor;
    if (event.type === 'keydown') {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      editor = event.target?.closest?.(EDITOR);
    } else {
      const shell = event.target?.closest?.('.composer-shell');
      if (!shell || (event.type === 'click' && !event.target?.closest?.('.send-btn'))) return;
      editor = shell.querySelector(EDITOR);
    }
    if (blocked(editor)) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  doc.addEventListener('paste', onTransfer, true);
  doc.addEventListener('drop', onTransfer, true);
  doc.addEventListener('dragenter', onDrag, true);
  doc.addEventListener('dragover', onDrag, true);
  doc.addEventListener('keydown', stopSend, true);
  doc.addEventListener('click', stopSend, true);
  doc.addEventListener('submit', stopSend, true);
  return { ready, refresh, cancel, resume,
    dispose() {
      if (disposed) return;
      void cancel(); disposed = true; clearTimeout(timer);
      doc.removeEventListener('paste', onTransfer, true);
      doc.removeEventListener('drop', onTransfer, true);
      doc.removeEventListener('dragenter', onDrag, true);
      doc.removeEventListener('dragover', onDrag, true);
      doc.removeEventListener('keydown', stopSend, true);
      doc.removeEventListener('click', stopSend, true);
      doc.removeEventListener('submit', stopSend, true);
    },
  };
}
