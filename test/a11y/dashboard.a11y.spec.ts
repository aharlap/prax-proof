// SPDX-License-Identifier: MIT
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const IRI = "https://example.org/x/a11y-quiz";
let learnerHref = "";

test.beforeAll(async ({ request }) => {
  const mint = await request.post("/admin/keys", {
    headers: { Authorization: "Basic " + Buffer.from("admin:a11y-test-pw").toString("base64") },
    data: { label: "a11y seed" },
  });
  expect(mint.status()).toBe(201);
  const key = (await mint.json()) as { id: string; secret: string };

  const V = "http://adlnet.gov/expapi/verbs/";
  const actor = { account: { homePage: "https://p.test", name: "a11y-device" }, name: "Axe Tester" };
  const reg = "dddddddd-4444-4555-8666-ddddddddddd1";
  const session = [
    { actor, verb: { id: `${V}initialized` }, object: { id: IRI, definition: { name: { en: "A11y Quiz" } } }, context: { registration: reg } },
    { actor, verb: { id: `${V}progressed` }, object: { id: `${IRI}/steps/intro` }, context: { registration: reg } },
    { actor, verb: { id: `${V}answered` }, object: { id: `${IRI}/q/q1` }, result: { response: "B", success: true }, context: { registration: reg } },
    { actor, verb: { id: `${V}completed` }, object: { id: IRI }, result: { completion: true, score: { raw: 1, max: 1, scaled: 1 } }, context: { registration: reg } },
  ];
  const post = await request.post("/xapi/statements", {
    headers: {
      Authorization: "Basic " + Buffer.from(`${key.id}:${key.secret}`).toString("base64"),
      "X-Experience-API-Version": "1.0.3",
    },
    data: session,
  });
  expect(post.status()).toBe(200);
});

async function expectNoViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

test("activity list has no axe violations", async ({ page }) => {
  await page.goto("/dashboard");
  await expectNoViolations(page);
});

test("activity detail has no axe violations", async ({ page }) => {
  await page.goto(`/dashboard/activity?iri=${encodeURIComponent(IRI)}`);
  await expectNoViolations(page);
  const link = page.locator("table a").first();
  learnerHref = (await link.getAttribute("href")) ?? "";
  expect(learnerHref).toContain("/dashboard/learner");
});

test("learner detail has no axe violations", async ({ page }) => {
  await page.goto(`/dashboard/activity?iri=${encodeURIComponent(IRI)}`);
  const href = await page.locator("table a").first().getAttribute("href");
  await page.goto(href!);
  await expectNoViolations(page);
});

test("keys page has no axe violations", async ({ page }) => {
  await page.goto("/dashboard/keys");
  await expectNoViolations(page);
});

test("first Tab reveals the skip link", async ({ page }) => {
  await page.goto("/dashboard");
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toHaveText("Skip to content");
  await expect(focused).toBeVisible();
});
