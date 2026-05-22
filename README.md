# simple-mcp-agent

NodeJS/TypeScript demo of an interactive AI Agent that communicates with the **Smartico BO MCP server** using **Google Gemini**.

## What it demonstrates

- Connecting to an MCP server over **HTTP Streamable transport** with Bearer token auth
- Listing MCP tools at runtime and converting them to Gemini **function declarations**
- Using MCP **resources** (`readResource`) and **prompts** (`getPrompt`) from Node.js code to build rich system context
- A **multi-turn chat loop** powered by `readline` — conversation history is preserved across turns so the model retains full context
- A **ReAct-style agent loop** per turn: Gemini decides which MCP tool to call → result is fed back → Gemini calls more tools or produces a final answer

## Architecture

```
index.ts (chat loop)
  │
  ├─ connectMCPClient()  ──► Smartico BO MCP  HTTP /mcp
  │                               Bearer token auth
  │
  ├─ readResource(toon-reference)    ─┐
  ├─ getPrompt(segment_get_started)   ├─ Node.js protocol calls (not tools)
  │                                  ─┘ → injected as systemInstruction
  │
  └─ createAgentSession()  ──► Gemini model + tools + system prompt
       │
       └─ runTurn(session, userMessage)  [per chat message]
            │
            ├─ history.push(user message)
            ├─ Gemini generateContent(history)
            │    └─ functionCall  → callMCPTool()  → MCP server
            │    └─ functionResponse → next iteration
            └─ Final text answer → print → next readline prompt
```

### Key design points

| Concept | How it works here |
|---|---|
| **MCP tools** | Surfaced to Gemini as `FunctionDeclaration[]`. Gemini calls them; results are fed back as `functionResponse` parts. |
| **MCP resources** | Read in Node.js code at startup (`client.readResource()`). Content is injected into the Gemini `systemInstruction`. The model never calls resources directly — it has no mechanism to do so. |
| **MCP prompts** | Same as resources — fetched in Node.js (`client.getPrompt()`), injected as system context. The `segment_get_started` prompt tells the model to call `read_resource` (a real MCP tool) to load workflow instructions on demand. |
| **`read_resource` tool** | A real MCP tool registered on the server that wraps `resources/read`. This bridges the gap — the model can call it to load a workflow resource by URI when needed. |
| **Conversation history** | A single `Content[]` array grows with every turn. Each `runTurn()` call appends the user message, model response, and tool call/response pairs, giving Gemini full context. |

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 18+ | Required for native `fetch` used by the MCP HTTP transport |
| `index-ai` running | Smartico BO MCP is served by `server/index-ai.ts` on port `1031` by default |
| Gemini API key | Get one free at [aistudio.google.com](https://aistudio.google.com/apikey) |
| MCP Bearer token | Obtain from the BO back-office (TokenType.MCP) |

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env and fill in GEMINI_API_KEY and SMARTICO_MCP_TOKEN
```

## Usage

```bash
# Start the interactive chat
npm run dev

# Build TypeScript and run compiled output
npm run build
npm start
```

Example session:

```
You: create segment of users from Japan
Agent: [calls search_properties → get_properties_by_names → segment_create dry_run]
       Here is the preview. Would you like to create it?

You: yes
Agent: [calls segment_create dry_run:false]
       Segment created. View it here: https://...
```

Type `quit` to exit.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Google AI Studio API key |
| `GEMINI_MODEL` | No | Model ID (default: `gemini-2.5-flash`) |
| `SMARTICO_MCP_URL` | Yes | MCP server URL (e.g. `http://localhost:1031/mcp`) |
| `SMARTICO_MCP_TOKEN` | Yes | Bearer token for MCP authentication |

## File structure

```
simple-mcp-agent/
├── .env                # Real secrets — gitignored, never commit
├── .env.example        # Template — copy to .env and fill in keys
├── .gitignore          # Excludes .env, dist/, node_modules/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts        # CLI entry point: env, MCP connect, system prompt, readline chat loop
    ├── mcp-client.ts   # MCP HTTP client: connect (StreamableHTTP + Bearer), listTools, callTool
    └── agent.ts        # Gemini session + ReAct loop: createAgentSession(), runTurn()
```

To expose resource content to the model, either:
1. **Pre-load it** in setup code and inject into `systemInstruction` (used here for TOON reference + `segment_get_started`)
2. **Wrap it as a tool** — the `read_resource` tool on the MCP server does exactly this, letting the model load workflow instructions on demand by URI
