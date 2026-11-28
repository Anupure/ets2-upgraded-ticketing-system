"use client";

import { useEffect, useState } from "react";

export function WalletBadge({ initialBalance }: { initialBalance: string | null }) {
  const [balance, setBalance] = useState<number | null>(initialBalance === null ? null : Number(initialBalance));

  useEffect(() => {
    function onBalanceUpdated(event: Event) {
      const detail = (event as CustomEvent<{ balance: number }>).detail;
      if (!detail || !Number.isFinite(detail.balance)) return;
      const from = balance ?? detail.balance;
      const to = Math.max(0, detail.balance);
      const startedAt = performance.now();
      const duration = 850;
      let frame = 0;
      const animate = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        setBalance(Math.round(from + (to - from) * eased));
        if (progress < 1) frame = requestAnimationFrame(animate);
      };
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(animate);
    }
    window.addEventListener("wallet:balance-updated", onBalanceUpdated);
    return () => window.removeEventListener("wallet:balance-updated", onBalanceUpdated);
  }, [balance]);

  return (
    <span className="wallet-badge" tabIndex={0} aria-label={balance === null ? "RPM coin balance unavailable" : `${balance} available RPM coins`}>
      <span className="wallet-coin" aria-hidden="true">R</span>
      <span className="wallet-badge-value">{balance === null ? "—" : balance.toLocaleString("en-IN")}</span>
      <span className="wallet-tooltip" role="tooltip">{balance === null ? "RPM coin balance unavailable" : `${balance.toLocaleString("en-IN")} available RPM coins`}</span>
    </span>
  );
}
