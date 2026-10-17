# Scenarios S01-S14

Per scenario: preconditions, safe reproduction, expected versus actual, when it is `not-applicable`, and severity if it fails. Run against the local or isolated target only, with your group's own accounts. The `id` is the row key in `results/group-<n>.md`.

A public client key is an investigation lead, not a vulnerability. Verify what it actually returns.

---

## Group 1 - Identity and authorization (high effort)

### S01 `anonymous-data-access` - reach private data with no session

Without authenticating, read the app's own public client configuration (bundled key, config endpoint, documented API) and call **only the app's own** discovered endpoints. Check whether records belonging to seeded test users come back.

- **Do not** connect to or query a database directly unless it is a local disposable database and the scenario explicitly covers database exposure.
- **Expected:** empty result or denial on every collection. **Actual to record:** rows returned, which table, how many.
- **not-applicable:** no client-visible key and no reachable app data endpoint - state both.
- **Severity:** CRITICAL when any private row is returned.

### S02 `idor-cross-user` - cross-user object access (IDOR/BOLA)

As User A, take a synthetic object id owned by User B (document, thread, order, file, chat session) and issue the same **read, then update, then delete** request with B's id substituted.

- **Expected:** denied or not-found on all three, and B's data unchanged afterwards. Re-read B's row to prove it.
- **Note:** a 401 that distinguishes "exists" from "not found" is still a refusal here, but record the enumeration leak as a lower-severity note.
- **Severity:** CRITICAL for read or write of another user's data.

### S03 `role-escalation` - self-service privilege escalation

As User A, add privileged fields to a profile or account update - `role: "admin"`, `is_admin: true`, `plan: "enterprise"`, or the app's own flag - through the ordinary account API. Then re-read A's own account and attempt one admin-only action.

- **Expected:** client-controlled privilege fields ignored or rejected; persisted role unchanged; admin action denied.
- **Also check** the flag was not silently written and merely hidden by the UI. Read the stored record, not the response echo.
- **Severity:** CRITICAL.

### S04 `reset-token-reuse` - password-reset token replay

Trigger a reset for a test account, complete it once, then submit the **same token** again through the same endpoint, and once more by POSTing the token directly without the link.

- **Expected:** single-use - the second attempt is expired or invalid and cannot change the password.
- **Also record** whether the reset endpoint itself is rate limited.
- **Severity:** HIGH.

---

## Group 2 - UI and API bypass, input validation

Everything here is the server trusting the client. Evidence is a server response, never a rendered page.

### S05 `direct-request-bypass` - disabled buttons and hidden controls

Find a control the UI hides or disables for this role or state. Skip the page and send the equivalent request directly, same method, path and payload, with A's session.

- **Expected:** server-side authorization or state validation rejects it, independent of what the page rendered.
- **Severity:** HIGH, or CRITICAL when the action touches another user or money.

### S06 `quota-bypass` - exhaust the allowance, then call the API

Use the synthetic account's free uses through the UI until it blocks. Then make **one bounded** direct API request, and optionally one with only the public key.

- **Expected:** the same quota or billing error, checked against the datastore at call time, not a client-held counter. The gated operation must not execute.
- **Severity:** HIGH when it consumes real credit; MEDIUM for sandbox quota.

### S07 `concurrent-quota-race` - parallel spend on a near-empty balance

With a small remaining allowance on a disposable account, send a small bounded concurrent batch: **default maximum 5 requests.** Never 20 unless the user explicitly approves a local-only test and the service can safely support it. Record usage before and after.

- **Expected:** accepted operations never exceed the allowance; the deduction is atomic or transaction-guarded, with idempotency keys where the app has them.
- **Severity:** CRITICAL when real money or real third-party cost moves; HIGH otherwise.
- **Cap:** target endpoint only, back off on 429 or 503, and never escalate the batch.

### S08 `boundary-input` - hostile, empty, and out-of-range values

Into every form: a long string within a bounded size, an empty required field, a negative quantity or amount, zero, `9e99`, `' OR '1'='1`, `"--`, a null byte, an emoji plus a right-to-left mark, HTML, and a JSON body with an unexpected extra field or a wrong type.

- **Expected:** a clear validation error at the boundary, no partial write, no negative balance, no authorization change, safe encoding on read-back.
- **Note:** `200` with a bad value persisted silently is a finding even when nothing crashes. Record what a later read returns.
- **Severity:** MEDIUM, HIGH when the value reaches money or a role.

### S09 `open-redirect` - post-login redirect tampering

Vary the redirect target: an external URL, `//example.invalid`, `/\example.invalid`, `@example.invalid`, `https://app.test@evil.invalid`, a `javascript:` scheme, and a double-encoded path. Use reserved `.invalid` destinations and **inspect the `Location` header** rather than navigating to any real site.

- **Expected:** redirect stays on the app origin or an explicit allowlist; a bare `//` or `/\` never leaves the origin.
- **Severity:** MEDIUM, HIGH when it chains off an authenticated session.

---

## Group 3 - Browser, network, cache, preview, and AI trust boundaries

### S10 `stored-xss` - script execution from stored input

Put a harmless proof payload into a synthetic username, a comment, and any Markdown or rich-text field, then open the rendered page in an isolated browser as a **different** user. Variants: `<img src=x onerror=alert(1)>`, `<svg onload=alert(1)>`, `<script>`, Markdown `[x](javascript:alert(1))`, and a `data:text/html` link.

- **Expected:** escaped or sanitized so nothing executes, and a CSP that blocks inline script.
- **Evidence:** the browser event log or dialog firing, plus the stored raw value and the rendered HTML. Do not exfiltrate cookies or tokens as the proof - a local dialog is enough.
- **Severity:** HIGH, CRITICAL when the payload can act as the victim.

### S11 `ssrf` - server-side request forgery (conditional)

Run only if the app fetches a user-supplied URL: link import, URL preview, image or document fetch, webhook target, avatar-by-URL.

- **Use a local mock server** standing in for a blocked internal destination, plus loopback and private-range addresses. **Do not** call real cloud metadata services, production internals, or third-party infrastructure. Inspect local logs for an actual outbound request.
- **Expected:** scheme and host allowlist, loopback/private/link-local blocked **after DNS resolution**, redirects revalidated, timeouts, egress restrictions, and no log entry for the blocked attempt.
- **not-applicable:** no feature accepts a URL - say which features you checked.
- **Severity:** HIGH, CRITICAL when a response body is returned to the caller.

### S12 `private-response-leak` - another user's page as B or logged out

For pages and API responses A legitimately saw (thread, dashboard, order, export, share URL), request the same address as B in a second browser context, then with no session. Include guessed sequential ids and ids visible in A's payloads.

- **Expected:** denial or an empty result, and **no private content served from a shared cache**. Check cache and CDN response headers on what was returned.
- **Severity:** CRITICAL.

### S13 `preview-exposure` - preview deployment access

Open the app's own preview or branch URLs with the hosting-platform session logged out, from a clean profile. Try enumerable preview slugs. Synthetic deployment, non-sensitive data only; never probe another tenant's deployments or hosting account.

- **Expected:** previews holding private code or data are access-controlled, or contain seed data only.
- **Record:** which platform and which preview class was actually tested.
- **Severity:** MEDIUM, HIGH when real source or data is reachable.

### S14 `prompt-injection` - instructions hidden in ingested content (conditional)

Run only if an AI feature reads uploads, fetched pages, email, documents, or tool output.

Put a synthetic document that claims to be a system or admin message and asks the feature to read another test user's records, dump secrets, or call a tool it should not. Split the instruction across lines, or hide it in HTML or Markdown comments. Synthetic data and tools only.

- **Expected:** ingested text is treated as data; authorization is enforced by the tool layer and server-side checks, not by the model's judgment; no out-of-scope read and no unauthorized tool call.
- **Note:** one successful out-of-scope read is a CRITICAL finding. Failure to trigger it is `pass` only if the feature is genuinely reachable and the injection was delivered.

---

## Recording rules

- One row per scenario id. Do not add or remove rows, and do not merge two scenarios into one - name a shared root cause in `notes` instead.
- `executed` is `yes` only when a request left your client. Use `code-only` when you only read the source, `blocked` when the environment stopped you, `no` when you did not reach the test.
- `pass` and `fail` require `executed: yes` plus non-empty `request` and `response`. Anything else is `not-proven` or `not-applicable`, with the reason in `notes`.
- `severity` is required on every `fail`.
- Mask tokens, cookies, passwords, API keys, and personal data in every cell: keep the first 7 and last 4 characters, insert `.maskme`.
- Save minimal reproducible captures under `captures/group-<n>/` with masked headers and mention the filename in the row. The rerun suite keeps payloads and refusal assertions, never credentials.
