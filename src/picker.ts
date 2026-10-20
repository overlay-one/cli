// The one interactive picker (@inquirer/search), shared by `prompt pick` and
// `note pick`. It draws on stderr so the picked item's content can go to
// stdout; Ctrl-C exits 130 without a stack trace.

import search from "@inquirer/search";
import pc from "picocolors";

import { symbols, terminalWidth, truncateToWidth } from "./ui.js";

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

/** Fuzzy-pick one item; returns its value, or null when the user pressed Ctrl-C. */
export async function pickOne(message: string, items: PickItem[]): Promise<string | null> {
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
