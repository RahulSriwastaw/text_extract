import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LayoutDashboard, 
  Users, 
  BookOpen, 
  Settings, 
  Bell, 
  Search, 
  ChevronDown, 
  MoreVertical, 
  ArrowUpRight, 
  ArrowDownRight,
  Plus,
  Filter,
  Download,
  Briefcase,
  GraduationCap,
  ShieldCheck,
  X,
  Activity,
  Mail
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line,
  AreaChart,
  Area
} from 'recharts';

const data = [
  { name: 'Jan', students: 4000, revenue: 2400 },
  { name: 'Feb', students: 3000, revenue: 1398 },
  { name: 'Mar', students: 2000, revenue: 9800 },
  { name: 'Apr', students: 2780, revenue: 3908 },
  { name: 'May', students: 1890, revenue: 4800 },
  { name: 'Jun', students: 2390, revenue: 3800 },
  { name: 'Jul', students: 3490, revenue: 4300 },
];

const projects = [
  { 
    id: 1, 
    name: 'Global Academy', 
    status: 'Active', 
    students: 1240, 
    growth: '+12%', 
    manager: 'Sarah Chen',
    description: 'A comprehensive platform for international students focusing on language and culture.',
    recentActivity: [
      { id: 1, type: 'Enrollment', user: 'John Doe', time: '2 hours ago', status: 'Completed' },
      { id: 2, type: 'Course Update', user: 'Sarah Chen', time: '5 hours ago', status: 'Published' },
      { id: 3, type: 'Payment', user: 'Maria Garcia', time: '1 day ago', status: 'Verified' },
    ],
    associatedUsers: [
      { id: 1, name: 'Sarah Chen', role: 'Project Manager', email: 'sarah@global.com' },
      { id: 2, name: 'David Miller', role: 'Instructor', email: 'david@global.com' },
      { id: 3, name: 'Lisa Wong', role: 'Support', email: 'lisa@global.com' },
    ],
    metrics: [
      { name: 'Mon', value: 40 },
      { name: 'Tue', value: 30 },
      { name: 'Wed', value: 60 },
      { name: 'Thu', value: 45 },
      { name: 'Fri', value: 70 },
      { name: 'Sat', value: 55 },
      { name: 'Sun', value: 80 },
    ]
  },
  { 
    id: 2, 
    name: 'Tech Institute', 
    status: 'Active', 
    students: 850, 
    growth: '+5%', 
    manager: 'James Wilson',
    description: 'Advanced technical training center for software engineering and data science.',
    recentActivity: [
      { id: 1, type: 'New Course', user: 'James Wilson', time: '1 hour ago', status: 'Draft' },
      { id: 2, type: 'Enrollment', user: 'Kevin Hart', time: '3 hours ago', status: 'Completed' },
    ],
    associatedUsers: [
      { id: 1, name: 'James Wilson', role: 'Project Manager', email: 'james@tech.com' },
      { id: 2, name: 'Robert Fox', role: 'Lead Dev', email: 'rob@tech.com' },
    ],
    metrics: [
      { name: 'Mon', value: 20 },
      { name: 'Tue', value: 40 },
      { name: 'Wed', value: 35 },
      { name: 'Thu', value: 50 },
      { name: 'Fri', value: 45 },
      { name: 'Sat', value: 60 },
      { name: 'Sun', value: 55 },
    ]
  },
  { id: 3, name: 'Future Skills', status: 'Pending', students: 0, growth: '0%', manager: 'Elena Rodriguez', description: 'Upcoming project focusing on soft skills and leadership.', recentActivity: [], associatedUsers: [], metrics: [] },
  { id: 4, name: 'Creative Arts', status: 'Active', students: 420, growth: '-2%', manager: 'Michael Bay', description: 'Digital arts and media production school.', recentActivity: [], associatedUsers: [], metrics: [] },
  { id: 5, name: 'Science Hub', status: 'Inactive', students: 0, growth: '0%', manager: 'David Kim', description: 'Research and development center for STEM education.', recentActivity: [], associatedUsers: [], metrics: [] },
];

const AdminPanel = () => {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [selectedProject, setSelectedProject] = useState<any>(null);

  return (
    <div className="flex h-screen bg-slate-50 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-navy-900 text-white flex flex-col">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
            <GraduationCap className="text-white w-5 h-5" />
          </div>
          <span className="font-bold text-xl tracking-tight">EduSaaS</span>
        </div>

        <nav className="flex-1 px-4 space-y-1 mt-4">
          {[
            { name: 'Dashboard', icon: LayoutDashboard },
            { name: 'Projects', icon: Briefcase },
            { name: 'Users', icon: Users },
            { name: 'Courses', icon: BookOpen },
            { name: 'Security', icon: ShieldCheck },
            { name: 'Settings', icon: Settings },
          ].map((item) => (
            <button
              key={item.name}
              onClick={() => setActiveTab(item.name)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                activeTab === item.name 
                  ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' 
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <item.icon size={20} />
              <span className="font-medium">{item.name}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 mt-auto">
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            <p className="text-xs text-slate-400 mb-2 uppercase tracking-wider font-semibold">Storage Usage</p>
            <div className="w-full bg-white/10 rounded-full h-1.5 mb-2">
              <div className="bg-orange-500 h-1.5 rounded-full w-3/4"></div>
            </div>
            <p className="text-xs text-slate-300">75% of 100GB used</p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-20 bg-white border-bottom border-slate-200 flex items-center justify-between px-8 shadow-soft z-10">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="text" 
                placeholder="Search projects, users, or reports..." 
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <button className="relative p-2 text-slate-500 hover:bg-slate-50 rounded-lg transition-colors">
              <Bell size={20} />
              <span className="absolute top-2 right-2 w-2 h-2 bg-orange-500 rounded-full border-2 border-white"></span>
            </button>
            <div className="h-8 w-px bg-slate-200"></div>
            <div className="flex items-center gap-3 cursor-pointer group">
              <div className="text-right">
                <p className="text-sm font-bold text-slate-900">Alex Rivera</p>
                <p className="text-xs text-slate-500">Super Admin</p>
              </div>
              <div className="w-10 h-10 bg-slate-200 rounded-xl overflow-hidden border-2 border-transparent group-hover:border-orange-500 transition-all">
                <img src="https://picsum.photos/seed/admin/40/40" alt="Avatar" referrerPolicy="no-referrer" />
              </div>
              <ChevronDown size={16} className="text-slate-400" />
            </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          {/* Page Title */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Enterprise Overview</h1>
              <p className="text-slate-500 mt-1">Monitor performance across all 24 active projects.</p>
            </div>
            <div className="flex gap-3">
              <button className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-medium hover:bg-slate-50 transition-all shadow-soft">
                <Download size={18} />
                Export Data
              </button>
              <button className="flex items-center gap-2 px-4 py-2.5 bg-orange-500 text-white rounded-xl font-medium hover:bg-orange-600 transition-all shadow-lg shadow-orange-500/20">
                <Plus size={18} />
                New Project
              </button>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { label: 'Total Revenue', value: '$428,500', growth: '+14.2%', up: true, icon: Briefcase },
              { label: 'Active Students', value: '12,402', growth: '+8.1%', up: true, icon: Users },
              { label: 'Course Completion', value: '84.2%', growth: '-2.4%', up: false, icon: BookOpen },
              { label: 'System Uptime', value: '99.99%', growth: 'Stable', up: true, icon: ShieldCheck },
            ].map((kpi, i) => (
              <div key={i} className="bg-white p-6 rounded-xl shadow-card border border-slate-100">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 bg-slate-50 rounded-lg text-slate-600">
                    <kpi.icon size={20} />
                  </div>
                  <div className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${
                    kpi.up ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                  }`}>
                    {kpi.up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                    {kpi.growth}
                  </div>
                </div>
                <p className="text-sm text-slate-500 font-medium">{kpi.label}</p>
                <h3 className="text-2xl font-bold text-slate-900 mt-1">{kpi.value}</h3>
              </div>
            ))}
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-card border border-slate-100">
              <div className="flex items-center justify-between mb-8">
                <h3 className="font-bold text-slate-900">Growth Analytics</h3>
                <select className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none">
                  <option>Last 7 Days</option>
                  <option>Last 30 Days</option>
                  <option>Last Year</option>
                </select>
              </div>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data}>
                    <defs>
                      <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#F97316" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#F97316" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{fill: '#94A3B8', fontSize: 12}} 
                      dy={10}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{fill: '#94A3B8', fontSize: 12}}
                    />
                    <Tooltip 
                      contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)'}}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="revenue" 
                      stroke="#F97316" 
                      strokeWidth={3}
                      fillOpacity={1} 
                      fill="url(#colorRevenue)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-card border border-slate-100">
              <h3 className="font-bold text-slate-900 mb-8">User Distribution</h3>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{fill: '#94A3B8', fontSize: 12}}
                      dy={10}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{fill: '#94A3B8', fontSize: 12}}
                    />
                    <Tooltip 
                      cursor={{fill: '#F8FAFC'}}
                      contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)'}}
                    />
                    <Bar dataKey="students" fill="#1E2A38" radius={[4, 4, 0, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Table Section */}
          <div className="bg-white rounded-xl shadow-card border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-slate-900">Project Management</h3>
              <div className="flex gap-2">
                <button className="p-2 text-slate-400 hover:bg-slate-50 rounded-lg transition-colors border border-slate-200">
                  <Filter size={18} />
                </button>
                <button className="p-2 text-slate-400 hover:bg-slate-50 rounded-lg transition-colors border border-slate-200">
                  <Search size={18} />
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Project Name</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Students</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Growth</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Project Manager</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {projects.map((project) => (
                    <tr 
                      key={project.id} 
                      className="hover:bg-slate-50/50 transition-colors group cursor-pointer"
                      onClick={() => setSelectedProject(project)}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 font-bold text-xs">
                            {project.name.charAt(0)}
                          </div>
                          <span className="font-bold text-slate-900">{project.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          project.status === 'Active' ? 'bg-emerald-50 text-emerald-600' :
                          project.status === 'Pending' ? 'bg-amber-50 text-amber-600' :
                          'bg-slate-100 text-slate-500'
                        }`}>
                          {project.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600 font-medium">
                        {project.students.toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-sm font-bold ${
                          project.growth.startsWith('+') ? 'text-emerald-600' : 
                          project.growth.startsWith('-') ? 'text-rose-600' : 'text-slate-400'
                        }`}>
                          {project.growth}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-slate-200 overflow-hidden">
                            <img src={`https://i.pravatar.cc/24?u=${project.id}`} alt="PM" />
                          </div>
                          <span className="text-sm text-slate-600 font-medium">{project.manager}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all opacity-0 group-hover:opacity-100">
                          <MoreVertical size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-6 border-t border-slate-100 flex items-center justify-between">
              <p className="text-sm text-slate-500">Showing 5 of 24 projects</p>
              <div className="flex gap-2">
                <button className="px-4 py-2 text-sm font-bold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50">Previous</button>
                <button className="px-4 py-2 text-sm font-bold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Next</button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Project Detail Modal */}
      <AnimatePresence>
        {selectedProject && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            >
              {/* Modal Header */}
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-orange-500 flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-orange-500/20">
                    {selectedProject.name.charAt(0)}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{selectedProject.name}</h2>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        selectedProject.status === 'Active' ? 'bg-emerald-50 text-emerald-600' :
                        selectedProject.status === 'Pending' ? 'bg-amber-50 text-amber-600' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {selectedProject.status}
                      </span>
                      <span className="text-xs text-slate-400">•</span>
                      <span className="text-xs text-slate-500 font-medium">Managed by {selectedProject.manager}</span>
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedProject(null)}
                  className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Left Column: Info & Metrics */}
                  <div className="lg:col-span-2 space-y-8">
                    <div>
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Description</h3>
                      <p className="text-slate-600 leading-relaxed">
                        {selectedProject.description || "No description provided for this project."}
                      </p>
                    </div>

                    <div>
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Performance Metrics</h3>
                      <div className="h-64 w-full bg-slate-50 rounded-xl p-4 border border-slate-100">
                        {selectedProject.metrics && selectedProject.metrics.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={selectedProject.metrics}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94A3B8', fontSize: 10}} />
                              <YAxis axisLine={false} tickLine={false} tick={{fill: '#94A3B8', fontSize: 10}} />
                              <Tooltip contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'}} />
                              <Line type="monotone" dataKey="value" stroke="#F97316" strokeWidth={3} dot={{fill: '#F97316', r: 4}} activeDot={{r: 6}} />
                            </LineChart>
                          </ResponsiveContainer>
                        ) : (
                          <div className="h-full flex items-center justify-center text-slate-400 italic text-sm">
                            No metric data available
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Associated Users</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {selectedProject.associatedUsers && selectedProject.associatedUsers.length > 0 ? (
                          selectedProject.associatedUsers.map((user: any) => (
                            <div key={user.id} className="flex items-center gap-3 p-3 bg-white border border-slate-100 rounded-xl shadow-sm">
                              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-bold">
                                {user.name.charAt(0)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-slate-900 truncate">{user.name}</p>
                                <p className="text-xs text-slate-500 truncate">{user.role}</p>
                              </div>
                              <button className="p-2 text-slate-400 hover:text-orange-500 transition-colors">
                                <Mail size={16} />
                              </button>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-slate-400 italic">No users associated with this project.</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Recent Activity */}
                  <div className="space-y-6">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                      <Activity size={16} />
                      Recent Activity
                    </h3>
                    <div className="space-y-4">
                      {selectedProject.recentActivity && selectedProject.recentActivity.length > 0 ? (
                        selectedProject.recentActivity.map((activity: any) => (
                          <div key={activity.id} className="relative pl-6 pb-4 border-l-2 border-slate-100 last:pb-0">
                            <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-white border-2 border-orange-500"></div>
                            <p className="text-sm font-bold text-slate-900">{activity.type}</p>
                            <p className="text-xs text-slate-500 mt-0.5">By {activity.user} • {activity.time}</p>
                            <span className="inline-block mt-2 px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded uppercase">
                              {activity.status}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-slate-400 italic">No recent activity recorded.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
                <button 
                  onClick={() => setSelectedProject(null)}
                  className="px-6 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  Close
                </button>
                <button className="px-6 py-2 text-sm font-bold text-white bg-orange-500 hover:bg-orange-600 rounded-xl shadow-lg shadow-orange-500/20 transition-all">
                  Manage Project
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminPanel;
