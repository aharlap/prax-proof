// SPDX-License-Identifier: MIT
// Served at /llms.txt — instructions for AI tools adding Proof tracking to a page.
export const LLMS_TXT = `# Proof — add learning results tracking to this page

Proof is a self-hosted results tracker. Add ONE script tag, then call four
functions. Do not add any other tracking code, SDK, or xAPI library.

## 1. Script tag (before your closing </body>)

<script src="{{PROOF_ORIGIN}}/p.js"
        data-activity="my-activity-slug"
        data-name="My Activity Title"
        data-key="KEY_ID:KEY_SECRET"
        data-identity="ask"></script>

- data-activity: short stable slug for this activity (kebab-case).
- data-name: optional human title shown on the dashboard.
- data-key: the ingest key the instance owner minted (POST /admin/keys).
- data-identity: "anonymous" (no names), "ask" (prompt for a name once),
  or "token" (identity read from a ?plearner=... link parameter).
- data-h5p: add this attribute if the page hosts H5P content. Proof tracks it
  automatically, no calls needed. Two rules: (1) it works only when the H5P
  content is hosted on the same site as the page (WordPress/Drupal plugins,
  h5p-standalone, Lumi exports — NOT h5p.org cross-site iframe embeds);
  (2) every H5P event on the page is recorded into this page's ONE
  data-activity, so place one tracked H5P activity per page — multiple H5P
  contents on the same page merge into a single report.
- The snippet reports the page URL as origin + path only, never query strings
  or hashes, so the dashboard can link to the live page.

## 2. The four calls

proof.start();                                        // when the activity begins
proof.step("section-2", "Section 2 — Practice");      // each section/page reached
proof.answer("q1", { response: "B", correct: true }); // each question answered
proof.finish({ score: 8, max: 10 });                  // when the activity ends

Rules:
- Call start() once, as soon as your activity is ready.
- Call step(id, label?) with a short stable id every time the learner reaches a
  new section; the optional label names the step in the dashboard funnel.
- Call answer(questionId, { response, correct }) on each answered question.
- Call finish({ score, max }) exactly once at the end. Omit the score object
  if the activity is not scored: proof.finish().
- All calls are fire-and-forget and never throw; no await needed.

## Advanced: sending raw xAPI instead

POST {{PROOF_ORIGIN}}/xapi/statements with HTTP Basic auth (key id:secret),
header X-Experience-API-Version: 1.0.3, and an xAPI 1.0.3 statement body.
Proof implements the Statements resource only (no document APIs, voiding,
or attachments) and is not a conformant LRS.

## Reading results back

- Mint a READ key: use the Keys page or POST /admin/keys with {"label":"reader","kind":"read"}. Ingest keys cannot read; read keys cannot write.
- Auth: either header works: Authorization: Bearer KEY_ID:KEY_SECRET or Basic base64(KEY_ID:KEY_SECRET).
- List activities: curl -H "Authorization: Bearer KEY_ID:KEY_SECRET" "{{PROOF_ORIGIN}}/api/activities"
- Compact JSON summary: curl -H "Authorization: Bearer KEY_ID:KEY_SECRET" "{{PROOF_ORIGIN}}/api/activity?slug=my-activity"
- Markdown report: curl -H "Authorization: Bearer KEY_ID:KEY_SECRET" "{{PROOF_ORIGIN}}/api/activity.md?slug=my-activity"
- Responses use xAPI interaction encodings; scores are raw/max plus scaled 0..1.
`;
