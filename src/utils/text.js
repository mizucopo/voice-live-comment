/**
 * テキストをトリムし、連続する空白を1つにまとめる
 * @param {string} text - 処理対象のテキスト
 * @returns {string} トリム済みのテキスト
 */
export function trimText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * 辞書テキストをパースして置換ルール配列に変換する
 * @param {string} text - 辞書テキスト（1行に1ルール、`→`区切り）
 * @returns {Array<{from: string, to: string}>} 置換ルール配列
 */
export function parseDictionaryRules(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const idx = line.indexOf('→');
      if (idx <= 0) return null;
      return { from: line.slice(0, idx), to: line.slice(idx + 1) };
    })
    .filter(Boolean);
}

/**
 * 置換ルールをテキストに適用する
 * @param {string} text - 対象テキスト
 * @param {Array<{from: string, to: string}>} rules - 置換ルール配列
 * @returns {string} 置換後のテキスト
 */
export function applyDictionary(text, rules) {
  for (const rule of rules) {
    text = text.replaceAll(rule.from, rule.to);
  }
  return text;
}
