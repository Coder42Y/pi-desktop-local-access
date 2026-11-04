import { en } from './locales.mjs';
export function insertionText(job, sessionId, labels = en) {
  if (job?.sessionId !== sessionId) throw new Error('Session changed; return to the original conversation.');
  if (job.state !== 'done' || !job.results?.length || job.results.some((result) => !result.path?.startsWith('/') || !/^[a-f0-9]{64}$/.test(result.sha256 || ''))) {
    throw new Error('Only verified uploads may be inserted.');
  }
  return `\n${labels.remoteIntro}\n${job.results.map((result) => JSON.stringify(result.path)).join('\n')}\n`;
}

export const isRemoteSessionId = value => typeof value === 'string' && /^remote:[^:]+:.+$/.test(value);

export const isRemoteContext = value => typeof value?.sessionId === 'string' && value.sessionId.length > 0 &&
  (isRemoteSessionId(value.sessionId) || /^remote-project:[a-zA-Z0-9._-]+$/.test(value.projectPath || ''));
