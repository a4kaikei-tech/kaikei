import React, { useState, useEffect, useCallback, useMemo, createContext, useContext } from "react";
import { auth, db, GAS_API_URL } from "./firebase";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged,
} from "firebase/auth";
import {
  doc, setDoc, getDoc, getDocs, deleteDoc, updateDoc,
  collection, query, serverTimestamp, Timestamp,
} from "firebase/firestore";

/* ── helpers ── */
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

const DEFAULT_ACCOUNTS = [
  { id: "sales", name: "売上高", type: "income", group: "売上" },{ id: "service_income", name: "サービス収入", type: "income", group: "売上" },{ id: "other_income", name: "雑収入", type: "income", group: "売上" },
  { id: "purchases", name: "仕入高", type: "expense", group: "売上原価" },{ id: "salary", name: "給与手当", type: "expense", group: "販管費" },{ id: "rent", name: "地代家賃", type: "expense", group: "販管費" },{ id: "utilities", name: "水道光熱費", type: "expense", group: "販管費" },{ id: "communication", name: "通信費", type: "expense", group: "販管費" },{ id: "transport", name: "旅費交通費", type: "expense", group: "販管費" },{ id: "supplies", name: "消耗品費", type: "expense", group: "販管費" },{ id: "entertainment", name: "接待交際費", type: "expense", group: "販管費" },{ id: "advertising", name: "広告宣伝費", type: "expense", group: "販管費" },{ id: "insurance", name: "保険料", type: "expense", group: "販管費" },{ id: "depreciation", name: "減価償却費", type: "expense", group: "販管費" },{ id: "tax", name: "租税公課", type: "expense", group: "販管費" },{ id: "misc_expense", name: "雑費", type: "expense", group: "販管費" },
];

const INVOICE_STATUS = { draft: { bg: "#334155", text: "#94A3B8", label: "下書き" }, sent: { bg: "#DBEAFE", text: "#1E40AF", label: "送付済" }, paid: { bg: "#D1FAE5", text: "#065F46", label: '受け渡し済' }, overdue: { bg: "#FEE2E2", text: "#991B1B", label: "期限超過" } };
const StatusBadge = ({ status }) => { const s = INVOICE_STATUS[status] || { bg: "#334155", text: "#94A3B8", label: status }; return <span style={{ background: s.bg, color: s.text, padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{s.label}</span>; };

const ReadOnlyBanner = () => (
  <div style={{ background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.3)", borderRadius: 8, padding: "8px 16px", marginBottom: 20, fontSize: 12, color: "#F59E0B", display: "flex", alignItems: "center", gap: 8 }}>
    🔒 閲覧モード — データの編集は管理者のみ可能です
  </div>
);

/* ── UI ── */
const Card = ({ children, style = {}, onClick }) => (<div onClick={onClick} style={{ background: "#1E293B", borderRadius: 12, padding: 24, border: "1px solid #334155", ...style }}>{children}</div>);
const PageTitle = ({ children, sub, right }) => (<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28, flexWrap: "wrap", gap: 12 }}><div><h1 style={{ fontSize: 22, fontWeight: 700, color: "#F1F5F9" }}>{children}</h1>{sub && <p style={{ color: "#64748B", fontSize: 13, marginTop: 4 }}>{sub}</p>}</div>{right}</div>);
const Btn = ({ children, onClick, variant = "primary", disabled, style = {} }) => { const v = { primary: { background: "linear-gradient(135deg,#10B981,#059669)", color: "#fff" }, secondary: { background: "#334155", color: "#E2E8F0" }, danger: { background: "#DC2626", color: "#fff" }, ghost: { background: "transparent", color: "#94A3B8", border: "1px solid #334155" }, accent: { background: "linear-gradient(135deg,#3B82F6,#6366F1)", color: "#fff" } }; return <button onClick={onClick} disabled={disabled} style={{ padding: "8px 18px", borderRadius: 8, border: "none", cursor: disabled ? "default" : "pointer", fontSize: 13, fontWeight: 600, opacity: disabled ? 0.5 : 1, ...v[variant], ...style }}>{children}</button>; };
const inputBase = { width: "100%", padding: "10px 14px", background: "#0F172A", border: "1px solid #334155", borderRadius: 8, color: "#E2E8F0", fontSize: 14, outline: "none", fontFamily: "'Noto Sans JP',sans-serif" };

/* ══════════════════ ROOT ══════════════════ */
export default function App() {
  const [user, setUser] = useState(null); const [profile, setProfile] = useState(null);
  const [page, setPage] = useState("login"); const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const showToast = (msg, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };
  useEffect(() => { const unsub = onAuthStateChanged(auth, async (u) => { if (u) { setUser(u); const snap = await getDoc(doc(db, "users", u.uid)); if (snap.exists()) { setProfile(snap.data()); setPage("dashboard"); } } else { setUser(null); setProfile(null); setPage("login"); } setLoading(false); }); return unsub; }, []);
  const isAdmin = profile?.role === "admin";
  if (loading) return (<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0F172A", fontFamily: "'Noto Sans JP',sans-serif" }}><div style={{ textAlign: "center", color: "#94A3B8" }}><div style={{ width: 40, height: 40, border: "3px solid #334155", borderTop: "3px solid #10B981", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />読み込み中...</div><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>);
  return (
    <RoleCtx.Provider value={{ isAdmin }}>
    <div style={{ minHeight: "100vh", background: "#0F172A", fontFamily: "'Noto Sans JP',sans-serif", color: "#E2E8F0" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}} @keyframes toastIn{from{opacity:0;transform:translateY(-20px)}to{opacity:1;transform:translateY(0)}} *{box-sizing:border-box;margin:0;padding:0} input,select,textarea,button{font-family:'Noto Sans JP',sans-serif} input::placeholder,textarea::placeholder{color:#475569} ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:#1E293B}::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}`}</style>
      {toast && <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999, background: toast.type === "error" ? "#DC2626" : "#059669", color: "#fff", padding: "10px 24px", borderRadius: 8, fontSize: 14, fontWeight: 500, animation: "toastIn .3s ease", boxShadow: "0 8px 32px rgba(0,0,0,.3)" }}>{toast.msg}</div>}
      {(!user || !profile) && <AuthPage page={page} setPage={setPage} showToast={showToast} />}
      {user && profile && <MainLayout profile={profile} user={user} page={page} setPage={setPage} logout={() => signOut(auth)} showToast={showToast} />}
    </div>
    </RoleCtx.Provider>
  );
}

/* ══════════════════ AUTH ══════════════════ */
function AuthPage({ page, setPage, showToast }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [companyName, setCompanyName] = useState("");
  const [role, setRole] = useState("member"); const [busy, setBusy] = useState(false);
  const handleLogin = async () => { if (!email || !password) return showToast("入力してください", "error"); setBusy(true); try { await signInWithEmailAndPassword(auth, email, password); } catch { showToast("ログインに失敗しました", "error"); } setBusy(false); };
  const handleRegister = async () => {
    if (!email || !password || !companyName) return showToast("すべて入力してください", "error");
    if (password.length < 6) return showToast("パスワードは6文字以上", "error");
    setBusy(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, "users", cred.user.uid), { uid: cred.user.uid, email, companyName, role, createdAt: serverTimestamp(), fiscalYearStart: 4 });
      if (role === "admin") { const snap = await getDoc(doc(db, "settings", "accounts")); if (!snap.exists()) await setDoc(doc(db, "settings", "accounts"), { list: DEFAULT_ACCOUNTS }); }
      showToast("登録完了！");
    } catch (e) { showToast("登録失敗: " + e.code, "error"); }
    setBusy(false);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 420, animation: "fadeIn .5s ease" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}><div style={{ width: 64, height: 64, borderRadius: 16, margin: "0 auto 16px", background: "linear-gradient(135deg,#10B981,#059669)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 700, color: "#fff", boxShadow: "0 8px 32px rgba(16,185,129,.3)" }}>¥</div><h1 style={{ fontSize: 24, fontWeight: 700, color: "#F1F5F9" }}>Kaikei</h1><p style={{ color: "#64748B", fontSize: 14, marginTop: 4 }}>シンプル会計ソフト</p></div>
        <div style={{ background: "#1E293B", borderRadius: 16, padding: 32, border: "1px solid #334155" }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 24, color: "#F1F5F9" }}>{page === "login" ? "ログイン" : "新規登録"}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {page === "register" && <>
              <div><label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 6, display: "block" }}>名前</label><input style={inputBase} placeholder="株式会社サンプル" value={companyName} onChange={e => setCompanyName(e.target.value)} /></div>
            </>}
            <div><label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 6, display: "block" }}>メールアドレス</label><input style={inputBase} type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} /></div>
            <div><label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 6, display: "block" }}>パスワード</label><input style={inputBase} type="password" placeholder="••••••" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && (page === "login" ? handleLogin() : handleRegister())} /></div>
            <button onClick={page === "login" ? handleLogin : handleRegister} disabled={busy} style={{ width: "100%", padding: 12, borderRadius: 8, border: "none", cursor: "pointer", background: "linear-gradient(135deg,#10B981,#059669)", color: "#fff", fontSize: 15, fontWeight: 600, marginTop: 8, opacity: busy ? .6 : 1 }}>{busy ? "処理中..." : page === "login" ? "ログイン" : "登録する"}</button>
          </div>
          <div style={{ textAlign: "center", marginTop: 20 }}><button onClick={() => setPage(page === "login" ? "register" : "login")} style={{ background: "none", border: "none", color: "#34D399", cursor: "pointer", fontSize: 13 }}>{page === "login" ? "新規登録はこちら →" : "ログインはこちら →"}</button></div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════ LAYOUT ══════════════════ */
function MainLayout({ profile, user, page, setPage, logout, showToast }) {
  const { isAdmin } = useRole();
  const nav = [
    { id: "dashboard", icon: "📊", label: "ダッシュボード" },
    { id: "journal", icon: "📒", label: "仕訳入力" },
    { id: "ledger", icon: "📖", label: "仕訳帳" },
    { id: "invoices", icon: "📄", label: "請求書" },
    { id: "reports", icon: "📈", label: "レポート" },
    { id: "receipts", icon: "🧾", label: "領収書" },
    { id: "accounts", icon: "🏷️", label: "勘定科目" },
  ];
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <div style={{ width: 220, background: "#1E293B", borderRight: "1px solid #334155", display: "flex", flexDirection: "column", flexShrink: 0, position: "sticky", top: 0, height: "100vh", overflowY: "auto" }}>
        <div style={{ padding: "20px 16px", borderBottom: "1px solid #334155" }}><div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#10B981,#059669)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#fff" }}>¥</div><div><div style={{ fontSize: 13, fontWeight: 600, color: "#F1F5F9" }}>Kaikei</div><div style={{ fontSize: 10, color: "#64748B", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile.companyName}</div></div></div></div>
        <nav style={{ padding: "10px 8px", flex: 1 }}>{nav.map(n => <button key={n.id} onClick={() => setPage(n.id)} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "9px 11px", borderRadius: 7, border: "none", cursor: "pointer", background: page === n.id ? "rgba(16,185,129,.15)" : "transparent", color: page === n.id ? "#34D399" : "#94A3B8", fontSize: 13, fontWeight: page === n.id ? 600 : 400, marginBottom: 2, textAlign: "left" }}><span style={{ fontSize: 15 }}>{n.icon}</span> {n.label}</button>)}</nav>
        <div style={{ padding: "14px 12px", borderTop: "1px solid #334155" }}>
          <div style={{ fontSize: 11, color: "#64748B", marginBottom: 4, padding: "0 6px" }}>{profile.email}</div>
          <div style={{ fontSize: 10, padding: "0 6px", marginBottom: 8 }}><span style={{ background: isAdmin ? "rgba(16,185,129,.15)" : "rgba(59,130,246,.15)", color: isAdmin ? "#10B981" : "#60A5FA", padding: "1px 8px", borderRadius: 4, fontWeight: 600 }}>{isAdmin ? "管理者" : "閲覧メンバー"}</span></div>
          <button onClick={logout} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #334155", background: "transparent", color: "#EF4444", fontSize: 12, cursor: "pointer" }}>ログアウト</button>
        </div>
      </div>
      <div style={{ flex: 1, padding: 28, overflowY: "auto", maxHeight: "100vh" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", animation: "fadeIn .3s ease" }}>
          {!isAdmin && <ReadOnlyBanner />}
          {page === "dashboard" && <Dashboard user={user} profile={profile} setPage={setPage} />}
          {page === "journal" && <JournalEntry user={user} showToast={showToast} setPage={setPage} />}
          {page === "ledger" && <Ledger user={user} showToast={showToast} />}
          {page === "invoices" && <InvoicesPage user={user} profile={profile} showToast={showToast} />}
          {page === "reports" && <Reports user={user} />}
          {page === "receipts" && <Receipts user={user} showToast={showToast} />}
          {page === "accounts" && <AccountsPage user={user} showToast={showToast} />}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════ DASHBOARD ══════════════════ */
function Dashboard({ user, profile, setPage }) {
  const [entries, setEntries] = useState([]); const [invoices, setInvoices] = useState([]); const [loading, setLoading] = useState(true);
  const { isAdmin } = useRole();
  useEffect(() => { (async () => { const eS = await getDocs(collection(db, "entries")); const eA = []; eS.forEach(d => eA.push({ id: d.id, ...d.data() })); setEntries(eA); const iS = await getDocs(collection(db, "invoices")); const iA = []; iS.forEach(d => iA.push({ id: d.id, ...d.data() })); setInvoices(iA); setLoading(false); })(); }, []);
  const now = new Date(); const mk = monthKey(now); const me = entries.filter(e => e.date && monthKey(e.date) === mk);
  const inc = me.filter(e => e.type === "income").reduce((s, e) => s + (e.amount || 0), 0);
  const exp = me.filter(e => e.type === "expense").reduce((s, e) => s + (e.amount || 0), 0);
  const profit = inc - exp; const unpaid = invoices.filter(i => i.status === "sent" || i.status === "overdue"); const unpaidTotal = unpaid.reduce((s, i) => s + (i.total || 0), 0);
  const monthly = useMemo(() => { const d = []; for (let i = 5; i >= 0; i--) { const dt = new Date(now.getFullYear(), now.getMonth() - i, 1); const m = monthKey(dt); const me2 = entries.filter(e => e.date && monthKey(e.date) === m); d.push({ month: `${dt.getMonth()+1}月`, income: me2.filter(e => e.type === "income").reduce((s, e) => s + (e.amount || 0), 0), expense: me2.filter(e => e.type === "expense").reduce((s, e) => s + (e.amount || 0), 0) }); } return d; }, [entries, now]);
  const maxV = Math.max(...monthly.map(d => Math.max(d.income, d.expense)), 1);
  // 1. 収入の合計を計算
  const totalIn = entries.filter(e => e.type === "income").reduce((s, e) => s + e.amount, 0);
  // 2. 支出の合計を計算
  const totalOut = entries.filter(e => e.type === "expense").reduce((s, e) => s + e.amount, 0);
  // 3. 残高（利益）を計算
  const balance = totalIn - totalOut;
  if (loading) return <p style={{ color: "#64748B" }}>読み込み中...</p>;
  const stats = [{label:"残高",value:fmtYen(balance),color:"#FFFFFF"},{ label: "今月の収入", value: fmtYen(inc), color: "#10B981", icon: "↑" },{ label: "今月の支出", value: fmtYen(exp), color: "#F59E0B", icon: "↓" }];
  return (<div><PageTitle sub={`${profile.companyName} — ${fmtMonth(now)}`}>ダッシュボード</PageTitle>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 24 }}>{stats.map((s, i) => <Card key={i} style={{ padding: 20 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}><span style={{ fontSize: 12, color: "#94A3B8" }}>{s.label}</span><span style={{ fontSize: 18 }}>{s.icon}</span></div><div style={{ fontSize: 22, fontWeight: 700, color: s.color, fontFamily: "'Space Mono',monospace" }}>{s.value}</div>{s.sub && <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>{s.sub}</div>}</Card>)}</div>
    <Card style={{ marginBottom: 24 }}><h3 style={{ fontSize: 15, fontWeight: 600, color: "#F1F5F9", marginBottom: 20 }}>月別収支推移</h3><div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 160 }}>{monthly.map((d, i) => <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}><div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 130, width: "100%" }}><div style={{ flex: 1, background: "linear-gradient(180deg,#10B981,#059669)", borderRadius: "4px 4px 0 0", minHeight: 2, height: `${(d.income / maxV) * 100}%` }} /><div style={{ flex: 1, background: "linear-gradient(180deg,#F59E0B,#D97706)", borderRadius: "4px 4px 0 0", minHeight: 2, height: `${(d.expense / maxV) * 100}%` }} /></div><span style={{ fontSize: 11, color: "#64748B" }}>{d.month}</span></div>)}</div><div style={{ display: "flex", gap: 16, marginTop: 12, justifyContent: "center" }}><span style={{ fontSize: 11, color: "#94A3B8" }}><span style={{ display: "inline-block", width: 10, height: 10, background: "#10B981", borderRadius: 2, marginRight: 4 }} />収入</span><span style={{ fontSize: 11, color: "#94A3B8" }}><span style={{ display: "inline-block", width: 10, height: 10, background: "#F59E0B", borderRadius: 2, marginRight: 4 }} />支出</span></div></Card>
    {isAdmin && <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>{[["journal","📒","仕訳を入力"],["invoices","📄","請求書を作成"],["receipts","🧾","領収書を保存"]].map(([id,ic,lb]) => <Card key={id} style={{ cursor: "pointer" }} onClick={() => setPage(id)}><div style={{ textAlign: "center", padding: "8px 0" }}><div style={{ fontSize: 28, marginBottom: 8 }}>{ic}</div><div style={{ fontSize: 14, fontWeight: 600, color: "#F1F5F9" }}>{lb}</div></div></Card>)}</div>}
  </div>);
}

/* ══════════════════ JOURNAL ══════════════════ */
function JournalEntry({ user, showToast, setPage }) {
  const { isAdmin } = useRole();
  const [accounts, setAccounts] = useState([]); const [type, setType] = useState("expense"); const [accountId, setAccountId] = useState(""); const [amount, setAmount] = useState(""); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [description, setDescription] = useState(""); const [taxRate, setTaxRate] = useState(10); const [busy, setBusy] = useState(false);
  useEffect(() => { (async () => { const s = await getDoc(doc(db, "settings", "accounts")); if (s.exists()) setAccounts(s.data().list || []); })(); }, []);
  const filtered = accounts.filter(a => a.type === type); const taxAmount = Math.floor((parseInt(amount) || 0) * taxRate / (100 + taxRate));
  const handleSubmit = async () => { if (!isAdmin) return showToast("管理者のみ登録できます", "error"); if (!accountId || !amount || !date) return showToast("必須項目を入力してください", "error"); setBusy(true); const acc = accounts.find(a => a.id === accountId); await setDoc(doc(db, "entries", uid()), { type, accountId, accountName: acc?.name || "", amount: parseInt(amount), date, description, taxRate, taxAmount, createdBy: user.uid, createdAt: serverTimestamp() }); showToast("仕訳を登録しました！"); setAmount(""); setDescription(""); setAccountId(""); setBusy(false); };
  if (!isAdmin) return <div><PageTitle sub="管理者のみ入力可能です">仕訳入力</PageTitle><Card><p style={{ color: "#475569", textAlign: "center", padding: 20 }}>仕訳の入力は管理者のみ可能です。仕訳帳から閲覧できます。</p></Card></div>;
  return (<div><PageTitle sub="収入・支出を記録">仕訳入力</PageTitle><Card><div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
    <div><label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 8, display: "block" }}>区分</label><div style={{ display: "flex", gap: 8 }}>{[["income","収入","#10B981"],["expense","支出","#F59E0B"]].map(([t,l,c]) => <button key={t} onClick={() => { setType(t); setAccountId(""); }} style={{ flex: 1, padding: 12, borderRadius: 8, border: `2px solid ${type === t ? c : "#334155"}`, background: type === t ? c + "15" : "#0F172A", color: type === t ? c : "#94A3B8", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{l}</button>)}</div></div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}><div><label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 6, display: "block" }}>勘定科目</label><select style={{ ...inputBase, cursor: "pointer" }} value={accountId} onChange={e => setAccountId(e.target.value)}><option value="">選択してください</option>{filtered.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div><div><label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 6, display: "block" }}>日付</label><input type="date" style={{ ...inputBase, colorScheme: "dark" }} value={date} onChange={e => setDate(e.target.value)} /></div></div>
    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}><div><label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 6, display: "block" }}>金額（税込）</label><input style={inputBase} type="number" placeholder="10000" value={amount} onChange={e => setAmount(e.target.value)} />{amount && <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>うち消費税: {fmtYen(taxAmount)}</div>}</div><div><label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 6, display: "block" }}>税率</label><select style={{ ...inputBase, cursor: "pointer" }} value={taxRate} onChange={e => setTaxRate(+e.target.value)}><option value={10}>10%</option><option value={8}>8%（軽減）</option><option value={0}>非課税</option></select></div></div>
    <div><label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 6, display: "block" }}>摘要</label><input style={inputBase} placeholder="取引内容を入力..." value={description} onChange={e => setDescription(e.target.value)} /></div>
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><Btn variant="ghost" onClick={() => setPage("ledger")}>仕訳帳を見る</Btn><Btn onClick={handleSubmit} disabled={busy}>{busy ? "保存中..." : "登録する"}</Btn></div>
  </div></Card></div>);
}

/* ══════════════════ LEDGER ══════════════════ */
function Ledger({ user, showToast }) {
  const { isAdmin } = useRole();
  const [entries, setEntries] = useState([]); const [loading, setLoading] = useState(true); const [filterMonth, setFilterMonth] = useState(new Date().toISOString().slice(0, 7));
  const load = useCallback(async () => { setLoading(true); const s = await getDocs(collection(db, "entries")); const a = []; s.forEach(d => a.push({ id: d.id, ...d.data() })); setEntries(a.sort((a, b) => (b.date || "").localeCompare(a.date || ""))); setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);
  const filtered = entries.filter(e => e.date && e.date.startsWith(filterMonth)); const tInc = filtered.filter(e => e.type === "income").reduce((s, e) => s + (e.amount || 0), 0); const tExp = filtered.filter(e => e.type === "expense").reduce((s, e) => s + (e.amount || 0), 0);
  const del = async (id) => { if (!isAdmin) return showToast("管理者のみ削除できます", "error"); await deleteDoc(doc(db, "entries", id)); showToast("削除しました"); load(); };
  return (<div><PageTitle sub="全メンバー共有の仕訳データ" right={<input type="month" style={{ ...inputBase, width: "auto", colorScheme: "dark" }} value={filterMonth} onChange={e => setFilterMonth(e.target.value)} />}>仕訳帳</PageTitle>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}><Card style={{ padding: 16 }}><div style={{ fontSize: 11, color: "#94A3B8" }}>収入合計</div><div style={{ fontSize: 20, fontWeight: 700, color: "#10B981", fontFamily: "'Space Mono',monospace" }}>{fmtYen(tInc)}</div></Card><Card style={{ padding: 16 }}><div style={{ fontSize: 11, color: "#94A3B8" }}>支出合計</div><div style={{ fontSize: 20, fontWeight: 700, color: "#F59E0B", fontFamily: "'Space Mono',monospace" }}>{fmtYen(tExp)}</div></Card><Card style={{ padding: 16 }}><div style={{ fontSize: 11, color: "#94A3B8" }}>差引</div><div style={{ fontSize: 20, fontWeight: 700, color: tInc - tExp >= 0 ? "#3B82F6" : "#EF4444", fontFamily: "'Space Mono',monospace" }}>{fmtYen(tInc - tExp)}</div></Card></div>
    {loading ? <p style={{ color: "#64748B" }}>読み込み中...</p> : filtered.length === 0 ? <Card><p style={{ color: "#475569", textAlign: "center", padding: 20 }}>この月の仕訳はありません</p></Card> : <Card style={{ padding: 0, overflow: "hidden" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><thead><tr style={{ background: "#0F172A" }}>{["日付","区分","勘定科目","摘要","金額",...(isAdmin ? [""] : [])].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: "#64748B", fontWeight: 500, fontSize: 12 }}>{h}</th>)}</tr></thead><tbody>{filtered.map(e => <tr key={e.id} style={{ borderTop: "1px solid #334155" }}><td style={{ padding: "10px 14px", color: "#94A3B8", fontFamily: "'Space Mono',monospace", fontSize: 12 }}>{e.date}</td><td style={{ padding: "10px 14px" }}><span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: e.type === "income" ? "rgba(16,185,129,.15)" : "rgba(245,158,11,.15)", color: e.type === "income" ? "#10B981" : "#F59E0B" }}>{e.type === "income" ? "収入" : "支出"}</span></td><td style={{ padding: "10px 14px", color: "#E2E8F0" }}>{e.accountName}</td><td style={{ padding: "10px 14px", color: "#94A3B8" }}>{e.description || "—"}</td><td style={{ padding: "10px 14px", fontWeight: 600, fontFamily: "'Space Mono',monospace", color: e.type === "income" ? "#10B981" : "#F59E0B" }}>{fmtYen(e.amount)}</td>{isAdmin && <td style={{ padding: "10px 14px" }}><button onClick={() => del(e.id)} style={{ background: "none", border: "none", color: "#64748B", cursor: "pointer", fontSize: 14 }}>✕</button></td>}</tr>)}</tbody></table></Card>}
  </div>);
}

/* ══════════════════ INVOICES ══════════════════ */
function InvoicesPage({ user, profile, showToast }) {
  const { isAdmin } = useRole();
  // InvoicesPage コンポーネント内の既存のuseStateなどがある場所に追加
  const [accountList, setAccountList] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState("仕入高"); // デフォルト値
  
  // useEffectなどで科目リストを読み込む（既存のload関数内などに追加）
  const loadAccounts = async () => {
    const snap = await getDoc(doc(db, "settings", "accounts"));
    if (snap.exists()) {
      // 支出(expense)の科目だけをフィルタリング
      setAccountList(snap.data().list.filter(a => a.type === "expense"));
    }
  };
  useEffect(() => {
    load();
    loadAccounts(); // 科目リストの読み込みを追加
  }, [load]);
  const [loading, setLoading] = useState(true); 
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ client: "", items: [{ name: "", qty: 1, price: 0 }], dueDate: "", notes: "" });
  const load = useCallback(async () => { setLoading(true); const s = await getDocs(collection(db, "invoices")); const a = []; s.forEach(d => a.push({ id: d.id, ...d.data() })); setInvoices(a.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))); setLoading(false); }, []);
  const addItem = () => setForm({ ...form, items: [...form.items, { name: "", qty: 1, price: 0 }] }); const updateItem = (i, k, v) => { const items = [...form.items]; items[i] = { ...items[i], [k]: k === "name" ? v : Number(v) }; setForm({ ...form, items }); }; const removeItem = (i) => setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) });
  const subtotal = form.items.reduce((s, i) => s + i.qty * i.price, 0); const tax = Math.floor(subtotal * 0.1); const total = subtotal + tax;
  const saveInvoice = async () => { if (!isAdmin) return; if (!form.client) return showToast("取引先を入力してください", "error"); const invNum = `INV-${new Date().getFullYear()}${(new Date().getMonth()+1).toString().padStart(2,"0")}-${Math.floor(Math.random() * 1000).toString().padStart(3,"0")}`; await setDoc(doc(db, "invoices", uid()), { invoiceNumber: invNum, client: form.client, items: form.items, subtotal, tax, total, dueDate: form.dueDate, notes: form.notes, status: "draft", companyName: profile.companyName, createdBy: user.uid, createdAt: serverTimestamp() }); showToast("請求書を作成しました！"); setShowForm(false); setForm({ client: "", items: [{ name: "", qty: 1, price: 0 }], dueDate: "", notes: "" }); load(); };
  const updateStatus = async (inv, status) => {
  if (!isAdmin) return showToast("管理者のみ変更できます", "error");

  try {
    await updateDoc(doc(db, "invoices", inv.id), { status });

    if (status === "paid") {
      const entryData = {
        date: inv.dueDate || fmtDate(new Date()),
        type: "expense",
        account: selectedAccount, // ← ここで選択された科目を使用
        amount: inv.total,
        tax: inv.tax,
        note: `【自動】${inv.client} (${inv.invoiceNumber})`,
        companyName: inv.companyName || profile.companyName,
        createdBy: user.uid,
        createdAt: serverTimestamp()
      };

      await setDoc(doc(db, "entries", uid()), entryData);
      showToast(`${selectedAccount}として支出に登録しました`);
    } else {
      showToast("更新しました");
    }
    load();
  } catch (e) {
    showToast("エラーが発生しました", "error");
  }
  };
  const deleteInv = async (id) => { if (!isAdmin) return; await deleteDoc(doc(db, "invoices", id)); showToast("削除しました"); load(); };
  return (<div><PageTitle right={isAdmin && <Btn onClick={() => setShowForm(!showForm)}>{showForm ? "✕ 閉じる" : "＋ 新規作成"}</Btn>}>請求書</PageTitle>
    {showForm && isAdmin && <Card style={{ marginBottom: 24, animation: "fadeIn .3s ease" }}><h3 style={{ fontSize: 15, fontWeight: 600, color: "#F1F5F9", marginBottom: 16 }}>請求書作成</h3><div style={{ display: "flex", flexDirection: "column", gap: 16 }}><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}><div><label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 6, display: "block" }}>買い出し先</label><input style={inputBase} value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} placeholder="〇〇店" /></div><div><label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 6, display: "block" }}>承認予定のBLKの日程</label><input type="date" style={{ ...inputBase, colorScheme: "dark" }} value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} /></div></div><div><label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 8, display: "block" }}>明細</label>{form.items.map((item, i) => <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}><input style={{ ...inputBase, flex: 3 }} placeholder="品目" value={item.name} onChange={e => updateItem(i, "name", e.target.value)} /><input style={{ ...inputBase, flex: 1 }} type="number" placeholder="数量" value={item.qty} onChange={e => updateItem(i, "qty", e.target.value)} /><input style={{ ...inputBase, flex: 2 }} type="number" placeholder="単価" value={item.price || ""} onChange={e => updateItem(i, "price", e.target.value)} /><span style={{ fontSize: 13, color: "#94A3B8", minWidth: 80, textAlign: "right", fontFamily: "'Space Mono',monospace" }}>{fmtYen(item.qty * item.price)}</span>{form.items.length > 1 && <button onClick={() => removeItem(i)} style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer" }}>✕</button>}</div>)}<button onClick={addItem} style={{ background: "none", border: "none", color: "#34D399", cursor: "pointer", fontSize: 13 }}>＋ 明細を追加</button></div><div style={{ display: "flex", justifyContent: "flex-end" }}><div style={{ textAlign: "right", fontSize: 13 }}><div style={{ color: "#94A3B8", marginBottom: 4 }}>小計: <span style={{ fontFamily: "'Space Mono',monospace" }}>{fmtYen(subtotal)}</span></div><div style={{ color: "#94A3B8", marginBottom: 4 }}>消費税 (10%): <span style={{ fontFamily: "'Space Mono',monospace" }}>{fmtYen(tax)}</span></div><div style={{ color: "#F1F5F9", fontWeight: 700, fontSize: 16 }}>合計: <span style={{ fontFamily: "'Space Mono',monospace" }}>{fmtYen(total)}</span></div></div></div><div><label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 6, display: "block" }}>備考</label><textarea style={{ ...inputBase, minHeight: 60, resize: "vertical" }} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div><Btn onClick={saveInvoice} style={{ alignSelf: "flex-end" }}>請求書を保存</Btn></div></Card>}
    {loading ? <p style={{ color: "#64748B" }}>読み込み中...</p> : invoices.length === 0 ? <Card><p style={{ color: "#475569", textAlign: "center", padding: 20 }}>請求書がありません</p></Card> : <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{invoices.map(inv => <Card key={inv.id} style={{ padding: 18 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}><div><div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}><span style={{ fontSize: 14, fontWeight: 600, color: "#F1F5F9", fontFamily: "'Space Mono',monospace" }}>{inv.companyName}</span><StatusBadge status={inv.status} /></div><div style={{ fontSize: 13, color: "#94A3B8" }}>{inv.client}</div><div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>{fmtDate(inv.createdAt)} {inv.dueDate && `·BLK会議の日程: ${inv.dueDate}`}</div></div><div style={{ textAlign: "right" }}><div style={{ fontSize: 18, fontWeight: 700, color: "#F1F5F9", fontFamily: "'Space Mono',monospace" }}>{fmtYen(inv.total)}</div>{isAdmin && <div style={{ display: "flex", gap: 6, marginTop: 8 }}>{inv.status === "draft" && <Btn variant="accent" onClick={() => updateStatus(inv, "sent")} style={{ fontSize: 11, padding: "4px 10px" }}>承認ずみに</Btn>}{inv.status === "sent" && (
  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
    <select 
      style={{ ...inputBase, padding: "4px 8px", fontSize: 11, height: "auto" }}
      value={selectedAccount}
      onChange={(e) => setSelectedAccount(e.target.value)}
    >
      {accountList.map(a => (
        <option key={a.id} value={a.name}>{a.name}</option>
      ))}
    </select>
    <Btn onClick={() => updateStatus(inv, "paid")} style={{ fontSize: 11, padding: "4px 10px" }}>
      支払い済みに
    </Btn>
  </div>
)}<Btn variant="ghost" onClick={() => deleteInv(inv.id)} style={{ fontSize: 11, padding: "4px 10px", color: "#EF4444" }}>削除</Btn></div>}</div></div></Card>)}</div>}
  </div>);
}

/* ══════════════════ REPORTS ══════════════════ */
function Reports({ user }) {
  const [entries, setEntries] = useState([]); const [loading, setLoading] = useState(true); const [year, setYear] = useState(new Date().getFullYear());
  useEffect(() => { (async () => { const s = await getDocs(collection(db, "entries")); const a = []; s.forEach(d => a.push({ id: d.id, ...d.data() })); setEntries(a); setLoading(false); })(); }, []);
  const ye = entries.filter(e => e.date && e.date.startsWith(String(year))); const expByAcc = {}; ye.forEach(e => { if (e.type === "expense") expByAcc[e.accountName] = (expByAcc[e.accountName] || 0) + (e.amount || 0); }); const tInc = ye.filter(e => e.type === "income").reduce((s, e) => s + (e.amount || 0), 0); const tExp = Object.values(expByAcc).reduce((s, v) => s + v, 0);
  const monthlyPL = useMemo(() => { const d = []; for (let m = 1; m <= 12; m++) { const mk2 = `${year}-${m.toString().padStart(2,"0")}`; const me = ye.filter(e => e.date && e.date.startsWith(mk2)); const i2 = me.filter(e => e.type === "income").reduce((s, e) => s + (e.amount || 0), 0); const e2 = me.filter(e => e.type === "expense").reduce((s, e) => s + (e.amount || 0), 0); d.push({ month: m, income: i2, expense: e2, profit: i2 - e2 }); } return d; }, [ye, year]);
  if (loading) return <p style={{ color: "#64748B" }}>読み込み中...</p>;
  const maxExp = Math.max(...Object.values(expByAcc), 1);
  return (<div><PageTitle sub="年間の収支を確認" right={<div style={{ display: "flex", gap: 8 }}><Btn variant="ghost" onClick={() => setYear(year - 1)} style={{ padding: "6px 12px" }}>◀</Btn><span style={{ fontSize: 16, fontWeight: 600, color: "#F1F5F9", lineHeight: "36px" }}>{year}年</span><Btn variant="ghost" onClick={() => setYear(year + 1)} style={{ padding: "6px 12px" }}>▶</Btn></div>}>レポート</PageTitle>
    <Card style={{ marginBottom: 20 }}><h3 style={{ fontSize: 15, fontWeight: 600, color: "#F1F5F9", marginBottom: 16 }}>損益計算書（簡易）</h3><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>{[["総収入", tInc, "#10B981"],["総支出", tExp, "#F59E0B"],["純利益", tInc - tExp, tInc - tExp >= 0 ? "#3B82F6" : "#EF4444"]].map(([l, v, c]) => <div key={l} style={{ padding: 16, background: "#0F172A", borderRadius: 8, textAlign: "center" }}><div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 4 }}>{l}</div><div style={{ fontSize: 24, fontWeight: 700, color: c, fontFamily: "'Space Mono',monospace" }}>{fmtYen(v)}</div></div>)}</div></Card>
    <Card style={{ marginBottom: 20 }}><h3 style={{ fontSize: 15, fontWeight: 600, color: "#F1F5F9", marginBottom: 16 }}>経費内訳</h3>{Object.keys(expByAcc).length === 0 ? <p style={{ color: "#475569", fontSize: 13 }}>データがありません</p> : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{Object.entries(expByAcc).sort((a, b) => b[1] - a[1]).map(([name, amt]) => <div key={name} style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ fontSize: 13, color: "#94A3B8", minWidth: 100 }}>{name}</span><div style={{ flex: 1, background: "#0F172A", borderRadius: 4, height: 24, overflow: "hidden" }}><div style={{ width: `${(amt / maxExp) * 100}%`, height: "100%", background: "linear-gradient(90deg,#F59E0B,#D97706)", borderRadius: 4 }} /></div><span style={{ fontSize: 13, fontWeight: 600, color: "#E2E8F0", fontFamily: "'Space Mono',monospace", minWidth: 90, textAlign: "right" }}>{fmtYen(amt)}</span></div>)}</div>}</Card>
    <Card style={{ padding: 0, overflow: "hidden" }}><h3 style={{ fontSize: 15, fontWeight: 600, color: "#F1F5F9", padding: "16px 20px 0" }}>月別推移</h3><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 12 }}><thead><tr style={{ background: "#0F172A" }}>{["月","収入","支出","利益"].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "right", color: "#64748B", fontWeight: 500, fontSize: 12 }}>{h}</th>)}</tr></thead><tbody>{monthlyPL.map(m => <tr key={m.month} style={{ borderTop: "1px solid #334155" }}><td style={{ padding: "8px 14px", textAlign: "right", color: "#94A3B8" }}>{m.month}月</td><td style={{ padding: "8px 14px", textAlign: "right", color: "#10B981", fontFamily: "'Space Mono',monospace" }}>{fmtYen(m.income)}</td><td style={{ padding: "8px 14px", textAlign: "right", color: "#F59E0B", fontFamily: "'Space Mono',monospace" }}>{fmtYen(m.expense)}</td><td style={{ padding: "8px 14px", textAlign: "right", fontWeight: 600, fontFamily: "'Space Mono',monospace", color: m.profit >= 0 ? "#3B82F6" : "#EF4444" }}>{fmtYen(m.profit)}</td></tr>)}</tbody><tfoot><tr style={{ borderTop: "2px solid #475569", background: "#0F172A" }}><td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600, color: "#F1F5F9" }}>合計</td><td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "#10B981", fontFamily: "'Space Mono',monospace" }}>{fmtYen(tInc)}</td><td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "#F59E0B", fontFamily: "'Space Mono',monospace" }}>{fmtYen(tExp)}</td><td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, fontFamily: "'Space Mono',monospace", color: tInc - tExp >= 0 ? "#3B82F6" : "#EF4444" }}>{fmtYen(tInc - tExp)}</td></tr></tfoot></table></Card>
  </div>);
}

/* ══════════════════ RECEIPTS ══════════════════ */
function Receipts({ user, showToast }) {
  const { isAdmin } = useRole();
  const [receipts, setReceipts] = useState([]); const [uploading, setUploading] = useState(false); const [loading, setLoading] = useState(true); const [memo, setMemo] = useState("");
  const load = useCallback(async () => { setLoading(true); const s = await getDocs(collection(db, "receipts")); const a = []; s.forEach(d => a.push({ id: d.id, ...d.data() })); setReceipts(a.sort((a, b) => (b.uploadedAt?.seconds || 0) - (a.uploadedAt?.seconds || 0))); setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);
  const handleUpload = async (e) => { if (!isAdmin) return; const file = e.target.files[0]; if (!file) return; if (file.size > 10 * 1024 * 1024) return showToast("10MB以下にしてください", "error"); setUploading(true); try { const result = await gasUpload(file); await setDoc(doc(db, "receipts", uid()), { name: file.name, size: result.size || file.size, type: file.type, url: result.fileUrl, thumbnailUrl: result.thumbnailUrl || result.fileUrl, driveFileId: result.fileId, memo, createdBy: user.uid, uploadedAt: serverTimestamp() }); showToast("領収書を保存しました！"); setMemo(""); load(); } catch (err) { showToast("アップロード失敗: " + err.message, "error"); } setUploading(false); e.target.value = ""; };
  const del = async (r) => { if (!isAdmin) return showToast("管理者のみ削除できます", "error"); if (r.driveFileId) { try { await gasDelete(r.driveFileId); } catch {} } await deleteDoc(doc(db, "receipts", r.id)); showToast("削除しました"); load(); };
  const fmtSize = (b) => b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(1) + " KB" : (b / 1048576).toFixed(1) + " MB";
  return (<div><PageTitle sub="全メンバー共有の領収書データ">領収書</PageTitle>
    {isAdmin && <Card style={{ marginBottom: 20 }}><div style={{ display: "flex", flexDirection: "column", gap: 12 }}><div><label style={{ fontSize: 12, color: "#94A3B8", marginBottom: 6, display: "block" }}>メモ（任意）</label><input style={inputBase} placeholder="例: タクシー代、文具購入..." value={memo} onChange={e => setMemo(e.target.value)} /></div><div style={{ display: "flex", alignItems: "center", gap: 16 }}><label style={{ padding: "10px 20px", borderRadius: 8, cursor: uploading ? "default" : "pointer", background: "linear-gradient(135deg,#10B981,#059669)", color: "#fff", fontSize: 13, fontWeight: 600, opacity: uploading ? .6 : 1 }}>{uploading ? "アップロード中..." : "🧾 ファイルを選択"}<input type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={handleUpload} disabled={uploading} /></label><span style={{ fontSize: 12, color: "#64748B" }}>画像・PDF（最大10MB）</span></div></div></Card>}
    {loading ? <p style={{ color: "#64748B" }}>読み込み中...</p> : receipts.length === 0 ? <Card><p style={{ color: "#475569", textAlign: "center", padding: 20 }}>領収書がありません</p></Card> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 14 }}>{receipts.map(r => <Card key={r.id} style={{ padding: 0, overflow: "hidden" }}>{r.type?.startsWith("image/") ? <a href={r.url} target="_blank" rel="noreferrer"><div style={{ height: 140, background: `url(${r.thumbnailUrl || r.url}) center/cover`, borderBottom: "1px solid #334155" }} /></a> : <a href={r.url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 140, background: "#0F172A", borderBottom: "1px solid #334155", color: "#64748B", textDecoration: "none", fontSize: 32 }}>📄</a>}<div style={{ padding: 14 }}><div style={{ fontSize: 13, fontWeight: 500, color: "#E2E8F0", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.memo || r.name}</div><div style={{ fontSize: 11, color: "#64748B" }}>{fmtDate(r.uploadedAt)} · {fmtSize(r.size)}</div>{isAdmin && <button onClick={() => del(r)} style={{ background: "none", border: "none", color: "#EF4444", cursor: "pointer", fontSize: 11, marginTop: 6 }}>削除</button>}</div></Card>)}</div>}
  </div>);
}

/* ══════════════════ ACCOUNTS ══════════════════ */
function AccountsPage({ user, showToast }) {
  const { isAdmin } = useRole();
  const [accounts, setAccounts] = useState([]); const [newAcc, setNewAcc] = useState({ name: "", type: "expense", group: "販管費" });
  useEffect(() => { (async () => { const s = await getDoc(doc(db, "settings", "accounts")); if (s.exists()) setAccounts(s.data().list || []); })(); }, []);
  const save = async (list) => { await setDoc(doc(db, "settings", "accounts"), { list }); setAccounts(list); };
  const add = async () => { if (!isAdmin) return showToast("管理者のみ追加できます", "error"); if (!newAcc.name) return showToast("科目名を入力してください", "error"); await save([...accounts, { ...newAcc, id: uid() }]); setNewAcc({ name: "", type: "expense", group: "販管費" }); showToast("追加しました！"); };
  const remove = async (id) => { if (!isAdmin) return showToast("管理者のみ削除できます", "error"); await save(accounts.filter(a => a.id !== id)); showToast("削除しました"); };
  const Section = ({ title, items, color }) => <div style={{ marginBottom: 24 }}><h3 style={{ fontSize: 14, fontWeight: 600, color, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />{title}</h3><div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{items.map(a => <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", background: "#0F172A", borderRadius: 6 }}><div><span style={{ fontSize: 14, color: "#E2E8F0" }}>{a.name}</span><span style={{ fontSize: 11, color: "#64748B", marginLeft: 8 }}>{a.group}</span></div>{isAdmin && <button onClick={() => remove(a.id)} style={{ background: "none", border: "none", color: "#64748B", cursor: "pointer", fontSize: 13 }}>✕</button>}</div>)}</div></div>;
  return (<div><PageTitle sub="勘定科目の一覧">勘定科目</PageTitle><Card style={{ marginBottom: 20 }}><Section title="収入科目" items={accounts.filter(a => a.type === "income")} color="#10B981" /><Section title="経費科目" items={accounts.filter(a => a.type === "expense")} color="#F59E0B" /></Card>
    {isAdmin && <Card><h3 style={{ fontSize: 14, fontWeight: 600, color: "#F1F5F9", marginBottom: 12 }}>科目を追加</h3><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><input style={{ ...inputBase, flex: 2, minWidth: 140 }} placeholder="科目名" value={newAcc.name} onChange={e => setNewAcc({ ...newAcc, name: e.target.value })} /><select style={{ ...inputBase, flex: 1, minWidth: 100, cursor: "pointer" }} value={newAcc.type} onChange={e => setNewAcc({ ...newAcc, type: e.target.value })}><option value="income">収入</option><option value="expense">経費</option></select><input style={{ ...inputBase, flex: 1, minWidth: 100 }} placeholder="分類" value={newAcc.group} onChange={e => setNewAcc({ ...newAcc, group: e.target.value })} /><Btn onClick={add}>追加</Btn></div></Card>}
  </div>);
}