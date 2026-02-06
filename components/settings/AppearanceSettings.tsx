import React from 'react';
import { ArrowLeft, Moon, Sun, Type, Palette, RotateCcw, Smartphone } from 'lucide-react';
import { ThemeClasses, AppSettings } from './types';

interface AppearanceSettingsProps {
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  theme: ThemeClasses;
  onBack: () => void;
}

const AppearanceSettings: React.FC<AppearanceSettingsProps> = ({
  isDarkMode,
  onToggleDarkMode,
  settings,
  setSettings,
  theme,
  onBack
}) => {
  const { containerClass, animationClass, cardClass, headingClass, pressedClass, btnClass, inputClass, isDarkMode: mode } = theme;

  const renderToggle = (isActive: boolean, onToggle: () => void) => (
    <button 
      onClick={onToggle}
      className={`w-14 h-8 rounded-full p-1 flex items-center transition-all ${pressedClass}`}
    >
      <div className={`w-6 h-6 rounded-full shadow-sm flex items-center justify-center transition-all transform duration-300 ${isActive ? 'translate-x-6 bg-rose-400' : 'translate-x-0 bg-slate-400'}`}>
      </div>
    </button>
  );

  const renderHeader = (title: string, onBackAction?: () => void) => (
    <header className="mb-6 pt-2 flex items-center gap-4">
      {onBackAction && (
        <button onClick={onBackAction} className={`w-10 h-10 rounded-full flex items-center justify-center hover:text-rose-400 transition-colors active:scale-95 ${btnClass}`}>
          <ArrowLeft size={20} />
        </button>
      )}
      <h1 className={`text-2xl font-bold ${headingClass}`}>{title}</h1>
    </header>
  );

  const resetTheme = () => {
    setSettings(prev => ({ ...prev, themeColor: '#e28a9d' })); // Default Rose-400
  };

  return (
    <div className={`flex-1 flex flex-col p-6 pb-28 overflow-y-auto no-scrollbar relative ${containerClass} ${animationClass}`}>
      {renderHeader("外观偏好", onBack)}
      
      <div className={`${cardClass} p-4 flex flex-col gap-6 rounded-2xl`}>
         {/* Dark Mode */}
         <div className="flex items-center justify-between">
           <div className="flex items-center gap-3">
             <div className={`w-12 h-12 rounded-full flex items-center justify-center text-rose-400 ${pressedClass}`}>
               {isDarkMode ? <Moon size={22} /> : <Sun size={22} />}
             </div>
             <span className={`font-bold ${headingClass}`}>深色模式</span>
           </div>
           
           {renderToggle(isDarkMode, onToggleDarkMode)}
         </div>

         <div className="w-full h-[1px] bg-slate-300/20" />

         {/* Theme Color Picker */}
         <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-rose-400 ${pressedClass}`}>
                        <Palette size={22} />
                    </div>
                    <div>
                        <div className={`font-bold ${headingClass}`}>主题色</div>
                        <div className="text-xs text-slate-500">自定义应用强调色</div>
                    </div>
                </div>
                <button 
                    onClick={resetTheme}
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-rose-400 ${btnClass}`}
                    title="重置为默认"
                >
                    <RotateCcw size={14} />
                </button>
            </div>
            
            <div className="flex items-center gap-4 px-2 h-12">
                {/* Color Swatch - Removed pressedClass to remove gray bar, added overflow-hidden and matching height */}
                <div className="flex-1 h-full rounded-xl relative overflow-hidden shadow-inner bg-transparent">
                   <input 
                      type="color" 
                      value={settings.themeColor}
                      onChange={(e) => setSettings(prev => ({ ...prev, themeColor: e.target.value }))}
                      className="absolute -top-[50%] -left-[50%] w-[200%] h-[200%] cursor-pointer border-none p-0"
                   />
                </div>
                {/* Text input - standardizes height */}
                <div className={`px-4 flex items-center h-full rounded-xl font-mono text-xs uppercase min-w-[100px] justify-center ${inputClass}`}>
                    {settings.themeColor}
                </div>
            </div>
         </div>

         <div className="w-full h-[1px] bg-slate-300/20" />

         {/* Font Size Slider */}
         <div className="flex flex-col gap-4">
           <div className="flex items-center gap-3">
             <div className={`w-12 h-12 rounded-full flex items-center justify-center text-slate-500 ${pressedClass}`}>
               <Type size={22} />
             </div>
             <div className="flex-1">
                 <div className="flex justify-between items-center">
                    <span className={`font-bold ${headingClass}`}>字体大小</span>
                    {/* Display approximate percent relative to base */}
                    <span className="text-xs text-rose-400 font-bold">{Math.round(settings.fontSizeScale * 100)}%</span>
                 </div>
             </div>
           </div>

           <div className="px-2">
                <div className="relative h-2 w-full mt-2 mb-2">
                    <input 
                        type="range" 
                        min="80" 
                        max="120" 
                        step="5"
                        value={settings.fontSizeScale * 100} 
                        onChange={(e) => setSettings(prev => ({ ...prev, fontSizeScale: parseInt(e.target.value) / 100 }))}
                        className="w-full h-2 bg-transparent appearance-none cursor-pointer z-10 relative"
                    />
                    <div className={`absolute top-0 left-0 h-full rounded-lg w-full ${mode ? 'bg-slate-700' : 'bg-black/5'}`} />
                    <div 
                        className="absolute top-0 left-0 h-full bg-rose-300 rounded-lg pointer-events-none" 
                        style={{width: `${(settings.fontSizeScale * 100 - 80) / (120 - 80) * 100}%`}} 
                    />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 px-1">
                    <span>小</span>
                    <span>标准</span>
                    <span>大</span>
                </div>
           </div>
         </div>

         <div className="w-full h-[1px] bg-slate-300/20" />

         {/* Safe Area (Top/Bottom Spacing) */}
         <div className="flex flex-col gap-4 pb-2">
           <div className="flex items-center gap-3">
             <div className={`w-12 h-12 rounded-full flex items-center justify-center text-slate-500 ${pressedClass}`}>
               <Smartphone size={22} />
             </div>
             <div>
                <div className={`font-bold ${headingClass}`}>屏幕适配</div>
                <div className="text-xs text-slate-500">调整顶部刘海与底部横条区域</div>
             </div>
           </div>

           {/* Top Slider */}
           <div className="px-2 mt-2">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>顶部留白 (Top)</span>
                    <span>{settings.safeAreaTop || 0}px</span>
                </div>
                <div className="relative h-2 w-full mb-4">
                    <input 
                        type="range" 
                        min="0" 
                        max="100" 
                        step="1"
                        value={settings.safeAreaTop || 0}
                        onChange={(e) => setSettings(prev => ({ ...prev, safeAreaTop: parseInt(e.target.value) }))}
                        className="w-full h-2 bg-transparent appearance-none cursor-pointer z-10 relative"
                    />
                    <div className={`absolute top-0 left-0 h-full rounded-lg w-full ${mode ? 'bg-slate-700' : 'bg-black/5'}`} />
                    <div 
                        className="absolute top-0 left-0 h-full bg-rose-300 rounded-lg pointer-events-none" 
                        style={{width: `${(settings.safeAreaTop || 0) / 100 * 100}%`}} 
                    />
                </div>
           </div>

           {/* Bottom Slider */}
           <div className="px-2">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>底部留白 (Bottom)</span>
                    <span>{settings.safeAreaBottom || 0}px</span>
                </div>
                <div className="relative h-2 w-full">
                    <input 
                        type="range" 
                        min="0" 
                        max="100" 
                        step="1"
                        value={settings.safeAreaBottom || 0}
                        onChange={(e) => setSettings(prev => ({ ...prev, safeAreaBottom: parseInt(e.target.value) }))}
                        className="w-full h-2 bg-transparent appearance-none cursor-pointer z-10 relative"
                    />
                    <div className={`absolute top-0 left-0 h-full rounded-lg w-full ${mode ? 'bg-slate-700' : 'bg-black/5'}`} />
                    <div 
                        className="absolute top-0 left-0 h-full bg-rose-300 rounded-lg pointer-events-none" 
                        style={{width: `${(settings.safeAreaBottom || 0) / 100 * 100}%`}} 
                    />
                </div>
           </div>
         </div>

      </div>
    </div>
  );
};

export default AppearanceSettings;