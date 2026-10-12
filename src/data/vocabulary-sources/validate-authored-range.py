import json, pathlib, re, sys

root = pathlib.Path(__file__).resolve().parents[2]
repo = root / "outputs" / "IELTS_Studio"
total = 0
for name in sys.argv[1:]:
    expected = json.loads((root / "work" / "vocabulary-content" / "author-inputs" / f"{name}.json").read_text(encoding="utf-8"))
    rows = json.loads((repo / "src" / "data" / "vocabulary-authored" / f"{name}.json").read_text(encoding="utf-8"))
    assert [row[0] for row in rows] == [entry["term"] for entry in expected], (name, "membership/order")
    for term, meaning, pos, first, second in rows:
        assert re.search(r"[\u4e00-\u9fff]", meaning), (term, "Chinese meaning")
        assert pos.strip() and first.strip().lower() != second.strip().lower(), (term, "duplicate sentences")
        for sentence in (first, second):
            assert len(re.findall(r"(?<![A-Za-z])" + re.escape(term) + r"(?![A-Za-z])", sentence, re.I)) == 1, (term, sentence, "target count")
            assert len(re.findall(r"[A-Za-z]+", sentence)) >= 4, (term, "short context")
            assert not re.search(r"\b(?:the word|word means|target word|fill in)\b", sentence, re.I), (term, "placeholder")
    total += len(rows)
    print(f"{name}: {len(rows)} authored entries / {len(rows) * 2} original contexts checked")
print(f"Total: {total} entries")
