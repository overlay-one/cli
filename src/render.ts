// Terminal presentation: a quiet ledger. Numbered rows, bold titles, dim
// metadata, wrapped snippets — and no UUIDs (they live in --json; numbered
// rows resolve through the result cache so `overlay download 3` works).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import pc from "picocolors";

export type BrainNode = {
  id: string;
  kind?: string;
  content?: string;
  status?: string;
  created_at?: string;
  payload?: Record<string, unknown>;
};

const CONFIG_DIR = join(homedir(), ".config", "overlay");
const RESULTS_PATH = join(CONFIG_DIR, "last-results.json");

export function terminalWidth(): number {
  return Math.min(process.stdout.columns || 100, 110);
}

export function nodeTitle(node: BrainNode): string {
  const payload = node.payload ?? {};
  const candidate =
    payload["title"] ?? payload["original_name"] ?? payload["filename"] ?? node.content;
  const text = typeof candidate === "string" ? candidate : "";
  return text.trim().replace(/\s+/g, " ") || "(untitled)";
}

export function truncate(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

export function relativeTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 45) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unit = "B";
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

/** One ledger row: numbered, bold title, dim meta line, optional snippet. */
export function printRow(
  index: number,
  node: BrainNode,
  options: { score?: number; snippet?: string | null } = {},
): void {
  const width = terminalWidth();
  const number = pc.cyan(String(index).padStart(2));
  const title = pc.bold(truncate(nodeTitle(node), width - 5));

  const meta: string[] = [node.kind ?? "node"];
  const when = relativeTime(node.created_at);
  if (when) meta.push(when);
  if (options.score !== undefined) meta.push(`match ${(options.score * 100).toFixed(0)}%`);

  process.stdout.write(`${number}  ${title}\n`);
  process.stdout.write(`    ${pc.dim(meta.join(" · "))}\n`);

  const snippet = options.snippet?.trim().replace(/\s+/g, " ");
  // Don't echo the title back as its own snippet.
  if (snippet && !nodeTitle(node).startsWith(truncate(snippet, 40))) {
    process.stdout.write(`    ${pc.dim(truncate(snippet, width - 4))}\n`);
  }
  process.stdout.write("\n");
}

// --- result cache: numbered rows → node ids for follow-up commands ---

export async function rememberResults(nodes: BrainNode[]): Promise<void> {
  try {
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(
      RESULTS_PATH,
      JSON.stringify(
        nodes.map((node) => ({ id: node.id, title: nodeTitle(node) })),
        null,
        2,
      ) + "\n",
    );
  } catch {
    // Best-effort — numbering still renders, resolution just won't work.
  }
}

/** Resolve `overlay download 3` to the third row of the last listing. */
export async function resolveNodeRef(ref: string): Promise<string> {
  if (!/^\d{1,3}$/.test(ref)) return ref; // full node id
  try {
    const raw = await readFile(RESULTS_PATH, "utf8");
    const rows = JSON.parse(raw) as Array<{ id: string }>;
    const row = rows[Number.parseInt(ref, 10) - 1];
    if (row?.id) return row.id;
  } catch {
    // fall through
  }
  throw new Error(
    `No result #${ref} — run \`overlay search\` or \`overlay files\` first.`,
  );
}
