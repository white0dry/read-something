import React, { useEffect, useRef, useState } from 'react';
import {
  FolderOpen,
  Folder,
  Edit2,
  Trash2,
  ChevronRight,
  Plus,
  Check,
  GripVertical,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
} from 'lucide-react';
import { WorldBookEntry, ThemeClasses } from './types';

interface WorldBookSettingsProps {
  wbCategories: string[];
  setWbCategories: React.Dispatch<React.SetStateAction<string[]>>;
  worldBookEntries: WorldBookEntry[];
  setWorldBookEntries: React.Dispatch<React.SetStateAction<WorldBookEntry[]>>;
  theme: ThemeClasses;
  onBack: () => void;
}

const INNER_VIEW_TRANSITION_MS = 260;
const INSERT_POSITION_SLIDE_MS = 220;
const DEFAULT_CATEGORY = '未分类';

type InsertPosition = WorldBookEntry['insertPosition'];

const WorldBookSettings: React.FC<WorldBookSettingsProps> = ({
  wbCategories,
  setWbCategories,
  worldBookEntries,
  setWorldBookEntries,
  theme,
  onBack,
}) => {
  const [viewingCategory, setViewingCategory] = useState<string | null>(null);
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [tempCategoryName, setTempCategoryName] = useState('');
  const [editingWorldBookId, setEditingWorldBookId] = useState<string | null>(null);
  const [innerAnimationClass, setInnerAnimationClass] = useState(theme.animationClass || 'app-view-enter-left');
  const [isSwitchingInnerView, setIsSwitchingInnerView] = useState(false);
  const [insertPositionVisualState, setInsertPositionVisualState] = useState<Record<string, InsertPosition>>({});

  // Pointer-drag state (mobile + desktop)
  const dragEntryIdRef = useRef<string | null>(null);
  const dragOverEntryIdRef = useRef<string | null>(null);
  const dragInsertPositionRef = useRef<InsertPosition | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragInputModeRef = useRef<'pointer' | 'touch' | null>(null);
  const dragTouchIdentifierRef = useRef<number | null>(null);
  const [draggingEntryId, setDraggingEntryId] = useState<string | null>(null);
  const [dragOverEntryId, setDragOverEntryId] = useState<string | null>(null);

  const innerTransitionTimerRef = useRef<number | null>(null);
  const innerTransitionUnlockTimerRef = useRef<number | null>(null);
  const insertPositionCommitTimersRef = useRef<Record<string, number>>({});

  const {
    containerClass,
    cardClass,
    activeBorderClass,
    baseBorderClass,
    sectionIconClass,
    headingClass,
    inputClass,
    btnClass,
    isDarkMode,
  } = theme;

  useEffect(() => {
    return () => {
      if (innerTransitionTimerRef.current) window.clearTimeout(innerTransitionTimerRef.current);
      if (innerTransitionUnlockTimerRef.current) window.clearTimeout(innerTransitionUnlockTimerRef.current);
      Object.values(insertPositionCommitTimersRef.current).forEach((timerId: number) => window.clearTimeout(timerId));
      insertPositionCommitTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!isSwitchingInnerView) {
      setInnerAnimationClass(theme.animationClass || 'app-view-enter-left');
    }
  }, [theme.animationClass, isSwitchingInnerView]);

  const switchCategoryView = (nextCategory: string | null) => {
    if (isSwitchingInnerView || nextCategory === viewingCategory) return;

    cancelEntryDrag();
    setIsSwitchingInnerView(true);
    setInnerAnimationClass('app-view-exit-right');

    if (innerTransitionTimerRef.current) window.clearTimeout(innerTransitionTimerRef.current);
    if (innerTransitionUnlockTimerRef.current) window.clearTimeout(innerTransitionUnlockTimerRef.current);

    innerTransitionTimerRef.current = window.setTimeout(() => {
      setViewingCategory(nextCategory);
      setInnerAnimationClass('app-view-enter-left');

      innerTransitionUnlockTimerRef.current = window.setTimeout(() => {
        setIsSwitchingInnerView(false);
      }, INNER_VIEW_TRANSITION_MS);
    }, INNER_VIEW_TRANSITION_MS);
  };

  const renderHeader = (title: string, onBackAction?: () => void) => (
    <header className="mb-6 pt-2 flex items-center gap-4">
      {onBackAction && (
        <button
          onClick={onBackAction}
          className={`w-10 h-10 rounded-full flex items-center justify-center hover:text-rose-400 transition-colors active:scale-95 ${btnClass}`}
        >
          <ArrowLeft size={20} />
        </button>
      )}
      <h1 className={`text-2xl font-bold ${headingClass}`}>{title}</h1>
    </header>
  );

  const addNewCategory = () => {
    const name = `新分类${wbCategories.length + 1}`;
    setWbCategories((prev) => [...prev, name]);
  };

  const deleteCategory = (category: string) => {
    if (category === DEFAULT_CATEGORY) return;

    setWbCategories((prev) => {
      const filtered = prev.filter((item) => item !== category);
      return filtered.includes(DEFAULT_CATEGORY) ? filtered : [...filtered, DEFAULT_CATEGORY];
    });

    setWorldBookEntries((prev) =>
      prev.map((entry) => (entry.category === category ? { ...entry, category: DEFAULT_CATEGORY } : entry))
    );
  };

  const startRenamingCategory = (category: string) => {
    setRenamingCategory(category);
    setTempCategoryName(category);
  };

  const saveRenamedCategory = () => {
    const nextName = tempCategoryName.trim();
    if (!renamingCategory || !nextName) {
      setRenamingCategory(null);
      return;
    }

    setWbCategories((prev) => prev.map((item) => (item === renamingCategory ? nextName : item)));
    setWorldBookEntries((prev) =>
      prev.map((entry) => (entry.category === renamingCategory ? { ...entry, category: nextName } : entry))
    );
    setRenamingCategory(null);
  };

  const updateWorldBookEntry = <K extends keyof WorldBookEntry>(
    id: string,
    field: K,
    value: WorldBookEntry[K]
  ) => {
    setWorldBookEntries((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry))
    );
  };

  const clearInsertPositionCommitTimer = (entryId: string) => {
    const timerId = insertPositionCommitTimersRef.current[entryId];
    if (!timerId) return;
    window.clearTimeout(timerId);
    delete insertPositionCommitTimersRef.current[entryId];
  };

  const clearInsertPositionVisualState = (entryId: string) => {
    setInsertPositionVisualState((prev) => {
      if (!(entryId in prev)) return prev;
      const next = { ...prev };
      delete next[entryId];
      return next;
    });
  };

  const switchInsertPositionWithSlide = (entryId: string, currentVisual: InsertPosition, nextPosition: InsertPosition) => {
    if (currentVisual === nextPosition) return;
    clearInsertPositionCommitTimer(entryId);
    setInsertPositionVisualState((prev) => ({ ...prev, [entryId]: nextPosition }));
    insertPositionCommitTimersRef.current[entryId] = window.setTimeout(() => {
      setWorldBookEntries((prev) =>
        prev.map((entry) => (entry.id === entryId ? { ...entry, insertPosition: nextPosition } : entry))
      );
      clearInsertPositionVisualState(entryId);
      delete insertPositionCommitTimersRef.current[entryId];
    }, INSERT_POSITION_SLIDE_MS);
  };

  const addNewWorldBookEntry = () => {
    if (!viewingCategory) return;
    const newId = Date.now().toString();

    setWorldBookEntries((prev) => [
      ...prev,
      {
        id: newId,
        title: '新条目',
        category: viewingCategory,
        content: '',
        insertPosition: 'BEFORE',
      },
    ]);
    setEditingWorldBookId(newId);
  };

  const deleteWorldBookEntry = (id: string) => {
    clearInsertPositionCommitTimer(id);
    clearInsertPositionVisualState(id);
    setWorldBookEntries((prev) => prev.filter((entry) => entry.id !== id));
    if (editingWorldBookId === id) setEditingWorldBookId(null);
  };

  const reorderEntriesInCategoryPosition = (
    source: WorldBookEntry[],
    category: string,
    insertPosition: InsertPosition,
    draggedId: string,
    targetId: string
  ) => {
    const scopedEntries = source.filter(
      (entry) => entry.category === category && entry.insertPosition === insertPosition
    );

    const fromIndex = scopedEntries.findIndex((entry) => entry.id === draggedId);
    const toIndex = scopedEntries.findIndex((entry) => entry.id === targetId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return source;

    const reorderedScopedEntries = [...scopedEntries];
    const [draggedEntry] = reorderedScopedEntries.splice(fromIndex, 1);
    reorderedScopedEntries.splice(toIndex, 0, draggedEntry);

    let scopedCursor = 0;
    return source.map((entry) => {
      if (entry.category !== category || entry.insertPosition !== insertPosition) {
        return entry;
      }
      const nextEntry = reorderedScopedEntries[scopedCursor];
      scopedCursor += 1;
      return nextEntry;
    });
  };

  const resetEntryDragState = () => {
    dragEntryIdRef.current = null;
    dragOverEntryIdRef.current = null;
    dragInsertPositionRef.current = null;
    dragPointerIdRef.current = null;
    dragInputModeRef.current = null;
    dragTouchIdentifierRef.current = null;
    setDraggingEntryId(null);
    setDragOverEntryId(null);
  };

  const updateDragTargetFromPoint = (clientX: number, clientY: number) => {
    if (!dragEntryIdRef.current || !dragInsertPositionRef.current) return;

    const targetNode = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>('[data-wb-entry-id]');
    if (!targetNode) return;

    const targetId = targetNode.dataset.wbEntryId || '';
    const targetPosition = targetNode.dataset.wbEntryPosition as InsertPosition | undefined;
    if (!targetId || targetPosition !== dragInsertPositionRef.current) return;

    if (dragOverEntryIdRef.current !== targetId) {
      dragOverEntryIdRef.current = targetId;
      setDragOverEntryId(targetId);
    }
  };

  const beginEntryDrag = (entry: WorldBookEntry, event: React.PointerEvent<HTMLButtonElement>) => {
    if (editingWorldBookId === entry.id) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    if (event.cancelable) event.preventDefault();

    dragEntryIdRef.current = entry.id;
    dragOverEntryIdRef.current = entry.id;
    dragInsertPositionRef.current = entry.insertPosition;
    dragPointerIdRef.current = event.pointerId;
    dragInputModeRef.current = 'pointer';
    dragTouchIdentifierRef.current = null;
    setDraggingEntryId(entry.id);
    setDragOverEntryId(entry.id);
    updateDragTargetFromPoint(event.clientX, event.clientY);
  };

  const beginEntryTouchDrag = (entry: WorldBookEntry, event: React.TouchEvent<HTMLButtonElement>) => {
    if (typeof window !== 'undefined' && 'PointerEvent' in window) return;
    if (editingWorldBookId === entry.id) return;

    const touch = event.touches[0];
    if (!touch) return;
    if (event.cancelable) event.preventDefault();

    dragEntryIdRef.current = entry.id;
    dragOverEntryIdRef.current = entry.id;
    dragInsertPositionRef.current = entry.insertPosition;
    dragPointerIdRef.current = null;
    dragInputModeRef.current = 'touch';
    dragTouchIdentifierRef.current = touch.identifier;
    setDraggingEntryId(entry.id);
    setDragOverEntryId(entry.id);
    updateDragTargetFromPoint(touch.clientX, touch.clientY);
  };

  const findTrackedTouch = (touchList: TouchList): Touch | null => {
    const trackedId = dragTouchIdentifierRef.current;
    if (trackedId === null) return touchList.item(0);
    for (let i = 0; i < touchList.length; i += 1) {
      const touch = touchList.item(i);
      if (touch && touch.identifier === trackedId) return touch;
    }
    return null;
  };

  const finishEntryDrag = () => {
    const draggedId = dragEntryIdRef.current;
    const targetId = dragOverEntryIdRef.current;
    const insertPosition = dragInsertPositionRef.current;

    resetEntryDragState();

    if (!viewingCategory || !draggedId || !targetId || !insertPosition || draggedId === targetId) {
      return;
    }

    setWorldBookEntries((prev) =>
      reorderEntriesInCategoryPosition(prev, viewingCategory, insertPosition, draggedId, targetId)
    );
  };

  const cancelEntryDrag = () => {
    resetEntryDragState();
  };

  useEffect(() => {
    if (!draggingEntryId) return;

    if (dragInputModeRef.current === 'touch') {
      const handleTouchMove = (event: TouchEvent) => {
        const touch = findTrackedTouch(event.touches);
        if (!touch) return;
        if (event.cancelable) event.preventDefault();
        updateDragTargetFromPoint(touch.clientX, touch.clientY);
      };

      const handleTouchEnd = (event: TouchEvent) => {
        const touch = findTrackedTouch(event.changedTouches);
        if (!touch) return;
        if (event.cancelable) event.preventDefault();
        finishEntryDrag();
      };

      const handleTouchCancel = (event: TouchEvent) => {
        const touch = findTrackedTouch(event.changedTouches);
        if (!touch) return;
        if (event.cancelable) event.preventDefault();
        cancelEntryDrag();
      };

      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleTouchEnd, { passive: false });
      window.addEventListener('touchcancel', handleTouchCancel, { passive: false });

      return () => {
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);
        window.removeEventListener('touchcancel', handleTouchCancel);
      };
    }

    const handlePointerMove = (event: PointerEvent) => {
      const activePointerId = dragPointerIdRef.current;
      if (activePointerId !== null && event.pointerId !== activePointerId) return;
      if (event.pointerType === 'touch' && event.cancelable) event.preventDefault();
      updateDragTargetFromPoint(event.clientX, event.clientY);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const activePointerId = dragPointerIdRef.current;
      if (activePointerId !== null && event.pointerId !== activePointerId) return;
      if (event.pointerType === 'touch' && event.cancelable) event.preventDefault();
      finishEntryDrag();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const activePointerId = dragPointerIdRef.current;
      if (activePointerId !== null && event.pointerId !== activePointerId) return;
      cancelEntryDrag();
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [draggingEntryId, viewingCategory]);

  if (viewingCategory) {
    const filteredEntries = worldBookEntries.filter((entry) => entry.category === viewingCategory);
    const beforeEntries = filteredEntries.filter((entry) => entry.insertPosition === 'BEFORE');
    const afterEntries = filteredEntries.filter((entry) => entry.insertPosition === 'AFTER');

    const renderEntrySection = (sectionTitle: string, sectionEntries: WorldBookEntry[]) => (
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">{sectionTitle}</h2>
          <span className="text-[11px] text-slate-400">{sectionEntries.length} 条</span>
        </div>

        <div className="space-y-4">
          {sectionEntries.map((entry, index) => {
            const isEditing = editingWorldBookId === entry.id;
            const isDragging = draggingEntryId === entry.id;
            const isDragOver = !isDragging && !!draggingEntryId && dragOverEntryId === entry.id;
            const visualInsertPosition = insertPositionVisualState[entry.id] || entry.insertPosition;

            return (
              <div
                key={entry.id}
                data-wb-entry-id={entry.id}
                data-wb-entry-position={entry.insertPosition}
                className={`${cardClass} p-5 rounded-2xl transition-all ${
                  isEditing ? activeBorderClass : baseBorderClass
                } ${isDragging ? 'opacity-70 scale-[0.99]' : ''} ${isDragOver ? 'ring-2 ring-rose-300/70' : ''}`}
              >
                <div className="flex justify-between items-start mb-2">
                  {!isEditing && (
                    <button
                      type="button"
                      onPointerDown={(event) => beginEntryDrag(entry, event)}
                      onTouchStart={(event) => beginEntryTouchDrag(entry, event)}
                      className={`mr-3 mt-1 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 touch-none select-none cursor-grab active:cursor-grabbing ${btnClass}`}
                      style={{ touchAction: 'none' }}
                      aria-label={`拖动排序 ${entry.title}`}
                    >
                      <GripVertical size={18} />
                    </button>
                  )}

                  <div className="flex-1 mr-4">
                    {isEditing ? (
                      <input
                        type="text"
                        value={entry.title}
                        onChange={(event) => updateWorldBookEntry(entry.id, 'title', event.target.value)}
                        className={`w-full px-4 py-2 text-sm font-bold rounded-lg outline-none mb-2 ${inputClass}`}
                        placeholder="条目标题"
                      />
                    ) : (
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-slate-400 min-w-[2ch]">{index + 1}.</span>
                          <h3 className={`text-lg font-bold ${headingClass}`}>{entry.title}</h3>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded border flex items-center gap-1 font-bold tracking-wide ${
                              entry.insertPosition === 'BEFORE'
                                ? 'bg-transparent text-dreamy-500 border-dreamy-400 dark:text-dreamy-300 dark:border-dreamy-500/50'
                                : 'bg-transparent text-rose-500 border-rose-300 dark:text-rose-300 dark:border-rose-800/50'
                            }`}
                          >
                            {entry.insertPosition === 'BEFORE' ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                            {entry.insertPosition === 'BEFORE' ? '角色定义前' : '角色定义后'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 flex-shrink-0">
                    {isEditing ? (
                      <button
                        onClick={() => setEditingWorldBookId(null)}
                        className={`h-9 px-4 rounded-full flex items-center justify-center text-emerald-500 ${btnClass}`}
                      >
                        <Check size={18} />
                      </button>
                    ) : (
                      <button
                        onClick={() => setEditingWorldBookId(entry.id)}
                        className={`h-9 px-4 rounded-full text-xs text-slate-500 font-medium ${btnClass}`}
                      >
                        编辑
                      </button>
                    )}
                    <button
                      onClick={() => deleteWorldBookEntry(entry.id)}
                      className={`w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 ${btnClass}`}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                {isEditing ? (
                  <div className="space-y-3 mt-2">
                    <textarea
                      value={entry.content}
                      onChange={(event) => updateWorldBookEntry(entry.id, 'content', event.target.value)}
                      className={`w-full p-4 text-sm rounded-xl outline-none resize-none h-40 ${inputClass}`}
                      placeholder="输入具体设定内容..."
                    />
                    <div className="flex items-center justify-between px-2">
                      <span className="text-xs font-bold text-slate-400 uppercase">插入位置</span>
                      <div className={`relative grid grid-cols-2 rounded-lg p-1 overflow-hidden ${isDarkMode ? 'bg-[#1a202c]' : 'neu-pressed'}`}>
                        <div
                          className={`pointer-events-none absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] rounded-md transition-transform duration-300 ${
                            visualInsertPosition === 'AFTER' ? 'translate-x-full' : 'translate-x-0'
                          } ${isDarkMode ? 'bg-slate-600 shadow-[6px_6px_12px_#232b39]' : 'bg-[var(--neu-bg)] shadow-[6px_6px_12px_var(--neu-shadow-dark)]'}`}
                        />
                        <button
                          onClick={() => switchInsertPositionWithSlide(entry.id, visualInsertPosition, 'BEFORE')}
                          className={`relative z-10 px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                            visualInsertPosition === 'BEFORE'
                              ? isDarkMode
                                ? 'text-white'
                                : 'text-rose-400'
                              : 'text-slate-500'
                          }`}
                        >
                          角色定义前
                        </button>
                        <button
                          onClick={() => switchInsertPositionWithSlide(entry.id, visualInsertPosition, 'AFTER')}
                          className={`relative z-10 px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                            visualInsertPosition === 'AFTER'
                              ? isDarkMode
                                ? 'text-white'
                                : 'text-rose-400'
                              : 'text-slate-500'
                          }`}
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

          {sectionEntries.length === 0 && (
            <div className={`${cardClass} p-5 rounded-2xl text-center text-sm text-slate-400`}>暂无条目</div>
          )}
        </div>
      </section>
    );

    return (
      <div
        key={`worldbook-entry-${viewingCategory}`}
        className={`flex-1 flex flex-col p-6 pb-28 overflow-y-auto no-scrollbar relative ${containerClass} ${innerAnimationClass}`}
      >
        <header className="mb-6 pt-2 flex items-center gap-4">
          <button
            onClick={() => switchCategoryView(null)}
            className={`w-10 h-10 rounded-full flex items-center justify-center hover:text-rose-400 transition-colors active:scale-95 ${btnClass}`}
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className={`text-xl font-bold ${headingClass}`}>{viewingCategory}</h1>
            <p className="text-xs text-slate-500 mt-1">同分类下按“角色定义前/后”分组拖拽排序</p>
          </div>
        </header>

        <div className="flex flex-col gap-6">
          {renderEntrySection('角色定义前', beforeEntries)}
          {renderEntrySection('角色定义后', afterEntries)}

          <button
            onClick={addNewWorldBookEntry}
            className={`${cardClass} p-4 text-slate-400 flex items-center justify-center gap-2 hover:text-rose-400 transition-colors border-2 border-dashed border-transparent hover:border-rose-200 rounded-2xl`}
          >
            <Plus size={20} />
            <span className="font-medium">新建条目</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      key="worldbook-category-list"
      className={`flex-1 flex flex-col p-6 pb-28 overflow-y-auto no-scrollbar relative ${containerClass} ${innerAnimationClass}`}
    >
      {renderHeader('世界书分类', onBack)}

      <div className="grid grid-cols-1 gap-4">
        {wbCategories.map((category) => {
          const isRenaming = renamingCategory === category;
          const count = worldBookEntries.filter((entry) => entry.category === category).length;

          return (
            <div
              key={category}
              className={`${cardClass} p-4 rounded-2xl flex items-center justify-between group active:scale-[0.99] transition-transform`}
            >
              <div
                className="flex items-center gap-4 flex-1 cursor-pointer"
                onClick={() => {
                  if (!isRenaming) {
                    switchCategoryView(category);
                  }
                }}
              >
                <div className={`${sectionIconClass} text-rose-400`}>
                  {count > 0 ? <FolderOpen size={24} /> : <Folder size={24} />}
                </div>

                <div className="flex-1">
                  {isRenaming ? (
                    <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                      <input
                        autoFocus
                        type="text"
                        value={tempCategoryName}
                        onChange={(event) => setTempCategoryName(event.target.value)}
                        className={`w-full px-3 py-1 text-sm font-bold rounded-lg outline-none ${inputClass}`}
                        onKeyDown={(event) => event.key === 'Enter' && saveRenamedCategory()}
                      />
                      <button onClick={saveRenamedCategory} className="text-emerald-500">
                        <Check size={18} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <h3 className={`font-bold ${headingClass}`}>{category}</h3>
                      <p className="text-xs text-slate-500">{count} 个条目</p>
                    </>
                  )}
                </div>
              </div>

              {!isRenaming && (
                <div className="flex gap-1 pl-2">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      startRenamingCategory(category);
                    }}
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 ${btnClass}`}
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteCategory(category);
                    }}
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 disabled:opacity-30 ${btnClass}`}
                    disabled={category === DEFAULT_CATEGORY}
                  >
                    <Trash2 size={14} />
                  </button>
                  <button
                    onClick={() => switchCategoryView(category)}
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-rose-400 ${btnClass}`}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <button
          onClick={addNewCategory}
          className={`${cardClass} p-4 text-slate-400 flex items-center justify-center gap-2 hover:text-rose-400 transition-colors border-2 border-dashed border-transparent hover:border-rose-200 rounded-2xl mt-2`}
        >
          <Plus size={20} />
          <span className="font-medium">新建分类</span>
        </button>
      </div>
    </div>
  );
};

export default WorldBookSettings;
