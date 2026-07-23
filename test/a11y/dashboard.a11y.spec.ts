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

test("landing page has no axe violations", async ({ page }) => {
  await page.goto("/");
  await expectNoViolations(page);
});

test("about page has no axe violations", async ({ page }) => {
  await page.goto("/about");
  await expectNoViolations(page);
});

test("privacy notice has no axe violations", async ({ page }) => {
  await page.goto("/privacy");
  await expectNoViolations(page);
});

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

test("settings page has no axe violations", async ({ page }) => {
  await page.goto("/dashboard/settings");
  await expectNoViolations(page);
});

test("keyboard reveals and activates the skip link", async ({ page, browserName }) => {
  await page.goto("/dashboard");
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  const focused = page.locator(":focus");
  await expect(focused).toHaveText("Skip to content");
  await expect(focused).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});

test("wide tables are named keyboard-scrollable regions", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/dashboard/keys");
  const region = page.getByRole("region", {
    name: "Existing keys (secrets are never shown again)",
  });
  await expect(region).toHaveAttribute("tabindex", "0");
  const before = await region.evaluate((element) => ({
    left: element.scrollLeft,
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(before.scroll).toBeGreaterThan(before.client);
  await region.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
});

test("post-create secret remains within a 320 CSS pixel viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/dashboard/keys");
  const slug = `reflow-${testInfo.project.name.replace(/[^a-z0-9]+/g, "-")}`;
  await page.getByLabel("Activity title").fill(`Reflow ${testInfo.project.name}`);
  await page.getByLabel("Activity slug").fill(slug);
  await page.getByRole("button", { name: "Create scoped key" }).click();
  await expect(page.getByRole("heading", { name: "Key created" })).toBeFocused();
  await expect(page.locator("body")).toHaveCSS("margin", "0px");
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
    codeBlocksFit: [...document.querySelectorAll("#minted-key pre")]
      .every((element) => element.scrollWidth <= element.clientWidth),
  }));
  expect(widths.page).toBeLessThanOrEqual(widths.viewport);
  expect(widths.codeBlocksFit).toBe(true);
});

test("destructive actions lead to accessible review screens", async ({ page }) => {
  await page.goto("/dashboard/keys");
  const revokeLinks = page.getByRole("link", { name: /^Revoke key .+, id ending / });
  await expect(revokeLinks.first()).toBeVisible();
  await revokeLinks.first().click();
  await expect(page.getByRole("heading", { name: "Revoke this key?" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cancel and return to keys" })).toBeVisible();
  await expectNoViolations(page);

  await page.goto(`/dashboard/activity?iri=${encodeURIComponent(IRI)}`);
  await page.locator("table a").first().click();
  await page.getByRole("link", { name: "Review deletion of this learner and all statements" }).click();
  await expect(page.getByRole("heading", { name: /^Delete .+\?$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cancel and return to learner" })).toBeVisible();
  await expectNoViolations(page);
});
