/**
 * tests/unit/ui/orchestrationModel.test.ts
 * Run: node --import tsx/esm --test tests/unit/ui/orchestrationModel.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ORCH_STATES,
  orchStateColor,
} from "../../../src/app/(dashboard)/dashboard/orchestration/model/orchestrationTypes.ts";
import { STATUS_HEX } from "../../../src/shared/constants/statusColors.ts";

describe("orchestrationTypes", () => {
  it("covers all six states with a color each", () => {
    assert.equal(ORCH_STATES.length, 6);
    for (const s of ORCH_STATES) {
      assert.match(orchStateColor(s), /^#[0-9a-f]{6}$/i, s);
    }
  });
  it("waiting_approval maps to the new STATUS_HEX.approval violet", () => {
    assert.equal(orchStateColor("waiting_approval"), STATUS_HEX.approval);
    assert.equal(STATUS_HEX.approval, "#8b5cf6");
  });
  it("running maps to warning, succeeded to success, failed to error", () => {
    assert.equal(orchStateColor("running"), STATUS_HEX.warning);
    assert.equal(orchStateColor("succeeded"), STATUS_HEX.success);
    assert.equal(orchStateColor("failed"), STATUS_HEX.error);
  });
});
