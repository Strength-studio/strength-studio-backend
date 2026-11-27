import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const PROOF_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_MS = 15 * 60 * 1000;
export const secret = () => randomBytes(32).toString('base64url');
export const validSecret = (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value);

export function seal(key: Buffer, source: string, value: object) {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(source));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString('base64url');
}
export function unseal<T>(key: Buffer, source: string, value: string): T {
  const data = Buffer.from(value, 'base64url');
  const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  cipher.setAAD(Buffer.from(source)); cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8')) as T;
}
