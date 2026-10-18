#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  BRIEF_ASSET, GROUP_NAMES, SKILL_DIR, TABLE_ASSET, loadTableRows, tableHeader,
} from "./shared.mjs";

const USAGE = "usage: node scaffold_run.mjs [project-dir] --app-url <url> [--run-id <id>] [--out <dir>] [--force]";

function parseArgs(argv) {
  const opts = { projectDir: process.cwd(), appUrl: null, runId: null, out: null, force: false };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--app-url") opts.appUrl = argv[++i];
    else if (arg === "--run-id") opts.runId = argv[++i];
    else if (arg === "--out") opts.out = argv[++i];
    else if (arg === "--force") opts.force = true;
    else if (arg === "--help" || arg === "-h") { console.log(USAGE); process.exit(0); }
    else if (arg.startsWith("--")) fail(`unknown option ${arg}\n${USAGE}`);
    else positional.push(arg);
  }
  if (positional.length > 1) fail(`expected one project directory\n${USAGE}`);
  if (positional.length === 1) opts.projectDir = path.resolve(positional[0]);
  return opts;
}

function fail(message) {
  console.log(`ERROR: ${message}`);
  process.exit(2);
}

function defaultRunId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function isLocalTarget(url) {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  return (
    host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1"
    || host.startsWith("127.") || host.endsWith(".test") || host.endsWith(".localhost")
    || host.endsWith(".local") || host.endsWith(".invalid")
  );
}

function ensureGitignore(projectDir, marker) {
  let root = projectDir;
  while (!existsSync(path.join(root, ".git")) && path.dirname(root) !== root) root = path.dirname(root);
  const hasGit = existsSync(path.join(root, ".git"));
  const target = hasGit ? root : projectDir;
  const file = path.join(target, ".gitignore");
  const patterns = [`${marker}*/.env`, `${marker}*/captures/`];
  const base = `${marker}`;
  if (!existsSync(file)) {
    writeFileSync(file, `# ${base} run artifacts\n${patterns.join("\n")}\n`, "utf8");
    return { file, added: patterns, created: true, note: hasGit ? "" : " (no .git found; written next to the project directory)" };
  }
  const existing = new Set(readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()));
  const missing = patterns.filter((p) => !existing.has(p));
  if (missing.length > 0) {
    const prefix = existing.size === 0 ? "" : "\n";
    writeFileSync(file, readFileSync(file, "utf8") + `${prefix}# ${base} run artifacts\n${missing.join("\n")}\n`, "utf8");
  }
  return { file, added: missing, created: false, note: "" };
}

function gateTemplate(opts, remoteWarning) {
  return `# Gate

Write an answer for every line before any request goes out. See \`references/guardrails.md\` in the skill directory: ${SKILL_DIR}

verdict: PENDING

Target: ${opts.appUrl}
Server process and how it was started:
Connection string or env file that this server actually loads:
Cloud project, bucket, queue, or webhook namespace used by this target:
${remoteWarning}
## The nine gates

1. Ownership or authorization to test:
2. Exact base URL and port:
3. Production wiring (does this target reach production data?):
4. Shared backend state across branches or environments:
5. External side effects (mail, SMS, WhatsApp, chat, charges, CRM or ATS writes, third-party webhooks):
6. Payment mode, and how it was confirmed from the key or dashboard:
7. Real user rows present? Which disposable database is used instead:
8. Conditional features: does the app fetch user-supplied URLs (S11)? Does an AI feature ingest text (S14)?
9. Approval boundaries: no plugin install, dashboard change, external delete, commit, or push without user approval.

## Scenario plan

Mark each id pass-candidate or \`not-applicable\` with the reason before dispatch.

| group | scenarios | request budget | max concurrent |
|---|---|---|---|
| 1 | S01-S04 | | 1 |
| 2 | S05-S09 | | 5 |
| 3 | S10-S14 | | 5 |

## Account inventory

List every account and synthetic row created, per group, so cleanup can be reconciled against this table.
`;
}

function envTemplate(opts) {
  const lines = [`# Synthetic test accounts only. Never a real credential, never committed.`, `APP_URL=${opts.appUrl}`, ""];
  for (const g of [1, 2, 3]) {
    lines.push(`G${g}_A_EMAIL=g${g}a@test.invalid`, `G${g}_A_PASSWORD=replace-me-g${g}a`);
    lines.push(`G${g}_B_EMAIL=g${g}b@test.invalid`, `G${g}_B_PASSWORD=replace-me-g${g}b`);
    lines.push(`G${g}_ADMIN_EMAIL=g${g}admin@test.invalid`, `G${g}_ADMIN_PASSWORD=replace-me-g${g}admin`, "");
  }
  lines.push("MOCK_SERVER_URL=http://127.0.0.1:8099");
  return lines.join("\n") + "\n";
}

function reportTemplate(rows) {
  const body = rows
    .map((r) => `| \`${r.id}\` | ${r.scenario} | | | | | |`)
    .join("\n");
  return `# Before and after

Ship posture: pending

Final posture is \`HOLD\` while any \`fail\` remains against another user's data, money, or role boundaries. Otherwise \`ready\`, scoped to what was actually tested. Never call the app secure.

| id | scenario | initial verdict | fix | falsified | final verdict | regression test |
|---|---|---|---|---|---|---|
${body}

## Finding records

One row per scenario that ever failed, using the shared five-field record so the other pre-ship skills can cross-reference it by id instead of copying this verdict: \`finding-id\` (\`REDTEAM-<Sxx>\`), \`route\`, \`evidence-ref\`, \`severity\`, \`remediation\`.

## Not proven and not applicable

Name every scenario that did not run, and why.

## Residual risks and limitations

## Rerun

Where the regression suite lives and the exact command that runs it.
`;
}

function briefTemplate(group, rows, opts, runDir) {
  const template = readFileSync(BRIEF_ASSET, "utf8");
  const attackList = rows
    .map((r) => `- \`${r.id}\` - ${r.scenario.replace(/^S\d+\s*/, "")}`)
    .join("\n");
  return template
    .replaceAll("__GROUP__", String(group))
    .replaceAll("__GROUP_NAME__", GROUP_NAMES[group])
    .replaceAll("__APP_URL__", opts.appUrl)
    .replaceAll("__ACCOUNT_PREFIX__", `g${group}`)
    .replaceAll("__RUN_DIR__", runDir.split(path.sep).join("/"))
    .replaceAll("__ATTACK_LIST__", attackList)
    .replaceAll("__ATTACKS_REF__", path.join(SKILL_DIR, "references", "attacks.md").split(path.sep).join("/"));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.appUrl) fail(`--app-url is required\n${USAGE}`);
  let normalized = opts.appUrl;
  if (!/^https?:\/\//i.test(normalized)) normalized = `http://${normalized}`;
  try {
    opts.appUrl = new URL(normalized).toString().replace(/\/$/, "");
  } catch {
    fail(`--app-url is not a valid URL: ${opts.appUrl}`);
  }
  if (!existsSync(opts.projectDir)) fail(`project directory not found: ${opts.projectDir}`);

  const marker = ".pre-ship-red-team/";
  const outRoot = opts.out ? path.resolve(opts.out) : path.join(opts.projectDir, marker.replace(/\/$/, ""));
  opts.runId = opts.runId || defaultRunId();
  const runDir = path.join(outRoot, opts.runId);
  if (existsSync(runDir) && !opts.force) fail(`run directory already exists: ${runDir} (pass --force to overwrite)`);

  const rows = loadTableRows();
  mkdirSync(runDir, { recursive: true });
  mkdirSync(path.join(runDir, "results"), { recursive: true });
  mkdirSync(path.join(runDir, "briefs"), { recursive: true });
  for (const g of [1, 2, 3]) mkdirSync(path.join(runDir, "captures", `group-${g}`), { recursive: true });

  const remoteWarning = isLocalTarget(opts.appUrl)
    ? ""
    : `\nREMOTE TARGET: ${opts.appUrl} is not an obviously local host. Prove gate 3 and gate 4 before dispatch, or point this run at a local environment. Do not run active tests against a target that shares production data.\n`;

  const writes = [
    ["gate.md", gateTemplate(opts, remoteWarning)],
    [".env.example", envTemplate(opts)],
    ["report.md", reportTemplate(rows)],
  ];
  for (const g of [1, 2, 3]) {
    const groupRows = rows.filter((r) => r.group === g);
    writes.push([
      path.join("results", `group-${g}.md`),
      `# Group ${g} - ${GROUP_NAMES[g]}\n\nTarget: ${opts.appUrl}\nAccounts: prefix \`g${g}\` in \`.env\`\nExpected rows: ${groupRows.length}\n\nFill every row before you stop. Do not add or remove rows. See ${path.join(SKILL_DIR, "references", "attacks.md").split(path.sep).join("/")}\n\n${tableHeader()}\n${groupRows.map((r) => r.line).join("\n")}\n`,
    ]);
    writes.push([path.join("briefs", `group-${g}.md`), briefTemplate(g, groupRows, opts, runDir)]);
  }

  for (const [rel, content] of writes) {
    writeFileSync(path.join(runDir, rel), content, "utf8");
    console.log(`created ${path.join(runDir, rel).split(path.sep).join("/")}`);
  }

  const git = ensureGitignore(opts.projectDir, marker);
  if (git.added.length > 0) console.log(`gitignore: ${git.file.split(path.sep).join("/")} +${git.added.length} rule(s)${git.note}`);
  else console.log(`gitignore: rules already present in ${git.file.split(path.sep).join("/")}`);

  console.log("");
  console.log(`run dir: ${runDir.split(path.sep).join("/")}`);
  console.log(`sources: ${TABLE_ASSET.split(path.sep).join("/")}`);
  console.log("next: fill gate.md, get the LOCAL verdict, create the g1/g2/g3 accounts, then dispatch the three briefs.");
  if (remoteWarning) console.log("warning: remote target - see the gate.md REMOTE TARGET block before dispatching.");
}

main();
