// One fetch wrapper: bearer auth, a single refresh-and-retry on 401, and
// errors normalized to messages the command layer can print to stderr.

import {
  NotLoggedInError,
  apiBaseUrl,
  loadCredentials,
  refreshCredentials,
  type Credentials,
} from "./auth.js";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      detail?: unknown;
      error?: { message?: unknown };
      message?: unknown;
    };
    const detail = body.detail ?? body.error?.message ?? body.message;
    if (typeof detail === "string" && detail) return detail;
  } catch {
    // Non-JSON error body — fall through to the status line.
  }
  return `${response.status} ${response.statusText}`;
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  let credentials = await loadCredentials();
  if (!credentials) throw new NotLoggedInError();

  const call = (creds: Credentials) =>
    fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${creds.access_token}`,
      },
    });

  let response = await call(credentials);
  if (response.status === 401) {
    const refreshed = await refreshCredentials(credentials);
    if (!refreshed) throw new NotLoggedInError();
    credentials = refreshed;
    response = await call(credentials);
  }
  if (!response.ok) {
    throw new ApiError(await errorMessage(response), response.status);
  }
  return response;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  const body = (await response.json()) as { data?: T } & T;
  // Some web routes wrap payloads in { data }; the agent proxy does not.
  return (body.data ?? body) as T;
}
