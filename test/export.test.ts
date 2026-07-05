// SPDX-License-Identifier: MIT
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { csvCell } from "../src/dashboard/csv";
import { D1Storage } from "../src/storage/d1";
import { ingestStatements } from "../src/xapi/ingest";
import { bridgeSession } from "./fixtures/bridge-session";
import { ADMIN } from "./helpers";

const IRI = "https://example.org/x/export-quiz";

beforeAll(async () => {
  await ingestStatements(new D1Storage(env.DB), bridgeSession(IRI, "ccccccc1-3333-4444-8555-ccccccccccc1"));
});

describe("csvCell", () => {
  it("quotes and doubles embedded quotes", () =>
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"'));
  it("guards formula injection", () => {
    for (const v of ["=1+1", "+SUM(A1)", "-2", "@cmd"]) {
      expect(csvCell(v).startsWith('"\'')).toBe(true);
    }
  });
  it("guards formula injection even with leading whitespace", () => {
    expect(csvCell(" =1+1").startsWith('"\''), '" =1+1" not guarded').toBe(true);
    expect(csvCell("\t=SUM(A1)").startsWith('"\''), '"\\t=SUM(A1)" not guarded').toBe(true);
  });
  it("does not guard benign leading-whitespace values", () => {
    const out = csvCell(" hello");
    expect(out.startsWith("\"'")).toBe(false);
  });
  it("renders null as empty", () => expect(csvCell(null)).toBe(""));
});

describe("exports", () => {
  it("serves the roster CSV with headers and data", async () => {
    const res = await SELF.fetch(
      `https://proof.test/dashboard/activity.csv?iri=${encodeURIComponent(IRI)}`,
      { headers: ADMIN },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    const body = await res.text();
    expect(body).toContain("label,status,score_raw,score_max,last_seen");
    expect(body).toContain("Lea R.");
    expect(body).toContain("completed");
  });

  it("serves raw statements JSON", async () => {
    const res = await SELF.fetch(
      `https://proof.test/dashboard/activity.json?iri=${encodeURIComponent(IRI)}`,
      { headers: ADMIN },
    );
    expect(res.status).toBe(200);
    const arr = (await res.json()) as Record<string, unknown>[];
    expect(arr.length).toBeGreaterThanOrEqual(5);
    expect(arr.every((s) => typeof s.actor === "object")).toBe(true);
  });

  it("400s without iri", async () => {
    expect((await SELF.fetch("https://proof.test/dashboard/activity.csv", { headers: ADMIN })).status).toBe(400);
  });
});
