export interface ThermalSnapshot {
  batteryTemperatureC: number | null;
  thermalStatus: number | null;
}

export type ThermalMode = "normal" | "single-track";

export interface ThermalDecision {
  action: "continue" | "cooldown" | "stop";
  cooldownSeconds: number;
  mode: ThermalMode;
  reason: string;
}

export function parseThermalStatus(output: string): number | null {
  const match = /^\s*Thermal Status:\s*(\d+)\s*$/im.exec(output);

  if (!match?.[1]) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);

  return Number.isInteger(parsed) ? parsed : null;
}

export function parseBatteryTemperatureC(output: string): number | null {
  const match = /^\s*temperature:\s*(-?\d+)\s*$/im.exec(output);

  if (!match?.[1]) {
    return null;
  }

  const deciCelsius = Number.parseInt(match[1], 10);

  if (!Number.isFinite(deciCelsius)) {
    return null;
  }

  return deciCelsius / 10;
}

export function decideThermalAction(
  snapshot: ThermalSnapshot,
  currentMode: ThermalMode,
): ThermalDecision {
  if (snapshot.thermalStatus !== null && snapshot.thermalStatus >= 4) {
    return {
      action: "stop",
      cooldownSeconds: 0,
      mode: "single-track",
      reason: `Thermal status is ${snapshot.thermalStatus}`,
    };
  }

  if (snapshot.batteryTemperatureC !== null && snapshot.batteryTemperatureC >= 43) {
    return {
      action: "stop",
      cooldownSeconds: 0,
      mode: "single-track",
      reason: `Battery temperature is ${snapshot.batteryTemperatureC.toFixed(1)}C`,
    };
  }

  if (
    (snapshot.thermalStatus !== null && snapshot.thermalStatus >= 2) ||
    (snapshot.batteryTemperatureC !== null && snapshot.batteryTemperatureC >= 40)
  ) {
    return {
      action: "cooldown",
      cooldownSeconds: 600,
      mode: "single-track",
      reason:
        snapshot.thermalStatus !== null && snapshot.thermalStatus >= 2
          ? `Thermal status is ${snapshot.thermalStatus}`
          : `Battery temperature is ${snapshot.batteryTemperatureC?.toFixed(1)}C`,
    };
  }

  if (currentMode === "single-track") {
    return {
      action: "continue",
      cooldownSeconds: 0,
      mode: "normal",
      reason: "Thermal state returned to normal",
    };
  }

  return {
    action: "continue",
    cooldownSeconds: 0,
    mode: currentMode,
    reason: "Thermal state is normal",
  };
}
