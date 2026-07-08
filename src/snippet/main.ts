// SPDX-License-Identifier: MIT
// Browser entry for the Proof snippet. Bundled by esbuild to /p.js.
// Contract: never throw into the host page; window.proof always exists.
import {
  buildAnswer, buildFinish, buildStart, buildStep, resolveIdentity,
  type IdentityMode, type SnippetContext,
} from "./core";

type ProofApi = {
  start(): void;
  step(id: string, label?: string): void;
  answer(id: string, opts?: { response?: string; correct?: boolean }): void;
  finish(result?: { score?: number; max?: number; min?: number }): void;
};

(() => {
  const warn = (...args: unknown[]) => console.warn("[proof]", ...args);
  const noop: ProofApi = {
    start: () => warn("not initialized"),
    step: () => warn("not initialized"),
    answer: () => warn("not initialized"),
    finish: () => warn("not initialized"),
  };
  (window as unknown as { proof: ProofApi }).proof = noop;

  try {
    const script = document.currentScript as HTMLScriptElement | null;
    if (!script?.src) return warn("cannot locate own script tag");
    const activity = script.getAttribute("data-activity");
    const activityName = script.getAttribute("data-name");
    const key = script.getAttribute("data-key");
    if (!activity || !key) return warn("data-activity and data-key are required");
    const mode = (script.getAttribute("data-identity") ?? "anonymous") as IdentityMode;
    const origin = new URL(script.src).origin;

    const actor = resolveIdentity(mode, {
      getStored: (k) => {
        try { return localStorage.getItem(k); } catch { return null; }
      },
      setStored: (k, v) => {
        try { localStorage.setItem(k, v); } catch { /* private mode: session-scoped identity */ }
      },
      ask: (m) => window.prompt(m),
      urlParam: (n) => new URLSearchParams(window.location.search).get(n),
      randomId: () => crypto.randomUUID(),
      origin,
    });

    const ctx: SnippetContext = {
      activityIri: `${origin}/a/${encodeURIComponent(activity)}`,
      activityName: activityName ?? activity,
      actor,
      registration: crypto.randomUUID(),
      page: `${location.origin}${location.pathname}`,
    };

    const send = (stmt: Record<string, unknown>) => {
      fetch(`${origin}/xapi/statements`, {
        method: "POST",
        keepalive: true,
        headers: {
          Authorization: `Basic ${btoa(key)}`,
          "Content-Type": "application/json",
          "X-Experience-API-Version": "1.0.3",
        },
        body: JSON.stringify(stmt),
      })
        .then((r) => {
          if (!r.ok) warn("statement rejected:", r.status);
        })
        .catch((e) => warn("send failed:", e));
    };

    const guard = <A extends unknown[]>(fn: (...a: A) => Record<string, unknown>) =>
      (...a: A) => {
        try { send(fn(...a)); } catch (e) { warn(e); }
      };

    (window as unknown as { proof: ProofApi }).proof = {
      start: guard(() => buildStart(ctx)),
      step: guard((id: string, label?: string) => buildStep(ctx, id, label)),
      answer: guard((id: string, opts?: { response?: string; correct?: boolean }) => buildAnswer(ctx, id, opts)),
      finish: guard((result?: { score?: number; max?: number; min?: number }) => buildFinish(ctx, result)),
    };
  } catch (e) {
    warn("failed to initialize:", e);
  }
})();
