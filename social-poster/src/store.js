'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PLATFORMS = ['facebook', 'instagram', 'threads', 'x'];

/**
 * Post statuses:
 *   pending   waiting for Cassey
 *   rejected  Cassey said no (never posted)
 *   posting   approved, being sent now
 *   posted    every chosen platform worked
 *   partial   some platforms worked, some failed (retry sends only the failed ones)
 *   failed    nothing worked
 */
class PostStore {
  constructor(dbPath) {
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS posts (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        caption       TEXT NOT NULL DEFAULT '',
        overrides     TEXT NOT NULL DEFAULT '{}',
        platforms     TEXT NOT NULL DEFAULT '[]',
        note          TEXT NOT NULL DEFAULT '',
        status        TEXT NOT NULL DEFAULT 'pending',
        submitted_by  TEXT NOT NULL,
        decided_by    TEXT,
        decided_at    INTEGER,
        reject_reason TEXT,
        created_at    INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS photos (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id   INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        filename  TEXT NOT NULL UNIQUE,
        width     INTEGER NOT NULL,
        height    INTEGER NOT NULL,
        bytes     INTEGER NOT NULL,
        position  INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS results (
        post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        platform   TEXT NOT NULL,
        status     TEXT NOT NULL,
        remote_id  TEXT,
        url        TEXT,
        error      TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (post_id, platform)
      );
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  close() {
    this.db.close();
  }

  createPost({ caption, overrides = {}, platforms, note = '', submittedBy, photos }) {
    const now = Date.now();
    this.db.exec('BEGIN');
    try {
      const { lastInsertRowid } = this.db
        .prepare('INSERT INTO posts (caption, overrides, platforms, note, submitted_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(caption, JSON.stringify(overrides), JSON.stringify(platforms), note, submittedBy, now);
      const insert = this.db.prepare(
        'INSERT INTO photos (post_id, filename, width, height, bytes, position) VALUES (?, ?, ?, ?, ?, ?)',
      );
      photos.forEach((p, i) => insert.run(lastInsertRowid, p.filename, p.width, p.height, p.bytes, i));
      this.db.exec('COMMIT');
      return Number(lastInsertRowid);
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  getPost(id) {
    const row = this.db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
    return row ? this.#hydrate(row) : null;
  }

  listPosts({ statuses, submittedBy, limit = 50 } = {}) {
    const where = [];
    const args = [];
    if (statuses?.length) {
      where.push(`status IN (${statuses.map(() => '?').join(',')})`);
      args.push(...statuses);
    }
    if (submittedBy) {
      where.push('submitted_by = ?');
      args.push(submittedBy);
    }
    const sql = `SELECT * FROM posts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`;
    return this.db.prepare(sql).all(...args, limit).map((r) => this.#hydrate(r));
  }

  countByStatus(status) {
    return this.db.prepare('SELECT COUNT(*) AS n FROM posts WHERE status = ?').get(status).n;
  }

  /** Edits are only allowed while a post is still waiting for approval. */
  updateDraft(id, { caption, overrides, platforms }) {
    const r = this.db
      .prepare("UPDATE posts SET caption = ?, overrides = ?, platforms = ? WHERE id = ? AND status = 'pending'")
      .run(caption, JSON.stringify(overrides), JSON.stringify(platforms), id);
    return r.changes === 1;
  }

  /** Moves pending -> posting exactly once, so a double click can never post twice. */
  approve(id, by) {
    const r = this.db
      .prepare("UPDATE posts SET status = 'posting', decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
      .run(by, Date.now(), id);
    return r.changes === 1;
  }

  reject(id, by, reason) {
    const r = this.db
      .prepare(
        "UPDATE posts SET status = 'rejected', decided_by = ?, decided_at = ?, reject_reason = ? WHERE id = ? AND status = 'pending'",
      )
      .run(by, Date.now(), reason || null, id);
    return r.changes === 1;
  }

  /** partial/failed -> posting, for a retry of the platforms that did not work. */
  startRetry(id) {
    const r = this.db
      .prepare("UPDATE posts SET status = 'posting' WHERE id = ? AND status IN ('partial', 'failed')")
      .run(id);
    return r.changes === 1;
  }

  setStatus(id, status) {
    this.db.prepare('UPDATE posts SET status = ? WHERE id = ?').run(status, id);
  }

  saveResult(postId, platform, { status, remoteId = null, url = null, error = null }) {
    this.db
      .prepare(
        `INSERT INTO results (post_id, platform, status, remote_id, url, error, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (post_id, platform) DO UPDATE SET status = excluded.status, remote_id = excluded.remote_id,
           url = excluded.url, error = excluded.error, updated_at = excluded.updated_at`,
      )
      .run(postId, platform, status, remoteId, url, error, Date.now());
  }

  /** Posts left in "posting" by a crash or restart. Their unfinished platforms are marked unknown, not retried blindly. */
  recoverInterrupted() {
    const stuck = this.db.prepare("SELECT id FROM posts WHERE status = 'posting'").all();
    for (const { id } of stuck) {
      const post = this.getPost(id);
      for (const p of post.platforms) {
        if (post.results[p]?.status !== 'posted') {
          this.saveResult(id, p, {
            status: 'failed',
            error: 'The app restarted while posting. Check the account before retrying, in case it already went out.',
          });
        }
      }
      this.setStatus(id, this.#overall(this.getPost(id)));
    }
    return stuck.length;
  }

  finish(id) {
    const status = this.#overall(this.getPost(id));
    this.setStatus(id, status);
    return status;
  }

  photoByFilename(filename) {
    return this.db
      .prepare('SELECT photos.*, posts.status AS post_status FROM photos JOIN posts ON posts.id = photos.post_id WHERE filename = ?')
      .get(filename) ?? null;
  }

  getSetting(key) {
    return this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
  }

  setSetting(key, value) {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  #overall(post) {
    const states = post.platforms.map((p) => post.results[p]?.status);
    if (states.length && states.every((s) => s === 'posted')) return 'posted';
    if (states.some((s) => s === 'posted')) return 'partial';
    return 'failed';
  }

  #hydrate(row) {
    const photos = this.db.prepare('SELECT * FROM photos WHERE post_id = ? ORDER BY position').all(row.id);
    const results = {};
    for (const r of this.db.prepare('SELECT * FROM results WHERE post_id = ?').all(row.id)) results[r.platform] = r;
    return {
      ...row,
      overrides: JSON.parse(row.overrides),
      platforms: JSON.parse(row.platforms),
      photos,
      results,
    };
  }
}

module.exports = { PostStore, PLATFORMS };
