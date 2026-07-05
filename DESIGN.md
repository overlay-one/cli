# Overlay CLI — design

One tool, one job: **move files in and out of the brain, and search it,
from a terminal.** Not a staged v0 of something bigger — chat, export
tooling, and objectives are explicitly out of scope; if they ever matter
they are separate proposals.

The CLI is a fourth client (web, extension, iOS, **cli**) speaking the
same Bearer-token API the extension and iOS already use. Zero agent
changes, zero schema, one small web page for login.

## Commands

```
overlay login                        # browser handoff; stores tokens locally
overlay logout                       # forget stored credentials
overlay whoami                       # who the token belongs to

overlay upload <file...>             # ingest files into the brain
overlay upload -                     # read stdin (requires --name)
    --name <filename>                # override the stored filename
    --json                           # print created node(s) as JSON

overlay download <node-id>           # fetch a stored file
    -o, --output <path>              # default: the node's original filename
    --annotated                      # PDFs: bake sticky highlights in

overlay search <query>               # hybrid search over the whole brain
    --kinds file,note,webpage        # optional kind filter
    --limit 10
    --json

overlay files                        # recent file/image/webpage sources
    --kinds file,image,webpage
    --limit 30
    --json
```

UX rules:

- Human output is one line per thing (`id  kind  title/score`), wide
  content truncated; `--json` is the machine contract and prints the raw
  API payload untouched.
- Exit codes: 0 ok, 1 API/network error, 2 usage error, 3 not logged in.
- Errors go to stderr; data to stdout — `overlay search x --json | jq`
  must always work.
- No spinners, no color requirements, no interactive prompts outside
  `login`. Pipes are the primary audience.

## Auth

The web API already accepts `Authorization: Bearer <supabase access
token>` on every route (`lib/supabase/server.ts`, built for "extension
and API clients"). The CLI reuses that. The only missing piece is
*getting* a token into the terminal:

1. `overlay login` starts a loopback HTTP listener on a random
   `127.0.0.1` port with a one-time `state` nonce, then opens
   `https://overlay.one/cli-auth?port=<port>&state=<nonce>`.
2. `/cli-auth` is a small client-side page behind the normal session
   (signed-out users see a sign-in link that returns here). It shows an
   explicit **"Authorize Overlay CLI"** button — nothing is sent without
   a click. On click it POSTs to
   `http://127.0.0.1:<port>/callback`:

   ```json
   {
     "state": "<nonce>",
     "access_token": "…",
     "refresh_token": "…",
     "supabase_url": "…",
     "supabase_anon_key": "…"
   }
   ```

   Browsers treat `127.0.0.1` as a trustworthy origin, so the HTTPS page
   may fetch it; the listener answers the CORS preflight for the
   overlay.one origin only, checks the nonce, and shuts down after one
   request or 2 minutes.
3. Shipping the (public) Supabase URL + anon key in the payload means
   the CLI bakes **no constants** and refresh works against any
   deployment the user logged into.

Storage: `~/.config/overlay/credentials.json`, `chmod 600` — the same
model as `gh`'s hosts file. Refresh: on any 401 the CLI calls Supabase's
token endpoint (`grant_type=refresh_token`, anon key) once, persists the
new pair, retries the request once, and otherwise exits 3 with
"run `overlay login`".

Escape hatches, no code needed: `OVERLAY_TOKEN` (skip the file, use this
access token) and `OVERLAY_API_URL` (default `https://overlay.one`,
point it at localhost:3000 for dev).

Tokens never appear in argv, logs, or error messages.

## API contracts used (all existing, verified against clients)

| Command | Endpoint | Notes |
|---|---|---|
| upload | `POST /api/brain/ingest/file` | multipart: `file` part + `original_name` + `saved_from=cli` (the status page's capture-sources table gets a `cli` bucket for free — it falls into "other" until the bucket is added, one CASE line) |
| download | `GET /api/brain/nodes/{id}/serve[?annotated=1]` | 302 → presigned R2 URL; fetch follows. Filename from `GET /api/brain/nodes/{id}` payload when `-o` is absent |
| search | `POST /api/brain/search` | `{query, kinds?, limit}` → `{results: [{node, score, snippet}], total}` |
| files | `GET /api/brain/nodes?kinds=…&order=recent&limit=…` | same listing iOS Files uses |
| whoami | none | decodes the JWT's `email` claim locally |

## Implementation

- **TypeScript, Node ≥ 20** (native `fetch`/`FormData`/`Blob` — zero HTTP
  deps), `commander` for argv. That is the *only* runtime dependency.
- Self-contained `cli/` package (own `package.json`; the repo root is a
  Next app, not a workspace — nothing there changes). `tsup` bundles to
  `dist/overlay.js` with a bin entry; `pnpm build && npm link` for local
  install; publishing is a later decision.
- Layout, ~4 files, small:

  ```
  cli/src/index.ts      # program + command wiring
  cli/src/auth.ts       # login flow, credential store, refresh
  cli/src/api.ts        # fetch wrapper (bearer, retry-on-401, errors)
  cli/src/commands.ts   # upload / download / search / files / whoami
  ```

- Web-side addition (the only one): `app/cli-auth/page.tsx` (client
  component, reads the session via the browser Supabase client) plus a
  `/cli-auth` exemption in `middleware.ts` beside `/status` so the page
  lives outside the locale tree.

## Testing / verification

- `cli`: typecheck + a smoke script that runs `upload → files → search →
  download` against a real login and diffs the downloaded bytes against
  the uploaded file (round-trip is the whole point of the tool).
- Web: the release audit must stay green (`pnpm test:test-plan-audit`);
  the new page adds no env vars and no audited markers.

## Non-goals

Chat/ask, recap/delta, objectives, export/import, notes editing,
config profiles, Windows keychain integration (the 600-file is the
storage story everywhere). Each of these is a new discussion, not a
backlog.

## Open questions

1. **Package name / distribution** — `overlay` bin name assumed; npm
   publish vs. GitHub release tarball undecided. *Lean: decide after it
   proves useful locally.*
2. **Upload batching** — multiple files upload sequentially (simple,
   ordered output). Parallelism only if real usage hurts.
3. **`saved_from=cli` bucket** — add the one-line CASE to the status
   page's capture-sources query now or when CLI traffic exists? *Lean:
   now, it's one line in the same PR.*
