# NWS Discord Integration

Skill for interacting with Nice Wolf Studio Discord channels via the nws-discord service.

## When to Use This Skill

Use this skill when:
- Sending messages or embeds to Discord channels
- Reading messages from Discord channels
- Posting notifications, alerts, or status updates
- Reacting to Discord messages

## Prerequisites

1. **MCP Server must be configured** in your Claude Code settings
2. **API key** with appropriate channel permissions

## Configuration

Add to your `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "nws-discord": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/nws-discord/dist/mcp/server.js"],
      "env": {
        "NWS_DISCORD_URL": "https://your-nws-discord-instance.railway.app",
        "NWS_DISCORD_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Available Tools

### send-message
Post a message to a Discord channel.

**Parameters:**
- `channel` (required): Channel ID
- `content` (optional): Text message content
- `embed` (optional): Discord embed object
- `idempotencyKey` (optional): Unique key to prevent duplicate sends

**Example:**
```javascript
mcp__nws_discord__send_message({
  channel: "1234567890",
  content: "Hello from Claude!",
  embed: {
    title: "Status Update",
    description: "Everything is working",
    color: 0x00ff00
  }
})
```

### read-messages
Fetch recent messages from a channel.

**Parameters:**
- `channel` (required): Channel ID
- `limit` (optional): Number of messages (1-100, default 50)

**Example:**
```javascript
mcp__nws_discord__read_messages({
  channel: "1234567890",
  limit: 10
})
```

### list-channels
List all channels your API key can access.

**Example:**
```javascript
mcp__nws_discord__list_channels({})
```

### list-guilds
List all Discord servers the bot is in.

**Example:**
```javascript
mcp__nws_discord__list_guilds({})
```

### add-reaction
React to a message with an emoji.

**Parameters:**
- `channel` (required): Channel ID
- `messageId` (required): Message ID to react to
- `emoji` (required): Emoji (unicode or custom)

**Example:**
```javascript
mcp__nws_discord__add_reaction({
  channel: "1234567890",
  messageId: "9876543210",
  emoji: "👍"
})
```

## Error Codes

| Code | Meaning |
|------|---------|
| `INVALID_API_KEY` | API key missing or invalid |
| `CHANNEL_NOT_ALLOWED` | API key doesn't have permission for this channel |
| `BOT_MISSING_ACCESS` | Bot cannot access this channel |
| `RATE_LIMITED` | Too many requests |
| `DUPLICATE_MESSAGE` | Idempotency key already used |
| `INVALID_EMBED` | Embed validation failed |

## Troubleshooting

### "Channel not allowed" error
Your API key needs permission for that channel. Contact admin to add the channel to your key's allowlist.

### "Bot missing access" error
The Discord bot doesn't have access to that channel. Check bot permissions in Discord server settings.

### MCP tools not appearing
1. Verify mcp.json configuration is correct
2. Restart Claude Code completely
3. Check that the NWS Discord service is running

## HTTP API Alternative

If MCP isn't available, you can call the HTTP API directly:

```bash
curl -X POST https://your-instance.railway.app/channels/CHANNEL_ID/messages \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello world"}'
```

## Channel ID Reference

To find a channel ID:
1. Enable Developer Mode in Discord (User Settings → Advanced)
2. Right-click the channel → Copy Channel ID
