const numeric = (value, max) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
const score = (value, max) => numeric(value, max) ? `${value.toFixed(2)}/${max}` : '未記録';
const percent = value => numeric(value, 1) ? `${(value * 100).toFixed(1)}%` : '未記録';
const text = value => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/[\\`*_[\]<>|]/g, '\\$&');

export function renderEvaluations(result) {
  if (!result || !Array.isArray(result.selected) || !Array.isArray(result.excluded)) {
    throw new Error('評価結果の形式が不正です。articles.json ではなく selected.json を指定してください。');
  }
  const rows = [
    ...result.selected.map(article => ({ article, status: '採用' })),
    ...result.excluded.map(article => ({ article, status: `除外: ${article?.exclusion || '理由未記録'}` })),
  ];
  const ids = new Set();
  for (const { article } of rows) {
    if (!article || typeof article.id !== 'string' || ids.has(article.id) || !numeric(article.interest, 4) || !numeric(article.quality, 2)) {
      throw new Error('評価記事のIDまたは採点が不正です。selected.json を確認してください。');
    }
    ids.add(article.id);
  }
  rows.sort((a, b) => b.article.interest - a.article.interest || b.article.quality - a.article.quality);
  const evaluations = new Map();
  const duplicates = new Map();
  const audit = Array.isArray(result.audit) ? result.audit : [];
  for (const call of audit) {
    if (!call || !call.answers) continue;
    // Never guess batch order from ranked articles in older files lacking articleIds.
    if (Array.isArray(call.articleIds)) call.articleIds.forEach((id, i) => evaluations.set(id, {
      interest: call.answers[`interest_${i}`], quality: call.answers[`quality_${i}`],
      category: call.answers[`category_${i}`], ai: call.answers[`ai_${i}`],
    }));
    if (typeof call.candidateId === 'string' && Array.isArray(call.selectedIds)) {
      duplicates.set(call.candidateId, call.selectedIds.flatMap((id, i) => {
        const answer = call.answers[`duplicate_${i}`];
        return answer?.type === 'noul' && numeric(answer.noul, 1) ? [{ id, probability: answer.noul }] : [];
      }).sort((a, b) => b.probability - a.probability));
    }
  }
  const titles = new Map(rows.map(({ article }) => [article.id, article.title || article.id]));
  const models = [...new Set(audit.map(call => call?.model).filter(v => typeof v === 'string'))];
  const settings = result.settings || {};
  const metric = settings.editorial ? '読む価値' : '関心度';
  const lines = [
    `Jev評価一覧: ${rows.length}件（採用 ${result.selected.length}件 / 除外 ${result.excluded.length}件）`,
    `評価日時: ${text(result.generatedAt || '未記録')} / モデル: ${text(models.join(', ') || '未記録')}`,
    `選定設定: ${metric} ${settings.minScore ?? '未記録'}以上 / 最大 ${settings.count ?? '未記録'}件 / ${settings.editorial ? '分野別上限なし' : `AI上限 ${settings.maxAi ?? '未記録'}件`}`,
    '',
    `${metric}順。${metric}は0〜4、一次情報・充実度は0〜2。確信度はJevのconfidenceで、点数や採用確率ではありません。`,
    'AI確率はJevのNoul、AI枠と採用／除外はコードの選定結果です。未記録の値は推測しません。',
    '',
  ];
  if (!rows.length) lines.push('評価対象の記事はありません。', '');
  rows.forEach(({ article: a, status }, i) => {
    const answers = evaluations.get(a.id) || {};
    const ai = typeof a.aiRelated === 'boolean' ? (a.aiRelated ? '対象' : '対象外') : '未記録';
    lines.push(
      `${i + 1}. **${text(status)}** [${text(a.source || 'フィード名なし')}] ${text(a.title || 'タイトルなし')}`,
      `   ${metric}: ${score(a.interest, 4)}（確信度 ${percent(answers.interest?.confidence)}） / 一次情報・充実度: ${score(a.quality, 2)}（確信度 ${percent(answers.quality?.confidence)}）`,
      `   分類: ${text(a.category || '未記録')}（確信度 ${percent(answers.category?.confidence)}） / AI確率: ${percent(answers.ai?.noul)} / AI枠: ${ai}`,
    );
    const comparison = duplicates.get(a.id)?.[0];
    lines.push(comparison
      ? `   重複確率の最大値: ${percent(comparison.probability)} / 比較先: ${text(titles.get(comparison.id) || comparison.id)}`
      : '   重複比較: 記録なし（未実施または旧形式）');
    if (typeof a.url === 'string' && /^https?:\/\/[^\s<>]+$/.test(a.url)) lines.push(`   <${a.url}>`);
    lines.push('');
  });
  return lines.join('\n');
}
