"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refresh server-rendered operator metrics after passenger/operator mutations. */
export function OperatorDashboardAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const interval = window.setInterval(refresh, 5_000);
    return () => window.clearInterval(interval);
  }, [router]);

  return null;
}
