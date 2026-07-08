// SPDX-License-Identifier: MIT
// Vendored minimal --prax-* token set. Swap for @praxity/tokens (prax repo,
// packages/tokens) once it is published to npm; variable names match it.
export const DASHBOARD_CSS = `
:root {
  --prax-color-bg: #F9F8F0;
  --prax-color-surface: #FFFFFF;
  --prax-color-ink: #1A1A1A;
  --prax-color-ink-soft: #55534E;
  --prax-color-line: #E4E1D6;
  --prax-color-accent: #007A63;
  --prax-color-accent-soft: #D6F3EC;
  --prax-color-warn: #8A4B00;
  --prax-color-warn-soft: #FFF6BF;
  --prax-color-focus: #1D4ED8; /* deliberately NOT the accent: focus rings must contrast with adjacent teal ink, not blend with it */
  --prax-color-accent-2: #00C9A7;
  --prax-color-accent-3: #FF48B0;
  --prax-color-pink-soft: #FFE0F1;
  --prax-radius: 8px;
  --prax-offset-shadow: 3px 3px 0 var(--prax-color-accent-soft);
  --prax-space: 1rem;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--prax-color-bg); color: var(--prax-color-ink);
  font-family: "Poppins", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 16px; line-height: 1.55; font-weight: 400;
}
a { color: var(--prax-color-accent); }
:focus-visible { outline: 3px solid var(--prax-color-focus); outline-offset: 2px; }
.prax-skip {
  position: absolute; left: -999px; top: 0; background: var(--prax-color-surface);
  padding: 0.5rem 1rem; z-index: 10;
}
.prax-skip:focus { left: 0; }
header.prax-top {
  border-bottom: 3px solid var(--prax-color-accent); background: var(--prax-color-surface);
  padding: 0.75rem 1.25rem;
}
header.prax-top strong { font-family: "Nunito", "Poppins", -apple-system, sans-serif; font-weight: 800; }
main { max-width: 960px; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; }
h1, h2 { font-family: "Nunito", "Poppins", -apple-system, sans-serif; font-weight: 800; }
h1 { font-size: 1.5rem; margin: 0.5rem 0 1rem; }
h1::after { content: ""; display: block; width: 3.5rem; height: 4px; background: var(--prax-color-accent-2); margin-top: 0.35rem; border-radius: 2px; }
h2 { font-size: 1.1rem; margin: 2rem 0 0.75rem; }
table { width: 100%; border-collapse: collapse; background: var(--prax-color-surface);
  border: 1px solid var(--prax-color-line); border-radius: var(--prax-radius);
  box-shadow: var(--prax-offset-shadow); }
caption { text-align: left; font-size: 0.85rem; color: var(--prax-color-ink-soft); margin-bottom: 0.5rem; }
th { text-align: left; font-size: 0.8rem; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--prax-color-ink-soft); font-weight: 500; padding: 0.6rem 0.75rem; border-bottom: 2px solid var(--prax-color-line); }
td { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--prax-color-line); }
.prax-stats { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1rem 0 1.5rem; }
.prax-stat { flex: 1 1 140px; background: var(--prax-color-surface);
  border: 1px solid var(--prax-color-line); border-radius: var(--prax-radius); padding: 0.9rem 1rem;
  box-shadow: var(--prax-offset-shadow); }
.prax-stat b { display: block; font-size: 1.6rem; }
.prax-stat span { font-size: 0.8rem; color: var(--prax-color-ink-soft); text-transform: uppercase; letter-spacing: 0.05em; }
.prax-badge { display: inline-block; font-size: 0.78rem; font-weight: 600;
  padding: 0.1rem 0.6rem; border-radius: 999px; }
.prax-badge.done { background: var(--prax-color-accent-soft); color: var(--prax-color-ink); }
.prax-badge.open { background: var(--prax-color-warn-soft); color: var(--prax-color-ink); }
.prax-bars { display: grid; gap: 0.35rem; margin: 0.75rem 0; }
.prax-bar { display: grid; grid-template-columns: 7rem 1fr auto; gap: 0.75rem; align-items: center; font-size: 0.85rem; }
.prax-bar .fill { background: var(--prax-color-accent); height: 1rem; border-radius: 3px; min-width: 2px; }
.prax-empty { background: var(--prax-color-surface); border: 1px dashed var(--prax-color-line);
  border-radius: var(--prax-radius); padding: 2rem; text-align: center; color: var(--prax-color-ink-soft); }
`;
