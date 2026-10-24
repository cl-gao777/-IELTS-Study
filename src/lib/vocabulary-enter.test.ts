import { describe, expect, it, vi } from "vitest";
import { bindVocabularyEnter } from "./vocabulary-enter";

// A small event host tests shortcut policy without a browser dependency.
// Real DOM focus, native button activation and React wiring are browser-tested.
function fixture() {
  class Element extends EventTarget {
    disabled = false;
    isConnected = true;
    interactive = false;
    inside = true;
    click = vi.fn();
    closest() { return this.interactive ? this : null; }
  }
  const body = new Element(), card = new Element(), answer = new Element(), button = new Element();
  answer.interactive = button.interactive = true;
  const document = Object.assign(new EventTarget(), {
    body, activeElement: body, hidden: false, focused: true, overlay: false,
    hasFocus() { return this.focused; }, querySelector() { return this.overlay ? {} : null; },
  });
  Object.assign(card, { ownerDocument: document, contains: (element: Element) => element.inside });
  let primary: Element | null = button;
  const dispose = bindVocabularyEnter(card as unknown as HTMLElement,
    () => primary as unknown as HTMLButtonElement, () => answer as unknown as HTMLInputElement);
  function key(options: Record<string, unknown> = {}) {
    const event = new Event("keydown", { cancelable: true });
    Object.defineProperties(event, Object.fromEntries(Object.entries({ key: "Enter", timeStamp: 100, ...options }).map(([name, value]) => [name, { value }])));
    document.dispatchEvent(event);
    return event;
  }
  return { body, card, answer, button, document, key, dispose, setPrimary: (next: Element | null) => { primary = next; } };
}

describe("vocabulary Enter primary action", () => {
  it("continues after clicking lesson text focuses the AppShell main container", () => {
    const f = fixture();
    const main = { ...f.body, inside: false, closest: () => null } as typeof f.body;
    Object.assign(f.card, { closest: (selector: string) => selector === "main" ? main : null });
    f.document.activeElement = main;
    expect(f.key().defaultPrevented).toBe(true);
    expect(f.button.click).toHaveBeenCalledOnce();
  });

  it("checks once from the answer field, then uses the new primary after focus leaves the disabled input", () => {
    const f = fixture();
    f.document.activeElement = f.answer;
    f.key();
    expect(f.button.click).toHaveBeenCalledOnce();
    const next = { ...f.button, disabled: false, click: vi.fn() };
    f.setPrimary(next as typeof f.button);
    f.document.activeElement = f.body;
    f.key({ timeStamp: 200 });
    expect(next.click).toHaveBeenCalledOnce();
    expect(f.button.click).toHaveBeenCalledOnce();
  });

  it("uses the same click path with primary button focus and suppresses held Enter across card changes", () => {
    const f = fixture();
    f.document.activeElement = f.button;
    expect(f.key().defaultPrevented).toBe(true);
    expect(f.button.click).toHaveBeenCalledOnce();
    f.document.activeElement = f.answer;
    expect(f.key({ repeat: true }).defaultPrevented).toBe(true);
    expect(f.button.click).toHaveBeenCalledOnce();
  });

  it("does not queue a press while saving, waiting for preview, or lacking valid materials", () => {
    const f = fixture();
    f.button.disabled = true;
    f.key();
    f.button.disabled = false;
    expect(f.button.click).not.toHaveBeenCalled();
    f.setPrimary(null); f.key();
    expect(f.button.click).not.toHaveBeenCalled();
    f.setPrimary(f.button); f.key();
    expect(f.button.click).toHaveBeenCalledOnce();
  });

  it.each(["ctrlKey", "altKey", "metaKey", "shiftKey"])("ignores %s combinations including a focused primary button", (modifier) => {
    const f = fixture(); f.document.activeElement = f.button;
    expect(f.key({ [modifier]: true }).defaultPrevented).toBe(true);
    expect(f.button.click).not.toHaveBeenCalled();
  });

  it("retains IME confirmation and ignores the unmarked Enter immediately after compositionend", () => {
    const f = fixture(); f.document.activeElement = f.answer;
    f.card.dispatchEvent(new Event("compositionstart"));
    expect(f.key().defaultPrevented).toBe(false);
    const end = new Event("compositionend"); Object.defineProperty(end, "timeStamp", { value: 100 });
    f.card.dispatchEvent(end);
    f.key({ timeStamp: 125 }); f.key({ timeStamp: 180, isComposing: true }); f.key({ timeStamp: 180, keyCode: 229 });
    expect(f.button.click).not.toHaveBeenCalled();
    f.key({ timeStamp: 200 });
    expect(f.button.click).toHaveBeenCalledOnce();
  });

  it("leaves other controls and outside forms to native keyboard behavior", () => {
    const f = fixture();
    f.document.activeElement = { ...f.answer, inside: true, closest: () => ({}) } as typeof f.answer;
    expect(f.key().defaultPrevented).toBe(false);
    f.document.activeElement = { ...f.body, inside: false } as typeof f.body;
    expect(f.key().defaultPrevented).toBe(false);
    expect(f.button.click).not.toHaveBeenCalled();
  });

  it("does not act behind menus or dialogs, in the background, after pause/unmount, or after cleanup", () => {
    const f = fixture();
    f.document.overlay = true; f.key(); f.document.overlay = false;
    f.document.hidden = true; f.key(); f.document.hidden = false;
    f.document.focused = false; f.key(); f.document.focused = true;
    f.card.isConnected = false; f.key(); f.card.isConnected = true;
    f.dispose(); f.key();
    expect(f.button.click).not.toHaveBeenCalled();
  });
});
