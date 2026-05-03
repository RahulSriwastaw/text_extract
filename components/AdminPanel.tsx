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
    <div className="flex h-screen bg-[#111111] font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-navy-900 text-white flex flex-col">
        <div className="p-3 flex items-center gap-3">
          <div className="w-8 h-8 bg-[#FF6B2B] rounded-[8px] flex items-center justify-center">
            <GraduationCap className="text-white w-5 h-5" />
          </div>
          <span className="font-bold text-[18px] tracking-tight">EduSaaS</span>
        </div>

        <nav className="flex-1 px-3 space-y-1 mt-4">
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
              className={`w-full flex items-center gap-3 px-3 h-10 transition-all duration-200 ${
                activeTab === item.name 
                  ? 'border-l-[3px] border-[#FF6B2B] bg-[#1A1A1A] text-[#EFEFEF]' 
                  : 'text-[#888888] hover:text-[#EFEFEF] hover:bg-[#1A1A1A]'
              }`}
            >
              <item.icon size={18} className={activeTab === item.name ? 'text-[#FF6B2B]' : ''} />
              <span className="text-[13px] font-normal">{item.name}</span>
            </button>
          ))}
        </nav>

        <div className="p-3 mt-auto">
          <div className="bg-[#1A1A1A]/5 rounded-[8px] p-3 border border-white/10">
            <p className="text-[11px] text-[#555555] mb-2 uppercase tracking-wider font-semibold">Storage Usage</p>
            <div className="w-full bg-[#1A1A1A]/10 rounded-[20px] h-1.5 mb-2">
              <div className="bg-[#FF6B2B] h-1.5 rounded-[20px] w-3/4"></div>
            </div>
            <p className="text-[11px] text-[#555555]">75% of 100GB used</p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-20 bg-[#1A1A1A] border-bottom border-[#252525] flex items-center justify-between px-3 z-10">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555555]" size={18} />
              <input 
                type="text" 
                placeholder="Search projects, users, or reports..." 
                className="w-full pl-10 pr-4 py-2.5 bg-[#111111] border border-[#252525] rounded-[8px] focus:outline-none focus:border-[#FF6B2B] focus:ring-2 focus:ring-[#FF6B2B]/20 focus:border-[#FF6B2B] transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button className="relative p-2 text-[#555555] hover:bg-[#111111] rounded-[8px] transition-colors">
              <Bell size={20} />
              <span className="absolute top-2 right-2 w-2 h-2 bg-[#FF6B2B] rounded-[20px] border-2 border-white"></span>
            </button>
            <div className="h-8 w-px bg-[#2A2A2A]"></div>
            <div className="flex items-center gap-3 cursor-pointer group">
              <div className="text-right">
                <p className="text-[13px] font-bold text-[#EFEFEF]">Alex Rivera</p>
                <p className="text-[11px] text-[#555555]">Super Admin</p>
              </div>
              <div className="w-10 h-10 bg-[#2A2A2A] rounded-[8px] overflow-hidden border-2 border-transparent group-hover:border-[#FF6B2B] transition-all">
                <img src="https://picsum.photos/seed/admin/40/40" alt="Avatar" referrerPolicy="no-referrer" />
              </div>
              <ChevronDown size={16} className="text-[#555555]" />
            </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="flex-1 overflow-y-auto p-3 space-y-8">
          {/* Page Title */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[20px] font-bold text-[#EFEFEF] tracking-tight">Enterprise Overview</h1>
              <p className="text-[#555555] mt-1">Monitor performance across all 24 active projects.</p>
            </div>
            <div className="flex gap-3">
              <button className="flex items-center gap-2 px-3 py-2.5 bg-[#1A1A1A] border border-[#252525] text-[#EFEFEF] rounded-[8px] font-medium hover:bg-[#111111] transition-all">
                <Download size={18} />
                Export Data
              </button>
              <button className="flex items-center gap-2 px-3 py-2.5 bg-[#FF6B2B] text-white rounded-[8px] font-medium hover:bg-[#FF6B2B] transition-all ">
                <Plus size={18} />
                New Project
              </button>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Total Revenue', value: '$428,500', growth: '+14.2%', up: true, icon: Briefcase },
              { label: 'Active Students', value: '12,402', growth: '+8.1%', up: true, icon: Users },
              { label: 'Course Completion', value: '84.2%', growth: '-2.4%', up: false, icon: BookOpen },
              { label: 'System Uptime', value: '99.99%', growth: 'Stable', up: true, icon: ShieldCheck },
            ].map((kpi, i) => (
              <div key={i} className="bg-[#1A1A1A] p-3 rounded-[8px] border border-[#252525]">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 bg-[#111111] rounded-[8px] text-[#EFEFEF]">
                    <kpi.icon size={20} />
                  </div>
                  <div className={`flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-[20px] ${
                    kpi.up ? 'bg-[#1A2A3A] text-[#4CAF50]' : 'bg-[#1A2A3A] text-[#F44336]'
                  }`}>
                    {kpi.up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                    {kpi.growth}
                  </div>
                </div>
                <p className="text-[13px] text-[#555555] font-medium">{kpi.label}</p>
                <h3 className="text-[20px] font-bold text-[#EFEFEF] mt-1">{kpi.value}</h3>
              </div>
            ))}
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2 bg-[#1A1A1A] p-3 rounded-[8px] border border-[#252525]">
              <div className="flex items-center justify-between mb-8">
                <h3 className="font-bold text-[#EFEFEF]">Growth Analytics</h3>
                <select className="text-[13px] bg-[#111111] border border-[#252525] rounded-[8px] px-3 py-1.5 focus:outline-none focus:border-[#FF6B2B]">
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

            <div className="bg-[#1A1A1A] p-3 rounded-[8px] border border-[#252525]">
              <h3 className="font-bold text-[#EFEFEF] mb-8">User Distribution</h3>
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
          <div className="bg-[#1A1A1A] rounded-[8px] border border-[#252525] overflow-hidden">
            <div className="p-3 border-b border-[#252525] flex items-center justify-between">
              <h3 className="font-bold text-[#EFEFEF]">Project Management</h3>
              <div className="flex gap-2">
                <button className="p-2 text-[#555555] hover:bg-[#111111] rounded-[8px] transition-colors border border-[#252525]">
                  <Filter size={18} />
                </button>
                <button className="p-2 text-[#555555] hover:bg-[#111111] rounded-[8px] transition-colors border border-[#252525]">
                  <Search size={18} />
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-[#111111]/50">
                    <th className="px-3 py-3 text-[11px] font-bold text-[#555555] uppercase tracking-wider">Project Name</th>
                    <th className="px-3 py-3 text-[11px] font-bold text-[#555555] uppercase tracking-wider">Status</th>
                    <th className="px-3 py-3 text-[11px] font-bold text-[#555555] uppercase tracking-wider">Students</th>
                    <th className="px-3 py-3 text-[11px] font-bold text-[#555555] uppercase tracking-wider">Growth</th>
                    <th className="px-3 py-3 text-[11px] font-bold text-[#555555] uppercase tracking-wider">Project Manager</th>
                    <th className="px-3 py-3 text-[11px] font-bold text-[#555555] uppercase tracking-wider"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {projects.map((project) => (
                    <tr 
                      key={project.id} 
                      className="hover:bg-[#111111]/50 transition-colors group cursor-pointer"
                      onClick={() => setSelectedProject(project)}
                    >
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-[8px] bg-[#141414] flex items-center justify-center text-[#EFEFEF] font-bold text-[11px]">
                            {project.name.charAt(0)}
                          </div>
                          <span className="font-bold text-[#EFEFEF]">{project.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-[20px] text-[11px] font-bold ${
                          project.status === 'Active' ? 'bg-[#1A2A3A] text-[#4CAF50]' :
                          project.status === 'Pending' ? 'bg-[#1A2A3A] text-[#FF6B2B]' :
                          'bg-[#141414] text-[#555555]'
                        }`}>
                          {project.status}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-[13px] text-[#EFEFEF] font-medium">
                        {project.students.toLocaleString()}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-[13px] font-bold ${
                          project.growth.startsWith('+') ? 'text-[#4CAF50]' : 
                          project.growth.startsWith('-') ? 'text-[#F44336]' : 'text-[#555555]'
                        }`}>
                          {project.growth}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-[20px] bg-[#2A2A2A] overflow-hidden">
                            <img src={`https://i.pravatar.cc/24?u=${project.id}`} alt="PM" />
                          </div>
                          <span className="text-[13px] text-[#EFEFEF] font-medium">{project.manager}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button className="p-1.5 text-[#555555] hover:text-[#EFEFEF] hover:bg-[#141414] rounded-[8px] transition-all opacity-0 group-hover:opacity-100">
                          <MoreVertical size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-3 border-t border-[#252525] flex items-center justify-between">
              <p className="text-[13px] text-[#555555]">Showing 5 of 24 projects</p>
              <div className="flex gap-2">
                <button className="px-3 py-2 text-[13px] font-bold text-[#EFEFEF] border border-[#252525] rounded-[8px] hover:bg-[#111111] disabled:opacity-50">Previous</button>
                <button className="px-3 py-2 text-[13px] font-bold text-[#EFEFEF] border border-[#252525] rounded-[8px] hover:bg-[#111111]">Next</button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Project Detail Modal */}
      <AnimatePresence>
        {selectedProject && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 bg-[#0F0F0F]/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-[#1A1A1A] w-full max-w-4xl max-h-[90vh] rounded-[8px] overflow-hidden flex flex-col"
            >
              {/* Modal Header */}
              <div className="p-3 border-b border-[#252525] flex items-center justify-between bg-[#111111]/50">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-[8px] bg-[#FF6B2B] flex items-center justify-center text-white font-bold text-[18px] ">
                    {selectedProject.name.charAt(0)}
                  </div>
                  <div>
                    <h2 className="text-[18px] font-bold text-[#EFEFEF]">{selectedProject.name}</h2>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-[20px] text-[10px] font-bold uppercase tracking-wider ${
                        selectedProject.status === 'Active' ? 'bg-[#1A2A3A] text-[#4CAF50]' :
                        selectedProject.status === 'Pending' ? 'bg-[#1A2A3A] text-[#FF6B2B]' :
                        'bg-[#141414] text-[#555555]'
                      }`}>
                        {selectedProject.status}
                      </span>
                      <span className="text-[11px] text-[#555555]">•</span>
                      <span className="text-[11px] text-[#555555] font-medium">Managed by {selectedProject.manager}</span>
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedProject(null)}
                  className="p-2 hover:bg-[#2A2A2A] rounded-[20px] transition-colors text-[#555555]"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-3">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                  {/* Left Column: Info & Metrics */}
                  <div className="lg:col-span-2 space-y-8">
                    <div>
                      <h3 className="text-[13px] font-bold text-[#555555] uppercase tracking-wider mb-3">Description</h3>
                      <p className="text-[#EFEFEF] leading-relaxed">
                        {selectedProject.description || "No description provided for this project."}
                      </p>
                    </div>

                    <div>
                      <h3 className="text-[13px] font-bold text-[#555555] uppercase tracking-wider mb-4">Performance Metrics</h3>
                      <div className="h-64 w-full bg-[#111111] rounded-[8px] p-3 border border-[#252525]">
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
                          <div className="h-full flex items-center justify-center text-[#555555] italic text-[13px]">
                            No metric data available
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <h3 className="text-[13px] font-bold text-[#555555] uppercase tracking-wider mb-4">Associated Users</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {selectedProject.associatedUsers && selectedProject.associatedUsers.length > 0 ? (
                          selectedProject.associatedUsers.map((user: any) => (
                            <div key={user.id} className="flex items-center gap-3 p-3 bg-[#1A1A1A] border border-[#252525] rounded-[8px] ">
                              <div className="w-10 h-10 rounded-[20px] bg-[#141414] flex items-center justify-center text-[#EFEFEF] font-bold">
                                {user.name.charAt(0)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-bold text-[#EFEFEF] truncate">{user.name}</p>
                                <p className="text-[11px] text-[#555555] truncate">{user.role}</p>
                              </div>
                              <button className="p-2 text-[#555555] hover:text-[#FF6B2B] transition-colors">
                                <Mail size={16} />
                              </button>
                            </div>
                          ))
                        ) : (
                          <p className="text-[13px] text-[#555555] italic">No users associated with this project.</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Recent Activity */}
                  <div className="space-y-6">
                    <h3 className="text-[13px] font-bold text-[#555555] uppercase tracking-wider flex items-center gap-2">
                      <Activity size={16} />
                      Recent Activity
                    </h3>
                    <div className="space-y-4">
                      {selectedProject.recentActivity && selectedProject.recentActivity.length > 0 ? (
                        selectedProject.recentActivity.map((activity: any) => (
                          <div key={activity.id} className="relative pl-6 pb-4 border-l-2 border-[#252525] last:pb-0">
                            <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-[20px] bg-[#1A1A1A] border-2 border-[#FF6B2B]"></div>
                            <p className="text-[13px] font-bold text-[#EFEFEF]">{activity.type}</p>
                            <p className="text-[11px] text-[#555555] mt-0.5">By {activity.user} • {activity.time}</p>
                            <span className="inline-block mt-2 px-2 py-0.5 bg-[#141414] text-[#EFEFEF] text-[10px] font-bold rounded uppercase">
                              {activity.status}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="text-[13px] text-[#555555] italic">No recent activity recorded.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-3 border-t border-[#252525] bg-[#111111]/50 flex justify-end gap-3">
                <button 
                  onClick={() => setSelectedProject(null)}
                  className="px-3 py-2 text-[13px] font-bold text-[#EFEFEF] hover:bg-[#2A2A2A] rounded-[8px] transition-colors"
                >
                  Close
                </button>
                <button className="px-3 py-2 text-[13px] font-bold text-white bg-[#FF6B2B] hover:bg-[#FF6B2B] rounded-[8px]  transition-all">
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
