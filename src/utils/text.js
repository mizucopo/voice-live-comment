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
