/**
 * signalfeed types.
 *
 * Seven tools wrapping the DataSignals Events API.
 * Every tool answers with the upstream body passed
 * through unchanged, as a single string, except
 * check_setup, which answers with a small JSON status
 * object of its own; failures are Errors carrying the
 * pinned error strings.
 */

export interface SearchEventsArgs {
  event_type?: string;
  ticker?: string;
  cik?: string;
  min_score?: number;
  since?: number;
  limit?: number;
}

export interface CompanyEventsArgs {
  company: string;
  since?: number;
  limit?: number;
}

export interface GetEventArgs {
  event_id: string;
}

/** The minimal slice of a fetch Response this client relies on. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** Injectable fetch, so tests never touch the live network. */
export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

/** Runtime dependencies for the core, all injectable in tests. */
export interface EventsDeps {
  /** Fetch implementation. Defaults to the global fetch. */
  fetchFn?: FetchFn;
  /** Environment (DATASIGNALS_KEY / DATASIGNALS_BASE_URL). Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** API key override. Defaults to env DATASIGNALS_KEY. */
  apiKey?: string;
  /** Base URL override. Defaults to env DATASIGNALS_BASE_URL or the default base. */
  baseUrl?: string;
  /** Per-request timeout in ms. Defaults to 30000 (cold starts can take ~15 s). */
  timeoutMs?: number;
}
