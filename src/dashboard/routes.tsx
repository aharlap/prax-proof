// SPDX-License-Identifier: MIT
import { Hono } from "hono";
import type { Env } from "../env";
import { Layout } from "./ui";

type Ctx = { Bindings: Env };

export const dashboardRoutes = new Hono<Ctx>();

dashboardRoutes.get("/", (c) =>
  c.html(
    <Layout title="Activities">
      <h1>Activities</h1>
      <p class="prax-empty">No activities yet. Send a statement and it appears here.</p>
    </Layout>,
  ),
);
