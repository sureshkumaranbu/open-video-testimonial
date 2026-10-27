# Plaudit in AI assistants (MCP)

Plaudit has a built-in [Model Context Protocol](https://modelcontextprotocol.io) server, so an AI assistant can look up your testimonials, find a quote, give you embed codes or invite a customer, using your own data and nothing else. It's at **`https://<your-plaudit>/mcp`** (feature flag `mcp`, on by default).

## What the assistant can do

| Tool | What it does | Key |
|---|---|---|
| `list_testimonials` | A project's testimonials, newest first. Approved ones unless it asks for another status | read |
| `search_testimonials` | Testimonials containing all the words searched for (in the text, author, company, tags or answers) | read |
| `get_testimonial` | One testimonial, with its answers | read |
| `get_embed_codes` | The snippets for your saved widgets and forms, and your wall's address | read |
| `summarize` | How many testimonials you have in each status, the average rating and its spread, your top tags and the newest quotes. **Plaudit counts these itself: no AI is involved and nothing is sent anywhere** | read |
| `create_invite` | Adds someone to an active campaign, which emails them its invitation (optionally some days later) | read and write |

With several projects, the assistant says which one (by its slug); with one, it doesn't need to.

**What the assistant sees.** The words, rating, tags and the person's name, job title and company. **Never** their email address or phone number, consent records, or a form's private and hidden fields. A video's address is included only while the testimonial is approved. The assistant's provider (Anthropic, OpenAI…) receives whatever the tools return, so connect only assistants you're happy to share your testimonials with.

## Make a key

In Plaudit, **Settings › API keys**: name it (for example "Claude") and choose **Read only**, unless you want the assistant to send invitations. A read-only key never sees `create_invite`. Revoke it on the same screen at any time. Each key may make 600 requests a minute.

## Claude Desktop

Claude Desktop starts local MCP servers from its config file, so connect through the small `mcp-remote` bridge, which needs [Node.js](https://nodejs.org) on your computer:

1. In Claude Desktop, open **Settings › Developer › Edit Config**. That opens `claude_desktop_config.json`.
2. Add Plaudit under `mcpServers`:

   ```json
   {
     "mcpServers": {
       "plaudit": {
         "command": "npx",
         "args": ["-y", "mcp-remote", "https://plaudit.example.com/mcp", "--header", "Authorization:${PLAUDIT_AUTH}"],
         "env": { "PLAUDIT_AUTH": "Bearer plk_…" }
       }
     }
   }
   ```

   The key goes in `env` so there's no space inside `args` (some versions split arguments on spaces).
3. Restart Claude Desktop. Plaudit's tools appear under the tools menu in a new chat. Ask, for example, "Summarize my testimonials from this month" or "Find a quote about onboarding for our pricing page".

## Other clients

Any client that speaks MCP over **Streamable HTTP** and lets you set a request header works directly:

- **URL:** `https://plaudit.example.com/mcp`
- **Header:** `Authorization: Bearer plk_…`

That includes Claude Code (`claude mcp add --transport http plaudit https://plaudit.example.com/mcp --header "Authorization: Bearer plk_…"`), Cursor, VS Code and the MCP Inspector.

## ChatGPT

ChatGPT's connectors talk to remote MCP servers from OpenAI's side, and, at the time of writing, they ask an authenticated server for **OAuth** rather than a fixed header. Plaudit's MCP server uses API keys only for now, so it can't be added as a ChatGPT connector directly. You can still use it from ChatGPT through a bridge or proxy you control that adds the `Authorization` header, as long as only you can reach that bridge. Native OAuth for connectors is planned.

## How it works

- Plain JSON-RPC 2.0 over HTTP `POST` (MCP's Streamable HTTP transport, answered with JSON): `initialize`, `ping`, `tools/list` and `tools/call`. There's no server-sent event stream and no session to keep, so `GET` and `DELETE` answer `405`.
- Supported protocol versions: `2025-11-25`, `2025-06-18`, `2025-03-26` and `2024-11-05`.
- Requests from web pages on other sites (an `Origin` header that isn't your Plaudit address) are refused. Bodies are limited to 64 KB, and a batch to 20 messages.
- A missing or wrong key answers `401` with `WWW-Authenticate: Bearer`.
- `PLAUDIT_FEATURES` without `mcp` (or `all`) turns `/mcp` off (404).

## Troubleshooting

| What you see | Fix |
|---|---|
| The tools don't appear in Claude Desktop | Check the config is valid JSON, that Node.js is installed (`npx -v` in a terminal), and restart Claude Desktop. Its MCP log is under **Settings › Developer** |
| `401` / "Invalid or revoked API key" | Copy the key again; it's shown once when it's made. Revoked keys stop at once |
| "create_invite needs a read-write API key" | Make a read-and-write key, or invite from the dashboard |
| "This campaign is a draft" | Start the campaign in Plaudit first |
| "Say which project" | Tell the assistant which project, by its slug (shown in the project's address) |
