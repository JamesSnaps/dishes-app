import {
  ApiError,
  NetworkTimeoutError,
  SessionExpiredError,
  type SyncPullResponse,
  type SyncPushResponse,
  type QueuedMutation,
} from "./types";

/**
 * Typed HTTP client for the Dishes client API.
 *
 * `baseUrl` decides which door it uses: `/api/web` from the browser (Authelia
 * session, identity headers injected at the proxy) or `/api/v1` from a native
 * client with a bearer token. The handlers behind both are identical.
 */
export type ApiClientOptions = {
  baseUrl: string;
  /**
   * How long to wait before giving up on a request. Default 8s.
   *
   * The value that matters is not "how slow can the server be" but "how long
   * should a phone on a weak signal hold a connection open before deciding it
   * is effectively offline". Without this, a stalled request hangs until the
   * browser's own limit — minutes — while every subsequent navigation queues
   * another one behind it.
   */
  timeoutMs?: number;
  /** Supplies an access token for native clients. Omit in the browser. */
  getToken?: () => string | null | Promise<string | null>;
  fetchImpl?: typeof fetch;
};

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getToken?: ApiClientOptions["getToken"];
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.getToken = opts.getToken;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 8_000;
  }

  private async request<T>(
    path: string,
    init: RequestInit & { signal?: AbortSignal } = {}
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const token = await this.getToken?.();
    if (token) headers.set("authorization", `Bearer ${token}`);

    // Combined manually rather than with AbortSignal.any() so the timer is
    // always cleared — an uncancelled timeout would keep a handle alive for its
    // full duration after every successful request.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onCallerAbort = () => controller.abort();
    init.signal?.addEventListener("abort", onCallerAbort);

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers,
        // The browser door relies on the Authelia session cookie.
        credentials: this.getToken ? "omit" : "same-origin",
      });
    } catch (err) {
      // A caller-triggered abort is deliberate and not a timeout; anything else
      // reaching here with an aborted signal is ours.
      if (controller.signal.aborted && !init.signal?.aborted) {
        throw new NetworkTimeoutError(this.timeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", onCallerAbort);
    }

    if (res.status === 204) return undefined as T;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      // An Authelia redirect to the login portal lands here as HTML.
      if (res.redirected || res.status === 200 || res.status === 401) {
        throw new SessionExpiredError();
      }
      throw new ApiError(`Unexpected ${res.status} response`, res.status);
    }

    const body = (await res.json()) as T & {
      error?: { code?: string; message?: string };
    };

    if (!res.ok) {
      throw new ApiError(
        body?.error?.message ?? `Request failed (${res.status})`,
        res.status,
        body?.error?.code
      );
    }

    return body as T;
  }

  // --- Sync -----------------------------------------------------------------

  /** Omit the cursor for a full snapshot. */
  pull(cursor: string | null, limit?: number, signal?: AbortSignal) {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (limit) params.set("limit", String(limit));
    const qs = params.toString();
    return this.request<SyncPullResponse>(`/sync${qs ? `?${qs}` : ""}`, { signal });
  }

  push(mutations: QueuedMutation[], signal?: AbortSignal) {
    return this.request<SyncPushResponse>("/sync", {
      method: "POST",
      // queuedAt is local bookkeeping; the server neither wants nor accepts it.
      body: JSON.stringify({
        mutations: mutations.map(({ opId, type, payload }) => ({
          opId,
          type,
          payload,
        })),
      }),
      signal,
    });
  }

  // --- Direct reads ---------------------------------------------------------
  // For things the local store deliberately doesn't hold, or when a caller
  // needs authoritative data rather than the cached copy.

  whoami() {
    return this.request<{
      transport: string;
      user: { username: string; displayName: string; groups: string[] };
      household: { householdId: string; memberId: string; role: string };
    }>("/auth/whoami");
  }

  getRecipe(id: string) {
    return this.request<{ recipe: Record<string, unknown> }>(`/recipes/${id}`);
  }

  getShoppingList() {
    return this.request<{
      listId: string | null;
      listName: string | null;
      items: Record<string, unknown>[];
    }>("/shopping");
  }
}
