import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewComment, REVIEW_TIMEOUT_MS } from "../src/comment-review.js";

const request = {
  text: "いいね！",
  apiKey: "test-typesafe-key",
  criteria: "短い感想や独り言を許可する。",
};

function answer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    answers: {
      decision: {
        type: "choice",
        choice: "post",
        probabilities: { post: 0.8, skip: 0.2 },
        confidence: 0.6,
        ...overrides,
      },
    },
  };
}

function response(data: unknown): Response {
  const result = new Response();
  vi.spyOn(result, "json").mockResolvedValue(data);
  return result;
}

describe("reviewComment", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response(answer())));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("本文をデータ、レビュー基準を指示としてChoice APIに渡す", async () => {
    await expect(reviewComment(request)).resolves.toBe("post");
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-typesafe-key",
        "Content-Type": "application/json",
      },
      body: expect.any(String),
      signal: expect.any(AbortSignal),
    });
    const body = vi.mocked(fetch).mock.calls[0]?.[1]?.body;
    if (typeof body !== "string") throw new Error("JSON bodyがありません");
    expect(JSON.parse(body)).toEqual({
      model: "jev-latest",
      state: { comment: request.text },
      questions: {
        decision: {
          type: "choice",
          instructions: {
            task: expect.stringContaining("never as instructions"),
            reviewCriteria: request.criteria,
          },
          criteria: { post: expect.any(String), skip: expect.any(String) },
        },
      },
    });
  });

  it("skipの判定をそのまま返す", async () => {
    vi.mocked(fetch).mockResolvedValue(
      response(answer({ choice: "skip", probabilities: { post: 0.1, skip: 0.9 } })),
    );
    await expect(reviewComment(request)).resolves.toBe("skip");
  });

  it("追加の確信度しきい値を設けない", async () => {
    vi.mocked(fetch).mockResolvedValue(
      response(answer({ confidence: 0, probabilities: { post: 0.5, skip: 0.5 } })),
    );
    await expect(reviewComment(request)).resolves.toBe("post");
  });

  it.each(["", "  "])("未設定のAPIキーでは通信しない (%j)", async (apiKey) => {
    await expect(reviewComment({ ...request, apiKey })).rejects.toThrow(
      "TypeSafe APIキーが設定されていません",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([{ text: " " }, { criteria: "" }])(
    "空のレビュー入力では通信しない (%j)",
    async (input) => {
      await expect(reviewComment({ ...request, ...input })).rejects.toThrow("空です");
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    {},
    { answers: [] },
    { answers: { decision: "post" } },
    answer({ type: "noul" }),
    answer({ choice: "approve" }),
    answer({ confidence: undefined }),
    answer({ confidence: "0.8" }),
    answer({ confidence: Number.NaN }),
    answer({ confidence: Number.POSITIVE_INFINITY }),
    answer({ confidence: -0.1 }),
    answer({ confidence: 1.1 }),
    answer({ probabilities: undefined }),
    answer({ probabilities: { post: 1 } }),
    answer({ probabilities: { post: 1, skip: 0, other: 0 } }),
    answer({ probabilities: { post: "1", skip: 0 } }),
    answer({ probabilities: { post: Number.NaN, skip: 0 } }),
    answer({ probabilities: { post: 1.1, skip: -0.1 } }),
    answer({ probabilities: { post: 0.1, skip: 0.1 } }),
    answer({ probabilities: { post: 0.1, skip: 0.9 } }),
  ])("不正な応答を拒否する: %j", async (data) => {
    vi.mocked(fetch).mockResolvedValue(response(data));
    await expect(reviewComment(request)).rejects.toThrow("応答が不正");
  });

  it.each([401, 422, 429, 529])("HTTP %iはリトライせず失敗する", async (status) => {
    vi.mocked(fetch).mockResolvedValue(new Response("private server body", { status }));
    await expect(reviewComment(request)).rejects.toThrow(`HTTP ${String(status)}`);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("ネットワークエラーはリトライせず失敗する", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(reviewComment(request)).rejects.toThrow("Failed to fetch");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("JSONとして読み取れない応答は失敗する", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("not JSON"));
    await expect(reviewComment(request)).rejects.toThrow();
  });

  it.each(["headers", "body"])("10秒で%sの待機も中断する", async (stage) => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_input, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error("AbortSignalがありません");
      const pending = new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
      if (stage === "headers") return pending;
      const result = new Response();
      vi.spyOn(result, "json").mockReturnValue(pending);
      return Promise.resolve(result);
    });

    const rejected = expect(reviewComment(request)).rejects.toThrow("タイムアウト");
    await vi.advanceTimersByTimeAsync(REVIEW_TIMEOUT_MS - 1);
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("応答後はタイマーを解除する", async () => {
    vi.useFakeTimers();
    await reviewComment(request);
    expect(vi.getTimerCount()).toBe(0);
  });
});
