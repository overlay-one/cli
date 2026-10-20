// The one interactive picker (@inquirer/search), shared by `prompt pick` and
// `note pick`. It draws on stderr so the picked item's content can go to
// stdout; Ctrl-C exits 130 without a stack trace.

import search from "@inquirer/search";
import pc from "picocolors";

import { fzfArgs, previewCommand, runFzf, wantsFzf } from "./fzf.js";
import { symbols, terminalWidth, truncateToWidth, tsvLine } from "./ui.js";

export type PickItem = {
  value: string;
  title: string;
  description: string;
  starred?: boolean;
  /** Extra text that matches the search but isn't shown. */
  haystack?: string;
};

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

export function requirePickerTerminal(listCommand: string): void {
  if (process.stdin.isTTY && process.stderr.isTTY) return;
  process.exitCode = 2;
  throw new Error(`pick needs a terminal. In scripts use: ${listCommand} | fzf`);
}

type PickOptions = {
  /** Plain label, e.g. "Pick a note". */
  label: string;
  /** Dim detail after the label in the built-in picker, e.g. "155 · 0.6s". */
  detail: string;
  /** `show` subcommand for fzf's preview pane, e.g. ["note", "show"]. */
  showArgs: string[];
};

/**
 * Fuzzy-pick one item; returns its value, or null when the user cancelled.
 * OVERLAY_PICKER=fzf uses fzf (falling back here when it isn't installed).
 */
export async function pickOne(options: PickOptions, items: PickItem[]): Promise<string | null> {
  if (wantsFzf()) {
    const picked = await pickWithFzf(options, items);
    if (picked !== undefined) return picked;
    process.stderr.write(pc.dim("OVERLAY_PICKER=fzf, but fzf isn't installed; using the built-in picker.\n"));
  }
  return pickBuiltin(`${options.label} ${pc.dim(`· ${options.detail}`)}`, items);
}

/** undefined when fzf is missing, so the caller can fall back. */
async function pickWithFzf(options: PickOptions, items: PickItem[]): Promise<string | null | undefined> {
  const lines = items.map((item) => tsvLine([item.value, `${item.starred ? "★ " : ""}${item.title}`, item.description]));
  const preview = previewCommand(process.execPath, process.argv[1] ?? "overlay", options.showArgs);
  const outcome = await runFzf(lines, fzfArgs(options.label, preview));
  if (outcome.status === "missing") return undefined;
  if (outcome.status === "cancelled") {
    process.exitCode = 130;
    return null;
  }
  return outcome.line.split("\t")[0] ?? null;
}

async function pickBuiltin(message: string, items: PickItem[]): Promise<string | null> {
  const width = terminalWidth();
  const searchable = items.map((item) => ({
    item,
    text: `${item.title} ${item.description} ${item.haystack ?? ""}`.toLowerCase(),
  }));
  try {
    return await search(
      {
        message,
        pageSize: 10,
        source: (term) => {
          const words = (term ?? "").toLowerCase().split(/\s+/).filter(Boolean);
          return searchable
            .filter(({ text }) => words.every((word) => text.includes(word)))
            .map(({ item }) => ({
              name: `${item.starred ? "★ " : ""}${truncateToWidth(flat(item.title) || "(untitled)", width - 8)}`,
              value: item.value,
              description: truncateToWidth(flat(item.description), width - 4),
            }));
        },
        theme: {
          prefix: { idle: pc.cyan("◆"), done: symbols.ok() },
          style: { highlight: (text: string) => pc.cyan(text) },
        },
      },
      { output: process.stderr, clearPromptOnDone: true },
    );
  } catch (error) {
    if (!(error instanceof Error && error.name === "ExitPromptError")) throw error;
    process.exitCode = 130;
    return null;
  }
}
