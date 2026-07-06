// SPDX-License-Identifier: MIT
import type { Context } from "hono";

export function Landing() {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="/dashboard.css" />
        <title>Proof</title>
      </head>
      <body>
        <a class="prax-skip" href="#main">Skip to content</a>
        <main id="main">
          <h1>Proof</h1>
          <p>
            A free, open-source results tracker for learning activities. Proof implements an honest subset of xAPI 1.0.3 — the Statements resource only — and is not a conformant LRS.
          </p>
          <ul>
            <li><a href="/dashboard">Dashboard</a></li>
            <li><a href="/llms.txt">Instructions for AI builders</a></li>
            <li><a href="https://github.com/aharlap/prax-proof">Source on GitHub</a></li>
          </ul>
        </main>
      </body>
    </html>
  );
}

export function landingHandler(c: Context) {
  return c.html(<Landing />, 200);
}
