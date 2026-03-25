import { db, hashApiKey } from './index.js';

export interface ApiKey {
  id: string;
  name: string;
  rate_limit: number;
  created_at: number;
  last_used_at: number | null;
  enabled: number;
}

export interface ChannelPermission {
  api_key_id: string;
  channel_id: string;
  can_read: number;
  can_write: number;
}

// API Key queries
export function validateApiKey(rawKey: string): ApiKey | null {
  const keyHash = hashApiKey(rawKey);
  const stmt = db.prepare(`
    SELECT id, name, rate_limit, created_at, last_used_at, enabled
    FROM api_keys
    WHERE key_hash = ? AND enabled = 1
  `);
  const result = stmt.get(keyHash) as ApiKey | undefined;

  if (result) {
    // Update last_used_at
    db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?')
      .run(Date.now(), result.id);
  }

  return result || null;
}

export function createApiKey(id: string, rawKey: string, name: string, rateLimit = 30): void {
  const keyHash = hashApiKey(rawKey);
  db.prepare(`
    INSERT INTO api_keys (id, key_hash, name, rate_limit, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, keyHash, name, rateLimit, Date.now());
}

export function listApiKeys(): Omit<ApiKey, 'key_hash'>[] {
  return db.prepare(`
    SELECT id, name, rate_limit, created_at, last_used_at, enabled
    FROM api_keys
    ORDER BY created_at DESC
  `).all() as ApiKey[];
}

export function deleteApiKey(id: string): boolean {
  const result = db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
  return result.changes > 0;
}

// Channel permission queries
export function getChannelPermissions(apiKeyId: string): ChannelPermission[] {
  return db.prepare(`
    SELECT * FROM channel_permissions WHERE api_key_id = ?
  `).all(apiKeyId) as ChannelPermission[];
}

export function canAccessChannel(apiKeyId: string, channelId: string, write = false): boolean {
  const perm = db.prepare(`
    SELECT can_read, can_write FROM channel_permissions
    WHERE api_key_id = ? AND channel_id = ?
  `).get(apiKeyId, channelId) as ChannelPermission | undefined;

  if (!perm) return false;
  return write ? perm.can_write === 1 : perm.can_read === 1;
}

export function addChannelPermission(
  apiKeyId: string,
  channelId: string,
  canRead = true,
  canWrite = true
): void {
  db.prepare(`
    INSERT OR REPLACE INTO channel_permissions (api_key_id, channel_id, can_read, can_write)
    VALUES (?, ?, ?, ?)
  `).run(apiKeyId, channelId, canRead ? 1 : 0, canWrite ? 1 : 0);
}

export function removeChannelPermission(apiKeyId: string, channelId: string): boolean {
  const result = db.prepare(`
    DELETE FROM channel_permissions WHERE api_key_id = ? AND channel_id = ?
  `).run(apiKeyId, channelId);
  return result.changes > 0;
}

// Dedup cache queries
export function checkDedup(apiKeyId: string, idempotencyKey: string): string | null {
  const result = db.prepare(`
    SELECT message_id FROM dedup_cache
    WHERE api_key_id = ? AND idempotency_key = ?
  `).get(apiKeyId, idempotencyKey) as { message_id: string } | undefined;
  return result?.message_id || null;
}

export function setDedup(apiKeyId: string, idempotencyKey: string, messageId: string): void {
  db.prepare(`
    INSERT OR REPLACE INTO dedup_cache (api_key_id, idempotency_key, message_id, created_at)
    VALUES (?, ?, ?, ?)
  `).run(apiKeyId, idempotencyKey, messageId, Date.now());
}

export function cleanupDedup(windowSeconds: number): number {
  const cutoff = Date.now() - (windowSeconds * 1000);
  const result = db.prepare('DELETE FROM dedup_cache WHERE created_at < ?').run(cutoff);
  return result.changes;
}

// Audit log queries
export function logAction(
  apiKeyId: string,
  action: string,
  channelId?: string,
  messageId?: string
): void {
  db.prepare(`
    INSERT INTO audit_log (api_key_id, action, channel_id, message_id, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `).run(apiKeyId, action, channelId || null, messageId || null, Date.now());
}

export function cleanupAuditLog(retentionDays: number): number {
  const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
  const result = db.prepare('DELETE FROM audit_log WHERE timestamp < ?').run(cutoff);
  return result.changes;
}

// Incoming DM queries
export interface IncomingDm {
  id: string;
  user_id: string;
  username: string;
  content: string;
  timestamp: number;
  read: number;
}

export function storeIncomingDm(
  id: string,
  userId: string,
  username: string,
  content: string
): void {
  db.prepare(`
    INSERT OR IGNORE INTO incoming_dms (id, user_id, username, content, timestamp, read)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(id, userId, username, content, Date.now());
}

export function getIncomingDms(userId?: string, unreadOnly = false, limit = 50): IncomingDm[] {
  let query = 'SELECT * FROM incoming_dms';
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (userId) {
    conditions.push('user_id = ?');
    params.push(userId);
  }
  if (unreadOnly) {
    conditions.push('read = 0');
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  return db.prepare(query).all(...params) as IncomingDm[];
}

export function markDmsRead(ids: string[]): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`UPDATE incoming_dms SET read = 1 WHERE id IN (${placeholders})`).run(...ids);
  return result.changes;
}

export function getUnreadDmCount(userId?: string): number {
  if (userId) {
    const result = db.prepare('SELECT COUNT(*) as count FROM incoming_dms WHERE user_id = ? AND read = 0').get(userId) as { count: number };
    return result.count;
  }
  const result = db.prepare('SELECT COUNT(*) as count FROM incoming_dms WHERE read = 0').get() as { count: number };
  return result.count;
}
