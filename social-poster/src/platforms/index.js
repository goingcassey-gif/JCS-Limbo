'use strict';

const facebook = require('./facebook');
const instagram = require('./instagram');
const threads = require('./threads');
const x = require('./x');

const ALL = { facebook, instagram, threads, x };

const captionFor = (post, name) => (post.overrides?.[name]?.trim() ? post.overrides[name] : post.caption);
const lengthOf = (platform, text) => (platform.length ? platform.length(text) : [...text].length);

/** Every reason a post can't go to the platforms it is set for. Empty means good to go. */
function problemsFor(post, cfg) {
  const out = {};
  for (const name of post.platforms) {
    const p = ALL[name];
    const list = [];
    if (!cfg.dryRun && !p.isConfigured(cfg)) list.push(`${p.label} is not connected yet.`);
    if (post.photos.length > p.maxPhotos) list.push(`${p.label} takes at most ${p.maxPhotos} photos; this post has ${post.photos.length}.`);
    const len = lengthOf(p, captionFor(post, name));
    if (len > p.maxChars) list.push(`${p.label} caption is ${len} characters; the limit is ${p.maxChars}.`);
    list.push(...p.validate({ ...post, caption: captionFor(post, name) }));
    if (list.length) out[name] = list;
  }
  return out;
}

module.exports = { ALL, captionFor, lengthOf, problemsFor };
