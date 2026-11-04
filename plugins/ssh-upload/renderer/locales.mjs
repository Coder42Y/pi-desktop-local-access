export const en = {
  title: 'SSH Upload', subtitle: 'Send the file, not your Mac path.', close: 'Close',
  target: 'SSH destination', targetHint: 'Config alias or user@hostname', port: 'Port (optional)',
  directory: 'Remote directory', identity: 'Identity file (optional)', identityHint: '~/.ssh/id_ed25519',
  note: 'Uses system SSH config, keys and agent. No passwords stored. First connect in Terminal to verify the host fingerprint.',
  choose: 'Choose files', start: 'Upload files', cancel: 'Cancel upload', insert: 'Insert remote paths',
  inserted: 'Remote paths inserted. Nothing was sent automatically.', empty: 'Choose up to 20 files. They stay on your Mac until you click Upload.',
  selecting: 'Waiting for the macOS file picker…', selected: 'Ready to upload', uploading: 'Uploading / verifying…',
  done: 'Uploaded · SHA-256 verified', error: 'Upload failed', cancelled: 'Cancelled',
  session: 'Open a conversation first.', changed: 'This upload belongs to another conversation. Return to it to upload or insert paths.',
  loading: 'Loading…', hint: 'Files use a fresh private subdirectory; existing server files are never overwritten.',
  remoteIntro: 'Files uploaded to the SSH server (use these remote paths, not local Mac paths):',
  partial: 'Some files completed before this job stopped. Their server paths are listed below; the failed file is not verified.',
};
export const zh = {
  title: 'SSH 上传', subtitle: '真正传输文件，而不是发送 Mac 路径。', close: '关闭',
  target: 'SSH 目标', targetHint: 'SSH 配置别名或 user@hostname', port: '端口（可选）',
  directory: '服务器接收目录', identity: '密钥文件路径（可选）', identityHint: '~/.ssh/id_ed25519',
  note: '复用系统 SSH 配置、密钥和 agent，不保存密码。首次连接请先在终端确认服务器指纹。',
  choose: '选择文件', start: '上传文件', cancel: '取消上传', insert: '插入远端路径',
  inserted: '远端路径已插入草稿，尚未发送消息。', empty: '每次最多选择 20 个文件，点击上传后才会传输。',
  selecting: '等待 Mac 文件选择框…', selected: '已选择，等待上传', uploading: '正在上传／校验…',
  done: '上传完成 · SHA-256 校验通过', error: '上传失败', cancelled: '已取消',
  session: '请先打开一个会话。', changed: '这次上传属于另一个会话，请切回原会话后再上传或插入路径。',
  loading: '正在加载…', hint: '文件保存在独立的私有子目录中，不覆盖服务器已有文件。',
  remoteIntro: '以下文件已上传到 SSH 服务器，请使用这些远端路径，不要使用 Mac 本地路径：',
  partial: '任务停止前部分文件已上传，下方列出它们的远端路径；失败的文件未通过校验。',
};
export const labelsFor = (locale) => String(locale).toLowerCase().startsWith('zh') ? zh : en;
Object.assign(en, {
  save: 'Save SSH target', saved: 'Saved. Paste files directly into the chat composer.',
  pasteReceiving: 'Reading pasted file…', pasteDone: 'SSH uploaded · remote paths inserted',
  pasteFailed: 'SSH paste failed. Cancel the placeholder and paste again.',
  pasteDetached: 'Uploaded. Return to the original conversation to insert paths.',
  pasteBusy: 'Finish or cancel the previous pasted upload first.',
  pasteRemoved: 'The paste placeholder was removed or the conversation changed.',
  pasteResume: 'Insert uploaded paths', pasteCancel: 'Cancel pasted upload',
  pasteHint: 'Save once, then paste files or screenshots directly into the chat composer. Plain text is unchanged.',
});
Object.assign(zh, {
  save: '保存 SSH 目标', saved: '已保存，现在可直接在聊天输入框粘贴文件。',
  pasteReceiving: '正在读取粘贴的文件…', pasteDone: 'SSH 上传完成 · 远端路径已回填',
  pasteFailed: 'SSH 粘贴上传失败，请取消占位后重新粘贴。',
  pasteDetached: '已上传，请切回原会话后回填远端路径。',
  pasteBusy: '请先完成或取消上一次粘贴上传。',
  pasteRemoved: '文件占位已删除，或当前会话已切换。',
  pasteResume: '回填远端路径', pasteCancel: '取消粘贴上传',
  pasteHint: '保存一次目标后，可直接在聊天输入框粘贴文件或截图；普通文字不受影响。',
});
Object.assign(en, {
  configure: 'Configure SSH', confirmTarget: 'Suggested previous target: confirm it belongs to this SSH project, then save.',
  pasteNeedsConfig: 'This SSH project has no confirmed target. Configure SSH first; no local attachment was created.',
  dropDirectory: 'Drop regular files only; folder upload is not supported.',
  pasteReceiving: 'Reading file…',
  pasteHint: 'Save the target for this SSH project, then paste or drag files into chat. Plain text is unchanged.',
});
Object.assign(zh, {
  configure: '设置 SSH', confirmTarget: '已预填旧目标，请确认属于当前 SSH 项目后保存；未保存前不会上传。',
  pasteNeedsConfig: '此 SSH 项目尚未确认目标，请先设置 SSH；未上传，也未创建本机附件。',
  dropDirectory: '目前仅支持普通文件，暂不支持拖入文件夹。',
  pasteReceiving: '正在读取文件…',
  pasteHint: '为当前 SSH 项目保存目标后，可直接粘贴或拖入文件；普通文字不受影响。',
});
Object.assign(en, {
  checkingTransfer: 'Checking the current conversation…',
  transferChanged: 'Conversation or draft changed while checking. Drop or paste the file again.',
  contextFailed: 'File was not added because its conversation could not be confirmed.',
});
Object.assign(zh, {
  checkingTransfer: '正在确认当前会话…',
  transferChanged: '确认期间会话或草稿发生变化，请重新拖入或粘贴文件。',
  contextFailed: '暂无法确认当前会话，文件未添加，也未上传。',
});
