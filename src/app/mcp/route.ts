import { mcpNotAllowed, mcpPost } from "@/lib/mcp";

/** INT-04: the MCP server (Streamable HTTP, answered with JSON). An API key is the bearer token. */
export function POST(req: Request) {
  return mcpPost(req);
}

export function GET() {
  return mcpNotAllowed();
}

export function DELETE() {
  return mcpNotAllowed();
}
