// SPDX-License-Identifier: MIT
// @ts-expect-error The screenshot runner is Node, but the project tsconfig omits Node types.
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const IRI = "https://example.org/x/fractions-quiz";
const PAGE_EXT = "https://praxity.io/xapi/ext/page";
const V = "http://adlnet.gov/expapi/verbs/";

const actors = {
  amara: {
    name: "Amara O.",
    account: { homePage: "https://example.org", name: "amara-o" },
  },
  ben: {
    name: "Ben T.",
    account: { homePage: "https://example.org", name: "ben-t" },
  },
  chloe: {
    name: "Chloé D.",
    account: { homePage: "https://example.org", name: "chloe-d" },
  },
  dev: {
    name: "Dev P.",
    account: { homePage: "https://example.org", name: "dev-p" },
  },
};

const regs = {
  amara: "11111111-1111-4111-8111-111111111111",
  ben: "22222222-2222-4222-8222-222222222222",
  chloe: "33333333-3333-4333-8333-333333333333",
  dev: "44444444-4444-4444-8444-444444444444",
};

function stamp(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function parentObject() {
  return { id: IRI, definition: { name: { en: "Fractions quiz" } } };
}

function baseContext(registration: string) {
  return {
    registration,
    extensions: { [PAGE_EXT]: "https://example.org/fractions" },
  };
}

function initialized(id: string, actor: typeof actors.amara, registration: string, minutesAgo: number) {
  return {
    id,
    actor,
    verb: { id: `${V}initialized` },
    object: parentObject(),
    context: baseContext(registration),
    timestamp: stamp(minutesAgo),
  };
}

function progressed(
  id: string,
  actor: typeof actors.amara,
  registration: string,
  step: string,
  label: string,
  minutesAgo: number,
) {
  return {
    id,
    actor,
    verb: { id: `${V}progressed` },
    object: { id: `${IRI}/steps/${step}`, definition: { name: { en: label } } },
    context: { registration },
    timestamp: stamp(minutesAgo),
  };
}

function answered(
  id: string,
  actor: typeof actors.amara,
  registration: string,
  response: string,
  success: boolean,
  minutesAgo: number,
) {
  return {
    id,
    actor,
    verb: { id: `${V}answered` },
    object: { id: `${IRI}/q/q1` },
    result: { response, success },
    context: { registration },
    timestamp: stamp(minutesAgo),
  };
}

function completed(
  id: string,
  actor: typeof actors.amara,
  registration: string,
  minutesAgo: number,
  score?: { raw: number; max: number; scaled: number },
  duration?: string,
) {
  return {
    id,
    actor,
    verb: { id: `${V}completed` },
    object: parentObject(),
    result: {
      completion: true,
      ...(score ? { score: { min: 0, ...score } } : {}),
      ...(duration ? { duration } : {}),
    },
    context: { registration },
    timestamp: stamp(minutesAgo),
  };
}

test("captures the dashboard activity detail screenshot", async ({ page, request }) => {
  const mint = await request.post("/admin/keys", {
    headers: { Authorization: "Basic " + btoa("admin:a11y-test-pw") },
    data: { label: "screenshot seed" },
  });
  expect(mint.status()).toBe(201);
  const key = (await mint.json()) as { id: string; secret: string };

  const session = [
    initialized("aaaaaaaa-0001-4000-8000-000000000001", actors.amara, regs.amara, 12960),
    initialized("aaaaaaaa-0002-4000-8000-000000000002", actors.ben, regs.ben, 8640),
    initialized("aaaaaaaa-0003-4000-8000-000000000003", actors.chloe, regs.chloe, 2880),
    initialized("aaaaaaaa-0004-4000-8000-000000000004", actors.dev, regs.dev, 21),

    progressed("aaaaaaaa-0011-4000-8000-000000000011", actors.amara, regs.amara, "intro", "Introduction", 20),
    progressed("aaaaaaaa-0012-4000-8000-000000000012", actors.ben, regs.ben, "intro", "Introduction", 19),
    progressed("aaaaaaaa-0013-4000-8000-000000000013", actors.chloe, regs.chloe, "intro", "Introduction", 18),
    progressed("aaaaaaaa-0014-4000-8000-000000000014", actors.dev, regs.dev, "intro", "Introduction", 17),

    progressed("aaaaaaaa-0021-4000-8000-000000000021", actors.amara, regs.amara, "practice", "Practice questions", 16),
    progressed("aaaaaaaa-0022-4000-8000-000000000022", actors.ben, regs.ben, "practice", "Practice questions", 15),
    progressed("aaaaaaaa-0023-4000-8000-000000000023", actors.chloe, regs.chloe, "practice", "Practice questions", 14),

    progressed("aaaaaaaa-0031-4000-8000-000000000031", actors.amara, regs.amara, "review", "Review", 13),
    progressed("aaaaaaaa-0032-4000-8000-000000000032", actors.ben, regs.ben, "review", "Review", 12),
    progressed("aaaaaaaa-0033-4000-8000-000000000033", actors.chloe, regs.chloe, "review", "Review", 11.5),

    answered("aaaaaaaa-0041-4000-8000-000000000041", actors.amara, regs.amara, "B", true, 11),
    answered("aaaaaaaa-0042-4000-8000-000000000042", actors.ben, regs.ben, "C", false, 10),

    completed("aaaaaaaa-0051-4000-8000-000000000051", actors.amara, regs.amara, 9, { raw: 9, max: 10, scaled: 0.9 }, "PT4M30S"),
    completed("aaaaaaaa-0052-4000-8000-000000000052", actors.ben, regs.ben, 8, { raw: 7, max: 10, scaled: 0.7 }, "PT6M"),
    completed("aaaaaaaa-0053-4000-8000-000000000053", actors.chloe, regs.chloe, 7),
  ];
  const post = await request.post("/xapi/statements", {
    headers: {
      Authorization: "Basic " + btoa(`${key.id}:${key.secret}`),
      "X-Experience-API-Version": "1.0.3",
    },
    data: session,
  });
  expect(post.status()).toBe(200);

  await page.goto(`/dashboard/activity?iri=${encodeURIComponent(IRI)}`);
  await expect(page.getByRole("heading", { name: "Fractions quiz" })).toBeVisible();
  mkdirSync("docs/assets", { recursive: true });
  await page.screenshot({ path: "docs/assets/dashboard.png", fullPage: false });
});
