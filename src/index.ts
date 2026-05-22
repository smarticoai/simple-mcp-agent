import 'dotenv/config';
import readline from 'readline/promises';
import { connectMCPClient } from './mcp-client';
import { createAgentSession, runTurn } from './agent';

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		console.error(`[Error] Missing required environment variable: ${name}`);
		console.error('Copy .env.example to .env and fill in your keys.');
		process.exit(1);
	}

	return value;
}

async function main(): Promise<void> {
	const geminiApiKey = requireEnv('GEMINI_API_KEY');
	const geminiModel = process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash';
	const mcpUrl = requireEnv('SMARTICO_MCP_URL');
	const mcpToken = requireEnv('SMARTICO_MCP_TOKEN');

	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
	console.log(' Simple MCP Agent — Interactive Chat');
	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
	console.log(`Model : ${geminiModel}`);
	console.log(`MCP   : ${mcpUrl}`);
	console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

	console.log('[Setup] Connecting to Smartico MCP server...');
	const mcp = await connectMCPClient(mcpUrl, mcpToken);

	console.log(`[Setup] Connected. Available tools (${mcp.tools.length}):`);
	for (const tool of mcp.tools) {
		console.log(`  • ${tool.name} — ${tool.description ?? ''}`);
	}

	// Load TOON reference and system prompt directly from MCP resources.
	const [toonReferenceResult, promptResult] = await Promise.all([
		mcp.client.readResource({ uri: 'smartico://segment/toon-reference' }),
		mcp.client.getPrompt({ name: 'segment_get_started' }),
	]);

	
	const toonReference = (toonReferenceResult.contents[0] as { text: string }).text;
	const promptText = (promptResult.messages[0].content as { text: string }).text;

	const systemPrompt = [
		promptText,
		toonReference,
	].join('\n\n');

	const session = createAgentSession(mcp.client, mcp.tools, geminiApiKey, geminiModel, systemPrompt);

	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

	console.log('\nType your query or "quit" to exit.\n');

	try {
		while (true) {
			const userInput = await rl.question('You: ');
			const trimmed = userInput.trim();

			if (!trimmed) continue;
			if (trimmed.toLowerCase() === 'quit') break;

			try {
				const result = await runTurn(session, trimmed);

				console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
				console.log(`Agent (${result.iterations} iteration(s)):`);
				console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
				console.log(result.answer);

				if (result.toolCalls.length > 0) {
					console.log(`\n[Tools used: ${result.toolCalls.map((tc) => tc.tool).join(', ')}]`);
				}
			} catch (err) {
				console.error('[Error]', (err as Error).message);
			}
		}
	} finally {
		rl.close();
		await mcp.close();
	}
}

main().catch((err: Error) => {
	console.error('[Fatal]', err.message);
	process.exit(1);
});
