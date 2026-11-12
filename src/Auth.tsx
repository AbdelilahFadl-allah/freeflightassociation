import { useEffect, useState } from "react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { Language } from "./translations";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const authClient: SupabaseClient | null = url && key
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

const text = {
  en: { email: "Email", password: "Password", signIn: "Sign in", configure: "Supabase sign-in is not configured.",
    failure: "Authentication failed. Check your details or contact the special administrator.",
    mfa: "Authenticator verification", setup: "Set up an authenticator", scan: "Scan this code in your authenticator app.",
    code: "Six-digit code", verify: "Verify", recovery: "Choose a new password", save: "Set password",
    logout: "Sign out", wait: "Checking session...", recoveryHelp: "For lost credentials or your authenticator, contact the special administrator." },
  fr: { email: "Adresse e-mail", password: "Mot de passe", signIn: "Se connecter", configure: "La connexion Supabase n’est pas configurée.",
    failure: "Échec de l’authentification. Vérifiez vos informations ou contactez l’administrateur spécial.",
    mfa: "Vérification par application d’authentification", setup: "Configurer une application d’authentification", scan: "Scannez ce code avec votre application d’authentification.",
    code: "Code à six chiffres", verify: "Vérifier", recovery: "Choisir un nouveau mot de passe", save: "Enregistrer le mot de passe",
    logout: "Se déconnecter", wait: "Vérification de la session…", recoveryHelp: "En cas de perte du mot de passe ou de l’application, contactez l’administrateur spécial." },
  ar: { email: "البريد الإلكتروني", password: "كلمة المرور", signIn: "تسجيل الدخول", configure: "لم يتم إعداد تسجيل الدخول عبر Supabase.",
    failure: "تعذرت المصادقة. تحقق من معلوماتك أو اتصل بالمسؤول الخاص.",
    mfa: "التحقق باستخدام تطبيق المصادقة", setup: "إعداد تطبيق المصادقة", scan: "امسح هذا الرمز باستخدام تطبيق المصادقة.",
    code: "رمز من ستة أرقام", verify: "تحقق", recovery: "اختر كلمة مرور جديدة", save: "حفظ كلمة المرور",
    logout: "تسجيل الخروج", wait: "جارٍ التحقق من الجلسة…", recoveryHelp: "عند فقدان كلمة المرور أو تطبيق المصادقة، اتصل بالمسؤول الخاص." },
};

type Props = { language: Language; onReady: (session: Session | null) => void };
export function Auth({ language, onReady }: Props) {
  const t = text[language];
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [recovery, setRecovery] = useState(() => {
    const recovering = new URLSearchParams(location.hash.slice(1)).get("type") === "recovery";
    if (recovering) sessionStorage.setItem("password-recovery", "pending");
    return recovering || sessionStorage.getItem("password-recovery") === "pending";
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [factor, setFactor] = useState("");
  const [qr, setQr] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authClient) { setChecking(false); return; }
    let active = true;
    const client = authClient;
    const { data: subscription } = client.auth.onAuthStateChange((event, current) => {
      if (event === "PASSWORD_RECOVERY") { sessionStorage.setItem("password-recovery", "pending"); setRecovery(true); }
      if (event === "SIGNED_OUT" || (event === "INITIAL_SESSION" && !current)) {
        sessionStorage.removeItem("password-recovery"); setRecovery(false);
      }
      if (active) { setSession(current); setChecking(false); }
    });
    return () => { active = false; subscription.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    let active = true;
    onReady(null);
    setFactor(""); setQr("");
    if (!authClient || !session || recovery) return;
    const client = authClient;
    void (async () => {
      setChecking(true);
      const { data, error: assuranceError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) throw assuranceError;
      if (!active) return;
      if (data.currentLevel === "aal2" && data.nextLevel === "aal2") {
        onReady(session);
      } else {
        const factors = await client.auth.mfa.listFactors();
        if (factors.error) throw factors.error;
        if (active) setFactor(factors.data.totp.find((item) => item.status === "verified")?.id ?? "");
      }
    })().catch(() => { if (active) setError(true); }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [session, recovery, onReady]);

  async function run(operation: () => Promise<void>) {
    setBusy(true); setError(false);
    try { await operation(); } catch { setError(true); }
    finally { setBusy(false); }
  }
  async function signOut() {
    await run(async () => {
      const result = await authClient!.auth.signOut();
      if (result.error) throw result.error;
      setRecovery(false); setPassword(""); setCode("");
    });
  }

  if (!authClient) return <p role="alert">{t.configure}</p>;
  if (checking) return <p>{t.wait}</p>;
  return <section className="form">
    {error && <p role="alert" className="error">{t.failure}</p>}
    {!session && <form className="form" onSubmit={(event) => {
      event.preventDefault();
      void run(async () => {
        const result = await authClient.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        setPassword("");
      });
    }}>
      <label>{t.email}<input required type="email" autoComplete="username" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>{t.password}<input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <button disabled={busy}>{t.signIn}</button>
    </form>}
    {session && recovery && <form className="form" onSubmit={(event) => {
      event.preventDefault();
      void run(async () => {
        const result = await authClient.auth.updateUser({ password });
        if (result.error) throw result.error;
        sessionStorage.removeItem("password-recovery");
        setPassword(""); setRecovery(false);
      });
    }}>
      <h2>{t.recovery}</h2>
      <label>{t.password}<input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <button disabled={busy}>{t.save}</button>
    </form>}
    {session && !recovery && <div>
      <h2>{t.mfa}</h2>
      {!factor && !qr && <button disabled={busy} onClick={() => void run(async () => {
        const result = await authClient.auth.mfa.enroll({ factorType: "totp" });
        if (result.error) throw result.error;
        setFactor(result.data.id); setQr(result.data.totp.qr_code);
      })}>{t.setup}</button>}
      {qr && <div><p>{t.scan}</p><img alt={t.setup} src={qr} /></div>}
      {factor && <form className="form" onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const result = await authClient.auth.mfa.challengeAndVerify({ factorId: factor, code });
          if (result.error) throw result.error;
          setCode("");
        });
      }}>
        <label>{t.code}<input required inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} /></label>
        <button disabled={busy}>{t.verify}</button>
      </form>}
    </div>}
    {session && <button type="button" disabled={busy} onClick={() => void signOut()}>{t.logout}</button>}
    <p>{t.recoveryHelp}</p>
  </section>;
}
