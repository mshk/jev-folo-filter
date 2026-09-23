import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAcrossFeeds } from '../src/folo.js';
const row = (id, day) => ({ entries: { id, title: id, publishedAt: `2026-09-${day}T00:00:00Z` }, feeds: { title: id }, read: false });

test('old but active sources enter the pool before prolific sources take extra slots', async () => {
  const calls = [];
  const result = await fetchAcrossFeeds({ limit: 3, perFeed: 10, unreadOnly: true,
    getSubscriptions: async () => [{ feedId: 'fast' }, { feedId: 'slow' }],
    getPage: async args => {
      calls.push(args);
      return { entries: args.feedId === 'fast' ? [row('f1', '23'), row('f2', '22'), row('f3', '21')] : [row('s1', '18')], hasNext: false };
    },
  });
  assert.deepEqual(result.map(a => a.id), ['f1', 'f2', 's1']);
  assert.ok(calls.every(a => a.unreadOnly && a.limit === 10));
});

test('duplicate subscriptions, overlapping stories and empty sources are handled', async () => {
  let calls = 0;
  const result = await fetchAcrossFeeds({ limit: 5, perFeed: 2,
    getSubscriptions: async () => [{ feedId: 'a' }, { feedId: 'a' }, { listId: 'b' }, { feedId: 'empty' }],
    getPage: async scope => {
      calls++;
      return { entries: scope.feedId === 'empty' ? [] : [row('same', '23'), row(scope.listId ? 'list' : 'feed', '22')], hasNext: false };
    },
  });
  assert.equal(calls, 3);
  assert.equal(result.length, 3);
});

test('source errors fail instead of silently dropping a subscription', async () => {
  await assert.rejects(fetchAcrossFeeds({ getSubscriptions: async () => [{ feedId: 'broken' }], getPage: async () => { throw new Error('failure'); } }), /failure/);
  await assert.rejects(fetchAcrossFeeds({ limit: 1, getSubscriptions: async () => [{ feedId: 'a' }, { feedId: 'b' }] }), /limit/);
});
