"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap, Wifi, CheckCircle2, XCircle } from "lucide-react";

import SceneBackground from "@/components/SceneBackground";
import { registerDevice, waitForDeviceOnline } from "@/lib/device";

/**
 * Device pairing.
 *
 * The flow is unchanged: register the device to this account, then poll
 * /telemetry/is-online until it reports a recent reading or the wait times out.
 *
 * The "not found" copy is deliberately specific about what offline MEANS here —
 * the device row exists either way, so the only thing being waited on is a
 * reading fresh enough to count as live. Telling someone to check their Wi-Fi
 * when the real cause is that nothing is publishing would send them the wrong way.
 */

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
    <div className="grid min-h-screen place-items-center p-6">
      <SceneBackground live watts={820} kwhCycle={412} savingPct={12} />
      <div className="w-full max-w-md">
        <div className="rounded-[var(--r-card)] glass p-8 text-center ">
          {step === "intro" && (
            <>
              <span className="mx-auto mb-6 grid h-20 w-20 place-items-center rounded-full bg-accent">
                <Zap className="h-9 w-9 text-ink-panel" aria-hidden />
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-ink">
                Let&apos;s connect your meter
              </h1>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-3">
                Make sure your smart meter is powered on and publishing before you
                continue.
              </p>
              <button
                onClick={handleConnect}
                className="mt-7 w-full rounded-[var(--r-pill)] bg-ink-panel py-3.5 text-sm font-bold text-on-dark transition hover:opacity-90"
              >
                Connect a Device
              </button>
            </>
          )}

          {step === "searching" && (
            <>
              <span className="mx-auto mb-6 grid h-20 w-20 place-items-center rounded-full bg-accent-wash">
                <Wifi className="h-9 w-9 animate-pulse text-accent-ink" aria-hidden />
              </span>
              <h1 className="text-xl font-bold tracking-tight text-ink">
                Searching for your meter...
              </h1>
              <p className="mt-2 text-sm text-ink-3">
                This usually takes a few seconds.
              </p>
            </>
          )}

          {step === "found" && (
            <>
              <span className="mx-auto mb-6 grid h-20 w-20 place-items-center rounded-full bg-accent">
                <CheckCircle2 className="h-9 w-9 text-ink-panel" aria-hidden />
              </span>
              <h1 className="text-xl font-bold tracking-tight text-ink">Device found</h1>
              <p className="mt-2 text-sm text-ink-3">Taking you to your dashboard.</p>
            </>
          )}

          {step === "not_found" && (
            <>
              <span className="mx-auto mb-6 grid h-20 w-20 place-items-center rounded-full bg-white/50">
                <XCircle className="h-9 w-9 text-ink-3" aria-hidden />
              </span>
              <h1 className="text-xl font-bold tracking-tight text-ink">
                No recent readings
              </h1>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-3">
                The device is registered to your account, but nothing has published a
                reading recently. Start the meter — or the simulator and the MQTT worker —
                and try again.
              </p>
              <button
                onClick={handleConnect}
                className="mt-7 w-full rounded-[var(--r-pill)] bg-ink-panel py-3.5 text-sm font-bold text-on-dark transition hover:opacity-90"
              >
                Try Again
              </button>
              <button
                onClick={() => router.push("/overview")}
                className="mt-2.5 w-full rounded-[var(--r-pill)] py-2.5 text-sm font-semibold text-ink-3 transition hover:text-ink"
              >
                Continue to the dashboard anyway
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
