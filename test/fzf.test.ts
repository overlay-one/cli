import assert from "node:assert/strict";
import { test } from "node:test";

import { fzfArgs, previewCommand, shellQuote, wantsFzf } from "../src/fzf.ts";

test("shellQuote wraps in single quotes and escapes embedded ones", () => {
  assert.equal(shellQuote("/usr/bin/node"), "'/usr/bin/node'");
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
});

test("previewCommand reruns this CLI with fzf's first field", () => {
  assert.equal(
    previewCommand("/opt/node", "/opt/overlay.js", ["note", "show"]),
    "'/opt/node' '/opt/overlay.js' note show {1}",
  );
});

test("fzfArgs hides the id column and wires the preview", () => {
  const args = fzfArgs("Pick a note", "PREVIEW {1}");
  assert.ok(args.includes("--delimiter=\t"));
  assert.ok(args.includes("--with-nth=2.."));
  const preview = args.indexOf("--preview");
  assert.equal(args[preview + 1], "PREVIEW {1}");
  assert.ok(args.some((arg) => arg.startsWith("--prompt=Pick a note")));
});

test("wantsFzf reads OVERLAY_PICKER case-insensitively", () => {
  assert.equal(wantsFzf({ OVERLAY_PICKER: "fzf" }), true);
  assert.equal(wantsFzf({ OVERLAY_PICKER: "FZF" }), true);
  assert.equal(wantsFzf({ OVERLAY_PICKER: "builtin" }), false);
  assert.equal(wantsFzf({}), false);
});
