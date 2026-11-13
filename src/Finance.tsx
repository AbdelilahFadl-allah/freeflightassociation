import { useEffect, useState } from "react";
import type { Language } from "./translations";
import { translations } from "./i18n/finance";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Product = { id: string; name: string; quantity: number };
type Account = { id: "cash" | "bank"; balanceCents: number; openingSet: boolean };
type Operation = { id: string; kind: string; businessDate: string; description: string; counterparty: string; paymentMethod: string; reversesId: string | null; entries: { accountId: string; amountCents: number }[] };
type StockMovement = { id: string; name: string; quantity: number; businessDate: string; reason: string; operationId: string | null };
type Line = { productId: string; quantity: string; price: string };
function cents(value: string) {
  // Convert the entered decimal string directly to integer cents without floating-point rounding.
  if (!/^\d{1,6}(?:[.,]\d{1,2})?$/.test(value)) throw new Error("Invalid monetary amount");
  const [whole, fraction = ""] = value.replace(",", ".").split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (result <= 0) throw new Error("Amount must be positive");
  return result;
}
function openingCents(value: string) {
  if (!/^-?\d{1,7}(?:[.,]\d{1,2})?$/.test(value)) throw new Error("Invalid opening balance");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").replace(",", ".").split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (result > 100_000_000) throw new Error("Opening balance exceeds supported range");
  return negative ? -result : result;
}

export function Finance({ api, language, onChange }: { api: Api; language: Language; onChange: () => void }) {
  const t = translations[language];
  const [products, setProducts] = useState<Product[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [error, setError] = useState<"uncertain" | "refresh" | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [initial, setInitial] = useState("0");
  const [date, setDate] = useState("");
  const [selected, setSelected] = useState("");
  const [change, setChange] = useState("");
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<"income" | "expense" | "sale" | "purchase" | "transfer">("income");
  const [account, setAccount] = useState<"cash" | "bank">("cash");
  const [description, setDescription] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [amount, setAmount] = useState("");
  const [lines, setLines] = useState<Line[]>([{ productId: "", quantity: "", price: "" }]);
  const [reversals, setReversals] = useState<Record<string, { date: string; reason: string }>>({});
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [correctionDate, setCorrectionDate] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [openings, setOpenings] = useState<Record<string, { amount: string; date: string; note: string }>>({});
  async function refresh() {
    const [p, a, o, m] = await Promise.all([api<Product[]>("/api/products"), api<Account[]>("/api/accounts"), api<Operation[]>("/api/finance"), api<StockMovement[]>("/api/stock-movements")]);
    setProducts(p); setAccounts(a); setOperations(o); setMovements(m);
  }
  useEffect(() => {
    let active = true;
    Promise.all([api<Product[]>("/api/products"), api<Account[]>("/api/accounts"), api<Operation[]>("/api/finance"), api<StockMovement[]>("/api/stock-movements")])
      .then(([p, a, o, m]) => { if (active) { setProducts(p); setAccounts(a); setOperations(o); setMovements(m); } })
      .catch((e: unknown) => { console.error("Loading finance failed", e); if (active) setError("uncertain"); });
    return () => { active = false; };
  }, [api]);
  async function submit(path: string, makeBody: () => unknown, done: () => void) {
    setBusy(true);
    let saved = false;
    try { await api(path, { method: "POST", body: JSON.stringify(makeBody()) }); saved = true; done(); onChange(); await refresh(); setError(null); }
    catch (e) { console.error("Financial operation could not be confirmed", e); setError(saved ? "refresh" : "uncertain"); }
    finally { setBusy(false); }
  }
  const money = (value: number) => new Intl.NumberFormat(language, { style: "currency", currency: "MAD" }).format(value / 100);
  return <section id="finance">
    <h2>{t.title}</h2>
    {error && <p className="error" role="alert">{error === "refresh" ? t.refreshFailed : t.failed}</p>}
    <div>{accounts.map((a) => <div key={a.id}><p><strong>{t[a.id]}: <bdi>{money(a.balanceCents)}</bdi></strong></p>
      {!a.openingSet && <form className="form" onSubmit={(e) => {
        e.preventDefault();
        void submit(`/api/accounts/${a.id}/opening`, () => ({ amountCents: openingCents(openings[a.id]?.amount ?? ""), businessDate: openings[a.id]?.date, description: openings[a.id]?.note }),
          () => setOpenings((old) => { const updated = { ...old }; delete updated[a.id]; return updated; }));
      }}><p>{t.opening}</p>
        <label>{t.openingAmount}<input required inputMode="decimal" value={openings[a.id]?.amount ?? ""} onChange={(e) => setOpenings({ ...openings, [a.id]: { amount: e.target.value, date: openings[a.id]?.date ?? "", note: openings[a.id]?.note ?? "" } })} /></label>
        <label>{t.date}<input required type="date" value={openings[a.id]?.date ?? ""} onChange={(e) => setOpenings({ ...openings, [a.id]: { amount: openings[a.id]?.amount ?? "", date: e.target.value, note: openings[a.id]?.note ?? "" } })} /></label>
        <label>{t.openingNote}<input required value={openings[a.id]?.note ?? ""} onChange={(e) => setOpenings({ ...openings, [a.id]: { amount: openings[a.id]?.amount ?? "", date: openings[a.id]?.date ?? "", note: e.target.value } })} /></label>
        <div><button disabled={busy}>{t.save}</button></div>
      </form>}
    </div>)}</div>
    <h3>{t.products}</h3>
    <form className="form" onSubmit={(e) => { e.preventDefault(); void submit("/api/products", () => ({ name, initialQuantity: Number(initial), businessDate: date }), () => { setName(""); setInitial("0"); }); }}>
      <label>{t.name}<input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>{t.initial}<input required type="number" min="0" max="1000000" value={initial} onChange={(e) => setInitial(e.target.value)} /></label>
      <label>{t.date}<input required type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <div><button disabled={busy}>{t.addProduct}</button></div>
    </form>
    <ul className="member-list">{products.map((p) => <li key={p.id}><div><strong>{t.name}:</strong> <bdi>{p.name}</bdi> · <strong>{t.quantity}:</strong> {p.quantity}</div></li>)}</ul>
    <details><summary>{t.movements}</summary><ul className="member-list">{movements.map((m) => <li key={m.id}>
      <div><strong>{t.date}:</strong> {String(m.businessDate).slice(0, 10)} · <strong>{t.name}:</strong> <bdi>{m.name}</bdi> · <strong>{t.change}:</strong> <bdi>{m.quantity > 0 ? "+" : ""}{m.quantity}</bdi> · <strong>{t.reason}:</strong> {m.reason === "opening" ? t.openingStock : t[m.reason as "sale" | "purchase" | "reversal"] ?? m.reason}
        {m.operationId && <div className="record-related"><strong>{t.operationId}:</strong> <bdi>{m.operationId}</bdi></div>}</div>
    </li>)}</ul></details>
    <form className="form" onSubmit={(e) => { e.preventDefault(); void submit(`/api/products/${selected}/adjustments`, () => ({ quantity: Number(change), businessDate: date, reason }), () => { setChange(""); setReason(""); }); }}>
      <label>{t.adjust}<select required value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">{t.selectProduct}</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>{t.change}<input required type="number" min="-1000000" max="1000000" value={change} onChange={(e) => setChange(e.target.value)} /></label>
      <label>{t.date}<input required type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label>{t.reason}<input required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <div><button disabled={busy}>{t.save}</button></div>
    </form>
    <form id="transaction-form" className="form" onSubmit={(e) => {
      e.preventDefault();
      const base = { businessDate: date, description, counterparty, paymentMethod };
      const path = correcting ? `/api/finance/${correcting}/correct` : kind === "transfer" ? "/api/finance/transfers" : kind === "sale" || kind === "purchase" ? "/api/finance/trades" : "/api/finance/direct";
      void submit(path,
        () => {
          const replacement = kind === "transfer" ? { ...base, kind, from: account, to: account === "cash" ? "bank" : "cash", amountCents: cents(amount) }
          : kind === "sale" || kind === "purchase" ? { ...base, kind, account, lines: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitPriceCents: cents(l.price) })) }
            : { ...base, kind, account, amountCents: cents(amount) };
          if (correcting) return { businessDate: correctionDate, reason: correctionReason, replacement };
          if (kind === "transfer" && "from" in replacement) {
            const { kind: _kind, ...transferBody } = replacement;
            return transferBody;
          }
          return replacement;
        },
        () => { setDescription(""); setCounterparty(""); setPaymentMethod(""); setAmount(""); setLines([{ productId: "", quantity: "", price: "" }]); setCorrecting(null); setCorrectionDate(""); setCorrectionReason(""); });
    }}>
      {correcting && <><p>{t.correction} <bdi>{correcting}</bdi></p>
        <label>{t.correctionDate}<input required type="date" value={correctionDate} onChange={(e) => setCorrectionDate(e.target.value)} /></label>
        <label>{t.correctionReason}<input required value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} /></label>
        <div><button type="button" onClick={() => setCorrecting(null)}>{t.cancel}</button></div></>}
      <label>{t.kind}<select disabled={!!correcting} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
        {(["income", "expense", "sale", "purchase", "transfer"] as const).map((v) => <option key={v} value={v}>{t[v]}</option>)}</select></label>
      <label>{kind === "transfer" ? t.from : t.account}<select value={account} onChange={(e) => setAccount(e.target.value as typeof account)}><option value="cash">{t.cash}</option><option value="bank">{t.bank}</option></select></label>
      <label>{t.date}<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label>{t.description}<input required value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label>{t.counterparty}<input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} /></label>
      <label>{t.payment}<input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} /></label>
      {(kind === "income" || kind === "expense" || kind === "transfer") && <label>{t.amount}<input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>}
      {(kind === "sale" || kind === "purchase") && <fieldset><legend>{t.products}</legend>{lines.map((l, index) => <div key={index} className="inline-fields">
        <label>{t.name}<select required value={l.productId} onChange={(e) => setLines(lines.map((x, i) => i === index ? { ...x, productId: e.target.value } : x))}><option value="">{t.choose}</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>{t.quantity}<input required type="number" min="1" max="1000000" value={l.quantity} onChange={(e) => setLines(lines.map((x, i) => i === index ? { ...x, quantity: e.target.value } : x))} /></label>
        <label>{t.price}<input required inputMode="decimal" value={l.price} onChange={(e) => setLines(lines.map((x, i) => i === index ? { ...x, price: e.target.value } : x))} /></label>
        {lines.length > 1 && <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== index))}>{t.remove}</button>}
      </div>)}<button type="button" onClick={() => setLines([...lines, { productId: "", quantity: "", price: "" }])}>{t.addLine}</button></fieldset>}
      <div><button disabled={busy}>{t.active}</button></div>
    </form>
    <h3>{t.ledger}</h3>
    <ul className="member-list">{operations.map((o) => <li key={o.id}><div>
      <div><strong>{t.description}:</strong> {o.description}</div>
      <div><strong>{t.kind}:</strong> {t[o.kind as "income" | "expense" | "sale" | "purchase" | "transfer" | "reversal"] ?? o.kind} · <strong>{t.date}:</strong> {String(o.businessDate).slice(0, 10)}</div>
      {o.entries.map((entry) => <div className="record-related" key={entry.accountId}><strong>{t.account}:</strong> {t[entry.accountId as "cash" | "bank"] ?? entry.accountId} · <strong>{t.amount}:</strong> <bdi>{money(entry.amountCents)}</bdi></div>)}
      {(o.counterparty || o.paymentMethod) && <div><strong>{t.counterparty}:</strong> {o.counterparty || "—"} · <strong>{t.payment}:</strong> {o.paymentMethod || "—"}</div>}
      {o.kind !== "reversal" && !operations.some((r) => r.reversesId === o.id) && <form className="inline-fields" onSubmit={(e) => {
        e.preventDefault();
        void submit(`/api/finance/${o.id}/reverse`, () => ({ businessDate: reversals[o.id]?.date, reason: reversals[o.id]?.reason }), () => setReversals((old) => { const n = { ...old }; delete n[o.id]; return n; }));
      }}><label>{t.reverseDate}<input required type="date" value={reversals[o.id]?.date ?? ""} onChange={(e) => setReversals({ ...reversals, [o.id]: { date: e.target.value, reason: reversals[o.id]?.reason ?? "" } })} /></label>
        <label>{t.reason}<input required value={reversals[o.id]?.reason ?? ""} onChange={(e) => setReversals({ ...reversals, [o.id]: { date: reversals[o.id]?.date ?? "", reason: e.target.value } })} /></label><button disabled={busy}>{t.reverse}</button>
        <button type="button" disabled={busy} onClick={() => {
          if (!["income", "expense", "sale", "purchase", "transfer"].includes(o.kind)) return;
          setCorrecting(o.id); setKind(o.kind as typeof kind); setDescription(o.description); setCounterparty(o.counterparty); setPaymentMethod(o.paymentMethod);
          setDate(String(o.businessDate).slice(0, 10)); setCorrectionDate(String(o.businessDate).slice(0, 10)); setCorrectionReason(""); setAmount("");
          setLines([{ productId: "", quantity: "", price: "" }]);
          const source = o.kind === "transfer" ? o.entries.find((entry) => entry.amountCents < 0) : o.entries[0];
          if (source?.accountId === "cash" || source?.accountId === "bank") setAccount(source.accountId);
          document.getElementById("transaction-form")?.scrollIntoView();
        }}>{t.correct}</button></form>}
      {operations.some((r) => r.reversesId === o.id) && <div>{t.reversed}</div>}
    </div></li>)}</ul>
  </section>;
}
