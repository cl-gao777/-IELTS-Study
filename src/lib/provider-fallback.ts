export async function runProviderFallback<TProvider, TValue>(
  providers: readonly TProvider[],
  attempt: (provider: TProvider) => Promise<TValue>,
) {
  for (const provider of providers) {
    try {
      return {
        provider,
        value: await attempt(provider),
      };
    } catch {
      // Failure is isolated to this provider; continue in configured order.
    }
  }

  return null;
}

