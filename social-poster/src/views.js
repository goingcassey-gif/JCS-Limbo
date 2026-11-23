'use strict';

const { ALL, captionFor } = require('./platforms');

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STATUS = {
  pending: ['Waiting for approval', 'wait'],
  posting: ['Posting now', 'wait'],
  posted: ['Posted', 'ok'],
  partial: ['Partly posted', 'warn'],
  failed: ['Not posted', 'bad'],
  rejected: ['Not approved', 'muted'],
};
const badge = (status) => {
  const [label, tone] = STATUS[status] || [status, 'muted'];
  return `<span class="badge ${tone}">${esc(label)}</span>`;
};

const CSS = `
:root{--bg:#f6f5f8;--card:#fff;--ink:#1d1a22;--soft:#6b6574;--line:#e3e0e8;--accent:#5b2a86;--accent-ink:#fff;
--ok:#1f7a4d;--ok-bg:#e3f4ea;--warn:#8a5a00;--warn-bg:#fdf1d8;--bad:#a12a2a;--bad-bg:#fbe5e5;--wait:#3b4a8a;--wait-bg:#e6e9f7}
@media (prefers-color-scheme:dark){:root{--bg:#141217;--card:#1d1a22;--ink:#eeeaf3;--soft:#a49dad;--line:#332e3a;--accent:#b48ae0;--accent-ink:#141217;
--ok:#7fd3a6;--ok-bg:#16301f;--warn:#f1c46b;--warn-bg:#352a10;--bad:#f09a9a;--bad-bg:#3a1a1a;--wait:#a9b5f0;--wait-bg:#1e2340}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
header{background:var(--card);border-bottom:1px solid var(--line)}
.bar{max-width:880px;margin:0 auto;padding:12px 16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.brand{font-weight:700;margin-right:auto}.bar a{color:var(--ink);text-decoration:none}.bar a:hover{text-decoration:underline}
main{max-width:880px;margin:0 auto;padding:20px 16px 60px}
h1{font-size:1.5rem;margin:0 0 4px}h2{font-size:1.1rem;margin:28px 0 10px}.sub{color:var(--soft);margin:0 0 20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:14px}
label{display:block;font-weight:600;margin:14px 0 6px}textarea,input[type=text],input[type=password]{width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit}
textarea{min-height:120px;resize:vertical}
.btn{display:inline-block;border:0;border-radius:8px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer;background:var(--accent);color:var(--accent-ink);text-decoration:none}
.btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}.btn.danger{background:var(--bad);color:#fff}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.checks{display:flex;gap:8px;flex-wrap:wrap}.checks label{font-weight:500;margin:0;border:1px solid var(--line);border-radius:999px;padding:6px 12px;display:flex;gap:6px;align-items:center;cursor:pointer}
.checks label.off{opacity:.55}
.badge{display:inline-block;border-radius:999px;padding:2px 10px;font-size:.82rem;font-weight:600}
.ok{color:var(--ok);background:var(--ok-bg)}.warn{color:var(--warn);background:var(--warn-bg)}.bad{color:var(--bad);background:var(--bad-bg)}
.wait{color:var(--wait);background:var(--wait-bg)}.muted{color:var(--soft);background:var(--line)}
.notice{border-radius:10px;padding:12px 14px;margin-bottom:14px}
.thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-top:10px}
.thumbs img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;border:1px solid var(--line)}
.counts{display:flex;gap:14px;flex-wrap:wrap;color:var(--soft);font-size:.85rem;margin-top:6px}.counts .over{color:var(--bad);font-weight:600}
.list a.item{display:flex;gap:12px;align-items:center;color:inherit;text-decoration:none}
.list img{width:56px;height:56px;object-fit:cover;border-radius:8px;flex:none}
.meta{color:var(--soft);font-size:.85rem}.cap{white-space:pre-wrap;word-break:break-word}
.trunc{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
details summary{cursor:pointer;color:var(--soft);margin-top:14px}
table{width:100%;border-collapse:collapse}td{padding:8px 4px;border-top:1px solid var(--line);vertical-align:top}
.drop{border:2px dashed var(--line);border-radius:12px;padding:22px;text-align:center;color:var(--soft)}
.drop.hover{border-color:var(--accent)}
`;

function layout({ title, user, body, dryRun }) {
  const nav = user
    ? `<a href="/upload">Upload</a>${user.role === 'approver' ? '<a href="/queue">Approvals</a><a href="/connections">Accounts</a>' : '<a href="/mine">Submissions</a>'}
       <form method="post" action="/logout" style="margin:0"><button class="btn ghost" style="padding:4px 10px">Sign out</button></form>`
    : '';
  const banner = dryRun && user
    ? '<div class="notice warn">Practice mode is on. Approving marks posts as done but sends nothing to any platform.</div>'
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · LIMBO Post Desk</title><style>${CSS}</style></head>
<body><header><div class="bar"><span class="brand">LIMBO Post Desk</span>${nav}</div></header>
<main>${banner}${body}</main></body></html>`;
}

const csrfField = (csrf) => `<input type="hidden" name="_csrf" value="${esc(csrf)}">`;

function loginPage({ error }) {
  return layout({
    title: 'Sign in',
    body: `<h1>Sign in</h1><p class="sub">Use the access code Cassey gave the team.</p>
<form class="card" method="post" action="/login">
${error ? `<div class="notice bad">${esc(error)}</div>` : ''}
<label for="name">Your name</label><input id="name" name="name" type="text" maxlength="40" required autocomplete="name">
<label for="code">Access code</label><input id="code" name="code" type="password" required autocomplete="current-password">
<p><button class="btn">Sign in</button></p></form>`,
  });
}

function platformChecks(selected, cfg, enabledOnly = false) {
  return `<div class="checks">${Object.values(ALL)
    .map((p) => {
      const connected = cfg.dryRun || p.isConfigured(cfg);
      if (enabledOnly && !connected) return '';
      return `<label class="${connected ? '' : 'off'}" title="${connected ? '' : 'Not connected yet'}">
<input type="checkbox" name="platforms" value="${p.name}" ${selected.includes(p.name) ? 'checked' : ''} data-max="${p.maxChars}" data-maxphotos="${p.maxPhotos}">${esc(p.label)}${connected ? '' : ' (not connected)'}</label>`;
    })
    .join('')}</div>`;
}

const COUNTER_JS = `
function xLen(t){t=t.replace(/https?:\\/\\/\\S+/g,'x'.repeat(23));let n=0;for(const c of t){const p=c.codePointAt(0);n+=(p<=0x10ff||(p>=0x2000&&p<=0x200d)||(p>=0x2010&&p<=0x201f)||(p>=0x2032&&p<=0x2037))?1:2}return n}
function wireCounts(area,box,getPlatforms){const run=()=>{const t=area.value;box.innerHTML=getPlatforms().map(p=>{const n=p.value==='x'?xLen(t):[...t].length;const over=n>Number(p.dataset.max);
return '<span class="'+(over?'over':'')+'">'+p.parentElement.textContent.trim().replace(' (not connected)','')+': '+n+'/'+p.dataset.max+'</span>'}).join('')};area.addEventListener('input',run);document.querySelectorAll('input[name=platforms]').forEach(c=>c.addEventListener('change',run));run()}
`;

function uploadPage({ user, csrf, cfg, sent, error, values = {} }) {
  const selected = values.platforms || Object.values(ALL).filter((p) => cfg.dryRun || p.isConfigured(cfg)).map((p) => p.name);
  return layout({
    title: 'Upload',
    user,
    dryRun: cfg.dryRun,
    body: `<h1>Upload photos</h1><p class="sub">Add the photos and caption. Nothing goes out until it is approved.</p>
${sent ? `<div class="notice ok">Sent for approval. <a href="/posts/${Number(sent)}">View it</a>.</div>` : ''}
${error ? `<div class="notice bad">${esc(error)}</div>` : ''}
<form class="card" method="post" action="/upload" enctype="multipart/form-data">${csrfField(csrf)}
<label for="photos">Photos (up to 10; the first one is the cover)</label>
<div class="drop" id="drop">Drag photos here or <input id="photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple required>
<div class="thumbs" id="thumbs"></div></div>
<label for="caption">Caption</label><textarea id="caption" name="caption" maxlength="5000">${esc(values.caption)}</textarea>
<div class="counts" id="counts"></div>
<label>Post to</label>${platformChecks(selected, cfg)}
<label for="note">Note for the approver (not posted)</label><input id="note" name="note" type="text" maxlength="300" value="${esc(values.note)}">
<p><button class="btn">Send for approval</button></p></form>
<script>${COUNTER_JS}
const input=document.getElementById('photos'),thumbs=document.getElementById('thumbs'),drop=document.getElementById('drop');
function show(){thumbs.innerHTML='';[...input.files].slice(0,10).forEach(f=>{const i=document.createElement('img');i.src=URL.createObjectURL(f);i.alt=f.name;thumbs.appendChild(i)})}
input.addEventListener('change',show);
['dragover','dragenter'].forEach(e=>drop.addEventListener(e,ev=>{ev.preventDefault();drop.classList.add('hover')}));
['dragleave','drop'].forEach(e=>drop.addEventListener(e,()=>drop.classList.remove('hover')));
drop.addEventListener('drop',ev=>{ev.preventDefault();input.files=ev.dataTransfer.files;show()});
wireCounts(document.getElementById('caption'),document.getElementById('counts'),()=>[...document.querySelectorAll('input[name=platforms]:checked')]);
</script>`,
  });
}

function when(ts, cfg) {
  return new Date(ts).toLocaleString('en-PH', { timeZone: cfg.timeZone, dateStyle: 'medium', timeStyle: 'short' });
}

function postList(posts, cfg, empty) {
  if (!posts.length) return `<p class="meta">${esc(empty)}</p>`;
  return `<div class="list">${posts
    .map(
      (p) => `<div class="card"><a class="item" href="/posts/${p.id}">
${p.photos[0] ? `<img src="/media/${esc(p.photos[0].filename)}" alt="">` : ''}
<div style="min-width:0;flex:1"><div class="row">${badge(p.status)}<span class="meta">${p.photos.length} photo${p.photos.length === 1 ? '' : 's'} · ${esc(
        p.platforms.map((n) => ALL[n].label).join(', '),
      )}</span></div>
<div class="trunc">${esc(p.caption) || '<span class="meta">(no caption)</span>'}</div>
<div class="meta">From ${esc(p.submitted_by)} · ${esc(when(p.created_at, cfg))}</div></div></a></div>`,
    )
    .join('')}</div>`;
}

function queuePage({ user, cfg, pending, recent }) {
  return layout({
    title: 'Approvals',
    user,
    dryRun: cfg.dryRun,
    body: `<h1>Approvals</h1><p class="sub">Open a post to check it, edit the caption, then approve or decline.</p>
<h2>Waiting (${pending.length})</h2>${postList(pending, cfg, 'Nothing waiting.')}
<h2>Recent</h2>${postList(recent, cfg, 'No decisions yet.')}`,
  });
}

function minePage({ user, cfg, posts }) {
  return layout({
    title: 'Submissions',
    user,
    dryRun: cfg.dryRun,
    body: `<h1>Submissions</h1><p class="sub">Everything the team has sent, newest first.</p>${postList(posts, cfg, 'Nothing yet.')}`,
  });
}

function resultsTable(post) {
  const rows = post.platforms
    .map((name) => {
      const r = post.results[name];
      const state = !r ? badge(post.status === 'posting' ? 'posting' : 'pending') : r.status === 'posted' ? badge('posted') : badge('failed');
      const detail = r?.url
        ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">Open post</a>`
        : r?.error
          ? `<span class="${r.status === 'posted' ? 'meta' : ''}">${esc(r.error)}</span>`
          : '';
      return `<tr><td>${esc(ALL[name].label)}</td><td>${state}</td><td>${detail}</td></tr>`;
    })
    .join('');
  return `<table>${rows}</table>`;
}

function postPage({ user, csrf, cfg, post, problems = {}, error }) {
  const isApprover = user.role === 'approver';
  const editable = isApprover && post.status === 'pending';
  const thumbs = `<div class="thumbs">${post.photos
    .map((p, i) => `<a href="/media/${esc(p.filename)}" target="_blank"><img src="/media/${esc(p.filename)}" alt="Photo ${i + 1}"></a>`)
    .join('')}</div>`;
  const problemList = Object.entries(problems).flatMap(([, list]) => list);
  const head = `<div class="row" style="justify-content:space-between"><h1>Post #${post.id}</h1>${badge(post.status)}</div>
<p class="sub">From ${esc(post.submitted_by)} · ${esc(when(post.created_at, cfg))}${post.decided_by ? ` · ${post.status === 'rejected' ? 'Declined' : 'Approved'} by ${esc(post.decided_by)}` : ''}</p>
${error ? `<div class="notice bad">${esc(error)}</div>` : ''}
${post.note ? `<div class="card"><strong>Note:</strong> ${esc(post.note)}</div>` : ''}
${post.reject_reason ? `<div class="card"><strong>Reason declined:</strong> ${esc(post.reject_reason)}</div>` : ''}
<div class="card">${thumbs}</div>`;

  if (!editable) {
    const refresh = post.status === 'posting' ? '<meta http-equiv="refresh" content="4">' : '';
    const retry =
      isApprover && ['partial', 'failed'].includes(post.status)
        ? `<form method="post" action="/posts/${post.id}/retry">${csrfField(csrf)}<p class="meta">Retry sends only to the platforms that did not work.</p><button class="btn">Retry failed platforms</button></form>`
        : '';
    const captions = post.platforms
      .filter((n) => post.overrides?.[n]?.trim())
      .map((n) => `<p class="meta">${esc(ALL[n].label)} caption:</p><div class="cap">${esc(post.overrides[n])}</div>`)
      .join('');
    return layout({
      title: `Post #${post.id}`,
      user,
      dryRun: cfg.dryRun,
      body: `${refresh}${head}<div class="card"><div class="cap">${esc(post.caption) || '<span class="meta">(no caption)</span>'}</div>${captions}</div>
${post.status === 'pending' ? '' : `<div class="card">${resultsTable(post)}${retry}</div>`}`,
    });
  }

  const overrideFields = Object.values(ALL)
    .map(
      (p) => `<label for="ov_${p.name}">${esc(p.label)} caption (leave empty to use the main one)</label>
<textarea id="ov_${p.name}" name="override_${p.name}" style="min-height:70px" data-max="${p.maxChars}">${esc(post.overrides?.[p.name])}</textarea>`,
    )
    .join('');
  return layout({
    title: `Post #${post.id}`,
    user,
    dryRun: cfg.dryRun,
    body: `${head}
${problemList.length ? `<div class="notice bad"><strong>Fix these before approving:</strong><ul>${problemList.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
<form class="card" method="post" action="/posts/${post.id}/decide">${csrfField(csrf)}
<label for="caption">Caption</label><textarea id="caption" name="caption" maxlength="5000">${esc(post.caption)}</textarea>
<div class="counts" id="counts"></div>
<details ${Object.values(post.overrides || {}).some((v) => v?.trim()) ? 'open' : ''}><summary>Different caption for one platform (for example a shorter one for X)</summary>${overrideFields}</details>
<label>Post to</label>${platformChecks(post.platforms, cfg)}
<p class="row"><button class="btn" name="action" value="approve">Approve and post now</button>
<button class="btn ghost" name="action" value="save">Save changes</button></p></form>
<form class="card" method="post" action="/posts/${post.id}/reject">${csrfField(csrf)}
<label for="reason">Decline with a reason (optional, the team can see it)</label><input id="reason" name="reason" type="text" maxlength="300">
<p><button class="btn danger">Decline</button></p></form>
<script>${COUNTER_JS}wireCounts(document.getElementById('caption'),document.getElementById('counts'),()=>[...document.querySelectorAll('input[name=platforms]:checked')]);</script>`,
  });
}

function connectionsPage({ user, cfg, status, threadsRefreshed }) {
  const rows = Object.values(ALL)
    .map((p) => {
      const s = status[p.name];
      return `<tr><td>${esc(p.label)}</td><td>${s.ok ? '<span class="badge ok">Connected</span>' : '<span class="badge bad">Not working</span>'}</td><td>${esc(s.detail)}</td></tr>`;
    })
    .join('');
  return layout({
    title: 'Accounts',
    user,
    dryRun: cfg.dryRun,
    body: `<h1>Accounts</h1><p class="sub">Live check of each connected account. Sign-ins are set up by each account owner in the app's settings file, never in chat.</p>
<div class="card"><table>${rows}</table></div>
<p class="meta">Mode: ${cfg.dryRun ? 'practice (nothing is sent)' : 'live'}.${threadsRefreshed ? ' Threads sign-in was renewed just now.' : ''}</p>`,
  });
}

function messagePage({ user, cfg, title, text }) {
  return layout({ title, user, dryRun: cfg?.dryRun, body: `<h1>${esc(title)}</h1><p>${esc(text)}</p><p><a href="/">Back</a></p>` });
}

module.exports = { loginPage, uploadPage, queuePage, minePage, postPage, connectionsPage, messagePage, esc };
