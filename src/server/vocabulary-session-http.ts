import "server-only";
import { NextResponse } from "next/server";
import { VocabularyReviewConflict } from "./vocabulary";
import { getVocabularySession } from "./vocabulary-session";
import { VocabularySessionConflict } from "./vocabulary-session-store";
import { VocabularyStudyConflict } from "./vocabulary-courses";

export function vocabularyConflictResponse(error: unknown) {
  if (error instanceof VocabularyStudyConflict) {
    return NextResponse.json({ ...getVocabularySession(), error: error.message, study: error.study }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  if (error instanceof VocabularyReviewConflict || error instanceof VocabularySessionConflict) {
    return NextResponse.json({ ...getVocabularySession(), ...(error instanceof VocabularyReviewConflict ? { word: error.word } : {}), error: error.message }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  throw error;
}
