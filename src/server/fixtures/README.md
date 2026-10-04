# Original document extraction fixtures

Both files were created for IELTS Studio regression testing on 2026-10-04.
The PDF uses ReportLab and the DOCX uses python-docx. Their only learning text is:

> Original import verification. Urban gardens support native insects.

This sentence is original project material. No book, examination, question bank,
audio, or third-party educational content is included. The small binary fixtures
are committed so tests exercise real compressed PDF and DOCX extraction, not a
mocked parser or a hand-waved file extension check.

The production HTTP upload smoke check must also cover the PDF fixture: the old
pdf-parse 1.1.1 parser could read this file in bare Node but failed with
`bad XRef entry` inside the Next.js route. The application uses pdf-parse 2.4.5
with its local worker, an external server package boundary, and a file URL for
the worker on Windows.
