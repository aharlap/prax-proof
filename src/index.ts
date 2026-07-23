// SPDX-License-Identifier: MIT
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import snippetJs from "./generated/p.js.txt";
import { cors } from "hono/cors";
import { adminAuth, keyAuth, mintKey, readAuth } from "./auth";
import type { Env } from "./env";
import { D1Storage } from "./storage/d1";
import { platformRateLimit, rateLimit } from "./ratelimit";
import { ingestStatements } from "./xapi/ingest";
import { LLMS_TXT } from "./llms";
import { aboutHandler } from "./about";
import { landingHandler } from "./landing";
import { DASHBOARD_CSS } from "./dashboard/styles";
import { DASHBOARD_JS } from "./dashboard/ui";
import { dashboardRoutes } from "./dashboard/routes";
import { apiRoutes } from "./api/routes";
import { privacyHandler } from "./privacy";
import { runRetention } from "./retention";

const ERROR_DOCS = "https://github.com/Praxity/prax-proof#errors";

type Ctx = {
  Bindings: Env;
  Variables: {
    keyId: string;
    activityScope: string | null;
    dailyLimit: number;
    identityMode: string;
  };
};
type KeyKind = "ingest" | "read";

const app = new Hono<Ctx>();

app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  c.res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.res.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; object-src 'none'; style-src 'self' 'unsafe-inline'",
  );
});

app.use("/admin/*", async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "no-store");
});

app.use(
  "/xapi/*",
  cors({
    origin: "*",
    allowMethods: ["POST", "PUT", "GET", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "X-Experience-API-Version", "X-Proof-Consent"],
    maxAge: 86400,
  }),
);
app.use("/xapi/*", async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "no-store");
});

app.get("/xapi/about", (c) => c.json({ version: ["1.0.3"] }));

app.get("/p.js", (c) =>
  c.body(snippetJs, 200, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  }),
);

app.get("/", landingHandler);
app.get("/about", aboutHandler);
app.get("/privacy", privacyHandler);

app.get("/llms.txt", async (c) => {
  const origin = new URL(c.req.url).origin;
  const settings = await new D1Storage(c.env.DB).getSettings();
  const privacyUrl = settings.privacyUrl || `${origin}/privacy`;
  const text = LLMS_TXT
    .replaceAll("{{PROOF_ORIGIN}}", origin)
    .replaceAll("{{TRACKING_MODE}}", settings.trackingMode)
    .replaceAll("{{PRIVACY_URL}}", privacyUrl)
    .replaceAll("{{OPERATOR_NAME}}", settings.operatorName || "the activity operator")
    .replaceAll("{{RETENTION_DAYS}}", String(settings.retentionDays))
    .replaceAll("{{REGION_TEXT}}", settings.regionLabel ? ` in ${settings.regionLabel}` : "");
  return c.body(text, 200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
});

const requireVersion: MiddlewareHandler<Ctx> = async (c, next) => {
  const v = c.req.header("X-Experience-API-Version");
  if (!v || !/^1\.0(?:\.\d+)?$/.test(v)) {
    return c.json(
      { error: "The X-Experience-API-Version header is required and must be 1.0.x.", docs: ERROR_DOCS },
      400,
    );
  }
  await next();
};

const MAX_REQUEST_BYTES = 256 * 1024;

async function readJson(c: Context<Ctx>): Promise<
  { ok: true; body: unknown } | { ok: false; error: string; status: 400 | 413 }
> {
  const declaredLength = Number(c.req.header("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return { ok: false, error: "Request body exceeds the 256 KiB limit.", status: 413 };
  }
  const body = c.req.raw.body;
  if (!body) return { ok: false, error: "Request body is not valid JSON.", status: 400 };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return { ok: false, error: "Request body exceeds the 256 KiB limit.", status: 413 };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, error: "Request body is not valid JSON.", status: 400 };
  }
}

function parseKeyKind(raw: unknown): KeyKind | null {
  if (raw === undefined) return "ingest";
  return raw === "ingest" || raw === "read" ? raw : null;
}

const ingestPlatformLimit = platformRateLimit("INGEST_RATE_LIMITER", (c) => c.get("keyId"));
const adminPlatformLimit = platformRateLimit("ADMIN_RATE_LIMITER", (c) => {
  return c.req.header("CF-Connecting-IP") ?? "unknown";
});

async function ingest(c: Context<Ctx>, body: unknown) {
  const storage = new D1Storage(c.env.DB);
  const keyId = c.get("keyId");
  const result = await ingestStatements(storage, body, new Date(), {
    keyId,
    activityScope: c.get("activityScope"),
    identityMode: c.get("identityMode"),
  });
  return result;
}

app.post("/xapi/statements", requireVersion, keyAuth, ingestPlatformLimit, rateLimit(120), async (c) => {
  const parsed = await readJson(c);
  if (!parsed.ok) {
    return c.json({ error: parsed.error, docs: ERROR_DOCS }, parsed.status);
  }
  const result = await ingest(c, parsed.body);
  if (!result.ok) return c.json({ error: result.error, docs: ERROR_DOCS }, result.status);
  return c.json(result.ids, 200);
});

app.put("/xapi/statements", requireVersion, keyAuth, ingestPlatformLimit, rateLimit(120), async (c) => {
  const statementId = c.req.query("statementId");
  if (!statementId) {
    return c.json({ error: "PUT requires a statementId query parameter.", docs: ERROR_DOCS }, 400);
  }
  const parsed = await readJson(c);
  if (!parsed.ok) return c.json({ error: parsed.error, docs: ERROR_DOCS }, parsed.status);
  const body = parsed.body;
  if (Array.isArray(body) || typeof body !== "object" || body === null) {
    return c.json({ error: "PUT accepts a single statement object body.", docs: ERROR_DOCS }, 400);
  }
  const supplied = (body as { id?: unknown }).id;
  if (supplied !== undefined && supplied !== statementId) {
    return c.json(
      { error: "The statement id in the body does not match the statementId parameter.", docs: ERROR_DOCS },
      400,
    );
  }
  const result = await ingest(c, { ...body, id: statementId });
  if (!result.ok) return c.json({ error: result.error, docs: ERROR_DOCS }, result.status);
  return c.body(null, 204);
});

app.post("/admin/keys", adminPlatformLimit, adminAuth, async (c) => {
  const parsed = await readJson(c);
  if (!parsed.ok) return c.json({ error: parsed.error, docs: ERROR_DOCS }, parsed.status);
  const body = parsed.body;
  const rawLabel = (body as { label?: unknown })?.label;
  const label = typeof rawLabel === "string" ? rawLabel.trim() : "";
  if (!label) {
    return c.json({ error: "A non-empty label string is required.", docs: ERROR_DOCS }, 400);
  }
  const kind = parseKeyKind((body as { kind?: unknown })?.kind);
  if (!kind) {
    return c.json({ error: 'Key kind must be "ingest" or "read".', docs: ERROR_DOCS }, 400);
  }
  const input = body as Record<string, unknown>;
  const activityScope = typeof input.activityScope === "string" ? input.activityScope.trim() : null;
  const allowedOrigin = typeof input.allowedOrigin === "string" ? input.allowedOrigin.trim() : null;
  const dailyLimit = typeof input.dailyLimit === "number" ? Math.floor(input.dailyLimit) : 10000;
  const identityMode = input.identityMode === "named" || input.identityMode === "token"
    ? input.identityMode
    : "anonymous";
  const parseUrl = (value: string) => {
    try { return new URL(value); } catch { return null; }
  };
  if (activityScope && !parseUrl(activityScope)) {
    return c.json({ error: "activityScope must be an absolute URL.", docs: ERROR_DOCS }, 400);
  }
  const allowedOriginUrl = allowedOrigin ? parseUrl(allowedOrigin) : null;
  if (allowedOrigin && (!allowedOriginUrl || allowedOriginUrl.origin !== allowedOrigin)) {
    return c.json({ error: "allowedOrigin must be an origin without a path.", docs: ERROR_DOCS }, 400);
  }
  if (dailyLimit < 1 || dailyLimit > 100000) {
    return c.json({ error: "dailyLimit must be between 1 and 100000.", docs: ERROR_DOCS }, 400);
  }
  const { id, secret } = await mintKey(c.env.DB, label, kind, {
    activityScope,
    allowedOrigin,
    dailyLimit,
    identityMode,
  });
  return c.json({ id, secret, label, kind, activityScope, allowedOrigin, dailyLimit, identityMode }, 201);
});

app.post("/admin/keys/:id/revoke", adminPlatformLimit, adminAuth, async (c) => {
  const revoked = await new D1Storage(c.env.DB).revokeKey(c.req.param("id"));
  return revoked ? c.body(null, 204) : c.json({ error: "Active key not found." }, 404);
});

app.get("/admin/learners/:id", adminPlatformLimit, adminAuth, async (c) => {
  const storage = new D1Storage(c.env.DB);
  const learner = await storage.getLearner(c.req.param("id"));
  if (!learner) return c.json({ error: "Learner not found." }, 404);
  const page = Math.max(1, Math.floor(Number(c.req.query("page")) || 1));
  const statements = await storage.rawStatementsForLearner(learner.id, 10000, (page - 1) * 10000);
  return c.json({
    learner,
    statements: statements.map((raw) => JSON.parse(raw)),
    pagination: { page, perPage: 10000, hasMore: statements.length === 10000 },
  }, 200, {
    "Cache-Control": "no-store",
  });
});

app.delete("/admin/learners/:id", adminPlatformLimit, adminAuth, async (c) => {
  const deleted = await new D1Storage(c.env.DB).deleteLearner(c.req.param("id"));
  return deleted ? c.body(null, 204) : c.json({ error: "Learner not found." }, 404);
});

app.get("/dashboard.css", (c) =>
  c.body(DASHBOARD_CSS, 200, {
    "Content-Type": "text/css; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  }),
);
app.get("/dashboard.js", (c) =>
  c.body(DASHBOARD_JS, 200, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  }),
);
app.use("/dashboard/*", async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "no-store");
});
app.use("/dashboard", async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "no-store");
});
app.use("/dashboard/*", adminAuth);
app.use("/dashboard", adminAuth);
app.route("/dashboard", dashboardRoutes);
app.use("/api/*", async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "no-store");
});
app.use("/api/*", readAuth);
app.route("/api", apiRoutes);

export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runRetention(env));
  },
} satisfies ExportedHandler<Env>;
