// Where each item lives on the web, mirroring the web app's own routes
// (lib/notes/node-links.ts there): notes → /notes/:id, files → the reader,
// prompts → /prompts/:id, everything else → its trace in the artifacts view.
// Pure so it can be unit-tested; callers prefix the API host.

type LinkableNode = { id: string; kind?: string; payload?: Record<string, unknown> };

const enc = encodeURIComponent;

export const notePath = (id: string): string => `/notes/${enc(id)}`;
export const promptPath = (id: string): string => `/prompts/${enc(id)}`;

export function nodePath(node: LinkableNode): string {
  if (node.kind === "note") return notePath(node.id);
  if (node.kind === "file") return `/files/${enc(node.id)}/read`;
  return `/brain/artifacts?trace=${enc(node.id)}`;
}

/** The original address of a saved web page, when it has a safe one. */
export function sourceUrl(node: LinkableNode): string | null {
  const payload = node.payload ?? {};
  const candidate = payload["url"] ?? payload["source_url"];
  return typeof candidate === "string" && /^https?:\/\//i.test(candidate) ? candidate : null;
}
