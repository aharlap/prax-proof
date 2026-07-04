// SPDX-License-Identifier: MIT
// Bridge-A-shaped session per docs/block-roadmap.md §2.4 (workspace root).
// Seed for the canonical prax/examples fixtures (§2.8): initialized →
// progressed → answered → passed → completed, one registration throughout.

const ACTOR = {
  account: { homePage: "https://lms.example", name: "learner-77" },
  name: "Lea R.",
};

const V = "http://adlnet.gov/expapi/verbs/";
const EXT = "https://praxity.io/xapi/ext/";

export function bridgeSession(
  activityIri: string,
  registration: string,
): Record<string, unknown>[] {
  const activity = {
    id: activityIri,
    definition: { name: { en: "Fractions check" } },
  };
  const ctx = { registration };
  return [
    {
      actor: ACTOR, verb: { id: `${V}initialized` }, object: activity,
      context: ctx, timestamp: "2026-07-03T14:00:00Z",
    },
    {
      actor: ACTOR, verb: { id: `${V}progressed` }, object: activity,
      result: { extensions: { [`${EXT}percent`]: 40, [`${EXT}step`]: "q:q2" } },
      context: ctx, timestamp: "2026-07-03T14:02:00Z",
    },
    {
      actor: ACTOR, verb: { id: `${V}answered` },
      object: { id: `${activityIri}/q/q1` },
      result: { response: "a", success: true },
      context: {
        registration,
        contextActivities: { parent: [{ id: activityIri }] },
      },
      timestamp: "2026-07-03T14:03:00Z",
    },
    {
      actor: ACTOR, verb: { id: `${V}passed` }, object: activity,
      result: { score: { raw: 8, min: 0, max: 10, scaled: 0.8 }, success: true },
      context: ctx, timestamp: "2026-07-03T14:05:00Z",
    },
    {
      actor: ACTOR, verb: { id: `${V}completed` }, object: activity,
      result: { completion: true, duration: "PT5M12S" },
      context: ctx, timestamp: "2026-07-03T14:05:01Z",
    },
  ];
}
