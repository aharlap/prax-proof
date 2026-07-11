// SPDX-License-Identifier: MIT
import { z } from "zod";

export const MAX_STATEMENTS_PER_REQUEST = 10;

const MAX_IRI_LENGTH = 2048;
const MAX_NAME_LENGTH = 256;
const MAX_RESPONSE_LENGTH = 16 * 1024;

const iri = z.string().url().max(MAX_IRI_LENGTH);

const account = z.object({ homePage: iri, name: z.string().min(1).max(MAX_NAME_LENGTH) }).passthrough();

const actorSchema = z
  .object({
    objectType: z.literal("Agent").optional(),
    name: z.string().max(MAX_NAME_LENGTH).optional(),
    mbox: z.string().max(MAX_NAME_LENGTH).regex(/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/).optional(),
    mbox_sha1sum: z.string().regex(/^[0-9a-f]{40}$/).optional(),
    openid: iri.optional(),
    account: account.optional(),
  })
  .passthrough()
  .refine(
    (a) => [a.mbox, a.mbox_sha1sum, a.openid, a.account].filter(Boolean).length === 1,
    { message: "actor must have exactly one of mbox, mbox_sha1sum, openid, account" },
  );

const verbSchema = z
  .object({ id: iri, display: z.record(z.string(), z.string().max(MAX_NAME_LENGTH)).optional() })
  .passthrough();

const activityObject = z
  .object({
    objectType: z.literal("Activity").optional(),
    id: iri,
    definition: z
      .object({ name: z.record(z.string(), z.string().max(MAX_NAME_LENGTH)).optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

// Honest subset: non-Activity objects (StatementRef, Agent) are valid xAPI;
// we accept and store them but extract no activity from them.
const otherObject = z
  .object({ objectType: z.enum(["StatementRef", "Agent", "Group", "SubStatement"]) })
  .passthrough();

const scoreSchema = z
  .object({
    raw: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    scaled: z.number().min(-1).max(1).optional(),
  })
  .passthrough();

export const statementSchema = z
  .object({
    id: z.string().uuid().optional(),
    actor: actorSchema,
    verb: verbSchema,
    object: z.union([activityObject, otherObject]),
    result: z
      .object({
        score: scoreSchema.optional(),
        success: z.boolean().optional(),
        completion: z.boolean().optional(),
        duration: z.string().max(128).optional(),
        response: z.string().max(MAX_RESPONSE_LENGTH).optional(),
      })
      .passthrough()
      .optional(),
    context: z.object({ registration: z.string().uuid().optional() }).passthrough().optional(),
    timestamp: z.string().datetime({ offset: true }).optional(),
  })
  .passthrough();

export type ValidStatement = z.infer<typeof statementSchema>;

export function parseStatements(
  body: unknown,
): { ok: true; statements: ValidStatement[] } | { ok: false; error: string } {
  const batch = Array.isArray(body) ? body : [body];
  if (batch.length > MAX_STATEMENTS_PER_REQUEST) {
    return {
      ok: false,
      error: `A request may contain at most ${MAX_STATEMENTS_PER_REQUEST} statements.`,
    };
  }
  const out: ValidStatement[] = [];
  for (let i = 0; i < batch.length; i++) {
    const r = statementSchema.safeParse(batch[i]);
    if (!r.success) {
      const first = r.error.issues[0];
      const where = first.path.length ? ` at "${first.path.join(".")}"` : "";
      return {
        ok: false,
        error: `Statement ${i + 1} is not a valid xAPI statement${where}: ${first.message}`,
      };
    }
    out.push(r.data);
  }
  if (out.length === 0) return { ok: false, error: "Request contained no statements." };
  return { ok: true, statements: out };
}
