// `overlay prompt` — rewrite a prompt so it asks for more ambitious work.
// The rewritten prompt goes to stdout so `pbpaste | overlay prompt | pbcopy`
// works; the diagnosis and ladder go to stderr.

import pc from "picocolors";

import { ApiError, apiFetch } from "./api.js";

type OptimizerResult = {
  structured: boolean;
  sections: { diagnosis: string; ladder: string; rewrittenSection: string; deferred: string };
  rewritten: string;
  raw: string;
};

type OptimizerResponse = {
  success?: boolean;
  data?: OptimizerResult;
  error?: { message?: string };
};

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function readPrompt(words: string[]): Promise<string> {
  if (words.length > 0 && !(words.length === 1 && words[0] === "-")) return words.join(" ");
  if (process.stdin.isTTY) {
    process.exitCode = 2;
    throw new Error("Pass the prompt as an argument or pipe it in: pbpaste | overlay prompt");
  }
  return readStdin();
}

function fullMarkdown(result: OptimizerResult): string {
  if (!result.structured) return result.raw;
  return [
    "## Diagnosis", result.sections.diagnosis,
    "## Ladder", result.sections.ladder,
    "## Rewritten prompt", result.rewritten || result.sections.rewrittenSection,
    "## Deferred", result.sections.deferred,
  ].join("\n\n");
}

function printNotes(result: OptimizerResult): void {
  const notes: Array<[string, string]> = [
    ["Diagnosis", result.sections.diagnosis],
    ["Ladder", result.sections.ladder],
    ["Deferred", result.sections.deferred],
  ];
  for (const [label, body] of notes) {
    if (body) process.stderr.write(`${pc.bold(label)}\n${pc.dim(body)}\n\n`);
  }
}

export async function commandPrompt(
  words: string[],
  options: { context?: string; full?: boolean; json?: boolean; quiet?: boolean },
): Promise<void> {
  const prompt = (await readPrompt(words)).trim();
  if (!prompt) {
    process.exitCode = 2;
    throw new Error("The prompt is empty.");
  }

  if (!options.quiet) process.stderr.write(pc.dim("Optimizing… this can take up to two minutes.\n"));
  const response = await apiFetch("/api/prompts/optimize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: prompt, context: options.context ?? "" }),
  });
  // The route streams heartbeat spaces before its JSON, so the status is always 200.
  const body = (await response.json()) as OptimizerResponse;
  if (body.success !== true || !body.data) {
    throw new ApiError(body.error?.message ?? "Could not optimize the prompt.", 502);
  }
  const result = body.data;

  if (options.json) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  if (options.full) {
    process.stdout.write(fullMarkdown(result) + "\n");
    return;
  }
  if (!result.rewritten) {
    process.stderr.write(pc.yellow("The reply didn't include a rewritten prompt; printing it in full.\n"));
    process.stdout.write(result.raw + "\n");
    return;
  }
  if (!options.quiet) printNotes(result);
  process.stdout.write(result.rewritten + "\n");
}
