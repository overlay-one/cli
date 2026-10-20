// `overlay prompt list | show | pick` — the saved prompts from the web
// Prompts page. Same ledger rules as search/files: numbered rows, no UUIDs,
// numbers resolve through a cache so `overlay prompt show 2` works. Piped,
// `list` prints TSV (id first) for fzf; `pick` is the built-in picker.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import search from "@inquirer/search";
import pc from "picocolors";

import { apiJson } from "./api.js";
import { relativeTime } from "./render.js";
import { ledgerRow, listHeader, seconds, symbols, terminalWidth, truncateToWidth, withActivity } from "./ui.js";

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

const CONFIG_DIR = join(homedir(), ".config", "overlay");
const CACHE_PATH = join(CONFIG_DIR, "last-prompts.json");

async function rememberPrompts(prompts: SavedPrompt[]): Promise<void> {
  try {
    await mkdir(CONFIG_DIR, { recursive: true });
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

function fetchPrompts(all: boolean | undefined): Promise<{ prompts: SavedPrompt[] }> {
  return withActivity("Loading prompts", () =>
    apiJson<{ prompts: SavedPrompt[] }>(`/api/prompts?public=${all ? "true" : "false"}`),
  );
}

function flat(text: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function metaFor(prompt: SavedPrompt): string[] {
  const meta: string[] = [];
  if (prompt.category) meta.push(prompt.category);
  if (prompt.is_public) meta.push("public");
  if (prompt.usage_count > 0) meta.push(`used ${prompt.usage_count}×`);
  const when = relativeTime(prompt.updated_at);
  if (when) meta.push(when);
  return meta;
}

// One prompt per line, tab-separated: id, title, category, preview.
function tsvLine(prompt: SavedPrompt): string {
  const preview = flat(prompt.description || prompt.content).slice(0, 200);
  return [prompt.prompt_id, flat(prompt.title) || "(untitled)", flat(prompt.category), preview].join("\t");
}

export async function commandPromptList(options: {
  all?: boolean;
  limit: string;
  json?: boolean;
  tsv?: boolean;
}): Promise<void> {
  const result = await fetchPrompts(options.all);
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
  process.stdout.write(`\n${listHeader("Prompts", result.prompts.length)}\n\n`);
  prompts.forEach((prompt, index) => {
    const mark = prompt.is_favorite ? `${pc.cyan("★")} ` : "  ";
    const snippet = prompt.description || prompt.content;
    process.stdout.write(ledgerRow({ index: index + 1, title: prompt.title, meta: metaFor(prompt), snippet, mark }) + "\n");
  });
  await rememberPrompts(prompts);
  process.stderr.write(pc.dim(`show one: overlay prompt show <number> · pick: overlay prompt pick\n`));
}

async function printPrompt(promptId: string, json?: boolean): Promise<void> {
  const result = await apiJson<{ prompt: SavedPrompt }>(`/api/prompts/${encodeURIComponent(promptId)}`);
  if (json) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  if (process.stderr.isTTY) process.stderr.write(pc.dim(`${result.prompt.title}\n`));
  process.stdout.write(result.prompt.content.trimEnd() + "\n");
}

export async function commandPromptShow(ref: string, options: { json?: boolean }): Promise<void> {
  await printPrompt(await resolvePromptRef(ref), options.json);
}

function isPromptExit(error: unknown): boolean {
  return error instanceof Error && error.name === "ExitPromptError";
}

/** Fuzzy-pick a saved prompt; its content goes to stdout, the picker to stderr. */
export async function commandPromptPick(options: { all?: boolean; json?: boolean }): Promise<void> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    process.exitCode = 2;
    throw new Error("pick needs a terminal. In scripts use: overlay prompt list | fzf");
  }
  const started = Date.now();
  const { prompts } = await fetchPrompts(options.all);
  if (prompts.length === 0) {
    process.stderr.write("No saved prompts yet — create one on overlay.one/prompts.\n");
    return;
  }
  const width = terminalWidth();
  const haystack = (prompt: SavedPrompt) =>
    `${prompt.title} ${prompt.category ?? ""} ${prompt.description ?? ""} ${prompt.content}`.toLowerCase();
  try {
    const promptId = await search(
      {
        message: `Pick a prompt ${pc.dim(`· ${prompts.length} · ${seconds(Date.now() - started)}`)}`,
        pageSize: 10,
        source: (term) => {
          const words = (term ?? "").toLowerCase().split(/\s+/).filter(Boolean);
          return prompts
            .filter((prompt) => words.every((word) => haystack(prompt).includes(word)))
            .map((prompt) => ({
              name: `${prompt.is_favorite ? "★ " : ""}${truncateToWidth(flat(prompt.title) || "(untitled)", width - 8)}`,
              value: prompt.prompt_id,
              description: truncateToWidth(flat(prompt.description || prompt.content), width - 4),
            }));
        },
        theme: {
          prefix: { idle: pc.cyan("◆"), done: symbols.ok() },
          style: { highlight: (text: string) => pc.cyan(text) },
        },
      },
      { output: process.stderr, clearPromptOnDone: true },
    );
    await printPrompt(promptId, options.json);
  } catch (error) {
    if (!isPromptExit(error)) throw error;
    process.exitCode = 130;
  }
}
