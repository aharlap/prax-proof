// SPDX-License-Identifier: MIT
import { Hono } from "hono";
import type { Env } from "../env";
import { D1Storage } from "../storage/d1";
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
  const [stats, roster, perDay] = await Promise.all([
    s.getActivityStats(iri),
    s.listRoster(iri),
    s.attemptsPerDay(iri, 30),
  ]);
  const maxDay = Math.max(1, ...perDay.map((d) => d.count));
  const avgPct = stats.avgScoreScaled === null ? "—" : `${Math.round(stats.avgScoreScaled * 100)}%`;
  return c.html(
    <Layout title={activity.name ?? activity.iri}>
      <h1>{activity.name ?? activity.iri}</h1>
      <p><a href="/dashboard">← All activities</a></p>
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
              <div class="fill" style={`width:${Math.round((d.count / maxDay) * 100)}%`}></div>
              <span>{String(d.count)}</span>
            </div>
          ))}
        </div>
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
                <td>{r.label}</td>
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
