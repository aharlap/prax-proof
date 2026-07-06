// SPDX-License-Identifier: MIT
import type { StatementRow } from "../storage/types";
import type { ValidStatement } from "./validate";

export function learnerIdentity(
  actor: ValidStatement["actor"],
): { identity: string; displayName: string | null } {
  if (actor.mbox) return { identity: actor.mbox, displayName: actor.name ?? null };
  if (actor.account)
    return {
      identity: `${actor.account.homePage}|${actor.account.name}`,
      displayName: actor.name ?? actor.account.name,
    };
  if (actor.mbox_sha1sum)
    return { identity: `sha1:${actor.mbox_sha1sum.toLowerCase()}`, displayName: actor.name ?? null };
  // Validation guarantees exactly one identifier, so this is openid.
  return { identity: actor.openid as string, displayName: actor.name ?? null };
}

const DURATION_RE =
  /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

export function parseDuration(iso: string): number | null {
  const m = DURATION_RE.exec(iso);
  if (!m || m[0] === "P") return null;
  const [, years, months, days, hours, minutes, seconds] = m.map((v) => (v ? Number(v) : 0));
  // Calendar-approximate: years/months rarely appear in learning durations.
  return (
    years * 31536000 + months * 2592000 + days * 86400 + hours * 3600 + minutes * 60 + seconds
  );
}

function isActivityObject(
  object: ValidStatement["object"],
): object is Extract<ValidStatement["object"], { id: string }> {
  const t = (object as { objectType?: string }).objectType;
  return (t === undefined || t === "Activity") && typeof (object as { id?: unknown }).id === "string";
}

export function activityName(stmt: ValidStatement): string | null {
  if (!isActivityObject(stmt.object)) return null;
  const names = (stmt.object as { definition?: { name?: Record<string, string> } }).definition?.name;
  if (!names) return null;
  return (
    names.en ??
    Object.entries(names).find(([key]) => key.startsWith("en"))?.[1] ??
    Object.values(names)[0] ??
    null
  );
}

const STEP_EXT = "https://praxity.io/xapi/ext/step";
const STEP_IRI_RE = /\/steps\/([^/]+)$/;

export function extractStep(stmt: ValidStatement): string | null {
  const objectId = (stmt.object as { id?: unknown }).id;
  if (typeof objectId === "string") {
    const m = STEP_IRI_RE.exec(objectId);
    if (m) {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return m[1];
      }
    }
  }
  const ext = (stmt.result as { extensions?: Record<string, unknown> } | undefined)?.extensions?.[STEP_EXT];
  return typeof ext === "string" ? ext : null;
}

export function extractColumns(
  stmt: ValidStatement,
  id: string,
  stored: string,
): Omit<StatementRow, "learnerId" | "raw"> {
  const score = stmt.result?.score;
  const bool = (v: boolean | undefined): number | null => (v === undefined ? null : v ? 1 : 0);
  const responseVal = (stmt.result as { response?: unknown } | undefined)?.response;
  return {
    id,
    verb: stmt.verb.id,
    activityIri: isActivityObject(stmt.object) ? stmt.object.id : null,
    scoreRaw: score?.raw ?? null,
    scoreMin: score?.min ?? null,
    scoreMax: score?.max ?? null,
    scoreScaled: score?.scaled ?? null,
    success: bool(stmt.result?.success),
    completion: bool(stmt.result?.completion),
    durationSec: stmt.result?.duration ? parseDuration(stmt.result.duration) : null,
    timestamp: stmt.timestamp ?? stored,
    stored,
    registration: stmt.context?.registration ?? null,
    step: extractStep(stmt),
    response: typeof responseVal === "string" ? responseVal : null,
  };
}
