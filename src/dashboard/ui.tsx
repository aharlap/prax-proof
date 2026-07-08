// SPDX-License-Identifier: MIT
import type { PropsWithChildren } from "hono/jsx";

export function Layout(props: PropsWithChildren<{ title: string }>) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} · Proof</title>
        <link rel="preconnect" href="https://fonts.bunny.net" />
        <link rel="stylesheet" href="https://fonts.bunny.net/css?family=nunito:800|poppins:400,500" />
        <link rel="stylesheet" href="/dashboard.css" />
      </head>
      <body>
        <a class="prax-skip" href="#main">Skip to content</a>
        <header class="prax-top">
          <strong>Proof</strong> — <a href="/dashboard">Activities</a> · <a href="/dashboard/keys">Keys</a>
        </header>
        <main id="main">{props.children}</main>
      </body>
    </html>
  );
}

export function StatCard(props: { label: string; value: string; sub?: string; hero?: boolean }) {
  return (
    <div class={props.hero ? "prax-stat prax-stat-hero" : "prax-stat"}>
      <b>{props.value}</b>
      <span>{props.label}</span>
      {props.sub ? <span class="prax-sub">{props.sub}</span> : null}
    </div>
  );
}
