// SPDX-License-Identifier: MIT
import { Hono } from "hono";
import { mintKey } from "../auth";
import type { Env } from "../env";
import { D1Storage } from "../storage/d1";
import type { DayCount, FunnelStep, TimelineRow } from "../storage/types";
import { toCsv } from "./csv";
import { displayLabel, formatDuration, humanizeStep, median } from "./format";
import { Layout, StatCard } from "./ui";
import { buildFunnelRows } from "../reporting/funnel";
import { runRetention } from "../retention";

type Ctx = { Bindings: Env };
type KeyKind = "ingest" | "read";

export const dashboardRoutes = new Hono<Ctx>();
export { displayLabel, formatDuration, humanizeStep, median } from "./format";

function parseKeyKind(raw: unknown): KeyKind | null {
  if (raw === undefined) return "ingest";
  return raw === "ingest" || raw === "read" ? raw : null;
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
  participants: number;
  completions: number;
  participantDropOff: number;
  steps: FunnelStep[];
  labels: Record<string, string>;
}) {
  const rows = buildFunnelRows(
    props.participants,
    props.completions,
    props.participantDropOff,
    props.steps,
    props.labels,
    humanizeStep,
  );
  const participants = props.participants;
  let biggestIdx = -1;
  let biggestDropRate = 0;
  for (let i = 0; i < rows.length; i++) {
    const rate = rows[i].learners > 0 ? rows[i].dropOff / rows[i].learners : 0;
    if (rate > biggestDropRate) {
      biggestDropRate = rate;
      biggestIdx = i;
    }
  }
  return (
    <>
      <h2>Drop-off funnel</h2>
      <div class="prax-table-wrap">
        <table>
          <caption>Learner progress through the activity, step by step</caption>
          <thead>
            <tr>
              <th scope="col">Step</th>
              <th scope="col">Learners</th>
              <th scope="col">Retention</th>
              <th scope="col">Drop after this step</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const width = participants > 0 ? Math.round((r.learners / participants) * 100) : 0;
              const retention = participants > 0 ? `${width}%` : "—";
              const drop = r.dropOff > 0 && r.learners > 0
                ? `−${r.dropOff} (${Math.round((r.dropOff / r.learners) * 100)}%)`
                : "—";
              return (
                <tr class={i === biggestIdx ? "prax-drop-row" : ""}>
                  <td title={r.step.startsWith("__") ? undefined : r.step}>{r.label}</td>
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
      </div>
      <p class="prax-soft">Participants are distinct learner records with any event for this activity. Drop-off counts participants who reached a row but no later row. Learners can skip steps, so a later row can exceed an earlier one.</p>
    </>
  );
}

dashboardRoutes.get("/", async (c) => {
  const s = new D1Storage(c.env.DB);
  const page = Math.max(1, Math.floor(Number(c.req.query("page")) || 1));
  const pageSize = 100;
  const [activities, keys] = await Promise.all([
    s.listActivities(pageSize, (page - 1) * pageSize),
    s.listKeys(),
  ]);
  return c.html(
    <Layout title="Activities">
      <h1>Activities</h1>
      {activities.length === 0 ? (
        <ActivitiesEmptyState hasKeys={keys.length > 0} />
      ) : (
        <div class="prax-table-wrap">
          <table>
            <caption>All tracked activities, most recent first</caption>
            <thead>
              <tr>
                <th scope="col">Activity</th>
                <th scope="col">Recorded starts</th>
                <th scope="col">Participants</th>
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
                  <td>{String(a.starts)}</td>
                  <td>{String(a.participants)}</td>
                  <td>{String(a.completions)}</td>
                  <td>{a.lastActivity ? a.lastActivity.slice(0, 10) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page > 1 ? <a href={`/dashboard?page=${page - 1}`}>Previous page</a> : null}
      {page > 1 && activities.length === pageSize ? " · " : null}
      {activities.length === pageSize ? <a href={`/dashboard?page=${page + 1}`}>Next page</a> : null}
    </Layout>,
  );
});

export function ActivitiesEmptyState(props: { hasKeys: boolean }) {
  return props.hasKeys ? (
    <p class="prax-empty">
      Waiting for your first statement. Embed the snippet on a page (see the <a href="https://github.com/Praxity/prax-proof/blob/main/docs/embed.md">embed guide</a>) or use the AI prompt from your <a href="/dashboard/keys">key page</a>.
    </p>
  ) : (
    <p class="prax-empty">
      No activity yet. Start by creating an ingest key on the <a href="/dashboard/keys">Keys page</a>.
    </p>
  );
}

function SettingsPage(props: {
  settings: Awaited<ReturnType<D1Storage["getSettings"]>>;
  message?: string;
}) {
  return (
    <Layout title="Settings">
      <h1>Privacy and retention settings</h1>
      {props.message ? <p class="prax-stat">{props.message}</p> : null}
      <form class="prax-form" method="post" action="/dashboard/settings">
        <label for="operatorName">Operator name</label>
        <input id="operatorName" name="operatorName" maxlength={120} value={props.settings.operatorName} />
        <label for="privacyUrl">Full privacy policy URL</label>
        <input id="privacyUrl" name="privacyUrl" type="url" maxlength={2048} value={props.settings.privacyUrl} />
        <label for="privacyContact">Privacy contact</label>
        <input id="privacyContact" name="privacyContact" maxlength={200} value={props.settings.privacyContact} />
        <label for="regionLabel">Hosting region description</label>
        <input id="regionLabel" name="regionLabel" maxlength={120} value={props.settings.regionLabel} />
        <label for="retentionDays">Retention in days</label>
        <input id="retentionDays" name="retentionDays" type="number" min="1" max="3650" required value={String(props.settings.retentionDays)} />
        <label for="trackingMode">Tracking basis in embeds</label>
        <select id="trackingMode" name="trackingMode">
          <option value="notice" selected={props.settings.trackingMode === "notice"}>Notice before tracking</option>
          <option value="consent" selected={props.settings.trackingMode === "consent"}>Opt-in before tracking</option>
        </select>
        <div class="prax-form-actions"><button type="submit">Save settings</button></div>
      </form>
      <h2>Retention maintenance</h2>
      <p>Scheduled cleanup removes statements older than the configured period. Run cleanup now after reducing the retention period.</p>
      <form method="post" action="/dashboard/settings/retention">
        <button type="submit">Run retention cleanup</button>
      </form>
      <p class="prax-soft">
        These controls document and enforce parts of your data practice, but do not determine your legal basis or make an activity legally compliant. Review the requirements that apply to your organization and learners.
      </p>
    </Layout>
  );
}

dashboardRoutes.get("/settings", async (c) => {
  const settings = await new D1Storage(c.env.DB).getSettings();
  return c.html(<SettingsPage settings={settings} />);
});

dashboardRoutes.post("/settings", async (c) => {
  const origin = new URL(c.req.url).origin;
  const reqOrigin = c.req.header("Origin");
  if (reqOrigin && reqOrigin !== origin) return c.text("Cross-origin form submission rejected", 403);
  const form = await c.req.parseBody();
  const value = (name: string) => typeof form[name] === "string" ? form[name].trim() : "";
  const retentionDays = Number(value("retentionDays"));
  const trackingMode = value("trackingMode");
  const privacyUrl = value("privacyUrl");
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    return c.text("Retention must be a whole number from 1 to 3650 days", 400);
  }
  if (trackingMode !== "notice" && trackingMode !== "consent") {
    return c.text("Tracking mode must be notice or consent", 400);
  }
  if (privacyUrl) {
    try {
      const url = new URL(privacyUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    } catch {
      return c.text("Privacy policy URL must be an absolute HTTP or HTTPS URL", 400);
    }
  }
  const s = new D1Storage(c.env.DB);
  const settings = await s.updateSettings({
    operatorName: value("operatorName").slice(0, 120),
    privacyUrl,
    privacyContact: value("privacyContact").slice(0, 200),
    regionLabel: value("regionLabel").slice(0, 120),
    retentionDays,
    trackingMode,
  });
  return c.html(<SettingsPage settings={settings} message="Settings saved." />);
});

dashboardRoutes.post("/settings/retention", async (c) => {
  const origin = new URL(c.req.url).origin;
  const reqOrigin = c.req.header("Origin");
  if (reqOrigin && reqOrigin !== origin) return c.text("Cross-origin form submission rejected", 403);
  const s = new D1Storage(c.env.DB);
  const deleted = await runRetention(c.env);
  const settings = await s.getSettings();
  return c.html(<SettingsPage settings={settings} message={`Deleted ${deleted} expired statements.`} />);
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
  const page = Math.max(1, Math.floor(Number(c.req.query("page")) || 1));
  const pageSize = 100;
  const [stats, roster, perDay, funnel, stepLabels, participantDropOff] = await Promise.all([
    s.getActivityStats(iri),
    s.listRoster(iri, pageSize, (page - 1) * pageSize),
    s.startsPerDay(iri, 30),
    s.stepFunnel(iri),
    s.stepLabels(iri),
    s.participantDropOff(iri),
  ]);
  const renderedDays = last14Days(perDay);
  const maxDay = Math.max(1, ...renderedDays.map((d) => d.count));
  const hasRenderedAttempts = renderedDays.some((d) => d.count > 0);
  const completionPct = stats.participants > 0 ? `${Math.round((stats.completions / stats.participants) * 100)}%` : "—";
  const completionSub = stats.participants > 0 ? `${stats.completions} of ${stats.participants} participants` : "No participants yet";
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
        <StatCard label="Participants" value={String(stats.participants)} />
        <StatCard label="Recorded starts" value={String(stats.starts)} />
        <StatCard label={avgLabel} value={avgPct} />
        <StatCard label={medianTime === null ? "No timing data" : "Median time"} value={formatDuration(medianTime)} />
      </div>

      <h2>Recorded starts — last 14 days</h2>
      {!hasRenderedAttempts ? (
        <p class="prax-empty">No recorded starts in the last 14 days.</p>
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
        <FunnelSection
          participants={stats.participants}
          completions={stats.completions}
          participantDropOff={participantDropOff}
          steps={funnel}
          labels={stepLabels}
        />
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
        <div class="prax-table-wrap">
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
        </div>
      )}
      {page > 1 ? <a href={`/dashboard/activity?iri=${encodeURIComponent(iri)}&page=${page - 1}`}>Previous learners</a> : null}
      {page > 1 && (page * pageSize) < stats.participants ? " · " : null}
      {(page * pageSize) < stats.participants ? <a href={`/dashboard/activity?iri=${encodeURIComponent(iri)}&page=${page + 1}`}>Next learners</a> : null}
    </Layout>,
  );
});

export function KeysPage(props: {
  keys: {
    id: string;
    label: string;
    createdAt: string;
    kind: string;
    revokedAt?: string | null;
    activityScope?: string | null;
    allowedOrigin?: string | null;
    lastUsedAt?: string | null;
    identityMode?: string;
    statementCount?: number;
  }[];
  minted?: {
    id: string;
    secret: string;
    label: string;
    kind: KeyKind;
    activitySlug: string;
    identityMode: string;
    trackingMode: string;
  };
  origin: string;
  legacyStatementCount?: number;
}) {
  const legacyStatementCount = props.legacyStatementCount ?? 0;
  return (
    <Layout title="Keys">
      {props.minted ? (
        <div id="minted-key" class="prax-stat">
          <h2>Key created</h2>
          <p>Copy the secret now — it is shown only once.</p>
          <p>id: <code>{props.minted.id}</code></p>
          <p>secret: <code>{props.minted.secret}</code></p>
          {props.minted.kind === "ingest" ? (
            <>
              <p>Embed sample:</p>
              <pre>
                <code>{`<script src="${props.origin}/p.js"\n        data-activity="${props.minted.activitySlug}"\n        data-name="${props.minted.label}"\n        data-key="${props.minted.id}:${props.minted.secret}"\n        data-identity="${props.minted.identityMode === "named" ? "ask" : props.minted.identityMode}"\n        data-tracking="${props.minted.trackingMode}"></script>`}</code>
              </pre>
              <p>Or paste this prompt into your AI builder (Claude, ChatGPT, Gemini):</p>
              <pre>
                <code>Add Proof learning tracking to my page. Fetch {props.origin}/llms.txt and follow its instructions exactly. Use data-key="{props.minted.id}:{props.minted.secret}", data-activity="{props.minted.activitySlug}", and data-name="{props.minted.label}".</code>
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
      <h1>Keys</h1>
      <p>
        Ingest keys let a page or app send learning events into Proof; they cannot read anything back.
        Read keys let scripts and AI tools read results; they cannot write.
      </p>
      <p>Use one key per site, course, or tool so results can be traced and rotated later.</p>
      {legacyStatementCount > 0 ? (
        <p class="prax-stat">
          {String(legacyStatementCount)} legacy {legacyStatementCount === 1 ? "statement predates" : "statements predate"} key attribution and cannot be assigned to a key accurately.
        </p>
      ) : null}
      {props.keys.length === 0 ? (
        <p class="prax-empty">No keys yet — create your first key below, then Proof hands you everything to paste into your page or AI builder.</p>
      ) : null}
      <form class="prax-form" method="post" action="/dashboard/keys">
        <label for="label">Activity title</label>
        <input id="label" name="label" required maxlength={80} />
        <label for="activitySlug">Activity slug</label>
        <input id="activitySlug" name="activitySlug" required maxlength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" />
        <label for="kind">Key type</label>{" "}
        <select id="kind" name="kind">
          <option value="ingest" selected>Ingest — pages send data</option>
          <option value="read">Read — scripts and AI read results</option>
        </select>
        <label for="allowedOrigin">Allowed website origin</label>
        <input id="allowedOrigin" name="allowedOrigin" type="url" maxlength={2048} placeholder="https://learn.example.org" />
        <label for="identityMode">Learner identity</label>
        <select id="identityMode" name="identityMode">
          <option value="anonymous" selected>Anonymous pseudonym</option>
          <option value="named">Ask for a session-only name</option>
          <option value="token">Opaque link token</option>
        </select>
        <label for="dailyLimit">Daily statement limit</label>
        <input id="dailyLimit" name="dailyLimit" type="number" min="1" max="100000" value="10000" required />
        <div class="prax-form-actions"><button type="submit">Create scoped key</button></div>
      </form>
      {props.keys.length === 0 ? null : (
        <div class="prax-table-wrap">
          <table>
            <caption>Existing keys (secrets are never shown again)</caption>
            <thead>
              <tr>
                <th scope="col">Label</th>
                <th scope="col">Kind</th>
                <th scope="col">Scope</th>
                <th scope="col">Usage</th>
                <th scope="col">Status</th>
                <th scope="col">Key id</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {props.keys.map((k) => (
                <tr>
                  <td>{k.label}</td>
                  <td>{k.kind}</td>
                  <td>{k.activityScope ?? "Unrestricted legacy key"}</td>
                  <td>{String(k.statementCount ?? 0)} attributed statements{k.lastUsedAt ? ` · last used ${k.lastUsedAt.slice(0, 10)}` : ""}</td>
                  <td>
                    {k.revokedAt ? `Revoked ${k.revokedAt.slice(0, 10)}` : (
                      <form method="post" action="/dashboard/keys/revoke">
                        <input type="hidden" name="id" value={k.id} />
                        <button type="submit">Revoke</button>
                      </form>
                    )}
                  </td>
                  <td><code>{k.id}</code></td>
                  <td>{k.createdAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}

dashboardRoutes.get("/keys", async (c) => {
  const storage = new D1Storage(c.env.DB);
  const [keys, legacyStatementCount] = await Promise.all([
    storage.listKeys(),
    storage.legacyStatementCount(),
  ]);
  return c.html(<KeysPage
    keys={keys}
    legacyStatementCount={legacyStatementCount}
    origin={new URL(c.req.url).origin}
  />);
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
  const fallbackSlug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  const activitySlug = typeof form.activitySlug === "string" && form.activitySlug.trim()
    ? form.activitySlug.trim()
    : fallbackSlug;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(activitySlug) || activitySlug.length > 80) {
    return c.text("Activity slug must be lowercase kebab-case", 400);
  }
  const allowedOrigin = typeof form.allowedOrigin === "string" ? form.allowedOrigin.trim() : "";
  if (allowedOrigin) {
    try {
      const parsed = new URL(allowedOrigin);
      if (parsed.origin !== allowedOrigin) throw new Error();
    } catch {
      return c.text("Allowed website origin must contain only scheme and host", 400);
    }
  }
  const identityMode = form.identityMode === "named" || form.identityMode === "token"
    ? form.identityMode
    : "anonymous";
  const dailyLimit = form.dailyLimit === undefined ? 10000 : Number(form.dailyLimit);
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 100000) {
    return c.text("Daily statement limit must be a whole number from 1 to 100000", 400);
  }
  const s = new D1Storage(c.env.DB);
  const activityScope = `${origin}/a/${encodeURIComponent(activitySlug)}`;
  const { id, secret } = await mintKey(c.env.DB, label, kind, {
    activityScope,
    allowedOrigin: allowedOrigin || null,
    dailyLimit,
    identityMode,
  });
  const [keys, settings, legacyStatementCount] = await Promise.all([
    s.listKeys(),
    s.getSettings(),
    s.legacyStatementCount(),
  ]);
  return c.html(<KeysPage
    keys={keys}
    legacyStatementCount={legacyStatementCount}
    minted={{ id, secret, label, kind, activitySlug, identityMode, trackingMode: settings.trackingMode }}
    origin={origin}
  />);
});

dashboardRoutes.post("/keys/revoke", async (c) => {
  const origin = new URL(c.req.url).origin;
  const reqOrigin = c.req.header("Origin");
  if (reqOrigin && reqOrigin !== origin) return c.text("Cross-origin form submission rejected", 403);
  const form = await c.req.parseBody();
  const id = typeof form.id === "string" ? form.id : "";
  if (!id) return c.text("Missing key id", 400);
  const revoked = await new D1Storage(c.env.DB).revokeKey(id);
  if (!revoked) return c.text("Active key not found", 404);
  return c.redirect("/dashboard/keys", 303);
});

dashboardRoutes.get("/activity.csv", async (c) => {
  const iri = c.req.query("iri");
  if (!iri) return c.text("Missing iri parameter", 400);
  const page = Math.max(1, Math.floor(Number(c.req.query("page")) || 1));
  const roster = await new D1Storage(c.env.DB).listRoster(iri, 500, (page - 1) * 500);
  const rows: (string | number | null)[][] = [
    ["label", "status", "score_raw", "score_max", "last_seen"],
    ...roster.map((r) => [r.label, r.completed ? "completed" : "in-progress", r.scoreRaw, r.scoreMax, r.lastSeen]),
  ];
  return c.body(toCsv(rows), 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="proof-roster-page-${page}.csv"`,
    "X-Page": String(page),
    "X-Has-More": String(roster.length === 500),
  });
});

dashboardRoutes.get("/activity.json", async (c) => {
  const iri = c.req.query("iri");
  if (!iri) return c.text("Missing iri parameter", 400);
  const page = Math.max(1, Math.floor(Number(c.req.query("page")) || 1));
  const raws = await new D1Storage(c.env.DB).rawStatements(iri, 10000, (page - 1) * 10000);
  return c.body(`[${raws.join(",")}]`, 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="proof-statements-page-${page}.json"`,
    "X-Page": String(page),
    "X-Has-More": String(raws.length === 10000),
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
        {" · "}<a href={`/dashboard/learner.json?id=${encodeURIComponent(id)}`}>Export learner JSON</a>
      </p>
      {timeline.length === 0 ? (
        <p class="prax-empty">No statements for this learner on this activity.</p>
      ) : (
        <div class="prax-table-wrap">
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
        </div>
      )}
      <h2>Data rights</h2>
      <form method="post" action="/dashboard/learner/delete">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="iri" value={iri} />
        <button class="prax-danger" type="submit">Delete this learner and all statements</button>
      </form>
    </Layout>,
  );
});

dashboardRoutes.get("/learner.json", async (c) => {
  const id = c.req.query("id");
  if (!id) return c.text("Missing id parameter", 400);
  const s = new D1Storage(c.env.DB);
  const learner = await s.getLearner(id);
  if (!learner) return c.text("Learner not found", 404);
  const page = Math.max(1, Math.floor(Number(c.req.query("page")) || 1));
  const statements = await s.rawStatementsForLearner(id, 10000, (page - 1) * 10000);
  return c.json({ learner, statements: statements.map((raw) => JSON.parse(raw)) }, 200, {
    "Content-Disposition": 'attachment; filename="proof-learner.json"',
    "Cache-Control": "no-store",
    "X-Page": String(page),
    "X-Has-More": String(statements.length === 10000),
  });
});

dashboardRoutes.post("/learner/delete", async (c) => {
  const origin = new URL(c.req.url).origin;
  const reqOrigin = c.req.header("Origin");
  if (reqOrigin && reqOrigin !== origin) return c.text("Cross-origin form submission rejected", 403);
  const form = await c.req.parseBody();
  const id = typeof form.id === "string" ? form.id : "";
  const iri = typeof form.iri === "string" ? form.iri : "";
  if (!id || !iri) return c.text("Missing id or iri", 400);
  const deleted = await new D1Storage(c.env.DB).deleteLearner(id);
  if (!deleted) return c.text("Learner not found", 404);
  return c.redirect(`/dashboard/activity?iri=${encodeURIComponent(iri)}`, 303);
});
