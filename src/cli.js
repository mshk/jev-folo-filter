import { existsSync } from 'node:fs';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fetchArticles, fetchAcrossFeeds } from './folo.js';
import { filterArticles, renderDigest } from './filter.js';
import { renderEvaluations } from './evaluations.js';

async function save(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, data, { mode: 0o600 });
  await rename(temporary, path);
}
const integer = (value, name, max) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`${name} は1〜${max}の整数にしてください。`);
  return n;
};
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    limit: { type: 'string', default: '200' }, count: { type: 'string', default: '10' },
    'unread-only': { type: 'boolean', default: false },
    'per-feed': { type: 'string' },
    'max-ai': { type: 'string' },
    'min-score': { type: 'string', default: '2.5' },
    prompt: { type: 'string' },
    editorial: { type: 'boolean', default: false },
    input: { type: 'string' },
    'show-scores': { type: 'boolean', default: false },
    output: { type: 'string', default: 'output' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('npm run fetch -- [--limit 200] [--unread-only] [--per-feed 10]\nnpm run filter -- [--input output/articles.json] [--count 10] [--min-score 2.5] [--max-ai 3] [--show-scores] [--editorial]\nnpm start -- [--limit 200] [--unread-only] [--per-feed 10] [--count 10] [--show-scores]\nnpm run scores -- [--input output/selected.json] （保存済み評価の表示のみ、API呼び出しなし）\n共通: --prompt PROMPT.md --output output');
    return;
  }
  const [command] = positionals;
  if (positionals.length !== 1 || !['fetch', 'filter', 'run', 'scores'].includes(command)) throw new Error('コマンドは fetch / filter / run / scores を指定してください。');
  if (command === 'scores') {
    const result = JSON.parse(await readFile(resolve(values.input || 'output/selected.json'), 'utf8'));
    console.log(renderEvaluations(result));
    return;
  }
  if (command === 'fetch' && values['show-scores']) throw new Error('--show-scores は filter / run で指定してください。');
  if (values.editorial && (values.prompt || values['max-ai'] !== undefined)) throw new Error('--editorial は --prompt / --max-ai と併用できません。EDITORIAL.md を使用します。');
  const limit = integer(values.limit, 'limit', 2000);
  const perFeed = values['per-feed'] === undefined ? undefined : integer(values['per-feed'], 'per-feed', 100);
  if (command === 'filter' && perFeed !== undefined) throw new Error('--per-feed は fetch / run で使用してください。');
  const count = integer(values.count, 'count', 50);
  const minScore = Number(values['min-score']);
  if (!values['min-score'].trim() || !Number.isFinite(minScore) || minScore < 0 || minScore > 4) throw new Error('min-score は0〜4にしてください。');
  const maxAi = values['max-ai'] === undefined ? Math.max(1, Math.floor(count * 0.3)) : Number(values['max-ai']);
  if (values['max-ai'] === '' || !Number.isInteger(maxAi) || maxAi < 0 || maxAi > count) throw new Error('max-ai は0〜countの整数にしてください。');
  const output = resolve(values.output);
  // Check local requirements before accessing either service.
  let policy;
  if (command !== 'fetch') {
    policy = await readFile(resolve(values.prompt || (values.editorial ? 'EDITORIAL.md' : existsSync('PROMPT.md') ? 'PROMPT.md' : 'PROMPT.example.md')), 'utf8');
    if (!process.env.TYPESAFE_API_KEY) throw new Error('.env に TYPESAFE_API_KEY を設定してください。');
  }
  let articles;
  if (command === 'filter') {
    const input = JSON.parse(await readFile(resolve(values.input || 'output/articles.json'), 'utf8'));
    articles = Array.isArray(input) ? input : input.articles;
    if (!Array.isArray(articles) || articles.length > 2000) throw new Error('入力は最大2000件の記事配列または {articles: [...]} にしてください。');
    const ids = new Set();
    for (const a of articles) {
      if (!a || typeof a.id !== 'string' || ids.has(a.id) || !Number.isFinite(Date.parse(a.publishedAt)) || typeof a.title !== 'string' || typeof a.summary !== 'string' || a.summary.length > 2000 || a.title.length > 500 || typeof a.source !== 'string' || a.source.length > 200 || typeof a.url !== 'string' || (a.url && !/^https?:\/\/[^\s<>]+$/.test(a.url))) throw new Error('記事の形式が不正です。fetch が保存した articles.json を使用してください。');
      ids.add(a.id);
    }
    // Only send fields produced by fetch, not arbitrary extra input data.
    articles = articles.map(({ id, title, source, url, publishedAt, summary, read }) => ({ id, title, source, url, publishedAt, summary, read }));
  } else {
    articles = perFeed === undefined
      ? await fetchArticles({ limit, unreadOnly: values['unread-only'] })
      : await fetchAcrossFeeds({ limit, perFeed, unreadOnly: values['unread-only'], onProgress: console.error });
    await save(`${output}/articles.json`, JSON.stringify({ fetchedAt: new Date().toISOString(), unreadOnly: values['unread-only'], strategy: perFeed === undefined ? 'latest' : 'per-feed', perFeed, articles }, null, 2) + '\n');
    console.error(`取得: ${articles.length}件 → ${output}/articles.json`);
  }
  if (command === 'fetch') return;
  const result = await filterArticles(articles, policy, { count, minScore, maxAi, editorial: values.editorial, onProgress: console.error });
  result.generatedAt = new Date().toISOString();
  const digest = renderDigest(result);
  await save(`${output}/selected.json`, JSON.stringify(result, null, 2) + '\n');
  await save(`${output}/digest.md`, digest);
  if (values['show-scores']) {
    const evaluations = renderEvaluations(result);
    await save(`${output}/evaluations.md`, evaluations);
    console.log(evaluations);
    console.error(`評価一覧: ${output}/evaluations.md`);
  } else console.log(digest);
  console.error(`保存: ${output}/selected.json, ${output}/digest.md`);
}

main().catch(error => {
  console.error(error.code === 'ENOENT' ? '必要なファイルがありません。PROMPT.md と入力ファイルを確認してください。' : error.message);
  process.exitCode = 1;
});
