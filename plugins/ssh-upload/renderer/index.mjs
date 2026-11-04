import { createElement as h, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { labelsFor } from './locales.mjs';
import { insertionText, isRemoteContext } from './workflow.mjs';
import { createRpcQueue, installPasteBridge } from './paste.mjs';
import { UploadStatus } from './status.mjs';

let host, rpc, pasteBridge, pasteState = null, displayLocale = navigator.language;
const pasteListeners = new Set();
let displayedSession = null;
const sessionListeners = new Set();
const publishPaste = state => { pasteState = state; for (const listener of pasteListeners) listener(state); };
const call = async (method, args = {}) => {
  const result = await rpc(method, args);
  if (method === 'context' && result.locale) displayLocale = result.locale;
  if (method === 'context') {
    displayedSession = { sessionId: result.sessionId, projectPath: result.projectPath };
    for (const listener of sessionListeners) listener(displayedSession);
  }
  return result;
};
const sizeText = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;

function UploadDialog({ onClose }) {
  const [layer, setLayer] = useState(null);
  const [context, setContext] = useState(null);
  const [config, setConfig] = useState({ target: '', port: '', directory: '~/.pi-desktop/uploads', identity: '' });
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const seenSession = useRef(undefined);
  const seenBinding = useRef(undefined);
  const busy = useRef(false);
  const firstInput = useRef(null);
  const dialog = useRef(null);
  const labels = labelsFor(context?.locale || navigator.language);
  const active = job && ['selecting', 'uploading'].includes(job.state);
  const changed = job && (context?.sessionId !== job.sessionId || (job.bindingKey && context?.bindingKey !== job.bindingKey));
  const insertReady = prepared && !pending && !changed && !context?.configError &&
    prepared.jobId === job?.id && prepared.sessionId === context?.sessionId &&
    prepared.bindingKey === context?.bindingKey && prepared.configurationKey === context?.configurationKey &&
    prepared.replacement.expectedGeneration === draft?.generation;
  useEffect(() => {
    const previousFocus = document.activeElement;
    const opened = host.ui.openLayer();
    setLayer(opened.element);
    let disposed = false;
    let timer;
    const refresh = async (initial = false) => {
      try {
        const next = await call('context');
        if (!disposed) {
          setContext(next);
          setJob(next.job);
          if (initial || seenSession.current !== next.sessionId || seenBinding.current !== next.bindingKey) {
            seenSession.current = next.sessionId;
            seenBinding.current = next.bindingKey;
            const initialConfig = next.suggestedConfig || next.config;
            setConfig({ ...initialConfig, port: initialConfig.port || '' });
            if (next.suggestedConfig) setMessage(labelsFor(next.locale || navigator.language).confirmTarget);
            if (next.configError) setError(next.configError);
          }
        }
      } catch (failure) { if (!disposed) setError(failure.message); }
      finally { if (!disposed) timer = setTimeout(() => refresh(), 1000); }
    };
    void refresh(true);
    return () => { disposed = true; clearTimeout(timer); opened.close(); previousFocus?.focus?.(); };
  }, []);
  useEffect(() => { if (layer) firstInput.current?.focus(); }, [layer]);
  useEffect(() => host.composer.subscribeDraft(setDraft), []);
  useEffect(() => {
    setPrepared(null);
    if (pending || job?.state !== 'done' || changed || context?.configError || !draft) return;
    let disposed = false;
    const timer = setTimeout(() => {
      void call('verifySession', { id: job.id }).then((verified) => {
        if (verified.configurationKey !== context.configurationKey) throw new Error(labels.configurationChanged);
        if (!disposed) setPrepared({
          jobId: job.id, sessionId: verified.sessionId, bindingKey: context.bindingKey,
          configurationKey: verified.configurationKey,
          replacement: {
            expectedGeneration: draft.generation,
            text: draft.text + insertionText(job, verified.sessionId, labels),
            marks: draft.marks.map((mark) => ({ id: mark.id })),
          },
        });
      }).catch((failure) => { if (!disposed) setError(failure.message); });
    }, 200);
    return () => { disposed = true; clearTimeout(timer); };
  }, [job?.id, job?.state, changed, pending, context?.sessionId, context?.bindingKey, context?.configurationKey, context?.configError, draft?.generation, labels]);
  useEffect(() => {
    const escape = (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  }, [onClose]);
  const run = async (fn) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true); setError(''); setMessage('');
    try { await fn(); } catch (failure) { setError(failure.message); }
    finally { busy.current = false; setPending(false); }
  };
  const field = (key, label, placeholder, extra = {}) => h('label', { className: 'su-field', key },
    h('span', null, label), h('input', {
      ref: key === 'target' ? firstInput : undefined,
      value: config[key] ?? '', placeholder, disabled: active || pending,
      autoComplete: 'off', spellCheck: false,
      onChange: (event) => setConfig((old) => ({ ...old, [key]: event.target.value })), ...extra,
    }));
  const keyDown = (event) => {
    if (event.key !== 'Tab') return;
    const nodes = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea')];
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  if (!layer) return null;
  return createPortal(h('div', { className: 'su-overlay' },
    h('section', { className: 'su-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'su-title', ref: dialog, onKeyDown: keyDown },
      h('header', { className: 'su-header' }, h('div', null,
        h('h2', { id: 'su-title' }, labels.title), h('p', null, labels.subtitle)),
        h('button', { type: 'button', onClick: onClose, 'aria-label': labels.close, className: 'su-close' }, '×')),
      !context ? h('p', { role: 'status' }, labels.loading) : null,
      !context?.sessionId && context ? h('p', { role: 'alert' }, labels.session) : null,
      h('div', { className: 'su-grid' }, field('target', labels.target, labels.targetHint), field('port', labels.port, '22', { inputMode: 'numeric' })),
      field('directory', labels.directory, '~/.pi-desktop/uploads'),
      field('identity', labels.identity, labels.identityHint),
      h('p', { className: 'su-note' }, labels.note),
      context?.profileScope === 'server' ? h('p', { className: 'su-note' }, labels.profileScopeNote) : null,
      changed ? h('p', { className: 'su-error', role: 'alert' }, context?.sessionId !== job.sessionId ? labels.changed : labels.configurationChanged) : null,
      h('div', { className: 'su-files', 'aria-live': 'polite' },
        job ? h('strong', null, labels[job.state] || job.state) : h('p', null, labels.empty),
        job?.files?.length ? h('ul', null, ...job.files.map((file, index) => h('li', { key: index }, h('span', null, file.name), h('small', null, sizeText(file.size))))) : null,
        job?.state === 'uploading' ? h('div', null,
          h('progress', { max: Math.max(job.total, 1), value: job.sent, 'aria-label': labels.uploading }),
          h('small', null, `${sizeText(job.sent)} / ${sizeText(job.total)}`)) : null,
        job?.results?.length ? h('div', null,
          job.state !== 'done' ? h('p', { className: 'su-note' }, labels.partial) : null,
          ...job.results.map((result) => h('code', { className: 'su-path', key: result.path }, result.path))) : null),
      error || job?.error ? h('pre', { className: 'su-error', role: 'alert' }, error || job.error) : null,
      message ? h('p', { role: 'status' }, message) : null,
      h('footer', { className: 'su-actions' },
        !active ? h('button', { type: 'button', disabled: pending || !context?.sessionId || !config.target.trim(), onClick: () => run(async () => {
          const saved = await call('saveConfig', { config, sessionId: context.sessionId, ...(context.bindingKey ? { bindingKey: context.bindingKey } : {}) });
          setConfig({ ...saved.config, port: saved.config.port || '' });
          setContext(await call('context'));
          await pasteBridge?.refresh();
          setMessage(labels.saved);
        }) }, labels.save) : null,
        active || job?.state === 'selected' ? h('button', { type: 'button', disabled: pending, onClick: () => run(async () => setJob(await call('cancel', { id: job.id }))) }, labels.cancel) : null,
        !active ? h('button', { type: 'button', disabled: pending || !context?.sessionId, onClick: () => run(async () => setJob(await call('select'))) }, labels.choose) : null,
        job?.state === 'selected' ? h('button', { type: 'button', className: 'su-primary', disabled: pending || changed || !config.target.trim(), onClick: () => run(async () => setJob(await call('start', { id: job.id, config, ...(context.bindingKey ? { bindingKey: context.bindingKey } : {}) }))) }, labels.start) : null,
        job?.state === 'done' ? h('button', { type: 'button', className: 'su-primary', disabled: !insertReady, onClick: () => run(async () => {
          if (!insertReady) return;
          // Dispatch before yielding so the Host captures this trusted click.
          await host.dispatch('composer.replaceDraft', prepared.replacement);
          setMessage(labels.inserted);
        }) }, labels.insert) : null),
      h('p', { className: 'su-note' }, labels.pasteHint),
      h('p', { className: 'su-note' }, labels.hint))), layer);
}

function ComposerControl() {
  const [open, setOpen] = useState(false);
  const [pasted, setPasted] = useState(pasteState);
  const [session, setSession] = useState(displayedSession);
  const remote = isRemoteContext(session);
  useEffect(() => { pasteListeners.add(setPasted); return () => pasteListeners.delete(setPasted); }, []);
  useEffect(() => { sessionListeners.add(setSession); return () => sessionListeners.delete(setSession); }, []);
  useEffect(() => { if (!remote) setOpen(false); }, [remote]);
  const labels = labelsFor(displayLocale);
  if (!remote && pasted?.state !== 'context-error') return null;
  return h('span', { className: 'su-control' },
    remote ? h('button', { type: 'button', className: 'su-launch', title: labels.subtitle, onClick: () => setOpen(true) }, labels.title) : null,
    h(UploadStatus, { pasted, labels,
      onCancel: () => { if (pasted.state === 'context-error') publishPaste(null); else void pasteBridge?.cancel(); },
      onConfigure: () => setOpen(true),
      onResume: () => void pasteBridge?.resume().catch(error => publishPaste({ state: 'error', message: error.message })),
    }),
    open ? h(UploadDialog, { onClose: () => setOpen(false) }) : null);
}

export function onLoad(pi) {
  host = pi;
  rpc = createRpcQueue(pi.dispatch);
  pasteBridge = installPasteBridge({ call, readDraft: () => pi.dispatch('composer.readDraft', {}), labels: () => labelsFor(displayLocale), onStatus: publishPaste });
  pi.ui.injectStyle(`
    .su-control { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; vertical-align: middle; }
    .su-paste-state { display: inline-flex; align-items: center; gap: 5px; min-width: 0; max-width: 260px; vertical-align: middle; }
    .su-paste-state small { max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px; opacity: .8; }
    .su-paste-state button { font: inherit; background: transparent; color: inherit; border: 0; cursor: pointer; padding: 2px 4px; }
    .su-launch { display: inline-flex; align-items: center; flex: none; font: inherit; font-size: 12px; line-height: 20px; min-height: 28px; border: 0; border-radius: 6px; background: transparent; color: var(--ds-text-muted, light-dark(#757575,#aaa)); padding: 4px 0; white-space: nowrap; cursor: pointer; }
    .su-paste-state .su-status-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 16px; height: 16px; padding: 0; }
    .su-status-icon svg { display: block; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .su-paste-state .su-status-success { color: var(--ds-text-success, light-dark(#258357,#80d7a2)); }
    .su-paste-state .su-status-error { color: var(--ds-text-error, light-dark(#c34c4c,#ffb4ab)); }
    .su-control :focus-visible { outline: 2px solid var(--ds-text-muted, #757575); outline-offset: 3px; }
    .su-launch:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
    .su-overlay { position: fixed; inset: 0; display: grid; place-items: center; padding: 20px; background: rgba(0,0,0,.35); color-scheme: light dark; }
    .su-dialog { box-sizing: border-box; width: min(520px, 100%); max-height: calc(100dvh - 40px); overflow: auto; background: light-dark(#fff,#202020); color: light-dark(#202020,#eee); border: 1px solid light-dark(#ddd,#444); border-radius: 16px; padding: 24px; font: 13px/1.5 -apple-system,BlinkMacSystemFont,sans-serif; }
    .su-header { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
    .su-header h2 { font-size: 20px; margin: 0; letter-spacing: -.4px; }
    .su-header p { margin: 4px 0 0; opacity: .65; }
    .su-dialog button { font: inherit; cursor: pointer; border: 1px solid light-dark(#ccc,#555); border-radius: 8px; padding: 7px 12px; background: transparent; color: inherit; }
    .su-dialog button:disabled { opacity: .4; cursor: not-allowed; }
    .su-dialog .su-close { border: 0; padding: 0 4px; font-size: 24px; align-self: start; }
    .su-field { display: flex; flex-direction: column; gap: 5px; margin: 12px 0; min-width: 0; }
    .su-field span { font-size: 12px; font-weight: 600; }
    .su-field input { min-width: 0; box-sizing: border-box; width: 100%; border: 1px solid light-dark(#ccc,#555); background: light-dark(#fafafa,#282828); color: inherit; border-radius: 7px; padding: 9px 10px; font: 13px ui-monospace,monospace; }
    .su-grid { display: grid; grid-template-columns: minmax(0,1fr) 110px; gap: 12px; }
    .su-note { font-size: 12px; opacity: .65; margin: 12px 0 0; }
    .su-files { margin: 18px 0; padding: 14px; border: 1px solid light-dark(#ddd,#444); border-radius: 8px; }
    .su-files p { margin: 0; }
    .su-files ul { list-style: none; padding: 0; margin: 8px 0 0; max-height: 160px; overflow: auto; }
    .su-files li { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; }
    .su-files li span { overflow-wrap: anywhere; }
    .su-files small { opacity: .6; white-space: nowrap; }
    .su-files progress { width: 100%; margin-top: 12px; accent-color: light-dark(#222,#eee); }
    .su-path { display: block; user-select: text; white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 10px; font-size: 11px; }
    .su-error { color: light-dark(#a32620,#ffb4ab); white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; max-height: 140px; overflow: auto; }
    .su-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
    .su-dialog .su-primary { border-radius: 999px; background: light-dark(#202020,#eee); color: light-dark(#fff,#202020); border-color: transparent; }
    .su-dialog :focus-visible { outline: 2px solid #4285f4; outline-offset: 2px; }
    @media (prefers-color-scheme: dark) { .su-overlay { color-scheme: dark; } }
  `);
  pi.slots.register({ slot: 'composerControl', positions: ['left'], component: ComposerControl });
}

export function onUnload() {
  pasteBridge?.dispose(); pasteBridge = null;
  pasteListeners.clear(); pasteState = null;
  sessionListeners.clear(); displayedSession = null;
}
