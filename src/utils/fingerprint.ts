import { createHash } from 'node:crypto';

export function computeFingerprint(content: string): string {
  const normalized = content.trim().replace(/\s+/g, ' ').toLowerCase();
  return createHash('sha256').update(normalized).digest('hex');
}
