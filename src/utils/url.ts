/**
 * URLがYouTube Live/配信対象ページかどうかを判定
 * @param {string} url - 判定対象のURL
 * @returns {boolean} 対象ページならtrue
 */
export function isTargetPage(url: unknown): boolean {
  if (!url || typeof url !== "string") {
    return false;
  }

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname === "studio.youtube.com") {
      return true;
    }

    const youtubeHosts = ["youtube.com", "www.youtube.com", "m.youtube.com"];
    return (
      youtubeHosts.includes(parsedUrl.hostname) &&
      (parsedUrl.pathname.startsWith("/watch") || parsedUrl.pathname.startsWith("/live"))
    );
  } catch {
    return false;
  }
}
