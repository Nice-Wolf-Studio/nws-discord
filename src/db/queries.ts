import { db, hashApiKey } from './index.js';
import { nanoid } from 'nanoid';

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

// Session queries
export interface DmSession {
  id: string;
  user_id: string;
  status: 'active' | 'stopped' | 'executed' | 'waiting';
  title: string | null;
  created_at: number;
  updated_at: number;
  executed_at: number | null;
}

export interface SessionMessage {
  id: string;
  session_id: string;
  user_id: string;
  role: 'user' | 'bot';
  content: string;
  timestamp: number;
}

export function createSession(userId: string, title?: string): DmSession {
  const id = nanoid(12);
  const now = Date.now();

  db.prepare(`
    INSERT INTO dm_sessions (id, user_id, status, title, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?, ?)
  `).run(id, userId, title || null, now, now);

  return {
    id,
    user_id: userId,
    status: 'active',
    title: title || null,
    created_at: now,
    updated_at: now,
    executed_at: null,
  };
}

export function getActiveSession(userId: string): DmSession | null {
  const result = db.prepare(`
    SELECT * FROM dm_sessions
    WHERE user_id = ? AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `).get(userId) as DmSession | undefined;
  return result || null;
}

export function getSession(sessionId: string): DmSession | null {
  const result = db.prepare('SELECT * FROM dm_sessions WHERE id = ?').get(sessionId) as DmSession | undefined;
  return result || null;
}

export function getUserSessions(userId: string, limit = 20): DmSession[] {
  return db.prepare(`
    SELECT * FROM dm_sessions
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit) as DmSession[];
}

export function updateSessionStatus(sessionId: string, status: 'active' | 'stopped' | 'executed' | 'waiting'): boolean {
  const now = Date.now();
  const executedAt = status === 'executed' ? now : null;

  const result = db.prepare(`
    UPDATE dm_sessions
    SET status = ?, updated_at = ?, executed_at = COALESCE(?, executed_at)
    WHERE id = ?
  `).run(status, now, executedAt, sessionId);

  return result.changes > 0;
}

export function getWaitingSession(userId: string): DmSession | null {
  const result = db.prepare(`
    SELECT * FROM dm_sessions
    WHERE user_id = ? AND status = 'waiting'
    ORDER BY updated_at DESC LIMIT 1
  `).get(userId) as DmSession | undefined;
  return result || null;
}

export function updateSessionTitle(sessionId: string, title: string): boolean {
  const result = db.prepare(`
    UPDATE dm_sessions SET title = ?, updated_at = ? WHERE id = ?
  `).run(title, Date.now(), sessionId);
  return result.changes > 0;
}

export function addSessionMessage(
  sessionId: string,
  userId: string,
  role: 'user' | 'bot',
  content: string,
  messageId?: string
): SessionMessage {
  const id = messageId || nanoid(12);
  const now = Date.now();

  db.prepare(`
    INSERT INTO session_messages (id, session_id, user_id, role, content, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, sessionId, userId, role, content, now);

  // Update session timestamp
  db.prepare('UPDATE dm_sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);

  return { id, session_id: sessionId, user_id: userId, role, content, timestamp: now };
}

export function getSessionMessages(sessionId: string): SessionMessage[] {
  return db.prepare(`
    SELECT * FROM session_messages
    WHERE session_id = ?
    ORDER BY timestamp ASC
  `).all(sessionId) as SessionMessage[];
}

export function getSessionContext(sessionId: string): string {
  const messages = getSessionMessages(sessionId);
  return messages.map(m => `${m.role === 'user' ? 'User' : 'Bot'}: ${m.content}`).join('\n');
}

export function getPendingSessions(): DmSession[] {
  return db.prepare(`
    SELECT * FROM dm_sessions
    WHERE status = 'waiting'
    ORDER BY updated_at ASC
  `).all() as DmSession[];
}

// ============================================================
// Personality Session queries (restricted users)
// ============================================================

export interface PersonalitySession {
  id: string;
  user_id: string;
  personality: string;
  date: string;
  context: string;  // JSON array
  created_at: number;
  last_message_at: number;
}

export interface ActivePersonality {
  user_id: string;
  personality: string;
  started_at: number;
}

export function getOrCreatePersonalitySession(
  userId: string,
  personality: string,
  date: string
): PersonalitySession {
  const existing = db.prepare(`
    SELECT * FROM personality_sessions
    WHERE user_id = ? AND personality = ? AND date = ?
  `).get(userId, personality, date) as PersonalitySession | undefined;

  if (existing) return existing;

  const id = nanoid(12);
  const now = Date.now();

  db.prepare(`
    INSERT INTO personality_sessions (id, user_id, personality, date, context, created_at, last_message_at)
    VALUES (?, ?, ?, ?, '[]', ?, ?)
  `).run(id, userId, personality, date, now, now);

  return { id, user_id: userId, personality, date, context: '[]', created_at: now, last_message_at: now };
}

export function updatePersonalitySession(id: string, context: string): void {
  db.prepare(`
    UPDATE personality_sessions SET context = ?, last_message_at = ? WHERE id = ?
  `).run(context, Date.now(), id);
}

export function clearPersonalitySessions(userId: string): void {
  db.prepare(`DELETE FROM personality_sessions WHERE user_id = ?`).run(userId);
  db.prepare(`DELETE FROM active_personality WHERE user_id = ?`).run(userId);
}

export function cleanupOldPersonalitySessions(retentionDays = 7): number {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];

  const result = db.prepare(`
    DELETE FROM personality_sessions WHERE date < ?
  `).run(cutoff);

  return result.changes;
}

// Active personality (sticky sessions)
export function getActivePersonality(userId: string): string | null {
  const result = db.prepare(`
    SELECT personality FROM active_personality WHERE user_id = ?
  `).get(userId) as { personality: string } | undefined;
  return result?.personality || null;
}

export function setActivePersonality(userId: string, personality: string): void {
  db.prepare(`
    INSERT OR REPLACE INTO active_personality (user_id, personality, started_at)
    VALUES (?, ?, ?)
  `).run(userId, personality, Date.now());
}

export function clearActivePersonality(userId: string): void {
  db.prepare(`DELETE FROM active_personality WHERE user_id = ?`).run(userId);
}

// ============================================================
// Restricted Users & Access Requests
// ============================================================

export interface RestrictedUser {
  user_id: string;
  username: string;
  approved_at: number;
  approved_by: string;
}

export interface AccessRequest {
  user_id: string;
  username: string;
  requested_at: number;
  status: 'pending' | 'approved' | 'denied';
}

export function isRestrictedUser(userId: string): boolean {
  const result = db.prepare(`
    SELECT 1 FROM restricted_users WHERE user_id = ?
  `).get(userId);
  return !!result;
}

export function addRestrictedUser(userId: string, username: string, approvedBy: string): void {
  db.prepare(`
    INSERT OR REPLACE INTO restricted_users (user_id, username, approved_at, approved_by)
    VALUES (?, ?, ?, ?)
  `).run(userId, username, Date.now(), approvedBy);

  // Clean up any pending request
  db.prepare(`DELETE FROM access_requests WHERE user_id = ?`).run(userId);
}

export function removeRestrictedUser(userId: string): boolean {
  const result = db.prepare(`DELETE FROM restricted_users WHERE user_id = ?`).run(userId);
  return result.changes > 0;
}

export function getRestrictedUsers(): RestrictedUser[] {
  return db.prepare(`
    SELECT * FROM restricted_users ORDER BY approved_at DESC
  `).all() as RestrictedUser[];
}

// Access requests
export function hasPendingRequest(userId: string): boolean {
  const result = db.prepare(`
    SELECT 1 FROM access_requests WHERE user_id = ? AND status = 'pending'
  `).get(userId);
  return !!result;
}

export function createAccessRequest(userId: string, username: string): boolean {
  // Returns true if this is a new request, false if already exists
  const existing = db.prepare(`
    SELECT status FROM access_requests WHERE user_id = ?
  `).get(userId) as { status: string } | undefined;

  if (existing) {
    return false;  // Already has a request
  }

  db.prepare(`
    INSERT INTO access_requests (user_id, username, requested_at, status)
    VALUES (?, ?, ?, 'pending')
  `).run(userId, username, Date.now());

  return true;
}

export function getPendingRequests(): AccessRequest[] {
  return db.prepare(`
    SELECT * FROM access_requests WHERE status = 'pending' ORDER BY requested_at ASC
  `).all() as AccessRequest[];
}

export function approveAccessRequest(userId: string, approvedBy: string): AccessRequest | null {
  const request = db.prepare(`
    SELECT * FROM access_requests WHERE user_id = ?
  `).get(userId) as AccessRequest | undefined;

  if (!request) return null;

  db.prepare(`
    UPDATE access_requests SET status = 'approved' WHERE user_id = ?
  `).run(userId);

  addRestrictedUser(userId, request.username, approvedBy);

  return { ...request, status: 'approved' };
}

export function denyAccessRequest(userId: string): boolean {
  const result = db.prepare(`
    UPDATE access_requests SET status = 'denied' WHERE user_id = ? AND status = 'pending'
  `).run(userId);
  return result.changes > 0;
}
