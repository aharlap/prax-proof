// SPDX-License-Identifier: MIT
import type { Context } from "hono";

export function About() {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="/dashboard.css" />
        <title>About Proof</title>
      </head>
      <body>
        <a class="prax-skip" href="#main">Skip to content</a>
        <main id="main">
          <h1>About Proof</h1>
          <p>
            Proof is a free, open-source results tracker for learning activities: see who did an activity, whether they finished, how they scored, and where they dropped off — without an LMS and without a subscription.
          </p>
          <h2>The honest fine print</h2>
          <p>
            Proof implements an honest subset of xAPI 1.0.3 — the Statements resource only — and is not a conformant LRS. Statements are portable JSON: if this instance is ever outgrown, they can be exported or forwarded to a full LRS such as <a href="https://github.com/yetanalytics/lrsql">lrsql</a>.
          </p>
          <h2>Privacy</h2>
          <p>
            Learner data is stored in this instance's own Cloudflare D1 database, controlled by whoever operates it. Anonymous and token modes omit page location and identity-bearing metadata; named mode can store a page path but never its query string. Identity is pseudonymous by default, and an operator can explicitly choose names or opaque link tokens.
          </p>
          <ul>
            <li><a href="https://github.com/Praxity/prax-proof">Source on GitHub, MIT</a></li>
            <li><a href="/llms.txt">Instructions for AI builders</a></li>
            <li><a href="/privacy">This instance's privacy notice</a></li>
            <li><a href="/">Home</a></li>
          </ul>
        </main>
      </body>
    </html>
  );
}

export function aboutHandler(c: Context) {
  return c.html(<About />, 200);
}
