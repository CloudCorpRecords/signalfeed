import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkSetup,
  companyEvents,
  feedHealth,
  getEvent,
  listEventTypes,
  searchEvents,
  usage,
} from "../src/events.js";
import type { EventsDeps, FetchFn } from "../src/types.js";

/**
 * Every test runs against an injected fake fetch and an
 * injected env: no live network, no live call is made.
 * The CLI tests spawn the real CLI through tsx and only
 * exercise paths that fail before any request, plus a
 * check_setup run pointed at a refused loopback port.
 */

type Captured = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

function makeFetch(
  handler: (url: string) => { status?: number; body: unknown },
  captured: Captured[] = [],
): FetchFn {
  return async (url, init) => {
    captured.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
    const r = handler(url);
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
    };
  };
}

const okFetch = (body: unknown = { ok: true }, captured: Captured[] = []) =>
  makeFetch(() => ({ body }), captured);

const throwingFetch: FetchFn = async () => {
  throw new Error("connection refused");
};

const TEST_KEY = "ds_live_test_key_123";

function keyDeps(fetchFn: FetchFn, extra: Partial<EventsDeps> = {}): EventsDeps {
  return { fetchFn, env: { DATASIGNALS_KEY: TEST_KEY }, ...extra };
}

function noKeyDeps(fetchFn: FetchFn, extra: Partial<EventsDeps> = {}): EventsDeps {
  return { fetchFn, env: {}, ...extra };
}

async function expectError(promise: Promise<unknown>, message: string): Promise<void> {
  await assert.rejects(promise, (err: unknown) => {
    assert.equal(err instanceof Error ? err.message : String(err), message);
    return true;
  });
}

const FEED_PAGE = {
  events: [
    {
      event_id: "insider_cluster:CAMP:2026-08-03",
      event_type: "insider_cluster",
      company: { name: "Camp4 Therapeutics Corp", ticker: "CAMP" },
      score: 67.2,
    },
  ],
  cursor: 4471,
  has_more: true,
};

describe("search_events", () => {
  it("GETs <base>/v1/events with no query when no filters are set, with the Bearer key", async () => {
    const captured: Captured[] = [];
    const out = await searchEvents({}, keyDeps(okFetch(FEED_PAGE, captured)));
    assert.equal(out, JSON.stringify(FEED_PAGE));
    assert.equal(captured.length, 1);
    assert.equal(captured[0].url, "https://datasignalslab.com/v1/events");
    assert.equal(captured[0].method, "GET");
    assert.equal(captured[0].headers?.Authorization, `Bearer ${TEST_KEY}`);
  });

  it("sends only the set filters as query parameters", async () => {
    const captured: Captured[] = [];
    await searchEvents(
      { event_type: "fda_action", min_score: 70, limit: 25 },
      keyDeps(okFetch(FEED_PAGE, captured)),
    );
    assert.equal(
      captured[0].url,
      "https://datasignalslab.com/v1/events?event_type=fda_action&min_score=70&limit=25",
    );
  });

  it("sends every set filter, including ticker, cik and the since cursor", async () => {
    const captured: Captured[] = [];
    await searchEvents(
      {
        event_type: "insider_cluster",
        ticker: "CAMP",
        cik: "0001234567",
        min_score: 50.5,
        since: 4471,
        limit: 100,
      },
      keyDeps(okFetch(FEED_PAGE, captured)),
    );
    assert.equal(
      captured[0].url,
      "https://datasignalslab.com/v1/events?event_type=insider_cluster&ticker=CAMP&cik=0001234567&min_score=50.5&since=4471&limit=100",
    );
  });

  it("never sends the key as a query parameter", async () => {
    const captured: Captured[] = [];
    await searchEvents({ ticker: "NVDA" }, keyDeps(okFetch(FEED_PAGE, captured)));
    assert.ok(!captured[0].url.includes(TEST_KEY));
    assert.ok(!captured[0].url.includes("key"));
  });

  it("returns a quota-exhausted empty page verbatim (a 200 like any other)", async () => {
    const page = { events: [], cursor: 4471, has_more: false, notice: "Monthly event allowance exhausted; resume from this cursor when your period resets." };
    const out = await searchEvents({ since: 4471 }, keyDeps(okFetch(page)));
    assert.equal(out, JSON.stringify(page));
  });

  it("returns a string body verbatim, without JSON re-serialisation", async () => {
    const raw = '{ "events" :  [] , "cursor" : 9 }';
    const out = await searchEvents({}, keyDeps(okFetch(raw)));
    assert.equal(out, raw);
  });

  it("fails with DATASIGNALS_KEY is not set before any fetch when the key is missing", async () => {
    const captured: Captured[] = [];
    await expectError(
      searchEvents({}, noKeyDeps(okFetch(FEED_PAGE, captured))),
      "DATASIGNALS_KEY is not set",
    );
    assert.deepEqual(captured, []);
  });

  it("reads the base URL from env and strips its trailing slash", async () => {
    const captured: Captured[] = [];
    await searchEvents(
      {},
      keyDeps(okFetch(FEED_PAGE, captured), {
        env: { DATASIGNALS_KEY: TEST_KEY, DATASIGNALS_BASE_URL: "https://ds.example.test/root/" },
      }),
    );
    assert.equal(captured[0].url, "https://ds.example.test/root/v1/events");
  });
});

describe("company_events", () => {
  it("GETs <base>/v1/companies/<company>/events with no query when unset", async () => {
    const captured: Captured[] = [];
    const out = await companyEvents({ company: "NVDA" }, keyDeps(okFetch(FEED_PAGE, captured)));
    assert.equal(out, JSON.stringify(FEED_PAGE));
    assert.equal(captured[0].url, "https://datasignalslab.com/v1/companies/NVDA/events");
    assert.equal(captured[0].method, "GET");
    assert.equal(captured[0].headers?.Authorization, `Bearer ${TEST_KEY}`);
  });

  it("sends since and limit as query parameters when set", async () => {
    const captured: Captured[] = [];
    await companyEvents(
      { company: "0001045810", since: 120, limit: 10 },
      keyDeps(okFetch(FEED_PAGE, captured)),
    );
    assert.equal(
      captured[0].url,
      "https://datasignalslab.com/v1/companies/0001045810/events?since=120&limit=10",
    );
  });

  it("URL-encodes the company path segment", async () => {
    const captured: Captured[] = [];
    await companyEvents({ company: "A&B Co/1" }, keyDeps(okFetch(FEED_PAGE, captured)));
    assert.equal(
      captured[0].url,
      "https://datasignalslab.com/v1/companies/A%26B%20Co%2F1/events",
    );
  });

  it("fails with DATASIGNALS_KEY is not set before any fetch when the key is missing", async () => {
    const captured: Captured[] = [];
    await expectError(
      companyEvents({ company: "NVDA" }, noKeyDeps(okFetch(FEED_PAGE, captured))),
      "DATASIGNALS_KEY is not set",
    );
    assert.deepEqual(captured, []);
  });
});

describe("get_event", () => {
  it("GETs <base>/v1/events/<event_id> with the event_id URL-encoded", async () => {
    const captured: Captured[] = [];
    const record = { event_id: "insider_cluster:CAMP:2026-08-03", score: 67.2 };
    const out = await getEvent(
      { event_id: "insider_cluster:CAMP:2026-08-03" },
      keyDeps(okFetch(record, captured)),
    );
    assert.equal(out, JSON.stringify(record));
    assert.equal(
      captured[0].url,
      "https://datasignalslab.com/v1/events/insider_cluster%3ACAMP%3A2026-08-03",
    );
    assert.equal(captured[0].headers?.Authorization, `Bearer ${TEST_KEY}`);
  });

  it("fails with DATASIGNALS_KEY is not set before any fetch when the key is missing", async () => {
    const captured: Captured[] = [];
    await expectError(
      getEvent({ event_id: "x" }, noKeyDeps(okFetch({}, captured))),
      "DATASIGNALS_KEY is not set",
    );
    assert.deepEqual(captured, []);
  });
});

describe("keyless tools", () => {
  it("list_event_types GETs <base>/v1/event-types with no key configured", async () => {
    const captured: Captured[] = [];
    const body = [{ event_type: "private_raise", score_recomputable: true }];
    const out = await listEventTypes(noKeyDeps(okFetch(body, captured)));
    assert.equal(out, JSON.stringify(body));
    assert.equal(captured[0].url, "https://datasignalslab.com/v1/event-types");
    assert.equal(captured[0].method, "GET");
    assert.equal(captured[0].headers?.Authorization, undefined);
  });

  it("list_event_types never attaches the key even when one is set", async () => {
    const captured: Captured[] = [];
    await listEventTypes(keyDeps(okFetch([], captured)));
    assert.equal(captured[0].headers?.Authorization, undefined);
    assert.ok(!captured[0].url.includes(TEST_KEY));
  });

  it("feed_health GETs <base>/v1/health with no key configured", async () => {
    const captured: Captured[] = [];
    const body = { streams: [{ event_type: "fda_action", hours_since: 9 }] };
    const out = await feedHealth(noKeyDeps(okFetch(body, captured)));
    assert.equal(out, JSON.stringify(body));
    assert.equal(captured[0].url, "https://datasignalslab.com/v1/health");
    assert.equal(captured[0].headers?.Authorization, undefined);
  });

  it("feed_health never attaches the key even when one is set", async () => {
    const captured: Captured[] = [];
    await feedHealth(keyDeps(okFetch({}, captured)));
    assert.equal(captured[0].headers?.Authorization, undefined);
    assert.ok(!captured[0].url.includes(TEST_KEY));
  });
});

describe("usage", () => {
  it("GETs <base>/v1/usage with the Bearer key and returns the body verbatim", async () => {
    const captured: Captured[] = [];
    const body = { events_used: 1200, events_limit: 25000, resets_on: "2026-11-14" };
    const out = await usage(keyDeps(okFetch(body, captured)));
    assert.equal(out, JSON.stringify(body));
    assert.equal(captured[0].url, "https://datasignalslab.com/v1/usage");
    assert.equal(captured[0].method, "GET");
    assert.equal(captured[0].headers?.Authorization, `Bearer ${TEST_KEY}`);
  });

  it("fails with DATASIGNALS_KEY is not set before any fetch when the key is missing", async () => {
    const captured: Captured[] = [];
    await expectError(usage(noKeyDeps(okFetch({}, captured))), "DATASIGNALS_KEY is not set");
    assert.deepEqual(captured, []);
  });
});

describe("starting_up cold-start handling", () => {
  it("returns a non-2xx body with status starting_up verbatim as a normal result", async () => {
    const body = JSON.stringify({ status: "starting_up", retry_after_seconds: 15 });
    const fetchFn = makeFetch(() => ({ status: 503, body }));
    const out = await searchEvents({}, keyDeps(fetchFn));
    assert.equal(out, body);
  });

  it("returns a non-2xx body whose error field mentions starting_up verbatim", async () => {
    const body = JSON.stringify({ error: "feed is starting_up; retry shortly" });
    const fetchFn = makeFetch(() => ({ status: 502, body }));
    const out = await usage(keyDeps(fetchFn));
    assert.equal(out, body);
  });

  it("returns a starting_up body verbatim on a keyless tool too", async () => {
    const body = JSON.stringify({ status: "starting_up" });
    const fetchFn = makeFetch(() => ({ status: 503, body }));
    const out = await feedHealth(noKeyDeps(fetchFn));
    assert.equal(out, body);
  });

  it("does not mistake other non-2xx JSON bodies for starting_up", async () => {
    const fetchFn = makeFetch(() => ({ status: 500, body: { status: "error", error: "boom" } }));
    await expectError(searchEvents({}, keyDeps(fetchFn)), "datasignals error: HTTP 500");
  });
});

describe("upstream errors", () => {
  it("maps a non-2xx reply to datasignals error: HTTP <status>", async () => {
    const fetchFn = makeFetch(() => ({ status: 403, body: "key revoked" }));
    await expectError(searchEvents({}, keyDeps(fetchFn)), "datasignals error: HTTP 403");
  });

  it("maps a 429 reply to datasignals error: HTTP 429", async () => {
    const fetchFn = makeFetch(() => ({ status: 429, body: "slow down" }));
    await expectError(getEvent({ event_id: "x" }, keyDeps(fetchFn)), "datasignals error: HTTP 429");
  });

  it("maps a non-2xx reply on a keyless tool to datasignals error: HTTP <status>", async () => {
    const fetchFn = makeFetch(() => ({ status: 500, body: "boom" }));
    await expectError(listEventTypes(noKeyDeps(fetchFn)), "datasignals error: HTTP 500");
  });

  it("maps a throwing fetch to datasignals unreachable", async () => {
    await expectError(searchEvents({}, keyDeps(throwingFetch)), "datasignals unreachable");
    await expectError(feedHealth(noKeyDeps(throwingFetch)), "datasignals unreachable");
    await expectError(usage(keyDeps(throwingFetch)), "datasignals unreachable");
  });

  it("maps a fetch that never answers (past the timeout) to datasignals unreachable", async () => {
    const hangingFetch: FetchFn = () => new Promise(() => {});
    await expectError(
      searchEvents({}, keyDeps(hangingFetch, { timeoutMs: 25 })),
      "datasignals unreachable",
    );
  });
});

describe("check_setup", () => {
  it("key set + health ok: configured and reachable, no key sent or printed", async () => {
    const captured: Captured[] = [];
    const out = await checkSetup(keyDeps(okFetch({ status: "ok" }, captured)));
    const parsed = JSON.parse(out) as { key_configured: boolean; feed_reachable: boolean; detail: string };
    assert.equal(parsed.key_configured, true);
    assert.equal(parsed.feed_reachable, true);
    assert.match(parsed.detail, /200/);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].url, "https://datasignalslab.com/v1/health");
    assert.equal(captured[0].headers?.Authorization, undefined);
    assert.ok(!out.includes(TEST_KEY));
  });

  it("key set + health failing status: configured, not reachable, key never printed", async () => {
    const fetchFn = makeFetch(() => ({ status: 503, body: "down" }));
    const out = await checkSetup(keyDeps(fetchFn));
    const parsed = JSON.parse(out) as { key_configured: boolean; feed_reachable: boolean; detail: string };
    assert.equal(parsed.key_configured, true);
    assert.equal(parsed.feed_reachable, false);
    assert.match(parsed.detail, /503/);
    assert.ok(!out.includes(TEST_KEY));
  });

  it("key unset + health ok: not configured, reachable", async () => {
    const out = await checkSetup(noKeyDeps(okFetch({ status: "ok" })));
    const parsed = JSON.parse(out) as { key_configured: boolean; feed_reachable: boolean; detail: string };
    assert.equal(parsed.key_configured, false);
    assert.equal(parsed.feed_reachable, true);
    assert.match(parsed.detail, /200/);
  });

  it("key unset + health unreachable: not configured, not reachable, still a normal result", async () => {
    const out = await checkSetup(noKeyDeps(throwingFetch));
    const parsed = JSON.parse(out) as { key_configured: boolean; feed_reachable: boolean; detail: string };
    assert.equal(parsed.key_configured, false);
    assert.equal(parsed.feed_reachable, false);
    assert.match(parsed.detail, /unreachable/);
  });

  it("key set + health unreachable: configured, not reachable, key never printed", async () => {
    const out = await checkSetup(keyDeps(throwingFetch));
    const parsed = JSON.parse(out) as { key_configured: boolean; feed_reachable: boolean; detail: string };
    assert.equal(parsed.key_configured, true);
    assert.equal(parsed.feed_reachable, false);
    assert.ok(!out.includes(TEST_KEY));
  });
});

/* ------------------------------------------------------------------ */
/* CLI (spawned through tsx; only pre-request paths are exercised,     */
/* plus check_setup against a refused loopback port)                   */
/* ------------------------------------------------------------------ */

function runCli(args: string[], env: Record<string, string> = {}) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  return spawnSync(join(root, "node_modules", ".bin", "tsx"), ["src/cli.ts", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, DATASIGNALS_KEY: "", DATASIGNALS_BASE_URL: "", ...env },
  });
}

describe("signalfeed CLI", () => {
  it("prints 0.1.0 for --version and exits 0", () => {
    const res = runCli(["--version"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0.1.0");
  });

  it("exits 2 with usage for an unknown subcommand", () => {
    const res = runCli(["not-a-tool"]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Usage/);
  });

  it("exits 2 for a non-JSON argument string", () => {
    const res = runCli(["search_events", "not json"]);
    assert.equal(res.status, 2);
  });

  it("exits 2 for extra arguments", () => {
    const res = runCli(["search_events", "{}", "{}"]);
    assert.equal(res.status, 2);
  });

  it("exits 1 with the missing-key message for a keyed tool without a key", () => {
    const res = runCli(["search_events", "{}"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /DATASIGNALS_KEY is not set/);
  });

  it("check_setup exits 0 and never prints the key when the feed is unreachable", () => {
    const res = runCli(["check_setup", "{}"], {
      DATASIGNALS_KEY: TEST_KEY,
      DATASIGNALS_BASE_URL: "http://127.0.0.1:1",
    });
    assert.equal(res.status, 0);
    const parsed = JSON.parse(res.stdout.trim()) as {
      key_configured: boolean;
      feed_reachable: boolean;
      detail: string;
    };
    assert.equal(parsed.key_configured, true);
    assert.equal(parsed.feed_reachable, false);
    assert.ok(!res.stdout.includes(TEST_KEY));
    assert.ok(!res.stderr.includes(TEST_KEY));
  });
});
