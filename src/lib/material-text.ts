// Imported HTML is converted to plain text and never inserted into the DOM as HTML.
export function htmlToPlainText(html: string) {
  return html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|article|section|h[1-6]|tr)>/gi, "\n\n").replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "").replace(/&#(x[0-9a-f]+|\d+);/gi, (_, value: string) => {
      const point = value[0].toLowerCase() === "x" ? parseInt(value.slice(1), 16) : Number(value);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    }).replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, entity: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[entity] || "")
    .replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
