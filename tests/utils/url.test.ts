import { describe, it, expect } from "vitest";
import { isTargetPage } from "../../src/utils/url.js";

describe("isTargetPage", () => {
  it("YouTube watch URLに対してtrueを返す", () => {
    expect(isTargetPage("https://www.youtube.com/watch?v=abc123")).toBe(true);
  });

  it("YouTube live URLに対してtrueを返す", () => {
    expect(isTargetPage("https://www.youtube.com/live/xyz789")).toBe(true);
  });

  it("YouTube Studio URLに対してtrueを返す", () => {
    expect(isTargetPage("https://studio.youtube.com/channel/123")).toBe(true);
  });

  it("その他のURLに対してfalseを返す", () => {
    expect(isTargetPage("https://example.com")).toBe(false);
  });

  it("YouTubeトップページに対してfalseを返す", () => {
    expect(isTargetPage("https://www.youtube.com/")).toBe(false);
  });

  it("YouTube search URLに対してfalseを返す", () => {
    expect(isTargetPage("https://www.youtube.com/results?search_query=test")).toBe(false);
  });

  it("モバイルYouTube URLに対してtrueを返す", () => {
    expect(isTargetPage("https://m.youtube.com/watch?v=abc123")).toBe(true);
  });

  it.each([
    "https://example.com/studio.youtube.com/channel/123",
    "https://studio.youtube.com.example.com/channel/123",
    "https://studio.youtube.com@example.com/channel/123",
    "https://example.com/?next=https://www.youtube.com/watch?v=abc123",
  ])("許可ホスト名を埋め込んだURLに対してfalseを返す: %s", (url) => {
    expect(isTargetPage(url)).toBe(false);
  });

  it("null入力に対してfalseを返す", () => {
    expect(isTargetPage(null)).toBe(false);
  });

  it("undefined入力に対してfalseを返す", () => {
    expect(isTargetPage(undefined)).toBe(false);
  });

  it("空文字に対してfalseを返す", () => {
    expect(isTargetPage("")).toBe(false);
  });
});
