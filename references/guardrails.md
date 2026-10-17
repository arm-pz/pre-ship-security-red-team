# Guardrails

Nothing here may touch a real user, real money, or a production datastore. Read this before dispatching and write the answers into `gate.md`.

## The nine gates - answer in writing before any request goes out

1. **Ownership.** The user owns the app or holds explicit authorization to test it. Name what you are allowed to hit.
2. **Target.** Exact base URL and port. Local dev server or isolated preview, not production.
3. **Production wiring.** Which connection string or env file does that server actually load? Follow it: `.env`, `.dev.vars`, `wrangler.toml`, docker-compose, a cloud project id, a migration target. A preview that shares the production database **is** production.
4. **Shared backend state.** Serverless and hosted platforms commonly reuse one project, bucket, queue, or webhook across every branch. Verify the preview points at a separate instance or namespace.
5. **External side effects.** Does any endpoint send mail, SMS, WhatsApp or chat messages, charge cards, write to a CRM or ATS, or fire a third-party webhook? Disable it locally or exclude that scenario and list the exclusion.
6. **Payments.** Test-mode keys only, and confirm the mode from the key prefix or the provider dashboard, not from the filename. Unconfirmable means skip payment scenarios and say so.
7. **Real rows.** Does the connected database contain real user data? If it cannot be restored to a snapshot, use a local seeded disposable database instead.
8. **Conditional features.** Does the app fetch user-supplied URLs (S11) or have an AI feature that ingests text (S14)? Absent means `not-applicable` for that reason, not silence.
9. **Approval boundaries.** No plugin installs, no dashboard or configuration changes, no external deletions, no commits or pushes without the user's approval. Give them the steps.

**Verdict:** `LOCAL` (run everything) or `PROD-EXPOSED` (local only, plus the list of scenarios never run against the exposed preview). Do not attack a live URL to work around a failed gate. If any answer is unknown, ask.

## Isolation

- Accounts: User A, User B, Admin, with one **separate set per group** so two subagents never write the same rows.
- Prefix per group so cleanup is mechanical: `g1a@test.invalid`, `g1b@test.invalid`, `g1admin@test.invalid`, and so on.
- The chair creates and deletes accounts. Subagents never create, promote, or delete them.
- Data is synthetic and obviously fake, never a copy of production rows.
- One browser context per group. Never reuse a session in which the user is logged in - if the user's own account appears in an agent's tab, stop and re-isolate.

## Request discipline

- Load only the target origin and localhost. No third-party hosts, no other domains, no port scanning beyond the app's own origin.
- Small bounded batches. S07 defaults to a maximum of 5 concurrent requests; 20 only with explicit user approval for a local-only test.
- Back off on 429 or 503 and reduce the batch. Stop the run on instability, unexpected data exposure, or any sign of production connectivity.
- Stay inside the per-group request budget recorded in `gate.md`.

## Redirect and SSRF destinations

Use reserved `.invalid` and `.test` hosts and a local mock server. Never navigate a browser or the app to a real attacker-controlled site, and never call real cloud metadata endpoints.

## Credentials and masking

- Test passwords, cookies, and keys live in the run directory's `.env`, git-ignored before the first write, or an approved secret store.
- Never print, commit, or paste a live token. Mask with the first 7 and last 4 characters plus `.maskme`.
- Mask personal data too, not only secrets.
- `scripts/check_results.mjs` gates on this because captures leak. Run it before reporting, not after.

## Negative control

- Toggle a protection off **only** in local application code, for one bounded test against synthetic data, restored immediately, then verified that the protected version refuses the same test.
- Never toggle in a shared environment, production, the database, or a hosting dashboard.
- When the toggle is not safe, record `falsified: not-safe` with the reason. That is a legitimate result; a claimed proof is not.
- After the loop, grep the diff for the removed check, `skipAuth`, `DISABLE_`, and any literal password, and confirm the protection-on test still passes after revert.

## Cleanup

- Delete test accounts and data from the disposable environment only. Keep the minimum set the regression suite needs.
- Reconcile the deletion list against the preflight inventory before deleting anything. Never delete real users or real records; when unsure, leave it and report it as leftover.
- Leave the scenario scripts in `tests/security/` plus a short rerun runbook, so the next launch reruns them instead of reinventing them.
