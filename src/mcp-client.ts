import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export interface MCPConnection {
	client: Client;
	tools: Tool[];
	close: () => Promise<void>;
}

/**
 * Opens an HTTP Streamable MCP connection to the given URL.
 * Returns the connected client, the list of available tools, and a close handle.
 */
export async function connectMCPClient(url: string, token: string): Promise<MCPConnection> {
	const transport = new StreamableHTTPClientTransport(new URL(url), {
		requestInit: {
			headers: {
				Authorization: token,
			},
		},
	});

	const client = new Client({ name: 'simple-mcp-agent', version: '1.0.0' });
	await client.connect(transport);

	const { tools } = await client.listTools();

	return {
		client,
		tools,
		close: async () => {
			await client.close();
		},
	};
}

/**
 * Calls an MCP tool and returns the concatenated text from all text content blocks.
 */
export async function callMCPTool(
	client: Client,
	name: string,
	args: Record<string, unknown>,
): Promise<string> {
	const result = await client.callTool({ name, arguments: args });
	const content = (result as { content?: { type: string; text: string }[] }).content ?? [];

	return content
		.filter((c) => c.type === 'text')
		.map((c) => c.text)
		.join('');
}
