---
name: pre-ship-security-red-team
description: Authorized, evidence-driven security red-team pass over a web app you own before launch, run by three parallel read-only subagents with synthetic test accounts. Covers anonymous data access, IDOR cross-user object access, self-service role escalation, password-reset token reuse, UI-disabled request bypass, quota and free-tier bypass, concurrent quota races, hostile form input, open redirects, stored XSS, SSRF in URL-fetching features, private-response and cache isolation, preview deployment exposure, and prompt injection through ingested AI content. Then fixes each failure, reruns with a negative control and emits a before/after verdict table. Use when someone says "play the bad guy before we ship", "red team my site", "test my auth and rate limits", "is my vibe-coded site safe to launch", or after adding login, roles, credits, uploads, or AI ingestion. Local or isolated environments only. Not for production, or for a passive exposure check (use web-preflight).
argument-hint: <local app URL> [project path]
---

# Pre-Ship Security Red Team

Act as the adversarial reviewer of an application the user owns: execute the applicable attacks against an isolated environment, record reproducible evidence, fix what failed, and rerun.

Code inspection is never proof that a control works. An unexecuted test is `not-proven`, not `pass`.

`<skill-dir>` is this skill's directory. The chair is the agent running this skill.

## Roles

- **Chair:** gates the environment, scaffolds the run, dispatches the groups, consolidates duplicate findings, makes every fix, adds regression tests, reruns, reports, cleans up.
- **Subagents:** one per attack group. **Test and record only.** They do not fix code, edit application files, change shared configuration, create or delete accounts, or alter data outside their own fixtures.
- If subagents are unavailable, run the three groups sequentially with the same briefs and the same rows.

Medium effort by default. **High effort for group 1** (identity and authorization) - those failures expose or destroy another user's data. If model selection is not exposed in this runtime, record that the session model was inherited.

## Hard safety gates

Do not attack anything until each is verified in writing. Ask rather than guess. Full detail in `references/guardrails.md`.

1. The user owns the app or is explicitly authorized to test it.
2. The exact target environment and base URL are known.
3. The preview or staging environment is **not** joined to production data. If it is, do not run active tests there - switch to a local environment with a disposable test database.
4. Synthetic data and dedicated accounts only: User A, User B, Admin, one isolated set per group.
5. No third-party systems, no real users, no real payment flows, nothing outside approved scope. Payments in test mode only, confirmed from the key itself.
6. Bounded request rates and small batches. Stop on instability, unexpected exposure, or any sign of production connectivity.
7. Credentials in an ignored `.env` or an approved secret store. Secrets and personal data masked in every artifact.
8. Protections are toggled off only in local application code, for one bounded negative control, restored immediately. Never in a shared environment, production, a database, or a hosting dashboard.
9. No plugin installs, dashboard or configuration changes, external deletions, commits, or pushes without the user's approval. Hand the user the steps instead.

If a gate cannot be verified, stop active testing and say what must be clarified or isolated first.

## 1. Gate and map

Inspect the app's architecture, routes, API endpoints, auth and authorization middleware, data model, uploads and imports, caching, AI and tool integrations, and existing test setup. Then write `gate.md`:

- **Verdict `LOCAL`** (run everything) or **`PROD-EXPOSED`** (local only, and name which scenarios were never run against the exposed preview).
- Which of the 14 scenarios apply, and why any is `not-applicable` - for example SSRF when no feature fetches a user-supplied URL.
- The per-group request budget and rate limit.

Never claim a test passed unless it ran and its observed result was recorded.

## 2. Scaffold the run

```
node "<skill-dir>/scripts/scaffold_run.mjs" <project-dir> --app-url <url>
```

Creates `.pre-ship-red-team/<run-id>/` with `gate.md`, `.env.example`, `captures/group-<n>/`, one `results/group-<n>.md` containing that group's rows, `briefs/group-<n>.md` ready to hand a subagent, and `report.md` for the before-and-after table.

Add the run directory's `.env` and `captures/` to `.gitignore` before writing the first credential. A committed test password or a captured session cookie is the most common breach this workflow causes.

## 3. Dispatch three attack groups

Send one message with three `Agent` calls so they run together. Each prompt: its brief file, `references/attacks.md`, the run directory, and its own account prefix.

| Group | Scenarios | IDs |
|---|---|---|
| 1 - identity and authorization (high effort) | S01-S04 | `anonymous-data-access`, `idor-cross-user`, `role-escalation`, `reset-token-reuse` |
| 2 - UI and API bypass, input validation | S05-S09 | `direct-request-bypass`, `quota-bypass`, `concurrent-quota-race`, `boundary-input`, `open-redirect` |
| 3 - browser, network, cache, preview, AI trust boundaries | S10-S14 | `stored-xss`, `ssrf`, `private-response-leak`, `preview-exposure`, `prompt-injection` |

Each subagent returns per row: scenario id, preconditions, safe reproduction steps, method and path plus redacted request, status code and redacted response, expected versus actual behavior, evidence location, and whether it executed. Subagents fill only their own file, so three writers never collide.

## 4. Consolidate, then fix centrally

Merge the three files, dedupe findings that share a root cause, and prioritize by exploitability and impact: affected endpoint, prerequisites, observed impact, minimal reproduction, root cause, fix, regression test.

Fix order: anything that reaches another user's data or makes a role self-grantable first, then server-side enforcement the UI was relying on, then quota and spend accounting and one-time-use tokens, then input handling, escaping, and redirect allowlists. Say when one fix closes several scenarios instead of counting separate fixes per row.

## 5. Negative control, regression tests, rerun

For each fixed scenario, local code only:

1. Temporarily remove the specific protection -> the test must **fail** (prove the test detects the vulnerability).
2. Restore it immediately -> the test must **pass**.
3. Confirm the diff has no leftover disabled guard, bypass flag, or hardcoded credential.

If that toggle is not safe (production connectivity, destructive side effects, exposure beyond synthetic data), mark the negative control `not-proven` and explain why rather than skipping it silently. Record `falsified` as `yes`, `no`, or `not-safe`.

Add a durable automated regression test in the repo for each applicable finding, preferring integration tests against real middleware and the isolated datastore. Then rerun all applicable scenarios and the existing suite.

Do the toggling by deletion, not by hand-typing: copy `assets/negative-control.mjs` next to that suite, list the protections you added and the checks they map to, and let it boot two throwaway copies of the app - one as committed, one with a single protection removed - on its own ports, against copies of the database, in its own log directory. It reports any protection that does not reproduce the attack when deleted, and it refuses to run at all while a guard block has no entry, so a quiet omission cannot masquerade as a clean result. For it to work, write every fix as one deletable block and let the app take its port, data file and log directory from environment variables:

```js
// GUARD note-ownership-api (S02)
if (note.ownerId !== user.email) return notFound();
// END GUARD note-ownership-api
```

A control with two enforcement layers cannot be falsified by deleting one of them. Name both layers as a single entry - that records the redundancy instead of hiding it.

## 6. Verify, report, clean up

```
node "<skill-dir>/scripts/check_results.mjs" <run-dir>                 # before dispatching fixes
node "<skill-dir>/scripts/check_results.mjs" <run-dir> --require-fixes  # after fixes
```

Exit 1 means a row is missing, a verdict has no evidence, a fix lacks its negative control, or an unmasked secret sits in the run directory. Resolve it before reporting.

Report:

- **Ship posture:** `HOLD` while any `fail` remains against another user's data, money, or role boundaries; otherwise `ready`, scoped to what was tested.
- Before-and-after table: initial verdict, fix, regression-test result, final verdict.
- Finding record for every row that ever failed: `REDTEAM-<Sxx>`, route, evidence reference, severity, remediation status.
- Every scenario `not-proven` or `not-applicable`, named, with the reason - including those blocked because the environment would have touched production.
- Where the regression suite lives and how to rerun it.
- Residual risks and limitations.

Never call the app "secure". Report only what was tested and observed.

Then delete test accounts and data from the disposable environment only. Reconcile the deletion list against the preflight inventory; never delete real users or anything outside the test fixtures.

## Verdicts

| Verdict | Meaning |
|---|---|
| `pass` | Executed, and the control held. |
| `fail` | Executed, and the attack succeeded or the control was missing. |
| `not-proven` | Not executed, inconclusive, or only read in code. |
| `not-applicable` | The feature does not exist; the row says why. |

`unrun` is the scaffolded default and always fails the check. Do not add or remove rows.

## Finding record

Other pre-ship workflows cite individual findings, so publish the same five fields for every scenario that once failed. Map them onto the results table instead of duplicating it:

- `finding-id` - `REDTEAM-<Sxx>` (for example `REDTEAM-S02`); stable across reruns.
- `route` - the endpoint, page, component, or surface the row attacked.
- `evidence-ref` - the file under `captures/group-<n>/` plus the results-table row.
- `severity` - the row's CRITICAL/HIGH/MEDIUM/LOW value.
- `remediation` - `open` while the row is `fail`; `fixed-verified` when `falsified` is `yes` and `after` is filled; `fixed-unproven` when the negative control was `not-safe`; `accepted-risk` only when the user chose it.

Scenario verdicts stay in this table. A `pass` here says nothing about exposure checked by `web-preflight` or speed measured by `pre-ship-performance-audit`; cross those by `finding-id`, not by copying a verdict.

## Leftovers from the source methodology

`/plugin install security-guidance@claude-plugins-official` and its automatic post-commit reviews are Claude Code features with **no Qoder equivalent**. Do not claim that review ran. Instead: after each meaningful edit batch, review the diff for security regressions and rerun targeted tests; before any commit or push, review the whole staged diff and run the relevant suite - and get approval to commit at all. A fresh agent with no edit history reviewing the fix diffs against `references/attacks.md` is a reasonable substitute; label it a manual review.

## Traps

- **Predicting a subagent's result.** After dispatch, know nothing; wait for the completion notification.
- **Trusting a returned summary.** Reread the rows and rerun anything that reads as claimed rather than captured.
- **A negative control left disabled.** Disable, attack, restore, re-attack, then grep the diff - in one session, as explicit steps.
- **Patching the UI.** Every group-2 bypass is the server trusting the client; fix server-side.
- **Treating a public client key as the vulnerability.** It is an investigation lead. Verify what the key actually returns.
- **Reporting a partial pass in the headline.** If nine of fourteen ran, say that first.

## Resources

- `references/attacks.md` - S01-S14: preconditions, safe reproduction, expected versus actual, `not-applicable` conditions, severity.
- `references/guardrails.md` - the nine gates, isolation and masking rules, request caps, cleanup.
- `scripts/scaffold_run.mjs` - run directory, per-group result rows, briefs, env template, gitignore guard.
- `scripts/check_results.mjs` - completeness, evidence, negative-control, and credential-leak gate.
- `assets/` - the results table and dispatch brief templates the scaffold renders, plus `negative-control.mjs`, the harness you copy into the app to prove each fix is load-bearing.
