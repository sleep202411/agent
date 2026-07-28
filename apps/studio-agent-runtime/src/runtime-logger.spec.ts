import { describe, expect, it } from "vitest";
import { describeMetricsBindFailure, installTemporalRuntimeLogger } from "./runtime-logger.js";

describe("runtime logger installation", () => {
  it("names the variable and the per-role defaults when the metrics address is taken", () => {
    expect(() =>
      installTemporalRuntimeLogger("activities", "0.0.0.0:9465", () => {
        throw new Error(
          "Failed to start prometheus metrics exporter: Address already in use (os error 48)"
        );
      })
    ).toThrow(
      /activities worker cannot export metrics on 0\.0\.0\.0:9465[\s\S]*STUDIO_AGENT_METRICS_BIND_ADDRESS[\s\S]*control 3010\/0\.0\.0\.0:9464, activities 3011\/0\.0\.0\.0:9465/
    );
  });

  it("passes an unrelated runtime failure through untouched", () => {
    const original = new Error("core runtime failed for another reason");

    expect(describeMetricsBindFailure(original, "control", "0.0.0.0:9464")).toBe(original);
  });

  it("installs the Prometheus exporter on the configured bind address", () => {
    const installed: (string | undefined)[] = [];

    installTemporalRuntimeLogger("control", "127.0.0.1:9999", (options) => {
      const metrics = options.telemetryOptions?.metrics;
      installed.push(
        metrics && "prometheus" in metrics ? metrics.prometheus?.bindAddress : "missing"
      );
    });

    expect(installed).toEqual(["127.0.0.1:9999"]);
  });
});
