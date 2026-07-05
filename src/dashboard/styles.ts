// SPDX-License-Identifier: MIT
// Vendored minimal --prax-* token set. Swap for @praxity/tokens (prax repo,
// packages/tokens) once it is published to npm; variable names match it.
export const DASHBOARD_CSS = `
:root {
  --prax-color-bg: #fdfcfa;
  --prax-color-surface: #ffffff;
  --prax-color-ink: #1a2332;
  --prax-color-ink-soft: #4a5568;
  --prax-color-line: #d9dee7;
  --prax-color-accent: #0b6e4f;
  --prax-color-accent-soft: #e6f4ee;
  --prax-color-warn: #9a4b00;
  --prax-color-warn-soft: #fef3e2;
  --prax-color-focus: #1d4ed8;
  --prax-radius: 8px;
  --prax-space: 1rem;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--prax-color-bg); color: var(--prax-color-ink);
  font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
a { color: var(--prax-color-accent); }
:focus-visible { outline: 3px solid var(--prax-color-focus); outline-offset: 2px; }
.prax-skip {
  position: absolute; left: -999px; top: 0; background: var(--prax-color-surface);
  padding: 0.5rem 1rem; z-index: 10;
}
.prax-skip:focus { left: 0; }
header.prax-top {
  border-bottom: 1px solid var(--prax-color-line); background: var(--prax-color-surface);
  padding: 0.75rem 1.25rem;
}
main { max-width: 960px; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; }
h1 { font-size: 1.5rem; margin: 0.5rem 0 1rem; }
h2 { font-size: 1.1rem; margin: 2rem 0 0.75rem; }
table { width: 100%; border-collapse: collapse; background: var(--prax-color-surface);
  border: 1px solid var(--prax-color-line); border-radius: var(--prax-radius); }
caption { text-align: left; font-size: 0.85rem; color: var(--prax-color-ink-soft); margin-bottom: 0.5rem; }
th { text-align: left; font-size: 0.8rem; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--prax-color-ink-soft); padding: 0.6rem 0.75rem; border-bottom: 2px solid var(--prax-color-line); }
td { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--prax-color-line); }
.prax-stats { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1rem 0 1.5rem; }
.prax-stat { flex: 1 1 140px; background: var(--prax-color-surface);
  border: 1px solid var(--prax-color-line); border-radius: var(--prax-radius); padding: 0.9rem 1rem; }
.prax-stat b { display: block; font-size: 1.6rem; }
.prax-stat span { font-size: 0.8rem; color: var(--prax-color-ink-soft); text-transform: uppercase; letter-spacing: 0.05em; }
.prax-badge { display: inline-block; font-size: 0.78rem; font-weight: 600;
  padding: 0.1rem 0.6rem; border-radius: 999px; }
.prax-badge.done { background: var(--prax-color-accent-soft); color: var(--prax-color-accent); }
.prax-badge.open { background: var(--prax-color-warn-soft); color: var(--prax-color-warn); }
.prax-bars { display: grid; gap: 0.35rem; margin: 0.75rem 0; }
.prax-bar { display: grid; grid-template-columns: 7rem 1fr auto; gap: 0.75rem; align-items: center; font-size: 0.85rem; }
.prax-bar .fill { background: var(--prax-color-accent); height: 1rem; border-radius: 3px; min-width: 2px; }
.prax-empty { background: var(--prax-color-surface); border: 1px dashed var(--prax-color-line);
  border-radius: var(--prax-radius); padding: 2rem; text-align: center; color: var(--prax-color-ink-soft); }
`;
