import React, { useState, useRef, useEffect } from 'react';
import { 
  Settings as SettingsIcon, 
  Book, 
  ChevronRight, 
  Key, 
  HardDrive, 
  UserCircle,
  ArrowLeft,
  Download,
  Upload,
  Palette,
  X,
  ImageIcon,
  Link as LinkIcon
} from 'lucide-react';
import { SettingsView, Persona, Character, WorldBookEntry, ThemeClasses, ApiConfig, ApiPreset, AppSettings } from './settings/types';
import PersonaSettings from './settings/PersonaSettings';
import CharacterSettings from './settings/CharacterSettings';
import WorldBookSettings from './settings/WorldBookSettings';
import AppearanceSettings from './settings/AppearanceSettings';
import ApiSettings from './settings/ApiSettings';
import ModalPortal from './ModalPortal';

interface SettingsProps {
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  
  // Lifted States
  apiConfig: ApiConfig;
  setApiConfig: React.Dispatch<React.SetStateAction<ApiConfig>>;
  apiPresets: ApiPreset[];
  setApiPresets: React.Dispatch<React.SetStateAction<ApiPreset[]>>;
  
  appSettings: AppSettings;
  setAppSettings: React.Dispatch<React.SetStateAction<AppSettings>>;

  personas: Persona[];
  setPersonas: React.Dispatch<React.SetStateAction<Persona[]>>;
  characters: Character[];
  setCharacters: React.Dispatch<React.SetStateAction<Character[]>>;
  worldBookEntries: WorldBookEntry[];
  setWorldBookEntries: React.Dispatch<React.SetStateAction<WorldBookEntry[]>>;
  wbCategories: string[];
  setWbCategories: React.Dispatch<React.SetStateAction<string[]>>;
}

// Custom Feather Icon provided by user
const FeatherIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" className={`bi bi-feather ${className}`} viewBox="0 0 16 16">
    <path d="M15.807.531c-.174-.177-.41-.289-.64-.363a3.8 3.8 0 0 0-.833-.15c-.62-.049-1.394 0-2.252.175C10.365.545 8.264 1.415 6.315 3.1S3.147 6.824 2.557 8.523c-.294.847-.44 1.634-.429 2.268.005.316.05.62.154.88q.025.061.056.122A68 68 0 0 0 .08 15.198a.53.53 0 0 0 .157.72.504.504 0 0 0 .705-.16 68 68 0 0 1 2.158-3.26c.285.141.616.195.958.182.513-.02 1.098-.188 1.723-.49 1.25-.605 2.744-1.787 4.303-3.642l1.518-1.55a.53.53 0 0 0 0-.739l-.729-.744 1.311.209a.5.5 0 0 0 .443-.15l.663-.684c.663-.68 1.292-1.325 1.763-1.892.314-.378.585-.752.754-1.107.163-.345.278-.773.112-1.188a.5.5 0 0 0-.112-.172M3.733 11.62C5.385 9.374 7.24 7.215 9.309 5.394l1.21 1.234-1.171 1.196-.027.03c-1.5 1.789-2.891 2.867-3.977 3.393-.544.263-.99.378-1.324.39a1.3 1.3 0 0 1-.287-.018Zm6.769-7.22c1.31-1.028 2.7-1.914 4.172-2.6a7 7 0 0 1-.4.523c-.442.533-1.028 1.134-1.681 1.804l-.51.524zm3.346-3.357C9.594 3.147 6.045 6.8 3.149 10.678c.007-.464.121-1.086.37-1.806.533-1.535 1.65-3.415 3.455-4.976 1.807-1.561 3.746-2.36 5.31-2.68a8 8 0 0 1 1.564-.173"/>
  </svg>
);

const Settings: React.FC<SettingsProps> = ({ 
  isDarkMode, 
  onToggleDarkMode,
  apiConfig,
  setApiConfig,
  apiPresets,
  setApiPresets,
  appSettings,
  setAppSettings,
  personas,
  setPersonas,
  characters,
  setCharacters,
  worldBookEntries,
  setWorldBookEntries,
  wbCategories,
  setWbCategories
}) => {
  const SETTINGS_VIEW_TRANSITION_MS = 260;
  const [currentView, setCurrentView] = useState<SettingsView>('MAIN');
  const [transitionAnimationClass, setTransitionAnimationClass] = useState('app-view-enter-left');
  const [isSwitchingView, setIsSwitchingView] = useState(false);
  
  // Avatar Selection Modal State
  const [avatarModal, setAvatarModal] = useState<{
    isOpen: boolean;
    targetId: string | null;
    targetType: 'PERSONA' | 'CHARACTER';
  }>({ isOpen: false, targetId: null, targetType: 'PERSONA' });
  const [urlInputMode, setUrlInputMode] = useState(false);
  const [tempUrl, setTempUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewTransitionTimerRef = useRef<number | null>(null);
  const viewTransitionUnlockTimerRef = useRef<number | null>(null);

  // Theme Classes
  const theme: ThemeClasses = {
    containerClass: isDarkMode ? 'bg-[#2d3748] text-slate-200' : 'neu-bg text-slate-600',
    headingClass: isDarkMode ? 'text-slate-200' : 'text-slate-700',
    cardClass: isDarkMode ? 'bg-[#2d3748] shadow-[6px_6px_12px_#232b39,-6px_-6px_12px_#374357]' : 'neu-flat',
    pressedClass: isDarkMode ? 'bg-[#2d3748] shadow-[inset_3px_3px_6px_#232b39,inset_-3px_-3px_6px_#374357]' : 'neu-pressed',
    inputClass: isDarkMode ? 'bg-[#2d3748] shadow-[inset_3px_3px_6px_#232b39,inset_-3px_-3px_6px_#374357] text-slate-200 placeholder-slate-500' : 'neu-pressed text-slate-600 placeholder-slate-400',
    btnClass: isDarkMode ? 'bg-[#2d3748] shadow-[5px_5px_10px_#232b39,-5px_-5px_10px_#374357] text-slate-200' : 'neu-btn',
    activeBorderClass: 'border-2 border-rose-300 relative z-20',
    baseBorderClass: 'border-2 border-transparent relative z-0',
    animationClass: transitionAnimationClass,
    isDarkMode
  };

  const { containerClass, animationClass, cardClass, headingClass, pressedClass, inputClass, btnClass } = theme;

  // --- Helpers ---
  useEffect(() => {
    return () => {
      if (viewTransitionTimerRef.current) window.clearTimeout(viewTransitionTimerRef.current);
      if (viewTransitionUnlockTimerRef.current) window.clearTimeout(viewTransitionUnlockTimerRef.current);
    };
  }, []);

  const switchView = (view: SettingsView) => {
    if (isSwitchingView || view === currentView) return;

    setIsSwitchingView(true);
    setTransitionAnimationClass('app-view-exit-right');

    if (viewTransitionTimerRef.current) window.clearTimeout(viewTransitionTimerRef.current);
    if (viewTransitionUnlockTimerRef.current) window.clearTimeout(viewTransitionUnlockTimerRef.current);

    viewTransitionTimerRef.current = window.setTimeout(() => {
      setCurrentView(view);
      setTransitionAnimationClass('app-view-enter-left');
      viewTransitionUnlockTimerRef.current = window.setTimeout(() => {
        setIsSwitchingView(false);
      }, SETTINGS_VIEW_TRANSITION_MS);
    }, SETTINGS_VIEW_TRANSITION_MS);
  };

  const navigateTo = (view: SettingsView) => {
    switchView(view);
  };

  const goBack = (toView: SettingsView = 'MAIN') => {
    switchView(toView);
  };
  
  const renderHeader = (title: string, onBack?: () => void) => (
    <header className="mb-6 pt-2 flex items-center gap-4">
      {onBack && (
        <button onClick={onBack} className={`w-10 h-10 rounded-full flex items-center justify-center hover:text-rose-400 transition-colors active:scale-95 ${btnClass}`}>
          <ArrowLeft size={20} />
        </button>
      )}
      <h1 className={`text-2xl font-bold ${headingClass}`}>{title}</h1>
    </header>
  );

  const renderToggle = (isActive: boolean, onToggle: () => void) => (
      <button 
        onClick={onToggle}
        className={`w-14 h-8 rounded-full p-1 flex items-center transition-all ${pressedClass}`}
      >
        <div className={`w-6 h-6 rounded-full shadow-sm flex items-center justify-center transition-all transform duration-300 ${isActive ? 'translate-x-6 bg-rose-400' : 'translate-x-0 bg-slate-400'}`}>
        </div>
      </button>
  );

  const updateSetting = (field: keyof AppSettings, value: any) => {
    setAppSettings(prev => ({ ...prev, [field]: value }));
  };

  // --- Avatar Handlers ---
  const openAvatarModal = (id: string, type: 'PERSONA' | 'CHARACTER') => {
    setAvatarModal({ isOpen: true, targetId: id, targetType: type });
    setUrlInputMode(false);
    setTempUrl('');
  };

  const closeAvatarModal = () => {
    setAvatarModal({ ...avatarModal, isOpen: false });
  };

  const updateAvatar = (imageUrl: string) => {
    if (!avatarModal.targetId) return;

    if (avatarModal.targetType === 'PERSONA') {
      setPersonas(prev => prev.map(p => p.id === avatarModal.targetId ? { ...p, avatar: imageUrl } : p));
    } else {
      setCharacters(prev => prev.map(c => c.id === avatarModal.targetId ? { ...c, avatar: imageUrl } : c));
    }
    closeAvatarModal();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        updateAvatar(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const renderAvatarModal = () => {
    if (!avatarModal.isOpen) return null;
    return (
      <ModalPortal>
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-500/20 backdrop-blur-sm animate-fade-in">
        <div className={`${isDarkMode ? 'bg-[#2d3748] border-slate-600' : 'neu-bg border-white/50'} w-full max-w-sm rounded-2xl p-6 shadow-2xl border relative`}>
          <button onClick={closeAvatarModal} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
          
          <h3 className={`text-lg font-bold mb-6 text-center ${headingClass}`}>更换头像</h3>

          {!urlInputMode ? (
            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className={`${cardClass} aspect-square flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-rose-400 active:scale-95 transition-all rounded-2xl`}
              >
                <ImageIcon size={32} />
                <span className="text-sm font-medium">本地上传</span>
              </button>
              <button 
                onClick={() => setUrlInputMode(true)}
                className={`${cardClass} aspect-square flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-rose-400 active:scale-95 transition-all rounded-2xl`}
              >
                <LinkIcon size={32} />
                <span className="text-sm font-medium">网络链接</span>
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="image/*"
                onChange={handleFileSelect}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4 app-view-enter-left">
              <input 
                type="text" 
                value={tempUrl}
                onChange={(e) => setTempUrl(e.target.value)}
                placeholder="https://example.com/image.png"
                className={`w-full p-4 rounded-xl text-sm outline-none ${inputClass}`}
              />
              <div className="flex gap-3 mt-2">
                <button onClick={() => setUrlInputMode(false)} className={`flex-1 py-3 rounded-full text-slate-500 text-sm font-bold ${btnClass}`}>
                  返回
                </button>
                <button 
                  onClick={() => updateAvatar(tempUrl)}
                  disabled={!tempUrl.trim()}
                  className={`flex-1 py-3 rounded-full text-rose-400 text-sm font-bold disabled:opacity-50 ${btnClass}`}
                >
                  确认
                </button>
              </div>
            </div>
          )}
        </div>
        </div>
      </ModalPortal>
    );
  };

  // --- Render Sub-Menus ---
  
  if (currentView === 'PERSONA') {
    return (
      <>
        <PersonaSettings 
          personas={personas} 
          setPersonas={setPersonas} 
          characters={characters} 
          theme={theme} 
          onBack={() => goBack()} 
          onOpenAvatarModal={openAvatarModal}
        />
        {renderAvatarModal()}
      </>
    );
  }

  if (currentView === 'CHARACTER') {
    return (
      <>
        <CharacterSettings 
          characters={characters}
          setCharacters={setCharacters}
          personas={personas}
          wbCategories={wbCategories}
          theme={theme}
          onBack={() => goBack()}
          onOpenAvatarModal={openAvatarModal}
        />
        {renderAvatarModal()}
      </>
    );
  }

  if (currentView === 'WORLDBOOK') {
    return (
      <WorldBookSettings 
        wbCategories={wbCategories}
        setWbCategories={setWbCategories}
        worldBookEntries={worldBookEntries}
        setWorldBookEntries={setWorldBookEntries}
        theme={theme}
        onBack={() => goBack()}
      />
    );
  }

  if (currentView === 'API') {
    return (
      <ApiSettings 
        config={apiConfig}
        setConfig={setApiConfig}
        presets={apiPresets}
        setPresets={setApiPresets}
        theme={theme}
        onBack={() => goBack()}
      />
    );
  }

  if (currentView === 'APPEARANCE') {
    return (
      <AppearanceSettings 
        isDarkMode={isDarkMode}
        onToggleDarkMode={onToggleDarkMode}
        settings={appSettings}
        setSettings={setAppSettings}
        theme={theme}
        onBack={() => goBack()}
      />
    );
  }

  if (currentView !== 'MAIN') {
     return (
        <div key={currentView} className={`flex-1 flex flex-col p-6 pb-28 overflow-y-auto no-scrollbar relative ${containerClass} ${animationClass}`}>
          {renderHeader("设置详情", () => goBack())}
          <div className={`${cardClass} p-8 text-center text-slate-400 rounded-2xl`}>
            <p>功能开发中...</p>
          </div>
        </div>
     );
  }

  // --- Main Settings View ---
  return (
    <div key="MAIN" className={`flex-1 flex flex-col p-6 pb-28 overflow-y-auto no-scrollbar relative ${containerClass} ${animationClass}`}>
      {renderHeader("设置")}

      {/* AI Companion Settings (Peidu) */}
      <section className="mb-8">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 px-1">陪读</h2>
        <div className={`${cardClass} p-2 flex flex-col gap-2 rounded-2xl`}>
           {/* User Persona */}
           <div 
             onClick={() => navigateTo('PERSONA')}
             className="p-3 rounded-xl flex items-center justify-between cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.98] transition-all"
           >
             <div className="flex items-center gap-4">
               <div className={`w-12 h-12 rounded-full flex items-center justify-center text-rose-400 ${pressedClass}`}>
                 <UserCircle size={22} />
               </div>
               <div>
                 <div className={`font-bold ${headingClass}`}>管理用户人设</div>
                 <div className="text-xs text-slate-500">已设置 {personas.length} 个</div>
               </div>
             </div>
             <div className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 ${isDarkMode ? cardClass : 'neu-flat'}`}>
                <ChevronRight size={16} />
             </div>
          </div>

          <div className="w-full h-[1px] bg-slate-300/20 mx-2" />

          {/* AI Character */}
          <div 
             onClick={() => navigateTo('CHARACTER')}
             className="p-3 rounded-xl flex items-center justify-between cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.98] transition-all"
          >
             <div className="flex items-center gap-4">
               <div className={`w-12 h-12 rounded-full flex items-center justify-center text-rose-400 ${pressedClass}`}>
                 <FeatherIcon size={22} />
               </div>
               <div>
                 <div className={`font-bold ${headingClass}`}>管理角色</div>
                 <div className="text-xs text-slate-500">已设置 {characters.length} 个</div>
               </div>
             </div>
             <div className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 ${isDarkMode ? cardClass : 'neu-flat'}`}>
                <ChevronRight size={16} />
             </div>
          </div>
          
          <div className="w-full h-[1px] bg-slate-300/20 mx-2" />

          {/* World Book */}
          <div 
             onClick={() => navigateTo('WORLDBOOK')}
             className="p-3 rounded-xl flex items-center justify-between cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.98] transition-all"
          >
             <div className="flex items-center gap-4">
               <div className={`w-12 h-12 rounded-full flex items-center justify-center text-rose-400 ${pressedClass}`}>
                 <Book size={22} />
               </div>
               <div>
                 <div className={`font-bold ${headingClass}`}>世界书</div>
                 <div className="text-xs text-slate-500">已收录 {worldBookEntries.length} 条设定</div>
               </div>
             </div>
             <div className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 ${isDarkMode ? cardClass : 'neu-flat'}`}>
                <ChevronRight size={16} />
             </div>
          </div>

          <div className="w-full h-[1px] bg-slate-300/20 mx-2" />

          {/* Auto Parse Toggle */}
          <div className="p-3 flex items-center justify-between">
             <span className={`text-sm font-bold ml-2 ${headingClass}`}>主动解析高亮内容</span>
             {renderToggle(appSettings.autoParseEnabled, () => updateSetting('autoParseEnabled', !appSettings.autoParseEnabled))}
          </div>

          <div className="w-full h-[1px] bg-slate-300/20 mx-2" />

          {/* Active Comments Toggle & Config */}
          <div className="p-3">
             <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                   <span className={`text-sm font-bold ml-2 ${headingClass}`}>主动发送消息</span>
                </div>
                {renderToggle(appSettings.activeCommentsEnabled, () => updateSetting('activeCommentsEnabled', !appSettings.activeCommentsEnabled))}
             </div>
             
             {/* Active Comment Settings Expansion */}
             <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${appSettings.activeCommentsEnabled ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                <div className="overflow-hidden">
                   <div className="mt-4 pl-4 pr-2 space-y-5 pb-6">
                      <div className="flex items-center gap-4">
                        <div className="flex-1">
                          <div className="flex justify-between text-xs text-slate-500 mb-2 font-medium">
                            <span>检测间隔 (秒)</span>
                          </div>
                          <div className="relative h-2 w-full">
                            <input 
                              type="range" 
                              min="10" 
                              max="600" 
                              value={appSettings.commentInterval} 
                              onChange={(e) => updateSetting('commentInterval', parseInt(e.target.value))}
                              className="app-range absolute top-1/2 -translate-y-1/2 left-0 w-full h-5 bg-transparent appearance-none cursor-pointer z-10"
                            />
                            <div className={`absolute top-0 left-0 h-full rounded-lg w-full ${isDarkMode ? 'bg-slate-700' : 'bg-black/5'}`} />
                            <div className="absolute top-0 left-0 h-full bg-rose-300 rounded-lg pointer-events-none" style={{width: `${(appSettings.commentInterval - 10) / (600 - 10) * 100}%`}} />
                          </div>
                        </div>
                        <input 
                          type="number" 
                          value={appSettings.commentInterval}
                          onChange={(e) => {
                            const val = Math.min(600, Math.max(10, parseInt(e.target.value) || 0));
                            updateSetting('commentInterval', val);
                          }}
                          className={`w-16 h-8 text-center text-xs rounded-lg outline-none ${inputClass} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`} 
                        />
                      </div>
                      
                      <div className="flex items-center gap-4">
                        <div className="flex-1">
                          <div className="flex justify-between text-xs text-slate-500 mb-2 font-medium">
                            <span>触发概率 (%)</span>
                          </div>
                          <div className="relative h-2 w-full">
                            <input 
                              type="range" 
                              min="0" 
                              max="100" 
                              value={appSettings.commentProbability} 
                              onChange={(e) => updateSetting('commentProbability', parseInt(e.target.value))}
                              className="app-range absolute top-1/2 -translate-y-1/2 left-0 w-full h-5 bg-transparent appearance-none cursor-pointer z-10"
                            />
                            <div className={`absolute top-0 left-0 h-full rounded-lg w-full ${isDarkMode ? 'bg-slate-700' : 'bg-black/5'}`} />
                            <div className="absolute top-0 left-0 h-full bg-rose-300 rounded-lg pointer-events-none" style={{width: `${appSettings.commentProbability}%`}} />
                          </div>
                        </div>
                        <input 
                          type="number" 
                          value={appSettings.commentProbability}
                          onChange={(e) => {
                             const val = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                             updateSetting('commentProbability', val);
                          }}
                          className={`w-16 h-8 text-center text-xs rounded-lg outline-none ${inputClass} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`} 
                        />
                      </div>
                   </div>
                </div>
             </div>
          </div>
        </div>
      </section>

      {/* General Settings */}
      <section>
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 px-1">通用</h2>
        <div className={`${cardClass} p-2 flex flex-col gap-2 rounded-2xl`}>
           {/* API Config */}
           <div 
              onClick={() => navigateTo('API')}
              className="p-3 rounded-xl flex items-center justify-between cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.98] transition-all"
           >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-blue-400 ${pressedClass}`}>
                  <Key size={22} />
                </div>
                <span className={`font-bold ${headingClass}`}>API 配置</span>
              </div>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 ${isDarkMode ? cardClass : 'neu-flat'}`}>
                <ChevronRight size={16} />
              </div>
           </div>

           <div className="w-full h-[1px] bg-slate-300/20 mx-2" />

           {/* Storage Analysis */}
           <div 
              onClick={() => navigateTo('STORAGE')}
              className="p-3 rounded-xl flex items-center justify-between cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.98] transition-all"
           >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-slate-400 ${pressedClass}`}>
                  <HardDrive size={22} />
                </div>
                <span className={`font-bold ${headingClass}`}>储存分析</span>
              </div>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 ${isDarkMode ? cardClass : 'neu-flat'}`}>
                <ChevronRight size={16} />
              </div>
           </div>

           <div className="w-full h-[1px] bg-slate-300/20 mx-2" />

           {/* Appearance Preferences */}
           <div 
             onClick={() => navigateTo('APPEARANCE')}
             className="p-3 rounded-xl flex items-center justify-between cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.98] transition-all"
           >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-rose-400 ${pressedClass}`}>
                  <Palette size={22} />
                </div>
                <span className={`font-bold ${headingClass}`}>外观偏好</span>
              </div>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 ${isDarkMode ? cardClass : 'neu-flat'}`}>
                <ChevronRight size={16} />
              </div>
           </div>
        </div>
      </section>

      {/* Export/Import Buttons */}
      <div className="mt-8 grid grid-cols-2 gap-4 px-1">
        <button className={`${cardClass} py-4 rounded-2xl flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-rose-400 transition-colors active:scale-[0.98]`}>
            <Upload size={24} />
            <span className="text-xs font-bold">导出存档文件</span>
        </button>
        <button className={`${cardClass} py-4 rounded-2xl flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-rose-400 transition-colors active:scale-[0.98]`}>
            <Download size={24} />
            <span className="text-xs font-bold">导入存档文件</span>
        </button>
      </div>
    </div>
  );
};

export default Settings;
