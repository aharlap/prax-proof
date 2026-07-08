// SPDX-License-Identifier: MIT
// Fixture statements modeled on each client's documented emission shape.
// When a live capture replaces a modeled fixture, note the source URL and
// capture date in the comment above it.

/** H5P multiple-choice "answered" — modeled on H5P's xAPI documentation. */
export const h5pAnswered = {
  actor: {
    name: "Amara O.",
    mbox: "mailto:amara@example.org",
    objectType: "Agent" as const,
  },
  verb: {
    id: "http://adlnet.gov/expapi/verbs/answered",
    display: { "en-US": "answered" },
  },
  object: {
    id: "https://school.example/h5p/12?subContentId=abc-123",
    objectType: "Activity" as const,
    definition: {
      extensions: { "http://h5p.org/x-api/h5p-local-content-id": 12 },
      name: { "en-US": "Fractions check" },
      interactionType: "choice",
      type: "http://adlnet.gov/expapi/activities/cmi.interaction",
      choices: [
        { id: "0", description: { "en-US": "1/2" } },
        { id: "1", description: { "en-US": "2/3" } },
      ],
      correctResponsesPattern: ["1"],
    },
  },
  result: {
    score: { min: 0, max: 1, raw: 1, scaled: 1 },
    completion: true,
    success: true,
    duration: "PT6.33S",
    response: "1",
  },
};

/** H5P module "attempted" main content — modeled on H5P's xAPI documentation. */
export const h5pAttemptedMain = {
  actor: {
    name: "Amara O.",
    mbox: "mailto:amara@example.org",
    objectType: "Agent" as const,
  },
  verb: {
    id: "http://adlnet.gov/expapi/verbs/attempted",
    display: { "en-US": "attempted" },
  },
  object: {
    id: "https://school.example/h5p/12",
    objectType: "Activity" as const,
    definition: {
      name: { "en-US": "Fractions check" },
      type: "http://adlnet.gov/expapi/activities/module",
    },
  },
};

/** H5P module "attempted" subcontent — modeled on H5P's xAPI documentation. */
export const h5pAttemptedSub = {
  actor: {
    name: "Amara O.",
    mbox: "mailto:amara@example.org",
    objectType: "Agent" as const,
  },
  verb: {
    id: "http://adlnet.gov/expapi/verbs/attempted",
    display: { "en-US": "attempted" },
  },
  object: {
    id: "https://school.example/h5p/12?subContentId=abc-123",
    objectType: "Activity" as const,
    definition: {
      name: { "en-US": "Fractions check" },
      type: "http://adlnet.gov/expapi/activities/module",
    },
  },
};

/** H5P module "completed" main content — modeled on H5P's xAPI documentation. */
export const h5pCompletedMain = {
  actor: {
    name: "Amara O.",
    mbox: "mailto:amara@example.org",
    objectType: "Agent" as const,
  },
  verb: {
    id: "http://adlnet.gov/expapi/verbs/completed",
    display: { "en-US": "completed" },
  },
  object: {
    id: "https://school.example/h5p/12",
    objectType: "Activity" as const,
    definition: {
      name: { "en-US": "Fractions check" },
      type: "http://adlnet.gov/expapi/activities/module",
    },
  },
  result: {
    score: { raw: 8, min: 0, max: 10, scaled: 0.8 },
    completion: true,
    success: true,
    duration: "PT2M10S",
  },
};

/** TinCanJS "experienced" — minimal statement TinCanJS sends. */
export const tincanExperienced = {
  actor: { mbox: "mailto:ben@example.org", name: "Ben T" },
  verb: { id: "http://adlnet.gov/expapi/verbs/experienced", display: { und: "experienced" } },
  object: { id: "https://school.example/pages/intro" },
  id: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
};

/** ADL xAPIWrapper "attempted" with account actor and registration. */
export const xapiwrapperAttempted = {
  actor: { account: { homePage: "https://lms.example", name: "student.42" }, name: "Student 42" },
  verb: { id: "http://adlnet.gov/expapi/verbs/attempted", display: { "en-US": "attempted" } },
  object: {
    id: "https://school.example/courses/geo-101",
    definition: { name: { "en-US": "Geography 101" } },
  },
  context: { registration: "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb" },
  timestamp: "2026-07-01T15:03:22.000Z",
};

/** Planned @praxity/scorm facade "completed" with resume state in extensions. */
export const praxCompleted = {
  actor: { account: { homePage: "https://proof.example", name: "token-7f3a" } },
  verb: { id: "http://adlnet.gov/expapi/verbs/completed", display: { en: "completed" } },
  object: {
    id: "https://praxity.io/a/compare-demo",
    definition: { name: { en: "Compare demo" } },
  },
  result: {
    score: { raw: 9, min: 0, max: 10, scaled: 0.9 },
    completion: true,
    success: true,
    duration: "PT3M10S",
    extensions: { "https://praxity.io/xapi/ext/resume-state": { slide: 4 } },
  },
  timestamp: "2026-07-02T09:30:00.000Z",
};

export const allFixtures = [h5pAnswered, tincanExperienced, xapiwrapperAttempted, praxCompleted];
