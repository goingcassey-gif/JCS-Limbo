'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const MAX_SIDE = 2048; // big enough for every platform, small enough for X's 5 MB limit
const ACCEPTED = new Set(['jpeg', 'png', 'webp']);

class PhotoError extends Error {}

/**
 * Turns an uploaded photo into a clean JPEG: correct rotation, longest side at most 2048 px,
 * and no hidden EXIF data (so phone location data never gets posted). Instagram only takes JPEG.
 */
async function processPhoto(buffer, originalName, mediaDir) {
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw new PhotoError(`"${originalName}" is not a photo this app can read. Use JPG, PNG or WebP.`);
  }
  if (!ACCEPTED.has(meta.format)) {
    const hint = meta.format === 'heif' ? ' iPhone HEIC photos: set Camera > Formats to "Most Compatible", or share as JPG.' : '';
    throw new PhotoError(`"${originalName}" is ${String(meta.format).toUpperCase()}. Use JPG, PNG or WebP.${hint}`);
  }
  if (meta.pages > 1) throw new PhotoError(`"${originalName}" is animated. Only still photos can be posted here.`);

  const { data, info } = await sharp(buffer)
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  fs.mkdirSync(mediaDir, { recursive: true });
  const filename = `${crypto.randomBytes(18).toString('hex')}.jpg`; // unguessable link
  fs.writeFileSync(path.join(mediaDir, filename), data);
  return { filename, width: info.width, height: info.height, bytes: data.length };
}

module.exports = { processPhoto, PhotoError };
