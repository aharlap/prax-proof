// SPDX-License-Identifier: MIT
import { Hono } from "hono";
import { mintKey } from "../auth";
import type { Env } from "../env";
import { D1Storage } from "../storage/d1";
import type { DayCount, FunnelStep, TimelineRow } from "../storage/types";
import { toCsv } from "./csv";
import { Layout, StatCard } from "./ui";

type Ctx = { Bindings: Env };
type KeyKind = "ingest" | "read";

export const dashboardRoutes = new Hono<Ctx>();

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function formatDuration(sec: number | null): string {
  if (sec === null) return "—";
  if (sec < 30) return "<1 min";
  return `${Math.max(1, Math.round(sec / 60))} min`;
}

function parseKeyKind(raw: unknown): KeyKind | null {
  if (raw === undefined) return "ingest";
  return raw === "ingest" || raw === "read" ? raw : null;
}

export function humanizeStep(id: string): string {
  const label = id.replace(/[-_:]+/g, " ").trim();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : id;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_UUID_RE = /\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function anonymousLabel(uuid: string): string {
  return `Anonymous · ${uuid.slice(0, 4)}`;
}

export function displayLabel(label: string): string {
  if (UUID_RE.test(label)) return anonymousLabel(label);
  const match = ACCOUNT_UUID_RE.exec(label);
  return match ? anonymousLabel(match[1]) : label;
}

function last14Days(perDay: DayCount[], now = new Date()): DayCount[] {
  const counts = new Map(perDay.map((d) => [d.day, d.count]));
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: 14 }, (_, i) => {
    const day = new Date(end - (13 - i) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return { day, count: counts.get(day) ?? 0 };
  });
}

const VERB_LABELS: Record<string, string> = {
  "http://adlnet.gov/expapi/verbs/initialized": "Started",
  "http://adlnet.gov/expapi/verbs/progressed": "Progressed",
  "http://adlnet.gov/expapi/verbs/answered": "Answered",
  "http://adlnet.gov/expapi/verbs/passed": "Passed",
  "http://adlnet.gov/expapi/verbs/failed": "Failed",
  "http://adlnet.gov/expapi/verbs/completed": "Completed",
  "http://adlnet.gov/expapi/verbs/scored": "Scored",
  "http://adlnet.gov/expapi/verbs/experienced": "Viewed",
};
const verbLabel = (iri: string) => VERB_LABELS[iri] ?? iri.split("/").pop() ?? iri;

const Q_IRI_RE = /\/q\/([^/]+)$/;
function timelineDetail(row: TimelineRow): string {
  if (row.step) return row.step;
  const m = row.activityIri ? Q_IRI_RE.exec(row.activityIri) : null;
  if (m) {
    try { return decodeURIComponent(m[1]); } catch { return m[1]; }
  }
  return "—";
}

function timelineResult(row: TimelineRow): string {
  const parts: string[] = [];
  if (row.response) parts.push(row.response);
  if (row.success === 1) parts.push("✓ correct");
  if (row.success === 0) parts.push("✗ incorrect");
  if (row.scoreRaw !== null) parts.push(`${row.scoreRaw} / ${row.scoreMax ?? "?"}`);
  if (row.durationSec !== null) parts.push(formatDuration(row.durationSec));
  return parts.length ? parts.join(" · ") : "—";
}

function FunnelSection(props: {
  started: number;
  finished: number;
  steps: FunnelStep[];
  labels: Record<string, string>;
}) {
  const rows = [
    { label: "Started", learners: props.started, raw: null },
    ...props.steps.map((s) => ({ label: props.labels[s.step] ?? humanizeStep(s.step), learners: s.learners, raw: s.step })),
    { label: "Finished", learners: props.finished, raw: null },
  ];
  const startedRow = rows[0].learners;
  let biggestIdx = -1;
  let biggestDropRate = 0;
  for (let i = 1; i < rows.length; i++) {
    const previous = rows[i - 1].learners;
    const drop = previous - rows[i].learners;
    const rate = previous > 0 && drop > 0 ? drop / previous : 0;
    if (rate > biggestDropRate) {
      biggestDropRate = rate;
      biggestIdx = i;
    }
  }
  return (
    <>
      <h2>Drop-off funnel</h2>
      <table>
        <caption>Learner progress through the activity, step by step</caption>
        <thead>
          <tr>
            <th scope="col">Step</th>
            <th scope="col">Learners</th>
            <th scope="col">Retention</th>
            <th scope="col">Drop-off</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const width = startedRow > 0 ? Math.round((r.learners / startedRow) * 100) : 0;
            const retention = startedRow > 0 ? `${width}%` : "—";
            const lost = i === 0 ? 0 : rows[i - 1].learners - r.learners;
            const drop = i > 0 && lost > 0 && rows[i - 1].learners > 0
              ? `−${lost} (${Math.round((lost / rows[i - 1].learners) * 100)}%)`
              : "—";
            return (
              <tr class={i === biggestIdx ? "prax-drop-row" : ""}>
                <td title={r.raw ?? undefined}>{r.label}</td>
                <td>
                  <div class="prax-track" aria-hidden="true">
                    <div class="prax-track-fill" style={`width:${width}%`}></div>
                  </div>
                  <span>{String(r.learners)}</span>
                </td>
                <td>{retention}</td>
                <td>
                  {drop}
                  {i === biggestIdx ? <strong> ▼ biggest drop-off</strong> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p class="prax-soft">Started = learners who began the activity. A drop-off counts learners who reached a step but none after it. Learners can skip steps, so a later row can exceed an earlier one.</p>
    </>
  );
}

dashboardRoutes.get("/", async (c) => {
  const s = new D1Storage(c.env.DB);
  const [activities, keys] = await Promise.all([s.listActivities(), s.listKeys()]);
  return c.html(
    <Layout title="Activities">
      <h1>Activities</h1>
      {activities.length === 0 ? (
        <ActivitiesEmptyState hasKeys={keys.length > 0} />
      ) : (
        <table>
          <caption>All tracked activities, most recent first</caption>
          <thead>
            <tr>
              <th scope="col">Activity</th>
              <th scope="col">Attempts</th>
              <th scope="col">Completions</th>
              <th scope="col">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {activities.map((a) => (
              <tr>
                <td>
                  <a href={`/dashboard/activity?iri=${encodeURIComponent(a.iri)}`}>
                    {a.name ?? a.iri}
                  </a>
                </td>
                <td>{String(a.attempts)}</td>
                <td>{String(a.completions)}</td>
                <td>{a.lastActivity ? a.lastActivity.slice(0, 10) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>,
  );
});

export function ActivitiesEmptyState(props: { hasKeys: boolean }) {
  return props.hasKeys ? (
    <p class="prax-empty">
      Waiting for your first statement. Embed the snippet on a page (see the <a href="https://github.com/aharlap/prax-proof/blob/main/docs/embed.md">embed guide</a>) or use the AI prompt from your <a href="/dashboard/keys">key page</a>.
    </p>
  ) : (
    <p class="prax-empty">
      No activity yet. Start by creating an ingest key on the <a href="/dashboard/keys">Keys page</a>.
    </p>
  );
}

dashboardRoutes.get("/activity", async (c) => {
  const iri = c.req.query("iri");
  if (!iri) return c.text("Missing iri parameter", 400);
  const s = new D1Storage(c.env.DB);
  const activity = await s.getActivity(iri);
  if (!activity) {
    return c.html(
      <Layout title="Not found">
        <h1>Activity not found</h1>
        <p><a href="/dashboard">Back to activities</a></p>
      </Layout>,
      404,
    );
  }
  const [stats, roster, perDay, funnel, started, stepLabels] = await Promise.all([
    s.getActivityStats(iri),
    s.listRoster(iri),
    s.attemptsPerDay(iri, 30),
    s.stepFunnel(iri),
    s.startedLearners(iri),
    s.stepLabels(iri),
  ]);
  const renderedDays = last14Days(perDay);
  const maxDay = Math.max(1, ...renderedDays.map((d) => d.count));
  const hasRenderedAttempts = renderedDays.some((d) => d.count > 0);
  const completionPct = started > 0 ? `${Math.round((stats.completions / started) * 100)}%` : "—";
  const completionSub = started > 0 ? `${stats.completions} of ${started} learners` : "No learners yet";
  const avgPct = stats.avgScoreScaled === null ? "—" : `${Math.round(stats.avgScoreScaled * 100)}%`;
  const avgLabel = stats.avgScoreScaled === null ? "Not scored" : "Avg score";
  const medianTime = median(stats.durationsSec);
  return c.html(
    <Layout title={activity.name ?? activity.iri}>
      <h1>{activity.name ?? activity.iri}</h1>
      <p>
        <a href="/dashboard">← All activities</a>
        {" · "}
        <a href={`/dashboard/activity.csv?iri=${encodeURIComponent(iri)}`}>Download CSV</a>
        {" · "}
        <a href={`/dashboard/activity.json?iri=${encodeURIComponent(iri)}`}>Download JSON</a>
        {activity.pageUrl ? (
          <>
            {" · "}
            <a href={activity.pageUrl} rel="noopener">View live page ↗</a>
          </>
        ) : null}
      </p>
      <div class="prax-stats">
        <StatCard label="Completion rate" value={completionPct} sub={completionSub} hero />
        <StatCard label="Attempts" value={String(stats.attempts)} />
        <StatCard label={avgLabel} value={avgPct} />
        <StatCard label={medianTime === null ? "No timing data" : "Median time"} value={formatDuration(medianTime)} />
      </div>

      <h2>Attempts — last 14 days</h2>
      {!hasRenderedAttempts ? (
        <p class="prax-empty">No attempts in the last 14 days.</p>
      ) : (
        <div class="prax-bars">
          {renderedDays.map((d) => (
            <div class="prax-bar">
              <span>{d.day.slice(5)}</span>
              <div class="fill" aria-hidden="true" style={`width:${Math.round((d.count / maxDay) * 100)}%`}></div>
              <span>{String(d.count)}</span>
            </div>
          ))}
        </div>
      )}

      {funnel.length > 0 ? (
        <FunnelSection started={started} finished={stats.completions} steps={funnel} labels={stepLabels} />
      ) : (
        <>
          <h2>Drop-off funnel</h2>
          <p class="prax-empty">No step data yet — call proof.step(...) or send progressed statements.</p>
        </>
      )}

      <h2>Learners</h2>
      {roster.length === 0 ? (
        <p class="prax-empty">No learners yet.</p>
      ) : (
        <table>
          <caption>One row per learner, most recently active first</caption>
          <thead>
            <tr>
              <th scope="col">Learner</th>
              <th scope="col">Status</th>
              <th scope="col">Score</th>
              <th scope="col">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((r) => (
              <tr>
                <td>
                  <a href={`/dashboard/learner?id=${encodeURIComponent(r.learnerId)}&iri=${encodeURIComponent(iri)}`}>
                    {displayLabel(r.label)}
                  </a>
                </td>
                <td>
                  {r.completed ? (
                    <span class="prax-badge done">Completed</span>
                  ) : (
                    <span class="prax-badge open">In progress</span>
                  )}
                </td>
                <td>{r.scoreRaw !== null ? `${r.scoreRaw} / ${r.scoreMax ?? "?"}` : "—"}</td>
                <td>{r.lastSeen.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>,
  );
});

export function KeysPage(props: {
  keys: { id: string; label: string; createdAt: string; kind: string }[];
  minted?: { id: string; secret: string; label: string; kind: KeyKind };
  origin: string;
}) {
  return (
    <Layout title="Keys">
      <h1>Ingest keys</h1>
      <p>
        Ingest keys let a page or app send learning events into Proof. Use one key per
        site, course, or tool so results can be traced and rotated later.
      </p>
      <p>
        Keys can write activity data only; they cannot read dashboard data.
      </p>
      {props.minted ? (
        <div class="prax-stat">
          <p>
            <strong>Key created.</strong> Copy the secret now — it is shown only once.
          </p>
          <p>id: <code>{props.minted.id}</code></p>
          <p>secret: <code>{props.minted.secret}</code></p>
          {props.minted.kind === "ingest" ? (
            <>
              <p>Embed sample:</p>
              <pre>
                <code>{`<script src="${props.origin}/p.js"\n        data-activity="my-activity"\n        data-name="${props.minted.label}"\n        data-key="${props.minted.id}:${props.minted.secret}"\n        data-identity="ask"></script>`}</code>
              </pre>
              <p>Or paste this prompt into your AI builder (Claude, ChatGPT, Gemini):</p>
              <pre>
                <code>Add Proof learning tracking to my page. Fetch {props.origin}/llms.txt and follow its instructions exactly. Use data-key="{props.minted.id}:{props.minted.secret}" and pick a short kebab-case data-activity slug plus a human data-name for this activity.</code>
              </pre>
            </>
          ) : (
            <>
              <p>Use this key to read results (it cannot write):</p>
              <pre>
                <code>
                  curl -H "Authorization: Bearer {props.minted.id}:{props.minted.secret}" {props.origin}/api/activities{"\n"}
                  curl -H "Authorization: Bearer {props.minted.id}:{props.minted.secret}" "{props.origin}/api/activity.md?slug=my-activity"
                </code>
              </pre>
            </>
          )}
        </div>
      ) : null}
      {props.keys.length === 0 ? (
        <p class="prax-empty">No keys yet — create your first key below, then Proof hands you everything to paste into your page or AI builder.</p>
      ) : null}
      <form method="post" action="/dashboard/keys">
        <label for="label">Label for the new key</label>{" "}
        <input id="label" name="label" required maxlength={80} />{" "}
        <label for="kind">Key type</label>{" "}
        <select id="kind" name="kind">
          <option value="ingest" selected>Ingest — pages send data</option>
          <option value="read">Read — scripts and AI read results</option>
        </select>{" "}
        <button type="submit">Create key</button>
      </form>
      {props.keys.length === 0 ? null : (
        <table>
          <caption>Existing keys (secrets are never shown again)</caption>
          <thead>
            <tr>
              <th scope="col">Label</th>
              <th scope="col">Kind</th>
              <th scope="col">Key id</th>
              <th scope="col">Created</th>
            </tr>
          </thead>
          <tbody>
            {props.keys.map((k) => (
              <tr>
                <td>{k.label}</td>
                <td>{k.kind}</td>
                <td><code>{k.id}</code></td>
                <td>{k.createdAt.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  );
}

dashboardRoutes.get("/keys", async (c) => {
  const keys = await new D1Storage(c.env.DB).listKeys();
  return c.html(<KeysPage keys={keys} origin={new URL(c.req.url).origin} />);
});

dashboardRoutes.post("/keys", async (c) => {
  const origin = new URL(c.req.url).origin;
  const reqOrigin = c.req.header("Origin");
  if (reqOrigin && reqOrigin !== origin) return c.text("Cross-origin form submission rejected", 403);
  const form = await c.req.parseBody();
  const label = typeof form.label === "string" ? form.label.trim() : "";
  if (!label) return c.text("A non-empty label is required", 400);
  const kind = parseKeyKind(form.kind);
  if (!kind) return c.text('Key kind must be "ingest" or "read"', 400);
  const s = new D1Storage(c.env.DB);
  const { id, secret } = await mintKey(c.env.DB, label, kind);
  const keys = await s.listKeys();
  return c.html(<KeysPage keys={keys} minted={{ id, secret, label, kind }} origin={origin} />);
});

dashboardRoutes.get("/activity.csv", async (c) => {
  const iri = c.req.query("iri");
  if (!iri) return c.text("Missing iri parameter", 400);
  const roster = await new D1Storage(c.env.DB).listRoster(iri);
  const rows: (string | number | null)[][] = [
    ["label", "status", "score_raw", "score_max", "last_seen"],
    ...roster.map((r) => [r.label, r.completed ? "completed" : "in-progress", r.scoreRaw, r.scoreMax, r.lastSeen]),
  ];
  return c.body(toCsv(rows), 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="proof-roster.csv"',
  });
});

dashboardRoutes.get("/activity.json", async (c) => {
  const iri = c.req.query("iri");
  if (!iri) return c.text("Missing iri parameter", 400);
  const raws = await new D1Storage(c.env.DB).rawStatements(iri);
  return c.body(`[${raws.join(",")}]`, 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": 'attachment; filename="proof-statements.json"',
  });
});

dashboardRoutes.get("/learner", async (c) => {
  const id = c.req.query("id");
  const iri = c.req.query("iri");
  if (!id || !iri) return c.text("Missing id or iri parameter", 400);
  const s = new D1Storage(c.env.DB);
  const learner = await s.getLearner(id);
  if (!learner) {
    return c.html(
      <Layout title="Not found">
        <h1>Learner not found</h1>
        <p><a href="/dashboard">Back to activities</a></p>
      </Layout>,
      404,
    );
  }
  const [activity, timeline] = await Promise.all([s.getActivity(iri), s.learnerTimeline(iri, id)]);
  const learnerLabel = displayLabel(learner.label);
  return c.html(
    <Layout title={learnerLabel}>
      <h1>{learnerLabel}</h1>
      <p class="prax-soft">{learner.identity}</p>
      <p>
        <a href={`/dashboard/activity?iri=${encodeURIComponent(iri)}`}>
          ← {activity?.name ?? iri}
        </a>
      </p>
      {timeline.length === 0 ? (
        <p class="prax-empty">No statements for this learner on this activity.</p>
      ) : (
        <table>
          <caption>Attempt timeline, oldest first</caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">What</th>
              <th scope="col">Detail</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {timeline.map((row) => (
              <tr>
                <td>{row.timestamp.slice(0, 16).replace("T", " ")}</td>
                <td>{verbLabel(row.verb)}</td>
                <td>{timelineDetail(row)}</td>
                <td>{timelineResult(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>,
  );
});
