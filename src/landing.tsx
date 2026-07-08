// SPDX-License-Identifier: MIT
import type { Context } from "hono";

export function Landing() {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.bunny.net" />
        <link rel="stylesheet" href="https://fonts.bunny.net/css?family=nunito:800|poppins:400,500" />
        <link rel="stylesheet" href="/dashboard.css" />
        <title>Proof</title>
      </head>
      <body>
        <a class="prax-skip" href="#main">Skip to content</a>
        <main id="main">
          <h1>Proof</h1>
          <p>
            This site collects learning results for activities its owner runs. Learner data stays on the owner's own Cloudflare account.
          </p>
          <ul>
            <li><a href="/dashboard">Dashboard</a></li>
            <li><a href="/about">About Proof</a></li>
          </ul>
        </main>
      </body>
    </html>
  );
}

export function landingHandler(c: Context) {
  return c.html(<Landing />, 200);
}
