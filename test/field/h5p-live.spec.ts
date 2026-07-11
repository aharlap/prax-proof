// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { expect, test } from "@playwright/test";

// Real-browser field test for the data-h5p auto-bridge. Serves the demo page
// (examples/h5p-demo/index.html) with a freshly minted key, loads the real
// p.js bundle from wrangler dev, fires genuine H5P xAPI events through the real
// H5P.externalDispatcher, then confirms the statements landed in the dashboard.
const here = dirname(fileURLToPath(import.meta.url));
const DEMO_HTML = readFileSync(
  resolve(here, "../../examples/h5p-demo/index.html"),
  "utf8",
);
const ORIGIN = "http://127.0.0.1:8787";
const ADMIN = "Basic " + Buffer.from("admin:field-test-pw").toString("base64");

test("H5P events reach the Proof dashboard via data-h5p", async ({ page, request }) => {
  // Mint a real ingest key.
  const mint = await request.post("/admin/keys", {
    headers: { Authorization: ADMIN },
    data: { label: "h5p field test" },
  });
  expect(mint.status()).toBe(201);
  const key = (await mint.json()) as { id: string; secret: string };

  // Serve the demo page from the wrangler-dev origin via route interception so
  // the snippet's origin, CORS, and the page extension all resolve normally.
  const html = DEMO_HTML.replaceAll("__PROOF_ORIGIN__", ORIGIN).replaceAll(
    "__PROOF_KEY__",
    `${key.id}:${key.secret}`,
  );
  await page.route(`${ORIGIN}/h5p-demo`, (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );

  const posts: number[] = [];
  page.on("response", (res) => {
    if (res.url().endsWith("/xapi/statements")) posts.push(res.status());
  });

  await page.goto(`${ORIGIN}/h5p-demo`);

  // Wait for the real H5P runtime to be ready (the page flips status text).
  await expect(page.locator("#status")).toContainText("H5P runtime ready", {
    timeout: 30_000,
  });

  // Let the Proof bridge finish polling for + subscribing to H5P before we
  // fire events (H5P's own "attempted" at content load can otherwise beat the
  // subscription — a real edge worth knowing; interactions seconds later are fine).
  await page.waitForTimeout(1500);

  await page.click("#start");
  await expect(page.locator("#status")).toContainText("started → sent");
  await page.click("#answer");
  await expect(page.locator("#status")).toContainText("answered → sent");
  await page.click("#complete");
  await expect(page.locator("#status")).toContainText("completed → sent");

  // The real proof is the end state: poll the dashboard until the H5P events
  // have landed (keepalive-fetch responses aren't reliably observed client-side,
  // so we assert the outcome the operator actually sees).
  const iri = `${ORIGIN}/a/h5p-demo`;
  const dashboardBody = async () => {
    const r = await request.get(
      `/dashboard/activity?iri=${encodeURIComponent(iri)}`,
      { headers: { Authorization: ADMIN } },
    );
    return r.status() === 200 ? r.text() : "";
  };
  // Poll until the completed learner appears (H5P's own title wins over data-name).
  await expect.poll(dashboardBody, { timeout: 15_000 }).toContain("Completed");

  const dash = await dashboardBody();
  expect(dash).toContain("Fractions quiz"); // activity named from H5P's own event title
  expect(dash).not.toContain("View live page"); // anonymous mode omits page-location metadata
  expect(dash).toContain("100%"); // 1 attempted, 1 completed
  expect(dash).toContain("80%"); // avg score from the 8/10 completion
  expect(dash).toContain("8 / 10"); // the completion's score in the roster
  expect(dash).toContain("Anonymous"); // anonymous identity, short label

  // The answered event became a /q/abc-123 question child — visible on the learner timeline.
  const learnerLink = dash.match(/dashboard\/learner\?id=[^"&]+/)?.[0];
  expect(learnerLink).toBeTruthy();
  const tl = await request.get(`/${learnerLink}&iri=${encodeURIComponent(iri)}`, {
    headers: { Authorization: ADMIN },
  });
  const timeline = await tl.text();
  expect(timeline).toContain("Started"); // attempted → initialized
  expect(timeline).toContain("Answered"); // answered event on the /q/ child
  expect(timeline).toContain("abc-123"); // the subContentId question
  expect(timeline).toContain("✓ correct"); // answered with success
  expect(timeline).toContain("8 / 10"); // completion score

  expect(posts.length).toBeGreaterThanOrEqual(3); // attempted + answered + completed

});

test("consent mode sends nothing before enable and declares consent afterward", async ({ page, request }) => {
  const setConsent = await request.post("/dashboard/settings", {
    headers: {
      Authorization: ADMIN,
      Origin: ORIGIN,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    form: {
      operatorName: "Field test",
      privacyUrl: "",
      privacyContact: "",
      regionLabel: "",
      retentionDays: "365",
      trackingMode: "consent",
    },
  });
  expect(setConsent.status()).toBe(200);

  try {
    const scope = `${ORIGIN}/a/consent-field`;
    const mint = await request.post("/admin/keys", {
      headers: { Authorization: ADMIN },
      data: { label: "consent field test", activityScope: scope },
    });
    expect(mint.status()).toBe(201);
    const key = (await mint.json()) as { id: string; secret: string };
    const html = `<!doctype html><html><body>
      <script src="${ORIGIN}/p.js" data-activity="consent-field"
        data-key="${key.id}:${key.secret}" data-tracking="consent"></script>
    </body></html>`;
    await page.route(`${ORIGIN}/consent-field-page`, (route) =>
      route.fulfill({ contentType: "text/html", body: html }),
    );
    const statementHeaders: Record<string, string>[] = [];
    page.on("request", (sent) => {
      if (sent.url().endsWith("/xapi/statements")) statementHeaders.push(sent.headers());
    });

    await page.goto(`${ORIGIN}/consent-field-page`);
    await expect.poll(() => page.evaluate(() => typeof (window as unknown as {
      proof?: { start(): void };
    }).proof?.start)).toBe("function");
    expect(await page.evaluate(() => (window as unknown as {
      proof: { isEnabled(): boolean };
    }).proof.isEnabled())).toBe(false);
    await page.evaluate(() => (window as unknown as { proof: { start(): void } }).proof.start());
    await page.waitForTimeout(300);
    expect(statementHeaders).toHaveLength(0);

    await page.evaluate(() => {
      const proof = (window as unknown as { proof: { enable(): void; start(): void } }).proof;
      proof.enable();
      proof.start();
    });
    await expect.poll(() => statementHeaders.length).toBe(1);
    expect(statementHeaders[0]["x-proof-consent"]).toBe("granted");
    await expect.poll(async () => (
      await request.get(`/dashboard/activity?iri=${encodeURIComponent(scope)}`, {
        headers: { Authorization: ADMIN },
      })
    ).status()).toBe(200);
  } finally {
    await request.post("/dashboard/settings", {
      headers: {
        Authorization: ADMIN,
        Origin: ORIGIN,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      form: {
        operatorName: "Field test",
        privacyUrl: "",
        privacyContact: "",
        regionLabel: "",
        retentionDays: "365",
        trackingMode: "notice",
      },
    });
  }
});
