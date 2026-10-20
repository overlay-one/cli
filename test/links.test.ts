import assert from "node:assert/strict";
import { test } from "node:test";

import { nodePath, notePath, promptPath, sourceUrl } from "../src/links.ts";

const ID = "3e273449-0175-4962-9f5d-dd5de77cd244";

test("notes and prompts open on their own pages", () => {
  assert.equal(notePath(ID), `/notes/${ID}`);
  assert.equal(promptPath(ID), `/prompts/${ID}`);
});

test("a note node opens as a note, a file in the reader", () => {
  assert.equal(nodePath({ id: ID, kind: "note" }), `/notes/${ID}`);
  assert.equal(nodePath({ id: ID, kind: "file" }), `/files/${ID}/read`);
});

test("other kinds open on their trace in the artifacts view", () => {
  assert.equal(nodePath({ id: ID, kind: "webpage" }), `/brain/artifacts?trace=${ID}`);
  assert.equal(nodePath({ id: ID }), `/brain/artifacts?trace=${ID}`);
});

test("ids are URL-encoded", () => {
  assert.equal(notePath("a/b"), "/notes/a%2Fb");
});

test("sourceUrl reads a saved page's original address, http(s) only", () => {
  assert.equal(sourceUrl({ id: ID, payload: { url: "https://example.com/a" } }), "https://example.com/a");
  assert.equal(sourceUrl({ id: ID, payload: { source_url: "http://x.dev" } }), "http://x.dev");
  assert.equal(sourceUrl({ id: ID, payload: { url: "javascript:alert(1)" } }), null);
  assert.equal(sourceUrl({ id: ID }), null);
});

import { modelFromName } from "../src/links.ts";

test("modelFromName infers the provider from the model name", () => {
  assert.deepEqual(modelFromName("claude-sonnet-5-5"), { name: "claude-sonnet-5-5", provider: "anthropic" });
  assert.deepEqual(modelFromName("gpt-6-luna"), { name: "gpt-6-luna", provider: "openai" });
  assert.deepEqual(modelFromName("gemini-4-argon"), { name: "gemini-4-argon", provider: "gemini" });
  assert.deepEqual(modelFromName("models/gemini-3.8-flash"), { name: "models/gemini-3.8-flash", provider: "gemini" });
  assert.equal(modelFromName("llama-3"), null);
});
