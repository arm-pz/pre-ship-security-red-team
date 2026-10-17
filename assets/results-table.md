# Results

`verdict` is one of `pass`, `fail`, `not-proven`, `not-applicable`, or `unrun` (the scaffolded default - a row left `unrun` fails `scripts/check_results.mjs`). `executed` is `yes`, `no`, `code-only`, or `blocked`; only `yes` counts as evidence. `falsified` is `yes`, `not-safe`, or `-`: `yes` means the fix was shown to fail with the protection temporarily removed and to hold when restored. Put `<code>` spans in cells and mask every token, cookie, and password.

<!-- rows: one data row per scenario; the first cell is the attack id used by scripts/check_results.mjs -->

| id | scenario | verdict | executed | method | request | response | severity | fix | falsified | after | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `anonymous-data-access` | S01 Anonymous database or API access | unrun | no | | | | - | | - | | |
| `idor-cross-user` | S02 Cross-user object access (IDOR/BOLA) | unrun | no | | | | - | | - | | |
| `role-escalation` | S03 Self-service privilege escalation | unrun | no | | | | - | | - | | |
| `reset-token-reuse` | S04 Password-reset token reuse | unrun | no | | | | - | | - | | |
| `direct-request-bypass` | S05 Direct request bypass of UI limits | unrun | no | | | | - | | - | | |
| `quota-bypass` | S06 Free-tier or quota bypass | unrun | no | | | | - | | - | | |
| `concurrent-quota-race` | S07 Concurrent quota race | unrun | no | | | | - | | - | | |
| `boundary-input` | S08 Input validation and boundary values | unrun | no | | | | - | | - | | |
| `open-redirect` | S09 Redirect validation | unrun | no | | | | - | | - | | |
| `stored-xss` | S10 Stored or reflected XSS | unrun | no | | | | - | | - | | |
| `ssrf` | S11 SSRF in URL-fetching features (conditional) | unrun | no | | | | - | | - | | |
| `private-response-leak` | S12 Private response and cache isolation | unrun | no | | | | - | | - | | |
| `preview-exposure` | S13 Preview deployment access | unrun | no | | | | - | | - | | |
| `prompt-injection` | S14 Prompt injection through ingested content (conditional) | unrun | no | | | | - | | - | | |
