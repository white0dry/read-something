
import React, { useState, useRef } from 'react';
import { FolderOpen, Folder, Edit2, Trash2, ChevronRight, Plus, Check, GripVertical, ArrowUp, ArrowDown, ArrowLeft } from 'lucide-react';
import { WorldBookEntry, ThemeClasses } from './types';

interface WorldBookSettingsProps {
  wbCategories: string[];
  setWbCategories: React.Dispatch<React.SetStateAction<string[]>>;
  worldBookEntries: WorldBookEntry[];
  setWorldBookEntries: React.Dispatch<React.SetStateAction<WorldBookEntry[]>>;
  theme: ThemeClasses;
  onBack: () => void;
  // Navigation can also be handled internally but passed for consistency
}

const WorldBookSettings: React.FC<WorldBookSettingsProps> = ({
  wbCategories,
  setWbCategories,
  worldBookEntries,
  setWorldBookEntries,
  theme,
  onBack
}) => {
  const [viewingCategory, setViewingCategory] = useState<string | null>(null);
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [tempCategoryName, setTempCategoryName] = useState('');
  const [editingWorldBookId, setEditingWorldBookId] = useState<string | null>(null);
  
  // Drag refs
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const { containerClass, animationClass, cardClass, activeBorderClass, baseBorderClass, pressedClass, headingClass, inputClass, btnClass, isDarkMode } = theme;

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

  // Handlers
  const addNewCategory = () => {
    const name = `新分类 ${wbCategories.length + 1}`;
    setWbCategories([...wbCategories, name]);
  };

  const deleteCategory = (category: string) => {
    if (category === '未分类') return;
    setWbCategories(prev => prev.filter(c => c !== category));
    setWorldBookEntries(prev => prev.map(e => e.category === category ? { ...e, category: '未分类' } : e));
    if (!wbCategories.includes('未分类')) {
      setWbCategories(prev => [...prev, '未分类']);
    }
  };

  const startRenamingCategory = (category: string) => {
    setRenamingCategory(category);
    setTempCategoryName(category);
  };

  const saveRenamedCategory = () => {
    if (!renamingCategory || !tempCategoryName.trim()) {
      setRenamingCategory(null);
      return;
    }
    setWbCategories(prev => prev.map(c => c === renamingCategory ? tempCategoryName : c));
    setWorldBookEntries(prev => prev.map(e => e.category === renamingCategory ? { ...e, category: tempCategoryName } : e));
    setRenamingCategory(null);
  };

  const updateWorldBookEntry = (id: string, field: keyof WorldBookEntry, value: any) => {
    setWorldBookEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  };

  const addNewWorldBookEntry = () => {
    if (!viewingCategory) return;
    const newId = Date.now().toString();
    setWorldBookEntries([...worldBookEntries, {
      id: newId,
      title: '新条目',
      category: viewingCategory,
      content: '',
      insertPosition: 'BEFORE'
    }]);
    setEditingWorldBookId(newId);
  };

  const deleteWorldBookEntry = (id: string) => {
    setWorldBookEntries(prev => prev.filter(e => e.id !== id));
    if (editingWorldBookId === id) setEditingWorldBookId(null);
  };

  const handleSort = () => {
    if (!viewingCategory || dragItem.current === null || dragOverItem.current === null) return;
    
    const categoryEntries = worldBookEntries.filter(e => e.category === viewingCategory);
    const _categoryEntries = [...categoryEntries];
    const draggedItemContent = _categoryEntries.splice(dragItem.current, 1)[0];
    _categoryEntries.splice(dragOverItem.current, 0, draggedItemContent);
    
    const otherEntries = worldBookEntries.filter(e => e.category !== viewingCategory);
    setWorldBookEntries([...otherEntries, ..._categoryEntries]);
    
    dragItem.current = null;
    dragOverItem.current = null;
  };

  // --- Render Views ---

  // 1. ENTRY LIST VIEW
  if (viewingCategory) {
    const filteredEntries = worldBookEntries.filter(e => e.category === viewingCategory);
    
    return (
      <div className={`flex-1 flex flex-col p-6 pb-28 overflow-y-auto no-scrollbar relative ${containerClass} ${animationClass}`}>
        <header className="mb-6 pt-2 flex items-center gap-4">
          <button 
            onClick={() => setViewingCategory(null)} 
            className={`w-10 h-10 rounded-full flex items-center justify-center hover:text-rose-400 transition-colors active:scale-95 ${btnClass}`}
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className={`text-xl font-bold ${headingClass}`}>{viewingCategory}</h1>
            <p className="text-xs text-slate-500 mt-1">管理该分类下的条目 (可拖动排序)</p>
          </div>
        </header>
        
        <div className="flex flex-col gap-6">
          {filteredEntries.map((entry, index) => {
            const isEditing = editingWorldBookId === entry.id;
            return (
              <div 
                key={entry.id} 
                className={`${cardClass} p-5 rounded-2xl transition-all ${isEditing ? activeBorderClass : baseBorderClass}`}
                draggable={!isEditing}
                onDragStart={(e) => {
                   dragItem.current = index;
                   e.currentTarget.style.opacity = '0.5';
                }}
                onDragEnter={() => {
                   dragOverItem.current = index;
                }}
                onDragEnd={(e) => {
                   e.currentTarget.style.opacity = '1';
                   handleSort();
                }}
                onDragOver={(e) => e.preventDefault()}
              >
                {/* Header */}
                <div className="flex justify-between items-start mb-2">
                  {!isEditing && (
                     <div className="mr-3 mt-1 text-slate-400 cursor-grab active:cursor-grabbing hover:text-slate-600">
                       <GripVertical size={20} />
                     </div>
                  )}

                  <div className="flex-1 mr-4">
                     {isEditing ? (
                        <input 
                          type="text" 
                          value={entry.title}
                          onChange={(e) => updateWorldBookEntry(entry.id, 'title', e.target.value)}
                          className={`w-full px-4 py-2 text-sm font-bold rounded-lg outline-none mb-2 ${inputClass}`}
                          placeholder="条目标题"
                        />
                     ) : (
                        <div className="flex flex-col">
                           <h3 className={`text-lg font-bold ${headingClass}`}>{entry.title}</h3>
                           <div className="flex items-center gap-2 mt-1">
                              <span className={`text-[10px] px-2 py-0.5 rounded border flex items-center gap-1 font-bold tracking-wide ${
                                entry.insertPosition === 'BEFORE' 
                                  ? 'bg-transparent text-dreamy-500 border-dreamy-400 dark:text-dreamy-300 dark:border-dreamy-500/50'
                                  : 'bg-transparent text-rose-500 border-rose-300 dark:text-rose-300 dark:border-rose-800/50'
                              }`}>
                                 {entry.insertPosition === 'BEFORE' ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                                 {entry.insertPosition === 'BEFORE' ? '角色定义前' : '角色定义后'}
                              </span>
                           </div>
                        </div>
                     )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {isEditing ? (
                      <button onClick={() => setEditingWorldBookId(null)} className={`h-9 px-4 rounded-full flex items-center justify-center text-emerald-500 ${btnClass}`}>
                        <Check size={18} />
                      </button>
                    ) : (
                      <button onClick={() => setEditingWorldBookId(entry.id)} className={`h-9 px-4 rounded-full text-xs text-slate-500 font-medium ${btnClass}`}>
                        编辑
                      </button>
                    )}
                    <button onClick={() => deleteWorldBookEntry(entry.id)} className={`w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 ${btnClass}`}>
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
                {/* Content */}
                {isEditing ? (
                   <div className="space-y-3 mt-2">
                       <textarea 
                          value={entry.content}
                          onChange={(e) => updateWorldBookEntry(entry.id, 'content', e.target.value)}
                          className={`w-full p-4 text-sm rounded-xl outline-none resize-none h-40 ${inputClass}`}
                          placeholder="输入具体设定内容..."
                       />
                       <div className="flex items-center justify-between px-2">
                          <span className="text-xs font-bold text-slate-400 uppercase">插入位置</span>
                          <div className={`flex rounded-lg p-1 ${isDarkMode ? 'bg-[#1a202c]' : 'neu-pressed'}`}>
                             <button 
                                onClick={() => updateWorldBookEntry(entry.id, 'insertPosition', 'BEFORE')}
                                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${entry.insertPosition === 'BEFORE' ? (isDarkMode ? 'bg-slate-600 text-white' : 'neu-flat text-rose-400') : 'text-slate-500'}`}
                             >
                                角色定义前
                             </button>
                             <button 
                                onClick={() => updateWorldBookEntry(entry.id, 'insertPosition', 'AFTER')}
                                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${entry.insertPosition === 'AFTER' ? (isDarkMode ? 'bg-slate-600 text-white' : 'neu-flat text-rose-400') : 'text-slate-500'}`}
                             >
                                角色定义后
                             </button>
                          </div>
                       </div>
                   </div>
                ) : (
                   <p className="text-sm text-slate-500 leading-relaxed mt-3 line-clamp-3">
                      {entry.content || <span className="italic opacity-50">暂无内容...</span>}
                   </p>
                )}
              </div>
            );
          })}
          {filteredEntries.length === 0 && (
             <div className="text-center py-10 opacity-50 text-sm">暂无条目</div>
          )}
          <button onClick={addNewWorldBookEntry} className={`${cardClass} p-4 text-slate-400 flex items-center justify-center gap-2 hover:text-rose-400 transition-colors border-2 border-dashed border-transparent hover:border-rose-200 rounded-2xl`}>
            <Plus size={20} />
            <span className="font-medium">新建条目</span>
          </button>
        </div>
      </div>
    );
  }

  // 2. CATEGORY LIST VIEW (Top Level)
  return (
    <div className={`flex-1 flex flex-col p-6 pb-28 overflow-y-auto no-scrollbar relative ${containerClass} ${animationClass}`}>
      {renderHeader("世界书分类", onBack)}
      
      <div className="grid grid-cols-1 gap-4">
        {wbCategories.map(category => {
          const isRenaming = renamingCategory === category;
          const count = worldBookEntries.filter(e => e.category === category).length;
          
          return (
             <div key={category} className={`${cardClass} p-4 rounded-2xl flex items-center justify-between group active:scale-[0.99] transition-transform`}>
                
                {/* Left Side: Folder Icon & Name */}
                <div 
                   className="flex items-center gap-4 flex-1 cursor-pointer"
                   onClick={() => {
                     if (!isRenaming) {
                       setViewingCategory(category);
                     }
                   }}
                >
                   <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-rose-400 ${pressedClass}`}>
                     {count > 0 ? <FolderOpen size={24} /> : <Folder size={24} />}
                   </div>
                   
                   <div className="flex-1">
                     {isRenaming ? (
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                           <input 
                             autoFocus
                             type="text" 
                             value={tempCategoryName}
                             onChange={(e) => setTempCategoryName(e.target.value)}
                             className={`w-full px-3 py-1 text-sm font-bold rounded-lg outline-none ${inputClass}`}
                             onKeyDown={(e) => e.key === 'Enter' && saveRenamedCategory()}
                           />
                           <button onClick={saveRenamedCategory} className="text-emerald-500"><Check size={18}/></button>
                        </div>
                     ) : (
                       <>
                         <h3 className={`font-bold ${headingClass}`}>{category}</h3>
                         <p className="text-xs text-slate-500">{count} 个条目</p>
                       </>
                     )}
                   </div>
                </div>

                {/* Right Side: Actions */}
                {!isRenaming && (
                  <div className="flex gap-1 pl-2">
                    <button 
                       onClick={(e) => { e.stopPropagation(); startRenamingCategory(category); }}
                       className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 ${btnClass}`}
                    >
                       <Edit2 size={14} />
                    </button>
                    <button 
                       onClick={(e) => { e.stopPropagation(); deleteCategory(category); }}
                       className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 disabled:opacity-30 ${btnClass}`}
                       disabled={category === '未分类'}
                    >
                       <Trash2 size={14} />
                    </button>
                    <button 
                       onClick={() => {
                          setViewingCategory(category);
                       }}
                       className={`w-8 h-8 rounded-full flex items-center justify-center text-rose-400 ${btnClass}`}
                    >
                       <ChevronRight size={16} />
                    </button>
                  </div>
                )}
             </div>
          );
        })}

        <button onClick={addNewCategory} className={`${cardClass} p-4 text-slate-400 flex items-center justify-center gap-2 hover:text-rose-400 transition-colors border-2 border-dashed border-transparent hover:border-rose-200 rounded-2xl mt-2`}>
          <Plus size={20} />
          <span className="font-medium">新建分类</span>
        </button>
      </div>
    </div>
  );
};

export default WorldBookSettings;
