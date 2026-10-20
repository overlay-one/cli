// Terminal visuals, built on mature libraries: ora (the one animation — the
// Overlay mark, three layers with one lit — while a command waits on the
// network), marked + marked-terminal (Markdown), string-width + wrap-ansi
// (column-correct layout for CJK, Thai and emoji). Animation draws on stderr
// only, and only when a person is watching.

import { stripVTControlCharacters } from "node:util";

import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import ora from "ora";
import pc from "picocolors";
import stringWidth from "string-width";
import wrapAnsi from "wrap-ansi";

type ColorOption = { color?: boolean };
const colorsFor = (options: ColorOption = {}) => pc.createColors(options.color ?? pc.isColorSupported);

export const symbols = {
  ok: () => pc.green("✓"),
  fail: () => pc.red("✗"),
};

export function terminalWidth(): number {
  return Math.min(process.stdout.columns || process.stderr.columns || 100, 100);
}

const segmenter = new Intl.Segmenter();

/** Cut `text` to at most `width` terminal columns, ending in "…" when cut. */
export function truncateToWidth(text: string, width: number): string {
  if (stringWidth(text) <= width) return text;
  let out = "";
  for (const { segment } of segmenter.segment(text)) {
    if (stringWidth(out + segment) > width - 1) break;
    out += segment;
  }
  return `${out}…`;
}

/** Wrap to `width` columns with every line indented by `indent`. */
export function wrapIndented(text: string, width: number, indent = "  "): string {
  return wrapAnsi(text, Math.max(20, width - indent.length), { hard: true })
    .split("\n")
    .map((line) => indent + line)
    .join("\n");
}

const RECOMMENDED = /recommend/i;
const LIST_LINE = /^\s*(?:[*•·-]|\d+[.)])\s/;

/** Render Markdown for the terminal; a list line saying "recommended" is lit and marked ▸. */
export function renderMarkdown(markdown: string, width: number, options: ColorOption = {}): string {
  const c = colorsFor(options);
  const marked = new Marked();
  marked.use(
    markedTerminal({
      width,
      reflowText: true,
      showSectionPrefix: false,
      tab: 2,
      firstHeading: c.bold,
      heading: c.bold,
      strong: c.bold,
      em: c.italic,
      codespan: c.cyan,
      code: (text: string) => text,
      blockquote: c.dim,
      link: c.cyan,
      href: c.dim,
      paragraph: (text: string) => text,
      listitem: (text: string) => text,
      table: (text: string) => text,
      hr: c.dim,
      html: (text: string) => text,
      del: c.dim,
      text: (text: string) => text,
    }) as Parameters<Marked["use"]>[0],
  );
  // marked-terminal 7 prints list-item text raw under marked ≥13, so `**bold**`
  // survives in bullets; parse the item's inline tokens instead.
  marked.use({
    renderer: {
      text(token) {
        return "tokens" in token && token.tokens ? this.parser.parseInline(token.tokens) : false;
      },
    },
  });
  const rendered = (marked.parse(markdown, { async: false }) as string).replace(/\n+$/, "");
  return rendered
    .split("\n")
    .flatMap((line) => {
      const plain = stripVTControlCharacters(line);
      if (LIST_LINE.test(plain) && RECOMMENDED.test(plain)) {
        const text = plain.trimStart().replace(/^\* /, "");
        return hang("▸ ", "  ", text, width).map((part) => c.cyan(c.bold(part)));
      }
      // marked-terminal re-wraps paragraphs but not list items; wrap those here.
      const [, indent = "", marker = ""] = /^(\s*)(\* |· |\d+[.)] )?/.exec(line) ?? [];
      const bullet = marker === "* " ? "· " : marker;
      return hang(`  ${indent}${bullet}`, `  ${indent}${" ".repeat(bullet.length)}`, line.slice(indent.length + marker.length), width);
    })
    .join("\n");
}

/** Wrap `text` to `width` columns: `first` before line one, `rest` before the others. */
function hang(first: string, rest: string, text: string, width: number): string[] {
  const room = Math.max(20, width - Math.max(stringWidth(first), stringWidth(rest)));
  return wrapAnsi(text, room, { hard: true })
    .split("\n")
    .map((part, index) => (index === 0 ? first : rest) + part);
}

export function heading(label: string): string {
  return pc.bold(label.toUpperCase());
}

/** A thin rule with an optional label: ── Label ─────── */
export function rule(label = "", width = terminalWidth()): string {
  const head = label ? `── ${label} ` : "";
  return pc.dim(head + "─".repeat(Math.max(4, width - stringWidth(head))));
}

export function listHeader(label: string, count: number): string {
  return `${pc.bold(label)} ${pc.dim(`· ${count}`)}`;
}

/** One ledger row: cyan number, bold title, right-aligned dim meta, dim snippet line. */
export function ledgerRow(row: { index: number; title: string; meta: string[]; snippet?: string; mark?: string }): string {
  const width = terminalWidth();
  const number = String(row.index).padStart(2);
  const mark = row.mark ?? "";
  const meta = row.meta.join(" · ");
  const room = width - 4 - stringWidth(mark) - (meta ? stringWidth(meta) + 2 : 0);
  const title = truncateToWidth(row.title || "(untitled)", Math.max(12, room));
  const gap = Math.max(2, width - 4 - stringWidth(mark) - stringWidth(title) - stringWidth(meta));
  const lines = [`${pc.cyan(number)}  ${mark}${pc.bold(title)}${meta ? " ".repeat(gap) + pc.dim(meta) : ""}`];
  const snippet = row.snippet?.replace(/\s+/g, " ").trim();
  if (snippet) lines.push(`    ${pc.dim(truncateToWidth(snippet, width - 4))}`);
  return lines.join("\n") + "\n";
}

export function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function seconds(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;
}

/** The Overlay mark as one line of text, with layer `index % 3` lit. */
export function markFrame(index: number, options: ColorOption = {}): string {
  const c = colorsFor(options);
  const lit = ((index % 3) + 3) % 3;
  return [0, 1, 2].map((layer) => (layer === lit ? c.cyan("━") : c.dim("─"))).join(" ");
}

function animationsEnabled(stderrOnly: boolean): boolean {
  const env = process.env;
  if (env.CI || env.NO_COLOR || env.OVERLAY_NO_ANIMATION || env.TERM === "dumb") return false;
  if (!process.stderr.isTTY) return false;
  return stderrOnly || Boolean(process.stdout.isTTY);
}

type ActivityOptions<T> = {
  /** Animate even when stdout is piped (the wait is long and stderr is a terminal). */
  stderrOnly?: boolean;
  /** Printed once, dim, when the animation is off. */
  fallback?: string;
  /** Summary line that replaces the animation on success. */
  done?: (result: T, elapsedMs: number) => string | undefined;
};

/** Run `work` under the mark animation, showing elapsed time once it passes 1.5s. */
export async function withActivity<T>(label: string, work: () => Promise<T>, options: ActivityOptions<T> = {}): Promise<T> {
  const started = Date.now();
  const enabled = animationsEnabled(options.stderrOnly ?? false);
  if (!enabled && options.fallback) process.stderr.write(pc.dim(`${options.fallback}\n`));
  const spinner = ora({
    text: label,
    stream: process.stderr,
    isSilent: !enabled,
    spinner: { interval: 160, frames: [0, 1, 2].map((index) => markFrame(index)) },
  }).start();
  const clock = setInterval(() => {
    const elapsed = Date.now() - started;
    if (elapsed >= 1500) spinner.suffixText = pc.dim(formatElapsed(elapsed));
  }, 250);
  try {
    const result = await work();
    const summary = options.done?.(result, Date.now() - started);
    if (summary && enabled) spinner.stopAndPersist({ symbol: symbols.ok(), text: summary, suffixText: "" });
    else spinner.stop();
    return result;
  } catch (error) {
    spinner.stop();
    throw error;
  } finally {
    clearInterval(clock);
  }
}
