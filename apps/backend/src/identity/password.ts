import { Algorithm, hash, verify } from '@node-rs/argon2';

const settings = { algorithm: Algorithm.Argon2id, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, settings);
}

export function checkPassword(digest: string, password: string): Promise<boolean> {
  return verify(digest, password);
}
