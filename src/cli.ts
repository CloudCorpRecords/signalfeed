#!/usr/bin/env node
/**
 * signalfeed CLI.
 *
 *   signalfeed search_events '<json>'
 *   signalfeed company_events '<json>'
 *   signalfeed get_event '<json>'
 *   signalfeed list_event_types '<json>'
 *   signalfeed feed_health '<json>'
 *   signalfeed usage '<json>'
 *   signalfeed check_setup '<json>'
 *   signalfeed mcp
 *   signalfeed --version
 *
 * Each tool subcommand takes one JSON argument string with
 * the tool's arguments and prints the tool's result text.
 * Exit codes: 0 success, 1 runtime error, 2 usage error.
 */
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

const TOOL_NAMES = [
  "search_events",
  "company_events",
  "get_event",
  "list_event_types",
  "feed_health",
  "usage",
  "check_setup",
] as const;

function usageError(): never {
  console.error(`Usage:
  signalfeed <tool> '<json-args>'     one of: ${TOOL_NAMES.join(", ")}
  signalfeed mcp
  signalfeed --version`);
  process.exit(2);
}

async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "search_events":
      return searchEvents(args as never);
    case "company_events":
      return companyEvents(args as never);
    case "get_event":
      return getEvent(args as never);
    case "list_event_types":
      return listEventTypes();
    case "feed_health":
      return feedHealth();
    case "usage":
      return usage();
    case "check_setup":
      return checkSetup();
    default:
      usageError();
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    if (rest.length !== 0) usageError();
    await import("./mcp.js");
    return;
  }
  if (!(TOOL_NAMES as readonly string[]).includes(cmd ?? "")) usageError();
  if (rest.length > 1) usageError();
  let args: Record<string, unknown> = {};
  if (rest.length === 1) {
    try {
      const parsed: unknown = JSON.parse(rest[0]);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) usageError();
      args = parsed as Record<string, unknown>;
    } catch {
      console.error("error: argument must be a JSON object string");
      process.exit(2);
    }
  }
  try {
    const out = await runTool(cmd, args);
    console.log(out);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
