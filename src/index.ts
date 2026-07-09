// SPDX-License-Identifier: MIT
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import snippetJs from "./generated/p.js.txt";
import { cors } from "hono/cors";
import { adminAuth, keyAuth, mintKey, readAuth } from "./auth";
import type { Env } from "./env";
import { D1Storage } from "./storage/d1";
import { rateLimit } from "./ratelimit";
import { ingestStatements } from "./xapi/ingest";
import { LLMS_TXT } from "./llms";
import { aboutHandler } from "./about";
import { landingHandler } from "./landing";
import { DASHBOARD_CSS } from "./dashboard/styles";
import { dashboardRoutes } from "./dashboard/routes";
import { apiRoutes } from "./api/routes";

const ERROR_DOCS = "https://github.com/Praxity/prax-proof#errors";

type Ctx = { Bindings: Env; Variables: { keyId: string } };
type KeyKind = "ingest" | "read";

const app = new Hono<Ctx>();

app.use(
  "/xapi/*",
  cors({
    origin: "*",
    allowMethods: ["POST", "PUT", "GET", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "X-Experience-API-Version"],
    maxAge: 86400,
  }),
);

app.get("/xapi/about", (c) => c.json({ version: ["1.0.3"] }));

app.get("/p.js", (c) =>
  c.body(snippetJs, 200, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  }),
);

app.get("/", landingHandler);
app.get("/about", aboutHandler);

app.get("/llms.txt", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.body(LLMS_TXT.replaceAll("{{PROOF_ORIGIN}}", origin), 200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  });
});

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

function parseKeyKind(raw: unknown): KeyKind | null {
  if (raw === undefined) return "ingest";
  return raw === "ingest" || raw === "read" ? raw : null;
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
  const rawLabel = (body as { label?: unknown } | undefined)?.label;
  const label = typeof rawLabel === "string" ? rawLabel.trim() : "";
  if (!label) {
    return c.json({ error: "A non-empty label string is required.", docs: ERROR_DOCS }, 400);
  }
  const kind = parseKeyKind((body as { kind?: unknown } | undefined)?.kind);
  if (!kind) {
    return c.json({ error: 'Key kind must be "ingest" or "read".', docs: ERROR_DOCS }, 400);
  }
  const { id, secret } = await mintKey(c.env.DB, label, kind);
  return c.json({ id, secret, label, kind }, 201);
});

app.get("/dashboard.css", (c) =>
  c.body(DASHBOARD_CSS, 200, {
    "Content-Type": "text/css; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  }),
);
app.use("/dashboard/*", adminAuth);
app.use("/dashboard", adminAuth);
app.route("/dashboard", dashboardRoutes);
app.use("/api/*", async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "no-store");
});
app.use("/api/*", readAuth);
app.route("/api", apiRoutes);

export default app;
