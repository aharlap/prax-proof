// SPDX-License-Identifier: MIT
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeH5p, translateH5p } from "../src/snippet/h5p";
import type { SnippetContext } from "../src/snippet/core";
import {
  h5pAnswered,
  h5pAttemptedMain,
  h5pAttemptedSub,
  h5pCompletedMain,
} from "./fixtures/real-statements";

const ctx: SnippetContext = {
  activityIri: "https://proof.example/a/fractions-quiz",
  activityName: "fractions-quiz",
  actor: { account: { homePage: "https://proof.example", name: "device-uuid-1" } },
  registration: "11111111-1111-4111-8111-111111111111",
  page: "https://proof.example/embed",
};

describe("translateH5p", () => {
  it("translates attempted main content to initialized", () => {
    const s = translateH5p(h5pAttemptedMain, ctx) as Record<string, any>;
    expect(s.verb.id).toBe("http://adlnet.gov/expapi/verbs/initialized");
    expect(s.object.id).toBe(ctx.activityIri);
    expect(s.object.definition).toBe(h5pAttemptedMain.object.definition);
    expect(s.object.definition.name["en-US"]).toBe("Fractions check");
    expect(s.actor).toBe(ctx.actor);
    expect(s.context.registration).toBe(ctx.registration);
    expect(s.context.extensions).toEqual({
      "https://praxity.io/xapi/ext/page": "https://proof.example/embed",
    });
    expect("result" in s).toBe(false);
  });

  it("drops attempted subcontent", () => {
    expect(translateH5p(h5pAttemptedSub, ctx)).toBeNull();
  });

  it("translates answered subcontent while preserving definition and result", () => {
    const s = translateH5p(h5pAnswered, ctx) as Record<string, any>;
    expect(s.verb.id).toBe("http://adlnet.gov/expapi/verbs/answered");
    expect(s.object.id).toBe("https://proof.example/a/fractions-quiz/q/abc-123");
    expect(s.object.definition).toBe(h5pAnswered.object.definition);
    expect(s.object.definition.interactionType).toBe("choice");
    expect(s.object.definition.correctResponsesPattern).toEqual(["1"]);
    expect(s.result).toBe(h5pAnswered.result);
    expect(s.result.response).toBe("1");
    expect(s.result.score).toEqual({ min: 0, max: 1, raw: 1, scaled: 1 });
    expect(s.result.duration).toBe("PT6.33S");
  });

  it("translates completed main content and preserves result", () => {
    const s = translateH5p(h5pCompletedMain, ctx) as Record<string, any>;
    expect(s.verb.id).toBe("http://adlnet.gov/expapi/verbs/completed");
    expect(s.object.id).toBe(ctx.activityIri);
    expect(s.result).toBe(h5pCompletedMain.result);
  });

  it("drops unsupported interacted and experienced verbs", () => {
    expect(translateH5p({ ...h5pAnswered, verb: { id: "http://adlnet.gov/expapi/verbs/interacted" } }, ctx)).toBeNull();
    expect(translateH5p({ ...h5pAnswered, verb: { id: "http://adlnet.gov/expapi/verbs/experienced" } }, ctx)).toBeNull();
  });

  it("returns null for junk inputs without throwing", () => {
    for (const input of [null, 7, {}, { verb: {} }, { verb: { id: 5 }, object: {} }]) {
      expect(() => translateH5p(input, ctx)).not.toThrow();
      expect(translateH5p(input, ctx)).toBeNull();
    }
  });

  it("treats an object id that is not a URL as main content", () => {
    const s = translateH5p(
      {
        ...h5pAttemptedMain,
        object: { ...h5pAttemptedMain.object, id: "not a url" },
      },
      ctx,
    ) as Record<string, any>;
    expect(s.verb.id).toBe("http://adlnet.gov/expapi/verbs/initialized");
    expect(s.object.id).toBe(ctx.activityIri);
  });

  it("omits context extensions when ctx.page is not set", () => {
    const { page: _page, ...ctxWithoutPage } = ctx;
    const s = translateH5p(h5pAttemptedMain, ctxWithoutPage) as Record<string, any>;
    expect(s.context.registration).toBe(ctx.registration);
    expect(s.context.extensions).toBeUndefined();
  });
});

describe("subscribeH5p", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes when H5P appears and forwards xAPI statements", () => {
    const win: Record<string, unknown> = {};
    const seen: unknown[] = [];
    const handlers: Array<(event: unknown) => void> = [];
    const dispatcher = {
      on: vi.fn((eventName: string, cb: (event: unknown) => void) => {
        expect(eventName).toBe("xAPI");
        handlers.push(cb);
      }),
    };

    subscribeH5p(win, (stmt) => seen.push(stmt), { intervalMs: 10, timeoutMs: 100 });
    vi.advanceTimersByTime(10);
    expect(dispatcher.on).not.toHaveBeenCalled();

    win.H5P = { externalDispatcher: dispatcher };
    vi.advanceTimersByTime(10);
    expect(dispatcher.on).toHaveBeenCalledTimes(1);

    const handler = handlers[0];
    handler?.({ data: { statement: { id: "stmt-1" } } });
    handler?.({ data: {} });
    expect(seen).toEqual([{ id: "stmt-1" }]);

    vi.advanceTimersByTime(100);
    expect(dispatcher.on).toHaveBeenCalledTimes(1);
  });

  it("warns once when H5P is not found before timeout", () => {
    const warn = vi.fn();

    subscribeH5p({}, vi.fn(), { intervalMs: 10, timeoutMs: 25, warn });
    vi.advanceTimersByTime(30);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("data-h5p is set but H5P was not found on this page");

    vi.advanceTimersByTime(100);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
