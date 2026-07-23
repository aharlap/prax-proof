// SPDX-License-Identifier: MIT
import type { PropsWithChildren } from "hono/jsx";

export type DashboardSection = "activities" | "keys" | "settings";

export function Layout(props: PropsWithChildren<{
  title: string;
  current?: DashboardSection;
  focusId?: string;
}>) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title} · Proof</title>
        <link rel="stylesheet" href="/dashboard.css" />
        <script src="/dashboard.js" defer></script>
      </head>
      <body data-focus-id={props.focusId}>
        <a class="prax-skip" href="#main">Skip to content</a>
        <header class="prax-top">
          <strong>Proof</strong>
          {" — "}
          <nav aria-label="Primary">
            <a href="/dashboard" aria-current={props.current === "activities" ? "page" : undefined}>Activities</a>
            {" · "}
            <a href="/dashboard/keys" aria-current={props.current === "keys" ? "page" : undefined}>Keys</a>
            {" · "}
            <a href="/dashboard/settings" aria-current={props.current === "settings" ? "page" : undefined}>Settings</a>
            {" · "}
            <a href="/privacy">Privacy notice</a>
          </nav>
        </header>
        <main id="main" tabindex={-1}>{props.children}</main>
      </body>
    </html>
  );
}

export const DASHBOARD_JS = `document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".prax-table-wrap[tabindex='0']").forEach((region) => {
    region.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      region.scrollLeft += event.key === "ArrowRight" ? 80 : -80;
    });
  });
  const focusId = document.body.dataset.focusId;
  if (focusId) {
    requestAnimationFrame(() => document.getElementById(focusId)?.focus());
  }
});`;

export function StatCard(props: { label: string; value: string; sub?: string; hero?: boolean }) {
  return (
    <div class={props.hero ? "prax-stat prax-stat-hero" : "prax-stat"}>
      <b>{props.value}</b>
      <span>{props.label}</span>
      {props.sub ? <span class="prax-sub">{props.sub}</span> : null}
    </div>
  );
}
