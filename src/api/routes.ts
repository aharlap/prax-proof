// SPDX-License-Identifier: MIT
import { Hono, type Context } from "hono";
import type { Env } from "../env";
import { D1Storage } from "../storage/d1";
import type { AnswerRow, FunnelStep, RosterRow } from "../storage/types";
import { displayLabel, formatDuration, humanizeStep, median } from "../dashboard/format";

const DOCS = "https://github.com/aharlap/prax-proof#api";

type ApiCtx = { Bindings: Env; Variables: { keyId: string } };

export const apiRoutes = new Hono<ApiCtx>();

type ActivitySummaryResponse = NonNullable<Awaited<ReturnType<typeof buildActivitySummary>>>;

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
  if (steps.length === 0) return [];

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

async function buildActivitySummary(storage: D1Storage, iri: string) {
  const activity = await storage.getActivity(iri);
  if (!activity) return null;

  const [stats, started, steps, labels, roster, answers] = await Promise.all([
    storage.getActivityStats(iri),
    storage.startedLearners(iri),
    storage.stepFunnel(iri),
    storage.stepLabels(iri),
    storage.listRoster(iri),
    storage.answers(iri),
  ]);
  const answerMap = responsesByLearner(answers);

  return {
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
  };
}

function mdCell(value: string): string {
  return value.replaceAll("|", "\\|");
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function biggestDropIndex(funnel: ActivitySummaryResponse["funnel"]): number {
  let biggestIdx = -1;
  let biggestDropRate = 0;
  for (let i = 1; i < funnel.length; i++) {
    const previous = funnel[i - 1].learners;
    const drop = previous - funnel[i].learners;
    const rate = previous > 0 && drop > 0 ? drop / previous : 0;
    if (rate > biggestDropRate) {
      biggestDropRate = rate;
      biggestIdx = i;
    }
  }
  return biggestIdx;
}

function statsParagraph(summary: ActivitySummaryResponse): string {
  if (summary.stats.started === 0) return "No learners yet.";

  const clauses = [
    `${summary.stats.started} learners started`,
    `${summary.stats.completions} completed (${pct(summary.stats.completionRate ?? 0)})`,
  ];
  const sentences = [`${clauses.join("; ")}.`];
  if (summary.stats.avgScoreScaled !== null) sentences.push(`Average score ${pct(summary.stats.avgScoreScaled)}.`);
  if (summary.stats.medianDurationSec !== null) {
    sentences.push(`Median time ${formatDuration(summary.stats.medianDurationSec)}.`);
  }
  return sentences.join(" ");
}

function questionBreakdown(summary: ActivitySummaryResponse): string[] {
  const questions = new Map<string, {
    label: string;
    answered: number;
    correct: number;
    knownCorrectness: number;
  }>();

  for (const learner of summary.learners) {
    for (const response of learner.responses) {
      const label = response.label ?? response.question;
      const row = questions.get(label) ?? { label, answered: 0, correct: 0, knownCorrectness: 0 };
      row.answered += 1;
      if (response.correct !== null) {
        row.knownCorrectness += 1;
        if (response.correct) row.correct += 1;
      }
      questions.set(label, row);
    }
  }

  return [...questions.values()].map((row) => {
    if (row.knownCorrectness === 0) return `- ${mdCell(row.label)}: ${row.answered} answered`;
    return `- ${mdCell(row.label)}: ${row.answered} answered, ${pct(row.correct / row.knownCorrectness)} correct`;
  });
}

function renderActivityMarkdown(summary: ActivitySummaryResponse, origin: string, generatedAt: string): string {
  const lines = [
    `# ${summary.activity.name ?? summary.activity.iri}`,
    "",
    statsParagraph(summary),
    "",
  ];
  if (summary.funnel.length > 0) {
    lines.push(
      "## Funnel",
      "| Step | Learners | Retention | Drop-off |",
      "|------|----------|-----------|----------|",
    );
    const biggestIdx = biggestDropIndex(summary.funnel);
    summary.funnel.forEach((row, i) => {
      const retention = row.retention === null ? "—" : pct(row.retention);
      let dropOff = row.dropOff === null || row.dropOff <= 0 ? "—" : `−${row.dropOff}`;
      if (i === biggestIdx) dropOff += " ← biggest drop-off";
      lines.push(`| ${mdCell(row.label)} | ${row.learners} | ${retention} | ${dropOff} |`);
    });
    lines.push("");
  }

  lines.push(
    "## Learners",
    "| Learner | Status | Score | Last seen |",
    "|---------|--------|-------|-----------|",
  );
  for (const learner of summary.learners) {
    const status = learner.completed ? "Completed" : "In progress";
    const score = learner.score ? `${learner.score.raw} / ${learner.score.max ?? "—"}` : "—";
    lines.push(`| ${mdCell(learner.label)} | ${status} | ${score} | ${learner.lastSeen.slice(0, 10)} |`);
  }

  const questions = questionBreakdown(summary);
  if (questions.length > 0) {
    lines.push("", "## Question breakdown", ...questions);
  }

  lines.push("", `*Generated by Proof (${origin}) at ${generatedAt}*`, "");
  return lines.join("\n");
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
  const summary = await buildActivitySummary(storage, iri);
  if (!summary) return c.json({ error: "Activity not found.", docs: DOCS }, 404);

  return c.json(summary);
});

apiRoutes.get("/activity.md", async (c) => {
  const iri = resolveIri(c);
  if (!iri) return c.json({ error: "Missing iri or slug parameter.", docs: DOCS }, 400);

  const storage = new D1Storage(c.env.DB);
  const summary = await buildActivitySummary(storage, iri);
  if (!summary) return c.json({ error: "Activity not found.", docs: DOCS }, 404);

  return c.body(renderActivityMarkdown(summary, new URL(c.req.url).origin, new Date().toISOString()), 200, {
    "Content-Type": "text/markdown; charset=utf-8",
  });
});
