import createClient from "openapi-fetch";

import type { components, paths } from "./schema";

export type ErrorResponse = components["schemas"]["ErrorResponse"];

// Endpoints whose 401 means "wrong credentials / no session", never "access token expired".
const NO_REFRESH = ["/auth/login", "/auth/signup", "/auth/refresh", "/auth/logout"].map(
  (path) => `/api/v1${path}`,
);

// One refresh at a time: parallel requests that all hit an expired access token share it.
let refreshing: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshing ??= fetch("/api/v1/auth/refresh", { method: "POST" })
    .then(
      (response) => response.ok,
      () => false,
    )
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** fetch that renews the short-lived access cookie once on 401 and retries the request. */
async function fetchWithRefresh(request: Request): Promise<Response> {
  const retry = request.clone();
  const response = await fetch(request);
  if (response.status !== 401 || NO_REFRESH.includes(new URL(request.url).pathname)) {
    return response;
  }
  return (await refreshSession()) ? fetch(retry) : response;
}

/** Raw `fetch` to the API with the same refresh-and-retry, for responses openapi-fetch can't
 *  parse (streams). Throws ApiRequestError when the server can't be reached or answers non-2xx. */
export async function apiFetch(path: `/api/v1/${string}`, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetchWithRefresh(new Request(path, init));
  } catch {
    throw new ApiRequestError(null, null);
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(response.status, asErrorResponse(body));
  }
  return response;
}

// Relative URLs: requests go to this origin and next.config.ts rewrites /api/v1/* to FastAPI,
// so the httpOnly auth cookies stay first-party. Browser-only: server components would need
// an absolute base URL and the user's cookies.
export const api = createClient<paths>({ fetch: fetchWithRefresh });

/** Thrown for any failed API call. `body` is null when the server was never reached. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number | null,
    readonly body: ErrorResponse | null,
  ) {
    super(body?.error.code ?? "network");
  }

  get code(): string | null {
    return this.body?.error.code ?? null;
  }

  /** The form field the API blamed (`detail.field`), if any. */
  get field(): string | null {
    const field = this.body?.error.detail?.field;
    return typeof field === "string" ? field : null;
  }
}

/** Turns an openapi-fetch result into data, or throws ApiRequestError. Use as a TanStack queryFn. */
export async function unwrap<T>(
  request: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: Awaited<typeof request>;
  try {
    result = await request;
  } catch {
    throw new ApiRequestError(null, null);
  }
  if (result.error !== undefined || result.data === undefined) {
    throw new ApiRequestError(result.response.status, asErrorResponse(result.error));
  }
  return result.data;
}

function asErrorResponse(value: unknown): ErrorResponse | null {
  // Proxies or a stopped API can answer with HTML or plain text instead of our error shape.
  const error = (value as Partial<ErrorResponse> | undefined)?.error;
  return typeof error?.message_key === "string" ? (value as ErrorResponse) : null;
}
