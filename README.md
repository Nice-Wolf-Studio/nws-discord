# nws-discord

Nice Wolf Studio Discord notification service - a centralized API gateway for Discord interactions.

## Features

- **HTTP API** - REST endpoints for sending/reading messages, managing channels
- **MCP Server** - Claude Code integration via Model Context Protocol
- **API Key Auth** - Per-client keys with channel-level permissions
- **Deduplication** - Idempotency keys prevent duplicate messages
- **Audit Logging** - Track all API usage

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your DISCORD_TOKEN and ADMIN_API_KEY

# Development
npm run dev

# Production
npm run build
npm start
```

## API Endpoints

### Public (requires API key)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Service health |
| GET | `/channels` | List accessible channels |
| GET | `/channels/:id/messages` | Read messages |
| POST | `/channels/:id/messages` | Send message |
| PATCH | `/channels/:id/messages/:msgId` | Edit message |
| DELETE | `/channels/:id/messages/:msgId` | Delete message |
| POST | `/channels/:id/reactions` | Add reaction |
| GET | `/guilds` | List guilds |

### Admin (requires admin key)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/admin/keys` | Create API key |
| GET | `/admin/keys` | List API keys |
| DELETE | `/admin/keys/:id` | Revoke key |
| POST | `/admin/keys/:id/channels` | Add channel permission |
| DELETE | `/admin/keys/:id/channels/:channelId` | Remove permission |

## MCP Server

For Claude Code integration:

```json
{
  "mcpServers": {
    "nws-discord": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/nws-discord/dist/mcp/server.js"],
      "env": {
        "NWS_DISCORD_URL": "http://localhost:3000",
        "NWS_DISCORD_API_KEY": "your-key"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Discord bot token |
| `ADMIN_API_KEY` | Yes | Admin API key |
| `PORT` | No | HTTP port (default: 3000) |
| `DATABASE_PATH` | No | SQLite path (default: ./data/nws-discord.db) |
| `DEDUP_WINDOW_SECONDS` | No | Dedup window (default: 300) |

## Deployment

### Railway

```bash
# Push to Railway
railway up
```

Configure these secrets in Railway:
- `DISCORD_TOKEN`
- `ADMIN_API_KEY`

## License

MIT
