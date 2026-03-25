import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const BASE_URL = process.env.NWS_DISCORD_URL || 'http://localhost:3000';
const API_KEY = process.env.NWS_DISCORD_API_KEY;

async function callApi(path: string, options: RequestInit = {}) {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (API_KEY) {
    headers['Authorization'] = `Bearer ${API_KEY}`;
  }

  const response = await fetch(url, { ...options, headers });
  return response.json();
}

const sendMessageSchema = z.object({
  channel: z.string().describe('Channel ID or name'),
  content: z.string().optional().describe('Message content'),
  embed: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    color: z.number().optional(),
    fields: z.array(z.object({
      name: z.string(),
      value: z.string(),
      inline: z.boolean().optional(),
    })).optional(),
  }).optional().describe('Discord embed object'),
  idempotencyKey: z.string().optional().describe('Unique key to prevent duplicates'),
});

const readMessagesSchema = z.object({
  channel: z.string().describe('Channel ID'),
  limit: z.number().min(1).max(100).optional().describe('Number of messages (1-100)'),
});

const addReactionSchema = z.object({
  channel: z.string().describe('Channel ID'),
  messageId: z.string().describe('Message ID to react to'),
  emoji: z.string().describe('Emoji to react with'),
});

export async function startMcpServer() {
  const server = new Server(
    { name: 'nws-discord', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'send-message',
        description: 'Send a message to a Discord channel',
        inputSchema: {
          type: 'object',
          properties: {
            channel: { type: 'string', description: 'Channel ID' },
            content: { type: 'string', description: 'Message content' },
            embed: {
              type: 'object',
              description: 'Discord embed object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                color: { type: 'number' },
                fields: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      value: { type: 'string' },
                      inline: { type: 'boolean' },
                    },
                    required: ['name', 'value'],
                  },
                },
              },
            },
            idempotencyKey: { type: 'string', description: 'Unique key to prevent duplicates' },
          },
          required: ['channel'],
        },
      },
      {
        name: 'read-messages',
        description: 'Read recent messages from a Discord channel',
        inputSchema: {
          type: 'object',
          properties: {
            channel: { type: 'string', description: 'Channel ID' },
            limit: { type: 'number', description: 'Number of messages (1-100)', minimum: 1, maximum: 100 },
          },
          required: ['channel'],
        },
      },
      {
        name: 'list-channels',
        description: 'List Discord channels this client can access',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'list-guilds',
        description: 'List Discord guilds (servers) the bot is in',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'add-reaction',
        description: 'Add a reaction to a message',
        inputSchema: {
          type: 'object',
          properties: {
            channel: { type: 'string', description: 'Channel ID' },
            messageId: { type: 'string', description: 'Message ID' },
            emoji: { type: 'string', description: 'Emoji to react with' },
          },
          required: ['channel', 'messageId', 'emoji'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'send-message': {
          const parsed = sendMessageSchema.parse(args);
          const result = await callApi(`/channels/${parsed.channel}/messages`, {
            method: 'POST',
            body: JSON.stringify({
              content: parsed.content,
              embed: parsed.embed,
              idempotencyKey: parsed.idempotencyKey,
            }),
          });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'read-messages': {
          const parsed = readMessagesSchema.parse(args);
          const limit = parsed.limit || 50;
          const result = await callApi(`/channels/${parsed.channel}/messages?limit=${limit}`);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'list-channels': {
          const result = await callApi('/channels');
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'list-guilds': {
          const result = await callApi('/guilds');
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'add-reaction': {
          const parsed = addReactionSchema.parse(args);
          const result = await callApi(`/channels/${parsed.channel}/reactions`, {
            method: 'POST',
            body: JSON.stringify({
              messageId: parsed.messageId,
              emoji: parsed.emoji,
            }),
          });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('NWS Discord MCP server running on stdio');
}

// Run if executed directly
if (process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts')) {
  startMcpServer().catch(console.error);
}
