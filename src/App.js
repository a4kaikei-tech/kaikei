import React, { useState, useEffect, useCallback, useMemo, createContext, useContext } from "react";
import { auth, db, GAS_API_URL } from "./firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile,
  setPersistence,
  browserSessionPersistence,
} from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";

/* ── helpers ── */
function useResponsive() {
  const getWidth = () => (typeof window !== "undefined" ? window.innerWidth : 1200);
  const [width, setWidth] = useState(getWidth());

  useEffect(() => {
    const onResize = () => setWidth(getWidth());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return {
    width,
    isMobile: width < 768,
    isTablet: width >= 768 && width < 1024,
    isDesktop: width >= 1024,
  };
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const toDate = (d) => (d instanceof Timestamp ? d.toDate() : new Date(d));
const fmtDate = (d) => { if (!d) return ""; const dt = toDate(d); return `${dt.getFullYear()}/${(dt.getMonth()+1).toString().padStart(2,"0")}/${dt.getDate().toString().padStart(2,"0")}`; };
const fmtYen = (n) => "\u00a5" + (n || 0).toLocaleString("ja-JP");
const fmtMonth = (d) => { const dt = toDate(d); return `${dt.getFullYear()}年${dt.getMonth()+1}月`; };
const monthKey = (d) => { const dt = toDate(d); return `${dt.getFullYear()}-${(dt.getMonth()+1).toString().padStart(2,"0")}`; };

const RoleCtx = createContext({ isAdmin: false });
const useRole = () => useContext(RoleCtx);

/* ── GAS upload ── */
const fileToBase64 = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result.split(",")[1]); r.onerror = reject; r.readAsDataURL(file); });
const gasUpload = async (file) => { const b = await fileToBase64(file); const res = await fetch(GAS_API_URL, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ action: "upload", fileName: file.name, mimeType: file.type, fileData: b }) }); const data = await res.json(); if (!data.success) throw new Error(data.error || "アップロード失敗"); return data; };
const gasDelete = async (fileId) => { await fetch(GAS_API_URL, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ action: "delete", fileId }) }); };

/* ── Pie chart (SVG) ── */
const PIE_COLORS = ["#10B981","#3B82F6","#F59E0B","#8B5CF6","#EC4899","#06B6D4","#EF4444","#84CC16","#F97316","#6366F1"];
function PieChart({ data, title }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return (
    <div style={{ textAlign: "center", padding: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#94A3B8", marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 12, color: "#475569" }}>今月はありません</div>
    </div>
  );
  let cum = 0;
  const slices = data.map((d, i) => {
    const pct = d.value / total;
    const startAngle = cum * 2 * Math.PI;
    cum += pct;
    const endAngle = cum * 2 * Math.PI;
    const x1 = 50 + 40 * Math.cos(startAngle);
    const y1 = 50 + 40 * Math.sin(startAngle);
    const x2 = 50 + 40 * Math.cos(endAngle);
    const y2 = 50 + 40 * Math.sin(endAngle);
    const large = pct > 0.5 ? 1 : 0;
    const path = pct >= 0.999
      ? `M50,10 A40,40 0 1,1 49.99,10 Z`
      : `M50,50 L${x1},${y1} A40,40 0 ${large},1 ${x2},${y2} Z`;
    return { ...d, path, color: PIE_COLORS[i % PIE_COLORS.length], pct };
  });
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#94A3B8", marginBottom: 8, textAlign: "center" }}>{title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
        <svg viewBox="0 0 100 100" width="120" height="120">
          {slices.map((s, i) => <path key={i} d={s.path} fill={s.color} stroke="#1E293B" strokeWidth="0.5" />)}
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {slices.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#94A3B8" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
              <span style={{ minWidth: 60 }}>{s.name}</span>
              <span style={{ fontFamily: "'Space Mono',monospace", color: "#E2E8F0" }}>{fmtYen(s.value)}</span>
              <span style={{ color: "#64748B" }}>({Math.round(s.pct * 100)}%)</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const DEFAULT_ACCOUNTS = [
  { id: "sales", name: "売上高", type: "income", group: "売上" },{ id: "service_income", name: "サービス収入", type: "income", group: "売上" },{ id: "other_income", name: "雑収入", type: "income", group: "売上" },
  { id: "purchases", name: "仕入高", type: "expense", group: "売上原価" },{ id: "salary", name: "給与手当", type: "expense", group: "販管費" },{ id: "rent", name: "地代家賃", type: "expense", group: "販管費" },{ id: "utilities", name: "水道光熱費", type: "expense", group: "販管費" },{ id: "communication", name: "通信費", type: "expense", group: "販管費" },{ id: "transport", name: "旅費交通費", type: "expense", group: "販管費" },{ id: "supplies", name: "消耗品費", type: "expense", group: "販管費" },{ id: "entertainment", name: "接待交際費", type: "expense", group: "販管費" },{ id: "advertising", name: "広告宣伝費", type: "expense", group: "販管費" },{ id: "insurance", name: "保険料", type: "expense", group: "販管費" },{ id: "depreciation", name: "減価償却費", type: "expense", group: "販管費" },{ id: "tax", name: "租税公課", type: "expense", group: "販管費" },{ id: "misc_expense", name: "雑費", type: "expense", group: "販管費" },
];

const INVOICE_STATUS = {
  draft: { bg: "#DBEAFE", text: "#1E40AF", label: "申請中", cardBorder: "#3B82F6", cardBg: "rgba(59,130,246,.06)" },
  sent:  { bg: "#FEF3C7", text: "#92400E", label: "精算待ち", cardBorder: "#F59E0B", cardBg: "rgba(245,158,11,.06)" },
  paid:  { bg: "#D1FAE5", text: "#065F46", label: "精算済み", cardBorder: "#10B981", cardBg: "rgba(16,185,129,.06)" },
};
const StatusBadge = ({ status }) => { const s = INVOICE_STATUS[status] || { bg: "#334155", text: "#94A3B8", label: status }; return <span style={{ background: s.bg, color: s.text, padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{s.label}</span>; };

const ReadOnlyBanner = () => (
  <div style={{ background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.3)", borderRadius: 8, padding: "8px 16px", marginBottom: 20, fontSize: 12, color: "#F59E0B", display: "flex", alignItems: "center", gap: 8 }}>
    🔒 閲覧モード — データの編集は管理者のみ可能です
  </div>
);

/* ── UI ── */
const Card = ({ children, style = {}, onClick }) => (<div onClick={onClick} style={{ background: "#1E293B", borderRadius: 12, padding: 24, border: "1px solid #334155", ...style }}>{children}</div>);
const PageTitle = ({ children, sub, right }) => {
  const { isMobile } = useResponsive();

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: isMobile ? "stretch" : "flex-start",
        flexDirection: isMobile ? "column" : "row",
        marginBottom: 28,
        gap: 12,
      }}
    >
      <div>
        <h1 style={{ fontSize: isMobile ? 20 : 22, fontWeight: 700, color: "#F1F5F9" }}>
          {children}
        </h1>
        {sub && <p style={{ color: "#64748B", fontSize: 13, marginTop: 4 }}>{sub}</p>}
      </div>
      {right && <div style={{ width: isMobile ? "100%" : "auto" }}>{right}</div>}
    </div>
  );
};
const Btn = ({ children, onClick, variant = "primary", disabled, style = {} }) => {
  const v = {
    primary: { background: "linear-gradient(135deg,#10B981,#059669)", color: "#fff" },
    secondary: { background: "#334155", color: "#E2E8F0" },
    danger: { background: "#DC2626", color: "#fff" },
    ghost: { background: "transparent", color: "#94A3B8", border: "1px solid #334155" },
    accent: { background: "linear-gradient(135deg,#3B82F6,#6366F1)", color: "#fff" },
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "10px 18px",
        minHeight: 40,
        borderRadius: 8,
        border: "none",
        cursor: disabled ? "default" : "pointer",
        fontSize: 13,
        fontWeight: 600,
        opacity: disabled ? 0.5 : 1,
        ...v[variant],
        ...style,
      }}
    >
      {children}
    </button>
  );
};
const inputBase = { width: "100%", padding: "10px 14px", background: "#0F172A", border: "1px solid #334155", borderRadius: 8, color: "#E2E8F0", fontSize: 14, outline: "none", fontFamily: "'Noto Sans JP',sans-serif" };

/* ══════════════════ ROOT ══════════════════ */
export default function App() {
  const [user, setUser] = useState(null); const [profile, setProfile] = useState(null);
  const [page, setPage] = useState("login"); const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const showToast = (msg, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };
  useEffect(() => {
    let unsub;
    (async () => {
      await setPersistence(auth, browserSessionPersistence);
      unsub = onAuthStateChanged(auth, async (u) => {
        if (u) {
          setUser(u);
          const snap = await getDoc(doc(db, "users", u.uid));
          if (snap.exists()) {
            setProfile(snap.data()); setPage("dashboard");
          } else {
            const newProfile = {
              uid: u.uid,
              email: u.email,
              companyName: u.displayName || u.email,
              role: "member",
              createdAt: serverTimestamp(),
              fiscalYearStart: 4,
            };
            await setDoc(doc(db, "users", u.uid), newProfile);
            const accSnap = await getDoc(doc(db, "settings", "accounts"));
            if (!accSnap.exists()) await setDoc(doc(db, "settings", "accounts"), { list: DEFAULT_ACCOUNTS });
            setProfile({ ...newProfile, createdAt: new Date() });
            setPage("dashboard");
          }
        } else {
          setUser(null); setProfile(null); setPage("login");
        }
        setLoading(false);
      });
    })();
    return () => { if (unsub) unsub(); };
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    // 端末に残る可能性のあるキャッシュをすべて消去
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
    try {
      const dbs = await indexedDB.databases();
      for (const d of dbs) { if (d.name) indexedDB.deleteDatabase(d.name); }
    } catch {}
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        for (const k of keys) { await caches.delete(k); }
      }
    } catch {}
  };
  const isAdmin = profile?.role === "admin";
  if (loading) return (<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0F172A", fontFamily: "'Noto Sans JP',sans-serif" }}><div style={{ textAlign: "center", color: "#94A3B8" }}><div style={{ width: 40, height: 40, border: "3px solid #334155", borderTop: "3px solid #10B981", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />読み込み中...</div><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>);
  return (
    <RoleCtx.Provider value={{ isAdmin }}>
    <div style={{ minHeight: "100vh", background: "#0F172A", fontFamily: "'Noto Sans JP',sans-serif", color: "#E2E8F0" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}} @keyframes toastIn{from{opacity:0;transform:translateY(-20px)}to{opacity:1;transform:translateY(0)}} *{box-sizing:border-box;margin:0;padding:0} input,select,textarea,button{font-family:'Noto Sans JP',sans-serif} input::placeholder,textarea::placeholder{color:#475569} ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:#1E293B}::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}`}</style>
      {toast && <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999, background: toast.type === "error" ? "#DC2626" : "#059669", color: "#fff", padding: "10px 24px", borderRadius: 8, fontSize: 14, fontWeight: 500, animation: "toastIn .3s ease", boxShadow: "0 8px 32px rgba(0,0,0,.3)" }}>{toast.msg}</div>}
      {(!user || !profile) && <AuthPage page={page} setPage={setPage} showToast={showToast} />}
      {user && profile && (
        <MainLayout 
          profile={profile} 
          user={user} 
          page={page} 
          setProfile={setProfile}
          setPage={setPage} 
          logout={handleLogout} 
          showToast={showToast} 
        />
      )}
    </div>
    </RoleCtx.Provider>
  );
}

function AuthPage({ page, setPage, showToast }) {
  const { isMobile } = useResponsive();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) return showToast("メールアドレスとパスワードを入力してください", "error");
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      console.error(e);
      showToast("ログインに失敗しました", "error");
    }
    setBusy(false);
  };

  const handleRegister = async () => {
    if (!email || !password || !companyName) return showToast("すべて入力してください", "error");
    if (password.length < 6) return showToast("パスワードは6文字以上", "error");

    setBusy(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);

      await setDoc(doc(db, "users", cred.user.uid), {
        uid: cred.user.uid,
        email,
        companyName,
        role,
        createdAt: serverTimestamp(),
        fiscalYearStart: 4,
      });

      if (role === "admin") {
        const snap = await getDoc(doc(db, "settings", "accounts"));
        if (!snap.exists()) {
          await setDoc(doc(db, "settings", "accounts"), { list: DEFAULT_ACCOUNTS });
        }
      }

      showToast("登録完了！");
      setPage("login");
    } catch (e) {
      console.error(e);
      showToast("登録失敗: " + e.code, "error");
    }
    setBusy(false);
  };

  const handleForgotPassword = async () => {
    if (!email) return showToast("メールアドレスを入力してください", "error");

    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email);
      showToast("パスワード再設定メールを送信しました");
      setPage("login");
    } catch (e) {
      console.error(e);
      showToast("再設定メールの送信に失敗しました", "error");
    }
    setBusy(false);
  };

  const handleGoogleLogin = async () => {
    setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (e) {
      if (e.code !== "auth/popup-closed-by-user") {
        console.error(e);
        showToast("Googleログインに失敗しました", "error");
      }
    }
    setBusy(false);
  };

  const title =
    page === "login"
      ? "ログイン"
      : page === "register"
      ? "新規登録"
      : "パスワード再設定";

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 420, animation: "fadeIn .5s ease" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              margin: "0 auto 16px",
              background: "linear-gradient(135deg,#10B981,#059669)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 26,
              fontWeight: 700,
              color: "#fff",
              boxShadow: "0 8px 32px rgba(16,185,129,.3)",
            }}
          >
            ¥
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#F1F5F9" }}>A4-Kaikei</h1>
          <p style={{ color: "#64748B", fontSize: 14, marginTop: 4 }}>A4共益費管理システム</p>
        </div>

        <div
          style={{
            background: "#1E293B",
            borderRadius: 16,
            padding: isMobile ? 20 : 32,
            border: "1px solid #334155",
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 24, color: "#F1F5F9" }}>{title}</h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {page === "register" && (
              <div>
                <label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 6, display: "block" }}>名前</label>
                <input
                  style={inputBase}
                  placeholder="株式会社サンプル"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </div>
            )}

            <div>
              <label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 6, display: "block" }}>メールアドレス</label>
              <input
                style={inputBase}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {page !== "forgot" && (
              <div>
                <label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 6, display: "block" }}>パスワード</label>
                <input
                  style={inputBase}
                  type="password"
                  placeholder="••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      page === "login" ? handleLogin() : handleRegister();
                    }
                  }}
                />
              </div>
            )}

            {page === "forgot" && (
              <p style={{ fontSize: 13, color: "#94A3B8", lineHeight: 1.7 }}>
                登録済みのメールアドレスを入力すると、パスワード再設定用のメールを送信します。
              </p>
            )}

            <button
              onClick={
                page === "login"
                  ? handleLogin
                  : page === "register"
                  ? handleRegister
                  : handleForgotPassword
              }
              disabled={busy}
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                background: "linear-gradient(135deg,#10B981,#059669)",
                color: "#fff",
                fontSize: 15,
                fontWeight: 600,
                marginTop: 8,
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy
                ? "処理中..."
                : page === "login"
                ? "ログイン"
                : page === "register"
                ? "登録する"
                : "再設定メールを送信"}
            </button>

            {page !== "forgot" && (<>
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "4px 0" }}>
                <div style={{ flex: 1, height: 1, background: "#334155" }} />
                <span style={{ fontSize: 11, color: "#64748B" }}>または</span>
                <div style={{ flex: 1, height: 1, background: "#334155" }} />
              </div>
              <button
                onClick={handleGoogleLogin}
                disabled={busy}
                style={{
                  width: "100%", padding: 12, borderRadius: 8,
                  border: "1px solid #334155", cursor: "pointer",
                  background: "#0F172A", color: "#E2E8F0",
                  fontSize: 14, fontWeight: 500,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                  opacity: busy ? 0.6 : 1,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                Googleでログイン
              </button>
            </>)}
          </div>

          <div style={{ textAlign: "center", marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
            {page === "login" && (
              <>
                <button
                  onClick={() => setPage("forgot")}
                  style={{ background: "none", border: "none", color: "#60A5FA", cursor: "pointer", fontSize: 13 }}
                >
                  パスワードをお忘れですか？
                </button>
                <button
                  onClick={() => setPage("register")}
                  style={{ background: "none", border: "none", color: "#34D399", cursor: "pointer", fontSize: 13 }}
                >
                  新規登録はこちら →
                </button>
              </>
            )}

            {page === "register" && (
              <button
                onClick={() => setPage("login")}
                style={{ background: "none", border: "none", color: "#34D399", cursor: "pointer", fontSize: 13 }}
              >
                ログインはこちら →
              </button>
            )}

            {page === "forgot" && (
              <button
                onClick={() => setPage("login")}
                style={{ background: "none", border: "none", color: "#34D399", cursor: "pointer", fontSize: 13 }}
              >
                ログイン画面に戻る →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MainLayout({ profile, user, page, setPage, logout, showToast, setProfile }) {
  const { isAdmin } = useRole();
  const { isMobile } = useResponsive();

  const nav = isAdmin
    ? [
        { id: "dashboard", icon: "📊", label: "ダッシュボード" },
        { id: "journal", icon: "📒", label: "仕訳入力" },
        { id: "ledger", icon: "📖", label: "帳簿" },
        { id: "invoices", icon: "📄", label: "請求書" },
        { id: "collection", icon: "💰", label: "集金" },
        { id: "accounts", icon: "🏷️", label: "勘定科目" },
        { id: "settings", icon: "⚙️", label: "設定" },
      ]
    : [
        { id: "dashboard", icon: "📊", label: "ダッシュボード" },
        { id: "ledger", icon: "📖", label: "帳簿" },
        { id: "invoices", icon: "📄", label: "請求書" },
        { id: "settings", icon: "⚙️", label: "設定" },
      ];

  useEffect(() => {
    if (!isAdmin && (page === "journal" || page === "accounts" || page === "collection")) {
      setPage("dashboard");
    }
  }, [isAdmin, page, setPage]);

  return (
    <div style={{ minHeight: "100vh", display: isMobile ? "block" : "flex" }}>
      {!isMobile ? (
        <div
          style={{
            width: 220,
            background: "#1E293B",
            borderRight: "1px solid #334155",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            position: "sticky",
            top: 0,
            height: "100vh",
            overflowY: "auto",
          }}
        >
          <div style={{ padding: "20px 16px", borderBottom: "1px solid #334155" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  background: "linear-gradient(135deg,#10B981,#059669)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#fff",
                }}
              >
                ¥
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#F1F5F9" }}>A4-Kaikei</div>
                <div
                  style={{
                    fontSize: 10,
                    color: "#64748B",
                    maxWidth: 120,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {profile.companyName}
                </div>
              </div>
            </div>
          </div>

          <nav style={{ padding: "10px 8px", flex: 1 }}>
            {nav.map((n) => (
              <button
                key={n.id}
                onClick={() => setPage(n.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  width: "100%",
                  padding: "9px 11px",
                  borderRadius: 7,
                  border: "none",
                  cursor: "pointer",
                  background: page === n.id ? "rgba(16,185,129,.15)" : "transparent",
                  color: page === n.id ? "#34D399" : "#94A3B8",
                  fontSize: 13,
                  fontWeight: page === n.id ? 600 : 400,
                  marginBottom: 2,
                  textAlign: "left",
                }}
              >
                <span style={{ fontSize: 15 }}>{n.icon}</span>
                {n.label}
              </button>
            ))}
          </nav>

          <div style={{ padding: "14px 12px", borderTop: "1px solid #334155" }}>
            <div style={{ fontSize: 11, color: "#64748B", marginBottom: 4, padding: "0 6px" }}>{profile.email}</div>
            <div style={{ fontSize: 10, padding: "0 6px", marginBottom: 8 }}>
              <span
                style={{
                  background: isAdmin ? "rgba(16,185,129,.15)" : "rgba(59,130,246,.15)",
                  color: isAdmin ? "#10B981" : "#60A5FA",
                  padding: "1px 8px",
                  borderRadius: 4,
                  fontWeight: 600,
                }}
              >
                {isAdmin ? "管理者" : "閲覧メンバー"}
              </span>
            </div>
            <button
              onClick={logout}
              style={{
                width: "100%",
                padding: "7px 10px",
                borderRadius: 6,
                border: "1px solid #334155",
                background: "transparent",
                color: "#EF4444",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              ログアウト
            </button>
          </div>
        </div>
      ) : (
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 20,
            background: "#1E293B",
            borderBottom: "1px solid #334155",
          }}
        >
          <div style={{ padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#F1F5F9" }}>A4-Kaikei</div>
                <div style={{ fontSize: 11, color: "#64748B" }}>{profile.companyName}</div>
              </div>
              <button
                onClick={logout}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #334155",
                  background: "transparent",
                  color: "#EF4444",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                ログアウト
              </button>
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                overflowX: "auto",
                paddingBottom: 4,
              }}
            >
              {nav.map((n) => (
                <button
                  key={n.id}
                  onClick={() => setPage(n.id)}
                  style={{
                    flex: "0 0 auto",
                    padding: "8px 12px",
                    borderRadius: 999,
                    border: "1px solid #334155",
                    background: page === n.id ? "rgba(16,185,129,.15)" : "#0F172A",
                    color: page === n.id ? "#34D399" : "#94A3B8",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {n.icon} {n.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          flex: 1,
          padding: isMobile ? 14 : 28,
          overflowY: "auto",
          maxHeight: isMobile ? "none" : "100vh",
        }}
      >
        <div style={{ maxWidth: 960, margin: "0 auto", animation: "fadeIn .3s ease" }}>
          {!isAdmin && page !== "invoices" && <ReadOnlyBanner />}
          {isAdmin && (() => {
            const now = new Date();
            if (now.getMonth() === 2 && now.getDate() >= 20) {
              return (
                <div style={{ background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.3)", borderRadius: 8, padding: "12px 16px", marginBottom: 20, display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span style={{ fontSize: 20, lineHeight: 1 }}>⚠️</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#F59E0B", marginBottom: 4 }}>年度末のお知らせ</div>
                    <div style={{ fontSize: 12, color: "#94A3B8", lineHeight: 1.6 }}>3月末が近づいています。帳簿の金額と実際の残高が一致しているか確認してください。未精算の申請書がないかもあわせてご確認ください。</div>
                  </div>
                </div>
              );
            }
            return null;
          })()}

          {page === "dashboard" && <Dashboard user={user} profile={profile} setPage={setPage} />}
          {page === "journal" && isAdmin && <JournalEntry user={user} showToast={showToast} setPage={setPage} />}
          {page === "ledger" && <Ledger user={user} showToast={showToast} />}
          {page === "invoices" && <InvoicesPage user={user} profile={profile} showToast={showToast} />}
          {page === "settings" && <SettingsPage user={user} profile={profile} showToast={showToast} setProfile={setProfile} />}
          {page === "collection" && isAdmin && <CollectionPage />}
          {page === "accounts" && isAdmin && <AccountsPage user={user} showToast={showToast} />}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════ Dashboard ══════════════════ */
function Dashboard({ user, profile, setPage }) {
  const [entries, setEntries] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fiscalYearName, setFiscalYearName] = useState("");
  const { isAdmin } = useRole();
  const { isMobile } = useResponsive();

  useEffect(() => {
    (async () => {
      const eS = await getDocs(collection(db, "entries"));
      const eA = [];
      eS.forEach((d) => eA.push({ id: d.id, ...d.data() }));
      setEntries(eA);

      const iS = await getDocs(collection(db, "invoices"));
      const iA = [];
      iS.forEach((d) => iA.push({ id: d.id, ...d.data() }));
      setInvoices(iA);

      // 会計担当者を取得
      const fySnap = await getDoc(doc(db, "settings", "general"));
      if (fySnap.exists() && fySnap.data().fiscalYearName) {
        setFiscalYearName(fySnap.data().fiscalYearName);
      }

      setLoading(false);
    })();
  }, []);

  const now = new Date();
  const mk = monthKey(now);
  const me = entries.filter((e) => e.date && monthKey(e.date) === mk);

  const inc = me.filter((e) => e.type === "income").reduce((s, e) => s + (e.amount || 0), 0);
  const exp = me.filter((e) => e.type === "expense").reduce((s, e) => s + (e.amount || 0), 0);
  const profit = inc - exp;
  const unpaid = invoices.filter((i) => i.status === "draft" || i.status === "sent");
  const unpaidTotal = unpaid.reduce((s, i) => s + (i.total || 0), 0);

  const monthly = useMemo(() => {
    const d = [];
    for (let i = 5; i >= 0; i--) {
      const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const m = monthKey(dt);
      const me2 = entries.filter((e) => e.date && monthKey(e.date) === m);
      d.push({
        month: `${dt.getMonth() + 1}月`,
        income: me2.filter((e) => e.type === "income").reduce((s, e) => s + (e.amount || 0), 0),
        expense: me2.filter((e) => e.type === "expense").reduce((s, e) => s + (e.amount || 0), 0),
      });
    }
    return d;
  }, [entries, now]);

  const maxV = Math.max(...monthly.map((d) => Math.max(d.income, d.expense)), 1);

  const totalIn = entries.filter((e) => e.type === "income").reduce((s, e) => s + e.amount, 0);
  const totalOut = entries.filter((e) => e.type === "expense").reduce((s, e) => s + e.amount, 0);
  const balance = totalIn - totalOut;

  if (loading) return <p style={{ color: "#64748B" }}>読み込み中...</p>;

  const stats = [
    { label: "残高", value: fmtYen(balance), color: "#FFFFFF" },
    { label: "今月の収入", value: fmtYen(inc), color: "#10B981", icon: "↑" },
    { label: "今月の支出", value: fmtYen(exp), color: "#F59E0B", icon: "↓" },
  ];

  return (
    <div>
      <PageTitle sub={`${profile.companyName} — ${fmtMonth(now)}`}>ダッシュボード</PageTitle>

      {fiscalYearName && (
        <Card style={{ padding: "14px 20px", marginBottom: 20, background: "rgba(16,185,129,.06)", borderLeft: "3px solid #10B981" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#F1F5F9" }}>現在の会計担当: <span style={{ color: "#34D399" }}>{fiscalYearName}</span></div>
        </Card>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "repeat(3,1fr)",
          gap: 14,
          marginBottom: 24,
        }}
      >
        {stats.map((s, i) => (
          <Card key={i} style={{ padding: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: "#94A3B8" }}>{s.label}</span>
              <span style={{ fontSize: 18 }}>{s.icon}</span>
            </div>
            <div
              style={{
                fontSize: isMobile ? 20 : 22,
                fontWeight: 700,
                color: s.color,
                fontFamily: "'Space Mono',monospace",
              }}
            >
              {s.value}
            </div>
            {s.sub && <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>{s.sub}</div>}
          </Card>
        ))}
      </div>

      <Card style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: "#F1F5F9", marginBottom: 20 }}>月別収支推移</h3>

        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 160, minWidth: 420 }}>
            {monthly.map((d, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 130, width: "100%" }}>
                  <div
                    style={{
                      flex: 1,
                      background: "linear-gradient(180deg,#10B981,#059669)",
                      borderRadius: "4px 4px 0 0",
                      minHeight: 2,
                      height: `${(d.income / maxV) * 100}%`,
                    }}
                  />
                  <div
                    style={{
                      flex: 1,
                      background: "linear-gradient(180deg,#F59E0B,#D97706)",
                      borderRadius: "4px 4px 0 0",
                      minHeight: 2,
                      height: `${(d.expense / maxV) * 100}%`,
                    }}
                  />
                </div>
                <span style={{ fontSize: 11, color: "#64748B" }}>{d.month}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 16, marginTop: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#94A3B8" }}>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                background: "#10B981",
                borderRadius: 2,
                marginRight: 4,
              }}
            />
            収入
          </span>
          <span style={{ fontSize: 11, color: "#94A3B8" }}>
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                background: "#F59E0B",
                borderRadius: 2,
                marginRight: 4,
              }}
            />
            支出
          </span>
        </div>
      </Card>

      {isAdmin && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "repeat(2,1fr)",
            gap: 14,
          }}
        >
          {[["journal", "📒", "仕訳を入力"], ["invoices", "📄", "請求書を作成"]].map(
            ([id, ic, lb]) => (
              <Card key={id} style={{ cursor: "pointer" }} onClick={() => setPage(id)}>
                <div style={{ textAlign: "center", padding: "8px 0" }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>{ic}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#F1F5F9" }}>{lb}</div>
                </div>
              </Card>
            )
          )}
        </div>
      )}
    </div>
  );
}

/* ══════════════════ JOURNAL ══════════════════ */
function JournalEntry({ user, showToast, setPage }) {
  const { isAdmin } = useRole();
  const { isMobile } = useResponsive();

  const [accounts, setAccounts] = useState([]);
  const [type, setType] = useState("expense");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [taxRate, setTaxRate] = useState(10);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await getDoc(doc(db, "settings", "accounts"));
      if (s.exists()) setAccounts(s.data().list || []);
    })();
  }, []);

  const filtered = accounts.filter((a) => a.type === type);
  const taxAmount = Math.floor(((parseInt(amount) || 0) * taxRate) / (100 + taxRate));

  const handleSubmit = async () => {
    if (!isAdmin) return showToast("管理者のみ登録できます", "error");
    if (!accountId || !amount || !date) return showToast("必須項目を入力してください", "error");

    setBusy(true);
    const acc = accounts.find((a) => a.id === accountId);

    await setDoc(doc(db, "entries", uid()), {
      type,
      accountId,
      accountName: acc?.name || "",
      amount: parseInt(amount),
      date,
      description,
      taxRate,
      taxAmount,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    });

    showToast("仕訳を登録しました！");
    setAmount("");
    setDescription("");
    setAccountId("");
    setBusy(false);
  };

  if (!isAdmin) {
    return (
      <div>
        <PageTitle sub="管理者のみ入力可能です">仕訳入力</PageTitle>
        <Card>
          <p style={{ color: "#475569", textAlign: "center", padding: 20 }}>
            仕訳の入力は管理者のみ可能です。帳簿から閲覧できます。
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageTitle sub="収入・支出を記録">仕訳入力</PageTitle>

      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 8, display: "block" }}>区分</label>
            <div style={{ display: "flex", gap: 8 }}>
              {[["income", "収入", "#10B981"], ["expense", "支出", "#F59E0B"]].map(([t, l, c]) => (
                <button
                  key={t}
                  onClick={() => {
                    setType(t);
                    setAccountId("");
                    if (t === "income") setTaxRate(0);
                  }}
                  style={{
                    flex: 1,
                    padding: 12,
                    borderRadius: 8,
                    border: `2px solid ${type === t ? c : "#334155"}`,
                    background: type === t ? c + "15" : "#0F172A",
                    color: type === t ? c : "#94A3B8",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 6, display: "block" }}>勘定科目</label>
              <select style={{ ...inputBase, cursor: "pointer" }} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">選択してください</option>
                {filtered.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 6, display: "block" }}>日付</label>
              <input
                type="date"
                style={{ ...inputBase, colorScheme: "dark", width: "100%", minWidth: 0 }}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : (type === "expense" ? "2fr 1fr" : "1fr"), gap: 16 }}>
            <div>
              <label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 6, display: "block" }}>金額{type === "expense" ? "（税込）" : ""}</label>
              <input
                style={inputBase}
                type="number"
                placeholder="10000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              {type === "expense" && amount && <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>うち消費税: {fmtYen(taxAmount)}</div>}
            </div>

            {type === "expense" && (
            <div>
              <label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 6, display: "block" }}>税率</label>
              <select style={{ ...inputBase, cursor: "pointer" }} value={taxRate} onChange={(e) => setTaxRate(+e.target.value)}>
                <option value={10}>10%</option>
                <option value={8}>8%（軽減）</option>
                <option value={0}>非課税</option>
              </select>
            </div>
            )}
          </div>

          <div>
            <label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 6, display: "block" }}>摘要</label>
            <input
              style={inputBase}
              placeholder="取引内容を入力..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              flexDirection: isMobile ? "column" : "row",
            }}
          >
            <Btn variant="ghost" onClick={() => setPage("ledger")} style={isMobile ? { width: "100%" } : {}}>
              帳簿を見る
            </Btn>
            <Btn onClick={handleSubmit} disabled={busy} style={isMobile ? { width: "100%" } : {}}>
              {busy ? "保存中..." : "登録する"}
            </Btn>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ══════════════════ LEDGER ══════════════════ */
function Ledger({ user, showToast }) {
  const { isAdmin } = useRole();
  const { isMobile } = useResponsive();

  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("month");
  const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());

  const load = useCallback(async () => {
    setLoading(true);
    const s = await getDocs(collection(db, "entries"));
    const a = [];
    s.forEach((d) => a.push({ id: d.id, ...d.data() }));
    setEntries(a.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = viewMode === "month"
    ? entries.filter((e) => e.date && e.date.startsWith(filterMonth))
    : entries.filter((e) => e.date && e.date.startsWith(String(filterYear)));
  const tInc = filtered.filter((e) => e.type === "income").reduce((s, e) => s + (e.amount || 0), 0);
  const tExp = filtered.filter((e) => e.type === "expense").reduce((s, e) => s + (e.amount || 0), 0);

  const del = async (id) => {
    if (!isAdmin) return showToast("管理者のみ削除できます", "error");
    await deleteDoc(doc(db, "entries", id));
    showToast("削除しました");
    load();
  };

  return (
    <div>
      <PageTitle
        right={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", width: isMobile ? "100%" : "auto" }}>
            <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid #334155" }}>
              <button onClick={() => setViewMode("month")} style={{ padding: "6px 12px", fontSize: 12, border: "none", cursor: "pointer", background: viewMode === "month" ? "#10B981" : "#1E293B", color: viewMode === "month" ? "#fff" : "#94A3B8", fontWeight: 600 }}>月別</button>
              <button onClick={() => setViewMode("year")} style={{ padding: "6px 12px", fontSize: 12, border: "none", cursor: "pointer", background: viewMode === "year" ? "#10B981" : "#1E293B", color: viewMode === "year" ? "#fff" : "#94A3B8", fontWeight: 600 }}>年間</button>
            </div>
            {viewMode === "month" ? (
              <input type="month" style={{ ...inputBase, width: isMobile ? "100%" : "auto", colorScheme: "dark" }} value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} />
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button onClick={() => setFilterYear(filterYear - 1)} style={{ background: "none", border: "1px solid #334155", color: "#94A3B8", borderRadius: 4, padding: "4px 8px", cursor: "pointer" }}>◀</button>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#F1F5F9", minWidth: 50, textAlign: "center" }}>{filterYear}年</span>
                <button onClick={() => setFilterYear(filterYear + 1)} style={{ background: "none", border: "1px solid #334155", color: "#94A3B8", borderRadius: 4, padding: "4px 8px", cursor: "pointer" }}>▶</button>
              </div>
            )}
          </div>
        }
      >
        帳簿
      </PageTitle>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        <Card style={{ padding: 16 }}><div style={{ fontSize: 11, color: "#94A3B8" }}>収入合計</div><div style={{ fontSize: 20, fontWeight: 700, color: "#10B981", fontFamily: "'Space Mono',monospace" }}>{fmtYen(tInc)}</div></Card>
        <Card style={{ padding: 16 }}><div style={{ fontSize: 11, color: "#94A3B8" }}>支出合計</div><div style={{ fontSize: 20, fontWeight: 700, color: "#F59E0B", fontFamily: "'Space Mono',monospace" }}>{fmtYen(tExp)}</div></Card>
        <Card style={{ padding: 16 }}><div style={{ fontSize: 11, color: "#94A3B8" }}>差引</div><div style={{ fontSize: 20, fontWeight: 700, color: tInc - tExp >= 0 ? "#3B82F6" : "#EF4444", fontFamily: "'Space Mono',monospace" }}>{fmtYen(tInc - tExp)}</div></Card>
      </div>

      {/* 科目別 円グラフ */}
      {!loading && (() => {
        const incByAcc = {}; const expByAcc = {};
        filtered.forEach(e => {
          const name = e.accountName || e.account || "未分類";
          if (e.type === "income") incByAcc[name] = (incByAcc[name] || 0) + (e.amount || 0);
          else if (e.type === "expense") expByAcc[name] = (expByAcc[name] || 0) + (e.amount || 0);
        });
        const incData = Object.entries(incByAcc).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
        const expData = Object.entries(expByAcc).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
        return (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 14, marginBottom: 20 }}>
            <Card style={{ padding: 20 }}><PieChart data={incData} title="収入の内訳" /></Card>
            <Card style={{ padding: 20 }}><PieChart data={expData} title="支出の内訳" /></Card>
          </div>
        );
      })()}

      {loading ? (
        <p style={{ color: "#64748B" }}>読み込み中...</p>
      ) : filtered.length === 0 ? (
        <Card><p style={{ color: "#475569", textAlign: "center", padding: 20 }}>この期間の帳簿はありません</p></Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#0F172A" }}>
                  {["日付", "区分", "勘定科目", "摘要", "金額", ...(isAdmin ? [""] : [])].map((h) => (
                    <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: "#64748B", fontWeight: 500, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} style={{ borderTop: "1px solid #334155" }}>
                    <td style={{ padding: "10px 14px", color: "#94A3B8", fontFamily: "'Space Mono',monospace", fontSize: 12 }}>{e.createdAt ? fmtDate(e.createdAt) : e.date}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: e.type === "income" ? "rgba(16,185,129,.15)" : "rgba(245,158,11,.15)", color: e.type === "income" ? "#10B981" : "#F59E0B" }}>{e.type === "income" ? "収入" : "支出"}</span>
                    </td>
                    <td style={{ padding: "10px 14px", color: "#E2E8F0" }}>{e.accountName || e.account || "—"}</td>
                    <td style={{ padding: "10px 14px", color: "#94A3B8" }}>{e.description || e.note || "—"}</td>
                    <td style={{ padding: "10px 14px", fontWeight: 600, fontFamily: "'Space Mono',monospace", color: e.type === "income" ? "#10B981" : "#F59E0B" }}>{fmtYen(e.amount)}</td>
                    {isAdmin && (
                      <td style={{ padding: "10px 14px" }}>
                        <button onClick={() => del(e.id)} style={{ background: "none", border: "none", color: "#64748B", cursor: "pointer", fontSize: 14 }}>✕</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ══════════════════ INVOICES ══════════════════ */
function InvoicesPage({ user, profile, showToast }) {
  const { isAdmin } = useRole();
  const { isMobile } = useResponsive();

  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [issaving, setIsSaving] = useState(false);
  const [accountList, setAccountList] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [file, setFile] = useState(null);

  const [form, setForm] = useState({
    client: "",
    items: [{ name: "", qty: 1, price: 0, taxRate: 10 }],
    dueDate: "",
    notes: "",
    receiptUrl: "",
    receiptDriveId: "",
  });

  const load = useCallback(() => {
    // kept for manual reload after mutations
  }, []);

  useEffect(() => {
    // Realtime listener — status changes reflect immediately
    const unsub = onSnapshot(collection(db, "invoices"), (snap) => {
      const a = [];
      snap.forEach((d) => a.push({ id: d.id, ...d.data() }));
      setInvoices(a.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
      setLoading(false);
    }, (err) => {
      console.error(err);
      showToast("読み込み失敗", "error");
      setLoading(false);
    });

    const loadAccounts = async () => {
      const snap = await getDoc(doc(db, "settings", "accounts"));
      if (snap.exists()) {
        const list = snap.data().list.filter((a) => a.type === "expense");
        setAccountList(list);
        if (list.length > 0) setSelectedAccount(list[0].name);
      }
    };
    loadAccounts();

    return unsub;
  }, [showToast]);

  const calc = useMemo(() => {
    let sub10 = 0, sub8 = 0, sub0 = 0;
    form.items.forEach((item) => {
      const amount = (item.qty || 1) * (item.price || 0);
      if (item.taxRate === 8) sub8 += amount;
      else if (item.taxRate === 0) sub0 += amount;
      else sub10 += amount;
    });
    const tax10 = Math.floor(sub10 * 0.1);
    const tax8 = Math.floor(sub8 * 0.08);
    return { total: sub10 + sub8 + sub0 + tax10 + tax8, tax: tax10 + tax8 };
  }, [form.items]);

  const saveInvoice = async () => {
    if (!form.client) return showToast("買い出し先を入力してください", "error");

    setIsSaving(true);
    try {
      let url = form.receiptUrl || "";
      let driveId = form.receiptDriveId || "";

      if (file) {
        const res = await gasUpload(file);
        url = res?.fileUrl || res?.url || "";
        driveId = res?.fileId || res?.id || "";
      }

      const isEdit = !!form.id;
      const invoiceId = isEdit ? form.id : uid();

      const payload = {
        client: form.client || "",
        items: form.items || [],
        dueDate: form.dueDate || "",
        notes: form.notes || "",
        receiptUrl: url,
        receiptDriveId: driveId,
        total: calc.total || 0,
        tax: calc.tax || 0,
        updatedAt: serverTimestamp(),
      };

      if (!isEdit) {
        payload.id = invoiceId;
        payload.createdBy = user.uid;
        payload.createdAt = serverTimestamp();
        payload.status = "draft";
        payload.companyName = profile?.companyName || user.displayName || "Unknown";
      }

      await setDoc(doc(db, "invoices", invoiceId), payload, { merge: true });

      showToast(isEdit ? "更新しました" : "申請しました");

      setForm({
        client: "",
        items: [{ name: "", qty: 1, price: 0, taxRate: 10 }],
        dueDate: "",
        notes: "",
        receiptUrl: "",
        receiptDriveId: "",
      });
      setFile(null);
      setShowForm(false);
      load();
    } catch (e) {
      console.error("Firebase Save Error:", e);
      showToast("保存に失敗しました。未入力項目がないか確認してください", "error");
    }
    setIsSaving(false);
  };

  return (
    <div>
      <PageTitle
        right={
          <Btn
            onClick={() => {
              setShowForm(!showForm);
              if (!showForm) {
                setForm({
                  client: "",
                  items: [{ name: "", qty: 1, price: 0, taxRate: 10 }],
                  dueDate: "",
                  notes: "",
                  receiptUrl: "",
                  receiptDriveId: "",
                });
                setFile(null);
              }
            }}
            style={isMobile ? { width: "100%" } : {}}
          >
            {showForm ? "閉じる" : "新規申請"}
          </Btn>
        }
      >
        請求書・立替申請
      </PageTitle>

      {showForm && (
        <Card style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
              <div>
                <label style={{ fontSize: 11, color: "#94A3B8", marginBottom: 6, display: "block" }}>買い出し先</label>
                <input
                  style={inputBase}
                  placeholder="店舗名"
                  value={form.client}
                  onChange={(e) => setForm({ ...form, client: e.target.value })}
                />
              </div>

              <div>
                <label style={{ fontSize: 11, color: "#94A3B8", marginBottom: 6, display: "block" }}>日付</label>
                <input
                  type="date"
                  style={{ ...inputBase, colorScheme: "dark", width: "100%", minWidth: 0 }}
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: 11, color: "#94A3B8", marginBottom: 6, display: "block" }}>購入明細</label>

              {form.items.map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    flexDirection: isMobile ? "column" : "row",
                    gap: 6,
                    marginBottom: 10,
                    alignItems: isMobile ? "stretch" : "center",
                  }}
                >
                  <input
                    style={{ ...inputBase, flex: 3 }}
                    placeholder="品目"
                    value={item.name}
                    onChange={(e) => {
                      const newItems = [...form.items];
                      newItems[i].name = e.target.value;
                      setForm({ ...form, items: newItems });
                    }}
                  />

                  <input
                    style={{ ...inputBase, flex: 1.5 }}
                    type="number"
                    placeholder="金額"
                    value={item.price || ""}
                    onChange={(e) => {
                      const newItems = [...form.items];
                      newItems[i].price = Number(e.target.value);
                      setForm({ ...form, items: newItems });
                    }}
                  />

                  <select
                    style={{ ...inputBase, flex: 1.2 }}
                    value={item.taxRate}
                    onChange={(e) => {
                      const newItems = [...form.items];
                      newItems[i].taxRate = Number(e.target.value);
                      setForm({ ...form, items: newItems });
                    }}
                  >
                    <option value={10}>10%</option>
                    <option value={8}>8%</option>
                    <option value={0}>非課税</option>
                  </select>

                  {form.items.length > 1 && (
                    <button
                      style={{
                        background: "none",
                        border: "none",
                        color: "#EF4444",
                        cursor: "pointer",
                        fontSize: 11,
                        alignSelf: isMobile ? "flex-end" : "center",
                      }}
                      onClick={() => {
                        setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) });
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}

              <button
                style={{
                  background: "none",
                  border: "none",
                  color: "#34D399",
                  fontSize: 12,
                  cursor: "pointer",
                  marginTop: 4,
                  fontWeight: "bold",
                }}
                onClick={() => {
                  setForm({
                    ...form,
                    items: [...form.items, { name: "", qty: 1, price: 0, taxRate: 10 }],
                  });
                }}
              >
                + 行を追加
              </button>
            </div>

            <div>
              <label style={{ fontSize: 11, color: "#94A3B8", marginBottom: 6, display: "block" }}>領収書・レシート</label>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setFile(e.target.files[0])}
                style={{ fontSize: 12, color: "#E2E8F0", width: "100%" }}
              />
              {form.receiptUrl && !file && (
                <p style={{ fontSize: 11, color: "#34D399", marginTop: 4 }}>※ 登録済みのファイルがあります</p>
              )}
            </div>

            <div style={{ textAlign: isMobile ? "left" : "right", borderTop: "1px solid #334155", paddingTop: 16 }}>
              <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 4 }}>合計金額 (税込)</div>
              <div
                style={{
                  fontSize: isMobile ? 22 : 24,
                  fontWeight: 800,
                  color: "#F1F5F9",
                  fontFamily: "monospace",
                  marginBottom: 16,
                }}
              >
                {fmtYen(calc.total)}
              </div>
              <Btn onClick={saveInvoice} disabled={issaving} style={{ width: "100%" }}>
                {issaving ? "アップロード中..." : "申請を保存する"}
              </Btn>
            </div>
          </div>
        </Card>
      )}

      {/* 精算待ち — 年度にかかわらず常に表示 */}
      {(() => {
        const pending = invoices.filter(inv => inv.status === "sent");
        if (loading || pending.length === 0) return null;
        const byPerson = {};
        pending.forEach(inv => {
          const name = inv.companyName || "不明";
          if (!byPerson[name]) byPerson[name] = { items: [], total: 0 };
          byPerson[name].items.push(inv);
          byPerson[name].total += inv.total || 0;
        });
        return (
          <Card style={{ marginBottom: 24, borderLeft: "3px solid #F59E0B", background: "rgba(245,158,11,.04)" }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "#F59E0B", marginBottom: 12 }}>精算待ち（{pending.length}件）</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {Object.entries(byPerson).map(([name, data]) => (
                <div key={name} style={{ padding: 12, background: "#0F172A", borderRadius: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#F1F5F9" }}>{name}</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: "#F59E0B", fontFamily: "'Space Mono',monospace" }}>{fmtYen(data.total)}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {data.items.map(inv => (
                      <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#94A3B8" }}>
                        <span>{inv.client} {inv.dueDate && `(${inv.dueDate})`}</span>
                        <span style={{ fontFamily: "'Space Mono',monospace" }}>{fmtYen(inv.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        );
      })()}

      {(() => {
        if (loading) return <p style={{ textAlign: "center", color: "#64748B" }}>読み込み中...</p>;
        if (invoices.length === 0) return <Card><p style={{ color: "#475569", textAlign: "center", padding: 24, fontSize: 14 }}>申請書はありません</p></Card>;

        const years = {};
        invoices.forEach(inv => {
          const yk = inv.dueDate ? inv.dueDate.slice(0, 4) : (inv.createdAt ? toDate(inv.createdAt).getFullYear().toString() : "不明");
          if (!years[yk]) years[yk] = [];
          years[yk].push(inv);
        });
        // 各年内も新しい順にソート
        Object.values(years).forEach(arr => arr.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
        const sortedYears = Object.keys(years).sort((a, b) => b.localeCompare(a));

        return sortedYears.map(yk => (
          <div key={yk} style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "#94A3B8", marginBottom: 10, paddingLeft: 4 }}>{yk === "不明" ? "日付なし" : `${yk}年`}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {years[yk].map(inv => {
                const st = INVOICE_STATUS[inv.status] || INVOICE_STATUS.draft;
                return (
                  <Card key={inv.id} style={{ padding: 16, borderLeft: `3px solid ${st.cardBorder}`, background: st.cardBg }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "center", flexDirection: isMobile ? "column" : "row", gap: 12 }}>
                      <div style={{ width: isMobile ? "100%" : "auto" }}>
                        <div style={{ fontWeight: 700, color: "#F1F5F9" }}>{inv.companyName} <StatusBadge status={inv.status} /></div>
                        <div style={{ fontSize: 13, color: "#34D399" }}>{inv.client}</div>
                        {inv.dueDate && <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>{inv.dueDate}</div>}
                        {inv.account && isAdmin && inv.status === "paid" ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                            <span style={{ fontSize: 11, color: "#94A3B8" }}>科目:</span>
                            <select
                              value={inv.account}
                              onChange={async (e) => {
                                const newAcct = e.target.value;
                                if (!newAcct || newAcct === inv.account) return;
                                try {
                                  // 請求書の科目を更新
                                  await updateDoc(doc(db, "invoices", inv.id), { account: newAcct });
                                  // 紐づく仕訳の科目も同時に更新
                                  if (inv.linkedEntryId) {
                                    await updateDoc(doc(db, "entries", inv.linkedEntryId), { accountName: newAcct });
                                  }
                                  const linked = await getDocs(query(collection(db, "entries"), where("fromInvoiceId", "==", inv.id)));
                                  for (const d of linked.docs) {
                                    await updateDoc(doc(db, "entries", d.id), { accountName: newAcct });
                                  }
                                  showToast("科目を変更しました（帳簿にも反映済み）");
                                  load();
                                } catch (err) { console.error(err); showToast("科目の変更に失敗しました", "error"); }
                              }}
                              style={{ fontSize: 11, padding: "2px 4px", background: "#0F172A", border: "1px solid #334155", borderRadius: 4, color: "#E2E8F0", maxWidth: 130 }}
                            >
                              {accountList.filter((a) => a.type === "expense").map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
                            </select>
                          </div>
                        ) : inv.account ? (
                          <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>科目: {inv.account}</div>
                        ) : null}
                        {inv.settledAt && <div style={{ fontSize: 11, color: "#10B981", marginTop: 2 }}>精算日: {fmtDate(inv.settledAt)}</div>}
                        {inv.receiptUrl && (() => {
                          const created = inv.createdAt ? toDate(inv.createdAt) : null;
                          const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
                          const expired = created && created < oneYearAgo;
                          return expired
                            ? <span style={{ fontSize: 11, color: "#64748B", display: "block", marginTop: 4 }}>※ 1年以上前の領収書は参照できません</span>
                            : <a href={inv.receiptUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#60A5FA", textDecoration: "none", display: "block", marginTop: 4 }}>領収書を表示 ↗</a>;
                        })()}
                      </div>
                      <div style={{ textAlign: isMobile ? "left" : "right", width: isMobile ? "100%" : "auto" }}>
                        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "monospace", color: "#F1F5F9" }}>{fmtYen(inv.total)}</div>
                        <div style={{ marginTop: 8, display: "flex", gap: 8, justifyContent: isMobile ? "flex-start" : "flex-end", alignItems: "center", flexWrap: "wrap" }}>

                          {(isAdmin || (inv.createdBy === user.uid && inv.status === "draft")) && (
                            <button onClick={() => { setForm(inv); setShowForm(true); setFile(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                              style={{ background: "none", border: "1px solid #334155", color: "#94A3B8", padding: "4px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>編集</button>
                          )}

                          {isAdmin && inv.status === "draft" && (
                            <Btn variant="accent" style={{ fontSize: 11, padding: "4px 12px" }} onClick={async () => {
                              await updateDoc(doc(db, "invoices", inv.id), { status: "sent" });
                              showToast("精算待ちに変更しました");
                              load();
                            }}>精算待ちへ</Btn>
                          )}

                          {isAdmin && inv.status === "sent" && (<>
                            <select value={inv._selAccount || ""} onChange={(e) => { inv._selAccount = e.target.value; setInvoices([...invoices]); }}
                              style={{ padding: "3px 6px", fontSize: 11, background: "#0F172A", border: "1px solid #334155", borderRadius: 4, color: "#E2E8F0", maxWidth: 140 }}>
                              <option value="">科目を選択</option>
                              {accountList.filter((a) => a.type === "expense").map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
                            </select>
                            <Btn variant="primary" style={{ fontSize: 11, padding: "4px 12px" }} onClick={async () => {
                              const acct = inv._selAccount || selectedAccount;
                              if (!acct) return showToast("科目を選択してください", "error");
                              const today = new Date().toISOString().slice(0, 10);
                              const entryId = uid();
                              await setDoc(doc(db, "entries", entryId), {
                                date: today, type: "expense", accountName: acct,
                                amount: inv.total, tax: inv.tax, description: (inv.items || []).map(i => i.name).filter(Boolean).join(", ") || inv.client,
                                companyName: inv.companyName, createdBy: user.uid, createdAt: serverTimestamp(),
                                fromInvoiceId: inv.id, receiptUrl: inv.receiptUrl || "",
                              });
                              await updateDoc(doc(db, "invoices", inv.id), { status: "paid", linkedEntryId: entryId, account: acct, settledAt: serverTimestamp() });
                              showToast("精算しました — 仕訳を自動登録しました");
                              load();
                            }}>精算する</Btn>
                          </>)}

                          {isAdmin && inv.status === "paid" && (
                            <Btn variant="ghost" style={{ fontSize: 11, padding: "4px 10px" }} onClick={async () => {
                              await updateDoc(doc(db, "invoices", inv.id), { status: "sent" });
                              showToast("精算待ちに戻しました");
                              load();
                            }}>差し戻す</Btn>
                          )}

                          {(isAdmin || inv.createdBy === user.uid) && (
                            <button onClick={async () => {
                              if (!window.confirm("削除しますか？\n関連する仕訳データも削除されます。")) return;
                              if (inv.receiptDriveId) try { await gasDelete(inv.receiptDriveId); } catch {}
                              if (inv.linkedEntryId) try { await deleteDoc(doc(db, "entries", inv.linkedEntryId)); } catch {}
                              try { const linked = await getDocs(query(collection(db, "entries"), where("fromInvoiceId", "==", inv.id))); for (const d of linked.docs) { await deleteDoc(doc(db, "entries", d.id)); } } catch {}
                              await deleteDoc(doc(db, "invoices", inv.id));
                              showToast("請求書と関連データを削除しました");
                              load();
                            }} style={{ background: "none", border: "none", color: "#EF4444", fontSize: 11, cursor: "pointer" }}>削除</button>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        ));
      })()}
    </div>
  );
}

/* ══════════════════ REPORTS ══════════════════ */
function Reports({ user }) {
  const [entries, setEntries] = useState([]); const [loading, setLoading] = useState(true); const [year, setYear] = useState(new Date().getFullYear());
  useEffect(() => { (async () => { const s = await getDocs(collection(db, "entries")); const a = []; s.forEach(d => a.push({ id: d.id, ...d.data() })); setEntries(a); setLoading(false); })(); }, []);
  const ye = entries.filter(e => e.date && e.date.startsWith(String(year))); const expByAcc = {}; ye.forEach(e => { if (e.type === "expense") { const aName = e.accountName || e.account || "未分類"; expByAcc[aName] = (expByAcc[aName] || 0) + (e.amount || 0); } }); const tInc = ye.filter(e => e.type === "income").reduce((s, e) => s + (e.amount || 0), 0); const tExp = Object.values(expByAcc).reduce((s, v) => s + v, 0);
  const monthlyPL = useMemo(() => { const d = []; for (let m = 1; m <= 12; m++) { const mk2 = `${year}-${m.toString().padStart(2,"0")}`; const me = ye.filter(e => e.date && e.date.startsWith(mk2)); const i2 = me.filter(e => e.type === "income").reduce((s, e) => s + (e.amount || 0), 0); const e2 = me.filter(e => e.type === "expense").reduce((s, e) => s + (e.amount || 0), 0); d.push({ month: m, income: i2, expense: e2, profit: i2 - e2 }); } return d; }, [ye, year]);
  if (loading) return <p style={{ color: "#64748B" }}>読み込み中...</p>;
  const maxExp = Math.max(...Object.values(expByAcc), 1);
  return (<div><PageTitle sub="年間の収支を確認" right={<div style={{ display: "flex", gap: 8 }}><Btn variant="ghost" onClick={() => setYear(year - 1)} style={{ padding: "6px 12px" }}>◀</Btn><span style={{ fontSize: 16, fontWeight: 600, color: "#F1F5F9", lineHeight: "36px" }}>{year}年</span><Btn variant="ghost" onClick={() => setYear(year + 1)} style={{ padding: "6px 12px" }}>▶</Btn></div>}>レポート</PageTitle>
    <Card style={{ marginBottom: 20 }}><h3 style={{ fontSize: 15, fontWeight: 600, color: "#F1F5F9", marginBottom: 16 }}>損益計算書（簡易）</h3><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>{[["総収入", tInc, "#10B981"],["総支出", tExp, "#F59E0B"],["純利益", tInc - tExp, tInc - tExp >= 0 ? "#3B82F6" : "#EF4444"]].map(([l, v, c]) => <div key={l} style={{ padding: 16, background: "#0F172A", borderRadius: 8, textAlign: "center" }}><div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 4 }}>{l}</div><div style={{ fontSize: 24, fontWeight: 700, color: c, fontFamily: "'Space Mono',monospace" }}>{fmtYen(v)}</div></div>)}</div></Card>
    <Card style={{ marginBottom: 20 }}><h3 style={{ fontSize: 15, fontWeight: 600, color: "#F1F5F9", marginBottom: 16 }}>経費内訳</h3>{Object.keys(expByAcc).length === 0 ? <p style={{ color: "#475569", fontSize: 13 }}>データがありません</p> : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{Object.entries(expByAcc).sort((a, b) => b[1] - a[1]).map(([name, amt]) => <div key={name} style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ fontSize: 13, color: "#94A3B8", minWidth: 100 }}>{name}</span><div style={{ flex: 1, background: "#0F172A", borderRadius: 4, height: 24, overflow: "hidden" }}><div style={{ width: `${(amt / maxExp) * 100}%`, height: "100%", background: "linear-gradient(90deg,#F59E0B,#D97706)", borderRadius: 4 }} /></div><span style={{ fontSize: 13, fontWeight: 600, color: "#E2E8F0", fontFamily: "'Space Mono',monospace", minWidth: 90, textAlign: "right" }}>{fmtYen(amt)}</span></div>)}</div>}</Card>
    <Card style={{ padding: 0, overflow: "hidden" }}><h3 style={{ fontSize: 15, fontWeight: 600, color: "#F1F5F9", padding: "16px 20px 0" }}>月別推移</h3><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 12 }}><thead><tr style={{ background: "#0F172A" }}>{["月","収入","支出","利益"].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "right", color: "#64748B", fontWeight: 500, fontSize: 12 }}>{h}</th>)}</tr></thead><tbody>{monthlyPL.map(m => <tr key={m.month} style={{ borderTop: "1px solid #334155" }}><td style={{ padding: "8px 14px", textAlign: "right", color: "#94A3B8" }}>{m.month}月</td><td style={{ padding: "8px 14px", textAlign: "right", color: "#10B981", fontFamily: "'Space Mono',monospace" }}>{fmtYen(m.income)}</td><td style={{ padding: "8px 14px", textAlign: "right", color: "#F59E0B", fontFamily: "'Space Mono',monospace" }}>{fmtYen(m.expense)}</td><td style={{ padding: "8px 14px", textAlign: "right", fontWeight: 600, fontFamily: "'Space Mono',monospace", color: m.profit >= 0 ? "#3B82F6" : "#EF4444" }}>{fmtYen(m.profit)}</td></tr>)}</tbody><tfoot><tr style={{ borderTop: "2px solid #475569", background: "#0F172A" }}><td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600, color: "#F1F5F9" }}>合計</td><td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "#10B981", fontFamily: "'Space Mono',monospace" }}>{fmtYen(tInc)}</td><td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "#F59E0B", fontFamily: "'Space Mono',monospace" }}>{fmtYen(tExp)}</td><td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, fontFamily: "'Space Mono',monospace", color: tInc - tExp >= 0 ? "#3B82F6" : "#EF4444" }}>{fmtYen(tInc - tExp)}</td></tr></tfoot></table></Card>
  </div>);
}

/* ══════════════════ SETTINGS ══════════════════ */
function SettingsPage({ user, profile, setProfile, showToast }) {
  const { isMobile } = useResponsive();
  const { isAdmin } = useRole();

  const [inputValue, setInputValue] = useState(profile?.companyName || user.displayName || "");
  const [updating, setUpdating] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [fiscalYearName, setFiscalYearName] = useState("");
  const [fyUpdating, setFyUpdating] = useState(false);

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, "settings", "general"));
      if (snap.exists() && snap.data().fiscalYearName) {
        setFiscalYearName(snap.data().fiscalYearName);
      }
    })();
  }, []);

  const handleUpdateAll = async () => {
    if (!inputValue.trim()) return showToast("名前を入力してください", "error");
    setUpdating(true);
    try {
      await updateProfile(user, { displayName: inputValue });
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, { companyName: inputValue, updatedAt: serverTimestamp() });
      const invSnap = await getDocs(collection(db, "invoices"));
      const updatePromises = [];
      invSnap.forEach((d) => { if (d.data().createdBy === user.uid) { updatePromises.push(updateDoc(doc(db, "invoices", d.id), { companyName: inputValue })); } });
      if (updatePromises.length > 0) await Promise.all(updatePromises);
      if (setProfile) setProfile({ ...profile, companyName: inputValue });
      await user.reload();
      showToast("すべての名前情報を更新しました");
    } catch (e) { console.error(e); showToast("更新に失敗しました", "error"); }
    setUpdating(false);
  };

  const handleSendResetEmail = async () => {
    setSendingReset(true);
    try { await sendPasswordResetEmail(auth, user.email); showToast("パスワード再設定メールを送信しました"); }
    catch (e) { console.error(e); showToast("再設定メールの送信に失敗しました", "error"); }
    setSendingReset(false);
  };

  const handleFiscalYearUpdate = async () => {
    if (!fiscalYearName.trim()) return showToast("会計担当者を入力してください", "error");
    setFyUpdating(true);
    try {
      await setDoc(doc(db, "settings", "general"), { fiscalYearName }, { merge: true });
      showToast("会計担当者を更新しました");
    } catch (e) { console.error(e); showToast("更新に失敗しました", "error"); }
    setFyUpdating(false);
  };

  return (
    <div>
      <PageTitle sub="アカウント情報の管理">設定</PageTitle>

      {isAdmin && (
        <Card style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "#F1F5F9", marginBottom: 16 }}>会計担当者の設定</h3>
          <div>
            <label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 8, display: "block" }}>
              現在の会計担当者（ダッシュボードに表示されます）
            </label>
            <div style={{ display: "flex", gap: 8, flexDirection: isMobile ? "column" : "row" }}>
              <input
                style={inputBase}
                value={fiscalYearName}
                onChange={(e) => setFiscalYearName(e.target.value)}
                placeholder="例: A401熊野たろう"
              />
              <Btn onClick={handleFiscalYearUpdate} disabled={fyUpdating} style={isMobile ? { width: "100%" } : {}}>
                {fyUpdating ? "更新中..." : "保存"}
              </Btn>
            </div>
            <p style={{ fontSize: 11, color: "#64748B", marginTop: 8 }}>
              ※ この名前は全ユーザーのダッシュボードに「現在の会計担当: ○○」と表示されます。管理者のみ変更可能です。
            </p>
          </div>
        </Card>
      )}

      <Card style={{ marginTop: 8 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#F1F5F9", marginBottom: 20 }}>アカウント設定</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div>
            <label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 8, display: "block" }}>ユーザー名 / 表示名</label>
            <div style={{ display: "flex", gap: 8, flexDirection: isMobile ? "column" : "row" }}>
              <input style={inputBase} value={inputValue} onChange={(e) => setInputValue(e.target.value)} placeholder="名前または会社名" />
              <Btn onClick={handleUpdateAll} disabled={updating} style={isMobile ? { width: "100%" } : {}}>{updating ? "更新中..." : "変更"}</Btn>
            </div>
            <p style={{ fontSize: 11, color: "#64748B", marginTop: 8 }}>※ここを変更すると、請求書に表示される名前やサイドバーの名称がすべて更新されます。</p>
          </div>
          <hr style={{ border: "none", borderTop: "1px solid #334155" }} />
          <div>
            <label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 8, display: "block" }}>セキュリティ</label>
            <div style={{ background: "#0F172A", padding: 16, borderRadius: 8, border: "1px solid #334155" }}>
              <p style={{ fontSize: 13, color: "#E2E8F0", marginBottom: 12, lineHeight: 1.7 }}>パスワード再設定メールを <strong>{user.email}</strong> へ送信します。</p>
              <Btn onClick={handleSendResetEmail} disabled={sendingReset} variant="accent" style={isMobile ? { width: "100%" } : {}}>{sendingReset ? "送信中..." : "再設定メールを送信"}</Btn>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ══════════════════ COLLECTION (集金 — admin only) ══════════════════ */
function CollectionPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const { isMobile } = useResponsive();

  useEffect(() => {
    (async () => {
      const s = await getDocs(collection(db, "entries"));
      const a = [];
      s.forEach((d) => a.push({ id: d.id, ...d.data() }));
      setEntries(a);
      setLoading(false);
    })();
  }, []);

  // 年でフィルタ → 収入のうち摘要が「A4」で始まるもの → 摘要順にグループ化
  const a4Entries = entries
    .filter((e) => e.type === "income" && e.date && e.date.startsWith(String(filterYear)) && (e.description || e.note || "").startsWith("A4"))
    .sort((a, b) => (a.description || a.note || "").localeCompare(b.description || b.note || ""));

  const byName = {};
  a4Entries.forEach((e) => {
    const name = e.description || e.note || "不明";
    if (!byName[name]) byName[name] = { items: [], total: 0 };
    byName[name].items.push(e);
    byName[name].total += e.amount || 0;
  });

  const grandTotal = a4Entries.reduce((s, e) => s + (e.amount || 0), 0);

  if (loading) return <p style={{ color: "#64748B" }}>読み込み中...</p>;

  return (
    <div>
      <PageTitle sub="A4○○の収入を摘要別に集計" right={
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => setFilterYear(filterYear - 1)} style={{ background: "none", border: "1px solid #334155", color: "#94A3B8", borderRadius: 4, padding: "4px 8px", cursor: "pointer" }}>◀</button>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#F1F5F9", minWidth: 50, textAlign: "center" }}>{filterYear}年</span>
          <button onClick={() => setFilterYear(filterYear + 1)} style={{ background: "none", border: "1px solid #334155", color: "#94A3B8", borderRadius: 4, padding: "4px 8px", cursor: "pointer" }}>▶</button>
        </div>
      }>集金</PageTitle>

      <Card style={{ padding: "14px 20px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "#94A3B8" }}>{filterYear}年 — 対象: {a4Entries.length}件</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: "#10B981", fontFamily: "'Space Mono',monospace" }}>{fmtYen(grandTotal)}</span>
        </div>
      </Card>

      {Object.keys(byName).length === 0 ? (
        <Card><p style={{ color: "#475569", textAlign: "center", padding: 24, fontSize: 14 }}>{filterYear}年のA4で始まる収入データはありません</p></Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {Object.entries(byName).map(([name, data]) => (
            <Card key={name} style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: "#F1F5F9" }}>{name}</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#10B981", fontFamily: "'Space Mono',monospace" }}>{fmtYen(data.total)}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {data.items.map((e) => (
                  <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#94A3B8", padding: "2px 0" }}>
                    <span>{e.date} — {e.accountName || e.account || "—"}</span>
                    <span style={{ fontFamily: "'Space Mono',monospace" }}>{fmtYen(e.amount)}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════ ACCOUNTS ══════════════════ */
function AccountsPage({ user, showToast }) {
  const { isAdmin } = useRole();
  const { isMobile } = useResponsive();

  const [accounts, setAccounts] = useState([]);
  const [newAcc, setNewAcc] = useState({ name: "", type: "expense", group: "販管費" });

  useEffect(() => {
    (async () => {
      const s = await getDoc(doc(db, "settings", "accounts"));
      if (s.exists()) setAccounts(s.data().list || []);
    })();
  }, []);

  const save = async (list) => {
    await setDoc(doc(db, "settings", "accounts"), { list });
    setAccounts(list);
  };

  const add = async () => {
    if (!isAdmin) return showToast("管理者のみ追加できます", "error");
    if (!newAcc.name) return showToast("科目名を入力してください", "error");

    await save([...accounts, { ...newAcc, id: uid() }]);
    setNewAcc({ name: "", type: "expense", group: "販管費" });
    showToast("追加しました！");
  };

  const remove = async (id) => {
    if (!isAdmin) return showToast("管理者のみ削除できます", "error");
    await save(accounts.filter((a) => a.id !== id));
    showToast("削除しました");
  };

  const Section = ({ title, items, color }) => (
    <div style={{ marginBottom: 24 }}>
      <h3
        style={{
          fontSize: 14,
          fontWeight: 600,
          color,
          marginBottom: 10,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
        {title}
      </h3>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((a) => (
          <div
            key={a.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 14px",
              background: "#0F172A",
              borderRadius: 6,
              gap: 8,
            }}
          >
            <div>
              <span style={{ fontSize: 14, color: "#E2E8F0" }}>{a.name}</span>
              <span style={{ fontSize: 11, color: "#64748B", marginLeft: 8 }}>{a.group}</span>
            </div>

            {isAdmin && (
              <button
                onClick={() => remove(a.id)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#64748B",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <PageTitle sub="勘定科目の一覧">勘定科目</PageTitle>

      <Card style={{ marginBottom: 20 }}>
        <Section title="収入科目" items={accounts.filter((a) => a.type === "income")} color="#10B981" />
        <Section title="経費科目" items={accounts.filter((a) => a.type === "expense")} color="#F59E0B" />
      </Card>

      {isAdmin && (
        <Card>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "#F1F5F9", marginBottom: 12 }}>科目を追加</h3>

          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              flexDirection: isMobile ? "column" : "row",
            }}
          >
            <input
              style={{ ...inputBase, flex: 2, minWidth: 140 }}
              placeholder="科目名"
              value={newAcc.name}
              onChange={(e) => setNewAcc({ ...newAcc, name: e.target.value })}
            />

            <select
              style={{ ...inputBase, flex: 1, minWidth: 100, cursor: "pointer" }}
              value={newAcc.type}
              onChange={(e) => setNewAcc({ ...newAcc, type: e.target.value })}
            >
              <option value="income">収入</option>
              <option value="expense">経費</option>
            </select>

            <input
              style={{ ...inputBase, flex: 1, minWidth: 100 }}
              placeholder="分類"
              value={newAcc.group}
              onChange={(e) => setNewAcc({ ...newAcc, group: e.target.value })}
            />

            <Btn onClick={add} style={isMobile ? { width: "100%" } : {}}>
              追加
            </Btn>
          </div>
        </Card>
      )}
    </div>
  );
}
