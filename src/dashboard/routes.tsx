// SPDX-License-Identifier: MIT
import { Hono } from "hono";
import { mintKey } from "../auth";
import type { Env } from "../env";
import { D1Storage } from "../storage/d1";
import type { FunnelStep, TimelineRow } from "../storage/types";
import { toCsv } from "./csv";
import { Layout, StatCard } from "./ui";

type Ctx = { Bindings: Env };

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
}) {
  const rows = [
    { label: "Started", learners: props.started },
    ...props.steps.map((s) => ({ label: s.step, learners: s.learners })),
    { label: "Finished", learners: props.finished },
  ];
  const max = Math.max(1, ...rows.map((r) => r.learners));
  let biggestIdx = -1;
  let biggestDrop = 0;
  for (let i = 1; i < rows.length; i++) {
    const drop = rows[i - 1].learners - rows[i].learners;
    if (drop > biggestDrop) {
      biggestDrop = drop;
      biggestIdx = i;
    }
  }
  return (
    <>
      <h2>Drop-off funnel</h2>
      <div class="prax-bars">
        {rows.map((r, i) => (
          <div class="prax-bar">
            <span>{r.label}</span>
            <div class="fill" aria-hidden="true" style={`width:${Math.round((r.learners / max) * 100)}%`}></div>
            <span>
              {String(r.learners)} {i === biggestIdx ? "▼ biggest drop-off" : ""}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

dashboardRoutes.get("/", async (c) => {
  const activities = await new D1Storage(c.env.DB).listActivities();
  return c.html(
    <Layout title="Activities">
      <h1>Activities</h1>
      {activities.length === 0 ? (
        <p class="prax-empty">No activities yet. Send a statement and it appears here.</p>
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
  const [stats, roster, perDay, funnel, started] = await Promise.all([
    s.getActivityStats(iri),
    s.listRoster(iri),
    s.attemptsPerDay(iri, 30),
    s.stepFunnel(iri),
    s.startedLearners(iri),
  ]);
  const maxDay = Math.max(1, ...perDay.map((d) => d.count));
  const avgPct = stats.avgScoreScaled === null ? "—" : `${Math.round(stats.avgScoreScaled * 100)}%`;
  return c.html(
    <Layout title={activity.name ?? activity.iri}>
      <h1>{activity.name ?? activity.iri}</h1>
      <p>
        <a href="/dashboard">← All activities</a>
        {" · "}
        <a href={`/dashboard/activity.csv?iri=${encodeURIComponent(iri)}`}>Download CSV</a>
        {" · "}
        <a href={`/dashboard/activity.json?iri=${encodeURIComponent(iri)}`}>Download JSON</a>
      </p>
      <div class="prax-stats">
        <StatCard label="Attempts" value={String(stats.attempts)} />
        <StatCard label="Completed" value={String(stats.completions)} />
        <StatCard label="Avg score" value={avgPct} />
        <StatCard label="Median time" value={formatDuration(median(stats.durationsSec))} />
      </div>

      <h2>Attempts — last 30 days</h2>
      {perDay.length === 0 ? (
        <p class="prax-empty">No attempts in the last 30 days.</p>
      ) : (
        <div class="prax-bars">
          {perDay.map((d) => (
            <div class="prax-bar">
              <span>{d.day.slice(5)}</span>
              <div class="fill" aria-hidden="true" style={`width:${Math.round((d.count / maxDay) * 100)}%`}></div>
              <span>{String(d.count)}</span>
            </div>
          ))}
        </div>
      )}

      {funnel.length > 0 ? (
        <FunnelSection started={started} finished={stats.completions} steps={funnel} />
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
                    {r.label}
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

function KeysPage(props: {
  keys: { id: string; label: string; createdAt: string }[];
  minted?: { id: string; secret: string; label: string };
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
          <p>Embed sample:</p>
          <pre>
            <code>{`<script src="${props.origin}/p.js"\n        data-activity="my-activity"\n        data-key="${props.minted.id}:${props.minted.secret}"\n        data-identity="ask"></script>`}</code>
          </pre>
        </div>
      ) : null}
      <form method="post" action="/dashboard/keys">
        <label for="label">Label for the new key</label>{" "}
        <input id="label" name="label" required maxlength={80} />{" "}
        <button type="submit">Create key</button>
      </form>
      {props.keys.length === 0 ? (
        <p class="prax-empty">No keys yet.</p>
      ) : (
        <table>
          <caption>Existing keys (secrets are never shown again)</caption>
          <thead>
            <tr>
              <th scope="col">Label</th>
              <th scope="col">Key id</th>
              <th scope="col">Created</th>
            </tr>
          </thead>
          <tbody>
            {props.keys.map((k) => (
              <tr>
                <td>{k.label}</td>
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
  const s = new D1Storage(c.env.DB);
  const { id, secret } = await mintKey(c.env.DB, label);
  const keys = await s.listKeys();
  return c.html(<KeysPage keys={keys} minted={{ id, secret, label }} origin={origin} />);
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
  return c.html(
    <Layout title={learner.label}>
      <h1>{learner.label}</h1>
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
