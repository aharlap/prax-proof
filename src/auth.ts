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

type AuthCtx = { Bindings: Env; Variables: { keyId: string } };
type KeyKind = "ingest" | "read";

export async function mintKey(
  db: D1Database,
  label: string,
  kind: KeyKind = "ingest",
): Promise<{ id: string; secret: string }> {
  const id = crypto.randomUUID();
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = [...secretBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  await new D1Storage(db).createKey(id, await sha256Hex(secret), label, kind);
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

async function verifyAdmin(env: Pick<Env, "ADMIN_PASSWORD">, pass: string): Promise<boolean> {
  if (!env.ADMIN_PASSWORD) return false;
  const [given, expected] = await Promise.all([
    sha256Hex(pass),
    sha256Hex(env.ADMIN_PASSWORD),
  ]);
  return timingSafeEqualStr(given, expected);
}

async function verifyKey(db: D1Database, id: string, secret: string, kind: KeyKind) {
  const key = await new D1Storage(db).findKey(id);
  // Hash before the !key check so unknown-key and wrong-secret responses
  // do equal work (no key-id enumeration via response timing).
  const hash = await sha256Hex(secret);
  if (!key || !timingSafeEqualStr(hash, key.secretHash) || key.kind !== kind) return null;
  return key;
}

export const keyAuth: MiddlewareHandler<AuthCtx> = async (c, next) => {
  const creds = parseBasicAuth(c.req.header("Authorization") ?? null);
  if (!creds) return unauthorized(c);
  const key = await verifyKey(c.env.DB, creds.user, creds.pass, "ingest");
  if (!key) return unauthorized(c);
  c.set("keyId", key.id);
  await next();
};

export const readAuth: MiddlewareHandler<AuthCtx> = async (c, next) => {
  const header = c.req.header("Authorization") ?? null;
  const basic = parseBasicAuth(header);
  if (basic) {
    if (basic.user === "admin") {
      if (!(await verifyAdmin(c.env, basic.pass))) return unauthorized(c);
      c.set("keyId", "admin");
      await next();
      return;
    }
    const key = await verifyKey(c.env.DB, basic.user, basic.pass, "read");
    if (!key) return unauthorized(c);
    c.set("keyId", key.id);
    await next();
    return;
  }

  if (!header?.startsWith("Bearer ")) return unauthorized(c);
  const token = header.slice(7);
  const i = token.indexOf(":");
  if (i < 0) return unauthorized(c);
  const key = await verifyKey(c.env.DB, token.slice(0, i), token.slice(i + 1), "read");
  if (!key) return unauthorized(c);
  c.set("keyId", key.id);
  await next();
};

export const adminAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const creds = parseBasicAuth(c.req.header("Authorization") ?? null);
  if (!creds || creds.user !== "admin") return unauthorized(c);
  if (!(await verifyAdmin(c.env, creds.pass))) return unauthorized(c);
  await next();
};
