import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, Trash2, UserCircle, Book, Plus, ArrowLeft, FolderOpen, PenLine, X } from 'lucide-react';
import { Character, Persona, WorldBookEntry, ThemeClasses } from './types';
import MultiSelectDropdown from './MultiSelectDropdown';
import ResolvedImage from '../ResolvedImage';
import { parseSillyTavernJson, parseSillyTavernPng, SillyTavernImportResult } from '../../utils/sillyTavernImport';
import { saveImageFile } from '../../utils/imageStorage';

interface CharacterSettingsProps {
  characters: Character[];
  setCharacters: React.Dispatch<React.SetStateAction<Character[]>>;
  personas: Persona[];
  wbCategories: string[];
  setWbCategories: React.Dispatch<React.SetStateAction<string[]>>;
  worldBookEntries: WorldBookEntry[];
  setWorldBookEntries: React.Dispatch<React.SetStateAction<WorldBookEntry[]>>;
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

interface ImportDialogState {
  open: boolean;
  result: SillyTavernImportResult | null;
  avatarRef: string;
  tempName: string;
  tempDesc: string;
}

const DROPDOWN_CLOSE_MS = 200;

const CharacterSettings: React.FC<CharacterSettingsProps> = ({
  characters,
  setCharacters,
  personas,
  wbCategories,
  setWbCategories,
  worldBookEntries,
  setWorldBookEntries,
  theme,
  onBack,
  onOpenAvatarModal
}) => {
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownClosing, setDropdownClosing] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importDialog, setImportDialog] = useState<ImportDialogState>({
    open: false, result: null, avatarRef: '', tempName: '', tempDesc: ''
  });

  const dropdownRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const { containerClass, animationClass, cardClass, activeBorderClass, baseBorderClass, pressedClass, headingClass, inputClass, btnClass, isDarkMode } = theme;

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  // Cleanup timer on unmount
  useEffect(() => () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); }, []);

  const closeDropdown = () => {
    if (!dropdownOpen || dropdownClosing) return;
    setDropdownClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setDropdownOpen(false);
      setDropdownClosing(false);
    }, DROPDOWN_CLOSE_MS);
  };

  const toggleDropdown = () => {
    if (dropdownOpen) { closeDropdown(); } else { setDropdownOpen(true); }
  };

  const updateCharacter = (id: string, field: keyof Character, value: unknown) => {
    setCharacters(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const addNewCharacter = () => {
    const newId = Date.now().toString();
    setCharacters(prev => [...prev, {
      id: newId,
      name: '新角色',
      nickname: '新角色昵称',
      description: '',
      avatar: '',
      boundWorldBookCategories: []
    }]);
    setEditingCharacterId(newId);
    closeDropdown();
  };

  const deleteCharacter = (id: string) => {
    setCharacters(prev => prev.filter(c => c.id !== id));
    if (editingCharacterId === id) setEditingCharacterId(null);
  };

  /** 确保世界书分类名唯一，若重名则加数字后缀 */
  const resolveUniqueCategoryName = (baseName: string): string => {
    if (!wbCategories.includes(baseName)) return baseName;
    let i = 2;
    while (wbCategories.includes(`${baseName} (${i})`)) i++;
    return `${baseName} (${i})`;
  };

  /** 将解析结果写入角色 + 世界书 */
  const commitImport = (
    result: SillyTavernImportResult,
    avatarRef: string,
    overrideName?: string,
    overrideDesc?: string
  ) => {
    const charName = (overrideName ?? result.name).trim() || '导入角色';
    const charDesc = (overrideDesc ?? result.description).trim();

    const newId = Date.now().toString();
    const categoryName = resolveUniqueCategoryName(charName);

    const newEntries: WorldBookEntry[] = result.entries.map((e, idx) => ({
      id: `${newId}_wb_${idx}`,
      title: e.title,
      content: e.content,
      category: categoryName,
      insertPosition: e.insertPosition,
      sendToAi: true,
    }));

    const newChar: Character = {
      id: newId,
      name: charName,
      nickname: charName,
      description: charDesc,
      avatar: avatarRef,
      boundWorldBookCategories: result.entries.length > 0 ? [categoryName] : [],
    };

    if (result.entries.length > 0) {
      setWbCategories(prev => [...prev, categoryName]);
      setWorldBookEntries(prev => [...prev, ...newEntries]);
    }
    setCharacters(prev => [...prev, newChar]);
    setEditingCharacterId(newId);
    setImportDialog({ open: false, result: null, avatarRef: '', tempName: '', tempDesc: '' });
    closeDropdown();
  };

  /** 处理文件读取并解析（自动识别 JSON / PNG） */
  const handleImportFile = async (file: File) => {
    setImportError(null);
    closeDropdown();
    try {
      let result: SillyTavernImportResult;
      let avatarRef = '';

      const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
      if (isPng) {
        const buffer = await file.arrayBuffer();
        result = parseSillyTavernPng(buffer);
        // 将 PNG 图片本身保存为角色头像
        avatarRef = await saveImageFile(file);
      } else {
        const text = await file.text();
        result = parseSillyTavernJson(text);
      }

      if (!result.name.trim()) {
        setImportDialog({ open: true, result, avatarRef, tempName: '', tempDesc: result.description });
      } else {
        commitImport(result, avatarRef);
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : '文件解析失败');
    }
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

      {/* 隐藏的文件选择器（支持 JSON、PNG，手机端同时支持相册/拍照/文件） */}
      <input
        ref={importInputRef}
        type="file"
        accept=".json,.png,image/png"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImportFile(file);
          e.target.value = '';
        }}
      />

      {/* 导入错误提示 */}
      {importError && (
        <div className="mb-4 p-3 rounded-xl bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm flex items-center justify-between gap-2">
          <span>{importError}</span>
          <button onClick={() => setImportError(null)} className="flex-shrink-0"><X size={14} /></button>
        </div>
      )}

      <div className="flex flex-col gap-6">
        {/* 新建角色按钮 + 下拉菜单 */}
        <div className="relative" ref={dropdownRef}>
          {/* 触发按钮 */}
          <button
            onClick={toggleDropdown}
            className={`${cardClass} w-full p-4 text-slate-400 flex items-center justify-center gap-2 hover:text-rose-400 transition-colors border-2 border-dashed border-transparent hover:border-rose-200 rounded-2xl`}
          >
            <Plus size={20} />
            <span className="font-medium">新建角色</span>
          </button>

          {/* 下拉菜单（展开在按钮下方） */}
          {(dropdownOpen || dropdownClosing) && (
            <div className={`absolute top-full mt-2 left-0 right-0 z-20 p-2 rounded-xl ${cardClass} border border-slate-400/10 shadow-2xl ${dropdownClosing ? 'reader-flyout-exit' : 'reader-flyout-enter'}`}>
              <button
                onClick={() => { importInputRef.current?.click(); closeDropdown(); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left transition-colors ${isDarkMode ? 'hover:bg-slate-700 text-slate-200' : 'hover:bg-slate-100 text-slate-700'}`}
              >
                <FolderOpen size={18} className="text-rose-400 flex-shrink-0" />
                <span>本地导入</span>
              </button>
              <button
                onClick={addNewCharacter}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left transition-colors ${isDarkMode ? 'hover:bg-slate-700 text-slate-200' : 'hover:bg-slate-100 text-slate-700'}`}
              >
                <PenLine size={18} className="text-rose-400 flex-shrink-0" />
                <span>手动新建</span>
              </button>
            </div>
          )}
        </div>

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

                    <div className="flex flex-col gap-2 pt-2 border-t border-slate-200/50 dark:border-slate-600/50">
                       <div className="flex flex-wrap gap-2 items-center">
                          <span className="text-[10px] text-slate-500 font-bold uppercase w-12 text-right">绑定用户</span>
                          {boundUsers.length > 0 ? boundUsers.map(u => (
                            <span key={u.id} className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${isDarkMode ? 'bg-rose-900/30 border-rose-800 text-rose-400' : 'bg-white/80 border-rose-200 text-rose-500'}`}>
                              <UserCircle size={10} /> {u.name}
                            </span>
                          )) : <span className="text-[10px] text-slate-400 italic">无</span>}
                       </div>

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

      </div>

      {/* 补全信息弹窗 */}
      {importDialog.open && importDialog.result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className={`${cardClass} rounded-2xl p-6 w-full max-w-md shadow-2xl`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-lg font-bold ${headingClass}`}>补全角色信息</h2>
              <button
                onClick={() => setImportDialog({ open: false, result: null, avatarRef: '', tempName: '', tempDesc: '' })}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 ${btnClass}`}
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-slate-400 mb-4">
              已解析 <span className="font-bold text-rose-400">{importDialog.result.entries.length}</span> 条世界书条目，请填写角色基本信息
            </p>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">角色名称 *</label>
                <input
                  type="text"
                  value={importDialog.tempName}
                  onChange={(e) => setImportDialog(s => ({ ...s, tempName: e.target.value }))}
                  className={`w-full px-4 py-3 text-sm rounded-xl outline-none ${inputClass}`}
                  placeholder="请输入角色真名..."
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">人设描述</label>
                <textarea
                  value={importDialog.tempDesc}
                  onChange={(e) => setImportDialog(s => ({ ...s, tempDesc: e.target.value }))}
                  className={`w-full p-4 text-sm rounded-xl outline-none resize-none h-28 ${inputClass}`}
                  placeholder="角色性格、设定（可留空后续填写）..."
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setImportDialog({ open: false, result: null, avatarRef: '', tempName: '', tempDesc: '' })}
                className={`flex-1 py-2.5 rounded-xl text-sm text-slate-500 ${btnClass}`}
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (!importDialog.tempName.trim()) return;
                  commitImport(importDialog.result!, importDialog.avatarRef, importDialog.tempName, importDialog.tempDesc);
                }}
                disabled={!importDialog.tempName.trim()}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  importDialog.tempName.trim()
                    ? 'bg-rose-400 text-white hover:bg-rose-500'
                    : 'bg-slate-300 text-slate-400 cursor-not-allowed'
                }`}
              >
                确认导入
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CharacterSettings;
