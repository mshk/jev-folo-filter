import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { convert } from 'html-to-text';

const exec = promisify(execFile);
const executable = fileURLToPath(new URL('../node_modules/folocli/dist/index.js', import.meta.url));

async function callFolo(args) {
  let stdout;
  try {
    ({ stdout } = await exec(process.execPath, [executable, ...args], { timeout: 60_000, maxBuffer: 32 * 1024 * 1024 }));
  } catch (error) {
    let code;
    try { code = JSON.parse(error.stderr).error?.code; } catch { /* Never print raw credential-bearing errors. */ }
    if (code === 'UNAUTHORIZED') throw new Error('Folo認証が必要です。npm run login を実行するか、.env に FOLO_TOKEN を設定してください。');
    throw new Error('Folo取得に失敗しました。npm exec -- folo whoami で認証状態と接続を確認してください。');
  }
  const result = JSON.parse(stdout);
  if (result.ok !== true || !result.data) throw new Error('Folo CLIの応答形式が想定と異なります。');
  return result.data;
}

export async function timeline({ limit, cursor, unreadOnly, feedId, listId }) {
  const args = ['timeline', '--format', 'json', '--limit', String(limit)];
  if (cursor) args.push('--cursor', cursor);
  if (unreadOnly) args.push('--unread-only');
  if (feedId) args.push('--feed', feedId);
  if (listId) args.push('--list', listId);
  return callFolo(args);
}

export async function subscriptions() {
  const result = await callFolo(['subscription', 'list', '--format', 'json']);
  if (!Array.isArray(result.subscriptions)) throw new Error('Foloの購読一覧が不正です。');
  return result.subscriptions;
}

// Round-robin prevents high-frequency sources from occupying the entire candidate pool.
export async function fetchAcrossFeeds({ limit = 300, perFeed = 10, unreadOnly = false, getSubscriptions = subscriptions, getPage = timeline, onProgress = () => {} } = {}) {
  const targets = new Map();
  for (const item of await getSubscriptions()) {
    const key = item.feedId ? `feed:${item.feedId}` : item.listId ? `list:${item.listId}` : null;
    if (key) targets.set(key, item.feedId ? { feedId: item.feedId } : { listId: item.listId });
  }
  const scopes = [...targets.values()];
  if (scopes.length > limit) throw new Error(`全購読先を含めるには --limit を${scopes.length}以上にしてください。`);
  const batches = new Array(scopes.length);
  let next = 0;
  let done = 0;
  await Promise.all(Array.from({ length: Math.min(4, scopes.length) }, async () => {
    while (next < scopes.length) {
      const index = next++;
      batches[index] = await fetchArticles({ limit: perFeed, unreadOnly, getPage: args => getPage({ ...args, ...scopes[index] }) });
      onProgress(`フィード取得: ${++done}/${scopes.length}`);
    }
  }));
  const found = new Map();
  for (let round = 0; round < perFeed && found.size < limit; round++) {
    const candidates = batches.map(batch => batch[round]).filter(Boolean)
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    for (const article of candidates) {
      if (found.size >= limit) break;
      if (!found.has(article.id)) found.set(article.id, article);
    }
  }
  return [...found.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

const plain = (value, max) => typeof value === 'string'
  ? convert(value.slice(0, 100_000), { wordwrap: false, selectors: [{ selector: 'a', options: { ignoreHref: true } }, { selector: 'img', format: 'skip' }] }).trim().slice(0, max)
  : '';

export function normalizeArticle(row) {
  const entry = row.entries;
  if (!entry || typeof entry.id !== 'string' || !Number.isFinite(Date.parse(entry.publishedAt))) {
    throw new Error('Folo記事のIDまたは公開日時が不正です。');
  }
  let url = '';
  try { const parsed = new URL(entry.url); if (['https:', 'http:'].includes(parsed.protocol)) url = parsed.href; } catch { /* Missing URL stays missing. */ }
  return {
    id: entry.id,
    title: plain(entry.title, 500),
    source: plain(row.feeds?.title, 200),
    url,
    publishedAt: new Date(entry.publishedAt).toISOString(),
    summary: plain(entry.description || entry.content, 2000),
    ...(typeof row.read === 'boolean' ? { read: row.read } : {}),
  };
}

export async function fetchArticles({ limit = 200, unreadOnly = false, getPage = timeline } = {}) {
  const found = new Map();
  const cursors = new Set();
  let cursor;
  for (;;) {
    const page = await getPage({ limit: Math.min(20, limit - found.size), cursor, unreadOnly });
    if (!Array.isArray(page.entries)) throw new Error('Foloの記事一覧が不正です。');
    for (const row of page.entries) {
      const article = normalizeArticle(row);
      if (unreadOnly && article.read === true) continue;
      found.set(article.id, article);
    }
    if (found.size >= limit || page.entries.length === 0 || page.hasNext === false) break;
    const next = page.nextCursor;
    if (!next || cursors.has(next)) throw new Error('Foloのページ送りが進みません。途中の一覧を成功結果として保存しません。');
    cursors.add(next);
    cursor = next;
  }
  return [...found.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, limit);
}
