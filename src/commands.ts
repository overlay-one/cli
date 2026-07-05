// The five verbs (DESIGN.md §Commands). Human output is a numbered ledger —
// no UUIDs; ids live in --json, and numbered rows resolve via the result
// cache (`overlay download 3`). Data to stdout, messages to stderr.

import { readFile, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import pc from "picocolors";

import { ApiError, apiFetch, apiJson } from "./api.js";
import {
  apiBaseUrl,
  clearCredentials,
  loadCredentials,
  login,
  tokenEmail,
} from "./auth.js";
import {
  humanBytes,
  nodeTitle,
  printRow,
  rememberResults,
  resolveNodeRef,
  type BrainNode,
} from "./render.js";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".html": "text/html",
  ".csv": "text/csv",
  ".json": "application/json",
};

function mimeFor(filename: string): string {
  return MIME_BY_EXTENSION[extname(filename).toLowerCase()] ?? "application/octet-stream";
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

// --- login / logout / whoami ---

export async function commandLogin(): Promise<void> {
  const credentials = await login();
  const email = tokenEmail(credentials.access_token);
  process.stderr.write(pc.green(`Logged in${email ? ` as ${email}` : ""}.\n`));
}

export async function commandLogout(): Promise<void> {
  const removed = await clearCredentials();
  process.stderr.write(removed ? "Logged out.\n" : "No stored credentials.\n");
}

export async function commandWhoami(): Promise<void> {
  const credentials = await loadCredentials();
  if (!credentials) {
    process.stderr.write("Not logged in.\n");
    process.exitCode = 3;
    return;
  }
  const email = tokenEmail(credentials.access_token);
  process.stdout.write(`${pc.bold(email ?? "(unknown)")} ${pc.dim(`· ${apiBaseUrl()}`)}\n`);
}

// --- upload ---

export async function commandUpload(
  paths: string[],
  options: { name?: string; json?: boolean },
): Promise<void> {
  if (paths.length === 0) throw new Error("Nothing to upload.");
  if (paths.includes("-") && !options.name) {
    throw new Error("Reading stdin requires --name <filename>.");
  }

  const created: Array<{ node: BrainNode }> = [];
  for (const path of paths) {
    const fromStdin = path === "-";
    const bytes = fromStdin ? await readStdin() : await readFile(path);
    const filename = options.name ?? basename(path);

    const form = new FormData();
    // Copy into a plain ArrayBuffer: Buffer's backing store types as
    // ArrayBufferLike, which BlobPart refuses.
    const view = new Uint8Array(bytes.byteLength);
    view.set(bytes);
    form.set("file", new Blob([view], { type: mimeFor(filename) }), filename);
    form.set("original_name", filename);
    form.set("saved_from", "cli");

    const result = await apiJson<{ node: BrainNode }>("/api/brain/ingest/file", {
      method: "POST",
      body: form,
    });
    created.push(result);
    if (!options.json) {
      process.stdout.write(
        `${pc.green("✓")} ${pc.bold(nodeTitle(result.node))} ${pc.dim(
          `· ${result.node.kind ?? "file"} · ${humanBytes(bytes.length)}`,
        )}\n`,
      );
    }
  }
  await rememberResults(created.map((item) => item.node));
  if (options.json) {
    process.stdout.write(JSON.stringify(created.length === 1 ? created[0] : created) + "\n");
  } else if (created.length > 0) {
    process.stderr.write(pc.dim(`download with: overlay download 1\n`));
  }
}

// --- download ---

export async function commandDownload(
  nodeRef: string,
  options: { output?: string; annotated?: boolean },
): Promise<void> {
  const nodeId = await resolveNodeRef(nodeRef);
  const encoded = encodeURIComponent(nodeId);
  let output = options.output;
  if (!output) {
    const detail = await apiJson<{ node: BrainNode }>(`/api/brain/nodes/${encoded}`);
    output = nodeTitle(detail.node).replace(/[/\\]/g, "_");
  }
  const servePath = `/api/brain/nodes/${encoded}/serve${options.annotated ? "?annotated=1" : ""}`;
  const response = await apiFetch(servePath);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(output, bytes);
  process.stdout.write(`${output}\n`);
  process.stderr.write(pc.dim(`${pc.green("✓")} ${humanBytes(bytes.length)}\n`));
}

// --- search ---

export async function commandSearch(
  query: string,
  options: { kinds?: string; limit: string; json?: boolean },
): Promise<void> {
  const body = {
    query,
    kinds: options.kinds ? options.kinds.split(",").map((kind) => kind.trim()) : [],
    limit: Number.parseInt(options.limit, 10) || 10,
  };
  const result = await apiJson<{
    results: Array<{ node: BrainNode; score: number; snippet?: string | null }>;
    total: number;
  }>("/api/brain/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (options.json) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  if (result.results.length === 0) {
    process.stderr.write("No matches.\n");
    return;
  }
  process.stdout.write("\n");
  result.results.forEach((hit, index) => {
    printRow(index + 1, hit.node, { snippet: hit.snippet ?? hit.node.content });
  });
  await rememberResults(result.results.map((hit) => hit.node));
  process.stderr.write(
    pc.dim(`open one with: overlay download <number> · ids: --json\n`),
  );
}

// --- files ---

export async function commandFiles(options: {
  kinds: string;
  limit: string;
  json?: boolean;
}): Promise<void> {
  const kinds = encodeURIComponent(options.kinds);
  const limit = Number.parseInt(options.limit, 10) || 30;
  const result = await apiJson<{ nodes: BrainNode[]; total: number }>(
    `/api/brain/nodes?kinds=${kinds}&order=recent&limit=${limit}`,
  );

  if (options.json) {
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  if (result.nodes.length === 0) {
    process.stderr.write("No files yet — `overlay upload <file>` starts the library.\n");
    return;
  }
  process.stdout.write("\n");
  result.nodes.forEach((node, index) => {
    printRow(index + 1, node);
  });
  await rememberResults(result.nodes);
  process.stderr.write(
    pc.dim(
      `${result.nodes.length} of ${result.total} · download with: overlay download <number>\n`,
    ),
  );
}

export { ApiError };
