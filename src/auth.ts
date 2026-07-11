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

export type AuthVariables = {
  keyId: string;
  activityScope: string | null;
  dailyLimit: number;
  identityMode: string;
};
type AuthCtx = { Bindings: Env; Variables: AuthVariables };
type KeyKind = "ingest" | "read";

type KeyOptions = {
  activityScope?: string | null;
  allowedOrigin?: string | null;
  dailyLimit?: number;
  identityMode?: string;
};

export async function mintKey(
  db: D1Database,
  label: string,
  kind: KeyKind = "ingest",
  options: KeyOptions = {},
): Promise<{ id: string; secret: string }> {
  const id = crypto.randomUUID();
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = [...secretBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  await new D1Storage(db).createKey(id, await sha256Hex(secret), label, kind, options);
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
  if (
    !key ||
    key.revokedAt !== null ||
    !timingSafeEqualStr(hash, key.secretHash) ||
    key.kind !== kind
  ) return null;
  return key;
}

function setKeyContext(c: Parameters<MiddlewareHandler<AuthCtx>>[0], key: Awaited<ReturnType<typeof verifyKey>>) {
  if (!key) return;
  c.set("keyId", key.id);
  c.set("activityScope", key.activityScope);
  c.set("dailyLimit", key.dailyLimit);
  c.set("identityMode", key.identityMode);
}

export const keyAuth: MiddlewareHandler<AuthCtx> = async (c, next) => {
  const creds = parseBasicAuth(c.req.header("Authorization") ?? null);
  if (!creds) return unauthorized(c);
  const key = await verifyKey(c.env.DB, creds.user, creds.pass, "ingest");
  if (!key) return unauthorized(c);
  const origin = c.req.header("Origin");
  if (key.allowedOrigin && origin !== key.allowedOrigin) {
    return c.json({ error: "This key is not permitted from this origin." }, 403);
  }
  if (key.trackingMode === "consent" && c.req.header("X-Proof-Consent") !== "granted") {
    return c.json({ error: "Tracking consent must be granted before this instance accepts statements." }, 403);
  }
  setKeyContext(c, key);
  await new D1Storage(c.env.DB).touchKey(key.id, new Date().toISOString());
  await next();
};

export const readAuth: MiddlewareHandler<AuthCtx> = async (c, next) => {
  const header = c.req.header("Authorization") ?? null;
  const basic = parseBasicAuth(header);
  if (basic) {
    if (basic.user === "admin") {
      if (!(await verifyAdmin(c.env, basic.pass))) return unauthorized(c);
      c.set("keyId", "admin");
      c.set("activityScope", null);
      c.set("dailyLimit", Number.MAX_SAFE_INTEGER);
      c.set("identityMode", "named");
      await next();
      return;
    }
    const key = await verifyKey(c.env.DB, basic.user, basic.pass, "read");
    if (!key) return unauthorized(c);
    setKeyContext(c, key);
    await new D1Storage(c.env.DB).touchKey(key.id, new Date().toISOString());
    await next();
    return;
  }

  if (!header?.startsWith("Bearer ")) return unauthorized(c);
  const token = header.slice(7);
  const i = token.indexOf(":");
  if (i < 0) return unauthorized(c);
  const key = await verifyKey(c.env.DB, token.slice(0, i), token.slice(i + 1), "read");
  if (!key) return unauthorized(c);
  setKeyContext(c, key);
  await new D1Storage(c.env.DB).touchKey(key.id, new Date().toISOString());
  await next();
};

export const adminAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const creds = parseBasicAuth(c.req.header("Authorization") ?? null);
  if (!creds || creds.user !== "admin") return unauthorized(c);
  if (!(await verifyAdmin(c.env, creds.pass))) return unauthorized(c);
  await next();
};
