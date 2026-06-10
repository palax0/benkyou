import { hash, verify } from '@node-rs/argon2';

// spec §10.2: argon2id, t=3, m=64MB, p=1
const OPTIONS = { memoryCost: 65_536, timeCost: 3, parallelism: 1 } as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  return verify(hashed, plain);
}
