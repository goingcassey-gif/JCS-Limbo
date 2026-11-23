'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { createAuth } = require('./auth');
const { processPhoto, PhotoError } = require('./images');
const { ALL, problemsFor } = require('./platforms');
const views = require('./views');

const PUBLIC_STATUSES = new Set(['posting', 'posted', 'partial', 'failed']);
const MAX_PHOTOS = 10;

function createApp({ store, cfg, publisher, log = console }) {
  const app = express();
  const auth = createAuth(cfg);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: MAX_PHOTOS, fileSize: 25 * 1024 * 1024, fields: 20 },
  });

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(auth.middleware);

  const signedIn = (req, res, next) => (req.user ? next() : res.redirect('/login'));
  const approverOnly = (req, res, next) =>
    req.user?.role === 'approver'
      ? next()
      : res.status(403).send(views.messagePage({ user: req.user, cfg, title: 'Approvers only', text: 'Only the approver can do this.' }));
  const csrf = (req, res, next) =>
    auth.checkCsrf(req)
      ? next()
      : res.status(403).send(views.messagePage({ user: req.user, cfg, title: 'Page expired', text: 'Go back, reload the page and try again.' }));
  const platformsFrom = (body) => [].concat(body.platforms || []).filter((p) => ALL[p]);
  const postId = (req) => Number.parseInt(req.params.id, 10);

  app.get('/', (req, res) => res.redirect(req.user ? (req.user.role === 'approver' ? '/queue' : '/upload') : '/login'));

  app.get('/login', (req, res) => res.send(views.loginPage({})));
  app.post('/login', (req, res) => {
    const ip = req.ip;
    if (auth.tooManyAttempts(ip)) {
      return res.status(429).send(views.loginPage({ error: 'Too many tries. Wait 15 minutes and try again.' }));
    }
    const name = String(req.body.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const role = auth.roleForCode(String(req.body.code || ''));
    if (!name || !role) {
      auth.recordFailure(ip);
      return res.status(401).send(views.loginPage({ error: 'That name or access code did not work.' }));
    }
    auth.issue(res, { name, role }, req.secure);
    res.redirect(role === 'approver' ? '/queue' : '/upload');
  });
  app.post('/logout', (_req, res) => {
    auth.clear(res);
    res.redirect('/login');
  });

  app.get('/upload', signedIn, (req, res) => {
    res.send(views.uploadPage({ user: req.user, csrf: req.csrf, cfg, sent: req.query.sent }));
  });

  app.post('/upload', signedIn, (req, res, next) => {
    upload.array('photos', MAX_PHOTOS)(req, res, (err) => {
      if (err) {
        const msg =
          err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
            ? `Up to ${MAX_PHOTOS} photos per post.`
            : err.code === 'LIMIT_FILE_SIZE'
              ? 'One of the photos is over 25 MB.'
              : 'The upload did not go through. Try again.';
        return res.status(400).send(views.uploadPage({ user: req.user, csrf: req.csrf, cfg, error: msg }));
      }
      next();
    });
  }, csrf, async (req, res) => {
    const values = {
      caption: String(req.body.caption || '').slice(0, 5000),
      note: String(req.body.note || '').slice(0, 300),
      platforms: platformsFrom(req.body),
    };
    const fail = (error) => res.status(400).send(views.uploadPage({ user: req.user, csrf: req.csrf, cfg, error, values }));
    if (!req.files?.length) return fail('Add at least one photo.');
    if (!values.platforms.length) return fail('Pick at least one platform.');

    const saved = [];
    try {
      for (const f of req.files) saved.push(await processPhoto(f.buffer, f.originalname, cfg.mediaDir));
    } catch (err) {
      for (const s of saved) fs.rmSync(path.join(cfg.mediaDir, s.filename), { force: true });
      if (err instanceof PhotoError) return fail(err.message);
      throw err;
    }
    const id = store.createPost({ ...values, submittedBy: req.user.name, photos: saved });
    log.info?.(`[post ${id}] submitted by ${req.user.name} with ${saved.length} photo(s)`);
    res.redirect(303, `/upload?sent=${id}`);
  });

  app.get('/mine', signedIn, (req, res) => {
    res.send(views.minePage({ user: req.user, cfg, posts: store.listPosts({ limit: 50 }) }));
  });

  app.get('/queue', signedIn, approverOnly, (req, res) => {
    res.send(
      views.queuePage({
        user: req.user,
        cfg,
        pending: store.listPosts({ statuses: ['pending'], limit: 100 }),
        recent: store.listPosts({ statuses: ['posting', 'posted', 'partial', 'failed', 'rejected'], limit: 20 }),
      }),
    );
  });

  app.get('/posts/:id', signedIn, (req, res) => {
    const post = store.getPost(postId(req));
    if (!post) return res.status(404).send(views.messagePage({ user: req.user, cfg, title: 'Not found', text: 'That post does not exist.' }));
    const problems = post.status === 'pending' ? problemsFor(post, cfg) : {};
    res.send(views.postPage({ user: req.user, csrf: req.csrf, cfg, post, problems }));
  });

  app.post('/posts/:id/decide', signedIn, approverOnly, csrf, (req, res) => {
    const id = postId(req);
    const post = store.getPost(id);
    if (!post || post.status !== 'pending') return res.redirect(303, `/posts/${id}`);

    const overrides = {};
    for (const name of Object.keys(ALL)) {
      const v = String(req.body[`override_${name}`] || '').slice(0, 5000);
      if (v.trim()) overrides[name] = v;
    }
    const draft = { caption: String(req.body.caption || '').slice(0, 5000), overrides, platforms: platformsFrom(req.body) };
    store.updateDraft(id, draft);
    if (req.body.action !== 'approve') return res.redirect(303, `/posts/${id}`);

    const fresh = store.getPost(id);
    const problems = problemsFor(fresh, cfg);
    const error = !fresh.platforms.length ? 'Pick at least one platform.' : Object.keys(problems).length ? 'Not posted yet. Fix the items below first.' : null;
    if (error) return res.status(400).send(views.postPage({ user: req.user, csrf: req.csrf, cfg, post: fresh, problems, error }));

    if (store.approve(id, req.user.name)) {
      log.info?.(`[post ${id}] approved by ${req.user.name}`);
      publisher.publish(id).catch((err) => log.error?.(`[post ${id}] ${err.stack || err}`));
    }
    res.redirect(303, `/posts/${id}`);
  });

  app.post('/posts/:id/reject', signedIn, approverOnly, csrf, (req, res) => {
    const id = postId(req);
    store.reject(id, req.user.name, String(req.body.reason || '').trim().slice(0, 300));
    res.redirect(303, `/posts/${id}`);
  });

  app.post('/posts/:id/retry', signedIn, approverOnly, csrf, (req, res) => {
    const id = postId(req);
    if (store.startRetry(id)) publisher.publish(id).catch((err) => log.error?.(`[post ${id}] ${err.stack || err}`));
    res.redirect(303, `/posts/${id}`);
  });

  app.get('/connections', signedIn, approverOnly, async (req, res) => {
    const threadsRefreshed = req.query.refresh === 'threads' ? await publisher.refreshThreadsToken() : false;
    const status = await publisher.checkConnections();
    res.send(views.connectionsPage({ user: req.user, cfg, status, threadsRefreshed }));
  });

  // Photos stay private until approved. After approval Instagram and Threads must be able to download them.
  app.get('/media/:filename', (req, res) => {
    const { filename } = req.params;
    if (!/^[a-f0-9]{36}\.jpg$/.test(filename)) return res.sendStatus(404);
    const photo = store.photoByFilename(filename);
    if (!photo || (!req.user && !PUBLIC_STATUSES.has(photo.post_status))) return res.sendStatus(404);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(path.join(cfg.mediaDir, filename));
  });

  app.get('/healthz', (_req, res) => res.send('ok'));

  app.use((err, req, res, _next) => {
    log.error?.(err.stack || err);
    res.status(500).send(views.messagePage({ user: req.user, cfg, title: 'Something went wrong', text: 'Try again. If it keeps happening, tell Nari.' }));
  });

  return app;
}

module.exports = { createApp };
