// overlay — move files in and out of your Overlay brain, and search it.
// Design: DESIGN.md. Exit codes: 0 ok, 1 API/network, 2 usage, 3 not logged in.

import { Command } from "commander";

import { NotLoggedInError } from "./auth.js";
import {
  ApiError,
  commandDownload,
  commandFiles,
  commandLogin,
  commandLogout,
  commandSearch,
  commandUpload,
  commandWhoami,
} from "./commands.js";
import { commandPrompt } from "./prompt.js";
import { commandPromptList, commandPromptShow } from "./prompt-library.js";

const program = new Command("overlay")
  .description("Your Overlay memory from the terminal: upload, download, search, prompt.")
  .version("0.2.0")
  .configureOutput({ writeErr: (text) => process.stderr.write(text) });

function run(action: (...args: never[]) => Promise<void>) {
  return async (...args: unknown[]) => {
    try {
      await (action as (...a: unknown[]) => Promise<void>)(...args);
    } catch (error) {
      if (error instanceof NotLoggedInError) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 3;
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`error: ${message}\n`);
      process.exitCode = error instanceof ApiError ? 1 : (process.exitCode ?? 1);
    }
  };
}

program
  .command("login")
  .description("Authorize this machine via the browser")
  .action(run(commandLogin));

program
  .command("logout")
  .description("Forget the stored credentials")
  .action(run(commandLogout));

program
  .command("whoami")
  .description("Show the logged-in account and API host")
  .action(run(commandWhoami));

program
  .command("upload")
  .description("Ingest files into your brain ('-' reads stdin)")
  .argument("<file...>", "paths to upload, or - for stdin")
  .option("--name <filename>", "stored filename (required with -)")
  .option("--json", "print the created node(s) as JSON")
  .action(run(commandUpload));

program
  .command("download")
  .description("Fetch a stored file by result number or node id")
  .argument("<ref>", "a number from the last search/files listing, or a node id")
  .option("-o, --output <path>", "write here instead of the original filename")
  .option("--annotated", "PDFs: bake your sticky highlights into the file")
  .action(run(commandDownload));

program
  .command("search")
  .description("Hybrid search over everything you have saved")
  .argument("<query>")
  .option("--kinds <kinds>", "comma-separated kind filter (file,note,webpage,…)")
  .option("--limit <n>", "max results", "10")
  .option("--json", "print the raw search response")
  .action(run(commandSearch));

program
  .command("files")
  .description("List recent file, image, and webpage sources")
  .option("--kinds <kinds>", "comma-separated kinds", "file,image,webpage")
  .option("--limit <n>", "max results", "30")
  .option("--json", "print the raw list response")
  .action(run(commandFiles));

const prompt = program
  .command("prompt")
  .description("Optimize a prompt (default), or list and show your saved prompts");

prompt
  .command("optimize", { isDefault: true })
  .description("Rewrite a prompt to ask for more ambitious work (reads stdin)")
  .argument("[prompt...]", "the prompt text, or - / nothing to read stdin")
  .option("--context <text>", "what the model can access, limits, who the result is for")
  .option("--full", "print diagnosis, ladder, rewrite, and deferred line as Markdown")
  .option("--json", "print the raw optimizer response")
  .option("-q, --quiet", "print only the rewritten prompt")
  .action(run(commandPrompt));

prompt
  .command("list")
  .description("List your saved prompts")
  .option("--all", "include public prompts from other people")
  .option("--limit <n>", "max rows", "30")
  .option("--json", "print the raw list response")
  .action(run(commandPromptList));

prompt
  .command("show")
  .description("Print a saved prompt's content (pipe it on)")
  .argument("<ref>", "a number from the last prompt list, or a prompt id")
  .option("--json", "print the raw prompt record")
  .action(run(commandPromptShow));

program.parseAsync().catch(() => {
  process.exitCode = 2;
});
