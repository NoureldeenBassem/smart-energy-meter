"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Zap, Activity, DollarSign, TrendingUp, Power, LogOut, RefreshCw,
} from "lucide-react";
import { apiClient } from "@/lib/api";

interface TelemetryDashboard {
  device_id: string;
  voltage: number;
  current: number;
  active_power: number;
  power_factor: number;
  today_energy_kwh: number;
  month_energy_kwh: number;
  last_updated: string;
}

interface Allocation {
  appliance_id: string;
  name: string;
  rated_power_w: number;
  priority: string;
  recommended_runtime_hours: number;
  status: string;
  action_note: string;
}

interface RecommendationDashboard {
  active_mode: string;
  target_bill_egp: number;
  days_remaining_in_month: number;
  daily_kwh_allowance: number;
  allocations: Allocation[];
}

interface Prediction {
  predicted_kwh: number;
  confidence_low: number;
  confidence_high: number;
  model_version: string;
  days_remaining_in_cycle: number;
  predicted_bill_egp: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);
  const [telemetry, setTelemetry] = useState<TelemetryDashboard | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationDashboard | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [mode, setMode] = useState<"normal" | "eco" | "heavy" | "away">("normal");
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async (id: string, currentMode: string) => {
    try {
      const [onlineRes, telemetryRes, recRes, predRes] = await Promise.allSettled([
        apiClient.get(`/telemetry/is-online/${id}`),
        apiClient.get(`/telemetry/dashboard/${id}`),
        apiClient.get(`/budgets/recommendations/${id}?mode=${currentMode}`),
        apiClient.get(`/predictions/${id}`),
      ]);

      if (onlineRes.status === "fulfilled") setIsOnline(onlineRes.value.data.is_online);
      if (telemetryRes.status === "fulfilled") setTelemetry(telemetryRes.value.data);
      if (recRes.status === "fulfilled") setRecommendations(recRes.value.data);
      if (predRes.status === "fulfilled") setPrediction(predRes.value.data);

      // No telemetry yet is a valid state (device just paired), not an error
      if (telemetryRes.status === "rejected") setTelemetry(null);
    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    const storedDeviceId = localStorage.getItem("device_id");

    if (!token) {
      router.replace("/auth");
      return;
    }
    if (!storedDeviceId) {
      router.replace("/onboarding");
      return;
    }

    setDeviceId(storedDeviceId);
    fetchAll(storedDeviceId, mode);

    const interval = setInterval(() => fetchAll(storedDeviceId, mode), 5000);
    return () => clearInterval(interval);
  }, [router, fetchAll, mode]);

  const handleLogout = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("device_id");
    router.replace("/auth");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <RefreshCw className="h-8 w-8 text-emerald-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      {/* Header */}
      <header className="flex justify-between items-center pb-6 border-b border-slate-800 mb-6">
        <div className="flex items-center gap-3">
          <Zap className="h-7 w-7 text-emerald-400" />
          <h1 className="text-xl font-bold">Smart Energy Meter</h1>
        </div>
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${
              isOnline
                ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                : "bg-rose-950 text-rose-400 border border-rose-800"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isOnline ? "bg-emerald-400 animate-pulse" : "bg-rose-400"
              }`}
            />
            {isOnline ? "Live" : "Offline"}
          </div>
          <button
            onClick={handleLogout}
            className="p-2 text-slate-400 hover:text-white transition"
            title="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {!telemetry && (
        <div className="mb-6 p-4 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-400">
          No telemetry data yet — waiting for your first readings to arrive.
        </div>
      )}

      {/* Top metric cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex justify-between items-start text-slate-400 mb-3">
            <span className="text-xs uppercase tracking-wider font-semibold">Active Power</span>
            <Activity className="h-5 w-5 text-emerald-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white">
              {telemetry?.active_power?.toFixed(0) ?? "—"}
            </span>
            <span className="text-slate-400 text-sm">W</span>
          </div>
          <div className="mt-2 flex justify-between text-xs text-slate-400 font-mono">
            <span>{telemetry?.voltage ?? "—"} V</span>
            <span>{telemetry?.current ?? "—"} A</span>
            <span>PF {telemetry?.power_factor ?? "—"}</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex justify-between items-start text-slate-400 mb-3">
            <span className="text-xs uppercase tracking-wider font-semibold">Today</span>
            <Zap className="h-5 w-5 text-sky-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white">
              {telemetry?.today_energy_kwh?.toFixed(2) ?? "0.00"}
            </span>
            <span className="text-slate-400 text-sm">kWh</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex justify-between items-start text-slate-400 mb-3">
            <span className="text-xs uppercase tracking-wider font-semibold">Predicted Bill</span>
            <DollarSign className="h-5 w-5 text-amber-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-amber-400">
              {prediction?.predicted_bill_egp?.toFixed(0) ?? "—"}
            </span>
            <span className="text-slate-400 text-sm">EGP</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {prediction
              ? `${prediction.predicted_kwh} kWh · ${prediction.days_remaining_in_cycle}d left`
              : "Calculating..."}
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex justify-between items-start text-slate-400 mb-3">
            <span className="text-xs uppercase tracking-wider font-semibold">Daily Budget</span>
            <TrendingUp className="h-5 w-5 text-indigo-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-white">
              {recommendations?.daily_kwh_allowance?.toFixed(1) ?? "—"}
            </span>
            <span className="text-slate-400 text-sm">kWh/day</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Target: {recommendations?.target_bill_egp ?? "—"} EGP
          </p>
        </div>
      </div>

      {/* Mode presets + recommendations */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Power className="h-4 w-4 text-indigo-400" /> Appliance Recommendations
          </h2>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-5">
          {(["normal", "eco", "heavy", "away"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`py-1.5 rounded-lg text-xs font-semibold capitalize border transition ${
                mode === m
                  ? "bg-emerald-600 text-white border-emerald-500"
                  : "bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-600"
              }`}
            >
              {m === "normal" ? "Home" : m === "heavy" ? "Guests" : m}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {!recommendations || recommendations.allocations.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">
              No appliances yet.
            </p>
          ) : (
            recommendations.allocations.map((a) => (
              <div
                key={a.appliance_id}
                className={`p-3.5 rounded-lg border text-sm flex flex-col gap-1 ${
                  a.status === "optimal"
                    ? "bg-slate-950/60 border-slate-800"
                    : a.status === "constrained"
                    ? "bg-amber-950/20 border-amber-900/50 text-amber-200"
                    : a.status === "away"
                    ? "bg-slate-950/40 border-slate-800 text-slate-500"
                    : "bg-rose-950/20 border-rose-900/50 text-rose-200"
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-white">{a.name}</span>
                  <span className="text-xs uppercase font-bold tracking-wider">{a.status}</span>
                </div>
                <div className="text-xs text-slate-400 flex justify-between">
                  <span>{a.rated_power_w} W · {a.priority}</span>
                  <span>{a.recommended_runtime_hours} hrs</span>
                </div>
                <p className="text-xs text-slate-400">{a.action_note}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}