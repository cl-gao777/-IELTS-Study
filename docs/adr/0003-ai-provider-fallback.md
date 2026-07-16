# ADR 0003: OpenAI-compatible provider fallback

- Status: Accepted
- Date: 2026-07-16

## Context

The learner already uses Codex with more than one OpenAI-compatible provider.
Connections may fail temporarily, so the application must not depend on one
provider or expose API keys to the browser.

## Decision

The server-side AI adapter will load providers in this order:

1. `AI_PROVIDERS_JSON` from the deployment environment;
2. `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL`;
3. compatible provider and authentication data discovered from `CODEX_HOME`.

Each request tries providers in order. A provider failure is recorded without
including secrets, then the next provider is attempted. The browser receives
only the selected provider name and the generated response.

## Consequences

- Existing Codex-compatible infrastructure can be reused.
- The app remains usable with standard OpenAI-compatible endpoints.
- Provider-specific behavior is isolated behind one adapter.
- Secrets must remain server-side and must never enter learning exports.
