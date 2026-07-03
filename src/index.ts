// SPDX-License-Identifier: MIT
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { adminAuth, keyAuth, sha256Hex } from "./auth";
import type { Env } from "./env";
import { D1Storage } from "./storage/d1";
import { rateLimit } from "./ratelimit";
import { ingestStatements } from "./xapi/ingest";

export const ERROR_DOCS = "https://github.com/aharlap/prax-proof#errors";

type Ctx = { Bindings: Env; Variables: { keyId: string } };

const app = new Hono<Ctx>();

app.get("/xapi/about", (c) => c.json({ version: ["1.0.3"] }));

const requireVersion: MiddlewareHandler<Ctx> = async (c, next) => {
  const v = c.req.header("X-Experience-API-Version");
  if (!v || !v.startsWith("1.0")) {
    return c.json(
      { error: "The X-Experience-API-Version header is required and must be 1.0.x.", docs: ERROR_DOCS },
      400,
    );
  }
  await next();
};

async function readJson(c: Context<Ctx>): Promise<unknown | undefined> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

app.post("/xapi/statements", requireVersion, keyAuth, rateLimit(120), async (c) => {
  const body = await readJson(c);
  if (body === undefined) {
    return c.json({ error: "Request body is not valid JSON.", docs: ERROR_DOCS }, 400);
  }
  const result = await ingestStatements(new D1Storage(c.env.DB), body);
  if (!result.ok) return c.json({ error: result.error, docs: ERROR_DOCS }, 400);
  return c.json(result.ids, 200);
});

app.put("/xapi/statements", requireVersion, keyAuth, rateLimit(120), async (c) => {
  const statementId = c.req.query("statementId");
  if (!statementId) {
    return c.json({ error: "PUT requires a statementId query parameter.", docs: ERROR_DOCS }, 400);
  }
  const body = await readJson(c);
  if (body === undefined || Array.isArray(body) || typeof body !== "object" || body === null) {
    return c.json({ error: "PUT accepts a single statement object body.", docs: ERROR_DOCS }, 400);
  }
  const supplied = (body as { id?: unknown }).id;
  if (supplied !== undefined && supplied !== statementId) {
    return c.json(
      { error: "The statement id in the body does not match the statementId parameter.", docs: ERROR_DOCS },
      400,
    );
  }
  const result = await ingestStatements(new D1Storage(c.env.DB), { ...body, id: statementId });
  if (!result.ok) return c.json({ error: result.error, docs: ERROR_DOCS }, 400);
  return c.body(null, 204);
});

app.post("/admin/keys", adminAuth, async (c) => {
  const body = await readJson(c);
  const label = (body as { label?: unknown } | undefined)?.label;
  if (typeof label !== "string" || label.length === 0) {
    return c.json({ error: "A non-empty label string is required.", docs: ERROR_DOCS }, 400);
  }
  const id = crypto.randomUUID();
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = [...secretBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  await new D1Storage(c.env.DB).createKey(id, await sha256Hex(secret), label);
  return c.json({ id, secret, label }, 201);
});

export default app;
