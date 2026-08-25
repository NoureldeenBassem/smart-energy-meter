import axios from "axios";

/**
 * Where the API lives.
 *
 * Hardcoding localhost meant the app could only ever be opened on the machine
 * running the backend — a phone on the same Wi-Fi, or any deployed build, would
 * call its own origin and get nothing. That also blocks installing it as a PWA,
 * since that needs a real hostname over HTTPS.
 *
 * Set NEXT_PUBLIC_API_URL to the backend's origin to point it elsewhere:
 *
 *   NEXT_PUBLIC_API_URL=http://192.168.1.20:8000   (phone on the same network)
 *   NEXT_PUBLIC_API_URL=https://api.example.com    (deployed)
 *
 * It is read at BUILD time, not runtime — NEXT_PUBLIC_* is inlined by Next — so
 * changing it needs a rebuild. The localhost default keeps `npm run dev`
 * working with no configuration, which is how it is used most of the time.
 */
const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const API_BASE_URL = `${API_ORIGIN.replace(/\/$/, "")}/api/v1`;

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
});

// Attach the stored token to every outgoing request automatically.
apiClient.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

export async function registerUser(email: string, password: string): Promise<string> {
  const res = await apiClient.post("/auth/register", { email, password });
  return res.data.access_token;
}

export async function loginUser(email: string, password: string): Promise<string> {
  const res = await apiClient.post("/auth/login", { email, password });
  return res.data.access_token;
}

// ---------------------------------------------------------------------------
// Response types.
//
// These mirror the Pydantic schemas in backend/app/api/schemas.py. Fields the
// UI does not read are still declared, because a field that exists in the
// payload and is missing here reads as "the API does not return that" the next
// time someone looks.
//
// Nothing here recomputes a backend number. The tariff inverse, the budget
// split and the confidence band are all fetched, never derived in the browser:
// a second implementation in TypeScript is exactly how the screen and the
// arithmetic start disagreeing.
// ---------------------------------------------------------------------------

export interface TelemetryDashboard {
  device_id: string;
  voltage: number;
  current: number;
  active_power: number;
  power_factor: number;
  today_energy_kwh: number;   // Africa/Cairo local day, not UTC
  month_energy_kwh: number;   // matches the forecaster's kwh_so_far exactly
  last_updated: string;
}

export interface Prediction {
  predicted_kwh: number;
  confidence_low: number;
  confidence_high: number;
  confidence_label: string;
  confidence_basis: string;
  naive_prediction_kwh: number;
  model_correction_kwh: number;
  model_version: string;
  prediction_method: "model" | "naive";
  fallback_reason: string | null;
  day_of_month: number;
  days_remaining_in_cycle: number;
  cycle_start_date: string;
  cycle_length_days: number;
  data_quality: {
    days_elapsed: number;
    days_with_readings: number;
    days_missing: number;
    day_coverage: number;
    warning: string | null;
  };
  predicted_bill_egp: number;
  confidence_bill_low_egp: number;
  confidence_bill_high_egp: number;
  kwh_so_far: number;
  bill_so_far_egp: number;
  tariff_position: TariffPosition;
}

export interface TariffPosition {
  consumption_kwh: number;
  total_bill_egp: number;
  active_bracket: number | null;
  price_per_kwh_current: number | null;
  kwh_remaining_in_bracket: number | null;
}

/** status is the engine's own vocabulary: essential | optimal | constrained | shed | away */
export type AllocationStatus =
  | "essential"
  | "optimal"
  | "constrained"
  | "shed"
  | "away";

export interface Allocation {
  appliance_id: string;
  name: string;
  rated_power_w: number;
  priority: string;
  is_essential: boolean;
  recommended_runtime_hours: number;
  estimated_kwh: number;
  status: AllocationStatus;
  action_note: string;
}

export interface BudgetAlert {
  pct_of_budget_used: number;
  alert_threshold_pct: number;
  alert_triggered: boolean;
  message: string | null;
}

export interface RecommendationDashboard {
  active_mode: Mode;
  target_bill_egp: number;
  days_remaining_in_month: number;
  daily_kwh_allowance: number;
  budget_daily_kwh: number;
  essential_kwh: number;
  discretionary_kwh_allowance: number;
  total_allocated_kwh: number;
  within_budget: boolean;
  budget_note: string | null;
  allocations: Allocation[];
  alert: BudgetAlert;
}

export interface Budget {
  budget_id: string;
  target_bill_egp: number;
  alert_threshold_pct: number;
}

export interface TariffAllowance {
  target_bill_egp: number;
  allowed_kwh: number;
  /** calculate_bill(allowed_kwh) — the round trip, shown rather than asserted */
  bill_at_allowance: number;
  tariff_position: TariffPosition;
}

/**
 * One local-day rollup from telemetry_daily.
 *
 * bucket_start is a plain date string (YYYY-MM-DD) on Africa/Cairo local days,
 * not UTC — the backend buckets it that way so the chart's "today" is the same
 * day the forecaster and the recommendation budget mean. See
 * backend/app/core/billing_time.py.
 *
 * total_energy_kwh is the authoritative figure. avg_power_w is sampling-weighted
 * and deliberately not read by any UI (SUBMISSION_STATUS.md §2).
 */
export interface DailyBucket {
  bucket_start: string;
  total_energy_kwh: number;
  avg_power_w: number | null;
  peak_power_w: number | null;
}

export interface TariffBracket {
  bracket_order: number;
  kwh_from: number;
  kwh_to: number | null;   // null = unbounded top bracket
  price_per_kwh: number;
}

export type Mode = "normal" | "eco" | "heavy" | "away";

export const MODES: Mode[] = ["normal", "eco", "heavy", "away"];

/** Mode labels shown to the user. The wire values stay as the API defines them. */
export const MODE_LABELS: Record<Mode, string> = {
  normal: "Home",
  eco: "Eco",
  heavy: "Guests",
  away: "Away",
};

// ---------------------------------------------------------------------------
// Fetchers.
// ---------------------------------------------------------------------------

export async function fetchTelemetry(deviceId: string): Promise<TelemetryDashboard> {
  const res = await apiClient.get(`/telemetry/dashboard/${deviceId}`);
  return res.data;
}

export async function fetchIsOnline(deviceId: string): Promise<boolean> {
  const res = await apiClient.get(`/telemetry/is-online/${deviceId}`);
  return Boolean(res.data.is_online);
}

/**
 * Daily kWh totals, most recent `days` local days, oldest first.
 *
 * The endpoint has existed since the aggregation worker was built; this is the
 * first screen to read it. No backend change was needed to chart the cycle.
 */
export async function fetchDailyTelemetry(
  deviceId: string,
  days = 31,
): Promise<DailyBucket[]> {
  const res = await apiClient.get(`/telemetry/daily/${deviceId}`, {
    params: { days },
  });
  const rows: DailyBucket[] = res.data ?? [];
  return [...rows].sort((a, b) => a.bucket_start.localeCompare(b.bucket_start));
}

export async function fetchPrediction(deviceId: string): Promise<Prediction> {
  const res = await apiClient.get(`/predictions/${deviceId}`);
  return res.data;
}

export async function fetchRecommendations(
  deviceId: string,
  mode: Mode = "normal",
): Promise<RecommendationDashboard> {
  const res = await apiClient.get(`/budgets/recommendations/${deviceId}`, {
    params: { mode },
  });
  return res.data;
}

export async function fetchActiveBudget(): Promise<Budget> {
  const res = await apiClient.get("/budgets/active");
  return res.data;
}

export async function saveBudget(
  targetBillEgp: number,
  alertThresholdPct: number,
): Promise<Budget> {
  const res = await apiClient.post("/budgets", {
    target_bill_egp: targetBillEgp,
    alert_threshold_pct: alertThresholdPct,
  });
  return res.data;
}

/** Target bill -> allowed kWh, computed by the backend tariff engine. */
export async function fetchAllowance(targetBillEgp: number): Promise<TariffAllowance> {
  const res = await apiClient.get("/tariff/allowance", {
    params: { target_bill_egp: targetBillEgp },
  });
  return res.data;
}

export async function fetchTariffBrackets(): Promise<TariffBracket[]> {
  const res = await apiClient.get("/tariff/brackets");
  return res.data;
}

/**
 * Reads the API's own error text where there is one.
 *
 * The backend returns a plain-language `detail` on every 4xx it raises by hand
 * ("No budget set yet - create one via POST /budgets ...", "No appliances
 * registered yet ..."). Those are the most useful thing we can put on screen, so
 * they are surfaced verbatim instead of being replaced with "Something went
 * wrong".
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail;
    if (typeof detail === "string" && detail.length > 0) return detail;
    if (err.code === "ERR_NETWORK") {
      return `Cannot reach the API at ${API_ORIGIN}. Is the backend running?`;
    }
  }
  return fallback;
}
