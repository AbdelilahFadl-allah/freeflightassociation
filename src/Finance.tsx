import { useEffect, useState } from "react";
import type { Language } from "./translations";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Product = { id: string; name: string; quantity: number };
type Account = { id: "cash" | "bank"; balanceCents: number; openingSet: boolean };
type Operation = { id: string; kind: string; businessDate: string; description: string; counterparty: string; paymentMethod: string; reversesId: string | null; entries: { accountId: string; amountCents: number }[] };
type StockMovement = { id: string; name: string; quantity: number; businessDate: string; reason: string; operationId: string | null };
type Line = { productId: string; quantity: string; price: string };
const translations = {
  en: { title: "Goods and finances", products: "Goods stock", name: "Product", initial: "Opening quantity", date: "Date", addProduct: "Add product",
    adjust: "Stock adjustment", change: "Quantity change (+ or −)", reason: "Reason", save: "Save", account: "Account",
    cash: "Cash", bank: "Bank", kind: "Type", income: "Income", expense: "Expense", sale: "Sale", purchase: "Purchase",
    transfer: "Transfer", from: "From", to: "To", description: "Description", counterparty: "Counterparty",
    payment: "Payment method", amount: "Amount (MAD)", quantity: "Quantity", price: "Unit price (MAD)",
    addLine: "Add line", remove: "Remove", ledger: "Ledger", reverse: "Reverse", reversal: "Reversal",
    reverseDate: "Reversal date", failed: "The operation could not be confirmed. Check the ledger and stock before retrying.", refreshFailed: "The operation was saved, but the display could not refresh. Do not repeat it; reload the page.",
    choose: "Choose", active: "Save transaction", reversed: "Reversed", selectProduct: "Select product",
    correct: "Correct", correction: "Correcting transaction: enter complete replacement details", cancel: "Cancel correction", correctionDate: "Reversal date", correctionReason: "Correction reason",
    opening: "Set opening balance once before recording transactions", openingAmount: "Opening balance (MAD)", openingNote: "Opening balance description", movements: "Stock movement history", openingStock: "Opening stock" },
  fr: { title: "Marchandises et finances", products: "Stock de marchandises", name: "Produit", initial: "Stock initial", date: "Date", addProduct: "Ajouter le produit",
    adjust: "Ajustement de stock", change: "Variation de quantité (+ ou −)", reason: "Motif", save: "Enregistrer", account: "Compte",
    cash: "Caisse", bank: "Banque", kind: "Type", income: "Recette", expense: "Dépense", sale: "Vente", purchase: "Achat",
    transfer: "Virement interne", from: "De", to: "Vers", description: "Libellé", counterparty: "Tiers",
    payment: "Mode de paiement", amount: "Montant (MAD)", quantity: "Quantité", price: "Prix unitaire (MAD)",
    addLine: "Ajouter une ligne", remove: "Retirer", ledger: "Journal", reverse: "Contrepasser", reversal: "Contrepassation",
    reverseDate: "Date de contrepassation", failed: "L'opération n'a pas pu être confirmée. Vérifiez le journal et le stock avant de réessayer.", refreshFailed: "L'opération a été enregistrée mais l'affichage n'a pas pu être actualisé. Ne la répétez pas ; rechargez la page.",
    choose: "Choisir", active: "Enregistrer l'opération", reversed: "Contrepassé", selectProduct: "Choisir un produit",
    correct: "Corriger", correction: "Correction de l'opération : saisir tous les détails de remplacement", cancel: "Annuler la correction", correctionDate: "Date de contrepassation", correctionReason: "Motif de correction",
    opening: "Définir une seule fois le solde initial avant les opérations", openingAmount: "Solde initial (MAD)", openingNote: "Description du solde initial", movements: "Historique des mouvements de stock", openingStock: "Stock initial" },
  ar: { title: "البضائع والمالية", products: "مخزون البضائع", name: "المنتج", initial: "المخزون الأولي", date: "التاريخ", addProduct: "إضافة منتج",
    adjust: "تعديل المخزون", change: "تغير الكمية (+ أو −)", reason: "السبب", save: "حفظ", account: "الحساب",
    cash: "الصندوق", bank: "البنك", kind: "النوع", income: "إيراد", expense: "مصروف", sale: "بيع", purchase: "شراء",
    transfer: "تحويل داخلي", from: "من", to: "إلى", description: "البيان", counterparty: "الطرف الآخر",
    payment: "طريقة الدفع", amount: "المبلغ (درهم)", quantity: "الكمية", price: "سعر الوحدة (درهم)",
    addLine: "إضافة سطر", remove: "إزالة", ledger: "السجل المالي", reverse: "عكس العملية", reversal: "عملية عكس",
    reverseDate: "تاريخ العكس", failed: "تعذر تأكيد العملية. تحقق من السجل والمخزون قبل إعادة المحاولة.", refreshFailed: "تم حفظ العملية لكن تعذر تحديث العرض. لا تكررها؛ أعد تحميل الصفحة.",
    choose: "اختر", active: "تسجيل العملية", reversed: "تم العكس", selectProduct: "اختر منتجاً",
    correct: "تصحيح", correction: "تصحيح العملية: أدخل تفاصيل العملية البديلة كاملة", cancel: "إلغاء التصحيح", correctionDate: "تاريخ العكس", correctionReason: "سبب التصحيح",
    opening: "حدد الرصيد الافتتاحي مرة واحدة قبل تسجيل العمليات", openingAmount: "الرصيد الافتتاحي (درهم)", openingNote: "وصف الرصيد الافتتاحي", movements: "سجل حركات المخزون", openingStock: "المخزون الافتتاحي" },
} as const;
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
    <ul className="member-list">{products.map((p) => <li key={p.id}>{p.name} — {p.quantity}</li>)}</ul>
    <details><summary>{t.movements}</summary><ul className="member-list">{movements.map((m) => <li key={m.id}>
      <div>{String(m.businessDate).slice(0, 10)} — {m.name} — <bdi>{m.quantity > 0 ? "+" : ""}{m.quantity}</bdi> — {m.reason === "opening" ? t.openingStock : t[m.reason as "sale" | "purchase" | "reversal"] ?? m.reason}
        {m.operationId && <div><bdi>{m.operationId}</bdi></div>}</div>
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
      <strong>{o.description}</strong> — {t[o.kind as "income" | "expense" | "sale" | "purchase" | "transfer" | "reversal"] ?? o.kind} — {String(o.businessDate).slice(0, 10)} {o.entries.map((entry) => <span key={entry.accountId}> · {t[entry.accountId as "cash" | "bank"] ?? entry.accountId}: <bdi>{money(entry.amountCents)}</bdi></span>)}
      {(o.counterparty || o.paymentMethod) && <div>{t.counterparty}: {o.counterparty || "—"} · {t.payment}: {o.paymentMethod || "—"}</div>}
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
