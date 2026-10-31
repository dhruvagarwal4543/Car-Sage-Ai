import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { CarCard } from "../components/CarCard";
import type { Car, Preferences } from "../types";
import { Icon } from "../components/Icon";

interface Msg { role: "user" | "assistant"; text: string; cars?: Car[]; compare?: boolean }
const SUGGESTIONS = ["Family SUV under 15 lakh, diesel", "Automatic petrol hatchback under 8 lakh", "Fuel efficient city car under 10 lakh", "Compare Nexon and Creta", "7 seater under 20 lakh"];
const GREETING = "Hi! Tell me your budget and needs, for example “family SUV under 15 lakh, diesel, automatic”. I can also compare models or summarise one. I use only the car catalogue: ex-showroom prices, no live inventory.";

export function Advisor() {
  const [params, setParams] = useSearchParams();
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", text: GREETING }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const ctx = useRef<Preferences | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const started = useRef("");
  const sending = useRef(false);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || sending.current) return;
    sending.current = true;
    setMsgs((m) => [...m, { role: "user", text: t }]); setInput(""); setBusy(true);
    try {
      const r = await api.assistant(t, ctx.current);
      ctx.current = r.preferences;
      setMsgs((m) => [...m, { role: "assistant", text: r.reply, cars: r.cars, compare: r.intent === "compare" }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: `Sorry, I could not answer that: ${e instanceof Error ? e.message : "unknown error"}` }]);
    } finally { sending.current = false; setBusy(false); }
  };

  const question = params.get("q") ?? "";
  useEffect(() => {                                    // follow links from car details, including browser back/forward
    if (question && question !== started.current && !busy) { started.current = question; void send(question); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, busy]);
  useEffect(() => { end.current?.scrollIntoView?.({ behavior: "smooth", block: "end" }); }, [msgs, busy]);

  const submit = (e: FormEvent) => { e.preventDefault(); void send(input); };
  return (
    <>
      <div className="advisor-heading"><div><p className="eyebrow"><Icon name="spark" size={16} /> YOUR PERSONAL SHORTLIST STARTS HERE</p><h1>AI Car Advisor</h1><p>A little guidance for a big decision.</p></div><button className="btn" disabled={busy} onClick={() => { ctx.current = null; started.current = ""; setMsgs([{ role: "assistant", text: GREETING }]); setInput(""); setParams({}, { replace: true }); }}>New conversation</button></div>
      <p className="advisor-disclosure"><span className="status-dot" /> Grounded in the catalogue · Rule-based, not a language model · No live prices</p>
      <div className="chat" role="log" aria-live="polite" aria-label="Conversation">
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="message-label">{m.role === "assistant" ? <><span className="advisor-avatar"><Icon name="spark" size={15} /></span> CarSage Advisor</> : "You"}</div><p className="bubble">{m.text}</p>
            {m.cars && m.cars.length > 0 && <>
              <div className="grid three">{m.cars.slice(0, m.compare ? 4 : 3).map((c) => <CarCard key={c.id} car={c} compact />)}</div>
              {m.compare && <Link className="btn primary" to={`/compare?ids=${m.cars.map((c) => c.id).join(",")}`}>Open comparison table</Link>}
            </>}
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
