# Changelog

## 0.1.0 (2026-10-27)

- Initial release: seven MCP tools and matching CLI
  subcommands over the DataSignals Events API —
  `search_events`, `company_events`, `get_event`,
  `list_event_types`, `feed_health`, `usage` and
  `check_setup`.
- The API key (`DATASIGNALS_KEY`) is sent as a Bearer
  token on the keyed tools and never as a query
  parameter; `list_event_types` and `feed_health` never
  attach it. Base URL via `DATASIGNALS_BASE_URL`.
  Upstream bodies are returned verbatim, a `starting_up`
  cold-start body is returned as a normal result, and
  other upstream failures use the documented error
  strings.
