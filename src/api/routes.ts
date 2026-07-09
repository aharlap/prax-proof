// SPDX-License-Identifier: MIT
import { Hono, type Context } from "hono";
import type { Env } from "../env";
import { D1Storage } from "../storage/d1";
import type { AnswerRow, FunnelStep, RosterRow } from "../storage/types";
import { displayLabel, humanizeStep, median } from "../dashboard/format";

const DOCS = "https://github.com/aharlap/prax-proof#api";

type ApiCtx = { Bindings: Env; Variables: { keyId: string } };

export const apiRoutes = new Hono<ApiCtx>();

function resolveIri(c: Context<ApiCtx>): string | null {
  const iri = c.req.query("iri");
  const slug = c.req.query("slug");
  if (iri) return iri;
  if (slug) return `${new URL(c.req.url).origin}/a/${encodeURIComponent(slug)}`;
  return null;
}

function funnelRows(
  started: number,
  completions: number,
  steps: FunnelStep[],
  labels: Record<string, string>,
) {
  const retention = (learners: number) => (started > 0 ? learners / started : null);
  const rows: {
    step: string;
    label: string;
    learners: number;
    retention: number | null;
    dropOff: number | null;
  }[] = [{
    step: "__started__",
    label: "Started",
    learners: started,
    retention: started > 0 ? 1 : null,
    dropOff: null,
  }];

  for (const row of steps) {
    const previous = rows[rows.length - 1];
    rows.push({
      step: row.step,
      label: labels[row.step] ?? humanizeStep(row.step),
      learners: row.learners,
      retention: retention(row.learners),
      dropOff: previous.learners - row.learners,
    });
  }

  const previous = rows[rows.length - 1];
  rows.push({
    step: "__finished__",
    label: "Finished",
    learners: completions,
    retention: retention(completions),
    dropOff: previous.learners - completions,
  });
  return rows;
}

function responsesByLearner(answers: AnswerRow[]): Map<string, {
  question: string;
  label: string | null;
  response: string | null;
  correct: boolean | null;
}[]> {
  const byLearner = new Map<string, {
    question: string;
    label: string | null;
    response: string | null;
    correct: boolean | null;
  }[]>();
  for (const answer of answers) {
    const rows = byLearner.get(answer.learnerId) ?? [];
    rows.push({
      question: answer.questionId,
      label: answer.questionLabel,
      response: answer.response,
      correct: answer.success === null ? null : answer.success === 1,
    });
    byLearner.set(answer.learnerId, rows);
  }
  return byLearner;
}

function learnerRow(row: RosterRow, answers: ReturnType<typeof responsesByLearner>) {
  const label = displayLabel(row.label);
  return {
    id: row.learnerId,
    label,
    anonymous: label !== row.label,
    completed: row.completed,
    score: row.scoreRaw !== null ? { raw: row.scoreRaw, max: row.scoreMax } : null,
    lastSeen: row.lastSeen,
    responses: answers.get(row.learnerId) ?? [],
  };
}

apiRoutes.get("/activities", async (c) => {
  const activities = await new D1Storage(c.env.DB).listActivities();
  return c.json(activities.map((activity) => ({
    iri: activity.iri,
    name: activity.name,
    pageUrl: activity.pageUrl,
    attempts: activity.attempts,
    completions: activity.completions,
    lastActivity: activity.lastActivity,
  })));
});

apiRoutes.get("/activity", async (c) => {
  const iri = resolveIri(c);
  if (!iri) return c.json({ error: "Missing iri or slug parameter.", docs: DOCS }, 400);

  const storage = new D1Storage(c.env.DB);
  const activity = await storage.getActivity(iri);
  if (!activity) return c.json({ error: "Activity not found.", docs: DOCS }, 404);

  const [stats, started, steps, labels, roster, answers] = await Promise.all([
    storage.getActivityStats(iri),
    storage.startedLearners(iri),
    storage.stepFunnel(iri),
    storage.stepLabels(iri),
    storage.listRoster(iri),
    storage.answers(iri),
  ]);
  const answerMap = responsesByLearner(answers);

  return c.json({
    activity: {
      iri: activity.iri,
      name: activity.name,
      pageUrl: activity.pageUrl,
      firstSeen: activity.firstSeen,
    },
    stats: {
      started,
      attempts: stats.attempts,
      completions: stats.completions,
      completionRate: started > 0 ? stats.completions / started : null,
      avgScoreScaled: stats.avgScoreScaled,
      medianDurationSec: median(stats.durationsSec),
    },
    funnel: funnelRows(started, stats.completions, steps, labels),
    learners: roster.map((row) => learnerRow(row, answerMap)),
  });
});
