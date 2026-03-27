/**
 * URLがYouTube Live/配信対象ページかどうかを判定
 * @param {string} url - 判定対象のURL
 * @returns {boolean} 対象ページならtrue
 */
export function isTargetPage(url) {
  return url.includes('youtube.com/watch') ||
         url.includes('youtube.com/live') ||
         url.includes('studio.youtube.com');
}
