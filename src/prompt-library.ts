// `overlay prompt list` and `overlay prompt show` — the saved prompts from
// the web Prompts page. Same ledger rules as search/files: numbered rows,
// no UUIDs, numbers resolve through a cache so `overlay prompt show 2` works.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import pc from "picocolors";

import { apiJson } from "./api.js";
import { relativeTime, terminalWidth, truncate } from "./render.js";

type SavedPrompt = {
  prompt_id: string;
  title: string;
  content: string;
  description: string | null;
  category: string | null;
  usage_count: number;
  is_favorite: boolean | null;
  is_public: boolean | null;
  updated_at: string;
};

const CACHE_PATH = join(homedir(), ".config", "overlay", "last-prompts.json");

async function rememberPrompts(prompts: SavedPrompt[]): Promise<void> {
  try {
    await mkdir(join(homedir(), ".config", "overlay"), { recursive: true });
    const rows = prompts.map((prompt) => ({ id: prompt.prompt_id, title: prompt.title }));
    await writeFile(CACHE_PATH, JSON.stringify(rows, null, 2) + "\n");
  } catch {
    // Best-effort — the list still renders, numbers just won't resolve.
  }
}

async function resolvePromptRef(ref: string): Promise<string> {
  if (!/^\d{1,3}$/.test(ref)) return ref; // a prompt id
  try {
    const rows = JSON.parse(await readFile(CACHE_PATH, "utf8")) as Array<{ id: string }>;
    const row = rows[Number.parseInt(ref, 10) - 1];
    if (row?.id) return row.id;
  } catch {
    // fall through
  }
  process.exitCode = 2;
  throw new Error(`No prompt #${ref} — run \`overlay prompt list\` first.`);
}

function printPrompt(index: number, prompt: SavedPrompt): void {
  const width = terminalWidth();
  const star = prompt.is_favorite ? pc.yellow("★ ") : "";
  process.stdout.write(`${pc.cyan(String(index).padStart(2))}  ${star}${pc.bold(truncate(prompt.title || "(untitled)", width - 7))}\n`);

  const meta: string[] = [];
  if (prompt.category) meta.push(prompt.category);
  if (prompt.is_public) meta.push("public");
  if (prompt.usage_count > 0) meta.push(`used ${prompt.usage_count}×`);
  const when = relativeTime(prompt.updated_at);
  if (when) meta.push(when);
  if (meta.length > 0) process.stdout.write(`    ${pc.dim(meta.join(" · "))}\n`);

  const snippet = (prompt.description || prompt.content).trim().replace(/\s+/g, " ");
  if (snippet) process.stdout.write(`    ${pc.dim(truncate(snippet, width - 4))}\n`);
  process.stdout.write("\n");
}

// One prompt per line, tab-separated: id, title, category, preview. For fzf and
// other line tools; tabs and newlines inside fields are flattened to spaces.
function tsvLine(prompt: SavedPrompt): string {
  const flat = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();
  const preview = flat(prompt.description || prompt.content).slice(0, 200);
  return [prompt.prompt_id, flat(prompt.title) || "(untitled)", flat(prompt.category), preview].join("\t");
}

export async function commandPromptList(options: {
  all?: boolean;
  limit: string;
  json?: boolean;
  tsv?: boolean;
}): Promise<void> {
  const result = await apiJson<{ prompts: SavedPrompt[] }>(
    `/api/prompts?public=${options.all ? "true" : "false"}`,
  );
  const limit = Number.parseInt(options.limit, 10) || 30;
  const prompts = result.prompts.slice(0, limit);

  if (options.json) {
    process.stdout.write(JSON.stringify({ prompts }) + "\n");
    return;
  }
  if (options.tsv || !process.stdout.isTTY) {
    for (const prompt of prompts) process.stdout.write(tsvLine(prompt) + "\n");
    await rememberPrompts(prompts);
    return;
  }
  if (prompts.length === 0) {
    process.stderr.write("No saved prompts yet — create one on overlay.one/prompts.\n");
    return;
  }
  process.stdout.write("\n");
  prompts.forEach((prompt, index) => printPrompt(index + 1, prompt));
  await rememberPrompts(prompts);
  process.stderr.write(
    pc.dim(`${prompts.length} of ${result.prompts.length} · print one with: overlay prompt show <number>\n`),
  );
}

export async function commandPromptShow(ref: string, options: { json?: boolean }): Promise<void> {
  const promptId = await resolvePromptRef(ref);
  const result = await apiJson<{ prompt: SavedPrompt }>(`/api/prompts/${encodeURIComponent(promptId)}`);
  if (options.json) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  process.stderr.write(pc.dim(`${result.prompt.title}\n`));
  process.stdout.write(result.prompt.content.trimEnd() + "\n");
}
