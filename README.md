# pre-ship-security-red-team

Run the attacks before your users do. An agent skill for Claude Code, Cursor and Qoder that red-teams a web application **you own**: three subagents, each with its own synthetic User A, User B and Admin accounts, actually execute 14 authorization and abuse checks (IDOR, self-service role escalation, password-reset token reuse, UI-disabled request bypass, quota and free-tier bypass, concurrent quota races, hostile input, open redirects, stored XSS, SSRF, private-response and cache leakage, preview exposure, prompt injection through ingested content), record a request and a response per row, then one agent fixes every failure and reruns with a negative control that proves the test can detect the bug.

## Install

```
npx skills add arm-pz/pre-ship-security-red-team --skill pre-ship-security-red-team
```

Or place the skill folder in your agent's skills directory, for example:

```bash
# Claude Code (project)
mkdir -p .claude/skills/pre-ship-security-red-team && cp -r SKILL.md scripts references assets .claude/skills/pre-ship-security-red-team/
# Qoder (user)
mkdir -p ~/.qoder/skills/pre-ship-security-red-team && cp -r SKILL.md scripts references assets ~/.qoder/skills/pre-ship-security-red-team/
```

The folder needs `SKILL.md` plus `scripts/`, `references/` and `assets/`: the workflow runs two Node scripts (`scaffold_run.mjs`, `check_results.mjs`, Node.js 18 or newer) and reads its row definitions from `assets/results-table.md`.

This repo is also a Claude Code plugin (`.claude-plugin/plugin.json`); it is listed in the `arm-pz/caffeinity-skills` marketplace.

## Ask it things like

- `/pre-ship-security-red-team http://127.0.0.1:3000` — play the bad guy before I ship
- Test whether user A can read or delete user B's data, then fix it and prove the fix
- Check that my free-tier limits and rate limits hold when someone bypasses the UI
- Is my vibe-coded site safe to launch

## How it works

1. **Gate and map** — nine written safety gates, per-scenario applicability, and a `LOCAL` or `PROD-EXPOSED` environment verdict before anything is attacked.
2. **Scaffold** — `node scripts/scaffold_run.mjs <project-dir> --app-url <url>` creates `.pre-ship-red-team/<run-id>/` with `gate.md`, `.env.example`, one brief and one results table per group, capture directories, and a gitignore guard written before the first test credential exists.
3. **Dispatch three attack groups** — identity and authorization runs at high effort; the subagents **test and record only** and never fix, edit application files, or touch accounts.
4. **Consolidate and fix centrally** — ordered by blast radius: cross-user data and self-grantable roles, then server-side enforcement, then quota, spend and one-time tokens, then input, escaping and redirect allowlists.
5. **Negative control and regression tests** — remove the protection in local code, watch the attack succeed, restore it immediately, watch the refusal; add a durable test per finding.
6. **Verify, report, clean up** — `node scripts/check_results.mjs <run-dir> --require-fixes` exits 1 on a missing row, a pass without a captured request and response, a fix without its negative control, or an unmasked credential anywhere in the run directory. Test accounts and fixture data are then deleted, nothing else.

Output is a 14-row before-and-after table (`pass` / `fail` / `not-proven` / `not-applicable`), a ship posture of `HOLD` or `ready`, and a named list of every row that never ran.

## What it will not do

- Test anything you do not own or are not explicitly authorized to test, and nothing outside the approved environment. Payments in test mode only, confirmed from the key itself.
- Treat a production-joined preview as an ordinary target: a non-local `--app-url` is flagged in the written gate, and the checker refuses to certify a report whose gate was never filled in.
- Hammer an endpoint. The concurrent-quota test defaults to five requests; twenty only on your explicit approval for a local-only test.
- Call real cloud metadata services. SSRF uses a local mock server and reserved `.invalid` destinations.
- Commit credentials or raw responses. Passwords stay in an ignored `.env`; tokens and personal data are masked in every artifact.
- Call your app "secure". It reports what ran, what was refused, and what was never proven.
- Commit, push or deploy without your authorization.

## Related skills

This family covers pre-launch checks; each stays in its lane, and a pass in one is not a pass in another:

- [web-preflight](https://github.com/arm-pz/web-preflight) — bounded, passive check for accidental exposure of secrets, source and admin surfaces on a live URL. A preflight `PASS` never means authorization was tested.
- [pre-ship-performance-audit](https://github.com/arm-pz/pre-ship-performance-audit) — four read-only subagent speed audits with measured before/after Lighthouse medians.
- Despite similar names, this project is unrelated to [red-run](https://github.com/blacklanternsecurity/red-run) (an offensive-security toolkit for engagement phases), `tawgroup/vibesec` (an inspection-based pre-deploy audit), and the several "red team" skills that stress arguments or fact-check claims instead of applications.

Findings cross-reference by ID (`REDTEAM-S02`, `PREFLIGHT-01`, `PERF-03`) rather than by merging verdicts; each skill's `SKILL.md` defines the shared five-field record.

## Example output

From a real end-to-end run on 2026-10-18 against a purpose-built disposable app on `127.0.0.1` (a dependency-free Node notes/SaaS fixture, not published; its `README.md` carries the full inventory). Environment gate resolved to `LOCAL`, so every request stayed on loopback against synthetic rows. Three record-only subagents, one per isolated account set, returned this:

| scenario | before | after | falsified |
|---|---|---|---|
| S01 anonymous database or API access | fail CRITICAL - private collection readable with no credentials, using a key the app published itself | pass | yes |
| S02 cross-user object access | fail CRITICAL - read, write and delete on another user's row, on both the API and the HTML route | pass | yes |
| S03 self-service privilege escalation | fail CRITICAL - `PATCH /api/me {"role":"admin"}` persisted and unlocked the admin endpoint | pass | yes |
| S04 password-reset token reuse | fail HIGH - same token accepted three times, never consumed, no expiry, minting unthrottled | pass | yes |
| S05 direct request bypass of UI limits | fail HIGH - unreviewed draft published by POSTing past the disabled button | pass | yes |
| S06 free-tier or quota bypass | fail MEDIUM - one AI surface gated on a client-supplied `x-credits` header | pass | yes |
| S07 concurrent quota race | fail HIGH - 5 concurrent calls accepted against an allowance of 3; only 2 deducted | pass | yes |
| S08 input validation and boundaries | fail MEDIUM - 50k-char, empty, NUL, bidi, wrong-type and non-JSON bodies all stored and read back | pass | yes |
| S09 redirect validation | fail MEDIUM - `//evil` and `/\evil` both cleared a leading-slash test and left the origin | pass | yes |
| S10 stored XSS | fail CRITICAL - body rendered raw, `alert()` dialog fired in a browser as a second user | pass | yes |
| S11 SSRF | fail CRITICAL - internal loopback service fetched and its body reflected back to the caller | pass | yes |
| S12 private response and cache isolation | fail CRITICAL - per-user profile marked `public, max-age=600` with no `Vary` | pass | yes |
| S13 preview deployment access | pass - route required its token at baseline | pass | n/a |
| S14 prompt injection through ingested content | fail CRITICAL - a `SYSTEM:` line in an uploaded document made the tool return another user's records | pass | yes |

Every row carries the method used, the request, the response and the severity in `results/group-<n>.md`, and `check_results.mjs` refuses the run until each row is filled, evidenced and masked (`--require-fixes` additionally blocks any surviving `fail`).

The fixes were then proved twice rather than asserted: the committed rerun suite returns 14 REFUSED / 0 DETECTED, and a mutation harness deletes one protection at a time on a throwaway copy of the server and requires the mapped check to flip back to DETECTED - 17 of 17 protections falsified. That second run is what makes the first one meaningful; a suite that only ever passes cannot tell you whether it can see dirt.

Read the table with its limits, which the run records in `report.md`: it shows what the rig planted, not what an average app contains; six controls in the rig held at baseline, so 13-of-14 is a fixture property; the S12 proof is header-level because no shared cache sits in front of a loopback server; the browser dialog proof exists for the before state only; and the hosting-platform preview class (Vercel, Netlify, Cloudflare) was never reachable from a local run.

Also verified, independently of the app: the scaffold and checker are tested against 11 fixture outcomes (unfilled rows, code-only passes, legitimate `not-applicable` rows, open fails allowed pre-fix and blocked with `--require-fixes`, fixes without a negative control, an unmasked JWT planted in a capture), all passing.

## License

MIT © 2026 Abdul Rahman P Z
