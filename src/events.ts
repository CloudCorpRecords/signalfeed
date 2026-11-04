/**
 * signalfeed core: seven tools over the DataSignals
 * Events API (twelve US filing-event streams in one
 * schema behind one key).
 *
 * Shared rules, as documented in the spec:
 * - The API key is read from env `DATASIGNALS_KEY` and
 *   travels as `Authorization: Bearer <key>` — never as
 *   a query parameter.
 * - `list_event_types` and `feed_health` are keyless by
 *   design: they never attach the key, set or not.
 * - The keyed tools (`search_events`, `company_events`,
 *   `get_event`, `usage`) fail with
 *   `DATASIGNALS_KEY is not set` before any fetch when
 *   the key is missing.
 * - The base URL defaults to
 *   `https://datasignalslab.com` and is overridable via
 *   env `DATASIGNALS_BASE_URL` (trailing slash stripped),
 *   or the injectable deps in tests.
 * - Only the filters that are set are sent as query
 *   parameters; `event_id` and `company` path segments
 *   are URL-encoded.
 * - A 2xx call returns the upstream body as text, passed
 *   through verbatim (a quota-exhausted feed answers a
 *   200 empty page with the cursor intact — also
 *   verbatim).
 * - Cold start (labelled rule): when a non-2xx
 *   response's JSON body carries `status: "starting_up"`
 *   or an error field mentioning starting_up, that body
 *   is returned verbatim as a normal result — the API
 *   defines it as an answer, not a failure.
 * - Any other non-2xx upstream response fails with
 *   `datasignals error: HTTP <status>`; a throwing or
 *   timed-out fetch fails with `datasignals unreachable`.
 * - The per-request timeout defaults to 30000 ms (cold
 *   starts can take ~15 s); tests override it via deps.
 * - Upstream access goes through the injectable fetch in
 *   deps, so tests run against a fake fetch only.
 *
 * Wires (pinned by the vendor's Events API page):
 * GET `<base>/v1/events` with only the set filters as
 * query parameters; GET `<base>/v1/companies/<company>/
 * events` with `since`/`limit` when set;
 * GET `<base>/v1/events/<event_id>`;
 * GET `<base>/v1/event-types` (keyless);
 * GET `<base>/v1/health` (keyless);
 * GET `<base>/v1/usage`.
 */
import type {
  CompanyEventsArgs,
  EventsDeps,
  FetchFn,
  FetchResponseLike,
  GetEventArgs,
  SearchEventsArgs,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_BASE_URL = "https://datasignalslab.com";

export const DEFAULT_TIMEOUT_MS = 30000;

/** The twelve pinned stream ids, in the API's documented order. */
export const EVENT_TYPES = [
  "insider_cluster",
  "insider_sale_notice",
  "activist_stake",
  "institutional_holding",
  "material_event",
  "private_raise",
  "fda_action",
  "biotech_catalyst",
  "nih_grant",
  "gov_contract_award",
  "congress_trade",
  "hiring_signal",
] as const;

function envOf(deps: EventsDeps): Record<string, string | undefined> {
  return deps.env ?? process.env;
}

function baseUrl(deps: EventsDeps): string {
  if (deps.baseUrl && deps.baseUrl.trim() !== "") {
    return deps.baseUrl.trim().replace(/\/+$/, "");
  }
  const raw = envOf(deps).DATASIGNALS_BASE_URL;
  const base = raw && raw.trim() !== "" ? raw.trim() : DEFAULT_BASE_URL;
  return base.replace(/\/+$/, "");
}

function apiKey(deps: EventsDeps): string | undefined {
  const key = deps.apiKey ?? envOf(deps).DATASIGNALS_KEY;
  return key ? key : undefined;
}

function requireKey(deps: EventsDeps): string {
  const key = apiKey(deps);
  if (key === undefined) {
    throw new Error("DATASIGNALS_KEY is not set");
  }
  return key;
}

async function defaultFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<FetchResponseLike> {
  return fetch(url, init);
}

function fetchFn(deps: EventsDeps): FetchFn {
  return deps.fetchFn ?? defaultFetch;
}

function timeoutMs(deps: EventsDeps): number {
  return deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
}

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function optionalStringParam(
  params: URLSearchParams,
  name: string,
  value: unknown,
): void {
  if (value === undefined) return;
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  params.set(name, value);
}

function optionalNumberParam(
  params: URLSearchParams,
  name: string,
  value: unknown,
): void {
  if (value === undefined) return;
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${name} must be a number`);
  }
  params.set(name, String(value));
}

function optionalIntegerParam(
  params: URLSearchParams,
  name: string,
  value: unknown,
): void {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }
  params.set(name, String(value));
}

function withQuery(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs === "" ? path : `${path}?${qs}`;
}

/** True when a non-2xx body is the API's cold-start answer. */
function isStartingUp(body: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null) return false;
  const rec = parsed as Record<string, unknown>;
  if (rec.status === "starting_up") return true;
  const err = rec.error;
  if (typeof err === "string" && err.includes("starting_up")) return true;
  if (typeof err === "object" && err !== null) {
    const msg = (err as Record<string, unknown>).message;
    if (typeof msg === "string" && msg.includes("starting_up")) return true;
  }
  return false;
}

/**
 * Run one GET against the API and return the raw status
 * and body text. A throwing or timed-out fetch fails
 * with `datasignals unreachable`. When `keyed` is true
 * the key is required (checked before any fetch) and is
 * sent as a Bearer header; when false no key is ever
 * attached, set or not.
 */
async function rawGet(
  deps: EventsDeps,
  path: string,
  keyed: boolean,
): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = {};
  if (keyed) {
    headers.Authorization = `Bearer ${requireKey(deps)}`;
  }
  const url = `${baseUrl(deps)}${path}`;
  const ms = timeoutMs(deps);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("request timed out"));
    }, ms);
  });
  let res: FetchResponseLike;
  try {
    res = await Promise.race([
      fetchFn(deps)(url, { method: "GET", headers, signal: controller.signal }),
      timeout,
    ]);
  } catch {
    throw new Error("datasignals unreachable");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return { status: res.status, body: await res.text() };
}

/**
 * Run one GET and apply the shared result rules: 2xx
 * bodies pass through verbatim; a `starting_up` body on
 * a non-2xx response is returned verbatim as a normal
 * result; any other non-2xx fails with
 * `datasignals error: HTTP <status>`.
 */
async function callApi(
  deps: EventsDeps,
  path: string,
  keyed: boolean,
): Promise<string> {
  const { status, body } = await rawGet(deps, path, keyed);
  if (status >= 200 && status < 300) return body;
  if (isStartingUp(body)) return body;
  throw new Error(`datasignals error: HTTP ${status}`);
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */

/**
 * Search filing events across all twelve streams.
 * Wire: GET <base>/v1/events with only the set filters
 * (event_type, ticker, cik, min_score, since, limit) as
 * query parameters. Keyed.
 */
export async function searchEvents(
  args: SearchEventsArgs,
  deps: EventsDeps = {},
): Promise<string> {
  requireKey(deps);
  const a = (args ?? {}) as unknown as Record<string, unknown>;
  const params = new URLSearchParams();
  optionalStringParam(params, "event_type", a.event_type);
  optionalStringParam(params, "ticker", a.ticker);
  optionalStringParam(params, "cik", a.cik);
  optionalNumberParam(params, "min_score", a.min_score);
  optionalIntegerParam(params, "since", a.since);
  optionalIntegerParam(params, "limit", a.limit);
  return callApi(deps, withQuery("/v1/events", params), true);
}

/**
 * Everything filed on one company, across all streams.
 * Wire: GET <base>/v1/companies/<company>/events with
 * since/limit when set; the company path segment is
 * URL-encoded. Keyed.
 */
export async function companyEvents(
  args: CompanyEventsArgs,
  deps: EventsDeps = {},
): Promise<string> {
  requireKey(deps);
  const a = (args ?? {}) as unknown as Record<string, unknown>;
  const company = requireNonEmptyString(a.company, "company");
  const params = new URLSearchParams();
  optionalIntegerParam(params, "since", a.since);
  optionalIntegerParam(params, "limit", a.limit);
  return callApi(
    deps,
    withQuery(`/v1/companies/${encodeURIComponent(company)}/events`, params),
    true,
  );
}

/**
 * Show everything on one event, by its event_id.
 * Wire: GET <base>/v1/events/<event_id>; the event_id
 * path segment is URL-encoded. Keyed.
 */
export async function getEvent(
  args: GetEventArgs,
  deps: EventsDeps = {},
): Promise<string> {
  requireKey(deps);
  const a = (args ?? {}) as unknown as Record<string, unknown>;
  const eventId = requireNonEmptyString(a.event_id, "event_id");
  return callApi(deps, `/v1/events/${encodeURIComponent(eventId)}`, true);
}

/**
 * Which fields each stream carries, and whether its
 * score can be recomputed.
 * Wire: GET <base>/v1/event-types. Keyless: the key is
 * never attached, set or not.
 */
export async function listEventTypes(deps: EventsDeps = {}): Promise<string> {
  return callApi(deps, "/v1/event-types", false);
}

/**
 * How current each stream is right now.
 * Wire: GET <base>/v1/health. Keyless: the key is never
 * attached, set or not.
 */
export async function feedHealth(deps: EventsDeps = {}): Promise<string> {
  return callApi(deps, "/v1/health", false);
}

/**
 * How much of the monthly event allowance is used, and
 * when it resets.
 * Wire: GET <base>/v1/usage. Keyed.
 */
export async function usage(deps: EventsDeps = {}): Promise<string> {
  requireKey(deps);
  return callApi(deps, "/v1/usage", true);
}

/**
 * Whether the API key is configured and whether the
 * feed answers. Always a normal text result (never an
 * error): a JSON object {key_configured, feed_reachable,
 * detail}. feed_reachable is whether a keyless
 * GET /v1/health through the injected fetch returned
 * 2xx; detail names the health status or the failure.
 * No key is sent, and the key value never appears in
 * the output.
 */
export async function checkSetup(deps: EventsDeps = {}): Promise<string> {
  const keyConfigured = apiKey(deps) !== undefined;
  let feedReachable = false;
  let detail: string;
  try {
    const { status } = await rawGet(deps, "/v1/health", false);
    feedReachable = status >= 200 && status < 300;
    detail = `health endpoint answered with HTTP ${status}`;
  } catch {
    detail = "health check failed: datasignals unreachable";
  }
  return JSON.stringify({
    key_configured: keyConfigured,
    feed_reachable: feedReachable,
    detail,
  });
}
