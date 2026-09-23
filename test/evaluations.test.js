import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderEvaluations } from '../src/evaluations.js';

const a = { id: 'a', title: 'First', interest: 3, quality: 2, category: 'ai', aiRelated: true };
const b = { id: 'b', title: 'Second', interest: 4, quality: 1, category: 'dev', aiRelated: false, exclusion: '同じ話題' };
const fixture = () => ({ selected: [a], excluded: [b], settings: { count: 10, minScore: 2.5, maxAi: 3 }, audit: [
  { articleIds: ['a', 'b'], model: 'test-model', answers: {
    interest_0: { confidence: 0 }, interest_1: { confidence: 0.91 },
    quality_0: { confidence: 1 }, category_0: { confidence: 0.6 }, ai_0: { noul: 0.2 },
  } },
  { candidateId: 'b', selectedIds: ['a'], answers: { duplicate_0: { type: 'noul', noul: 0.9 } } },
] });

test('scores are sorted but confidences stay associated with the correct article ID', () => {
  const output = renderEvaluations(fixture());
  assert.ok(output.indexOf('Second') < output.indexOf('First'));
  assert.match(output, /4.00\/4（確信度 91.0%）/);
  assert.match(output, /3.00\/4（確信度 0.0%）/);
  assert.match(output, /AI確率: 20.0% \/ AI枠: 対象/);
  assert.match(output, /重複確率の最大値: 90.0% \/ 比較先: First/);
  assert.match(output, /除外: 同じ話題/);
});

test('older audit without IDs does not invent an association or AI classification', () => {
  const output = renderEvaluations({ selected: [{ ...a, aiRelated: undefined }], excluded: [], audit: [{ answers: { interest_0: { confidence: 0.99 } } }] });
  assert.match(output, /確信度 未記録/);
  assert.match(output, /AI枠: 未記録/);
  assert.ok(!output.includes('99.0%'));
});

test('empty, invalid and untrusted saved data are handled', () => {
  assert.match(renderEvaluations({ selected: [], excluded: [] }), /評価対象の記事はありません/);
  assert.throws(() => renderEvaluations({ articles: [] }), /selected.json/);
  assert.throws(() => renderEvaluations({ selected: [a, a], excluded: [] }), /IDまたは採点/);
  const output = renderEvaluations({ selected: [{ ...a, title: '\u001b[31m<script>bad</script>', url: 'javascript:alert(1)' }], excluded: [] });
  assert.ok(!output.includes('\u001b'));
  assert.ok(!output.includes('<script>'));
  assert.ok(!output.includes('javascript:'));
});

test('scores CLI works without .env, PROMPT.md or credentials and creates no output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'jev-scores-'));
  try {
    const input = join(directory, 'selected.json');
    writeFileSync(input, JSON.stringify(fixture()));
    const output = execFileSync(process.execPath, [fileURLToPath(new URL('../src/cli.js', import.meta.url)), 'scores', '--input', input], {
      cwd: directory, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 5000,
    });
    assert.match(output, /Jev評価一覧: 2件/);
    assert.match(output, /test-model/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
