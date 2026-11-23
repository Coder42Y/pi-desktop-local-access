import { createElement as h } from 'react';

function StatusIcon({ success }) {
  return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true, focusable: false },
    h('path', { d: success ? 'M3 8l3.2 3.2L13 4.6' : 'M4 4l8 8M12 4l-8 8' }));
}

/** Presentation only: all actions use the existing paste-bridge callbacks. */
export function UploadStatus({ pasted, labels, onCancel, onConfigure, onResume }) {
  if (!pasted) return null;
  const success = pasted.state === 'done';
  const failed = pasted.state === 'error';
  const settled = success || failed;
  const message = pasted.message;
  const progress = pasted.job?.total && ['receiving', 'uploading'].includes(pasted.state)
    ? ` ${Math.round(100 * (pasted.state === 'receiving' ? pasted.job.received : pasted.job.sent) / pasted.job.total)}%` : '';
  return h('span', { className: 'su-paste-state', role: 'status', title: message },
    success ? h('span', { className: 'su-status-icon su-status-success', role: 'img', 'aria-label': message }, h(StatusIcon, { success: true }))
      : failed ? h('button', { type: 'button', className: 'su-status-icon su-status-error', title: message,
        'aria-label': `${labels.pasteCancel}: ${message}`, onClick: onCancel }, h(StatusIcon, { success: false }))
        : h('small', null, message, progress),
    pasted.state === 'detached' ? h('button', { type: 'button', onClick: onResume }, labels.pasteResume) : null,
    pasted.state === 'unconfigured' ? h('button', { type: 'button', onClick: onConfigure }, labels.configure) : null,
    !settled && ['checking', 'receiving', 'uploading', 'detached', 'context-error'].includes(pasted.state)
      ? h('button', { type: 'button', title: labels.pasteCancel, 'aria-label': labels.pasteCancel, onClick: onCancel }, '×') : null);
}
