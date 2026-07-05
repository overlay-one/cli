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
overlay download <node-id> --annotated # PDFs come back with your highlights
```

Pipes are the point: `--json` on every read command, data on stdout,
messages on stderr.

```sh
overlay search "RAG decoding" --json | jq -r '.results[].node.id'
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
