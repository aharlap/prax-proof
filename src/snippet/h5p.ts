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
