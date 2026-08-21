"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";

export default function RootPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    const deviceId = localStorage.getItem("device_id");

    if (!token) {
      router.replace("/auth");
    } else if (!deviceId) {
      router.replace("/onboarding");
    } else {
      router.replace("/dashboard");
    }
    setChecking(false);
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <Zap className="h-8 w-8 text-emerald-400 animate-pulse" />
    </div>
  );
}