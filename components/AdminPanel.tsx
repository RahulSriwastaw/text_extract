import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart3, 
  Settings, 
  ChevronDown, 
  MoreVertical, 
  ArrowUpRight, 
  ArrowDownRight,
  Plus,
  Filter,
  Search,
  Activity,
  Zap,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  RefreshCw,
  Clock,
  Key
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart,
  Area
} from 'recharts';

interface KeyStats {
  key: string;
  keyPrefix: string;
  lastErrorTime: number;
  lastSuccessTime: number;
  consecutiveErrors: number;
  totalErrors: number;
  totalSuccesses: number;
  errorType?: string;
  isDead: boolean;
}

const AdminPanel = () => {
  const [activeTab, setActiveTab] = useState('Overview');
  const [keyStats, setKeyStats] = useState<KeyStats[]>([]);
  const [deadKeys, setDeadKeys] = useState<KeyStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginData, setLoginData] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');

  const getAuthHeader = () => {
    const creds = localStorage.getItem('admin_creds');
    if (!creds) return {};
    return { 'Authorization': `Basic ${creds}` };
  };

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/admin/stats', {
        headers: getAuthHeader()
      });
      if (res.status === 401 || res.status === 403) {
        setIsAuthenticated(false);
        localStorage.removeItem('admin_creds');
        return;
      }
      const data = await res.json();
      setKeyStats(data.keys || []);
      setDeadKeys(data.deadKeys || []);
      setLastRefreshed(new Date());
      setIsAuthenticated(true);
    } catch (err) {
      console.error("Failed to fetch stats", err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setLoginError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginData)
      });
      
      if (res.ok) {
        const creds = btoa(`${loginData.username}:${loginData.password}`);
        localStorage.setItem('admin_creds', creds);
        setIsAuthenticated(true);
        fetchStats();
      } else {
        setLoginError('Invalid username or password');
      }
    } catch (err) {
      setLoginError('Login failed. Please check your server connection.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (localStorage.getItem('admin_creds')) {
      fetchStats();
    } else {
      setLoading(false);
    }
    
    const interval = setInterval(() => {
      if (localStorage.getItem('admin_creds')) {
        fetchStats();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const markAsDead = async (key: string) => {
    if (!confirm("Are you sure you want to mark this key as dead? It will be removed from circulation.")) return;
    try {
      await fetch('/api/admin/dead-key', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...getAuthHeader()
        },
        body: JSON.stringify({ key })
      });
      fetchStats();
    } catch (err) {
      alert("Failed to mark key as dead");
    }
  };

  if (!isAuthenticated && !loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-[#111111] p-8 rounded-2xl border border-[#1F1F1F] shadow-2xl"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-[#FF6B2B] rounded-2xl flex items-center justify-center shadow-lg shadow-[#FF6B2B]/20 mb-4">
              <ShieldCheck className="text-white w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold">Admin Portal</h2>
            <p className="text-[#555555] text-sm mt-1">Please sign in to continue</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-xs font-bold text-[#555555] uppercase tracking-widest mb-2">Username</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555555]">
                  <Search size={18} />
                </div>
                <input 
                  type="text" 
                  value={loginData.username}
                  onChange={(e) => setLoginData({...loginData, username: e.target.value})}
                  className="w-full bg-[#1A1A1A] border border-[#252525] rounded-xl pl-10 pr-4 py-3 focus:outline-none focus:border-[#FF6B2B] transition-all"
                  placeholder="Enter username"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#555555] uppercase tracking-widest mb-2">Password</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555555]">
                  <Key size={18} />
                </div>
                <input 
                  type="password" 
                  value={loginData.password}
                  onChange={(e) => setLoginData({...loginData, password: e.target.value})}
                  className="w-full bg-[#1A1A1A] border border-[#252525] rounded-xl pl-10 pr-4 py-3 focus:outline-none focus:border-[#FF6B2B] transition-all"
                  placeholder="Enter password"
                  required
                />
              </div>
            </div>

            {loginError && (
              <motion.div 
                initial={{ opacity: 0, x: -10 }} 
                animate={{ opacity: 1, x: 0 }}
                className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 text-sm rounded-lg flex items-center gap-2"
              >
                <AlertTriangle size={16} />
                {loginError}
              </motion.div>
            )}

            <button 
              type="submit"
              disabled={loading}
              className="w-full bg-[#FF6B2B] text-white font-bold py-3 rounded-xl hover:bg-[#FF6B2B]/90 transition-all shadow-lg shadow-[#FF6B2B]/20 active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? "Authenticating..." : "Sign In"}
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  const totalSuccess = keyStats.reduce((acc, k) => acc + k.totalSuccesses, 0) + deadKeys.reduce((acc, k) => acc + k.totalSuccesses, 0);
  const totalErrors = keyStats.reduce((acc, k) => acc + k.totalErrors, 0) + deadKeys.reduce((acc, k) => acc + k.totalErrors, 0);
  const successRate = totalSuccess + totalErrors > 0 ? (totalSuccess / (totalSuccess + totalErrors) * 100).toFixed(1) : "0";

  const chartData = keyStats.map(k => ({
    name: k.keyPrefix,
    success: k.totalSuccesses,
    errors: k.totalErrors
  }));

  return (
    <div className="flex h-screen bg-[#0A0A0A] font-sans text-[#EFEFEF]">
      {/* Sidebar */}
      <aside className="w-64 bg-[#111111] border-r border-[#1F1F1F] flex flex-col">
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-[#FF6B2B] rounded-xl flex items-center justify-center shadow-lg shadow-[#FF6B2B]/20">
            <Zap className="text-white w-6 h-6 fill-white" />
          </div>
          <div>
            <span className="font-bold text-[18px] tracking-tight block">Gemini Admin</span>
            <span className="text-[10px] text-[#555555] uppercase tracking-widest font-bold">API Management</span>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-4">
          {[
            { name: 'Overview', icon: BarChart3 },
            { name: 'Keys Health', icon: Key },
            { name: 'Reports', icon: Activity },
            { name: 'Settings', icon: Settings },
          ].map((item) => (
            <button
              key={item.name}
              onClick={() => setActiveTab(item.name)}
              className={`w-full flex items-center gap-3 px-4 h-12 rounded-xl transition-all duration-200 ${
                activeTab === item.name 
                  ? 'bg-[#FF6B2B] text-white shadow-lg shadow-[#FF6B2B]/20' 
                  : 'text-[#888888] hover:text-[#EFEFEF] hover:bg-[#1A1A1A]'
              }`}
            >
              <item.icon size={18} />
              <span className="text-[14px] font-medium">{item.name}</span>
            </button>
          ))}
        </nav>

        <div className="p-6 mt-auto">
          <div className="bg-[#1A1A1A] rounded-xl p-4 border border-[#252525]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-[#555555] uppercase font-bold">Auto-Refresh</span>
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
            </div>
            <p className="text-[10px] text-[#888888]">Last check: {lastRefreshed.toLocaleTimeString()}</p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-20 bg-[#111111]/50 backdrop-blur-md border-b border-[#1F1F1F] flex items-center justify-between px-8 z-10">
          <div className="flex items-center gap-4 flex-1">
             <h1 className="text-[20px] font-bold tracking-tight">API Performance Dashboard</h1>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={() => {
                localStorage.removeItem('admin_creds');
                window.location.href = '/';
              }}
              className="px-4 py-2 bg-[#F44336]/10 text-[#F44336] hover:bg-[#F44336] hover:text-white rounded-xl border border-[#F44336]/20 transition-all text-[12px] font-bold uppercase tracking-wider"
            >
              Logout
            </button>
            <div className="h-8 w-px bg-[#1F1F1F]"></div>
            <button 
              onClick={fetchStats}
              className="p-2.5 bg-[#1A1A1A] text-[#888888] hover:text-[#EFEFEF] rounded-xl border border-[#252525] transition-all hover:scale-105 active:scale-95"
            >
              <RefreshCw size={20} className={loading ? "animate-spin" : ""} />
            </button>
            <div className="h-8 w-px bg-[#1F1F1F]"></div>
            <div className="flex items-center gap-3 cursor-pointer group">
              <div className="text-right">
                <p className="text-[13px] font-bold">Root Admin</p>
                <p className="text-[11px] text-[#555555] uppercase tracking-wider font-bold">Superuser</p>
              </div>
              <div className="w-10 h-10 bg-gradient-to-br from-[#FF6B2B] to-[#F44336] rounded-xl shadow-lg border-2 border-[#1A1A1A]"></div>
            </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { label: 'Total Requests', value: (totalSuccess + totalErrors).toLocaleString(), growth: 'Real-time', icon: Zap, color: 'text-blue-500' },
              { label: 'Success Rate', value: `${successRate}%`, growth: `${totalSuccess} successful`, icon: CheckCircle2, color: 'text-green-500' },
              { label: 'Total Errors', value: totalErrors.toLocaleString(), growth: `${totalErrors} failures`, icon: AlertTriangle, color: 'text-red-500' },
              { label: 'Active Keys', value: keyStats.length, growth: `${deadKeys.length} dead`, icon: Key, color: 'text-[#FF6B2B]' },
            ].map((kpi, i) => (
              <div key={i} className="bg-[#111111] p-6 rounded-2xl border border-[#1F1F1F] hover:border-[#2A2A2A] transition-all group">
                <div className="flex items-center justify-between mb-4">
                  <div className={`p-3 bg-[#1A1111] rounded-xl ${kpi.color}`}>
                    <kpi.icon size={24} />
                  </div>
                </div>
                <p className="text-[13px] text-[#555555] font-bold uppercase tracking-wider">{kpi.label}</p>
                <div className="flex items-baseline gap-3">
                  <h3 className="text-[28px] font-bold mt-1">{kpi.value}</h3>
                  <span className="text-[11px] text-[#555555] font-medium">{kpi.growth}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-[#111111] p-6 rounded-2xl border border-[#1F1F1F]">
              <h3 className="text-[16px] font-bold mb-8 flex items-center gap-2">
                <BarChart3 size={18} className="text-[#FF6B2B]" />
                Key Performance Distribution
              </h3>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1F1F1F" />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{fill: '#555555', fontSize: 11}} 
                      dy={10}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{fill: '#555555', fontSize: 11}}
                    />
                    <Tooltip 
                      cursor={{fill: '#1A1A1A'}}
                      contentStyle={{backgroundColor: '#111111', borderRadius: '12px', border: '1px solid #1F1F1F', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)'}}
                    />
                    <Bar dataKey="success" name="Success" fill="#4CAF50" radius={[4, 4, 0, 0]} barSize={30} />
                    <Bar dataKey="errors" name="Errors" fill="#F44336" radius={[4, 4, 0, 0]} barSize={30} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-[#111111] p-6 rounded-2xl border border-[#1F1F1F]">
              <h3 className="text-[16px] font-bold mb-8 flex items-center gap-2">
                <Activity size={18} className="text-[#FF6B2B]" />
                Error Distribution
              </h3>
              <div className="space-y-6">
                {keyStats.filter(k => k.totalErrors > 0).slice(0, 5).map((k, i) => (
                  <div key={i} className="flex flex-col gap-2">
                    <div className="flex justify-between text-[12px]">
                      <span className="font-bold">{k.keyPrefix}</span>
                      <span className="text-[#F44336] font-bold">{k.totalErrors} errors</span>
                    </div>
                    <div className="w-full bg-[#1F1F1F] h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-[#F44336] h-full transition-all duration-500" 
                        style={{ width: `${(k.totalErrors / totalErrors * 100) || 0}%` }}
                      ></div>
                    </div>
                    <p className="text-[10px] text-[#555555]">Last error: {k.errorType || 'Unknown'}</p>
                  </div>
                ))}
                {totalErrors === 0 && (
                  <div className="h-full flex flex-col items-center justify-center gap-4 py-20 text-[#555555]">
                    <CheckCircle2 size={48} className="text-green-500/20" />
                    <p className="italic text-[13px]">No errors reported today</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Table Section */}
          <div className="bg-[#111111] rounded-2xl border border-[#1F1F1F] overflow-hidden">
            <div className="p-6 border-b border-[#1F1F1F] flex items-center justify-between">
              <h3 className="text-[16px] font-bold flex items-center gap-2">
                <Key size={18} className="text-[#FF6B2B]" />
                Active Rotation Keys
              </h3>
              <div className="flex gap-3">
                 <span className="text-[12px] bg-[#1A1111] text-[#FF6B2B] font-bold px-3 py-1.5 rounded-lg border border-[#3A1A1A]">
                   {keyStats.length} Online
                 </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-[#0F0F0F]">
                    <th className="px-6 py-4 text-[11px] font-bold text-[#555555] uppercase tracking-widest">API Key Ref</th>
                    <th className="px-6 py-4 text-[11px] font-bold text-[#555555] uppercase tracking-widest">Status</th>
                    <th className="px-6 py-4 text-[11px] font-bold text-[#555555] uppercase tracking-widest">Success/Errors</th>
                    <th className="px-6 py-4 text-[11px] font-bold text-[#555555] uppercase tracking-widest">Last Success</th>
                    <th className="px-6 py-4 text-[11px] font-bold text-[#555555] uppercase tracking-widest">Cooldown</th>
                    <th className="px-6 py-4 text-[11px] font-bold text-[#555555] uppercase tracking-widest">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1F1F1F]">
                  {[...keyStats, ...deadKeys].map((k, i) => {
                    const isCooldown = k.lastErrorTime > 0 && (Date.now() - k.lastErrorTime < 60000);
                    return (
                      <tr key={i} className="hover:bg-[#1A1A1A]/50 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-[11px] ${k.isDead ? 'bg-[#3A1A1A] text-[#F44336]' : 'bg-[#1A2A1A] text-[#4CAF50]'}`}>
                              {i + 1}
                            </div>
                            <span className="font-mono text-[13px] font-bold">{k.keyPrefix}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            k.isDead ? 'bg-[#3A1A1A] text-[#F44336]' :
                            isCooldown ? 'bg-[#332211] text-[#FF9800]' :
                            'bg-[#1A2A1A] text-[#4CAF50]'
                          }`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${k.isDead ? 'bg-[#F44336]' : isCooldown ? 'bg-[#FF9800]' : 'bg-[#4CAF50]'}`}></div>
                            {k.isDead ? 'Dead' : isCooldown ? 'Cooldown' : 'Active'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                           <div className="flex items-center gap-4">
                              <div className="text-right">
                                <p className="text-[12px] font-bold text-green-500 leading-none">{k.totalSuccesses}</p>
                                <p className="text-[9px] text-[#555555] uppercase mt-1">Success</p>
                              </div>
                              <div className="w-px h-6 bg-[#1F1F1F]"></div>
                              <div>
                                <p className="text-[12px] font-bold text-red-500 leading-none">{k.totalErrors}</p>
                                <p className="text-[9px] text-[#555555] uppercase mt-1">Errors</p>
                              </div>
                           </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 text-[#888888]">
                            <Clock size={14} />
                            <span className="text-[12px]">{k.lastSuccessTime > 0 ? new Date(k.lastSuccessTime).toLocaleTimeString() : 'Never'}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                           {isCooldown ? (
                             <span className="text-[11px] text-[#FF9800] font-bold">
                               {Math.ceil((60000 - (Date.now() - k.lastErrorTime)) / 1000)}s left
                             </span>
                           ) : (
                             <span className="text-[11px] text-[#555555]">Ready</span>
                           )}
                        </td>
                        <td className="px-6 py-4">
                          {!k.isDead && (
                            <button 
                              onClick={() => markAsDead(k.key)}
                              className="p-2 text-[#555555] hover:text-[#F44336] hover:bg-[#3A1A1A] rounded-lg transition-all"
                              title="Deactivate Key"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default AdminPanel;
