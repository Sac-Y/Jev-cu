#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { createToolHandlers } from "./tool-handlers.mjs";

const emptySchema = z.object({}).strict();

const candidatesSchema = z.object({
  accessibility_text: z.string().min(1).max(50_000),
  goal: z.string().min(1).max(500),
  max_candidates: z.number().int().min(1).max(80).default(40),
}).strict();

const candidateSchema = z.object({
  id: z.string().regex(/^i\d+$/),
  index: z.number().int().nonnegative(),
  role: z.string().min(1).max(80),
  label: z.string().max(120),
}).strict();

const decideSchema = z.object({
  goal: z.string().min(1).max(500),
  app: z.string().min(1).max(200),
  candidates: z.array(candidateSchema).min(1).max(80),
  context: z.string().max(1_500).default(""),
  recent_actions: z.array(z.string().max(300)).max(6).default([]),
  constraints: z.string().max(1_500).default(""),
}).strict();

const SAFE_MESSAGES = Object.freeze({
  invalid_input: "The tool input is invalid",
  unsupported_platform: "Jev-cu currently supports macOS only",
  not_configured: "The Jev credential is not configured",
  credential_unavailable: "The Jev credential is unavailable",
  authentication_failed: "Jev authentication failed",
  rate_limited: "Jev rate limit exceeded",
  service_unavailable: "Jev service is unavailable",
  network_failed: "Unable to reach the Jev service",
  invalid_response: "Jev returned an invalid decision",
  setup_failed: "Jev credential setup failed",
});

function success(result) {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result,
  };
}

function failure(error) {
  const code = typeof error?.code === "string" ? error.code : "internal_error";
  const result = {
    code,
    message: SAFE_MESSAGES[code] ?? "Jev-cu could not complete the request",
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result,
  };
}

function safeTool(handler) {
  return async (input = {}) => {
    try {
      return success(await handler(input));
    } catch (error) {
      return failure(error);
    }
  };
}

export function createMcpServer({ handlers, ...handlerOptions } = {}) {
  const activeHandlers = handlers ?? createToolHandlers(handlerOptions);
  const server = new McpServer({ name: "jev-cu", version: "0.2.0" });

  server.registerTool("jev_status", {
    description: "Check whether Jev-cu supports this Mac and has a configured Keychain credential.",
    inputSchema: emptySchema,
  }, safeTool(() => activeHandlers.status()));

  server.registerTool("jev_configure", {
    description: "Open a native hidden macOS dialog and save a Jev API key directly to Keychain.",
    inputSchema: emptySchema,
  }, safeTool(() => activeHandlers.configure()));

  server.registerTool("jev_candidates", {
    description: "Normalize bounded English or Chinese macOS accessibility text into stable UI candidates.",
    inputSchema: candidatesSchema,
  }, safeTool((input) => activeHandlers.candidates(input)));

  server.registerTool("jev_decide", {
    description: "Ask Jev for one bounded next-step recommendation and apply the local safety policy.",
    inputSchema: decideSchema,
  }, safeTool((input) => activeHandlers.decide(input)));

  return server;
}

export async function startServer({ transport = new StdioServerTransport(), ...options } = {}) {
  const server = createMcpServer(options);
  await server.connect(transport);
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startServer().catch((error) => {
    const code = typeof error?.code === "string" ? error.code : "internal_error";
    console.error(`[jev-cu] MCP server failed: ${code}`);
    process.exitCode = 1;
  });
}
