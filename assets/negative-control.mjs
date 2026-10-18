#!/usr/bin/env node
// Authorized verification harness - negative control for a security regression suite.
//
// WHY THIS EXISTS. A rerun suite that prints all-clear proves only that the app looks clean.
// It does not prove the suite can see dirt. This script settles that: it boots the app twice
// as two throwaway copies - one running the code as committed, one with a single protection
// deleted - and requires the mapped check to come back REFUSED from the first and DETECTED
// from the second. A protection that does not reproduce the attack when deleted was never the
// thing holding the line, and this says so out loud.
//
// SAFETY. It only ever runs against copies it creates here, on its own ports, against copies
// of the database, in its own log directory. It must never point at a shared or staging
// database, a real user's rows, or a URL you are not authorized to attack. Add the work dir
// to .gitignore. If your app cannot boot twice on this machine, stop and record `not-safe`
// in the results table instead of loosening this.
//
// CONVENTIONS IT ASSUMES (the skill prescribes these when you write the fixes):
//   - every protection is a deletable block:
//       // GUARD <name> (S02)
//       ...one or more statements...
//       // END GUARD <name>
//   - the app reads its port, database file and log directory from env, so a copy can boot
//     somewhere else without editing code;
//   - the regression suite takes one check id as an argument, prints one line per check
//     starting with DETECTED, REFUSED or ERROR, and reads the target URL from env.
//
// USAGE. Copy this file next to your app's tests, fill the ADAPT block, then:
//   node negative_control.mjs                    every protection
//   node negative_control.mjs --only quota-      the ones whose name matches
// Exit 0 means every protection was falsified. Exit 1 names the ones that were not.

const ADAPT = {
  appRoot: "/absolute/path/to/app",
  serverFile: "server.mjs",
  suiteFile: "tests/security/rerun.mjs",
  seedDatabase: "data.json",
  accountsFile: null, // set if a server copy needs a sibling file to boot, e.g. "accounts.json"
  workDir: ".negative-control",
  ports: { control: 8087, mutant: 8086 },
  healthPath: "/healthz",
  // Env var names your app happens to honour. Rename the values, not this shape.
  envNames: { port: "PORT", url: "APP_URL", dataFile: "APP_DATA_FILE", logDir: "APP_LOG_DIR" },
  // One entry per protection: the guard blocks deleted together, and the checks that must
  // light up when they are gone. A control with two enforcement layers cannot be falsified by
  // deleting one of them, so name the layers as one entry - that is a fact about the control,
  // not a shortcut.
  protections: [
    // { guards: ["note-ownership-api"], checks: ["idor-cross-user"] },
  ],
};

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const OPEN = /^\s*\/\/ GUARD ([a-z0-9-]+)(?: \(|$)/;
const source = readFileSync(path.join(ADAPT.appRoot, ADAPT.serverFile), "utf8");

function stripGuards(names) {
  const lines = source.split(/\r?\n/);
  const kept = [];
  let removed = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const open = lines[i].trim().match(/^\/\/ GUARD ([a-z0-9-]+)( \(|$)/);
    if (open && names.includes(open[1])) {
      const close = `// END GUARD ${open[1]}`;
      while (i < lines.length && lines[i].trim() !== close) i += 1;
      if (i === lines.length) throw new Error(`guard ${open[1]} opens but never closes - fix the markers first`);
      removed += 1;
      continue;
    }
    kept.push(lines[i]);
  }
  if (removed !== names.length) throw new Error(`asked to strip ${names.length} guard(s), found ${removed}`);
  return kept.join("\n");
}

function boot(dir, port, dataFile, logDir) {
  const env = { ...process.env, [ADAPT.envNames.port]: String(port), [ADAPT.envNames.dataFile]: dataFile, [ADAPT.envNames.logDir]: logDir };
  return spawn(process.execPath, [path.join(dir, ADAPT.serverFile)], { cwd: ADAPT.appRoot, env, stdio: "ignore" });
}

async function waitForHealth(child, port) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server on ${port} exited with code ${child.exitCode} - boot it by hand once to see why`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}${ADAPT.healthPath}`);
      if (res.status === 200) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`server on ${port} never reported healthy`);
}

async function runCheck(check, port, logDir) {
  const env = { ...process.env, [ADAPT.envNames.url]: `http://127.0.0.1:${port}`, [ADAPT.envNames.logDir]: logDir };
  const out = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ADAPT.appRoot, ADAPT.suiteFile), check], {
      cwd: ADAPT.appRoot, env, stdio: ["ignore", "pipe", "ignore"],
    });
    let text = "";
    child.stdout.on("data", (chunk) => { text += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, text }));
  });
  const line = out.text.split(/\r?\n/).find((l) => l.includes(check));
  if (!line) throw new Error(`suite printed no line for ${check} (exit ${out.code})`);
  if (line.startsWith("ERROR")) throw new Error(`suite errored on ${check}: ${line.trim()}`);
  return line.startsWith("DETECTED");
}

async function main() {
  if (!ADAPT.protections.length) throw new Error("ADAPT.protections is empty - list the guards you added and the checks they map to");
  for (const seed of [ADAPT.seedDatabase, ADAPT.accountsFile].filter(Boolean)) {
    if (!existsSync(path.join(ADAPT.appRoot, seed))) throw new Error(`${seed} missing in ${ADAPT.appRoot} - boot the app once so it seeds, then rerun`);
  }
  const guardNames = [...source.matchAll(/^\s*\/\/ GUARD ([a-z0-9-]+)(?: \(|$)/gm)].map((m) => m[1]);
  const planned = new Set(ADAPT.protections.flatMap((p) => p.guards));
  const unmanaged = guardNames.filter((g) => !planned.has(g));
  if (unmanaged.length) throw new Error(`guards with no entry here, so nothing proves they matter: ${unmanaged.join(", ")}`);
  const unknown = [...planned].filter((g) => !guardNames.includes(g));
  if (unknown.length) throw new Error(`listed here but no such GUARD block: ${unknown.join(", ")}`);

  const work = path.join(ADAPT.appRoot, ADAPT.workDir);
  rmSync(work, { recursive: true, force: true });
  const dirs = {};
  for (const role of ["control", "mutant"]) {
    dirs[role] = path.join(work, role);
    mkdirSync(path.join(dirs[role], "logs"), { recursive: true });
    copyFileSync(path.join(ADAPT.appRoot, ADAPT.seedDatabase), path.join(dirs[role], ADAPT.seedDatabase));
    if (ADAPT.accountsFile) copyFileSync(path.join(ADAPT.appRoot, ADAPT.accountsFile), path.join(dirs[role], ADAPT.accountsFile));
    writeFileSync(path.join(dirs[role], ADAPT.serverFile), source, "utf8");
  }

  const results = [];
  for (const protection of ADAPT.protections) {
    const label = protection.guards.join("+");
    process.stdout.write(`${label.padEnd(30)} `);
    writeFileSync(path.join(dirs.mutant, ADAPT.serverFile), stripGuards(protection.guards), "utf8");
    const entry = { label, ok: false, notes: [] };
    const children = [];
    try {
      const control = boot(dirs.control, ADAPT.ports.control, path.join(dirs.control, ADAPT.seedDatabase), path.join(dirs.control, "logs"));
      const mutant = boot(dirs.mutant, ADAPT.ports.mutant, path.join(dirs.mutant, ADAPT.seedDatabase), path.join(dirs.mutant, "logs"));
      children.push(control, mutant);
      await Promise.all([waitForHealth(control, ADAPT.ports.control), waitForHealth(mutant, ADAPT.ports.mutant)]);
      let ok = true;
      for (const check of protection.checks) {
        const held = await runCheck(check, ADAPT.ports.control, path.join(dirs.control, "logs"));
        const broke = await runCheck(check, ADAPT.ports.mutant, path.join(dirs.mutant, "logs"));
        entry.notes.push(`${check}: as-written ${held ? "DETECTED (bad)" : "REFUSED"}, guard deleted ${broke ? "DETECTED" : "REFUSED (bad)"}`);
        if (held || !broke) ok = false;
      }
      entry.ok = ok;
    } catch (error) {
      entry.notes.push(`error: ${error.message}`);
    } finally {
      for (const child of children) child.kill();
      await Promise.all(children.map((c) => (c.exitCode !== null ? Promise.resolve() : new Promise((r) => c.once("exit", r)))));
    }
    process.stdout.write(`${entry.ok ? "FALSIFIED " : "NOT-FALSIFIED"} ${entry.notes.join(" | ")}\n`);
    results.push(entry);
  }

  const failed = results.filter((r) => !r.ok);
  console.log("");
  console.log(`${results.length} protection(s) tested, ${failed.length} not falsified.`);
  for (const f of failed) console.log(`  ${f.label}: ${f.notes.join(" | ")}`);
  if (failed.length) console.log("\nNot falsified means one of: the check does not actually exercise that block, another layer holds, or the block is decoration. Investigate each; do not delete the entry.");
  console.log(`\nWork dir kept at ${path.relative(ADAPT.appRoot, work)} - add it to .gitignore, inspect the mutants, then remove it.`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.log(`ERROR ${error.message}`);
  process.exit(2);
});
