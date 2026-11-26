"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CreateJourneyForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ticketPrice, setTicketPrice] = useState("150");
  const [departureAt, setDepartureAt] = useState("");
  const [stops, setStops] = useState(["", ""]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateStop(index: number, value: string) {
    setStops(current => current.map((stop, i) => i === index ? value : stop));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/operator/journeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          ticketPrice: Number(ticketPrice),
          departureAt: departureAt ? new Date(departureAt).toISOString() : null,
          stops,
        }),
      });
      const result = await response.json() as { journey?: { id: string }; error?: { message?: string } };
      if (!response.ok || !result.journey?.id) {
        setError(result.error?.message || "Could not create the journey.");
        return;
      }
      router.push(`/operator/journeys/${result.journey.id}`);
      router.refresh();
    } catch {
      setError("Network error. Check that the development server is running and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="create-journey-form" onSubmit={submit}>
      <label>Journey name<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="Bengaluru to Goa" /></label>
      <label>Description <span className="muted">(optional)</span><textarea maxLength={2000} rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Route or trip notes" /></label>
      <div className="create-form-grid">
        <label>Ticket price (tokens)<input required type="number" min="1" step="1" value={ticketPrice} onChange={e => setTicketPrice(e.target.value)} /></label>
        <label>Scheduled departure <span className="muted">(optional)</span><input type="datetime-local" value={departureAt} onChange={e => setDepartureAt(e.target.value)} /></label>
      </div>
      <div className="create-stops-heading"><div><h2>Route stops</h2><p className="muted">Enter stops in travel order. First is origin; last is destination.</p></div><span>{stops.length} / 30</span></div>
      <div className="create-stops-list">
        {stops.map((stop, index) => (
          <div className="create-stop-row" key={index}>
            <span className="create-stop-index">{String(index + 1).padStart(2, "0")}</span>
            <input required maxLength={120} value={stop} onChange={e => updateStop(index, e.target.value)} placeholder={index === 0 ? "Origin" : index === stops.length - 1 ? "Destination" : "Intermediate stop"} aria-label={`Stop ${index + 1}`} />
            <button type="button" className="button button-quiet" disabled={stops.length <= 2} onClick={() => setStops(current => current.filter((_, i) => i !== index))} aria-label={`Remove stop ${index + 1}`}>Remove</button>
          </div>
        ))}
      </div>
      <button type="button" className="button button-secondary add-stop-button" disabled={stops.length >= 30} onClick={() => setStops(current => [...current.slice(0, -1), "", current[current.length - 1] ?? ""])}>+ Add intermediate stop</button>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="create-form-footer"><p className="muted">The journey is created as a draft. Ticket sales will not open automatically.</p><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Creating…" : "Create draft journey"}</button></div>
    </form>
  );
}
