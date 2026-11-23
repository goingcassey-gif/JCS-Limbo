'use strict';

class PlatformError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** Calls an API and returns parsed JSON, or throws a PlatformError with the platform's own message. */
async function callJson(fetchFn, url, init = {}) {
  let res;
  try {
    res = await fetchFn(url, { ...init, signal: init.signal ?? AbortSignal.timeout(60_000) });
  } catch (err) {
    throw new PlatformError(`Could not reach ${new URL(url).host}: ${err.message}`);
  }
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  if (!res.ok || body.error || body.errors?.length && !body.data) {
    throw new PlatformError(describeError(res.status, body), { status: res.status, body });
  }
  return body;
}

function describeError(status, body) {
  const e = body.error;
  if (e && typeof e === 'object') {
    const msg = e.error_user_msg || e.message || 'Unknown error';
    if (e.code === 190) return `Sign-in expired or was removed (${msg}). The account owner needs to make a new token.`;
    if (e.code === 10 || e.code === 200) return `Missing permission (${msg}).`;
    return msg;
  }
  if (body.detail || body.title) {
    if (status === 401) return `X rejected the keys (${body.detail || body.title}). Check the four X values in .env.`;
    if (status === 403) return `X refused the post (${body.detail || body.title}). The X app needs Read and Write access and an API plan that allows posting.`;
    if (status === 429) return 'X rate limit reached. Try again later.';
    return body.detail || body.title;
  }
  if (body.errors?.length) return body.errors.map((x) => x.message || x.detail).join('; ');
  return `HTTP ${status}${body.raw ? `: ${body.raw}` : ''}`;
}

module.exports = { callJson, PlatformError };
