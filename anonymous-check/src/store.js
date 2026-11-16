'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const OPEN_STATUSES = new Set(['open', 'claimed']);
const DECIDED_STATUSES = new Set(['valid', 'not_valid']);
const HOUR_MS = 60 * 60 * 1000;

/**
 * Saves flagged messages ("cases") and who flagged them ("reports").
 * One case per Discord message, so a message is only ever reviewed once.
 */
class FlagStore {
  /** @param {string} dbPath file path, or ':memory:' for tests */
  constructor(dbPath) {
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS cases (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id          TEXT NOT NULL,
        channel_id        TEXT NOT NULL,
        message_id        TEXT NOT NULL UNIQUE,
        author_id         TEXT,
        content_snapshot  TEXT,
        status            TEXT NOT NULL DEFAULT 'open',
        review_message_id TEXT,
        claimed_by        TEXT,
        decided_by        TEXT,
        decided_at        INTEGER,
        created_at        INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reports (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id     INTEGER NOT NULL REFERENCES cases(id),
        reporter_id TEXT NOT NULL,
        reason      TEXT,
        created_at  INTEGER NOT NULL,
        UNIQUE (case_id, reporter_id)
      );
      CREATE INDEX IF NOT EXISTS reports_by_reporter ON reports (reporter_id, created_at);
    `);
  }

  close() {
    this.db.close();
  }

  getCase(id) {
    return this.db.prepare('SELECT * FROM cases WHERE id = ?').get(id) ?? null;
  }

  getCaseByMessage(messageId) {
    return this.db.prepare('SELECT * FROM cases WHERE message_id = ?').get(messageId) ?? null;
  }

  listReports(caseId) {
    return this.db.prepare('SELECT * FROM reports WHERE case_id = ? ORDER BY created_at, id').all(caseId);
  }

  countRecentReports(reporterId, now = Date.now()) {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at > ?')
      .get(reporterId, now - HOUR_MS);
    return Number(row.n);
  }

  /**
   * Record one member's flag on one message. All the "already flagged" logic lives here.
   *
   * @param {object} f
   * @param {string} f.guildId
   * @param {string} f.channelId
   * @param {string} f.messageId
   * @param {string} f.authorId     author of the flagged message
   * @param {string} f.snapshot     copy of the message text at flag time
   * @param {string} f.reporterId
   * @param {string} [f.reason]
   * @param {object} [opts]
   * @param {number} [opts.maxPerHour=5]
   * @param {number} [opts.now]
   * @returns {{outcome: 'created'|'added'|'already_flagged_by_you'|'already_reviewed'|'rate_limited', case: object|null}}
   */
  submitFlag(f, { maxPerHour = 5, now = Date.now() } = {}) {
    const existing = this.getCaseByMessage(f.messageId);

    if (existing && DECIDED_STATUSES.has(existing.status)) {
      return { outcome: 'already_reviewed', case: existing };
    }
    if (existing) {
      const mine = this.db
        .prepare('SELECT 1 FROM reports WHERE case_id = ? AND reporter_id = ?')
        .get(existing.id, f.reporterId);
      if (mine) return { outcome: 'already_flagged_by_you', case: existing };
    }
    if (this.countRecentReports(f.reporterId, now) >= maxPerHour) {
      return { outcome: 'rate_limited', case: existing };
    }

    this.db.exec('BEGIN');
    try {
      let c = existing;
      let outcome = 'added';
      if (!c) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO cases (guild_id, channel_id, message_id, author_id, content_snapshot, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(f.guildId, f.channelId, f.messageId, f.authorId ?? null, f.snapshot ?? null, now);
        c = this.getCaseByMessage(f.messageId);
        outcome = 'created';
      }
      this.db
        .prepare('INSERT OR IGNORE INTO reports (case_id, reporter_id, reason, created_at) VALUES (?, ?, ?, ?)')
        .run(c.id, f.reporterId, f.reason?.trim() || null, now);
      this.db.exec('COMMIT');
      return { outcome, case: this.getCase(c.id) };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  setReviewMessage(caseId, reviewMessageId) {
    this.db.prepare('UPDATE cases SET review_message_id = ? WHERE id = ?').run(reviewMessageId, caseId);
  }

  /** A core member says "I'm on it". Only works while the case is open. */
  claim(caseId, userId) {
    this.db
      .prepare(`UPDATE cases SET status = 'claimed', claimed_by = ? WHERE id = ? AND status IN ('open','claimed')`)
      .run(userId, caseId);
    return this.getCase(caseId);
  }

  /** @param {'valid'|'not_valid'} status */
  decide(caseId, status, userId, now = Date.now()) {
    if (!DECIDED_STATUSES.has(status)) throw new Error(`bad status ${status}`);
    this.db
      .prepare('UPDATE cases SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?')
      .run(status, userId, now, caseId);
    return this.getCase(caseId);
  }

  /** Undo a decision made by mistake. */
  reopen(caseId) {
    this.db
      .prepare(`UPDATE cases SET status = 'open', decided_by = NULL, decided_at = NULL, claimed_by = NULL WHERE id = ?`)
      .run(caseId);
    return this.getCase(caseId);
  }
}

module.exports = { FlagStore, OPEN_STATUSES, DECIDED_STATUSES };
