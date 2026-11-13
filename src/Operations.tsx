import { useEffect, useState } from "react";
import type { Language } from "./translations";
import { flightText, text } from "./i18n/operations";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Participant = { id: string; memberId: string | null; name: string; role: "pilot" | "passenger" | "coordinator" | "driver" };
type Flight = { id: string; startsAt: string; site: string; siteId: string; status: "planned" | "done" | "cancelled"; notes: string; revision: number; participants: Participant[]; tandemFlights: Tandem[]; additionalNotes: { id: string; body: string; createdAt: string }[] };
type Site = { id: string; name: string; status: "open" | "closed" | "maintenance"; validatedAt: string | null };
type Equipment = { id: string; identifier: string; designation: string; condition: string; makeModel: string; sizeRating: string; acquiredOn: string | null; lastInspectionOn: string | null; reserveRepackedOn: string | null };
type Loan = { id: string; identifier: string; borrowerName: string; loanedOn: string; returnedOn: string | null; conditionOut: string; conditionIn: string | null };

type Tandem = { pilotId: string; passengerId: string; durationMinutes: number | null; passengerFormCompleted: boolean; receiptReference: string | null; observations: string };
const initEquipment = { identifier: "", designation: "", makeModel: "", sizeRating: "", acquiredOn: null as string | null,
  lastInspectionOn: null as string | null, reserveRepackedOn: null as string | null, condition: "" };
export function Operations({ api, language, members, onChange, specialAdmin }: { api: Api; language: Language; members: { id: string; firstName: string; lastName: string }[]; onChange: () => void; specialAdmin: boolean }) {
  const t = text[language];
  const ft = flightText[language];
  const [flights, setFlights] = useState<Flight[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [status, setStatus] = useState<Flight["status"]>("planned");
  const [extraNotes, setExtraNotes] = useState<Record<string, string>>({});
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [error, setError] = useState<"uncertain" | "refresh" | null>(null);
  const [busy, setBusy] = useState(false);
  const [site, setSite] = useState("");
  const [editingFlight, setEditingFlight] = useState<{ id: string; revision: number } | null>(null);
  const [localDate, setLocalDate] = useState("");
  const [offset, setOffset] = useState("+01:00");
  const [notes, setNotes] = useState("");
  const [people, setPeople] = useState<Participant[]>([]);
  const [tandems, setTandems] = useState<Tandem[]>([]);
  const [gear, setGear] = useState(initEquipment);
  const [editingGear, setEditingGear] = useState<string | null>(null);
  const [loan, setLoan] = useState({ equipmentId: "", borrowerName: "", memberId: null as string | null, loanedOn: "", expectedReturnOn: null as string | null, conditionOut: "" });
  const [returns, setReturns] = useState<Record<string, { returnedOn: string; conditionIn: string }>>({});

  async function refresh() {
    const [f, e, l, s] = await Promise.all([api<Flight[]>("/api/flights"), api<Equipment[]>("/api/equipment"), api<Loan[]>("/api/loans"), api<Site[]>("/api/sites")]);
    setFlights(f); setEquipment(e); setLoans(l); setSites(s);
  }
  useEffect(() => {
    let active = true;
    Promise.all([api<Flight[]>("/api/flights"), api<Equipment[]>("/api/equipment"), api<Loan[]>("/api/loans"), api<Site[]>("/api/sites")])
      .then(([f, e, l, s]) => { if (active) { setFlights(f); setEquipment(e); setLoans(l); setSites(s); } })
      .catch((e: unknown) => { console.error("Loading operations failed", e); if (active) setError("uncertain"); });
    return () => { active = false; };
  }, [api]);
  async function submit(path: string, body: unknown, reset: () => void, method: "POST" | "PUT" = "POST") {
    setBusy(true);
    let saved = false;
    try { await api(path, { method, body: JSON.stringify(body) }); saved = true; reset(); onChange(); await refresh(); setError(null); }
    catch (e) { console.error("Operation could not be confirmed", e); setError(saved ? "refresh" : "uncertain"); }
    finally { setBusy(false); }
  }
  const dateValue = (value: string | null) => value ? String(value).slice(0, 10) : "";

  return <section id="operations">
    {error && <p role="alert" className="error">{error === "refresh" ? t.refreshFailed : t.failed}</p>}
    {busy && <p>{t.loading}</p>}
    <h2>{t.flights}</h2>
    <form id="flight-form" className="form" onSubmit={(event) => {
      event.preventDefault();
      // Flight revisions keep prior participant rows, so edited participants need new IDs.
      const ids = new Map(people.map((p) => [p.id, editingFlight ? crypto.randomUUID() : p.id]));
      const body = { startsAt: `${localDate}:00${offset}`, siteId: site, status, notes,
        participants: people.map((p) => ({ ...p, id: ids.get(p.id) ?? p.id })),
        tandemFlights: tandems.map((pair) => ({ ...pair, pilotId: ids.get(pair.pilotId) ?? pair.pilotId, passengerId: ids.get(pair.passengerId) ?? pair.passengerId })),
      };
      void submit(editingFlight ? `/api/flights/${editingFlight.id}` : "/api/flights",
        editingFlight ? { ...body, expectedRevision: editingFlight.revision } : body,
        () => { setSite(""); setStatus("planned"); setLocalDate(""); setNotes(""); setPeople([]); setTandems([]); setEditingFlight(null); }, editingFlight ? "PUT" : "POST");
    }}>
      <label>{t.site}<select required value={site} onChange={(e) => setSite(e.target.value)}>
        <option value="">{t.choose}</option>{sites.filter((s) => s.status === "open" && s.validatedAt).map((s) => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
      <p>{ft.eligible}</p>
      <label>{ft.status}<select value={status} disabled={!editingFlight} onChange={(e) => setStatus(e.target.value as Flight["status"])}>
        <option value="planned">{ft.planned}</option><option value="done">{ft.done}</option><option value="cancelled">{ft.cancelled}</option></select></label>
      <label>{t.date}<input required type="datetime-local" value={localDate} onChange={(e) => {
        const value = e.target.value;
        setLocalDate(value);
        if (value) {
          const part = new Intl.DateTimeFormat("en", { timeZone: "Africa/Casablanca", timeZoneName: "shortOffset" })
            .formatToParts(new Date(`${value}:00Z`)).find((p) => p.type === "timeZoneName")?.value;
          if (part === "GMT") setOffset("+00:00");
          if (part === "GMT+1") setOffset("+01:00");
        }
      }} /></label>
      <label>{t.offset}<select value={offset} onChange={(e) => setOffset(e.target.value)}><option value="+01:00">UTC+01:00</option><option value="+00:00">UTC+00:00</option></select></label>
      <label>{t.notes}<input maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <fieldset><legend>{t.participants}</legend>
        {people.map((p, index) => <div key={p.id} className="inline-fields">
          <label>{t.member}<select value={p.memberId ?? ""} onChange={(e) => {
            const member = members.find((m) => m.id === e.target.value);
            setPeople(people.map((x, i) => i === index ? { ...x, memberId: member?.id ?? null, name: member ? `${member.firstName} ${member.lastName}` : x.name } : x));
          }}><option value="">{t.nonmember}</option>{members.map((m) => <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>)}</select></label>
          <label>{t.name}<input required value={p.name} onChange={(e) => setPeople(people.map((x, i) => i === index ? { ...x, name: e.target.value } : x))} /></label>
          <label>{t.role}<select value={p.role} onChange={(e) => setPeople(people.map((x, i) => i === index ? { ...x, role: e.target.value as Participant["role"] } : x))}>
            <option value="pilot">{t.pilot}</option><option value="passenger">{t.passenger}</option><option value="coordinator">{t.coordinator}</option><option value="driver">{t.driver}</option>
          </select></label>
          <button type="button" onClick={() => { setPeople(people.filter((x) => x.id !== p.id)); setTandems(tandems.filter((x) => x.pilotId !== p.id && x.passengerId !== p.id)); }}>{t.remove}</button>
        </div>)}
        <button type="button" onClick={() => setPeople([...people, { id: crypto.randomUUID(), memberId: null, name: "", role: "pilot" }])}>{t.addPerson}</button>
      </fieldset>
      <fieldset><legend>{t.tandem}</legend>
        {tandems.map((item, index) => <div className="inline-fields" key={index}>
          <label>{t.pilot}<select required value={item.pilotId} onChange={(e) => setTandems(tandems.map((x, i) => i === index ? { ...x, pilotId: e.target.value } : x))}>
            <option value="">{t.choose}</option>{people.filter((p) => p.role === "pilot").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>{t.passenger}<select required value={item.passengerId} onChange={(e) => setTandems(tandems.map((x, i) => i === index ? { ...x, passengerId: e.target.value } : x))}>
            <option value="">{t.choose}</option>{people.filter((p) => p.role === "passenger").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>{t.duration}<input type="number" min="0" max="10000" value={item.durationMinutes ?? ""} onChange={(e) => setTandems(tandems.map((x, i) => i === index ? { ...x, durationMinutes: e.target.value ? Number(e.target.value) : null } : x))} /></label>
          <label>{t.receipt}<input value={item.receiptReference ?? ""} onChange={(e) => setTandems(tandems.map((x, i) => i === index ? { ...x, receiptReference: e.target.value || null } : x))} /></label>
          <label className="checkbox"><input type="checkbox" checked={item.passengerFormCompleted} onChange={(e) => setTandems(tandems.map((x, i) => i === index ? { ...x, passengerFormCompleted: e.target.checked } : x))} />{t.form}</label>
          <button type="button" onClick={() => setTandems(tandems.filter((_, i) => i !== index))}>{t.remove}</button>
        </div>)}
        <button type="button" onClick={() => setTandems([...tandems, { pilotId: "", passengerId: "", durationMinutes: null, passengerFormCompleted: false, receiptReference: null, observations: "" }])}>{t.addTandem}</button>
      </fieldset>
      <div><button disabled={busy}>{t.save}</button>{editingFlight && <button type="button" onClick={() => { setEditingFlight(null); setSite(""); setLocalDate(""); setNotes(""); setPeople([]); setTandems([]); }}>{t.cancel}</button>}</div>
    </form>
    <ul className="member-list">{flights.map((f) => <li key={f.id}><div>
      <div><strong>{t.site}:</strong> <bdi>{f.site}</bdi></div>
      <div><strong>{ft.status}:</strong> {ft[f.status]}</div>
      <div><strong>{t.date}:</strong> {new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Casablanca" }).format(new Date(f.startsAt))}</div>
      <div><strong>{t.participants}:</strong>{f.participants.map((p) => <div className="record-related" key={p.id}><strong>{t.role}:</strong> {t[p.role]} · <strong>{t.name}:</strong> <bdi>{p.name}</bdi></div>)}</div>
      {f.tandemFlights.length > 0 && <div><strong>{t.tandem}:</strong>{f.tandemFlights.map((pair, i) => <div className="record-related" key={i}><strong>{t.pilot}:</strong> <bdi>{f.participants.find((p) => p.id === pair.pilotId)?.name}</bdi> · <strong>{t.passenger}:</strong> <bdi>{f.participants.find((p) => p.id === pair.passengerId)?.name}</bdi> · <strong>{t.duration}:</strong> {pair.durationMinutes ?? "—"} · <strong>{t.form}:</strong> {pair.passengerFormCompleted ? "✓" : "—"}</div>)}</div>}
      <div><strong>{t.notes}:</strong> {f.notes}</div>
      {f.additionalNotes.map((note) => <div className="record-related" key={note.id}><strong>{t.date}:</strong> {new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Casablanca" }).format(new Date(note.createdAt))} · <strong>{t.notes}:</strong> {note.body}</div>)}
      {f.status !== "planned" && <form onSubmit={(event) => { event.preventDefault(); void submit(`/api/flights/${f.id}/notes`, { body: extraNotes[f.id] }, () => setExtraNotes({ ...extraNotes, [f.id]: "" })); }}>
        <label>{ft.append}<input required maxLength={4000} value={extraNotes[f.id] ?? ""} onChange={(e) => setExtraNotes({ ...extraNotes, [f.id]: e.target.value })} /></label>
        <button disabled={busy}>{ft.append}</button></form>}
    </div>{f.status === "planned" && <button type="button" onClick={() => {
      const instant = new Date(f.startsAt);
      const fields = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Casablanca", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset" }).formatToParts(instant);
      const get = (type: Intl.DateTimeFormatPartTypes) => fields.find((part) => part.type === type)?.value;
      setLocalDate(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`);
      setOffset(get("timeZoneName") === "GMT" ? "+00:00" : "+01:00");
      setSite(f.siteId); setStatus(f.status); setNotes(f.notes);
      setPeople(f.participants.map((p) => ({ id: p.id, memberId: p.memberId, name: p.name, role: p.role })));
      setTandems(f.tandemFlights.map((pair) => ({ pilotId: pair.pilotId, passengerId: pair.passengerId, durationMinutes: pair.durationMinutes, passengerFormCompleted: pair.passengerFormCompleted, receiptReference: pair.receiptReference, observations: pair.observations })));
      setEditingFlight({ id: f.id, revision: f.revision });
      document.getElementById("flight-form")?.scrollIntoView();
    }}>{t.edit}</button>}</li>)}</ul>
    <h2>{t.gear}</h2>
    <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(editingGear ? `/api/equipment/${editingGear}` : "/api/equipment", gear, () => { setGear(initEquipment); setEditingGear(null); }, editingGear ? "PUT" : "POST"); }}>
      {(["identifier", "designation", "makeModel", "sizeRating", "condition"] as const).map((field) => <label key={field}>{field === "makeModel" ? t.model : field === "sizeRating" ? t.size : t[field]}
        <input required={field === "identifier" || field === "designation" || field === "condition"} value={gear[field]} onChange={(e) => setGear({ ...gear, [field]: e.target.value })} /></label>)}
      {(["acquiredOn", "lastInspectionOn", "reserveRepackedOn"] as const).map((field) => <label key={field}>{field === "acquiredOn" ? t.acquired : field === "lastInspectionOn" ? t.inspection : t.repack}
        <input type="date" value={gear[field] ?? ""} onChange={(e) => setGear({ ...gear, [field]: e.target.value || null })} /></label>)}
      <div><button disabled={busy}>{t.save}</button>{editingGear && <button type="button" onClick={() => { setGear(initEquipment); setEditingGear(null); }}>{t.cancel}</button>}</div>
    </form>
    <ul className="member-list">{equipment.map((item) => <li key={item.id}><div>
      <div><strong>{t.identifier}:</strong> <bdi>{item.identifier}</bdi></div>
      <div><strong>{t.designation}:</strong> <bdi>{item.designation}</bdi></div>
      <div><strong>{t.condition}:</strong> {item.condition}</div></div>
      <div>
      <button onClick={() => { setEditingGear(item.id); setGear({ identifier: item.identifier, designation: item.designation, makeModel: item.makeModel, sizeRating: item.sizeRating, condition: item.condition, acquiredOn: dateValue(item.acquiredOn) || null, lastInspectionOn: dateValue(item.lastInspectionOn) || null, reserveRepackedOn: dateValue(item.reserveRepackedOn) || null }); }}>{t.edit}</button>
      {specialAdmin && <button disabled={busy} onClick={() => { if (window.confirm(ft.confirm)) void submit(`/api/equipment/${item.id}/archive`, {}, () => {}); }}>{ft.archive}</button>}</div>
    </li>)}</ul>
    <h2>{t.loans}</h2>
    <form className="form" onSubmit={(e) => { e.preventDefault(); void submit("/api/loans", loan, () => setLoan({ equipmentId: "", borrowerName: "", memberId: null, loanedOn: "", expectedReturnOn: null, conditionOut: "" })); }}>
      <label>{t.gear}<select required value={loan.equipmentId} onChange={(e) => setLoan({ ...loan, equipmentId: e.target.value })}>
        <option value="">{t.choose}</option>{equipment.map((item) => <option key={item.id} value={item.id}>{item.identifier} — {item.designation}</option>)}</select></label>
      <label>{t.borrower}<input required value={loan.borrowerName} onChange={(e) => setLoan({ ...loan, borrowerName: e.target.value })} /></label>
      <label>{t.member}<select value={loan.memberId ?? ""} onChange={(e) => {
        const member = members.find((m) => m.id === e.target.value);
        setLoan({ ...loan, memberId: member?.id ?? null, borrowerName: member ? `${member.firstName} ${member.lastName}` : loan.borrowerName });
      }}><option value="">{t.nonmember}</option>{members.map((m) => <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>)}</select></label>
      <label>{t.loaned}<input required type="date" value={loan.loanedOn} onChange={(e) => setLoan({ ...loan, loanedOn: e.target.value })} /></label>
      <label>{t.expected}<input type="date" value={loan.expectedReturnOn ?? ""} onChange={(e) => setLoan({ ...loan, expectedReturnOn: e.target.value || null })} /></label>
      <label>{t.condition}<input required value={loan.conditionOut} onChange={(e) => setLoan({ ...loan, conditionOut: e.target.value })} /></label>
      <div><button disabled={busy}>{t.save}</button></div>
    </form>
    <ul className="member-list">{loans.map((item) => <li key={item.id}><div>
      <div><strong>{t.identifier}:</strong> <bdi>{item.identifier}</bdi></div>
      <div><strong>{t.borrower}:</strong> <bdi>{item.borrowerName}</bdi></div>
      <div><strong>{t.loaned}:</strong> {dateValue(item.loanedOn)}</div>
      {item.returnedOn && <div className="record-related"><strong>{t.returnDate}:</strong> {dateValue(item.returnedOn)} · <strong>{t.returnCondition}:</strong> {item.conditionIn}</div>}
      {!item.returnedOn && <form className="inline-fields" onSubmit={(e) => { e.preventDefault(); void submit(`/api/loans/${item.id}/return`, returns[item.id], () => setReturns((r) => { const copy = { ...r }; delete copy[item.id]; return copy; })); }}>
        <label>{t.returnDate}<input required type="date" value={returns[item.id]?.returnedOn ?? ""} onChange={(e) => setReturns({ ...returns, [item.id]: { returnedOn: e.target.value, conditionIn: returns[item.id]?.conditionIn ?? "" } })} /></label>
        <label>{t.returnCondition}<input required value={returns[item.id]?.conditionIn ?? ""} onChange={(e) => setReturns({ ...returns, [item.id]: { returnedOn: returns[item.id]?.returnedOn ?? "", conditionIn: e.target.value } })} /></label>
        <button disabled={busy}>{t.return}</button>
      </form>}
    </div></li>)}</ul>
  </section>;
}
