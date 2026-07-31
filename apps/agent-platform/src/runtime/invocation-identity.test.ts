import { describe, expect, it } from "vitest";

import { sessionWorkflowIdentity } from "./invocation-identity.js";

describe("sessionWorkflowIdentity", () => {
  it("maps one signed session to one stable Temporal entity Workflow", () => {
    const session = "agent:v1:conversation:0197f4a2-0800-7000-8000-000000000004";
    expect(sessionWorkflowIdentity(session)).toBe(sessionWorkflowIdentity(session));
    expect(sessionWorkflowIdentity(session)).not.toBe(
      sessionWorkflowIdentity("agent:v1:conversation:0197f4a2-0800-7000-8000-000000000005")
    );
  });
});
