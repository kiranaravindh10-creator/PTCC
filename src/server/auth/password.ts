import "server-only";
import { randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing with scrypt (Node built-in), using OWASP's recommended parameters.
 * Hashes are self-describing — `scrypt$N$r$p$salt$hash` — so parameters can be raised
 * later and existing users re-hashed transparently at their next sign-in.
 */

const PARAMS = { N: 2 ** 17, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

function scrypt(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize("NFKC"), salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

function options(N: number, r: number, p: number): ScryptOptions {
  // maxmem must exceed 128 * N * r bytes.
  return { N, r, p, maxmem: 256 * N * r };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEY_LENGTH, options(PARAMS.N, PARAMS.r, PARAMS.p));
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export type PasswordCheck = { valid: boolean; needsRehash: boolean };

export async function verifyPassword(stored: string, password: string): Promise<PasswordCheck> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return { valid: false, needsRehash: false };
  const [, nRaw, rRaw, pRaw, saltRaw, keyRaw] = parts as [string, string, string, string, string, string];
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  const expected = Buffer.from(keyRaw, "base64");
  const actual = await scrypt(password, Buffer.from(saltRaw, "base64"), expected.length, options(N, r, p));
  const valid = actual.length === expected.length && timingSafeEqual(actual, expected);
  const needsRehash = N !== PARAMS.N || r !== PARAMS.r || p !== PARAMS.p || expected.length !== KEY_LENGTH;
  return { valid, needsRehash };
}

let dummyHash: Promise<string> | null = null;

/**
 * Burns the same time as a real verification. Used when the account doesn't exist so
 * response times don't reveal which phone numbers/emails have accounts.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(await dummyHash, password);
}

/** Readable temporary password, e.g. `kmrt-7hqx-p2nd` (no 0/o/1/l to avoid misreading). */
export function generateTemporaryPassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const group = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `${group()}-${group()}-${group()}`;
}

/** Returns a message if the password is unacceptable, otherwise null (NIST 800-63B style: length, not composition). */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (new Set(password).size < 4) return "That password is too easy to guess.";
  return null;
}
