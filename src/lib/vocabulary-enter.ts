/** Bind only the visible learning card's primary action; never queue a key press. */
export function bindVocabularyEnter(
  card: HTMLElement,
  primary: () => HTMLButtonElement | null,
  answer: () => HTMLInputElement | null = () => null,
) {
  const document = card.ownerDocument;
  let composing = false;
  let compositionEndedAt = -Infinity;
  const compositionStart = () => { composing = true; };
  const compositionEnd = (event: CompositionEvent) => {
    composing = false;
    compositionEndedAt = event.timeStamp;
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.defaultPrevented || !card.isConnected
      || document.hidden || !document.hasFocus()
      || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [role="menu"], header details[open]')) return;
    const focused = document.activeElement;
    const button = primary();
    if (!focused || (focused !== document.body && !card.contains(focused))) return;
    const interactive = focused.closest('button, a, input, textarea, select, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="textbox"], [role="combobox"]');
    if (interactive && interactive !== button && focused !== answer()) return;
    // IME needs the unmodified event to confirm text. Some browsers report its
    // final Enter immediately after compositionend without isComposing set.
    if (composing || event.isComposing || event.keyCode === 229 || event.timeStamp - compositionEndedAt < 50) {
      if (focused === button) event.preventDefault();
      return;
    }
    event.preventDefault();
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !button || button.disabled) return;
    button.click();
  };
  document.addEventListener("keydown", keydown, { capture: true });
  card.addEventListener("compositionstart", compositionStart);
  card.addEventListener("compositionend", compositionEnd);
  return () => {
    document.removeEventListener("keydown", keydown, { capture: true });
    card.removeEventListener("compositionstart", compositionStart);
    card.removeEventListener("compositionend", compositionEnd);
  };
}
