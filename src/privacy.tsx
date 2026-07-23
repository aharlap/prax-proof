// SPDX-License-Identifier: MIT
import type { Context } from "hono";
import type { Env } from "./env";
import { D1Storage } from "./storage/d1";
import type { InstanceSettings } from "./storage/types";

function PrivacyPage(props: { settings: InstanceSettings }) {
  const operator = props.settings.operatorName || "This Proof instance's operator";
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="/dashboard.css" />
        <title>Learning tracking and privacy · Proof</title>
      </head>
      <body>
        <a class="prax-skip" href="#main">Skip to content</a>
        <main id="main" tabindex={-1}>
          <h1>Learning tracking and privacy</h1>
          <p>
            {operator} uses this Proof instance to record participation and results for learning activities.
            Proof is self-hosted; this instance's operator controls the data and decides why it is collected.
          </p>
          <h2>What may be recorded</h2>
          <p>
            Events can include activity starts, sections reached, answers, completion, scores, duration,
            and a pseudonymous learner identifier. Named mode may also retain the activity page path. A name or externally assigned
            token is recorded only when the activity operator has explicitly configured that identity mode.
          </p>
          <h2>Storage and retention</h2>
          <p>
            This instance is configured for a {String(props.settings.retentionDays)}-day statement retention period.
            An hourly cleanup process deletes statements after that cutoff and drains large backlogs in bounded batches. {props.settings.regionLabel
              ? `The operator describes the hosting region as ${props.settings.regionLabel}.`
              : "Ask the operator where this instance is hosted if location matters to you."}
          </p>
          <h2>Your choices and requests</h2>
          <p>
            You can stop future browser tracking through the controls supplied with the activity and reset
            its pseudonymous browser identifier. To request access, correction, export, or deletion of
            retained data, contact the activity operator{props.settings.privacyContact
              ? ` at ${props.settings.privacyContact}`
              : " using the contact information supplied with the activity"}.
          </p>
          {props.settings.privacyUrl ? (
            <p><a href={props.settings.privacyUrl} rel="noopener">Operator's full privacy policy</a></p>
          ) : null}
          <p class="prax-soft">
            This notice describes Proof's technical behavior. The operator remains responsible for an
            appropriate legal basis, notices, consent where required, data minimization, safeguards, and
            responding to privacy rights under the laws that apply to the activity and its learners.
          </p>
          <p><a href="/">Back to Proof</a></p>
        </main>
      </body>
    </html>
  );
}

export async function privacyHandler(c: Context<{ Bindings: Env }>) {
  const settings = await new D1Storage(c.env.DB).getSettings();
  return c.html(<PrivacyPage settings={settings} />, 200, { "Cache-Control": "no-store" });
}
