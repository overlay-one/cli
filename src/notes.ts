// `overlay note list | show | add | pick` — your Overlay notes. Same ledger
// rules as prompts: numbered rows, no UUIDs, TSV when piped (id first, for
// fzf), raw Markdown from `show` when piped, a rendered view in a terminal.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import pc from "picocolors";

import { apiJson } from "./api.js";
import { pickOne, requirePickerTerminal } from "./picker.js";
import { relativeTime } from "./render.js";
import { detailView, ledgerRow, listHeader, renderMarkdown, seconds, terminalWidth, tsvLine, withActivity } from "./ui.js";

type Note = {
  id: string;
  title: string | null;
  content: string | null;
  source_url: string | null;
  category: string | null;
  is_favorite: boolean | null;
  is_archived: boolean | null;
  source: string | null;
  derived?: { total: number } | null;
  created_at: string;
  updated_at: string;
};

const CONFIG_DIR = join(homedir(), ".config", "overlay");
const CACHE_PATH = join(CONFIG_DIR, "last-notes.json");

async function rememberNotes(notes: Note[]): Promise<void> {
  try {
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(CACHE_PATH, JSON.stringify(notes.map((note) => ({ id: note.id })), null, 2) + "\n");
  } catch {
    // Best-effort — the list still renders, numbers just won't resolve.
  }
}

async function resolveNoteRef(ref: string): Promise<string> {
  if (!/^\d{1,3}$/.test(ref)) return ref; // a note id
  try {
    const rows = JSON.parse(await readFile(CACHE_PATH, "utf8")) as Array<{ id: string }>;
    const row = rows[Number.parseInt(ref, 10) - 1];
    if (row?.id) return row.id;
  } catch {
    // fall through
  }
  process.exitCode = 2;
  throw new Error(`No note #${ref} — run \`overlay note list\` first.`);
}

/** The note's title, or its first line of text when it has none. */
function noteTitle(note: Note): string {
  const title = note.title?.trim();
  if (title) return title;
  const firstLine = (note.content ?? "").split("\n").find((line) => line.trim()) ?? "";
  return firstLine.replace(/^#+\s*/, "").trim() || "(untitled)";
}

/** Markdown reduced to one line of text for previews. */
function preview(note: Note): string {
  return (note.content ?? "")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`>]|\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function metaFor(note: Note): string[] {
  const meta: string[] = [];
  if (note.category) meta.push(note.category);
  if (note.source && note.source !== "web") meta.push(note.source);
  if (note.derived?.total) meta.push(`${note.derived.total} linked`);
  const when = relativeTime(note.updated_at);
  if (when) meta.push(when);
  return meta;
}

async function fetchNotes(archived: boolean | undefined): Promise<Note[]> {
  const { notes } = await withActivity("Loading notes", () => apiJson<{ notes: Note[] }>("/api/notes"));
  return notes.filter((note) => Boolean(note.is_archived) === Boolean(archived));
}

export async function commandNoteList(options: { archived?: boolean; limit: string; json?: boolean; tsv?: boolean }): Promise<void> {
  const all = await fetchNotes(options.archived);
  const notes = all.slice(0, Number.parseInt(options.limit, 10) || 30);

  if (options.json) {
    process.stdout.write(JSON.stringify({ notes }) + "\n");
    return;
  }
  if (options.tsv || !process.stdout.isTTY) {
    for (const note of notes) process.stdout.write(tsvLine([note.id, noteTitle(note), note.category, preview(note)]) + "\n");
    await rememberNotes(notes);
    return;
  }
  if (notes.length === 0) {
    process.stderr.write("No notes yet — `overlay note add \"…\"` writes the first one.\n");
    return;
  }
  process.stdout.write(`\n${listHeader(options.archived ? "Archived notes" : "Notes", all.length)}\n\n`);
  notes.forEach((note, index) => {
    const mark = note.is_favorite ? `${pc.cyan("★")} ` : "  ";
    const body = preview(note);
    const snippet = body.startsWith(noteTitle(note)) ? body.slice(noteTitle(note).length).trim() : body;
    process.stdout.write(ledgerRow({ index: index + 1, title: noteTitle(note), meta: metaFor(note), snippet, mark }) + "\n");
  });
  await rememberNotes(notes);
  process.stderr.write(pc.dim("show one: overlay note show <number> · pick: overlay note pick\n"));
}

async function printNote(ref: string, noteId: string, json?: boolean): Promise<void> {
  const result = await withActivity("Loading note", () => apiJson<{ note: Note }>(`/api/notes/${encodeURIComponent(noteId)}`));
  const { note } = result;
  if (json) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  const content = (note.content ?? "").trimEnd();
  if (!process.stdout.isTTY) {
    process.stdout.write(content + "\n");
    return;
  }
  const meta = metaFor(note);
  const body = [renderMarkdown(content || "_(empty note)_", terminalWidth() - 2), note.source_url ? `\n  ${pc.dim(note.source_url)}` : ""].join("");
  process.stdout.write(detailView({ title: `${note.is_favorite ? "★ " : ""}${noteTitle(note)}`, meta, body }) + "\n");
  if (/^\d{1,3}$/.test(ref)) process.stderr.write(pc.dim(`copy: overlay note show ${ref} | pbcopy\n`));
}

export async function commandNoteShow(ref: string, options: { json?: boolean }): Promise<void> {
  await printNote(ref, await resolveNoteRef(ref), options.json);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function commandNoteAdd(words: string[], options: { title?: string; json?: boolean }): Promise<void> {
  const fromArgs = words.length > 0 && !(words.length === 1 && words[0] === "-");
  if (!fromArgs && process.stdin.isTTY) {
    process.exitCode = 2;
    throw new Error('Pass the note as text or pipe it in: pbpaste | overlay note add');
  }
  const content = (fromArgs ? words.join(" ") : await readStdin()).trim();
  if (!content) {
    process.exitCode = 2;
    throw new Error("The note is empty.");
  }
  const body = { content, title: options.title?.trim() || null, saved_from: "cli" };
  const result = await withActivity(
    "Saving note",
    () =>
      apiJson<{ note: Note }>("/api/notes", {
        method: "POST",
        // A fixed retry key per command, so a repeated request can't create a duplicate.
        headers: { "content-type": "application/json", "x-overlay-note-id": randomUUID() },
        body: JSON.stringify(body),
      }),
    {
      done: (created, ms) => (options.json ? undefined : `Saved “${noteTitle(created.note)}” · ${seconds(ms)}`),
      doneAlways: true,
    },
  );
  await rememberNotes([result.note]);
  if (options.json) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  process.stderr.write(pc.dim("open it: overlay note show 1\n"));
}

export async function commandNotePick(options: { archived?: boolean; json?: boolean }): Promise<void> {
  requirePickerTerminal("overlay note list");
  const started = Date.now();
  const notes = await fetchNotes(options.archived);
  if (notes.length === 0) {
    process.stderr.write("No notes yet — `overlay note add \"…\"` writes the first one.\n");
    return;
  }
  const picked = await pickOne(
    `Pick a note ${pc.dim(`· ${notes.length} · ${seconds(Date.now() - started)}`)}`,
    notes.map((note) => ({
      value: note.id,
      title: noteTitle(note),
      description: preview(note),
      starred: Boolean(note.is_favorite),
      haystack: note.category ?? "",
    })),
  );
  if (picked) await printNote(picked, picked, options.json);
}
