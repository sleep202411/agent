import type { AnySpan } from "@mastra/core/observability";
import { SensitiveDataFilter } from "@mastra/observability";
import { describe, expect, it } from "vitest";

import { sensitiveDataFilterOptions } from "./core-platform.js";

describe("sensitiveDataFilterOptions", () => {
  it("redacts every credential-bearing attribute name the framework covers", () => {
    const filter = new SensitiveDataFilter(sensitiveDataFilterOptions);

    const span = filter.process({
      attributes: {
        apiKey: "vertex-service-key",
        auth: "Basic ZmFrZQ==",
        bearer: "eyJhbGciOiJFZERTQSJ9",
        clientSecret: "domain-gateway-client-secret",
        ssn: "000-00-0000",
        cookie: "session=abc",
        model: "gemini-3-pro",
      },
    } as unknown as AnySpan);

    expect(span.attributes).toEqual({
      apiKey: "[REDACTED]",
      auth: "[REDACTED]",
      bearer: "[REDACTED]",
      clientSecret: "[REDACTED]",
      ssn: "[REDACTED]",
      cookie: "[REDACTED]",
      model: "gemini-3-pro",
    });
  });

  it("never narrows the framework's own default field list", () => {
    // Supplying `sensitiveFields` replaces the defaults, so the configured list
    // has to stay a superset of whatever the installed framework ships.
    const defaults = new SensitiveDataFilter() as unknown as { sensitiveFields: string[] };

    expect(defaults.sensitiveFields.length).toBeGreaterThan(0);
    expect(sensitiveDataFilterOptions.sensitiveFields).toEqual(
      expect.arrayContaining(defaults.sensitiveFields)
    );
  });
});
