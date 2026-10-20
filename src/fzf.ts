// fzf as the picker when OVERLAY_PICKER=fzf: one TSV line per item on stdin
// (id first, hidden), a preview pane that reruns this CLI's `show`, and the
// picked line back on stdout. fzf draws its UI on /dev/tty itself.

import { spawn } from "node:child_process";

export function wantsFzf(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.OVERLAY_PICKER ?? "").trim().toLowerCase() === "fzf";
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The preview command: this exact CLI (same node, same script) showing fzf's first field. */
export function previewCommand(execPath: string, script: string, showArgs: string[]): string {
  return [shellQuote(execPath), shellQuote(script), ...showArgs, "{1}"].join(" ");
}

export function fzfArgs(prompt: string, preview: string): string[] {
  return [
    "--delimiter=\t",
    "--with-nth=2..",
    `--prompt=${prompt} › `,
    "--layout=reverse",
    "--height=80%",
    "--border=rounded",
    "--info=inline-right",
    "--preview",
    preview,
    "--preview-window=right,55%,wrap,border-left",
    "--color=prompt:cyan,pointer:cyan,hl:cyan,hl+:cyan",
  ];
}

export type FzfOutcome = { status: "picked"; line: string } | { status: "cancelled" } | { status: "missing" };

/** Run fzf over `lines`; "missing" when fzf isn't installed. */
export function runFzf(lines: string[], args: string[]): Promise<FzfOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn("fzf", args, { stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (out += chunk));
    child.on("error", (error: NodeJS.ErrnoException) =>
      error.code === "ENOENT" ? resolve({ status: "missing" }) : reject(error),
    );
    child.on("close", (code) => {
      const line = out.split("\n")[0] ?? "";
      // fzf exits 1 for "no match" and 130 for Esc / Ctrl-C.
      resolve(code === 0 && line ? { status: "picked", line } : { status: "cancelled" });
    });
    child.stdin.on("error", () => undefined); // fzf may exit before reading everything
    child.stdin.end(lines.join("\n") + "\n");
  });
}
