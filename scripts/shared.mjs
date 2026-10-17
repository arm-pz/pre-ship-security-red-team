import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TABLE_ASSET = path.join(SKILL_DIR, "assets", "results-table.md");
export const BRIEF_ASSET = path.join(SKILL_DIR, "assets", "brief-template.md");

export const COLUMNS = [
  "id", "scenario", "verdict", "executed", "method", "request", "response",
  "severity", "fix", "falsified", "after", "notes",
];

export const GROUP_NAMES = {
  1: "Identity and authorization (high effort)",
  2: "UI and API bypass and input validation",
  3: "Browser, network, cache, preview and AI trust boundaries",
};

export const VERDICTS = ["pass", "fail", "not-proven", "not-applicable"];
export const EXECUTIONS = ["yes", "no", "code-only", "blocked"];
export const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
export const FALSIFIED = ["yes", "not-safe", "no", "-"];

export function splitCells(line) {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparator(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

export function tableHeader() {
  return `| ${COLUMNS.join(" |")} |\n|${COLUMNS.map(() => "---").join("|")}|`;
}

export function loadTableRows() {
  const rows = [];
  for (const line of readFileSync(TABLE_ASSET, "utf8").split(/\r?\n/)) {
    const text = line.trim();
    if (!text.startsWith("|")) continue;
    const cells = splitCells(text);
    if (cells[0] === "id" || isSeparator(cells)) continue;
    const id = cells[0].replace(/^`|`$/g, "");
    const match = cells[1].match(/^S(\d+)/);
    if (!match) {
      throw new Error(`asset row for "${id}" has no S-number in the scenario column`);
    }
    const num = Number(match[1]);
    const group = num <= 4 ? 1 : num <= 9 ? 2 : 3;
    rows.push({ id, scenario: cells[1], group, line: text });
  }
  return rows;
}

export function parseResultFiles(files) {
  const parsed = [];
  for (const { name, text } of files) {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      if (!trimmed.startsWith("|")) continue;
      const cells = splitCells(trimmed);
      if (cells[0] === "id" || isSeparator(cells)) continue;
      parsed.push({
        file: name,
        line: i + 1,
        id: cells[0].replace(/^`|`$/g, ""),
        cells,
        record: Object.fromEntries(COLUMNS.map((c, idx) => [c, cells[idx] ?? ""])),
      });
    }
  }
  return parsed;
}
