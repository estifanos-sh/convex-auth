/**
 * Self-contained remote MCP server, hosted on Convex HTTP.
 *
 * Registered via `auth.request.mcp(http, tools, opts?)`. A tool is a plain
 * `{ description, scope, args, handler }` object — the library does not own a
 * tool format; it owns the `/mcp` route, JSON-RPC framing, CORS, the
 * `oauth-protected-resource` discovery doc, the bearer challenge, and the
 * per-tool scope check. The registrar infers each `handler`'s `args` from that
 * tool's `args` validator. A tool's OAuth access token is a valid Convex
 * identity, so each tool's `ctx.runQuery`/`runMutation` runs as the signed-in
 * user and the app's own role grants still apply.
 *
 * @module
 */

import {
  type GenericActionCtx,
  type GenericDataModel,
  type HttpRouter,
  httpActionGeneric,
} from "convex/server";
import type { GenericValidator, Infer } from "convex/values";
import { validate, ValidationError } from "convex-helpers/validators";

import { registerCorsPreflight, withCors } from "./cors";

/**
 * A single MCP tool: a plain object binding an OAuth `scope` and a Convex `args`
 * validator to a `handler`. The `handler`'s `args` are typed by `args`, and the
 * same validator drives the published `inputSchema`. Passed directly to
 * `auth.request.mcp(http, tools)`, which infers `V` for each tool.
 */
export type McpToolDef<V extends GenericValidator = GenericValidator, S extends string = string> = {
  description: string;
  scope: S;
  args: V;
  handler: (ctx: GenericActionCtx<GenericDataModel>, args: Infer<V>) => Promise<unknown>;
};

/** Runtime tool map (argument types erased) + the server identity for `initialize`. */
type McpServer = {
  name?: string;
  version?: string;
  tools: Record<string, McpToolDef>;
};

const PROTOCOL_VERSION = "2025-06-18";

/**
 * JSON Schema for each Convex validator `kind`, keyed by `kind` rather than a
 * `switch`: the mapped type forces every `kind` to be handled and narrows each
 * entry's `validator` to its exact variant (`.fields`, `.element`, `.members`).
 */
const SCHEMA_BY_KIND: {
  [K in GenericValidator["kind"]]: (
    validator: Extract<GenericValidator, { kind: K }>,
  ) => Record<string, unknown>;
} = {
  id: () => ({ type: "string" }),
  string: () => ({ type: "string" }),
  bytes: () => ({ type: "string" }),
  float64: () => ({ type: "number" }),
  int64: () => ({ type: "integer" }),
  commitTs: () => ({ type: "integer" }),
  boolean: () => ({ type: "boolean" }),
  null: () => ({ type: "null" }),
  any: () => ({}),
  literal: (validator) => ({ const: validator.value }),
  array: (validator) => ({ type: "array", items: validatorToSchema(validator.element) }),
  record: (validator) => ({
    type: "object",
    additionalProperties: validatorToSchema(validator.value),
  }),
  union: (validator) =>
    validator.members.every((member) => member.kind === "literal")
      ? {
          enum: validator.members.map((member) =>
            member.kind === "literal" ? member.value : null,
          ),
        }
      : { anyOf: validator.members.map(validatorToSchema) },
  object: (validator) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, field] of Object.entries(validator.fields)) {
      properties[key] = validatorToSchema(field);
      if (field.isOptional === "required") required.push(key);
    }
    return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
  },
};

/** Derive the JSON Schema for a Convex validator, the MCP tool `inputSchema`. */
function validatorToSchema(validator: GenericValidator): Record<string, unknown> {
  const toSchema = SCHEMA_BY_KIND[validator.kind] as (
    v: GenericValidator,
  ) => Record<string, unknown>;
  return toSchema(validator);
}

function json(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

/** Stamp the negotiated MCP protocol version on a `/mcp` response (MCP 2025-06-18). */
function withMcpProtocol(response: Response): Response {
  response.headers.set("MCP-Protocol-Version", PROTOCOL_VERSION);
  return response;
}

function rpcError(id: unknown, code: number, message: string, init?: ResponseInit): Response {
  return json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, init);
}

function headerIdPart(id: unknown): string {
  return typeof id === "string" || typeof id === "number" ? String(id) : "0";
}

/** Resolves the OAuth scopes for a request, or `null` if it isn't an OAuth bearer. */
export type ResolveOAuthScopes = (
  ctx: GenericActionCtx<GenericDataModel>,
  request: Request,
) => Promise<readonly string[] | null>;

/**
 * `GET /.well-known/oauth-protected-resource` — RFC 9728 resource metadata.
 *
 * `resource` and `authorization_servers` are the deployment's canonical
 * identifiers (derived from `CONVEX_SITE_URL` + the auth route prefix), not the
 * request `Host` — so a spoofed `Host` cannot shift the advertised audience.
 */
function protectedResource(
  resource: string,
  authorizationServers: string[],
  scopes: string[],
): Response {
  return json({
    resource,
    authorization_servers: authorizationServers,
    bearer_methods_supported: ["header"],
    scopes_supported: scopes,
  });
}

function unauthorized(request: Request): Response {
  const url = new URL(request.url);
  const metadataUrl = `${url.protocol}//${url.host}/.well-known/oauth-protected-resource`;
  return rpcError(null, -32001, "OAuth bearer token required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Bearer realm="MCP", resource_metadata="${metadataUrl}", error="invalid_token"`,
    },
  });
}

/** `tools/call`: resolve the named tool, enforce its scope, run it, frame the result. */
async function callTool(
  ctx: GenericActionCtx<GenericDataModel>,
  id: unknown,
  scopes: readonly string[],
  tools: Record<string, McpToolDef>,
  rawParams: unknown,
): Promise<Response> {
  const params = (rawParams ?? {}) as { name?: string; arguments?: Record<string, unknown> };
  const tool = params.name ? tools[params.name] : undefined;
  if (!tool) {
    return rpcError(id, -32602, `Unknown tool: ${params.name ?? "(none)"}`);
  }
  if (!scopes.includes(tool.scope)) {
    return rpcError(id, -32003, `Missing required OAuth scope: ${tool.scope}`, { status: 403 });
  }
  const args = params.arguments ?? {};
  try {
    validate(tool.args, args, { throw: true });
  } catch (err) {
    const detail = err instanceof ValidationError ? err.message : "invalid arguments";
    return rpcError(id, -32602, `Invalid arguments for tool ${params.name}: ${detail}`);
  }
  try {
    const result = await tool.handler(ctx, args);
    return json({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: JSON.stringify(result) }], isError: false },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: message }], isError: true },
    });
  }
}

async function handleMcp(
  ctx: GenericActionCtx<GenericDataModel>,
  request: Request,
  server: McpServer,
  resolveScopes: ResolveOAuthScopes,
): Promise<Response> {
  const scopes = await resolveScopes(ctx, request);
  if (scopes === null) return unauthorized(request);

  let body: { id?: unknown; method?: string; params?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return rpcError(null, -32700, "Parse error.", { status: 400 });
  }
  const id = body.id ?? null;
  const sessionHeader = { "Mcp-Session-Id": `${PROTOCOL_VERSION}-${headerIdPart(id)}` };

  const methods: Record<string, () => Response | Promise<Response>> = {
    initialize: () =>
      json(
        {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: {
              name: server.name ?? "convex-auth-mcp",
              version: server.version ?? "0.0.0",
            },
          },
        },
        { headers: sessionHeader },
      ),
    "notifications/initialized": () => new Response(null, { status: 202 }),
    ping: () => json({ jsonrpc: "2.0", id, result: {} }),
    "tools/list": () =>
      json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: Object.entries(server.tools).map(([name, tool]) => ({
            name,
            description: tool.description,
            inputSchema: validatorToSchema(tool.args),
          })),
        },
      }),
    "tools/call": () => callTool(ctx, id, scopes, server.tools, body.params),
  };

  const handler = body.method ? methods[body.method] : undefined;
  if (!handler) return rpcError(id, -32601, `Unknown MCP method: ${body.method ?? "(none)"}`);
  return handler();
}

/**
 * Register the MCP server routes on an HTTP router: `POST <mcpPath>` (+ `405` on
 * other methods), the `oauth-protected-resource` discovery (+ path-aware
 * variant), and CORS preflights. All handlers carry CORS headers.
 */
export function addMcpRoutes(
  http: HttpRouter,
  deps: {
    tools: Record<string, McpToolDef>;
    name?: string;
    version?: string;
    scopes: string[];
    resolveScopes: ResolveOAuthScopes;
    mcpPath?: string;
    /** Canonical resource identifier advertised + enforced for this MCP endpoint. */
    resource: () => string;
    /** OAuth authorization-server issuer(s) for `authorization_servers` metadata. */
    authorizationServers: () => string[];
  },
) {
  const mcpPath = deps.mcpPath ?? "/mcp";
  const resourcePath = "/.well-known/oauth-protected-resource";
  const server: McpServer = { name: deps.name, version: deps.version, tools: deps.tools };

  http.route({
    path: mcpPath,
    method: "POST",
    handler: httpActionGeneric(
      withCors(async (ctx, request) =>
        withMcpProtocol(await handleMcp(ctx, request, server, deps.resolveScopes)),
      ),
    ),
  });

  const methodNotAllowed = httpActionGeneric(
    withCors(async () =>
      withMcpProtocol(
        json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST, OPTIONS" } }),
      ),
    ),
  );
  for (const method of ["GET", "PUT", "DELETE", "PATCH"] as const) {
    http.route({ path: mcpPath, method, handler: methodNotAllowed });
  }

  const resourceHandler = httpActionGeneric(
    withCors(async () =>
      protectedResource(deps.resource(), deps.authorizationServers(), deps.scopes),
    ),
  );
  http.route({ path: resourcePath, method: "GET", handler: resourceHandler });
  http.route({ path: `${resourcePath}${mcpPath}`, method: "GET", handler: resourceHandler });

  registerCorsPreflight(http, [mcpPath, resourcePath, `${resourcePath}${mcpPath}`]);
}
