// SPDX-License-Identifier: MIT
import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";
import { D1Storage } from "./storage/d1";

export function parseBasicAuth(header: string | null): { user: string; pass: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return null;
  }
  const i = decoded.indexOf(":");
  if (i < 0) return null;
  return { user: decoded.slice(0, i), pass: decoded.slice(i + 1) };
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function mintKey(db: D1Database, label: string): Promise<{ id: string; secret: string }> {
  const id = crypto.randomUUID();
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = [...secretBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  await new D1Storage(db).createKey(id, await sha256Hex(secret), label);
  return { id, secret };
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  // Compare fixed-length hex digests without early exit.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function unauthorized(c: Parameters<MiddlewareHandler>[0]) {
  return c.json({ error: "Unauthorized" }, 401, { "WWW-Authenticate": 'Basic realm="proof"' });
}

export const keyAuth: MiddlewareHandler<{ Bindings: Env; Variables: { keyId: string } }> =
  async (c, next) => {
    const creds = parseBasicAuth(c.req.header("Authorization") ?? null);
    if (!creds) return unauthorized(c);
    const key = await new D1Storage(c.env.DB).findKey(creds.user);
    // Hash before the !key check so unknown-key and wrong-secret responses
    // do equal work (no key-id enumeration via response timing).
    const hash = await sha256Hex(creds.pass);
    if (!key || !timingSafeEqualStr(hash, key.secretHash)) return unauthorized(c);
    c.set("keyId", key.id);
    await next();
  };

export const adminAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const creds = parseBasicAuth(c.req.header("Authorization") ?? null);
  if (!creds || creds.user !== "admin") return unauthorized(c);
  const [given, expected] = await Promise.all([
    sha256Hex(creds.pass),
    sha256Hex(c.env.ADMIN_PASSWORD),
  ]);
  if (!timingSafeEqualStr(given, expected)) return unauthorized(c);
  await next();
};
