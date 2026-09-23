import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchArticles, normalizeArticle } from '../src/folo.js';
import { filterArticles, renderDigest } from '../src/filter.js';

const article = (id, extra = {}) => ({ id, title: `記事${id}`, source: 'Example', url: `https://example.com/${id}`, publishedAt: '2026-09-23T00:00:00Z', summary: '概要', ...extra });
const row = id => ({ entries: { ...article(id), description: '<p>概要 &amp; 説明</p>' }, feeds: { title: 'Example' }, read: false });
const response = answers => ({ model: 'mock', usage: { input_tokens: 1, output_tokens: 1 }, answers });
function mockEvaluator(scores = {}, duplicate = false) {
  return async ({ state, questions }) => response(Object.fromEntries(Object.entries(questions).map(([key, q]) => {
    const i = Number(key.split('_')[1]);
    const overrides = scores[state.articles?.[i]?.id] || {};
    if (key.startsWith('ai_')) return [key, { type: 'noul', noul: overrides.aiRelated ? 0.99 : 0.01 }];
    if (q.type === 'noul') return [key, { type: 'noul', noul: duplicate ? 0.99 : 0.01 }];
    if (key.startsWith('reason_')) return [key, { type: 'choice', choice: 'explanation' }];
    if (q.type === 'choice') return [key, { type: 'choice', choice: overrides.category || 'ai' }];
    return [key, { type: 'score', score: key.startsWith('quality') ? overrides.quality ?? 1 : overrides.interest ?? 3.5 }];
  })));
}

test('HTML and unsafe URLs are normalized without inventing missing fields', () => {
  const input = row('a');
  input.entries.url = 'javascript:alert(1)';
  input.entries.description = '<script>bad()</script><p>Hello &amp; RSS</p>';
  const value = normalizeArticle(input);
  assert.equal(value.summary, 'Hello & RSS');
  assert.equal(value.url, '');
  assert.equal(value.read, false);
});

test('pagination forwards unread flag/cursor and deduplicates IDs', async () => {
  const requests = [];
  const articles = await fetchArticles({ limit: 3, unreadOnly: true, getPage: async args => {
    requests.push(args);
    return requests.length === 1
      ? { entries: [row('a'), row('b')], nextCursor: '2026-09-22T00:00:00Z', hasNext: true }
      : { entries: [row('b'), row('c')], nextCursor: null, hasNext: false };
  } });
  assert.equal(articles.length, 3);
  assert.equal(requests[1].cursor, '2026-09-22T00:00:00Z');
  assert.ok(requests.every(r => r.unreadOnly));
});

test('repeated pagination cursor fails rather than silently truncating', async () => {
  await assert.rejects(fetchArticles({ getPage: async () => ({ entries: [row('a')], nextCursor: 'same', hasNext: true }) }), /ページ送り/);
});

test('empty timeline ends cleanly', async () => {
  assert.deepEqual(await fetchArticles({ getPage: async () => ({ entries: [], hasNext: false }) }), []);
});

test('policy and explicit article index reach Jev and threshold skips noise', async () => {
  let observed;
  const evaluate = mockEvaluator({ b: { interest: 0 } });
  const result = await filterArticles([article('a'), article('b')], 'READER POLICY {{ARTICLES}}', { evaluate: async request => { observed = request; return evaluate(request); } });
  assert.match(observed.state.reader_policy, /READER POLICY/);
  assert.match(observed.questions.interest_1.instructions, /articles\[1\]/);
  assert.deepEqual(result.selected.map(a => a.id), ['a']);
  assert.equal(result.excluded[0].id, 'b');
});

test('same-story filtering prefers primary evidence, even with lower interest', async () => {
  const result = await filterArticles([article('secondary'), article('primary')], 'policy', { evaluate: mockEvaluator({ secondary: { quality: 1, interest: 4 }, primary: { quality: 2, interest: 3 } }, true) });
  assert.deepEqual(result.selected.map(a => a.id), ['primary']);
  assert.equal(result.excluded[0].exclusion, '同じ話題');
});

test('URL duplication and market cap are enforced', async () => {
  const result = await filterArticles([article('a'), article('b', { url: 'https://example.com/a' }), article('c'), article('d')], 'policy', { evaluate: mockEvaluator({ c: { category: 'market' }, d: { category: 'market' } }) });
  assert.deepEqual(result.selected.map(a => a.id), ['a', 'c']);
  assert.deepEqual(result.excluded.map(a => a.exclusion), ['同一URL', '市況は1本まで']);
});

test('selection limit does not force low quality candidates into digest', async () => {
  const result = await filterArticles([article('a'), article('b'), article('c')], 'policy', { count: 1, evaluate: mockEvaluator() });
  assert.equal(result.selected.length, 1);
  assert.equal(result.excluded.length, 2);
});

test('invalid or absent Jev answers fail closed', async () => {
  await assert.rejects(filterArticles([article('a')], 'policy', { evaluate: async () => response({}) }), /応答が不正/);
});

test('no articles means no API calls and no invented recommendations', async () => {
  const result = await filterArticles([], 'policy', { evaluate: async () => { throw new Error('must not call'); } });
  assert.equal(result.audit.length, 0);
  assert.match(renderDigest(result), /該当する記事はありません/);
});

test('Markdown escapes untrusted titles', async () => {
  const result = await filterArticles([article('a', { title: '<script>alert(1)</script> [bad](javascript:x)' })], 'policy', { evaluate: mockEvaluator() });
  const digest = renderDigest(result);
  assert.ok(!digest.includes('<script>'));
  assert.ok(!digest.includes('[bad]'));
  assert.match(digest, /これだけ/);
});

test('AI cap includes AI infrastructure categorized as dev, without filling from AI', async () => {
  const inputs = ['a', 'b', 'c', 'd', 'infra', 'rust'].map(id => article(id));
  const result = await filterArticles(inputs, 'policy', { evaluate: mockEvaluator({ infra: { category: 'dev', aiRelated: true }, rust: { category: 'dev' } }) });
  assert.equal(result.selected.filter(a => a.aiRelated).length, 3);
  assert.ok(result.selected.some(a => a.id === 'rust'));
  assert.equal(result.selected.length, 4);
  assert.equal(result.excluded.filter(a => a.exclusion === 'AI関連記事の上限').length, 2);
});

test('topic diversity reserves room for eligible camera and life articles', async () => {
  const inputs = ['a', 'b', 'c', 'camera', 'life'].map(id => article(id));
  const result = await filterArticles(inputs, 'policy', { count: 3, maxAi: 3, evaluate: mockEvaluator({ camera: { category: 'camera', quality: 0.5 }, life: { category: 'life', quality: 0.2 } }) });
  assert.deepEqual(new Set(result.selected.map(a => a.category)), new Set(['ai', 'camera', 'life']));
});

test('maxAi zero excludes AI and no low-score story is used to fill slots', async () => {
  const result = await filterArticles([article('ai'), article('camera')], 'policy', { maxAi: 0, evaluate: mockEvaluator({ camera: { category: 'camera', interest: 1 } }) });
  assert.equal(result.selected.length, 0);
});

test('duplicate check excludes scores and uses daily story overlap across languages', async () => {
  const evaluate = mockEvaluator({}, true);
  let comparison;
  await filterArticles([article('a'), article('b')], 'policy', { evaluate: async req => {
    if (req.state.candidate) comparison = req;
    return evaluate(req);
  } });
  assert.ok(comparison);
  assert.equal(comparison.state.candidate.interest, undefined);
  assert.equal(comparison.state.selected[0].quality, undefined);
  assert.match(comparison.questions.duplicate_0.instructions, /translations/);
});

test('editorial mode ranks intrinsic value without AI or market caps or topic balancing', async () => {
  const articles = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => article(id));
  const result = await filterArticles(articles, 'generic reading policy', {
    editorial: true, count: 5, maxAi: 0, evaluate: mockEvaluator({
      a: { interest: 4, quality: 0.5 }, b: { interest: 3.9 }, c: { interest: 3.8 },
      d: { category: 'market', interest: 3.7 }, e: { category: 'market', interest: 3.6 },
      f: { category: 'camera', interest: 3.5, quality: 2 },
    }),
  });
  assert.deepEqual(result.selected.map(a => a.id), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(result.settings.maxAi, null);
  assert.match(renderDigest(result), /読む価値: 仕組みや背景の理解が深まる/);
  assert.ok(!renderDigest(result).includes('なぜ向くか'));
});
