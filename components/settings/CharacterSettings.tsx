import React, { useState } from 'react';
import { Camera, Check, Trash2, UserCircle, Book, Plus, ArrowLeft } from 'lucide-react';
import { Character, Persona, ThemeClasses } from './types';
import MultiSelectDropdown from './MultiSelectDropdown';
import ResolvedImage from '../ResolvedImage';

interface CharacterSettingsProps {
  characters: Character[];
  setCharacters: React.Dispatch<React.SetStateAction<Character[]>>;
  personas: Persona[];
  wbCategories: string[];
  theme: ThemeClasses;
  onBack: () => void;
  onOpenAvatarModal: (id: string, type: 'PERSONA' | 'CHARACTER') => void;
}

// Custom Feather Icon provided by user
const FeatherIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" className={`bi bi-feather ${className}`} viewBox="0 0 16 16">
    <path d="M15.807.531c-.174-.177-.41-.289-.64-.363a3.8 3.8 0 0 0-.833-.15c-.62-.049-1.394 0-2.252.175C10.365.545 8.264 1.415 6.315 3.1S3.147 6.824 2.557 8.523c-.294.847-.44 1.634-.429 2.268.005.316.05.62.154.88q.025.061.056.122A68 68 0 0 0 .08 15.198a.53.53 0 0 0 .157.72.504.504 0 0 0 .705-.16 68 68 0 0 1 2.158-3.26c.285.141.616.195.958.182.513-.02 1.098-.188 1.723-.49 1.25-.605 2.744-1.787 4.303-3.642l1.518-1.55a.53.53 0 0 0 0-.739l-.729-.744 1.311.209a.5.5 0 0 0 .443-.15l.663-.684c.663-.68 1.292-1.325 1.763-1.892.314-.378.585-.752.754-1.107.163-.345.278-.773.112-1.188a.5.5 0 0 0-.112-.172M3.733 11.62C5.385 9.374 7.24 7.215 9.309 5.394l1.21 1.234-1.171 1.196-.027.03c-1.5 1.789-2.891 2.867-3.977 3.393-.544.263-.99.378-1.324.39a1.3 1.3 0 0 1-.287-.018Zm6.769-7.22c1.31-1.028 2.7-1.914 4.172-2.6a7 7 0 0 1-.4.523c-.442.533-1.028 1.134-1.681 1.804l-.51.524zm3.346-3.357C9.594 3.147 6.045 6.8 3.149 10.678c.007-.464.121-1.086.37-1.806.533-1.535 1.65-3.415 3.455-4.976 1.807-1.561 3.746-2.36 5.31-2.68a8 8 0 0 1 1.564-.173"/>
  </svg>
);

const CharacterSettings: React.FC<CharacterSettingsProps> = ({
  characters,
  setCharacters,
  personas,
  wbCategories,
  theme,
  onBack,
  onOpenAvatarModal
}) => {
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null);
  const { containerClass, animationClass, cardClass, activeBorderClass, baseBorderClass, pressedClass, headingClass, inputClass, btnClass, isDarkMode } = theme;

  const updateCharacter = (id: string, field: keyof Character, value: any) => {
    setCharacters(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const addNewCharacter = () => {
    const newId = Date.now().toString();
    setCharacters([...characters, { 
      id: newId, 
      name: '新角色', 
      nickname: '新角色昵称', 
      description: '', 
      avatar: '',
      boundWorldBookCategories: []
    }]);
    setEditingCharacterId(newId);
  };

  const deleteCharacter = (id: string) => {
    setCharacters(prev => prev.filter(c => c.id !== id));
    if (editingCharacterId === id) setEditingCharacterId(null);
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

  return (
    <div className={`flex-1 flex flex-col p-6 pb-28 overflow-y-auto no-scrollbar relative ${containerClass} ${animationClass}`}>
      {renderHeader("管理角色", onBack)}
      
      <div className="flex flex-col gap-6">
        {characters.map(char => {
          const isEditing = editingCharacterId === char.id;
          const boundUsers = personas.filter(p => p.boundRoles.includes(char.name));

          return (
            <div key={char.id} className={`${cardClass} p-5 rounded-2xl transition-all ${isEditing ? activeBorderClass : baseBorderClass}`}>
              {/* Header View */}
              <div className="flex justify-between items-center mb-4 h-10">
                <div className="flex items-center gap-4 flex-1 mr-2 h-full">
                  <div className="relative group cursor-pointer flex-shrink-0" onClick={() => isEditing && onOpenAvatarModal(char.id, 'CHARACTER')}>
                    <div className={`w-14 h-14 rounded-full overflow-hidden flex items-center justify-center border-4 ${isDarkMode ? 'border-[#2d3748]' : 'border-[#e0e5ec]'} ${pressedClass}`}>
                      {char.avatar ? (
                        <ResolvedImage src={char.avatar} alt="Avatar" className="w-full h-full object-cover" />
                      ) : (
                        <FeatherIcon size={32} className="text-slate-300" />
                      )}
                    </div>
                    {isEditing && (
                      <div className="absolute inset-0 bg-black/30 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Camera size={18} className="text-white" />
                      </div>
                    )}
                  </div>
                  
                  <div className="min-w-0 flex-1 flex flex-col justify-center">
                    {!isEditing ? (
                      <>
                        <h3 className={`text-lg font-bold truncate ${headingClass}`}>{char.name}</h3>
                        <p className="text-xs text-rose-400 mt-0.5 line-clamp-1">昵称: {char.nickname || char.name}</p>
                      </>
                    ) : (
                      <input 
                        type="text" 
                        value={char.name}
                        onChange={(e) => updateCharacter(char.id, 'name', e.target.value)}
                        className={`px-4 w-full text-sm font-bold rounded-full h-9 border-none outline-none ${inputClass}`}
                        placeholder="角色名称 (ID)"
                      />
                    )}
                  </div>
                </div>

                <div className="flex gap-2 flex-shrink-0 items-center">
                  {isEditing ? (
                    <button onClick={() => setEditingCharacterId(null)} className={`h-9 px-4 rounded-full flex items-center justify-center text-emerald-500 ${btnClass}`}>
                      <Check size={18} />
                    </button>
                  ) : (
                    <button onClick={() => setEditingCharacterId(char.id)} className={`h-9 px-4 rounded-full text-xs text-slate-500 font-medium ${btnClass}`}>
                      编辑
                    </button>
                  )}
                  <button onClick={() => deleteCharacter(char.id)} className={`w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 ${btnClass}`}>
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>

              {/* Edit Fields */}
              {isEditing ? (
                <div className="space-y-4 animate-fade-in mt-2">
                   <div className="space-y-2">
                     <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">角色昵称</label>
                     <input 
                        type="text"
                        value={char.nickname}
                        onChange={(e) => updateCharacter(char.id, 'nickname', e.target.value)}
                        className={`w-full px-4 py-3 text-sm rounded-xl outline-none ${inputClass}`}
                        placeholder="聊天界面显示的名称"
                     />
                   </div>
                   <div className="space-y-2">
                     <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">人设描述</label>
                     <textarea 
                        value={char.description}
                        onChange={(e) => updateCharacter(char.id, 'description', e.target.value)}
                        className={`w-full p-4 text-sm rounded-xl outline-none resize-none h-32 ${inputClass}`}
                        placeholder="设定角色的性格、语气、说话方式..."
                     />
                   </div>
                   <div className="space-y-2">
                     <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">绑定世界书分类 (多选)</label>
                     <MultiSelectDropdown 
                        options={wbCategories} 
                        selected={char.boundWorldBookCategories || []}
                        onChange={(cats) => updateCharacter(char.id, 'boundWorldBookCategories', cats)}
                        placeholder="选择世界书分类..."
                        inputClass={inputClass}
                        cardClass={cardClass}
                        isDarkMode={isDarkMode}
                     />
                   </div>
                </div>
              ) : (
                 <div className="mt-2">
                    <p className="text-xs text-slate-400 mb-2 line-clamp-3">{char.description}</p>
                    
                    {/* Chips Area - Split into two rows */}
                    <div className="flex flex-col gap-2 pt-2 border-t border-slate-200/50 dark:border-slate-600/50">
                       {/* Row 1: Users */}
                       <div className="flex flex-wrap gap-2 items-center">
                          <span className="text-[10px] text-slate-500 font-bold uppercase w-12 text-right">绑定用户</span>
                          {boundUsers.length > 0 ? boundUsers.map(u => (
                            <span key={u.id} className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${isDarkMode ? 'bg-rose-900/30 border-rose-800 text-rose-400' : 'bg-white/80 border-rose-200 text-rose-500'}`}>
                              <UserCircle size={10} /> {u.name}
                            </span>
                          )) : <span className="text-[10px] text-slate-400 italic">无</span>}
                       </div>

                       {/* Row 2: Categories (Updated Colors) */}
                       <div className="flex flex-wrap gap-2 items-center">
                          <span className="text-[10px] text-slate-500 font-bold uppercase w-12 text-right">世界书</span>
                          {char.boundWorldBookCategories?.length > 0 ? char.boundWorldBookCategories.map((cat, i) => (
                            <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                              isDarkMode 
                                ? 'bg-dreamy-900/40 border-dreamy-500/50 text-dreamy-500' 
                                : 'bg-dreamy-400/10 border-dreamy-300 text-dreamy-500'
                            }`}>
                              <Book size={10} /> {cat}
                            </span>
                          )) : <span className="text-[10px] text-slate-400 italic">无</span>}
                       </div>
                    </div>
                 </div>
              )}
            </div>
          );
        })}
        <button onClick={addNewCharacter} className={`${cardClass} p-4 text-slate-400 flex items-center justify-center gap-2 hover:text-rose-400 transition-colors border-2 border-dashed border-transparent hover:border-rose-200 rounded-2xl`}>
          <Plus size={20} />
          <span className="font-medium">新建角色</span>
        </button>
      </div>
    </div>
  );
};

export default CharacterSettings;
