// SPDX-License-Identifier: MIT
import type { PropsWithChildren } from "hono/jsx";

export function Layout(props: PropsWithChildren<{ title: string }>) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} · Proof</title>
        <link rel="stylesheet" href="/dashboard.css" />
      </head>
      <body>
        <a class="prax-skip" href="#main">Skip to content</a>
        <header class="prax-top">
          <strong>Proof</strong> — <a href="/dashboard">Activities</a>
        </header>
        <main id="main">{props.children}</main>
      </body>
    </html>
  );
}

export function StatCard(props: { label: string; value: string }) {
  return (
    <div class="prax-stat">
      <b>{props.value}</b>
      <span>{props.label}</span>
    </div>
  );
}
