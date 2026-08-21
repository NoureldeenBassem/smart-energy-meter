import { apiClient } from "./api";

const DEFAULT_EXTERNAL_ID = "esp32_meter_01";
const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 20000;

export async function registerDevice(): Promise<string> {
  const res = await apiClient.post("/devices", {
    external_id: DEFAULT_EXTERNAL_ID,
    device_label: "Main Energy Meter",
  });
  const deviceId = res.data.device_id;
  localStorage.setItem("device_id", deviceId);
  return deviceId;
}

export async function waitForDeviceOnline(deviceId: string): Promise<boolean> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const poll = setInterval(async () => {
      try {
        const res = await apiClient.get(`/telemetry/is-online/${deviceId}`);
        if (res.data.is_online) {
          clearInterval(poll);
          resolve(true);
          return;
        }
      } catch {
        // device not found yet or transient error — keep polling until timeout
      }

      if (Date.now() - startTime > MAX_WAIT_MS) {
        clearInterval(poll);
        resolve(false);
      }
    }, POLL_INTERVAL_MS);
  });
}