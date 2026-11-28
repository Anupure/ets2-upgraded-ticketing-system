"use client";

import { useEffect, useRef, useState } from "react";

export function WalletBadge({ initialBalance }: { initialBalance: string | null }) {
  const [balance, setBalance] = useState<number | null>(initialBalance === null ? null : Number(initialBalance));
  const balanceRef = useRef<number | null>(initialBalance === null ? null : Number(initialBalance));
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    function onBalanceUpdated(event: Event) {
      const detail = (event as CustomEvent<{ balance: number }>).detail;
      if (!detail || !Number.isFinite(detail.balance)) return;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      const from = balanceRef.current ?? detail.balance;
      const to = Math.max(0, detail.balance);
      const startedAt = performance.now();
      const duration = 850;
      const animate = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        const next = Math.round(from + (to - from) * eased);
        setBalance(next);
        if (progress < 1) frameRef.current = requestAnimationFrame(animate);
        else {
          balanceRef.current = to;
          frameRef.current = null;
        }
      };
      frameRef.current = requestAnimationFrame(animate);
    }
    window.addEventListener("wallet:balance-updated", onBalanceUpdated);
    return () => {
      window.removeEventListener("wallet:balance-updated", onBalanceUpdated);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return (
    <span className="wallet-badge" tabIndex={0} aria-label={balance === null ? "RPM coin balance unavailable" : `${balance} available RPM coins`}>
      <span className="wallet-coin" aria-hidden="true">R</span>
      <span className="wallet-badge-value">{balance === null ? "—" : balance.toLocaleString("en-IN")}</span>
      <span className="wallet-tooltip" role="tooltip">{balance === null ? "RPM coin balance unavailable" : `${balance.toLocaleString("en-IN")} available RPM coins`}</span>
    </span>
  );
}
