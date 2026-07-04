// SPDX-License-Identifier: MIT
import { Hono } from "hono";
import type { Env } from "../env";
import { D1Storage } from "../storage/d1";
import { Layout } from "./ui";

type Ctx = { Bindings: Env };

export const dashboardRoutes = new Hono<Ctx>();

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
