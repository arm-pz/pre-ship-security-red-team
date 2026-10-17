#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  EXECUTIONS, FALSIFIED, SEVERITIES, VERDICTS, loadTableRows, parseResultFiles,
} from "./shared.mjs";

const USAGE = "usage: node check_results.mjs <run-dir> [--require-fixes]";
const TEXT_EXT = new Set([".md", ".txt", ".json", ".har", ".log", ".csv", ".html", ".yml", ".yaml", ".js", ".mjs"]);
const MAX_BYTES = 512 * 1024;

const SECRET_RULES = [
  ["jwt-like token", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/],
  ["authorization header value", /\bAuthorization\s*[:=]\s*(?:Bearer|Basic|Token)\s+\S/i],
  ["set-cookie value", /\bSet-Cookie\s*[:=]\s*\S/i],
  ["cookie header value", /\bCookie\s*[:=]\s*\S/i],
  ["provider secret key", /\bsk-(?:live|test|ant|proj|lab)[-_][A-Za-z0-9]{6,}/],
  ["cloud or CI token", /\b(?:ghp_|gho_|github_pat_|xox[abprs]-|AKIA)[A-Za-z0-9_-]{8,}/],
  ["assigned credential", /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|session[_-]?token)\s*[:=]\s*\S{6,}/i],
];

function parseArgs(argv) {
  const opts = { runDir: null, requireFixes: false };
  for (const arg of argv) {
    if (arg === "--require-fixes") opts.requireFixes = true;
    else if (arg === "--help" || arg === "-h") { console.log(USAGE); process.exit(0); }
    else if (arg.startsWith("--")) { fail(`unknown option ${arg}\n${USAGE}`); }
    else if (opts.runDir) { fail(`expected one run directory\n${USAGE}`); }
    else opts.runDir = path.resolve(arg);
  }
  if (!opts.runDir) fail(`run directory is required\n${USAGE}`);
  return opts;
}

function fail(message) {
  console.log(`ERROR: ${message}`);
  process.exit(2);
}

function filled(cell) {
  const value = (cell ?? "").trim();
  return value !== "" && value !== "-" && value !== "TBD";
}

function listFiles(dir, recursive) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (recursive) out.push(...listFiles(full, true));
      continue;
    }
    out.push(full);
  }
  return out;
}

function readText(file) {
  try {
    if (statSync(file).size > MAX_BYTES) return null;
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const resultsDir = path.join(opts.runDir, "results");
  if (!existsSync(resultsDir)) fail(`no results directory: ${resultsDir}`);

  const problems = [];
  const files = listFiles(resultsDir, false)
    .filter((f) => f.toLowerCase().endsWith(".md"))
    .map((f) => ({ name: path.basename(f), text: readText(f) ?? "" }));
  const rows = parseResultFiles(files);
  const expected = loadTableRows();

  const seen = new Map();
  for (const row of rows) {
    const prior = seen.get(row.id);
    if (prior) problems.push(`${row.file}:${row.line} duplicate row for "${row.id}" (also in ${prior})`);
    else seen.set(row.id, `${row.file}:${row.line}`);
  }

  for (const want of expected) {
    const row = seen.get(want.id) && rows.find((r) => r.id === want.id);
    if (!row) {
      problems.push(`missing row for "${want.id}" (${want.scenario})`);
      continue;
    }
    const { record, where } = { record: row.record, where: `${row.file}:${row.line}` };
    const verdict = record.verdict.trim().toLowerCase();
    const executed = record.executed.trim().toLowerCase();
    const falsified = record.falsified.trim().toLowerCase();

    if (verdict === "unrun" || verdict === "") {
      problems.push(`${where} "${want.id}" is still unrun - set a verdict or record why it did not run`);
      continue;
    }
    if (!VERDICTS.includes(verdict)) problems.push(`${where} "${want.id}" verdict "${record.verdict}" is not one of ${VERDICTS.join(", ")}`);
    if (!EXECUTIONS.includes(executed)) problems.push(`${where} "${want.id}" executed "${record.executed}" is not one of ${EXECUTIONS.join(", ")}`);

    if (verdict === "pass" || verdict === "fail") {
      if (executed !== "yes") problems.push(`${where} "${want.id}" verdict ${verdict} requires executed: yes (code inspection is not proof)`);
      if (!filled(record.method)) problems.push(`${where} "${want.id}" ${verdict} needs the method actually used`);
      if (!filled(record.request)) problems.push(`${where} "${want.id}" ${verdict} needs the request`);
      if (!filled(record.response)) problems.push(`${where} "${want.id}" ${verdict} needs the response`);
    }
    if (verdict === "fail") {
      if (!SEVERITIES.includes(record.severity.trim().toUpperCase())) {
        problems.push(`${where} "${want.id}" fail needs severity: ${SEVERITIES.join(", ")}`);
      }
    }
    // A filled severity means this row was a real finding. After a fix the verdict
    // becomes pass while the initial severity stays, so severity always demands a
    // fix trail unless the row is still an open fail.
    if (verdict === "pass" && filled(record.severity)) {
      if (!filled(record.fix)) problems.push(`${where} "${want.id}" was a ${record.severity} finding now marked pass with no fix recorded`);
      if (falsified !== "yes" && falsified !== "not-safe") problems.push(`${where} "${want.id}" fixed finding needs falsified: yes or not-safe`);
      if (!filled(record.after)) problems.push(`${where} "${want.id}" fixed finding needs the after-rerun result`);
      if (falsified === "not-safe" && !filled(record.notes)) problems.push(`${where} "${want.id}" falsified not-safe needs the reason in notes`);
    }
    if (verdict === "not-proven" || verdict === "not-applicable") {
      if (!filled(record.notes)) problems.push(`${where} "${want.id}" ${verdict} needs the reason in notes`);
      if (filled(record.fix)) problems.push(`${where} "${want.id}" ${verdict} cannot carry a fix - run it, or mark it pass or fail`);
    }

    if (!FALSIFIED.includes(falsified)) problems.push(`${where} "${want.id}" falsified "${record.falsified}" is not one of ${FALSIFIED.join(", ")}`);
    if (filled(record.fix) && !filled(record.after)) problems.push(`${where} "${want.id}" has a fix but no after-rerun result`);

    if (opts.requireFixes && verdict === "fail") {
      problems.push(`${where} "${want.id}" is still fail after the fix pass`);
    }
  }

  const gate = path.join(opts.runDir, "gate.md");
  if (!existsSync(gate)) {
    problems.push("gate.md is missing - the environment gate must be written before dispatch");
  } else {
    const text = readText(gate) ?? "";
    if (!/^verdict:\s*(LOCAL|PROD-EXPOSED)\b/im.test(text)) {
      problems.push("gate.md has no verdict: LOCAL or verdict: PROD-EXPOSED - active testing is not cleared");
    }
    if (/PENDING/.test(text)) problems.push("gate.md still contains PENDING answers");
  }

  const scanTargets = [
    ...files.map((f) => path.join(resultsDir, f.name)),
    gate,
    path.join(opts.runDir, "report.md"),
    ...listFiles(path.join(opts.runDir, "briefs"), false),
    ...listFiles(path.join(opts.runDir, "captures"), true),
  ].filter((f) => existsSync(f) && statSync(f).isFile() && TEXT_EXT.has(path.extname(f).toLowerCase()));

  const leaked = new Set();
  for (const file of scanTargets) {
    const text = readText(file);
    if (text === null) {
      problems.push(`${path.basename(file)} is too large to scan - split the capture or delete it`);
      continue;
    }
    text.split(/\r?\n/).forEach((line, index) => {
      if (line.includes(".maskme")) return;
      for (const [name, re] of SECRET_RULES) {
        const match = line.match(re);
        if (match) leaked.add(`${path.relative(opts.runDir, file).split(path.sep).join("/")}:${index + 1} ${name} :: ${match[0].slice(0, 12)}...`);
      }
    });
  }
  for (const hit of leaked) problems.push(`unmasked credential in ${hit}`);

  const counts = { pass: 0, fail: 0, "not-proven": 0, "not-applicable": 0, unrun: 0 };
  for (const row of rows) {
    const v = row.record.verdict.trim().toLowerCase();
    if (counts[v] === undefined) counts.unrun += 1;
    else counts[v] += 1;
  }

  console.log(`rows ${rows.length}/${expected.length} | pass ${counts.pass} | fail ${counts.fail} | not-proven ${counts["not-proven"]} | not-applicable ${counts["not-applicable"]} | unfilled ${counts.unrun}`);
  console.log(`mode: ${opts.requireFixes ? "require-fixes" : "pre-fix"}`);
  if (problems.length > 0) {
    console.log("");
    for (const problem of problems) console.log(`PROBLEM ${problem}`);
    console.log("");
    console.log(`RESULT: ${problems.length} problem(s) - do not report yet`);
    process.exit(1);
  }
  console.log("RESULT: OK - every row is filled, evidenced, and masked");
}

main();
