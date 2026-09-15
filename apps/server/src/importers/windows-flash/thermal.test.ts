import assert from "node:assert/strict";
import test from "node:test";

import { decideThermalAction, parseBatteryTemperatureC, parseThermalStatus } from "./thermal.ts";

test("parseThermalStatus reads Android thermalservice output", () => {
  assert.equal(parseThermalStatus("Thermal Status: 3\nCached temperatures:\n"), 3);
});

test("parseBatteryTemperatureC converts deci-celsius to celsius", () => {
  assert.equal(parseBatteryTemperatureC("temperature: 351\n"), 35.1);
});

test("decideThermalAction cools down on moderate thermal pressure", () => {
  const decision = decideThermalAction(
    {
      batteryTemperatureC: 39.5,
      thermalStatus: 2,
    },
    "normal",
  );

  assert.equal(decision.action, "cooldown");
  assert.equal(decision.cooldownSeconds, 600);
  assert.equal(decision.mode, "single-track");
});

test("decideThermalAction stops on critical battery temperature", () => {
  const decision = decideThermalAction(
    {
      batteryTemperatureC: 43.2,
      thermalStatus: 1,
    },
    "single-track",
  );

  assert.equal(decision.action, "stop");
  assert.equal(decision.mode, "single-track");
});

test("decideThermalAction returns to normal mode when temperature recovers", () => {
  const decision = decideThermalAction(
    {
      batteryTemperatureC: 35.2,
      thermalStatus: 0,
    },
    "single-track",
  );

  assert.equal(decision.action, "continue");
  assert.equal(decision.mode, "normal");
});
