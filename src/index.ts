// overlay — move files in and out of your Overlay memory, search it, and work with prompts.
// Design: DESIGN.md. Exit codes: 0 ok, 1 API/network, 2 usage, 3 not logged in.

import { Command } from "commander";
import pc from "picocolors";

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
import { commandPromptList, commandPromptPick, commandPromptShow } from "./prompt-library.js";
import { commandNoteAdd, commandNoteList, commandNotePick, commandNoteShow } from "./notes.js";
import { markFrame, symbols } from "./ui.js";

const program = new Command("overlay")
  .description("Save notes and files to your memory, search it, and work with prompts.")
  .version("0.2.0")
  .configureOutput({
    writeErr: (text) => process.stderr.write(text),
    outputError: (text, write) => write(`${symbols.fail()} ${text.replace(/^error: /, "")}`),
  })
  .addHelpText("beforeAll", `\n${markFrame(0)}  ${pc.bold("overlay")} ${pc.dim("· your memory in the terminal")}\n`)
  .addHelpText(
    "after",
    `
Examples:
  ${pc.cyan("overlay search")} "prompt caching"           search everything you saved
  ${pc.cyan("pbpaste | overlay prompt | pbcopy")}         rewrite a prompt in place
  ${pc.cyan("overlay prompt pick | pbcopy")}              copy a saved prompt
  ${pc.cyan("pbpaste | overlay note add")}                save the clipboard as a note

Docs: https://github.com/overlay-one/cli`,
  );

function run(action: (...args: never[]) => Promise<void>) {
  return async (...args: unknown[]) => {
    try {
      await (action as (...a: unknown[]) => Promise<void>)(...args);
    } catch (error) {
      if (error instanceof NotLoggedInError) {
        process.stderr.write(`${symbols.fail()} Not logged in\n${pc.dim("  run: overlay login  (or set OVERLAY_TOKEN)")}\n`);
        process.exitCode = 3;
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${symbols.fail()} ${message}\n`);
      process.exitCode = error instanceof ApiError ? 1 : (process.exitCode ?? 1);
    }
  };
}

program
  .command("upload")
  .helpGroup("Memory:")
  .description("Save files to your memory ('-' reads stdin)")
  .argument("<file...>", "paths to upload, or - for stdin")
  .option("--name <filename>", "stored filename (required with -)")
  .option("--json", "print the created node(s) as JSON")
  .action(run(commandUpload));

program
  .command("download")
  .helpGroup("Memory:")
  .description("Fetch a stored file by result number or node id")
  .argument("<ref>", "a number from the last search/files listing, or a node id")
  .option("-o, --output <path>", "write here instead of the original filename")
  .option("--annotated", "PDFs: bake your sticky highlights into the file")
  .action(run(commandDownload));

program
  .command("search")
  .helpGroup("Memory:")
  .description("Search everything you have saved")
  .argument("<query>")
  .option("--kinds <kinds>", "comma-separated kind filter (file,note,webpage,…)")
  .option("--limit <n>", "max results", "10")
  .option("--json", "print the raw search response")
  .action(run(commandSearch));

program
  .command("files")
  .helpGroup("Memory:")
  .description("List recent file, image, and webpage sources")
  .option("--kinds <kinds>", "comma-separated kinds", "file,image,webpage")
  .option("--limit <n>", "max results", "30")
  .option("--json", "print the raw list response")
  .action(run(commandFiles));

const note = program
  .command("note")
  .helpGroup("Memory:")
  .description("Write, list, show, or pick your notes");

note
  .command("add")
  .description("Save a note from text or stdin")
  .argument("[text...]", "the note text, or - / nothing to read stdin")
  .option("--title <title>", "title (default: the first line)")
  .option("--json", "print the created note")
  .action(run(commandNoteAdd));

note
  .command("list")
  .description("List your notes, most recently updated first")
  .option("--archived", "list archived notes instead")
  .option("--limit <n>", "max rows", "30")
  .option("--json", "print the raw list response")
  .option("--tsv", "one tab-separated line per note (default when piped)")
  .action(run(commandNoteList));

note
  .command("show")
  .description("Show a note; prints raw Markdown when piped")
  .argument("<ref>", "a number from the last note list, or a note id")
  .option("--json", "print the raw note record")
  .action(run(commandNoteShow));

note
  .command("pick")
  .description("Fuzzy-pick a note and show it")
  .option("--archived", "pick from archived notes")
  .option("--json", "print the raw note record")
  .action(run(commandNotePick));

const prompt = program
  .command("prompt")
  .helpGroup("Prompts:")
  .description("Optimize a prompt; list, show, or pick saved ones");

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
  .option("--tsv", "one tab-separated line per prompt (default when piped)")
  .action(run(commandPromptList));

prompt
  .command("show")
  .description("Print a saved prompt's content (pipe it on)")
  .argument("<ref>", "a number from the last prompt list, or a prompt id")
  .option("--json", "print the raw prompt record")
  .action(run(commandPromptShow));

prompt
  .command("pick")
  .description("Fuzzy-pick a saved prompt and print its content")
  .option("--all", "include public prompts from other people")
  .option("--json", "print the raw prompt record")
  .action(run(commandPromptPick));

program
  .command("login")
  .helpGroup("Account:")
  .description("Authorize this machine via the browser")
  .action(run(commandLogin));

program
  .command("logout")
  .helpGroup("Account:")
  .description("Forget the stored credentials")
  .action(run(commandLogout));

program
  .command("whoami")
  .helpGroup("Account:")
  .description("Show the logged-in account and API host")
  .action(run(commandWhoami));

program.parseAsync().catch(() => {
  process.exitCode = 2;
});
