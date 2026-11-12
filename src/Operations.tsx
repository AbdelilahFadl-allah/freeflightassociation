import { useEffect, useState } from "react";
import type { Language } from "./translations";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Participant = { id: string; memberId: string | null; name: string; role: "pilot" | "passenger" | "coordinator" | "driver" };
type Flight = { id: string; startsAt: string; site: string; siteId: string; status: "planned" | "done" | "cancelled"; notes: string; revision: number; participants: Participant[]; tandemFlights: Tandem[]; additionalNotes: { id: string; body: string; createdAt: string }[] };
type Site = { id: string; name: string; status: "open" | "closed" | "maintenance"; validatedAt: string | null };
type Equipment = { id: string; identifier: string; designation: string; condition: string; makeModel: string; sizeRating: string; acquiredOn: string | null; lastInspectionOn: string | null; reserveRepackedOn: string | null };
type Loan = { id: string; identifier: string; borrowerName: string; loanedOn: string; returnedOn: string | null; conditionOut: string; conditionIn: string | null };

const text = {
  en: { flights: "Flight activities", gear: "Flying equipment", loans: "Equipment loans", site: "Site",
    date: "Local date and time", offset: "Casablanca UTC offset on this date", notes: "Notes", participants: "Participants",
    addPerson: "Add participant", name: "Name", role: "Role", pilot: "Pilot", passenger: "Passenger",
    coordinator: "Coordinator", driver: "Driver", remove: "Remove", save: "Save", identifier: "Identifier",
    designation: "Designation", condition: "Condition", model: "Make / model", size: "Size / load rating",
    acquired: "Acquisition date", inspection: "Last inspection", repack: "Last reserve repack",
    borrower: "Borrower", loaned: "Loan date", expected: "Expected return", returnDate: "Return date",
    returnCondition: "Condition on return", return: "Record return", loading: "Loading…",
    failed: "The operation could not be confirmed. Check the records before retrying.", refreshFailed: "The operation was saved, but the display could not refresh. Do not repeat it; reload the page.", noRecords: "No records yet.",
    tandem: "Tandem flights", addTandem: "Add tandem flight", duration: "Duration (minutes)", form: "Passenger paper form completed",
    receipt: "Receipt reference", choose: "Choose", print: "Print", edit: "Edit", cancel: "Cancel", member: "Association member (optional)", nonmember: "Not linked to a member", },
  fr: { flights: "Activités de vol", gear: "Matériel de vol", loans: "Prêts de matériel", site: "Site",
    date: "Date et heure locales", offset: "Décalage UTC de Casablanca à cette date", notes: "Observations", participants: "Participants",
    addPerson: "Ajouter un participant", name: "Nom", role: "Rôle", pilot: "Pilote", passenger: "Passager",
    coordinator: "Coordinateur", driver: "Chauffeur", remove: "Retirer", save: "Enregistrer", identifier: "Identifiant",
    designation: "Désignation", condition: "État", model: "Marque / modèle", size: "Taille / charge",
    acquired: "Date d'acquisition", inspection: "Dernier contrôle", repack: "Dernier repliage du secours",
    borrower: "Emprunteur", loaned: "Date de prêt", expected: "Retour prévu", returnDate: "Date de retour",
    returnCondition: "État au retour", return: "Enregistrer le retour", loading: "Chargement…",
    failed: "L'opération n'a pas pu être confirmée. Vérifiez les enregistrements avant de réessayer.", refreshFailed: "L'opération a été enregistrée mais l'affichage n'a pas pu être actualisé. Ne la répétez pas ; rechargez la page.", noRecords: "Aucun enregistrement.",
    tandem: "Vols biplaces", addTandem: "Ajouter un vol biplace", duration: "Durée (minutes)", form: "Fiche papier du passager remplie",
    receipt: "Référence du reçu", choose: "Choisir", print: "Imprimer", edit: "Modifier", cancel: "Annuler", member: "Membre de l'association (facultatif)", nonmember: "Non lié à un membre", },
  ar: { flights: "أنشطة الطيران", gear: "معدات الطيران", loans: "إعارة المعدات", site: "الموقع",
    date: "التاريخ والوقت المحلي", offset: "فرق توقيت الدار البيضاء عن UTC في هذا التاريخ", notes: "ملاحظات", participants: "المشاركون",
    addPerson: "إضافة مشارك", name: "الاسم", role: "الدور", pilot: "الطيار", passenger: "الراكب",
    coordinator: "المنسق", driver: "السائق", remove: "إزالة", save: "حفظ", identifier: "المعرّف",
    designation: "التسمية", condition: "الحالة", model: "العلامة والطراز", size: "المقاس / الحمولة",
    acquired: "تاريخ الاقتناء", inspection: "آخر فحص", repack: "آخر طي للمظلة الاحتياطية",
    borrower: "المستعير", loaned: "تاريخ الإعارة", expected: "تاريخ الإرجاع المتوقع", returnDate: "تاريخ الإرجاع",
    returnCondition: "الحالة عند الإرجاع", return: "تسجيل الإرجاع", loading: "جار التحميل…",
    failed: "تعذر تأكيد العملية. تحقق من السجلات قبل إعادة المحاولة.", refreshFailed: "تم حفظ العملية لكن تعذر تحديث العرض. لا تكررها؛ أعد تحميل الصفحة.", noRecords: "لا توجد سجلات.",
    tandem: "الرحلات الثنائية", addTandem: "إضافة رحلة ثنائية", duration: "المدة بالدقائق", form: "تم ملء استمارة الراكب الورقية",
    receipt: "مرجع الوصل", choose: "اختر", print: "طباعة", edit: "تعديل", cancel: "إلغاء", member: "عضو في الجمعية (اختياري)", nonmember: "غير مرتبط بعضو", },
} as const;
type Tandem = { pilotId: string; passengerId: string; durationMinutes: number | null; passengerFormCompleted: boolean; receiptReference: string | null; observations: string };
const initEquipment = { identifier: "", designation: "", makeModel: "", sizeRating: "", acquiredOn: null as string | null,
  lastInspectionOn: null as string | null, reserveRepackedOn: null as string | null, condition: "" };
const flightText = {
  en: { status: "Status", planned: "Planned", done: "Done", cancelled: "Cancelled", append: "Add note", archive: "Archive", confirm: "Archive this equipment?", eligible: "Only open, validated sites can be selected." },
  fr: { status: "Statut", planned: "Planifié", done: "Effectué", cancelled: "Annulé", append: "Ajouter une note", archive: "Archiver", confirm: "Archiver ce matériel ?", eligible: "Seuls les sites ouverts et validés peuvent être sélectionnés." },
  ar: { status: "الحالة", planned: "مخطط", done: "مكتمل", cancelled: "ملغى", append: "إضافة ملاحظة", archive: "أرشفة", confirm: "أرشفة هذه المعدات؟", eligible: "يمكن اختيار المواقع المفتوحة والمتحقق منها فقط." },
} as const;

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
      <strong>{f.site}</strong> — {ft[f.status]} — {new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Casablanca" }).format(new Date(f.startsAt))}
      <div>{f.participants.map((p) => `${t[p.role]}: ${p.name}`).join(" · ")}</div>
      {f.tandemFlights.map((pair, i) => <div key={i}>{t.tandem}: {f.participants.find((p) => p.id === pair.pilotId)?.name} / {f.participants.find((p) => p.id === pair.passengerId)?.name} · {t.duration}: {pair.durationMinutes ?? "—"} · {t.form}: {pair.passengerFormCompleted ? "✓" : "—"}</div>)}
      <div>{f.notes}</div>
      {f.additionalNotes.map((note) => <div key={note.id}>{new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Casablanca" }).format(new Date(note.createdAt))}: {note.body}</div>)}
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
    <ul className="member-list">{equipment.map((item) => <li key={item.id}>{item.identifier} — {item.designation} — {item.condition}
      <button onClick={() => { setEditingGear(item.id); setGear({ identifier: item.identifier, designation: item.designation, makeModel: item.makeModel, sizeRating: item.sizeRating, condition: item.condition, acquiredOn: dateValue(item.acquiredOn) || null, lastInspectionOn: dateValue(item.lastInspectionOn) || null, reserveRepackedOn: dateValue(item.reserveRepackedOn) || null }); }}>{t.edit}</button>
      {specialAdmin && <button disabled={busy} onClick={() => { if (window.confirm(ft.confirm)) void submit(`/api/equipment/${item.id}/archive`, {}, () => {}); }}>{ft.archive}</button>}
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
      <strong>{item.identifier} — {item.borrowerName}</strong> · {dateValue(item.loanedOn)}
      {item.returnedOn && <div>{t.returnDate}: {dateValue(item.returnedOn)} — {item.conditionIn}</div>}
      {!item.returnedOn && <form className="inline-fields" onSubmit={(e) => { e.preventDefault(); void submit(`/api/loans/${item.id}/return`, returns[item.id], () => setReturns((r) => { const copy = { ...r }; delete copy[item.id]; return copy; })); }}>
        <label>{t.returnDate}<input required type="date" value={returns[item.id]?.returnedOn ?? ""} onChange={(e) => setReturns({ ...returns, [item.id]: { returnedOn: e.target.value, conditionIn: returns[item.id]?.conditionIn ?? "" } })} /></label>
        <label>{t.returnCondition}<input required value={returns[item.id]?.conditionIn ?? ""} onChange={(e) => setReturns({ ...returns, [item.id]: { returnedOn: returns[item.id]?.returnedOn ?? "", conditionIn: e.target.value } })} /></label>
        <button disabled={busy}>{t.return}</button>
      </form>}
    </div></li>)}</ul>
  </section>;
}
