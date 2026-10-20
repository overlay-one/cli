// `overlay open`, `overlay note open`, `overlay prompt open` — open an item
// on overlay.one in the browser. The URL also goes to stdout, so it can be
// copied or piped where no browser opener exists.

import pc from "picocolors";

import { apiJson } from "./api.js";
import { apiBaseUrl, openBrowser } from "./auth.js";
import { nodePath, sourceUrl } from "./links.js";
import { nodeTitle, resolveNodeRef, type BrainNode } from "./render.js";
import { symbols, withActivity } from "./ui.js";

export function openUrl(url: string, label: string): void {
  openBrowser(url);
  process.stdout.write(`${url}\n`);
  process.stderr.write(`${symbols.ok()} Opened ${pc.bold(label)}\n`);
}

export const webUrl = (path: string): string => `${apiBaseUrl()}${path}`;

/** Open a search/files/upload result in Overlay, or with --source the saved page's original URL. */
export async function commandOpen(ref: string, options: { source?: boolean }): Promise<void> {
  const nodeId = await resolveNodeRef(ref);
  const { node } = await withActivity("Finding it", () =>
    apiJson<{ node: BrainNode }>(`/api/brain/nodes/${encodeURIComponent(nodeId)}`),
  );
  if (options.source) {
    const original = sourceUrl(node);
    if (!original) {
      process.exitCode = 2;
      throw new Error("This item has no original web address; open it without --source.");
    }
    openUrl(original, nodeTitle(node));
    return;
  }
  openUrl(webUrl(nodePath(node)), nodeTitle(node));
}
