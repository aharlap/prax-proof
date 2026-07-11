// SPDX-License-Identifier: MIT
import type { IngestRecord, Storage } from "../storage/types";
import { activityName, extractColumns, extractPage, learnerIdentity } from "./extract";
import { parseStatements, type ValidStatement } from "./validate";

const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const STEP_EXTENSION = "https://praxity.io/xapi/ext/step";

type IdentityMode = "anonymous" | "token" | "named";
type IngestOptions = {
  keyId?: string | null;
  activityScope?: string | null;
  identityMode?: string;
  _policyRetry?: boolean;
};
type IngestFailure = { ok: false; error: string; status: 400 | 403 | 409 | 429 };

type Candidate = {
  comparison: string;
  compatibilityComparisons: Set<string>;
  canonicalHash: string;
  record: IngestRecord;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function statementForComparison(raw: string): string | null {
  try {
    const statement = JSON.parse(raw) as Record<string, unknown>;
    delete statement.stored;
    return canonicalJson(statement);
  } catch {
    return null;
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function identityMode(value: string | undefined): IdentityMode {
  return value === "anonymous" || value === "token" ? value : "named";
}

function strictestMode(a: IdentityMode, b: string | undefined): IdentityMode {
  const other = identityMode(b);
  if (a === "anonymous" || other === "anonymous") return "anonymous";
  if (a === "token" || other === "token") return "token";
  return "named";
}

function privacyRoot(activityIri: string | null, scope: string | null | undefined): string | null {
  if (!activityIri) return null;
  if (scope && (activityIri === scope || activityIri.startsWith(`${scope}/`))) return scope;
  const child = /\/(?:steps|q|questions)\//.exec(activityIri);
  return child ? activityIri.slice(0, child.index) : activityIri;
}

function stripClientStored(statement: ValidStatement, id: string): Record<string, unknown> {
  const input = { ...statement, id } as Record<string, unknown>;
  delete input.stored;
  return input;
}

function normalizeSuppliedTimestamp(statement: Record<string, unknown>): Record<string, unknown> {
  if (typeof statement.timestamp !== "string") return statement;
  return { ...statement, timestamp: new Date(statement.timestamp).toISOString() };
}

function copyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function safeDefinition(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const allowed = [
    "name", "description", "type", "moreInfo", "interactionType",
    "correctResponsesPattern", "choices", "scale", "source", "target", "steps",
  ];
  const output: Record<string, unknown> = {};
  for (const key of allowed) {
    if (input[key] !== undefined) output[key] = copyJson(input[key]);
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function privacySafeStatement(
  statement: Record<string, unknown>,
  actor: Record<string, unknown>,
): Record<string, unknown> {
  const verb = statement.verb as Record<string, unknown>;
  const object = statement.object as Record<string, unknown>;
  const result = statement.result as Record<string, unknown> | undefined;
  const context = statement.context as Record<string, unknown> | undefined;
  const output: Record<string, unknown> = {
    id: statement.id,
    actor,
    verb: {
      id: verb.id,
      ...(verb.display !== undefined ? { display: copyJson(verb.display) } : {}),
    },
    object: {
      ...(object.objectType !== undefined ? { objectType: object.objectType } : {}),
      id: object.id,
      ...(safeDefinition(object.definition) ? { definition: safeDefinition(object.definition) } : {}),
    },
  };

  if (result) {
    const cleanedResult: Record<string, unknown> = {};
    for (const key of ["score", "success", "completion", "duration", "response"]) {
      if (result[key] !== undefined) cleanedResult[key] = copyJson(result[key]);
    }
    const step = (result.extensions as Record<string, unknown> | undefined)?.[STEP_EXTENSION];
    if (typeof step === "string") cleanedResult.extensions = { [STEP_EXTENSION]: step };
    if (Object.keys(cleanedResult).length > 0) output.result = cleanedResult;
  }

  const cleanedContext: Record<string, unknown> = {};
  if (typeof context?.registration === "string") cleanedContext.registration = context.registration;
  if (Object.keys(cleanedContext).length > 0) output.context = cleanedContext;
  if (typeof statement.timestamp === "string") output.timestamp = statement.timestamp;
  return output;
}

async function anonymousIdentity(keyId: string | null | undefined, identity: string): Promise<string> {
  return `anonymous:${await sha256(`${keyId ?? "legacy"}\u0000${identity}`)}`;
}

async function applyIdentityPolicy(
  statement: Record<string, unknown>,
  sourceIdentity: string,
  sourceDisplayName: string | null,
  mode: IdentityMode,
  keyId: string | null | undefined,
): Promise<{ statement: Record<string, unknown>; identity: string; displayName: string | null }> {
  if (mode === "named") {
    return { statement, identity: sourceIdentity, displayName: sourceDisplayName };
  }
  if (mode === "token") {
    const token = (((statement.actor as Record<string, unknown>).account as Record<string, unknown>).name) as string;
    const actor = {
      objectType: "Agent",
      account: { homePage: "https://praxity.io/proof/token", name: token },
    };
    return {
      statement: privacySafeStatement(statement, actor),
      identity: `token:${keyId ?? "legacy"}:${token}`,
      displayName: null,
    };
  }

  const pseudonym = await anonymousIdentity(keyId, sourceIdentity);
  const actor = {
    objectType: "Agent",
    account: { homePage: "https://praxity.io/proof/anonymous", name: pseudonym.slice(10) },
  };
  return {
    statement: privacySafeStatement(statement, actor),
    identity: pseudonym,
    displayName: null,
  };
}

async function legacyShallowStatement(
  statement: Record<string, unknown>,
  sourceIdentity: string,
  mode: IdentityMode,
  keyId: string | null | undefined,
): Promise<Record<string, unknown>> {
  if (mode === "named") return statement;
  if (mode === "token") {
    const token = (((statement.actor as Record<string, unknown>).account as Record<string, unknown>).name) as string;
    return {
      ...statement,
      actor: {
        objectType: "Agent",
        account: { homePage: "https://praxity.io/proof/token", name: token },
      },
    };
  }
  const pseudonym = await anonymousIdentity(keyId, sourceIdentity);
  return {
    ...statement,
    actor: {
      objectType: "Agent",
      account: { homePage: "https://praxity.io/proof/anonymous", name: pseudonym.slice(10) },
    },
  };
}

function inActivityScope(iri: string, scope: string): boolean {
  return iri === scope || iri.startsWith(`${scope}/`);
}

export async function ingestStatements(
  storage: Storage,
  body: unknown,
  now: Date = new Date(),
  options: IngestOptions = {},
): Promise<{ ok: true; ids: string[]; inserted: number } | IngestFailure> {
  const parsed = parseStatements(body);
  if (!parsed.ok) return { ...parsed, status: 400 };

  const stored = now.toISOString();
  const ids: string[] = [];
  const prepared = parsed.statements.map((statement) => {
    const id = statement.id ?? crypto.randomUUID();
    ids.push(id);
    const columns = extractColumns(statement, id, stored);
    return {
      statement,
      id,
      columns,
      policyIri: privacyRoot(columns.activityIri, options.activityScope),
    };
  });
  const policyIris = [...new Set(prepared.map((item) => item.policyIri).filter((iri): iri is string => !!iri))];
  const activityModes = await storage.activityIdentityModes(policyIris);
  const candidates = new Map<string, Candidate>();

  for (const item of prepared) {
    const { statement, id, columns, policyIri } = item;
    if (options.activityScope && (!columns.activityIri || !inActivityScope(columns.activityIri, options.activityScope))) {
      return {
        ok: false,
        status: 403,
        error: "This key may only write statements for its configured activity.",
      };
    }

    const mode = strictestMode(identityMode(options.identityMode), policyIri ? activityModes.get(policyIri) : undefined);
    if (mode !== "named" && !columns.activityIri) {
      return {
        ok: false,
        status: 400,
        error: "Anonymous and token modes accept Activity statements only.",
      };
    }
    if (mode === "token") {
      const token = statement.actor.account?.name;
      if (!token || !OPAQUE_TOKEN.test(token)) {
        return {
          ok: false,
          status: 400,
          error: "Token-mode keys require an opaque 16-128 character actor account token.",
        };
      }
    }

    const original = stripClientStored(statement, id);
    const normalized = normalizeSuppliedTimestamp(original);
    const source = learnerIdentity(statement.actor);
    const pageUrl = columns.activityIri ? extractPage(statement) : null;
    const policy = await applyIdentityPolicy(
      normalized,
      source.identity,
      source.displayName,
      mode,
      options.keyId,
    );
    const legacyPolicy = await applyIdentityPolicy(
      original,
      source.identity,
      source.displayName,
      mode,
      options.keyId,
    );
    const legacyShallow = await legacyShallowStatement(original, source.identity, mode, options.keyId);
    const comparison = canonicalJson(policy.statement);
    const canonicalHash = await sha256(comparison);
    const previous = candidates.get(id);
    if (previous) {
      if (previous.canonicalHash !== canonicalHash) {
        return { ok: false, status: 409, error: `Statement id ${id} has conflicting content.` };
      }
      continue;
    }

    candidates.set(id, {
      comparison,
      canonicalHash,
      compatibilityComparisons: new Set([
        canonicalJson(original),
        canonicalJson(legacyPolicy.statement),
        canonicalJson(legacyShallow),
        comparison,
      ]),
      record: {
        statement: {
          ...columns,
          raw: JSON.stringify({ ...policy.statement, stored }),
          canonicalHash,
        },
        identity: policy.identity,
        displayName: policy.displayName,
        learnerId: crypto.randomUUID(),
        activityName: columns.activityIri ? activityName(statement) : null,
        pageUrl: mode === "named" && columns.activityIri === policyIri ? pageUrl : null,
        identityMode: mode,
        policyIri,
      },
    });
  }

  const existing = await storage.existingStatements([...candidates.keys()]);
  const records: IngestRecord[] = [];
  for (const [id, candidate] of candidates) {
    const prior = existing.get(id);
    if (!prior) {
      records.push(candidate.record);
      continue;
    }
    const matches = prior.canonicalHash
      ? prior.canonicalHash === candidate.canonicalHash
      : candidate.compatibilityComparisons.has(statementForComparison(prior.raw) ?? "");
    if (!matches) {
      return { ok: false, status: 409, error: `Statement id ${id} already exists with different content.` };
    }
  }

  try {
    const inserted = await storage.insertIngestRecords(records, options.keyId ?? null);
    return { ok: true, ids, inserted };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("proof_quota_exceeded")) {
      return { ok: false, status: 429, error: "This key has reached its daily statement limit." };
    }
    if (message.includes("proof_statement_conflict")) {
      return { ok: false, status: 409, error: "A statement id already exists with different content." };
    }
    if (message.includes("proof_identity_policy_changed")) {
      if (!options._policyRetry) {
        return ingestStatements(storage, body, now, { ...options, _policyRetry: true });
      }
      return { ok: false, status: 409, error: "The activity privacy policy changed; retry the request." };
    }
    throw error;
  }
}
