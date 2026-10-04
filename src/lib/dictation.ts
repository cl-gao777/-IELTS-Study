export type DictationErrorKind = "missing" | "extra" | "wrong" | "spelling";
export interface DictationToken { kind: DictationErrorKind | "correct"; expected: string; actual: string }
export function dictationWords(text: string): string[] {
  return text.normalize("NFKC").match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? [];
}
function canonical(text: string) { return text.toLowerCase().replace(/’/g, "'"); }
function editDistance(first: string, second: string) {
  const row = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let a = 1; a <= first.length; a++) {
    let diagonal = row[0]; row[0] = a;
    for (let b = 1; b <= second.length; b++) {
      const previous = row[b];
      row[b] = Math.min(row[b] + 1, row[b - 1] + 1, diagonal + (first[a - 1] === second[b - 1] ? 0 : 1));
      diagonal = previous;
    }
  }
  return row[second.length];
}
// Word alignment prevents one omitted word from marking every later word wrong.
export function compareDictation(expectedText: string, actualText: string): DictationToken[] {
  const expected = dictationWords(expectedText).slice(0, 500);
  const actual = dictationWords(actualText).slice(0, 500);
  const matrix = Array.from({ length: expected.length + 1 }, () => new Uint16Array(actual.length + 1));
  for (let i = 0; i <= expected.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= actual.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= expected.length; i++) for (let j = 1; j <= actual.length; j++) {
    matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1,
      matrix[i - 1][j - 1] + (canonical(expected[i - 1]) === canonical(actual[j - 1]) ? 0 : 1));
  }
  const result: DictationToken[] = [];
  let i = expected.length, j = actual.length;
  while (i || j) {
    if (i && j && matrix[i][j] === matrix[i - 1][j - 1] + (canonical(expected[i - 1]) === canonical(actual[j - 1]) ? 0 : 1)) {
      const e = expected[--i], a = actual[--j];
      const equal = canonical(e) === canonical(a);
      // Spelling is a transparent character-distance heuristic, not semantic feedback.
      const spelling = !equal && Math.max(e.length, a.length) >= 4 && editDistance(canonical(e), canonical(a)) <= (Math.max(e.length, a.length) >= 8 ? 2 : 1);
      result.push({ kind: equal ? "correct" : spelling ? "spelling" : "wrong", expected: e, actual: a });
    } else if (i && matrix[i][j] === matrix[i - 1][j] + 1) result.push({ kind: "missing", expected: expected[--i], actual: "" });
    else result.push({ kind: "extra", expected: "", actual: actual[--j] });
  }
  return result.reverse();
}
