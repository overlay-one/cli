// `overlay prompt` — rewrite a prompt so it asks for more ambitious work.
// The rewritten prompt goes to stdout so `pbpaste | overlay prompt | pbcopy`
// works; the animation, diagnosis and ladder go to stderr.

import pc from "picocolors";

import { ApiError, apiFetch } from "./api.js";
import { modelFromName } from "./links.js";
import { heading, renderMarkdown, rule, seconds, terminalWidth, withActivity } from "./ui.js";

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

type Model = NonNullable<ReturnType<typeof modelFromName>>;

async function optimize(prompt: string, context: string, model: Model | null): Promise<OptimizerResult> {
  const response = await apiFetch("/api/prompts/optimize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: prompt, context, ...(model ? { model } : {}) }),
  });
  // The route streams heartbeat spaces before its JSON, so the status is always 200.
  const body = (await response.json()) as OptimizerResponse;
  if (body.success !== true || !body.data) {
    throw new ApiError(body.error?.message ?? "Could not optimize the prompt.", 502);
  }
  return body.data;
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
  const width = terminalWidth() - 2;
  const notes: Array<[string, string]> = [
    ["Diagnosis", result.sections.diagnosis],
    ["Ladder", result.sections.ladder],
    ["Deferred", result.sections.deferred],
  ];
  for (const [label, body] of notes) {
    if (body) process.stderr.write(`\n${heading(label)}\n${renderMarkdown(body, width)}\n`);
  }
  process.stderr.write("\n");
}

function printRewritten(text: string): void {
  if (!process.stdout.isTTY) {
    process.stdout.write(text + "\n");
    return;
  }
  process.stdout.write(`${rule("Rewritten prompt")}\n${text}\n${rule()}\n`);
  process.stderr.write(pc.dim("copy it: … | overlay prompt | pbcopy · all sections: --full\n"));
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

export async function commandPrompt(
  argWords: string[],
  options: { context?: string; model?: string; full?: boolean; json?: boolean; quiet?: boolean },
): Promise<void> {
  const prompt = (await readPrompt(argWords)).trim();
  if (!prompt) {
    process.exitCode = 2;
    throw new Error("The prompt is empty.");
  }

  const model = options.model ? modelFromName(options.model) : null;
  if (options.model && !model) {
    process.exitCode = 2;
    throw new Error(`Unknown model "${options.model}". Use a name like gemini-4-argon, claude-sonnet-5-5 or gpt-6-luna.`);
  }
  const label = model ? `Optimizing with ${model.name}` : "Optimizing";
  const result = await withActivity(label, () => optimize(prompt, options.context ?? "", model), {
    stderrOnly: true,
    fallback: options.quiet ? undefined : "Optimizing… this can take up to two minutes.",
    done: (optimized, ms) =>
      optimized.rewritten ? `Rewritten in ${seconds(ms)} · ${words(optimized.rewritten)} words` : `Done in ${seconds(ms)}`,
  });

  if (options.json) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  if (options.full) {
    const markdown = fullMarkdown(result);
    process.stdout.write((process.stdout.isTTY ? renderMarkdown(markdown, terminalWidth() - 2) : markdown) + "\n");
    return;
  }
  if (!result.rewritten) {
    process.stderr.write(pc.yellow("The reply didn't include a rewritten prompt; printing it in full.\n"));
    process.stdout.write(result.raw + "\n");
    return;
  }
  if (!options.quiet && process.stderr.isTTY) printNotes(result);
  printRewritten(result.rewritten);
}
