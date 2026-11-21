import { AdminDrive } from './AdminDrive';
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BarChart3, Settings, Activity, Zap, ShieldCheck, AlertTriangle, CheckCircle2,
  Trash2, RefreshCw, Clock, Key, Users, FileText, Shield, Search, ChevronRight,
  Ban, Unlock, Download, Eye, X, User as UserIcon, Hash, Globe, Cpu, ArrowLeft
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell
} from 'recharts';
import { useCurrentUser, signInWithGoogle } from '../services/authService';
import * as api from '../services/adminApi';
import { setAdminPassword, getAdminPassword, clearAdminPassword } from '../services/adminApi';

type Tab = 'Overview' | 'Users' | 'Reports' | 'Activity' | 'API Keys' | 'Settings' | 'Audit';

const TABS: { name: Tab; icon: any }[] = [
  { name: 'Overview', icon: BarChart3 },
  { name: 'Users', icon: Users },
  { name: 'Reports', icon: FileText },
  { name: 'Activity', icon: Activity },
  { name: 'API Keys', icon: Key },
  { name: 'Settings', icon: Settings },
  { name: 'Audit', icon: Shield },
];

const PIE_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316'];

const fmt = (n: number) => n?.toLocaleString?.() ?? '0';
const fmtDate = (s: string) => s ? new Date(s).toLocaleString() : '-';
const fmtTime = (ms: number) => ms > 0 ? new Date(ms).toLocaleTimeString() : 'Never';

// ---------------------------------------------------------------------------
// Main AdminPanel
// ---------------------------------------------------------------------------
const AdminPanel = () => {
  const [user, authLoading] = useCurrentUser();
  const [adminOk, setAdminOk] = useState<boolean | null>(null);
  const [adminInfo, setAdminInfo] = useState<api.AdminMe | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>(
    new URLSearchParams(location.search).has('drive') ? 'Settings' : 'Overview'
  );
  const [error, setError] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Check admin access (with password)
  const checkAdmin = useCallback(() => {
    if (!user) { setAdminOk(null); return; }
    api.adminMe()
      .then(info => { setAdminInfo(info); setAdminOk(true); setNeedsPassword(false); })
      .catch((err) => {
        const msg = err?.message || '';
        if (msg.includes('admin_password_required') || msg.includes('Invalid admin password')) {
          setNeedsPassword(true);
          setAdminOk(null);
        } else {
          setAdminOk(false);
        }
      });
  }, [user]);

  useEffect(() => { checkAdmin(); }, [checkAdmin]);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setAdminPassword(passwordInput);
    // Re-check with the new password
    api.adminMe()
      .then(info => { setAdminInfo(info); setAdminOk(true); setNeedsPassword(false); })
      .catch((err) => {
        const msg = err?.message || '';
        if (msg.includes('admin_password_required') || msg.includes('Invalid admin password')) {
          setPasswordError('Galat password. Dobara try karo.');
          clearAdminPassword();
        } else {
          setAdminOk(false);
          setNeedsPassword(false);
        }
      });
  };

  // Not signed in
  if (!authLoading && !user) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-surface p-8 rounded-2xl border border-line shadow-2xl text-center">
          <div className="w-16 h-16 bg-accent/10 border border-accent/25 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="text-accent-light w-10 h-10" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Admin Portal</h2>
          <p className="text-ink-3 text-sm mb-6">Sign in with your Google account to continue</p>
          <button onClick={() => signInWithGoogle().catch(e => setError(e.message))}
            className="w-full bg-accent text-on-accent font-bold py-3 rounded-xl hover:bg-accent/90 transition-all">
            Sign in with Google
          </button>
          {error && <p className="mt-4 text-red-400 text-sm">{error}</p>}
        </motion.div>
      </div>
    );
  }

  // Password entry screen
  if (needsPassword && user) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-surface p-8 rounded-2xl border border-line shadow-2xl text-center">
          <div className="w-16 h-16 bg-accent/10 border border-accent/25 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="text-accent-light w-10 h-10" />
          </div>
          <h2 className="text-2xl font-bold mb-1">Admin Password</h2>
          <p className="text-ink-3 text-sm mb-6">Signed in as {user.email}. Enter admin password to continue.</p>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <input
              type="password"
              value={passwordInput}
              onChange={e => setPasswordInput(e.target.value)}
              placeholder="Enter admin password"
              className="w-full bg-surface-2 border border-line rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent"
              autoFocus
              required
            />
            {passwordError && <p className="text-red-400 text-sm">{passwordError}</p>}
            <button type="submit"
              className="w-full bg-accent text-on-accent font-bold py-3 rounded-xl hover:bg-accent/90 transition-all">
              Verify
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  // Loading
  if (authLoading || adminOk === null) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-ink-3 animate-spin" />
      </div>
    );
  }

  // Not admin
  if (!adminOk) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-4">
        <div className="bg-surface p-8 rounded-2xl border border-line max-w-md text-center">
          <Ban className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Not Authorised</h2>
          <p className="text-ink-3 text-sm">Your account ({user?.email}) is not in the admin allowlist.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#0A0A0A] font-sans text-ink">
      {/* Sidebar */}
      <aside className="w-64 bg-surface border-r border-line flex flex-col">
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-accent/10 border border-accent/25 rounded-xl flex items-center justify-center">
            <Zap className="text-accent-light w-6 h-6 fill-white" />
          </div>
          <div>
            <span className="font-bold text-[18px] tracking-tight block">Admin Panel</span>
            <span className="text-[11px] text-ink-3 uppercase tracking-widest font-bold">Management</span>
          </div>
        </div>
        <nav className="flex-1 px-4 space-y-1 mt-4">
          {TABS.map(t => (
            <button key={t.name} onClick={() => setActiveTab(t.name)}
              className={`w-full flex items-center gap-3 px-4 h-11 rounded-xl transition-all text-[14px] font-medium ${
                activeTab === t.name
                  ? 'bg-surface-3 text-ink shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]'
                  : 'text-ink-3 hover:text-ink hover:bg-surface-2'
              }`}>
              <t.icon size={18} />
              {t.name}
            </button>
          ))}
        </nav>
        <div className="p-4">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-2 border border-line">
            {adminInfo?.picture
              ? <img src={adminInfo.picture} className="w-8 h-8 rounded-lg" />
              : <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center"><UserIcon size={16} /></div>}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold truncate">{adminInfo?.name || 'Admin'}</p>
              <p className="text-[10px] text-ink-3 truncate">{adminInfo?.email}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-surface/50 backdrop-blur-md border-b border-line flex items-center justify-between px-8">
          <h1 className="text-[18px] font-bold">{activeTab}</h1>
          <button onClick={() => { window.location.href = '/'; }}
            className="px-4 py-2 text-xs font-bold text-ink-3 hover:text-ink rounded-lg transition-all">
            Back to App
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          {activeTab === 'Overview' && <OverviewTab />}
          {activeTab === 'Users' && <UsersTab />}
          {activeTab === 'Reports' && <ReportsTab />}
          {activeTab === 'Activity' && <ActivityTab />}
          {activeTab === 'API Keys' && <ApiKeysTab />}
          {activeTab === 'Settings' && <SettingsTab />}
          {activeTab === 'Audit' && <AuditTab />}
        </div>
      </main>
    </div>
  );
};

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------
const KpiCard = ({ label, value, sub, icon: Icon, color = 'text-accent' }: { label: string; value: string | number; sub?: string; icon: any; color?: string }) => (
  <div className="bg-surface p-5 rounded-2xl border border-line">
    <div className="flex items-center justify-between mb-3">
      <div className={`p-2.5 rounded-xl bg-surface-2 ${color}`}><Icon size={20} /></div>
    </div>
    <p className="text-[12px] text-ink-3 font-bold uppercase tracking-wider">{label}</p>
    <h3 className="text-[24px] font-bold mt-1">{value}</h3>
    {sub && <p className="text-[11px] text-ink-3 mt-1">{sub}</p>}
  </div>
);

// ---------------------------------------------------------------------------
// Overview Tab
// ---------------------------------------------------------------------------
const OverviewTab = () => {
  const [data, setData] = useState<api.OverviewData | null>(null);
  const [range, setRange] = useState(30);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api.fetchOverview(range).then(setData).catch(console.error).finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);

  // Trigger purge on first load (at most once/day on backend)
  useEffect(() => { api.triggerPurge().catch(() => {}); }, []);

  if (loading && !data) return <div className="flex justify-center py-20"><RefreshCw className="w-6 h-6 animate-spin text-ink-3" /></div>;
  if (!data) return null;
  const k = data.kpis;

  return (
    <>
      <div className="flex items-center gap-3 mb-2">
        {[7, 30, 90].map(r => (
          <button key={r} onClick={() => setRange(r)}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${range === r ? 'bg-accent text-on-accent' : 'bg-surface-2 text-ink-3 hover:text-ink'}`}>
            {r}d
          </button>
        ))}
        <button onClick={load} className="ml-auto p-2 text-ink-3 hover:text-ink"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <KpiCard label="Total Users" value={fmt(k.totalUsers)} sub={`+${fmt(k.newUsersWeek)} this week`} icon={Users} color="text-blue-400" />
        <KpiCard label="Active Today" value={fmt(k.activeToday)} sub={`7d: ${fmt(k.active7d)} / 30d: ${fmt(k.active30d)}`} icon={Activity} color="text-green-400" />
        <KpiCard label="Requests" value={fmt(k.totalRequests)} icon={Zap} color="text-yellow-400" />
        <KpiCard label="Error Rate" value={`${k.errorRate}%`} sub={`${fmt(k.totalErrors)} errors`} icon={AlertTriangle} color="text-red-400" />
        <KpiCard label="Pages" value={fmt(k.totalPages)} icon={FileText} color="text-purple-400" />
        <KpiCard label="Blocked" value={fmt(k.blockedUsers)} icon={Ban} color="text-red-400" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-surface p-5 rounded-2xl border border-line">
          <h3 className="text-sm font-bold mb-4">Requests per Day</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.daySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1F1F1F" vertical={false} />
                <XAxis dataKey="day" tick={{ fill: '#555', fontSize: 10 }} />
                <YAxis tick={{ fill: '#555', fontSize: 10 }} />
                <Tooltip contentStyle={{ backgroundColor: '#111', border: '1px solid #222', borderRadius: 8 }} />
                <Area type="monotone" dataKey="requests" stroke="#3B82F6" fill="#3B82F640" />
                <Area type="monotone" dataKey="errors" stroke="#EF4444" fill="#EF444420" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-surface p-5 rounded-2xl border border-line">
          <h3 className="text-sm font-bold mb-4">By Feature</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.byFeature} dataKey="requests" nameKey="feature" cx="50%" cy="50%" outerRadius={80} label={({ name }) => name}>
                  {data.byFeature.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#111', border: '1px solid #222', borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top users */}
      {data.topUsers.length > 0 && (
        <div className="bg-surface p-5 rounded-2xl border border-line">
          <h3 className="text-sm font-bold mb-4">Top 10 Users</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-ink-3 text-xs uppercase">
              <th className="text-left pb-3">User</th><th className="text-right pb-3">Requests</th>
            </tr></thead>
            <tbody>
              {data.topUsers.map(u => (
                <tr key={u.uid} className="border-t border-line">
                  <td className="py-2">{u.name || u.email || u.uid}</td>
                  <td className="py-2 text-right font-mono">{fmt(u.requests)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// Users Tab
// ---------------------------------------------------------------------------
const UsersTab = () => {
  const [users, setUsers] = useState<api.UserRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [recent, setRecent] = useState(0);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const load = () => setRevision(v => v + 1);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const result = await api.fetchUsers({ search, page, pageSize: 50 });
        if (active) { setUsers(result.users); setTotal(result.total); setRecent(result.recent); setError(''); }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Could not load users.');
      } finally { if (active) setLoading(false); }
    };
    setLoading(true);
    const start = setTimeout(refresh, 250);
    const timer = setInterval(refresh, 60000);
    return () => { active = false; clearTimeout(start); clearInterval(timer); };
  }, [search, page, revision]);

  if (selectedUid) return <UserDetailView uid={selectedUid} onBack={() => { setSelectedUid(null); load(); }} />;

  return (
    <>
      {error ? <p role="alert" className="text-red-400 mb-3">{error}</p> : !loading && <div className="flex gap-3 items-center mb-3 text-sm">
        <strong>{total} {search ? 'matching' : 'registered'} users</strong><span>{recent} active in last 5 minutes (all users)</span>
        {total > 50 && <><button disabled={page <= 1} onClick={()=>setPage(p=>p-1)}>Previous</button>
        <span>Page {page} of {Math.ceil(total/50)}</span><button disabled={page*50 >= total} onClick={()=>setPage(p=>p+1)}>Next</button></>}
      </div>}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input value={search} onChange={e => { setPage(1); setSearch(e.target.value); }}
            placeholder="Search users by name or email..."
            className="w-full bg-surface border border-line rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-accent" />
        </div>
        <button onClick={load} className="p-2.5 bg-surface border border-line rounded-xl text-ink-3 hover:text-ink">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="bg-surface rounded-2xl border border-line overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-canvas text-xs text-ink-3 uppercase">
            <th className="px-4 py-3 text-left">User</th>
            <th className="px-4 py-3 text-left">Status</th>
            <th className="px-4 py-3 text-right">Today</th>
            <th className="px-4 py-3 text-right">30d</th>
            <th className="px-4 py-3 text-left">Last Seen</th>
            <th className="px-4 py-3 text-right">Limit</th>
            <th className="px-4 py-3"></th>
          </tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.uid} className="border-t border-line hover:bg-surface-2/50 cursor-pointer" onClick={() => setSelectedUid(u.uid)}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {u.photo_url ? <img src={u.photo_url} className="w-7 h-7 rounded-full" /> : <div className="w-7 h-7 rounded-full bg-surface-2" />}
                    <div>
                      <p className="font-medium text-sm">{u.name || '-'}</p>
                      <p className="text-xs text-ink-3">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                    u.status === 'blocked' ? 'bg-red-500/15 text-red-400' : 'bg-green-500/15 text-green-400'
                  }`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${u.status === 'blocked' ? 'bg-red-500' : 'bg-green-500'}`} />
                    {u.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs">{u.usageToday}</td>
                <td className="px-4 py-3 text-right font-mono text-xs">{u.usage30d}</td>
                <td className="px-4 py-3 text-xs text-ink-3">{u.last_seen_at ? new Date(u.last_seen_at).toLocaleString() : '-'}</td>
                <td className="px-4 py-3 text-right text-xs">{u.daily_limit ?? 'default'}</td>
                <td className="px-4 py-3"><ChevronRight size={14} className="text-ink-3" /></td>
              </tr>
            ))}
            {users.length === 0 && !error && !loading && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-ink-3">No users found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// User Detail View
// ---------------------------------------------------------------------------
const UserDetailView = ({ uid, onBack }: { uid: string; onBack: () => void }) => {
  const [data, setData] = useState<api.UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [limitInput, setLimitInput] = useState('');
  const [reasonInput, setReasonInput] = useState('');
  const [noteInput, setNoteInput] = useState('');

  useEffect(() => {
    api.fetchUserDetail(uid).then(d => {
      setData(d);
      setLimitInput(d.access.daily_limit == null ? '' : String(d.access.daily_limit));
      setReasonInput(d.access.blocked_reason || '');
      setNoteInput(d.access.note || '');
    }).catch(console.error).finally(() => setLoading(false));
  }, [uid]);

  const patchUser = async (body: any) => {
    setSaving(true);
    try {
      await api.patchUser(uid, body);
      const updated = await api.fetchUserDetail(uid);
      setData(updated);
    } catch (err: any) { alert(err.message); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex justify-center py-20"><RefreshCw className="w-6 h-6 animate-spin text-ink-3" /></div>;
  if (!data) return <p className="text-ink-3">User not found.</p>;

  const u = data.user;
  const a = data.access;
  const isBlocked = a.status === 'blocked';

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-ink-3 hover:text-ink mb-4">
        <ArrowLeft size={16} /> Back to Users
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile & Controls */}
        <div className="space-y-4">
          <div className="bg-surface p-5 rounded-2xl border border-line">
            <div className="flex items-center gap-3 mb-4">
              {u.photo_url ? <img src={u.photo_url} className="w-12 h-12 rounded-xl" /> : <div className="w-12 h-12 rounded-xl bg-surface-2" />}
              <div>
                <p className="font-bold">{u.name || '-'}</p>
                <p className="text-xs text-ink-3">{u.email}</p>
              </div>
            </div>
            <div className="text-xs text-ink-3 space-y-1">
              <p>UID: <span className="font-mono">{u.uid}</span></p>
              <p>First seen: {fmtDate(u.first_seen_at)}</p>
              <p>Last seen: {fmtDate(u.last_seen_at)}</p>
            </div>
          </div>

          <div className="bg-surface p-5 rounded-2xl border border-line space-y-3">
            <h4 className="text-sm font-bold">Controls</h4>
            <div>
              <label className="text-xs text-ink-3">Status</label>
              <div className="flex gap-2 mt-1">
                <button onClick={() => patchUser({ status: 'active', blocked_reason: '' })} disabled={saving}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg border ${!isBlocked ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'border-line text-ink-3 hover:text-ink'}`}>
                  <Unlock size={14} className="inline mr-1" /> Active
                </button>
                <button onClick={() => patchUser({ status: 'blocked', blocked_reason: reasonInput })} disabled={saving}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg border ${isBlocked ? 'bg-red-500/15 text-red-400 border-red-500/30' : 'border-line text-ink-3 hover:text-ink'}`}>
                  <Ban size={14} className="inline mr-1" /> Block
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs text-ink-3">Blocked Reason</label>
              <input value={reasonInput} onChange={e => setReasonInput(e.target.value)}
                className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm mt-1" placeholder="Reason..." />
            </div>
            <div>
              <label className="text-xs text-ink-3">Daily Limit (empty = default)</label>
              <div className="flex gap-2 mt-1">
                <input value={limitInput} onChange={e => setLimitInput(e.target.value)} type="number"
                  className="flex-1 bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm" placeholder="Unlimited" />
                <button onClick={() => patchUser({ daily_limit: limitInput ? Number(limitInput) : null })} disabled={saving}
                  className="px-3 py-2 bg-accent text-on-accent text-xs font-bold rounded-lg">Save</button>
              </div>
            </div>
            <div>
              <label className="text-xs text-ink-3">Note</label>
              <textarea value={noteInput} onChange={e => setNoteInput(e.target.value)} rows={2}
                className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm mt-1" placeholder="Internal note..." />
              <button onClick={() => patchUser({ note: noteInput })} disabled={saving}
                className="mt-1 px-3 py-1.5 bg-surface-2 border border-line text-xs font-bold rounded-lg hover:border-accent">Save Note</button>
            </div>
          </div>

          <div className="bg-surface p-5 rounded-2xl border border-line">
            <h4 className="text-sm font-bold mb-2">Saved Work (browser-reported)</h4>
            <p className="text-xs text-ink-3">History items: {data.savedWork.historyCount}</p>
            <p className="text-xs text-ink-3">Mocktests: {data.savedWork.mocktestCount}</p>
          </div>
        </div>

        {/* Usage charts + events */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-surface p-5 rounded-2xl border border-line">
            <h4 className="text-sm font-bold mb-3">Usage (30 days)</h4>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.daySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1F1F1F" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: '#555', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#555', fontSize: 10 }} />
                  <Tooltip contentStyle={{ backgroundColor: '#111', border: '1px solid #222', borderRadius: 8 }} />
                  <Area type="monotone" dataKey="requests" stroke="#3B82F6" fill="#3B82F640" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-surface p-5 rounded-2xl border border-line">
            <h4 className="text-sm font-bold mb-3">Recent Activity</h4>
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-ink-3 uppercase">
                  <th className="text-left pb-2">Time</th><th className="text-left pb-2">Feature</th>
                  <th className="text-left pb-2">Engine</th><th className="text-left pb-2">Model</th>
                  <th className="text-right pb-2">Tokens</th><th className="text-left pb-2">Status</th>
                </tr></thead>
                <tbody>
                  {data.events.map(e => (
                    <tr key={e.id} className="border-t border-line">
                      <td className="py-1.5 text-ink-3">{new Date(e.ts).toLocaleString()}</td>
                      <td className="py-1.5">{e.feature}</td>
                      <td className="py-1.5">{e.engine}</td>
                      <td className="py-1.5 text-ink-3">{e.model || '-'}</td>
                      <td className="py-1.5 text-right font-mono">{(e.input_tokens || 0) + (e.output_tokens || 0)}</td>
                      <td className="py-1.5">
                        <span className={e.status === 'ok' ? 'text-green-400' : 'text-red-400'}>{e.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {data.audit.length > 0 && (
            <div className="bg-surface p-5 rounded-2xl border border-line">
              <h4 className="text-sm font-bold mb-3">Admin Actions on This User</h4>
              {data.audit.map(a => (
                <div key={a.id} className="text-xs py-2 border-t border-line first:border-0">
                  <span className="text-ink-3">{fmtDate(a.ts)}</span> — <strong>{a.action}</strong> by {a.admin_email}
                  {a.details && <span className="text-ink-3 ml-2">{JSON.stringify(a.details)}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Reports Tab
// ---------------------------------------------------------------------------
const ReportsTab = () => {
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [groupBy, setGroupBy] = useState('day');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    api.fetchReports({ from, to, groupBy }).then((d: any) => setRows(d.rows || [])).catch(console.error).finally(() => setLoading(false));
  };

  const downloadCsv = () => {
    api.fetchReports({ from, to, groupBy, format: 'csv' }).then((csv: any) => {
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `report-${from}-${to}.csv`; a.click();
      URL.revokeObjectURL(url);
    }).catch(console.error);
  };

  useEffect(load, []);

  return (
    <>
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div>
          <label className="text-xs text-ink-3 block mb-1">From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="bg-surface border border-line rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs text-ink-3 block mb-1">To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="bg-surface border border-line rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs text-ink-3 block mb-1">Group by</label>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)} className="bg-surface border border-line rounded-lg px-3 py-2 text-sm">
            <option value="day">Day</option><option value="user">User</option><option value="feature">Feature</option><option value="engine">Engine</option>
          </select>
        </div>
        <button onClick={load} className="px-4 py-2 bg-accent text-on-accent text-xs font-bold rounded-lg">Generate</button>
        <button onClick={downloadCsv} className="px-4 py-2 bg-surface border border-line text-xs font-bold rounded-lg flex items-center gap-1">
          <Download size={14} /> CSV
        </button>
      </div>

      {loading ? <div className="flex justify-center py-10"><RefreshCw className="w-6 h-6 animate-spin text-ink-3" /></div> : (
        <>
          {rows.length > 0 && (
            <div className="bg-surface p-5 rounded-2xl border border-line mb-4">
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1F1F1F" vertical={false} />
                    <XAxis dataKey={groupBy} tick={{ fill: '#555', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#555', fontSize: 10 }} />
                    <Tooltip contentStyle={{ backgroundColor: '#111', border: '1px solid #222', borderRadius: 8 }} />
                    <Bar dataKey="requests" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="errors" fill="#EF4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          <div className="bg-surface rounded-2xl border border-line overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-canvas text-xs text-ink-3 uppercase">
                <th className="px-4 py-3 text-left">{groupBy}</th>
                <th className="px-4 py-3 text-right">Requests</th>
                <th className="px-4 py-3 text-right">Errors</th>
                <th className="px-4 py-3 text-right">Pages</th>
                <th className="px-4 py-3 text-right">Input Tokens</th>
                <th className="px-4 py-3 text-right">Output Tokens</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-4 py-2">{r[groupBy]}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmt(r.requests)}</td>
                    <td className="px-4 py-2 text-right font-mono text-red-400">{fmt(r.errors)}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmt(r.pages)}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmt(r.input_tokens)}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmt(r.output_tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// Activity Tab
// ---------------------------------------------------------------------------
const ActivityTab = () => {
  const [events, setEvents] = useState<api.UsageEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<number | null>(null);
  const [filterUid, setFilterUid] = useState('');
  const [filterFeature, setFilterFeature] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const load = useCallback((append = false) => {
    setLoading(true);
    api.fetchActivity({ uid: filterUid || undefined, feature: filterFeature || undefined, status: filterStatus || undefined, cursor: append ? cursor ?? undefined : undefined })
      .then(d => { setEvents(prev => append ? [...prev, ...d.events] : d.events); setCursor(d.nextCursor); })
      .catch(console.error).finally(() => setLoading(false));
  }, [filterUid, filterFeature, filterStatus, cursor]);

  useEffect(() => { load(); }, [filterUid, filterFeature, filterStatus]);

  return (
    <>
      <div className="flex flex-wrap gap-3 mb-4">
        <input value={filterUid} onChange={e => setFilterUid(e.target.value)} placeholder="Filter by UID..."
          className="bg-surface border border-line rounded-lg px-3 py-2 text-sm w-48" />
        <input value={filterFeature} onChange={e => setFilterFeature(e.target.value)} placeholder="Feature..."
          className="bg-surface border border-line rounded-lg px-3 py-2 text-sm w-40" />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="bg-surface border border-line rounded-lg px-3 py-2 text-sm">
          <option value="">All statuses</option><option value="ok">ok</option><option value="error">error</option>
        </select>
      </div>

      <div className="bg-surface rounded-2xl border border-line overflow-hidden">
        <table className="w-full text-xs">
          <thead><tr className="bg-canvas text-ink-3 uppercase text-[10px]">
            <th className="px-3 py-3 text-left">Time</th><th className="px-3 py-3 text-left">User</th>
            <th className="px-3 py-3 text-left">Feature</th><th className="px-3 py-3 text-left">Engine</th>
            <th className="px-3 py-3 text-left">Provider/Model</th><th className="px-3 py-3 text-right">Tokens</th>
            <th className="px-3 py-3 text-right">Duration</th><th className="px-3 py-3 text-left">Status</th>
            <th className="px-3 py-3 text-left">Source</th>
          </tr></thead>
          <tbody>
            {events.map(e => (
              <tr key={e.id} className="border-t border-line hover:bg-surface-2/50">
                <td className="px-3 py-2 text-ink-3 whitespace-nowrap">{new Date(e.ts).toLocaleString()}</td>
                <td className="px-3 py-2">{e.userName || e.uid}</td>
                <td className="px-3 py-2">{e.feature}</td>
                <td className="px-3 py-2">{e.engine}</td>
                <td className="px-3 py-2 text-ink-3">{[e.provider, e.model].filter(Boolean).join(' / ') || '-'}</td>
                <td className="px-3 py-2 text-right font-mono">{(e.input_tokens || 0) + (e.output_tokens || 0)}</td>
                <td className="px-3 py-2 text-right font-mono">{e.duration_ms ? `${(e.duration_ms / 1000).toFixed(1)}s` : '-'}</td>
                <td className="px-3 py-2">
                  <span className={e.status === 'ok' ? 'text-green-400' : 'text-red-400'}>{e.status}</span>
                  {e.error && <p className="text-red-400/60 truncate max-w-[200px]">{e.error}</p>}
                </td>
                <td className="px-3 py-2 text-ink-3">{e.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {cursor && (
          <div className="p-3 text-center border-t border-line">
            <button onClick={() => load(true)} className="text-xs text-accent hover:underline" disabled={loading}>
              {loading ? 'Loading...' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// API Keys Tab
// ---------------------------------------------------------------------------
const ApiKeysTab = () => {
  const [stats, setStats] = useState<{ keys: api.KeyStat[]; deadKeys: api.KeyStat[] }>({ keys: [], deadKeys: [] });
  const [loading, setLoading] = useState(true);

  const load = () => { setLoading(true); api.fetchKeyStats().then(setStats).catch(console.error).finally(() => setLoading(false)); };
  useEffect(() => { load(); const iv = setInterval(load, 10000); return () => clearInterval(iv); }, []);

  const markDead = async (keyId: string) => {
    if (!confirm('Mark this key as dead?')) return;
    await api.deactivateKey(keyId); load();
  };
  const reset = async (keyId?: string) => {
    await api.resetKeyHealth(keyId); load();
  };

  const allKeys = [...stats.keys, ...stats.deadKeys];

  return (
    <div className="bg-surface rounded-2xl border border-line overflow-hidden">
      <div className="p-5 border-b border-line flex items-center justify-between">
        <h3 className="text-sm font-bold flex items-center gap-2"><Key size={16} className="text-accent" /> API Key Pool</h3>
        <div className="flex gap-2">
          <button onClick={() => reset()} className="px-3 py-1.5 text-xs bg-surface-2 border border-line rounded-lg hover:border-accent">Reset All</button>
          <button onClick={load} className="p-1.5 text-ink-3 hover:text-ink"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="bg-canvas text-xs text-ink-3 uppercase">
          <th className="px-4 py-3 text-left">Key</th><th className="px-4 py-3">Status</th>
          <th className="px-4 py-3 text-right">Success</th><th className="px-4 py-3 text-right">Errors</th>
          <th className="px-4 py-3 text-right">In-Flight</th><th className="px-4 py-3">Last Success</th>
          <th className="px-4 py-3">Cooldown</th><th className="px-4 py-3">Actions</th>
        </tr></thead>
        <tbody>
          {allKeys.map((k, i) => (
            <tr key={k.keyId} className="border-t border-line hover:bg-surface-2/50">
              <td className="px-4 py-3 font-mono text-xs">{k.keyPrefix}</td>
              <td className="px-4 py-3 text-center">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  k.isDead ? 'bg-red-500/15 text-red-400' : k.isDailyExhausted ? 'bg-yellow-500/15 text-yellow-400' : k.cooldownRemainingSec > 0 ? 'bg-orange-500/15 text-orange-400' : 'bg-green-500/15 text-green-400'
                }`}>{k.isDead ? 'Dead' : k.isDailyExhausted ? 'Exhausted' : k.cooldownRemainingSec > 0 ? 'Cooldown' : 'Active'}</span>
              </td>
              <td className="px-4 py-3 text-right font-mono text-green-400">{k.totalSuccesses}</td>
              <td className="px-4 py-3 text-right font-mono text-red-400">{k.totalErrors}</td>
              <td className="px-4 py-3 text-right font-mono">{k.inFlight}</td>
              <td className="px-4 py-3 text-xs text-ink-3">{fmtTime(k.lastSuccessTime)}</td>
              <td className="px-4 py-3 text-xs">{k.cooldownRemainingSec > 0 ? `${k.cooldownRemainingSec}s` : '-'}</td>
              <td className="px-4 py-3">
                <div className="flex gap-1">
                  {!k.isDead && <button onClick={() => markDead(k.keyId)} className="p-1.5 text-ink-3 hover:text-red-400 rounded-lg" title="Mark dead"><Trash2 size={14} /></button>}
                  <button onClick={() => reset(k.keyId)} className="p-1.5 text-ink-3 hover:text-accent rounded-lg" title="Reset"><RefreshCw size={14} /></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Settings Tab
// ---------------------------------------------------------------------------
const SettingsTab = () => {
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [limitVal, setLimitVal] = useState('');
  const [retentionVal, setRetentionVal] = useState('');

  useEffect(() => {
    api.fetchSettings().then(s => {
      setSettings(s);
      setLimitVal(s.default_daily_limit == null ? '' : String(s.default_daily_limit));
      setRetentionVal(String(s.retention_days ?? 90));
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateSettings({
        default_daily_limit: limitVal ? Number(limitVal) : null,
        retention_days: Number(retentionVal) || 90,
      });
      const updated = await api.fetchSettings();
      setSettings(updated);
    } catch (err: any) { alert(err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="bg-surface p-6 rounded-2xl border border-line space-y-4">
        <h3 className="text-sm font-bold">Usage Limits</h3>
        <div>
          <label className="text-xs text-ink-3 block mb-1">Default Daily Limit (server-key requests per user per day)</label>
          <input value={limitVal} onChange={e => setLimitVal(e.target.value)} type="number"
            className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm" placeholder="Empty = unlimited" />
          <p className="text-[10px] text-ink-3 mt-1">Leave empty for unlimited. Per-user overrides take precedence.</p>
        </div>
        <div>
          <label className="text-xs text-ink-3 block mb-1">Event Retention (days)</label>
          <input value={retentionVal} onChange={e => setRetentionVal(e.target.value)} type="number"
            className="w-full bg-surface-2 border border-line rounded-lg px-3 py-2 text-sm" placeholder="90" />
        </div>
        <button onClick={save} disabled={saving || loading}
          className="px-4 py-2 bg-accent text-on-accent text-xs font-bold rounded-lg disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <div className="bg-surface p-6 rounded-2xl border border-line">
        <h3 className="text-sm font-bold mb-4">Google Drive Connection</h3>
        <AdminDrive />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Audit Tab
// ---------------------------------------------------------------------------
const AuditTab = () => {
  const [entries, setEntries] = useState<api.AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<number | null>(null);

  const load = (append = false) => {
    setLoading(true);
    api.fetchAudit(append ? cursor ?? undefined : undefined)
      .then(d => { setEntries(prev => append ? [...prev, ...d.entries] : d.entries); setCursor(d.nextCursor); })
      .catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="bg-surface rounded-2xl border border-line overflow-hidden">
      <div className="p-5 border-b border-line">
        <h3 className="text-sm font-bold flex items-center gap-2"><Shield size={16} className="text-accent" /> Admin Audit Log</h3>
      </div>
      <table className="w-full text-xs">
        <thead><tr className="bg-canvas text-ink-3 uppercase text-[10px]">
          <th className="px-4 py-3 text-left">Time</th><th className="px-4 py-3 text-left">Admin</th>
          <th className="px-4 py-3 text-left">Action</th><th className="px-4 py-3 text-left">Target</th>
          <th className="px-4 py-3 text-left">Details</th>
        </tr></thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.id} className="border-t border-line">
              <td className="px-4 py-2 text-ink-3 whitespace-nowrap">{fmtDate(e.ts)}</td>
              <td className="px-4 py-2">{e.admin_email}</td>
              <td className="px-4 py-2 font-bold">{e.action}</td>
              <td className="px-4 py-2 font-mono text-ink-3">{e.target_uid || '-'}</td>
              <td className="px-4 py-2 text-ink-3 max-w-xs truncate">{e.details ? JSON.stringify(e.details) : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {cursor && (
        <div className="p-3 text-center border-t border-line">
          <button onClick={() => load(true)} className="text-xs text-accent hover:underline">{loading ? 'Loading...' : 'Load more'}</button>
        </div>
      )}
    </div>
  );
};

export default AdminPanel;
