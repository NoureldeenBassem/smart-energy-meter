"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap, Wifi, CheckCircle2, XCircle } from "lucide-react";
import { registerDevice, waitForDeviceOnline } from "@/lib/device";

type Step = "intro" | "searching" | "found" | "not_found";

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("intro");

  const handleConnect = async () => {
    setStep("searching");
    try {
      const deviceId = await registerDevice();
      const online = await waitForDeviceOnline(deviceId);
      setStep(online ? "found" : "not_found");
      if (online) {
        setTimeout(() => router.push("/overview"), 1200);
      }
    } catch {
      setStep("not_found");
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        {step === "intro" && (
          <>
            <div className="flex justify-center mb-6">
              <div className="h-20 w-20 rounded-full bg-emerald-950 border border-emerald-800 flex items-center justify-center">
                <Zap className="h-10 w-10 text-emerald-400" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Let's connect your meter</h1>
            <p className="text-sm text-slate-400 mb-8">
              Make sure your Smart Meter is powered on and connected to your
              home Wi-Fi before continuing.
            </p>
            <button
              onClick={handleConnect}
              className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-semibold transition"
            >
              Connect a Device
            </button>
          </>
        )}

        {step === "searching" && (
          <>
            <div className="flex justify-center mb-6">
              <Wifi className="h-16 w-16 text-emerald-400 animate-pulse" />
            </div>
            <h1 className="text-xl font-semibold text-white mb-2">Searching for your meter...</h1>
            <p className="text-sm text-slate-400">This usually takes a few seconds.</p>
          </>
        )}

        {step === "found" && (
          <>
            <div className="flex justify-center mb-6">
              <CheckCircle2 className="h-16 w-16 text-emerald-400" />
            </div>
            <h1 className="text-xl font-semibold text-white">Device found!</h1>
          </>
        )}

        {step === "not_found" && (
          <>
            <div className="flex justify-center mb-6">
              <XCircle className="h-16 w-16 text-slate-500" />
            </div>
            <h1 className="text-xl font-semibold text-white mb-2">No device detected</h1>
            <p className="text-sm text-slate-400 mb-6">
              Make sure it's powered on and connected to Wi-Fi, then try again.
            </p>
            <button
              onClick={handleConnect}
              className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-semibold transition"
            >
              Try Again
            </button>
          </>
        )}
      </div>
    </div>
  );
}