# signalfeed

Twelve US filing-event streams, one schema, one key.
signalfeed is a small client for the DataSignals Events
API, which parses official filings into scored,
decision-ready event records: insider buying clusters,
planned insider sales (Form 144), activist stakes
(13D/G), institutional holdings (13F), material events
(8-K), private raises (Form D), FDA actions, biotech
trial catalysts, NIH grants, federal contract awards,
congressional trades and hiring signals. Every record
links back to the filing it was parsed from, and where
a record carries a score it also carries the terms that
score was built from.

The feed is cursor-based: pass the cursor from one
response back as `since` and you get exactly what
arrived since — no duplicates, no gaps. Responses come
back exactly as the API returned them: nothing is
trimmed, renamed or summarised on the way through.

## Configuration

- `DATASIGNALS_KEY` — your API key. Required for the
  keyed tools; sent on those requests as
  `Authorization: Bearer <key>` and never as a query
  parameter, so it does not end up in server logs or
  browser history. The keyless tools never send it.
- `DATASIGNALS_BASE_URL` (optional) — API base URL.
  Defaults to `https://datasignalslab.com`.

A keyed tool called without a key fails locally with
`DATASIGNALS_KEY is not set`, before any request is
made. Two tools — `list_event_types` and `feed_health`
— work without a key, so you can see the shape of the
data and how fresh it is before you decide.

## Tools

- `search_events` — search filing events across all
  twelve streams. All filters are optional:
  `event_type` (one of the twelve stream ids),
  `ticker`, `cik`, `min_score`, plus `since` (the
  cursor from a previous response) and `limit` for
  paging. Only the filters you set are sent.
- `company_events` — everything filed on one company,
  across all streams. `company` is a ticker or a CIK;
  `since` and `limit` page the result.
- `get_event` — show everything on one event, by its
  `event_id` (for example
  `insider_cluster:CAMP:2026-08-03`).
- `list_event_types` — which fields each stream
  carries, and whether its score can be recomputed.
  Works without a key.
- `feed_health` — how current each stream is right
  now. Works without a key.
- `usage` — how much of the monthly event allowance
  is used, and when it resets.
- `check_setup` — whether the API key is configured
  and whether the feed answers. Always answers with a
  JSON object `{key_configured, feed_reachable,
  detail}`; the key value is never printed and no key
  is sent by the check itself.

Behaviour worth knowing:

- A quota-exhausted feed does not throw an error
  mid-sync: it answers a 200 empty page with your
  cursor intact and a plain notice, and signalfeed
  passes it through like any other page.
- The API scales to zero when idle. The first request
  after a quiet period may get a `starting_up` answer
  (with a `Retry-After` header) while it wakes, which
  can take about fifteen seconds; signalfeed returns
  that body as a normal result rather than an error,
  and the call is not counted against your allowance.
  Just call again.
- Any other non-2xx reply fails with
  `datasignals error: HTTP <status>`, and an
  unreachable API with `datasignals unreachable`.

### Endpoint provenance

The vendor's Events API page pins the endpoints, the
filter names, the cursor model and the twelve stream
ids; the original MCP project's README pins the seven
tools, both environment variables, the Bearer-header
auth rule and the two keyless tools. The MCP-layer
argument names follow the documented API names (a
labelled reconstruction, since the MCP layer itself is
unpublished):

- `GET <base>/v1/events` with only the set filters as
  query parameters (used by `search_events`).
- `GET <base>/v1/companies/{ticker or cik}/events`
  with `since`/`limit` when set (used by
  `company_events`).
- `GET <base>/v1/events/{event_id}` (used by
  `get_event`).
- `GET <base>/v1/event-types` (used by
  `list_event_types`, keyless).
- `GET <base>/v1/health` (used by `feed_health`,
  keyless, and by `check_setup`).
- `GET <base>/v1/usage` (used by `usage`).

`event_id` and `company` path segments are
URL-encoded.

## CLI

Each tool is a subcommand taking one JSON argument
string:

```bash
npx @reneturcios/signalfeed search_events '{"event_type":"fda_action","min_score":70}'
npx @reneturcios/signalfeed company_events '{"company":"NVDA"}'
npx @reneturcios/signalfeed get_event '{"event_id":"insider_cluster:CAMP:2026-08-03"}'
npx @reneturcios/signalfeed list_event_types '{}'
npx @reneturcios/signalfeed feed_health '{}'
npx @reneturcios/signalfeed usage '{}'
npx @reneturcios/signalfeed check_setup '{}'
npx @reneturcios/signalfeed --version
```

Output is the tool's result text (the upstream body on
success). Exit codes: `0` on success, `1` on a runtime
error, `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/signalfeed mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "signalfeed": {
      "command": "npx",
      "args": ["-y", "@reneturcios/signalfeed", "mcp"],
      "env": {
        "DATASIGNALS_KEY": "<your key>"
      }
    }
  }
}
```

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/signalfeed
docker run --rm ghcr.io/cloudcorprecords/signalfeed feed_health '{}'
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (fake fetch only, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios
