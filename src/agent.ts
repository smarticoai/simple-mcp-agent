import {
	GoogleGenAI,
	Content,
	FunctionCall,
	FunctionDeclaration,
	Tool,
} from '@google/genai';
import type { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { callMCPTool } from './mcp-client';

const MAX_ITERATIONS = 10;

function mcpToolsToGeminiFunctions(mcpTools: MCPTool[]): FunctionDeclaration[] {
	return mcpTools.map((t) => ({
		name: t.name,
		description: t.description ?? '',
		parameters: t.inputSchema as Record<string, unknown>,
	}));
}

export interface AgentResult {
	answer: string;
	toolCalls: { tool: string; args: Record<string, unknown>; result: string }[];
	iterations: number;
}

export interface AgentSession {
	ai: GoogleGenAI;
	modelId: string;
	geminiTools: Tool[];
	systemInstruction?: string;
	mcpClient: Client;
	mcpTools: MCPTool[];
	/** Accumulated conversation history — grows with every chat turn */
	history: Content[];
}

/**
 * Creates a reusable agent session that persists conversation history across
 * multiple chat turns. Pass the returned session to `runTurn()` each time
 * the user sends a new message.
 */
export function createAgentSession(
	mcpClient: Client,
	mcpTools: MCPTool[],
	geminiApiKey: string,
	modelId: string,
	systemPrompt?: string,
): AgentSession {
	const ai = new GoogleGenAI({ apiKey: geminiApiKey });
	const geminiFunctions = mcpToolsToGeminiFunctions(mcpTools);
	const geminiTools: Tool[] = geminiFunctions.length > 0
		? [{ functionDeclarations: geminiFunctions }]
		: [];

	return {
		ai,
		modelId,
		geminiTools,
		systemInstruction: systemPrompt,
		mcpClient,
		mcpTools,
		history: [],
	};
}

/**
 * Runs a single user turn inside an existing agent session.
 *
 * Flow per iteration:
 *   1. Append the user message to history and send to Gemini.
 *   2. If Gemini responds with functionCall(s) → call matching MCP tools →
 *      feed results back as a user turn → loop.
 *   3. If Gemini responds with plain text → return it as the answer.
 *
 * History is mutated in place so subsequent turns retain full context.
 * The loop is capped at MAX_ITERATIONS to prevent runaway behaviour.
 */
export async function runTurn(
	session: AgentSession,
	userMessage: string,
): Promise<AgentResult> {
	const { ai, modelId, geminiTools, systemInstruction, mcpClient } = session;
	const toolCalls: AgentResult['toolCalls'] = [];

	session.history.push({ role: 'user', parts: [{ text: userMessage }] });

	for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
		console.log(`\n[Agent] Iteration ${iteration + 1}/${MAX_ITERATIONS}`);

		const response = await ai.models.generateContent({
			model: modelId,
			contents: session.history,
			config: {
				tools: geminiTools,
				...(systemInstruction ? { systemInstruction } : {}),
			},
		});

		const candidate = response.candidates?.[0];

		if (!candidate) {
			throw new Error('Gemini returned no candidates');
		}

		const modelContent: Content = { role: 'model', parts: candidate.content?.parts ?? [] };
		session.history.push(modelContent);

		const functionCallParts = (candidate.content?.parts ?? []).filter(
			(p): p is { functionCall: FunctionCall } => 'functionCall' in p,
		);

		if (functionCallParts.length === 0) {
			const text = (candidate.content?.parts ?? [])
				.filter((p): p is { text: string } => 'text' in p)
				.map((p) => p.text)
				.join('');

			return { answer: text, toolCalls, iterations: iteration + 1 };
		}

		const functionResponseParts: Content['parts'] = [];

		for (const part of functionCallParts) {
			const { name, args } = part.functionCall;
			if (!name) continue;
			const toolArgs = (args ?? {}) as Record<string, unknown>;

			console.log(`[Agent] → Calling MCP tool: ${name}`, toolArgs);

			const result = await callMCPTool(mcpClient, name, toolArgs);

			console.log(`[Agent] ← Tool result (${name}): ${result.slice(0, 200)}${result.length > 200 ? '...' : ''}`);

			toolCalls.push({ tool: name, args: toolArgs, result });

			functionResponseParts.push({
				functionResponse: {
					name,
					response: { content: result },
				},
			});
		}

		// Tool results fed back as a user turn (Gemini multi-turn function calling protocol)
		session.history.push({ role: 'user', parts: functionResponseParts });
	}

	throw new Error(`Agent exceeded ${MAX_ITERATIONS} iterations without a final answer`);
}
