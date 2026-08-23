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
      router.replace("/overview");
    }
    setChecking(false);
  }, [router]);

  return (
    <div className="grid min-h-screen place-items-center ">
      <Zap className="h-8 w-8 animate-pulse text-accent-ink" aria-hidden />
    </div>
  );
}