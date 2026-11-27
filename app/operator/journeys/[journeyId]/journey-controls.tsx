"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Stop = { id: string; name: string; sequence: number; status: string };
type Props = { journeyId: string; status: string; stops: Stop[] };

export function JourneyControls({ journeyId, status, stops }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function act(key: string, path: string) {
    setBusy(key);
    setError("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? result.message ?? "Action failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  const firstUpcoming = stops.find(stop => stop.status === "UPCOMING");
  const arrived = stops.find(stop => stop.status === "ARRIVED");
  const boarding = stops.find(stop => stop.status === "BOARDING_OPEN");
  const finalStop = stops[stops.length - 1];
  const button = (key: string, label: string, path: string) => (
    <button className="button button-primary" disabled={busy !== null} onClick={() => act(key, path)}>
      {busy === key ? "Working…" : label}
    </button>
  );

  return (
    <section className="journey-controls">
      <h2>Journey controls</h2>
      <div className="operator-actions">
        {status === "DRAFT" || status === "SCHEDULED" ? button("open", "Open ticket sales", `/api/operator/journeys/${journeyId}/open-booking`) : null}
        {status === "BOOKING_OPEN" ? button("close", "Close ticket sales", `/api/operator/journeys/${journeyId}/close-booking`) : null}
        {status === "PAUSED" && !arrived && firstUpcoming ? button("arrive", `Arrive at ${firstUpcoming.name}`, `/api/operator/journeys/${journeyId}/stops/${firstUpcoming.id}/arrive`) : null}
        {status === "IN_PROGRESS" && firstUpcoming ? button("arrive", `Arrive at ${firstUpcoming.name}`, `/api/operator/journeys/${journeyId}/stops/${firstUpcoming.id}/arrive`) : null}
        {status === "PAUSED" && arrived ? button("boarding", "Open boarding", `/api/operator/journeys/${journeyId}/stops/${arrived.id}/open-boarding`) : null}
        {status === "BOARDING" && boarding ? button("depart", `Depart ${boarding.name}`, `/api/operator/journeys/${journeyId}/stops/${boarding.id}/depart`) : null}
        {status === "PAUSED" && finalStop?.status === "ARRIVED" ? button("complete", "Complete journey", `/api/operator/journeys/${journeyId}/complete`) : null}
        {status === "COMPLETED" ? <p className="muted">This journey is complete.</p> : null}
      </div>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      <p className="muted">Boarding, disembarkation and no-show actions are managed from each stop manifest.</p>
    </section>
  );
}
