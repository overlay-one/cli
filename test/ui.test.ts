import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";

import stringWidth from "string-width";

import { formatElapsed, markFrame, renderMarkdown, truncateToWidth } from "../src/ui.ts";

test("truncateToWidth leaves short text alone", () => {
  assert.equal(truncateToWidth("short", 10), "short");
});

test("truncateToWidth counts terminal columns, not characters", () => {
  const cut = truncateToWidth("二手奢侈品行业的财务与税务现状", 11);
  assert.ok(cut.endsWith("…"));
  assert.ok(stringWidth(cut) <= 11, `width ${stringWidth(cut)}`);
});

test("renderMarkdown renders lists and drops bold markers", () => {
  const plain = stripVTControlCharacters(renderMarkdown("* **Real purpose:** ship it\n* second", 80, { color: false }));
  assert.ok(plain.includes("Real purpose: ship it"));
  assert.ok(!plain.includes("**"));
  assert.ok(plain.includes("second"));
});

test("renderMarkdown marks the recommended rung with ▸", () => {
  const lines = stripVTControlCharacters(
    renderMarkdown("1. Artifact: a file\n2. Decision: pick one (recommended)", 80, { color: false }),
  ).split("\n");
  const marked = lines.filter((line) => line.startsWith("▸"));
  assert.equal(marked.length, 1);
  assert.match(marked[0] ?? "", /Decision: pick one/);
});

test("renderMarkdown wraps to the given width", () => {
  const long = "word ".repeat(60).trim();
  const lines = stripVTControlCharacters(renderMarkdown(long, 40, { color: false })).split("\n");
  assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => stringWidth(line) <= 44), lines.map((line) => stringWidth(line)).join(","));
});

test("formatElapsed renders minutes and zero-padded seconds", () => {
  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(23_400), "0:23");
  assert.equal(formatElapsed(65_000), "1:05");
});

test("markFrame lights exactly one layer and cycles through three", () => {
  const frames = [0, 1, 2, 3].map((index) => markFrame(index, { color: false }));
  assert.equal(frames[0], "━ ─ ─");
  assert.equal(frames[1], "─ ━ ─");
  assert.equal(frames[2], "─ ─ ━");
  assert.equal(frames[3], frames[0]);
});

test("renderMarkdown wraps long list items with a hanging indent", () => {
  const item = `* ${"long ".repeat(40).trim()}`;
  const lines = stripVTControlCharacters(renderMarkdown(item, 50, { color: false })).split("\n");
  assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => stringWidth(line) <= 50), lines.map((line) => stringWidth(line)).join(","));
  const bulletIndent = (lines[0] ?? "").indexOf("·");
  assert.ok((lines[1] ?? "").startsWith(" ".repeat(bulletIndent + 2)));
});
