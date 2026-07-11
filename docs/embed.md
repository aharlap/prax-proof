# Embedding Proof in a page

Proof tracks learning results with one script tag and four calls. This works
in hand-written pages, AI-generated pages (Claude, GPT, Gemini Stitch), and
anything that can run a script tag.

## Quick start

1. Mint a key on your instance: `POST /admin/keys` (see README).
2. Add the script tag and the calls — or paste your instance's `/llms.txt`
   into your AI builder's prompt and let it wire things up.

```html
<script src="https://YOUR-INSTANCE/p.js"
        data-activity="fractions-quiz"
        data-name="Fractions Quiz"
        data-key="KEY_ID:KEY_SECRET"
        data-identity="anonymous"
        data-tracking="notice"></script>
<script>
  proof.start();
  proof.step("section-2", "Section 2 — Practice");
  proof.answer("q1", { response: "B", correct: true });
  proof.finish({ score: 8, max: 10 });
</script>
```

`data-name` is an optional human title shown on the dashboard. `proof.step(id, label?)`
accepts an optional label for the dashboard funnel. The snippet derives page
location as origin + path only, never query strings or hashes. The server omits
page location from anonymous and token-mode storage; named mode can retain the
sanitized path so the dashboard can link to the live page.

Show a visible learner notice linking to the instance's `/privacy` page before
calling `proof.start()` or any other tracking method. Your instance's
`/llms.txt` contains current notice/consent instructions for AI builders.

## What Proof can — and can't — tell you

In plain language, so you can decide if it fits before wiring anything up.

**Proof can tell you:**

- how many distinct participant records sent any event, how many start events
  were recorded, and how many participants finished
- scores and pass/fail, when the activity reports them
- what each learner answered on each question
- which participants reached each step and which had no later recorded step
- which page the activity lives on, and when the activity happened

**Proof can't tell you:**

- who a learner *really* is — identity is honor-system (anonymous devices,
  self-entered names, or links you hand out); it is evidence, not verification
- what one learner did across different devices (anonymous identity is
  per-browser)
- anything inside the content it can't see — e.g. seconds of video watched —
  unless the content reports it as an event
- what someone wrote in a free-text or essay answer's *quality* — Proof
  records responses, it doesn't grade them
- Proof also doesn't *run* content: it can't resume/bookmark a learner's
  place, deliver courses, or play SCORM packages. It observes; it is not
  an LMS.

## Identity modes (`data-identity`)

| Mode | Learner experience | Dashboard shows |
|------|--------------------|-----------------|
| `anonymous` (default) | nothing | a pseudonymous browser row; the server discards actor names, nested identity metadata, attachments, unsupported extensions, and page location, then irreversibly pseudonymizes the actor identifier |
| `ask` | a name prompt on the first tracked event | the entered name for the current browser session |
| `token` | nothing; identity rides `?plearner=TOKEN` links | one row per opaque token; Proof removes the parameter from the visible URL after reading it |

Token values must be 16-128 characters using letters, digits, `_`, or `-`.
Generate random, unguessable values. Never put a name, email, student number,
or other direct identifier in the URL. An invalid or missing token falls back
to an anonymous pseudonymous browser identifier.

The browser identifier is namespaced to the Proof instance and activity and
expires after one year. It is created lazily on the first enabled event, not
when the script loads. `proof.resetIdentity()` clears it. Shared-device users
should be given a visible way to reset it between learners.

## Notice and consent modes

`data-tracking="notice"` enables calls immediately; show the notice before the
first call. `data-tracking="consent"` makes calls and H5P events no-ops until
the learner opts in and your page calls `proof.enable()`.

```js
proof.enable();       // after opt-in
proof.disable();      // stop future tracking
proof.isEnabled();    // current state
proof.resetIdentity();
```

Do not call `proof.start()` before rendering the notice. For consent mode,
offer an equally usable "Continue without tracking" path.

## Track H5P content

If the page already hosts H5P content, add `data-h5p` to the same Proof script
tag. No `proof.start()` or other calls are needed for the H5P activity.

```html
<script src="https://YOUR-INSTANCE/p.js"
        data-activity="fractions-h5p"
        data-name="Fractions H5P"
        data-key="KEY_ID:KEY_SECRET"
        data-h5p></script>
```

Proof tracks H5P starts, completions, pass/fail, scores, and per-question
answers with H5P's own question titles. Per-interaction noise is deliberately
not forwarded.

Limitation: H5P only exposes events to the page hosting it. Per H5P's docs,
"You can't embed H5P from an external site and use JavaScript on your own site
to track what the learner does." `data-h5p` works where the H5P content and the
page are on the same site, such as WordPress/Drupal plugins, h5p-standalone, or
Lumi HTML exports. It does not work for h5p.org cross-site iframe embeds.

## About the embedded key

The `data-key` value is visible to anyone who views your page source. That
is by design, and it is *more* protection than the web-analytics norm:
Plausible and Umami snippets carry no credential at all — just a public
site identifier — and their ingest endpoints accept events from anyone who
knows it. Proof requires the key, ingest keys are write-only by construction
(reading results requires a separate read key; see docs/api.md), and every key
is activity-scoped by default, revocable, attributable, daily-capped, and
rate-limited. Configure the key's allowed origin for browser embeds. The
worst an exposed key allows is junk data, never reading results. Rotate a
key by minting a new one and updating the page, then revoke the old key.

## Privacy and operator responsibilities

Proof is privacy-aware infrastructure, not a compliance certification. The
operator decides the purpose and legal basis for collection and remains
responsible for notices, consent where required, data minimization, retention,
access controls, incident response, processor/vendor assessment, and learner
access/correction/export/deletion requests.

Names, email addresses, student numbers, and linkable tokens can make records
identifiable. Use anonymous mode unless identifiable information is necessary
for the learning purpose. Configure the operator/contact/retention/region copy
on `/dashboard/settings`, and test the authenticated learner export and delete
controls before publication.

Anonymous mode pseudonymizes the actor and filters unsupported metadata; it
does not make the learning content itself anonymous. A free-text response can
still contain a name, email address, health detail, or other identifier. Do not
ask for identifying responses unless they are necessary, disclosed, and covered
by the operator's data practice.

Laws vary by operator and learner location. Relevant starting points include
the official [PIPEDA guidance from the Office of the Privacy Commissioner of Canada](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/),
[Quebec Commission d'accès à l'information Law 25 resources](https://www.cai.gouv.qc.ca/protection-renseignements-personnels/sujets-dinteret/loi-25),
and the [European Commission overview of EU data protection](https://commission.europa.eu/law/law-topic/data-protection/data-protection-eu_en).
Get qualified advice for the actual context; do not tell learners that using
Proof itself makes an activity compliant.

## Failure behavior

The snippet never breaks the host page. If configuration is missing or the
network fails, calls become no-ops that log a `[proof]` warning to the
console.
