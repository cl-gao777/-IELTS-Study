import { describe, expect, it } from "vitest";

import { runProviderFallback } from "./provider-fallback";

describe("runProviderFallback", () => {
  it("uses the first successful provider in configured order", async () => {
    const calls: string[] = [];
    const result = await runProviderFallback(
      ["primary", "secondary", "unused"],
      async (provider) => {
        calls.push(provider);
        if (provider === "primary") throw new Error("offline");
        return `${provider}-response`;
      },
    );

    expect(calls).toEqual(["primary", "secondary"]);
    expect(result).toEqual({
      provider: "secondary",
      value: "secondary-response",
    });
  });

  it("returns null when every provider fails", async () => {
    expect(
      await runProviderFallback(["one"], async () => {
        throw new Error("offline");
      }),
    ).toBeNull();
  });
});

