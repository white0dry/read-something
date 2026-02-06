import React from 'react';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Flame, Clock, BookOpen, Calendar } from 'lucide-react';

interface StatsProps {
  isDarkMode?: boolean;
}

const data = [
  { name: '周一', hours: 1.2 },
  { name: '周二', hours: 2.5 },
  { name: '周三', hours: 0.8 },
  { name: '周四', hours: 3.1 },
  { name: '周五', hours: 1.5 },
  { name: '周六', hours: 4.2 },
  { name: '周日', hours: 2.0 },
];

const Stats: React.FC<StatsProps> = ({ isDarkMode }) => {
  const containerClass = isDarkMode ? 'bg-[#2d3748] text-slate-200' : 'neu-bg text-slate-600';
  const cardClass = isDarkMode ? 'bg-[#2d3748] shadow-[6px_6px_12px_#232b39,-6px_-6px_12px_#374357]' : 'neu-flat';
  const pressedClass = isDarkMode ? 'bg-[#2d3748] shadow-[inset_3px_3px_6px_#232b39,inset_-3px_-3px_6px_#374357]' : 'neu-pressed';
  const headingClass = isDarkMode ? 'text-slate-200' : 'text-slate-700';

  return (
    <div className={`flex-1 flex flex-col p-6 pb-28 overflow-y-auto no-scrollbar animate-slide-in-right ${containerClass}`}>
      <header className="mb-6 pt-2">
        <h1 className={`text-2xl font-bold ${headingClass}`}>阅读统计</h1>
      </header>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-5 mb-8">
        <div className={`${cardClass} p-4 flex flex-col justify-between h-28 rounded-2xl`}>
           <div className="flex items-center gap-2 text-rose-400">
             <Flame size={20} />
             <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">连续打卡</span>
           </div>
           <div className={`text-2xl font-black ${headingClass}`}>12 <span className="text-sm font-normal text-slate-400">天</span></div>
        </div>
        <div className={`${cardClass} p-4 flex flex-col justify-between h-28 rounded-2xl`}>
           <div className="flex items-center gap-2 text-blue-400">
             <Clock size={20} />
             <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">总时长</span>
           </div>
           <div className={`text-2xl font-black ${headingClass}`}>48.5 <span className="text-sm font-normal text-slate-400">h</span></div>
        </div>
        <div className={`${cardClass} p-4 flex flex-col justify-between h-28 rounded-2xl`}>
           <div className="flex items-center gap-2 text-emerald-400">
             <BookOpen size={20} />
             <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">已读完</span>
           </div>
           <div className={`text-2xl font-black ${headingClass}`}>3 <span className="text-sm font-normal text-slate-400">本</span></div>
        </div>
        <div className={`${cardClass} p-4 flex flex-col justify-between h-28 rounded-2xl`}>
           <div className="flex items-center gap-2 text-violet-400">
             <Calendar size={20} />
             <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">目标</span>
           </div>
           <div className={`w-full h-3 rounded-full overflow-hidden p-[3px] mt-2 ${pressedClass}`}>
              <div className="h-full bg-violet-400 rounded-full w-[15%]" />
           </div>
        </div>
      </div>

      {/* Chart */}
      <div className={`${cardClass} p-6 mb-8 rounded-2xl`}>
        <h3 className={`text-sm font-bold mb-6 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>本周阅读时长 (小时)</h3>
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                tick={{fontSize: 10, fill: '#94a3b8'}}
                dy={10}
              />
              <Tooltip 
                cursor={{fill: 'transparent'}}
                contentStyle={{
                    borderRadius: '12px', 
                    background: isDarkMode ? '#2d3748' : '#e0e5ec', 
                    border: 'none', 
                    boxShadow: isDarkMode ? '6px 6px 12px #232b39, -6px -6px 12px #374357' : '6px 6px 12px #a3b1c6, -6px -6px 12px #ffffff', 
                    color: isDarkMode ? '#e2e8f0' : '#4b5563'
                }}
              />
              <Bar dataKey="hours" radius={[6, 6, 6, 6]}>
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.hours > 3 ? '#fb7185' : isDarkMode ? '#4a5568' : '#cbd5e1'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Calendar Heatmap Simulation */}
      <div className={`${cardClass} p-6 rounded-2xl`}>
         <h3 className={`text-sm font-bold mb-4 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>打卡日历</h3>
         <div className="grid grid-cols-7 gap-3">
            {[...Array(28)].map((_, i) => {
              const active = Math.random() > 0.4;
              const intensity = Math.random();
              // Logic for active cells remains the same, inactive changes based on mode
              let bg = pressedClass;
              let extra = '';
              
              if (active) {
                if (intensity > 0.8) { bg = cardClass; extra = 'bg-rose-400 shadow-none'; }
                else if (intensity > 0.5) { bg = cardClass; extra = 'bg-rose-300 shadow-none'; }
                else { bg = cardClass; extra = 'bg-rose-200 shadow-none'; }
              }
              
              return (
                <div key={i} className={`aspect-square rounded-lg ${bg} ${extra}`} />
              )
            })}
         </div>
      </div>
    </div>
  );
};

export default Stats;