import React, { useState } from 'react';
import { UserCircle, Camera, Check, Trash2, Plus, ArrowLeft } from 'lucide-react';
import { Persona, Character, ThemeClasses } from './types';
import MultiSelectDropdown from './MultiSelectDropdown';

interface PersonaSettingsProps {
  personas: Persona[];
  setPersonas: React.Dispatch<React.SetStateAction<Persona[]>>;
  characters: Character[];
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

const PersonaSettings: React.FC<PersonaSettingsProps> = ({ 
  personas, 
  setPersonas, 
  characters, 
  theme, 
  onBack,
  onOpenAvatarModal 
}) => {
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null);
  const { containerClass, animationClass, cardClass, activeBorderClass, baseBorderClass, pressedClass, headingClass, inputClass, btnClass, isDarkMode } = theme;

  const updatePersona = (id: string, field: keyof Persona, value: any) => {
    setPersonas(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const addNewPersona = () => {
    const newId = Date.now().toString();
    setPersonas([...personas, { 
      id: newId, 
      name: '新人设', 
      userNickname: '用户',
      description: '', 
      avatar: '', 
      boundRoles: [] 
    }]);
    setEditingPersonaId(newId);
  };

  const deletePersona = (id: string) => {
    setPersonas(prev => prev.filter(p => p.id !== id));
    if (editingPersonaId === id) setEditingPersonaId(null);
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
      {renderHeader("管理用户人设", onBack)}
      
      <div className="flex flex-col gap-6">
        {personas.map(persona => {
          const isEditing = editingPersonaId === persona.id;
          return (
            <div key={persona.id} className={`${cardClass} p-5 rounded-2xl transition-all ${isEditing ? activeBorderClass : baseBorderClass}`}>
              {/* Header View */}
              <div className="flex justify-between items-center mb-4 h-10">
                <div className="flex items-center gap-4 flex-1 mr-2 h-full">
                  <div className="relative group cursor-pointer flex-shrink-0" onClick={() => isEditing && onOpenAvatarModal(persona.id, 'PERSONA')}>
                    <div className={`w-14 h-14 rounded-full overflow-hidden flex items-center justify-center border-4 ${isDarkMode ? 'border-[#2d3748]' : 'border-[#e0e5ec]'} ${pressedClass}`}>
                      {persona.avatar ? (
                        <img src={persona.avatar} alt="Avatar" className="w-full h-full object-cover" />
                      ) : (
                        <UserCircle size={32} className="text-slate-300" />
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
                        <h3 className={`text-lg font-bold truncate ${headingClass}`}>{persona.name}</h3>
                        <div className="flex flex-col gap-0.5">
                          <p className="text-xs text-rose-400 flex items-center gap-1">
                            <FeatherIcon size={12} />
                            绑定: {persona.boundRoles.length > 0 ? persona.boundRoles.join(', ') : '无'}
                          </p>
                        </div>
                      </>
                    ) : (
                      <input 
                        type="text" 
                        value={persona.name}
                        onChange={(e) => updatePersona(persona.id, 'name', e.target.value)}
                        className={`px-4 w-full text-sm font-bold rounded-full h-9 border-none outline-none ${inputClass}`}
                        placeholder="人设名称"
                      />
                    )}
                  </div>
                </div>

                <div className="flex gap-2 flex-shrink-0 items-center">
                  {isEditing ? (
                    <button onClick={() => setEditingPersonaId(null)} className={`h-9 px-4 rounded-full flex items-center justify-center text-emerald-500 ${btnClass}`}>
                      <Check size={18} />
                    </button>
                  ) : (
                    <button onClick={() => setEditingPersonaId(persona.id)} className={`h-9 px-4 rounded-full text-xs text-slate-500 font-medium ${btnClass}`}>
                      编辑
                    </button>
                  )}
                  <button onClick={() => deletePersona(persona.id)} className={`w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 ${btnClass}`}>
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>

              {/* Edit Fields */}
              {isEditing ? (
                <div className="space-y-4 animate-fade-in mt-2">
                   <div className="space-y-2">
                     <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">昵称 (希望角色如何称呼)</label>
                     <input 
                        type="text" 
                        value={persona.userNickname}
                        onChange={(e) => updatePersona(persona.id, 'userNickname', e.target.value)}
                        className={`w-full px-4 py-3 text-sm rounded-xl outline-none ${inputClass}`}
                        placeholder="例如：主人、指挥官..."
                     />
                   </div>
                   <div className="space-y-2">
                     <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">人设描述</label>
                     <textarea 
                        value={persona.description}
                        onChange={(e) => updatePersona(persona.id, 'description', e.target.value)}
                        className={`w-full p-4 text-sm rounded-xl outline-none resize-none h-24 ${inputClass}`}
                        placeholder="描述你希望在这个人设下如何与AI互动..."
                     />
                   </div>
                   <div className="space-y-2">
                     <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">绑定角色 (多选)</label>
                     <MultiSelectDropdown 
                        options={characters.map(c => c.name)}
                        selected={persona.boundRoles}
                        onChange={(newRoles) => updatePersona(persona.id, 'boundRoles', newRoles)}
                        placeholder="选择要绑定的角色..."
                        inputClass={inputClass}
                        cardClass={cardClass}
                        isDarkMode={isDarkMode}
                     />
                   </div>
                </div>
              ) : (
                <div className="mt-2">
                   <p className="text-xs text-slate-400 mb-1">昵称：<span className={isDarkMode ? 'text-slate-300' : 'text-slate-600'}>{persona.userNickname}</span></p>
                   <p className="text-sm text-slate-500 leading-relaxed px-1 line-clamp-2">
                      {persona.description || "暂无描述..."}
                   </p>
                </div>
              )}
            </div>
          );
        })}
        <button onClick={addNewPersona} className={`${cardClass} p-4 text-slate-400 flex items-center justify-center gap-2 hover:text-rose-400 transition-colors border-2 border-dashed border-transparent hover:border-rose-200 rounded-2xl`}>
          <Plus size={20} />
          <span className="font-medium">新建人设</span>
        </button>
      </div>
    </div>
  );
};

export default PersonaSettings;