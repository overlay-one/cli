# overlay

Move files in and out of your [Overlay](https://overlay.one) brain, and
search it, from a terminal. Everything you upload lands in the same
connected memory the web app, browser extension, and iOS app share —
organized, linked, and searchable.

```sh
npm i -g @overlay-one/cli

overlay login                          # one browser click
overlay upload paper.pdf notes.md      # into your brain
cat journal.md | overlay upload - --name journal.md
overlay search "prompt caching"        # hybrid search over everything
overlay files                          # recent sources
overlay download 2 --annotated        # row 2 of the last listing; PDFs keep your highlights
pbpaste | overlay prompt | pbcopy      # rewrite a prompt to ask for more ambitious work
overlay prompt list                    # your saved prompts
```

Human output is a numbered ledger — titles, kinds, ages; no UUIDs.
`overlay download <number>` resolves rows from the last listing. For
scripting, `--json` prints raw API payloads (ids included), data on
stdout, messages on stderr.

```sh
overlay search "RAG decoding" --json | jq -r '.results[].node.id'
```

## Prompt optimizer

`overlay prompt` sends a prompt through the same optimizer as the web
Prompts editor. The rewritten prompt goes to stdout; the diagnosis,
ladder, and deferred line go to stderr, so pipes get only the prompt.
It runs on Overlay's Pro model and can take up to two minutes.

```sh
pbpaste | overlay prompt | pbcopy
overlay prompt "Summarize this paper" --context "I have the PDF and 30 minutes"
overlay prompt --full < draft.txt      # all four sections as Markdown
overlay prompt list                    # saved prompts from overlay.one/prompts
overlay prompt show 2 | overlay prompt # optimize a saved prompt
```

## Auth

`overlay login` opens `overlay.one/cli-auth`; you click **Authorize**
once and the page hands a token to a one-shot listener on `127.0.0.1`.
Credentials live in `~/.config/overlay/credentials.json` (mode 600) and
refresh automatically. `overlay logout` forgets them.

Environment overrides: `OVERLAY_TOKEN` (use this access token, skip the
file) and `OVERLAY_API_URL` (default `https://overlay.one`).

## Exit codes

`0` ok · `1` API/network error · `2` usage error · `3` not logged in

## Development

```sh
pnpm install
pnpm typecheck
pnpm build        # dist/overlay.js
node dist/overlay.js --help
```

Design notes: [DESIGN.md](DESIGN.md). MIT licensed.
