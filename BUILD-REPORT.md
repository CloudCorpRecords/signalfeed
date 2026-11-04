# signalfeed — Build Report (Batch 25)

Rebuild of the `com.datasignalslab/datasignals-lab-events-mcp`
MCP server (PyPI package `datasignals-lab-events-mcp`) from
the firsthand spec in `specs-batch25/signalfeed.md`.
Built 2026-10-27.

## Identity

- npm: `@reneturcios/signalfeed` @ 0.1.0, bin
  `signalfeed` → `dist/cli.js`
- MCP Registry name: `io.github.CloudCorpRecords/signalfeed`
  (matches `package.json` `mcpName`, `server.json` `name`,
  and the Dockerfile `io.modelcontextprotocol.server.name`
  label)
- server.json description (95 chars, verified):
  "US filing-event streams in one schema: insider clusters,
  13D/G, 13F, 8-K, Form D, FDA and more."
- server.json: npm package entry carries `"version":
  "0.1.0"`; the OCI entry
  (`ghcr.io/cloudcorprecords/signalfeed:0.1.0`) carries
  **no** `version` field (verified).

## Files (19-file factory set, per TEMPLATE.md §2)

package.json, server.json, Dockerfile, tsconfig.json
(byte-identical to builds/ruleverdict/tsconfig.json,
verified with `cmp`), .gitignore, .dockerignore,
package-lock.json, README.md (fresh prose), LICENSE
(MIT, © 2026 Rene Turcios), CHANGELOG.md (single 0.1.0
entry dated 2026-10-27), src/index.ts, src/cli.ts,
src/mcp.ts, src/types.ts, src/events.ts (core),
test/events.test.ts, and the four workflows under
.github/workflows/ (publish-container adapted: IMAGE
ghcr.io/cloudcorprecords/signalfeed, smoke assertion on
server name `signalfeed`). Plus this BUILD-REPORT.md and
the parity-out/ artifacts. The parity fixture lives at
`harness/fixtures/datasignals-lab-events-tools-original.json`
with the spec's exact `_source` string (verified: the
fixture string appears verbatim in the spec,
whitespace-collapsed comparison).

## Implementation

- `src/mcp.ts`: low-level `Server` API
  (`sdk/server/index.js` + `StdioServerTransport`,
  handlers for `ListToolsRequestSchema` /
  `CallToolRequestSchema` from `sdk/types.js`), explicit
  JSON-schema literals for all seven tools
  (search_events, company_events, get_event,
  list_event_types, feed_health, usage, check_setup);
  no McpServer/zod registration. Tool descriptions and
  input schemas are the fixture's, exactly — including
  the `event_type` enum of the twelve pinned stream ids
  (insider_cluster, insider_sale_notice, activist_stake,
  institutional_holding, material_event, private_raise,
  fda_action, biotech_catalyst, nih_grant,
  gov_contract_award, congress_trade, hiring_signal) and
  no `additionalProperties` anywhere.
- `src/events.ts`: `VERSION = "0.1.0"`. All upstream
  access goes through an injectable fetch (deps
  `fetchFn`, `env`, `apiKey`, `baseUrl`, `timeoutMs`).
  The key from `DATASIGNALS_KEY` is sent as
  `Authorization: Bearer <key>` on the keyed tools only
  and never as a query parameter. The keyless tools
  (`list_event_types`, `feed_health`) never attach the
  key, set or not. Keyed tools without the key fail with
  `DATASIGNALS_KEY is not set` before any fetch (the key
  check runs before argument validation, so the pinned
  string wins for any argument set). Base URL defaults
  to `https://datasignalslab.com`, overridable via
  `DATASIGNALS_BASE_URL` (trailing slash stripped).
  `search_events` sends only the set filters as query
  parameters; `event_id` and `company` path segments are
  URL-encoded. A 2xx returns the upstream body text
  verbatim. A non-2xx whose JSON body carries
  `status: "starting_up"` or an error field mentioning
  starting_up returns that body verbatim as a normal
  result (labelled cold-start rule). Other non-2xx →
  `datasignals error: HTTP <status>`; a throwing or
  timed-out fetch → `datasignals unreachable`. The
  per-request timeout defaults to 30000 ms (deps
  `timeoutMs`; cold starts can take ~15 s) and is
  enforced with an AbortController plus a timeout race
  so an injected fetch that never answers still times
  out in tests.
- `check_setup`: always a normal text result (never an
  error): the JSON object `{key_configured,
  feed_reachable, detail}`. `key_configured` is whether
  a key is set (the value is never printed);
  `feed_reachable` is whether a keyless
  GET /v1/health through the injected fetch returned
  2xx; `detail` names the health HTTP status or the
  failure (`health check failed: datasignals
  unreachable`). No key is sent by check_setup.
- CLI: one subcommand per tool taking a JSON argument
  string, `mcp`, `--version` (prints `0.1.0`); unknown
  subcommand → usage on stderr, exit 2; tool errors exit
  1 (missing-key path spot-checked against the built
  CLI).

## Endpoint provenance (pinned vs reconstructed)

API-page-pinned (per the spec):

- All wire paths: GET `<base>/v1/events` (search_events,
  only set filters as query parameters);
  GET `<base>/v1/companies/<company>/events` with
  since/limit when set (company_events);
  GET `<base>/v1/events/<event_id>` (get_event);
  GET `<base>/v1/event-types` (list_event_types,
  keyless); GET `<base>/v1/health` (feed_health,
  keyless); GET `<base>/v1/usage` (usage).
- The filter names (event_type, ticker, cik, min_score,
  since, limit), the twelve stream ids, the
  `{events, cursor, has_more}` page shape, the
  quota-exhausted empty-page behaviour, and the
  cold-start `starting_up` behaviour.
- `DATASIGNALS_KEY` sent as a Bearer header, never a
  query parameter; `list_event_types` and `feed_health`
  work without a key.

Labelled reconstructions (also labelled in README.md):

- The MCP-layer argument names follow the documented
  API names (the MCP layer itself is unpublished).
- The `starting_up`-as-normal-result rule, the two
  upstream error strings (`datasignals error: HTTP
  <status>`, `datasignals unreachable`), the missing-key
  string (`DATASIGNALS_KEY is not set`), and
  check_setup's JSON rendering are this rebuild's own,
  per the spec's labelling.

## Verification (all real, run 2026-10-27)

- `npm run build` (tsc): exit 0. Fresh
  `npx tsc --noEmit`: exit 0.
- `npm test`: **40 tests, 40 pass, 0 fail** — fake fetch
  and injected env only, no live network (the CLI tests
  spawn the CLI through tsx; they exercise pre-request
  paths plus a check_setup run pointed at a refused
  loopback port). Covers every wire path and query
  construction (only set filters sent; all-six-filters
  URL asserted exactly; `event_id` colons and `company`
  spaces/`&`/`/` URL-encoded), the auth rules (Bearer on
  keyed tools; keyless tools attach no Authorization
  header with the key set or unset and never leak it
  into the URL; missing key → `DATASIGNALS_KEY is not
  set` with zero fetches for search_events,
  company_events, get_event and usage), verbatim 2xx
  pass-through including a quota-exhausted empty page
  and a non-canonical JSON string, base-URL env override
  with trailing-slash stripping, the `starting_up`
  non-2xx body returned verbatim as a normal result in
  both variants (`status` field and error field, on a
  keyed and a keyless tool), a non-starting_up JSON 500
  still mapping to the HTTP error, the HTTP-error mapping
  (403 / 429 / 500, keyed and keyless), the unreachable
  mapping for a throwing fetch and for a never-answering
  fetch past an overridden 25 ms timeout, check_setup in
  all combinations (key set/unset × health ok /
  failing-status / unreachable) with the key value never
  appearing in the output and no Authorization header
  sent, and the CLI cases (`--version` exit 0, unknown
  subcommand / non-JSON argument / extra arguments exit
  2, missing key exit 1, check_setup exit 0 with the key
  never printed).
- `node dist/cli.js --version`: prints `0.1.0`.
  Unknown subcommand exits 2 with usage.
- Parity: tools captured by sending initialize +
  notifications/initialized + tools/list to
  `node dist/cli.js mcp` over stdio into
  `parity-out/tools-rebuild.json`, then
  `harness/parity.py` against
  `harness/fixtures/datasignals-lab-events-tools-original.json`
  → **PASS, parity 100.0, identical_tools 7 / total 7**
  (see `parity-out/parity.json`).
- Lockfile (Route 3, clean from birth): generated in the
  build dir with no `node_modules` present via
  `npm install --package-lock-only --ignore-scripts
  --offline`; verified it parses, `name` ==
  `@reneturcios/signalfeed`, **128 package entries**;
  then `npm install --offline` in the build dir
  succeeded for node_modules.
- Version consistency: `package.json` 0.1.0 =
  `server.json` top-level 0.1.0 = npm entry 0.1.0 = OCI
  tag `:0.1.0` = core `VERSION` 0.1.0 = CHANGELOG
  heading `## 0.1.0 (2026-10-27)`.

## Deviations

- None from the spec. (The test key string used by the
  suite lives only in `test/events.test.ts`; no test
  asserts on or prints a real key, and no live network
  call was made.)

## Gaps

- Live upstream behaviour is unproven: no live call was
  made (tests are fake-fetch only).
- The MCP-layer argument names are labelled
  reconstructions from the documented API names, per
  the spec; the vendor's MCP layer itself is
  unpublished.
