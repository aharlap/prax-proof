// SPDX-License-Identifier: MIT
// Served at /llms.txt — instructions for AI tools adding Proof tracking to a page.
export const LLMS_TXT = `# Proof — add learning results tracking to this page

Proof is a self-hosted results tracker. Add ONE script tag, then call four
functions. Do not add any other tracking code, SDK, or xAPI library.

## 1. Script tag (before your closing </body>)

<script src="{{PROOF_ORIGIN}}/p.js"
        data-activity="my-activity-slug"
        data-key="KEY_ID:KEY_SECRET"
        data-identity="ask"></script>

- data-activity: short stable slug for this activity (kebab-case).
- data-key: the ingest key the instance owner minted (POST /admin/keys).
- data-identity: "anonymous" (no names), "ask" (prompt for a name once),
  or "token" (identity read from a ?plearner=... link parameter).

## 2. The four calls

proof.start();                                        // when the activity begins
proof.step("section-2");                              // each section/page reached
proof.answer("q1", { response: "B", correct: true }); // each question answered
proof.finish({ score: 8, max: 10 });                  // when the activity ends

Rules:
- Call start() once, as soon as your activity is ready.
- Call step(id) with a short stable id every time the learner reaches a new
  section — this powers the drop-off funnel.
- Call answer(questionId, { response, correct }) on each answered question.
- Call finish({ score, max }) exactly once at the end. Omit the score object
  if the activity is not scored: proof.finish().
- All calls are fire-and-forget and never throw; no await needed.

## Advanced: sending raw xAPI instead

POST {{PROOF_ORIGIN}}/xapi/statements with HTTP Basic auth (key id:secret),
header X-Experience-API-Version: 1.0.3, and an xAPI 1.0.3 statement body.
Proof implements the Statements resource only (no document APIs, voiding,
or attachments) and is not a conformant LRS.
`;
