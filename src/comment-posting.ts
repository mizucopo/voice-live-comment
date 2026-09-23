import type { CommentReviewDecision } from "./comment-review.js";
import type { ExtensionSettings } from "./settings.js";
import { applyDictionary, parseDictionaryRules, trimText } from "./utils/text.js";

export type CommentPostingContext = {
  settings: ExtensionSettings;
  signal: AbortSignal;
};

type CommentPostingDependencies = {
  review: (text: string, criteria: string, signal: AbortSignal) => Promise<CommentReviewDecision>;
  submit: (text: string, autoPost: boolean, signal: AbortSignal) => Promise<void>;
  notifyError: (message: string) => void;
};

export class CommentPostingQueue {
  private readonly pending = new WeakMap<AbortSignal, Promise<void>>();

  constructor(private readonly dependencies: CommentPostingDependencies) {}

  enqueue(text: string, { settings, signal }: CommentPostingContext): Promise<void> {
    const comment = applyDictionary(trimText(text), parseDictionaryRules(settings.dictionary));
    if (!comment.trim() || signal.aborted) return Promise.resolve();

    // Keep each session independent: an old API request must not delay a new session.
    const previous = this.pending.get(signal) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        if (signal.aborted) return;
        if (settings.commentReviewEnabled) {
          const decision = await this.dependencies.review(
            comment,
            settings.commentReviewCriteria,
            signal,
          );
          if (decision !== "post") return;
        }
        if (signal.aborted) return;
        await this.dependencies.submit(comment, settings.autoPost, signal);
      })
      .catch((error: unknown) => {
        if (!signal.aborted) {
          this.dependencies.notifyError(error instanceof Error ? error.message : String(error));
        }
      });
    this.pending.set(signal, next);
    return next;
  }
}
