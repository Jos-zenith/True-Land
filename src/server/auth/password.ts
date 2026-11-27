import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

/**
 * Password hashing with scrypt (memory-hard). Format: scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>.
 * Parameters are stored with each hash so they can be raised later without breaking old hashes.
 * Tests may lower the cost with LANDED_SCRYPT_N, honoured only when NODE_ENV is "test".
 */
function cost(): number {
  if (process.env.NODE_ENV === "test" && process.env.LANDED_SCRYPT_N) return Number(process.env.LANDED_SCRYPT_N);
  return 2 ** 15;
}

export async function hashPassword(password: string): Promise<string> {
  const N = cost();
  const r = 8;
  const p = 1;
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, 32, { N, r, p, maxmem: 128 * N * r * 2 });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Always do the work, even for unknown users, so timing does not reveal which emails exist.
  const parts = (stored ?? DUMMY).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const N = Number(n);
  const R = Number(r);
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, { N, r: R, p: Number(p), maxmem: 128 * N * R * 2 });
  return crypto.timingSafeEqual(actual, expected) && stored !== null;
}

// A valid hash of a random password, used when the user does not exist.
const DUMMY = `scrypt$${2 ** 15}$8$1$${crypto.randomBytes(16).toString("base64")}$${crypto.randomBytes(32).toString("base64")}`;

export const PASSWORD_RULES = { min: 12, max: 200 } as const;
