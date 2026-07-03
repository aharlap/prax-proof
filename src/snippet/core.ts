// SPDX-License-Identifier: MIT
// Pure snippet core: identity resolution and xAPI statement builders.
// No DOM, no fetch, no imports from the server code — Task 3 wires the browser.

export type IdentityMode = "anonymous" | "ask" | "token";

export interface IdentityAdapters {
  getStored(key: string): string | null;
  setStored(key: string, value: string): void;
  ask(message: string): string | null;
  urlParam(name: string): string | null;
  randomId(): string;
  origin: string;
}

export interface Actor {
  account: { homePage: string; name: string };
  name?: string;
}

const VERBS = {
  start: "http://adlnet.gov/expapi/verbs/initialized",
  step: "http://adlnet.gov/expapi/verbs/progressed",
  answer: "http://adlnet.gov/expapi/verbs/answered",
  finish: "http://adlnet.gov/expapi/verbs/completed",
} as const;

function deviceId(a: IdentityAdapters): string {
  let id = a.getStored("proof:device");
  if (!id) {
    id = a.randomId();
    a.setStored("proof:device", id);
  }
  return id;
}

export function resolveIdentity(mode: IdentityMode, a: IdentityAdapters): Actor {
  if (mode === "token") {
    const token = a.urlParam("plearner");
    if (token) return { account: { homePage: a.origin, name: token } };
    return resolveIdentity("anonymous", a);
  }
  const actor: Actor = { account: { homePage: a.origin, name: deviceId(a) } };
  if (mode === "ask") {
    let name = a.getStored("proof:name");
    if (!name) {
      const answer = (a.ask("Enter your name for the results report:") ?? "").trim();
      if (answer) {
        a.setStored("proof:name", answer);
        name = answer;
      }
    }
    if (name) actor.name = name;
  }
  return actor;
}

export interface SnippetContext {
  activityIri: string;
  activityName: string;
  actor: Actor;
  registration: string;
}

function verb(id: string) {
  return { id };
}

function base(ctx: SnippetContext, verbId: string, object: Record<string, unknown>) {
  return {
    actor: ctx.actor,
    verb: verb(verbId),
    object,
    context: { registration: ctx.registration },
    timestamp: new Date().toISOString(),
  };
}

function activityObject(ctx: SnippetContext) {
  return { id: ctx.activityIri, definition: { name: { en: ctx.activityName } } };
}

function childObject(ctx: SnippetContext, kind: "steps" | "questions", id: string) {
  return { id: `${ctx.activityIri}/${kind}/${encodeURIComponent(id)}` };
}

export function buildStart(ctx: SnippetContext): Record<string, unknown> {
  return base(ctx, VERBS.start, activityObject(ctx));
}

export function buildStep(ctx: SnippetContext, stepId: string): Record<string, unknown> {
  return base(ctx, VERBS.step, childObject(ctx, "steps", stepId));
}

export function buildAnswer(
  ctx: SnippetContext,
  questionId: string,
  opts?: { response?: string; correct?: boolean },
): Record<string, unknown> {
  const stmt = base(ctx, VERBS.answer, childObject(ctx, "questions", questionId));
  const result: Record<string, unknown> = {};
  if (opts?.correct !== undefined) result.success = opts.correct;
  if (opts?.response !== undefined) result.response = opts.response;
  if (Object.keys(result).length > 0) (stmt as Record<string, unknown>).result = result;
  return stmt;
}

export function buildFinish(
  ctx: SnippetContext,
  result?: { score?: number; max?: number; min?: number },
): Record<string, unknown> {
  const stmt = base(ctx, VERBS.finish, activityObject(ctx));
  const r: Record<string, unknown> = { completion: true };
  if (result?.score !== undefined) {
    const min = result.min ?? 0;
    const max = result.max;
    const score: Record<string, number> = { raw: result.score, min };
    if (max !== undefined && max > min) {
      score.max = max;
      score.scaled = Math.max(-1, Math.min(1, (result.score - min) / (max - min)));
    }
    r.score = score;
  }
  (stmt as Record<string, unknown>).result = r;
  return stmt;
}
