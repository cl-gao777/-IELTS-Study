import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VocabularySessionClient } from "@/lib/vocabulary-session-client";
import { VocabularyMorePanel } from "./vocabulary-more-panel";

function render(locked = false, attentionMessage?: string) {
  return renderToStaticMarkup(<VocabularyMorePanel open={false} onClose={vi.fn()} triggerRef={{ current: null }}
    state={new VocabularySessionClient([], 0).getSnapshot()} studyState={{ study: null, ready: true, busy: false, message: "", unsavedSeconds: 0 }}
    locked={locked} dueCount={0} today={0} attentionMessage={attentionMessage}
    onMode={vi.fn()} onFocus={vi.fn()} onGoal={vi.fn()} onClearAnswer={vi.fn()} onEnd={vi.fn()} onRetryTime={vi.fn()} />);
}

describe("vocabulary More panel safety", () => {
  it("includes action failures inside the modal instead of only behind it", () => {
    const html = render(false, "切换失败，请重试。");
    expect(html).toContain('<dialog');
    expect(html).toMatch(/role="alert"[^>]*>切换失败，请重试。/);
    expect(html).toContain('aria-labelledby="vocabulary-more-title"');
  });
  it("locks mode and goal edits while a save is pending but keeps Close usable", () => {
    const html = render(true);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Recognition · 认词/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>保存目标/);
    expect(html.match(/<button[^>]*aria-label="关闭学习选项"[^>]*>/)?.[0]).not.toContain("disabled");
  });
});
