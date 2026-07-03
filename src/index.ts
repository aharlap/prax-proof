// SPDX-License-Identifier: MIT
import { Hono } from "hono";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();

app.get("/xapi/about", (c) => c.json({ version: ["1.0.3"] }));

export default app;
