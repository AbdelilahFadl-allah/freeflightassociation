import { useEffect, useState } from "react";
import { messages, type Language } from "./translations";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Member = { id: string; firstName: string; lastName: string; phone: string | null; email: string | null; active: boolean;
  details: Partial<Record<"birthDate" | "birthPlace" | "nationality" | "profession" | "address" | "emergencyContact" | "qualification" | "licenceNumber" | "licenceExpiresOn" | "insuranceProvider" | "insuranceReference", string | null>> };
type Participant = { id: string; name: string; role: string };
type Flight = { id: string; startsAt: string; site: string; notes: string; additionalNotes: { body: string; createdAt: string }[]; participants: Participant[]; tandemFlights: { pilotId: string; passengerId: string; durationMinutes: number | null; passengerFormCompleted: boolean; receiptReference: string | null }[] };
type Gear = { id: string; identifier: string; designation: string; condition: string; makeModel: string; sizeRating: string };
type Loan = { id: string; identifier: string; borrowerName: string; loanedOn: string; expectedReturnOn: string | null; returnedOn: string | null; conditionOut: string; conditionIn: string | null };
type Product = { id: string; name: string; quantity: number };
type Operation = { id: string; kind: string; businessDate: string; description: string; counterparty: string; reversesId: string | null; entries: { accountId: string; amountCents: number }[] };
type Receipt = { number: string; operationId: string; businessDate: string; description: string; counterparty: string; paymentMethod: string; amountCents: number; accountId: string };
type Row = { id: string; date: string; values: string[] };
type Kind = "members" | "flights" | "gear" | "loans" | "products" | "ledger" | "receipts";
const text = {
  en: { title: "Reports and exports", members: "Members", flights: "Flights", gear: "Equipment", loans: "Loans", products: "Goods", ledger: "Ledger", receipts: "Receipts",
    search: "Search", from: "From date", to: "To date", refresh: "Refresh", export: "Download CSV", print: "Print", error: "Could not load reports.",
    draft: "Reference printout — check the association's approved forms and legal wording before use.",
    columns: ["Name", "Contact", "Status", "Date", "Site / item", "Details", "Amount", "Number", "Counterparty", "Method"],
    active: "Active", inactive: "Inactive", returned: "Returned", open: "Open", yes: "Yes", no: "No",
    form: "Passenger paper form completed", notes: "Notes", pilot: "Pilot", passenger: "Passenger", duration: "Duration (minutes)", condition: "Condition",
    signatures: "Signatures", reversed: "Reversed", original: "Original",
    roles: { pilot: "Pilot", passenger: "Passenger", coordinator: "Coordinator", driver: "Driver" },
    types: { income: "Income", expense: "Expense", sale: "Sale", purchase: "Purchase", transfer: "Transfer", reversal: "Reversal", cash: "Cash", bank: "Bank" } },
  fr: { title: "Rapports et exports", members: "Membres", flights: "Vols", gear: "Matériel", loans: "Prêts", products: "Marchandises", ledger: "Journal", receipts: "Reçus",
    search: "Rechercher", from: "Date de début", to: "Date de fin", refresh: "Actualiser", export: "Télécharger CSV", print: "Imprimer", error: "Impossible de charger les rapports.",
    draft: "Impression de référence — vérifier les formulaires et mentions juridiques approuvés par l'association avant utilisation.",
    columns: ["Nom", "Contact", "Statut", "Date", "Site / article", "Détails", "Montant", "Numéro", "Tiers", "Mode"],
    active: "Actif", inactive: "Inactif", returned: "Retourné", open: "En cours", yes: "Oui", no: "Non",
    form: "Fiche papier du passager remplie", notes: "Observations", pilot: "Pilote", passenger: "Passager", duration: "Durée (minutes)", condition: "État",
    signatures: "Signatures", reversed: "Contrepassé", original: "Original",
    roles: { pilot: "Pilote", passenger: "Passager", coordinator: "Coordinateur", driver: "Chauffeur" },
    types: { income: "Recette", expense: "Dépense", sale: "Vente", purchase: "Achat", transfer: "Virement interne", reversal: "Contrepassation", cash: "Caisse", bank: "Banque" } },
  ar: { title: "التقارير والتصدير", members: "الأعضاء", flights: "الرحلات", gear: "المعدات", loans: "الإعارات", products: "البضائع", ledger: "السجل المالي", receipts: "الوصولات",
    search: "بحث", from: "من تاريخ", to: "إلى تاريخ", refresh: "تحديث", export: "تنزيل CSV", print: "طباعة", error: "تعذر تحميل التقارير.",
    draft: "نسخة مرجعية للطباعة — يجب التحقق من نماذج الجمعية وصيغها القانونية المعتمدة قبل الاستعمال.",
    columns: ["الاسم", "الاتصال", "الحالة", "التاريخ", "الموقع / الصنف", "التفاصيل", "المبلغ", "الرقم", "الطرف الآخر", "الطريقة"],
    active: "نشط", inactive: "غير نشط", returned: "تم الإرجاع", open: "جارية", yes: "نعم", no: "لا",
    form: "تم ملء استمارة الراكب الورقية", notes: "ملاحظات", pilot: "الطيار", passenger: "الراكب", duration: "المدة بالدقائق", condition: "الحالة",
    signatures: "التوقيعات", reversed: "تم العكس", original: "أصلي",
    roles: { pilot: "الطيار", passenger: "الراكب", coordinator: "المنسق", driver: "السائق" },
    types: { income: "إيراد", expense: "مصروف", sale: "بيع", purchase: "شراء", transfer: "تحويل داخلي", reversal: "عملية عكس", cash: "الصندوق", bank: "البنك" } },
} as const;

export function csvCell(value: string) {
  // Prevent spreadsheet applications from executing exported text as a formula.
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
function printReport(title: string, lines: [string, string][], language: Language, disclaimer: string) {
  const popup = window.open("", "_blank");
  if (!popup) throw new Error("Print window blocked");
  const doc = popup.document;
  doc.documentElement.lang = language;
  doc.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  doc.title = title;
  const heading = doc.createElement("h1"); heading.textContent = title; doc.body.append(heading);
  for (const [label, value] of lines) {
    const p = doc.createElement("p"); const strong = doc.createElement("strong");
    strong.textContent = `${label}: `; p.append(strong, doc.createTextNode(value)); doc.body.append(p);
  }
  const note = doc.createElement("p"); note.textContent = disclaimer; doc.body.append(note);
  popup.focus(); popup.print();
}

export function Reports({ api, language, revision }: { api: Api; language: Language; revision: number }) {
  const t = text[language];
  const [kind, setKind] = useState<Kind>("members");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState(false);
  const [data, setData] = useState<{ members: Member[]; flights: Flight[]; gear: Gear[]; loans: Loan[]; products: Product[]; ledger: Operation[]; receipts: Receipt[] }>({
    members: [], flights: [], gear: [], loans: [], products: [], ledger: [], receipts: [],
  });
  async function refresh() {
    const [members, flights, gear, loans, products, ledger, receipts] = await Promise.all([
      api<Member[]>("/api/members"), api<Flight[]>("/api/flights"), api<Gear[]>("/api/equipment"), api<Loan[]>("/api/loans"),
      api<Product[]>("/api/products"), api<Operation[]>("/api/finance"), api<Receipt[]>("/api/receipts"),
    ]);
    setData({ members, flights, gear, loans, products, ledger, receipts }); setError(false);
  }
  useEffect(() => {
    let active = true;
    Promise.all([api<Member[]>("/api/members"), api<Flight[]>("/api/flights"), api<Gear[]>("/api/equipment"), api<Loan[]>("/api/loans"),
      api<Product[]>("/api/products"), api<Operation[]>("/api/finance"), api<Receipt[]>("/api/receipts")])
      .then(([members, flights, gear, loans, products, ledger, receipts]) => { if (active) setData({ members, flights, gear, loans, products, ledger, receipts }); })
      .catch((e: unknown) => { console.error("Reports failed", e); if (active) setError(true); });
    return () => { active = false; };
  }, [api, revision]);
  const date = (d: string | null) => d ? String(d).slice(0, 10) : "";
  const cash = (n: number) => new Intl.NumberFormat(language, { style: "currency", currency: "MAD" }).format(n / 100);
  const reports: Record<Kind, { headers: string[]; rows: Row[] }> = {
    members: { headers: [t.columns[0], t.columns[1], t.columns[2]], rows: data.members.map((m) => ({ id: m.id, date: "", values: [`${m.firstName} ${m.lastName}`, [m.phone, m.email].filter(Boolean).join(" / "), m.active ? t.active : t.inactive] })) },
    flights: { headers: [t.columns[3], t.columns[4], t.columns[5]], rows: data.flights.map((f) => ({ id: f.id,
      date: new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Casablanca" }).format(new Date(f.startsAt)),
      values: [new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Casablanca" }).format(new Date(f.startsAt)), f.site, f.participants.map((p) => `${t.roles[p.role as keyof typeof t.roles] ?? p.role}: ${p.name}`).join("; ")] })) },
    gear: { headers: [t.columns[7], t.columns[4], t.condition], rows: data.gear.map((g) => ({ id: g.id, date: "", values: [g.identifier, `${g.designation} ${g.makeModel} ${g.sizeRating}`, g.condition] })) },
    loans: { headers: [t.columns[3], t.columns[4], t.columns[0], t.columns[2]], rows: data.loans.map((l) => ({ id: l.id, date: date(l.loanedOn), values: [date(l.loanedOn), l.identifier, l.borrowerName, l.returnedOn ? t.returned : t.open] })) },
    products: { headers: [t.columns[4], t.columns[5]], rows: data.products.map((p) => ({ id: p.id, date: "", values: [p.name, String(p.quantity)] })) },
    ledger: { headers: [t.columns[3], t.columns[5], t.columns[6]], rows: data.ledger.map((o) => ({ id: o.id, date: date(o.businessDate), values: [date(o.businessDate), `${t.types[o.kind as keyof typeof t.types] ?? o.kind} — ${o.description}`, o.entries.map((e) => `${t.types[e.accountId as keyof typeof t.types] ?? e.accountId}: ${cash(e.amountCents)}`).join("; ")] })) },
    receipts: { headers: [t.columns[7], t.columns[3], t.columns[8], t.columns[6], t.columns[2]], rows: data.receipts.map((r) => ({ id: r.operationId, date: date(r.businessDate), values: [r.number, date(r.businessDate), r.counterparty, cash(r.amountCents), data.ledger.some((o) => o.reversesId === r.operationId) ? t.reversed : t.original] })) },
  };
  const report = reports[kind];
  const rows = report.rows.filter((r) => r.values.join(" ").toLocaleLowerCase().includes(query.toLocaleLowerCase())
    && (!from || (r.date && r.date >= from)) && (!to || (r.date && r.date <= to)));
  function download() {
    const csv = "\uFEFF" + [report.headers, ...rows.map((r) => r.values)].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${kind}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  function print(row: Row) {
    const lines: [string, string][] = report.headers.map((header, i) => [header, row.values[i]]);
    if (kind === "members") {
      const member = data.members.find((m) => m.id === row.id);
      if (member) {
        for (const key of ["birthDate", "birthPlace", "nationality", "profession", "address", "emergencyContact", "qualification", "licenceNumber", "licenceExpiresOn", "insuranceProvider", "insuranceReference"] as const) {
          lines.push([messages[language][key], member.details?.[key] ?? ""]);
        }
      }
      lines.push([t.signatures, "________________________"]);
    }
    if (kind === "flights") {
      const flight = data.flights.find((f) => f.id === row.id);
      if (flight) {
        for (const pair of flight.tandemFlights) {
          lines.push([t.pilot, flight.participants.find((p) => p.id === pair.pilotId)?.name ?? ""]);
          lines.push([t.passenger, flight.participants.find((p) => p.id === pair.passengerId)?.name ?? ""]);
          lines.push([t.duration, pair.durationMinutes === null ? "" : String(pair.durationMinutes)]);
          lines.push([t.form, pair.passengerFormCompleted ? t.yes : t.no]);
        }
        lines.push([t.notes, [flight.notes, ...flight.additionalNotes.map((note) => `${new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Casablanca" }).format(new Date(note.createdAt))}: ${note.body}`)].filter(Boolean).join("\n")], [t.signatures, "________________________"]);
      }
    }
    if (kind === "loans") {
      const loan = data.loans.find((l) => l.id === row.id);
      if (loan) lines.push([t.condition, `${loan.conditionOut} / ${loan.conditionIn ?? ""}`], [t.signatures, "________________________"]);
    }
    if (kind === "receipts") {
      const receipt = data.receipts.find((r) => r.operationId === row.id);
      if (receipt) lines.push([t.columns[5], receipt.description], [t.columns[9], receipt.paymentMethod], [t.signatures, "________________________"]);
    }
    try { printReport(t[kind], lines, language, t.draft); } catch (e) { console.error("Print failed", e); setError(true); }
  }
  return <section id="reports"><h2>{t.title}</h2>{error && <p role="alert" className="error">{t.error}</p>}
    <div className="inline-fields">
      <label>{t.title}<select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>{(Object.keys(reports) as Kind[]).map((k) => <option key={k} value={k}>{t[k]}</option>)}</select></label>
      <label>{t.search}<input value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <label>{t.from}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label>{t.to}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      <button onClick={() => { void refresh().catch((e: unknown) => { console.error("Reports failed", e); setError(true); }); }}>{t.refresh}</button>
      <button onClick={download}>{t.export}</button>
    </div>
    <div className="table-scroll"><table><thead><tr>{report.headers.map((h) => <th key={h}>{h}</th>)}<th>{t.print}</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}>{r.values.map((v, i) => <td key={i}><bdi>{v}</bdi></td>)}<td>{["members", "flights", "loans", "receipts"].includes(kind) && <button onClick={() => print(r)}>{t.print}</button>}</td></tr>)}</tbody>
    </table></div>
  </section>;
}
