// SPDX-License-Identifier: MIT
// Browser entry for the Proof snippet. Bundled by esbuild to /p.js.
// Contract: never throw into the host page; window.proof always exists.
import {
  buildAnswer, buildFinish, buildStart, buildStep, resolveIdentity,
  type IdentityMode, type SnippetContext,
} from "./core";
import { subscribeH5p, translateH5p } from "./h5p";

type ProofApi = {
  enable(): void;
  disable(): void;
  resetIdentity(): void;
  isEnabled(): boolean;
  start(): void;
  step(id: string, label?: string): void;
  answer(id: string, opts?: { response?: string; correct?: boolean }): void;
  finish(result?: { score?: number; max?: number; min?: number }): void;
};

(() => {
  const warn = (...args: unknown[]) => console.warn("[proof]", ...args);
  const noop: ProofApi = {
    enable: () => warn("not initialized"),
    disable: () => warn("not initialized"),
    resetIdentity: () => warn("not initialized"),
    isEnabled: () => false,
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
    const trackH5p = script.hasAttribute("data-h5p");
    const requestedMode = script.getAttribute("data-identity") ?? "anonymous";
    const mode: IdentityMode = requestedMode === "ask" || requestedMode === "token"
      ? requestedMode
      : "anonymous";
    let enabled = script.getAttribute("data-tracking") !== "consent";
    const consentMode = script.getAttribute("data-tracking") === "consent";
    const origin = new URL(script.src).origin;
    const namespace = `proof:${encodeURIComponent(origin)}:${encodeURIComponent(activity)}`;
    const deviceKey = `${namespace}:device`;
    const nameKey = `${namespace}:name`;
    let ctx: SnippetContext | null = null;

    const getPersistent = () => {
      try {
        const raw = localStorage.getItem(deviceKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { value?: unknown; expiresAt?: unknown };
        if (typeof parsed.value !== "string" || typeof parsed.expiresAt !== "number") return null;
        if (parsed.expiresAt <= Date.now()) {
          localStorage.removeItem(deviceKey);
          return null;
        }
        return parsed.value;
      } catch { return null; }
    };
    const setPersistent = (value: string) => {
      try {
        localStorage.setItem(deviceKey, JSON.stringify({
          value,
          expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
        }));
      } catch { /* private mode: identity lasts only for this page */ }
    };
    const stripLearnerToken = () => {
      try {
        const url = new URL(window.location.href);
        if (!url.searchParams.has("plearner")) return;
        url.searchParams.delete("plearner");
        history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
      } catch { /* leave navigation untouched */ }
    };
    const context = (): SnippetContext => {
      if (ctx) return ctx;
      const actor = resolveIdentity(mode, {
        getStored: (key) => {
          if (key === "proof:name") {
            try { return sessionStorage.getItem(nameKey); } catch { return null; }
          }
          return getPersistent();
        },
        setStored: (key, value) => {
          if (key === "proof:name") {
            try { sessionStorage.setItem(nameKey, value); } catch { /* session-only fallback */ }
            return;
          }
          setPersistent(value);
        },
        ask: (message) => window.prompt(message),
        urlParam: (name) => new URLSearchParams(window.location.search).get(name),
        randomId: () => crypto.randomUUID(),
        origin,
      });
      if (mode === "token") stripLearnerToken();
      ctx = {
        activityIri: `${origin}/a/${encodeURIComponent(activity)}`,
        activityName: activityName ?? activity,
        actor,
        registration: crypto.randomUUID(),
        page: `${location.origin}${location.pathname}`,
      };
      return ctx;
    };

    const send = (stmt: Record<string, unknown>) => {
      fetch(`${origin}/xapi/statements`, {
        method: "POST",
        keepalive: true,
        headers: {
          Authorization: `Basic ${btoa(key)}`,
          "Content-Type": "application/json",
          "X-Experience-API-Version": "1.0.3",
          ...(consentMode ? { "X-Proof-Consent": "granted" } : {}),
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
        if (!enabled) return;
        try { send(fn(...a)); } catch (e) { warn(e); }
      };

    (window as unknown as { proof: ProofApi }).proof = {
      enable: () => { enabled = true; },
      disable: () => { enabled = false; },
      isEnabled: () => enabled,
      resetIdentity: () => {
        try { localStorage.removeItem(deviceKey); } catch { /* unavailable storage */ }
        try { sessionStorage.removeItem(nameKey); } catch { /* unavailable storage */ }
        ctx = null;
      },
      start: guard(() => buildStart(context())),
      step: guard((id: string, label?: string) => buildStep(context(), id, label)),
      answer: guard((id: string, opts?: { response?: string; correct?: boolean }) => buildAnswer(context(), id, opts)),
      finish: guard((result?: { score?: number; max?: number; min?: number }) => buildFinish(context(), result)),
    };

    if (trackH5p) {
      subscribeH5p(window, (stmt) => {
        if (!enabled) return;
        try {
          const translated = translateH5p(stmt, context());
          if (translated) send(translated);
        } catch (e) {
          warn(e);
        }
      }, { warn });
    }
  } catch (e) {
    warn("failed to initialize:", e);
  }
})();
