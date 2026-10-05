// Manifest ranges reference the reviewed document array; uploaded file IDs are
// resolved during import so a private manifest remains portable across installs.
function manifestReadingPassages(passages, documents) {
  if (passages === undefined) return undefined;
  if (!Array.isArray(passages)) throw new Error('Reading passages must be an array.');
  return passages.map((passage) => ({
    id: passage.id, label: passage.label, questionIds: passage.questionIds,
    documents: (passage.documents || []).map((reference) => {
      const index = reference.documentIndex;
      if (!Number.isInteger(index) || index < 0 || index >= documents.length || documents[index].role !== 'questions') {
        throw new Error('A reading range must reference a reviewed question document.');
      }
      const document = documents[index];
      return {
        label: reference.label || document.label, url: document.url,
        sourceUrl: document.sourceUrl || '', sha256: document.sha256,
        page: reference.page, endPage: reference.endPage,
      };
    }),
  }));
}

function reviewedDocument(document, url) {
  return { role: document.role, label: document.label, url, sourceUrl: document.sourceUrl || '',
    ...(document.page ? { page: document.page } : {}), ...(document.endPage ? { endPage: document.endPage } : {}),
    sha256: document.sha256 };
}

module.exports = { manifestReadingPassages, reviewedDocument };
