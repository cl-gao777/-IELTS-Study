import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type Database from "better-sqlite3";

const scopes = new AsyncLocalStorage<WeakMap<Database.Database, Map<string, unknown>>>();
export const vocabularyReadKeys = {
  definitions: "target-definitions", states: "target-states", stateIndex: "target-state-index",
  dispositions: "term-dispositions", dispositionIndex: "term-disposition-index",
} as const;

/** Request-local only. Nested calls share reads; independent requests never do. */
export function withVocabularyReadScope<T>(database: Database.Database, work: () => T): T {
  if (scopes.getStore()?.has(database)) return work();
  const scope = new WeakMap<Database.Database, Map<string, unknown>>();
  scope.set(database, new Map());
  return scopes.run(scope, work);
}
export function hasVocabularyReadScope(database: Database.Database) {
  return scopes.getStore()?.has(database) ?? false;
}
export function readVocabularyScoped<T>(database: Database.Database, key: string, load: () => T): T {
  const values = scopes.getStore()?.get(database);
  if (!values) return load();
  if (!values.has(key)) values.set(key, load());
  return values.get(key) as T;
}
/** Call after content writes, and after rollback if reads occurred in a transaction. */
export function invalidateVocabularyReadScope(database: Database.Database, keys?: readonly string[]) {
  const values = scopes.getStore()?.get(database);
  if (keys) for (const key of keys) values?.delete(key);
  else values?.clear();
}
/** Learning/scoring changes state, not immutable course definitions. */
export function invalidateVocabularyMutableReads(database: Database.Database) {
  invalidateVocabularyReadScope(database, [vocabularyReadKeys.states, vocabularyReadKeys.stateIndex,
    vocabularyReadKeys.dispositions, vocabularyReadKeys.dispositionIndex]);
}
