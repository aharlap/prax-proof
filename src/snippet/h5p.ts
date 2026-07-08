// SPDX-License-Identifier: MIT
import type { SnippetContext } from "./core";

const VERB_PREFIX = "http://adlnet.gov/expapi/verbs/";
const ATTEMPTED = `${VERB_PREFIX}attempted`;
const INITIALIZED = `${VERB_PREFIX}initialized`;
const PASSTHROUGH_VERBS = new Set([
  `${VERB_PREFIX}completed`,
  `${VERB_PREFIX}passed`,
  `${VERB_PREFIX}failed`,
  `${VERB_PREFIX}scored`,
  `${VERB_PREFIX}answered`,
  `${VERB_PREFIX}progressed`,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function context(ctx: SnippetContext): Record<string, unknown> {
  const out: Record<string, unknown> = { registration: ctx.registration };
  if (ctx.page) out.extensions = { "https://praxity.io/xapi/ext/page": ctx.page };
  return out;
}

function subContentId(objectId: string): string | null {
  try {
    return new URL(objectId).searchParams.get("subContentId");
  } catch {
    return null;
  }
}

export function translateH5p(stmt: unknown, ctx: SnippetContext): Record<string, unknown> | null {
  if (!isRecord(stmt)) return null;
  const verb = isRecord(stmt.verb) ? stmt.verb : null;
  const object = isRecord(stmt.object) ? stmt.object : null;
  const verbId = verb?.id;
  const objectId = object?.id;
  if (typeof verbId !== "string" || typeof objectId !== "string" || !object) return null;

  const sid = subContentId(objectId);
  let outVerb = verbId;
  if (verbId === ATTEMPTED) {
    if (sid !== null) return null;
    outVerb = INITIALIZED;
  } else if (!PASSTHROUGH_VERBS.has(verbId)) {
    return null;
  }

  const outObject: Record<string, unknown> = {
    id: sid === null ? ctx.activityIri : `${ctx.activityIri}/q/${encodeURIComponent(sid)}`,
  };
  if ("definition" in object) outObject.definition = object.definition;

  const out: Record<string, unknown> = {
    actor: ctx.actor,
    verb: { id: outVerb },
    object: outObject,
    context: context(ctx),
    timestamp: new Date().toISOString(),
  };
  if (isRecord(stmt.result)) out.result = stmt.result;
  return out;
}

type H5pDispatcher = {
  on: (eventName: string, handler: (event: unknown) => void) => void;
};

function readDispatcher(win: unknown): H5pDispatcher | null {
  if (!isRecord(win)) return null;
  const h5p = win.H5P;
  if (!isRecord(h5p)) return null;
  const dispatcher = h5p.externalDispatcher;
  if (!isRecord(dispatcher) || typeof dispatcher.on !== "function") return null;
  return dispatcher as H5pDispatcher;
}

function statementFromEvent(event: unknown): unknown {
  if (!isRecord(event) || !isRecord(event.data)) return null;
  return event.data.statement;
}

export function subscribeH5p(
  win: unknown,
  onStatement: (stmt: unknown) => void,
  opts?: { intervalMs?: number; timeoutMs?: number; warn?: (msg: string) => void },
): void {
  const intervalMs = opts?.intervalMs ?? 250;
  const timeoutMs = opts?.timeoutMs ?? 20000;
  let elapsedMs = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  const timeout = () => {
    stop();
    try {
      opts?.warn?.("data-h5p is set but H5P was not found on this page");
    } catch {
      // Preserve the snippet's never-throw contract.
    }
  };

  const poll = () => {
    try {
      const dispatcher = readDispatcher(win);
      if (dispatcher) {
        stop();
        dispatcher.on("xAPI", (event: unknown) => {
          try {
            const stmt = statementFromEvent(event);
            if (stmt) onStatement(stmt);
          } catch {
            // H5P event handlers must not throw into the host page.
          }
        });
        return;
      }

      elapsedMs += intervalMs;
      if (elapsedMs >= timeoutMs) timeout();
    } catch {
      elapsedMs += intervalMs;
      if (elapsedMs >= timeoutMs) timeout();
    }
  };

  try {
    timer = setInterval(poll, intervalMs);
  } catch {
    // Preserve the snippet's never-throw contract.
  }
}
