/**
 * signalfeed MCP server. Tools: search_events,
 * company_events, get_event, list_event_types,
 * feed_health, usage, check_setup.
 *
 * Why the low-level Server instead of McpServer: the
 * high-level helper converts zod schemas to JSON Schema and
 * injects keys that are not in this tool set's documented
 * spec ("$schema" and "additionalProperties"), which breaks
 * exact tool-list/schema parity with the spec. This file
 * serves tools/list with the spec's exact input schemas as
 * explicit literals, and the core validates every tools/call
 * argument set itself.
 *
 * Every tool returns a single text item carrying the
 * upstream body verbatim; upstream failures come back as
 * isError results carrying the documented error strings.
 * check_setup always returns a normal result.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import {
  checkSetup,
  companyEvents,
  feedHealth,
  getEvent,
  listEventTypes,
  searchEvents,
  usage,
  VERSION,
} from "./events.js";

const TOOLS = [
  {
    name: "search_events",
    description:
      "Search filing events across all twelve streams; filter by event type, ticker, CIK or minimum score, and page with a cursor.",
    inputSchema: {
      type: "object" as const,
      properties: {
        cik: { type: "string" , description: "CIK number of the filer." },
        event_type: {
          type: "string",
          enum: [
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
          ],
         description: "Type of event (optional)." },
        limit: { type: "integer" , description: "Maximum number of results to return (optional)." },
        min_score: { type: "number" , description: "Minimum score filter (optional)." },
        since: { type: "integer" , description: "The since for this call." },
        ticker: { type: "string" , description: "Ticker symbol, e.g. AAPL." },
      },
      required: [],
    },
  },
  {
    name: "company_events",
    description: "Everything filed on one company, across all streams.",
    inputSchema: {
      type: "object" as const,
      properties: {
        company: { type: "string" , description: "Company name or identifier." },
        limit: { type: "integer" , description: "Maximum number of results to return (optional)." },
        since: { type: "integer" , description: "The since for this call." },
      },
      required: ["company"],
    },
  },
  {
    name: "get_event",
    description: "Show everything on one event, by its event_id.",
    inputSchema: {
      type: "object" as const,
      properties: {
        event_id: { type: "string" , description: "Identifier of the event." },
      },
      required: ["event_id"],
    },
  },
  {
    name: "list_event_types",
    description:
      "Which fields each stream carries, and whether its score can be recomputed. Works without a key.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "feed_health",
    description: "How current each stream is right now. Works without a key.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "usage",
    description: "How much of the monthly event allowance is used, and when it resets.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "check_setup",
    description: "Whether the API key is configured and whether the feed answers.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "signalfeed", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;
  try {
    let out: string;
    switch (name) {
      case "search_events":
        out = await searchEvents(a as never);
        break;
      case "company_events":
        out = await companyEvents(a as never);
        break;
      case "get_event":
        out = await getEvent(a as never);
        break;
      case "list_event_types":
        out = await listEventTypes();
        break;
      case "feed_health":
        out = await feedHealth();
        break;
      case "usage":
        out = await usage();
        break;
      case "check_setup":
        out = await checkSetup();
        break;
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(out);
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
