// Login via browser handoff (DESIGN.md §Auth): `overlay login` runs a
// one-shot loopback listener; the authorize page on the web app POSTs the
// session tokens (plus the public Supabase coordinates, so nothing is baked
// into this binary) after an explicit click. Tokens live in
// ~/.config/overlay/credentials.json at mode 600 and refresh on 401.

import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

export type Credentials = {
  access_token: string;
  refresh_token?: string;
  supabase_url?: string;
  supabase_anon_key?: string;
};

const CONFIG_DIR = join(homedir(), ".config", "overlay");
const CREDENTIALS_PATH = join(CONFIG_DIR, "credentials.json");
const LOGIN_TIMEOUT_MS = 2 * 60 * 1000;

export class NotLoggedInError extends Error {
  constructor() {
    super("Not logged in — run `overlay login` (or set OVERLAY_TOKEN).");
  }
}

export function apiBaseUrl(): string {
  return (process.env.OVERLAY_API_URL ?? "https://overlay.one").replace(/\/+$/, "");
}

export async function loadCredentials(): Promise<Credentials | null> {
  const envToken = process.env.OVERLAY_TOKEN;
  if (envToken) return { access_token: envToken };
  try {
    return JSON.parse(await readFile(CREDENTIALS_PATH, "utf8")) as Credentials;
  } catch {
    return null;
  }
}

export async function saveCredentials(credentials: Credentials): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2) + "\n");
  await chmod(CREDENTIALS_PATH, 0o600);
}

export async function clearCredentials(): Promise<boolean> {
  try {
    await rm(CREDENTIALS_PATH);
    return true;
  } catch {
    return false;
  }
}

/** The JWT's email claim, decoded locally — no network. */
export function tokenEmail(accessToken: string): string | null {
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof decoded.email === "string" ? decoded.email : null;
  } catch {
    return null;
  }
}

/** Exchange the refresh token for a new pair; persists and returns it. */
export async function refreshCredentials(
  credentials: Credentials,
): Promise<Credentials | null> {
  const { refresh_token, supabase_url, supabase_anon_key } = credentials;
  if (!refresh_token || !supabase_url || !supabase_anon_key) return null;
  const response = await fetch(
    `${supabase_url.replace(/\/+$/, "")}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: supabase_anon_key,
      },
      body: JSON.stringify({ refresh_token }),
    },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!body.access_token) return null;
  const next: Credentials = {
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? refresh_token,
    supabase_url,
    supabase_anon_key,
  };
  await saveCredentials(next);
  return next;
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  const child = spawn(command, [url], { stdio: "ignore", detached: true });
  child.on("error", () => {
    // Headless / no opener: the printed URL is the fallback.
  });
  child.unref();
}

/** The interactive login flow. Resolves with saved credentials. */
export async function login(): Promise<Credentials> {
  const base = apiBaseUrl();
  const state = randomBytes(16).toString("hex");

  return await new Promise<Credentials>((resolve, reject) => {
    const server = createServer((request, response) => {
      const allowOrigin = new URL(base).origin;
      response.setHeader("Access-Control-Allow-Origin", allowOrigin);
      response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "content-type");

      if (request.method === "OPTIONS") {
        response.writeHead(204).end();
        return;
      }
      if (request.method !== "POST" || request.url?.split("?")[0] !== "/callback") {
        response.writeHead(404).end();
        return;
      }

      let raw = "";
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", async () => {
        try {
          const body = JSON.parse(raw) as Credentials & { state?: string };
          if (body.state !== state || !body.access_token) {
            response.writeHead(400, { "content-type": "application/json" });
            response.end(JSON.stringify({ ok: false }));
            return;
          }
          const credentials: Credentials = {
            access_token: body.access_token,
            refresh_token: body.refresh_token,
            supabase_url: body.supabase_url,
            supabase_anon_key: body.supabase_anon_key,
          };
          await saveCredentials(credentials);
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ ok: true }));
          finish(() => resolve(credentials));
        } catch {
          response.writeHead(400).end();
        }
      });
    });

    const timeout = setTimeout(() => {
      finish(() => reject(new Error("Login timed out — no authorization received.")));
    }, LOGIN_TIMEOUT_MS);

    function finish(settle: () => void): void {
      clearTimeout(timeout);
      // Let the in-flight response flush before the process moves on.
      setImmediate(() => server.close());
      settle();
    }

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        finish(() => reject(new Error("Could not open a loopback port.")));
        return;
      }
      const url = `${base}/cli-auth?port=${address.port}&state=${state}`;
      process.stderr.write(
        `Opening ${url}\nIf the browser does not open, visit it manually.\n`,
      );
      openBrowser(url);
    });
  });
}
