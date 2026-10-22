import { FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { CarCard } from "../components/CarCard";
import type { Car, Preferences } from "../types";

interface Msg { role: "user" | "assistant"; text: string; cars?: Car[] }
const SUGGESTIONS = ["Family SUV under 15 lakh, diesel", "Automatic petrol hatchback under 8 lakh", "Fuel efficient city car under 10 lakh", "Compare Nexon and Creta", "7 seater under 20 lakh"];
const GREETING = "Hi! Tell me your budget and needs, for example “family SUV under 15 lakh, diesel, automatic”. I can also compare models or summarise one. I use only the car catalogue: ex-showroom prices, no live inventory.";

export function Advisor() {
  const [params] = useSearchParams();
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", text: GREETING }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const ctx = useRef<Preferences | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    setMsgs((m) => [...m, { role: "user", text: t }]); setInput(""); setBusy(true);
    try {
      const r = await api.assistant(t, ctx.current);
      if (r.preferences) ctx.current = r.preferences;
      setMsgs((m) => [...m, { role: "assistant", text: r.reply, cars: r.cars }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: `Sorry, I could not answer that: ${e instanceof Error ? e.message : "unknown error"}` }]);
    } finally { setBusy(false); }
  };

  useEffect(() => {                                    // /advisor?q=... starts with a question
    const q = params.get("q");
    if (q && !started.current) { started.current = true; void send(q); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { end.current?.scrollIntoView?.({ behavior: "smooth", block: "end" }); }, [msgs, busy]);

  const submit = (e: FormEvent) => { e.preventDefault(); void send(input); };
  return (
    <>
      <h1>AI Car Advisor</h1>
      <p className="muted">A rule-based assistant over the real catalogue. It explains why cars match, what they give up, and what is missing. It is not a language model and cannot browse the internet.</p>
      <div className="chat" role="log" aria-live="polite" aria-label="Conversation">
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <p className="bubble">{m.text}</p>
            {m.cars && m.cars.length > 0 && <div className="grid three">{m.cars.slice(0, 3).map((c) => <CarCard key={c.id} car={c} compact />)}</div>}
          </div>
        ))}
        {busy && <div className="msg assistant" role="status"><p className="bubble"><span className="spinner" aria-hidden="true" /> Thinking…</p></div>}
        <div ref={end} />
      </div>
      <div className="suggestions" aria-label="Suggested questions">{SUGGESTIONS.map((s) => <button key={s} className="chip-btn" onClick={() => void send(s)} disabled={busy}>{s}</button>)}</div>
      <form className="composer" onSubmit={submit}>
        <label htmlFor="adv-in" className="sr-only">Your question</label>
        <input id="adv-in" value={input} maxLength={500} onChange={(e) => setInput(e.target.value)} placeholder="Describe the car you need…" autoComplete="off" />
        <button className="btn primary" type="submit" disabled={busy || !input.trim()}>Send</button>
      </form>
    </>
  );
}
