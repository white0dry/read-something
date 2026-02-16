import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Trash2, AlertTriangle, Image as ImageIcon, Link as LinkIcon, Loader2, X, RefreshCw, Save, Edit2, Paintbrush, Wrench, MessageSquareText } from 'lucide-react';
import { ApiPreset, AppSettings, ReaderSummaryCard } from '../types';
import ResolvedImage from './ResolvedImage';
import { DEFAULT_NEUMORPHISM_BUBBLE_CSS_PRESET_ID } from '../utils/readerBubbleCssPresets';
import type { PromptTokenEstimate } from '../utils/readerAiEngine';

export interface ReaderArchiveOption {
  conversationKey: string;
  personaId: string | null;
  personaName: string;
  characterId: string | null;
  characterName: string;
  updatedAt: number;
  isValid: boolean;
  isCurrent: boolean;
}

type TabKey = 'appearance' | 'feature' | 'session';
type ModalType = 'none' | 'book' | 'chat' | 'bgUrl';
const PANEL_VIEW_TRANSITION_MS = 420;
const MODAL_FADE_TRANSITION_MS = 220;

interface Props {
  isDarkMode: boolean;
  isOpen: boolean;
  onClose: () => void;
  safeAreaTop: number;
  safeAreaBottom: number;
  appearanceSettings: AppSettings['readerMore']['appearance'];
  featureSettings: AppSettings['readerMore']['feature'];
  apiPresets: ApiPreset[];
  onUpdateAppearanceSettings: (updater: Partial<AppSettings['readerMore']['appearance']>) => void;
  onUpdateFeatureSettings: (updater: Partial<AppSettings['readerMore']['feature']>) => void;
  onUploadChatBackgroundImage: (file: File) => Promise<void>;
  onSetChatBackgroundImageFromUrl: (url: string) => void;
  onClearChatBackgroundImage: () => void;
  onApplyBubbleCssDraft: () => void;
  onSaveBubbleCssPreset: (name: string) => void;
  onDeleteBubbleCssPreset: (presetId: string) => void;
  onRenameBubbleCssPreset: (presetId: string, name: string) => void;
  onSelectBubbleCssPreset: (presetId: string | null) => void;
  onClearBubbleCssDraft: () => void;
  onResetAppearanceSettings: () => void;
  onResetFeatureSettings: () => void;
  archiveOptions: ReaderArchiveOption[];
  onSelectArchive: (archive: ReaderArchiveOption) => void;
  onDeleteArchive?: (conversationKey: string) => void;
  bookSummaryCards: ReaderSummaryCard[];
  chatSummaryCards: ReaderSummaryCard[];
  onEditBookSummaryCard: (cardId: string, content: string) => void;
  onDeleteBookSummaryCard: (cardId: string) => void;
  onEditChatSummaryCard: (cardId: string, content: string) => void;
  onDeleteChatSummaryCard: (cardId: string) => void;
  onMergeBookSummaryCards: (cardIds: string[]) => void;
  onMergeChatSummaryCards: (cardIds: string[]) => void;
  onRequestManualBookSummary: (start: number, end: number) => void;
  onRequestManualChatSummary: (start: number, end: number) => void;
  currentReadCharOffset: number;
  totalBookChars: number;
  totalMessages: number;
  summaryTaskRunning: boolean;
  sessionPromptTokenEstimate: PromptTokenEstimate;
}

const TAB_ITEMS: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { key: 'appearance', label: '美化', icon: Paintbrush },
  { key: 'feature', label: '功能', icon: Wrench },
  { key: 'session', label: '会话', icon: MessageSquareText },
];
const TAB_ORDER: TabKey[] = ['appearance', 'feature', 'session'];
const BUBBLE_CSS_PLACEHOLDER = [
  '可自定义类名：',
  '.rm-bubble',
  '.rm-bubble-user',
  '.rm-bubble-ai',
  '',
  '示意代码，不会自动生效：',
  '.rm-bubble-user {',
  '  background: #ffdbe5;',
  '  color: #7a2941;',
  '  border: 1px solid rgba(190,83,107,0.35);',
  '  border-radius: 22px 22px 8px 22px;',
  '  box-shadow: 6px 6px 12px rgba(163,177,198,0.35), -4px -4px 10px rgba(255,255,255,0.65);',
  '}',
  '',
  '.rm-bubble-ai {',
  '  background: #f4f7fb;',
  '  color: #334155;',
  '  border: 1px solid rgba(148,163,184,0.4);',
  '  border-radius: 22px 22px 22px 8px;',
  '  box-shadow: inset 1px 1px 0 rgba(255,255,255,0.75), 6px 6px 12px rgba(163,177,198,0.28);',
  '}',
].join('\n');

const mapDraftCssToPreview = (css: string) =>
  css
    .replace(/\.reader-message-scroll\b/g, '.rm-bubble-preview-scroll')
    .replace(/\.rm-bubble-ai\b/g, '.rm-preview-bubble-ai')
    .replace(/\.rm-bubble-user\b/g, '.rm-preview-bubble-user')
    .replace(/\.rm-bubble\b/g, '.rm-preview-bubble');

const clampInt = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? Math.round(value) : min));

const normalizeLooseInt = (raw: string) => {
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
};

const stabilizeScrollBoundary = (el: HTMLDivElement) => {
  if (el.scrollHeight <= el.clientHeight + 1) {
    if (el.scrollTop !== 0) el.scrollTop = 0;
    return;
  }
  if (el.scrollTop <= 0) {
    el.scrollTop = 1;
    return;
  }
  const maxScrollTop = Math.max(1, el.scrollHeight - el.clientHeight - 1);
  if (el.scrollTop >= maxScrollTop) {
    el.scrollTop = maxScrollTop;
  }
};

const ts = (v: number) =>
  new Date(v).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

const Toggle = ({
  checked,
  onClick,
  pressedClass,
  activeClass,
}: {
  checked: boolean;
  onClick: () => void;
  pressedClass: string;
  activeClass: string;
}) => (
  <button type="button" onClick={onClick} className={`w-14 h-8 rounded-full p-1 flex items-center transition-all ${pressedClass} ${activeClass}`}>
    <div className={`w-6 h-6 rounded-full shadow-sm flex items-center justify-center transition-all transform duration-300 ${checked ? 'translate-x-6 bg-rose-400' : 'translate-x-0 bg-slate-400'}`} />
  </button>
);

// SingleSelectDropdown Component (简化版从ApiSettings.tsx提取)
interface OptionItem {
  value: string;
  label: string;
}

const SingleSelectDropdown = ({
  options,
  value,
  onChange,
  placeholder = "选择...",
  inputClass,
  cardClass,
  isDarkMode,
  disabled = false
}: {
  options: OptionItem[],
  value: string,
  onChange: (val: string) => void,
  placeholder?: string,
  inputClass: string,
  cardClass: string,
  isDarkMode: boolean,
  disabled?: boolean
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(o => o.value === value) || (value ? { value: value, label: value } : null);

  return (
    <div className={`relative ${disabled ? 'opacity-50 pointer-events-none' : ''}`} ref={containerRef}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full p-2 min-h-[42px] rounded-xl flex items-center justify-between cursor-pointer transition-all active:scale-[0.99] ${inputClass}`}
      >
        <div className="flex items-center gap-2 px-2">
          {selectedOption ? (
            <span className={`text-sm font-medium truncate ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>
              {selectedOption.label}
            </span>
          ) : (
            <span className="text-sm opacity-50">{placeholder}</span>
          )}
        </div>
        <div className="opacity-50 pr-2">
           <ChevronDown size={16} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {isOpen && (
        <div className={`absolute top-full left-0 right-0 mt-2 p-2 rounded-xl z-[50] max-h-60 overflow-y-auto ${cardClass} border border-slate-400/10 animate-fade-in shadow-2xl`}>
          {options.length > 0 ? options.map(opt => {
            const isSelected = opt.value === value;
            return (
              <div
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`flex items-center gap-2 p-2 rounded-lg text-sm cursor-pointer transition-colors ${
                  isSelected
                    ? 'text-rose-400 font-bold bg-rose-400/10'
                    : isDarkMode ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                 <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-rose-400 border-rose-400' : 'border-slate-400'}`}>
                    {isSelected && <Check size={10} className="text-white" />}
                 </div>
                 <span className="truncate">{opt.label}</span>
              </div>
            );
          }) : (
            <div className="p-2 text-xs text-slate-400 text-center">无可用选项</div>
          )}
        </div>
      )}
    </div>
  );
};

const LooseNumberInput = ({
  value,
  onCommit,
  className,
}: {
  value: number;
  onCommit: (value: number) => void;
  className: string;
}) => {
  const [draft, setDraft] = useState(`${value}`);

  useEffect(() => {
    setDraft(`${value}`);
  }, [value]);

  const commit = () => {
    const normalized = normalizeLooseInt(draft);
    onCommit(normalized);
    setDraft(`${normalized}`);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        commit();
        e.currentTarget.blur();
      }}
      className={className}
    />
  );
};

const ReaderMoreSettingsPanel: React.FC<Props> = (props) => {
  const {
    isDarkMode,
    isOpen,
    onClose,
    safeAreaTop,
    safeAreaBottom,
    appearanceSettings,
    featureSettings,
    apiPresets,
    onUpdateAppearanceSettings,
    onUpdateFeatureSettings,
    onUploadChatBackgroundImage,
    onSetChatBackgroundImageFromUrl,
    onClearChatBackgroundImage,
    onApplyBubbleCssDraft,
    onSaveBubbleCssPreset,
    onDeleteBubbleCssPreset,
    onRenameBubbleCssPreset,
    onSelectBubbleCssPreset,
    onClearBubbleCssDraft,
    onResetAppearanceSettings,
    onResetFeatureSettings,
    archiveOptions,
    onSelectArchive,
    onDeleteArchive,
    bookSummaryCards,
    chatSummaryCards,
    onEditBookSummaryCard,
    onDeleteBookSummaryCard,
    onEditChatSummaryCard,
    onDeleteChatSummaryCard,
    onMergeBookSummaryCards,
    onMergeChatSummaryCards,
    onRequestManualBookSummary,
    onRequestManualChatSummary,
    currentReadCharOffset,
    totalBookChars,
    totalMessages,
    summaryTaskRunning,
    sessionPromptTokenEstimate,
  } = props;

  const [tab, setTab] = useState<TabKey>('appearance');
  const [tabDirection, setTabDirection] = useState<'left' | 'right'>('right');
  const [rendered, setRendered] = useState(isOpen);
  const [closing, setClosing] = useState(false);
  const [modal, setModal] = useState<ModalType>('none');
  const [modalClosing, setModalClosing] = useState(false);
  const [bgUrlInput, setBgUrlInput] = useState('');
  const [presetName, setPresetName] = useState('');
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [bookRangeDraft, setBookRangeDraft] = useState({ start: '1', end: '1' });
  const [chatRangeDraft, setChatRangeDraft] = useState({ start: '1', end: '1' });
  const [selectedBookSummaryCardIds, setSelectedBookSummaryCardIds] = useState<string[]>([]);
  const [selectedChatSummaryCardIds, setSelectedChatSummaryCardIds] = useState<string[]>([]);
  const closeTimerRef = useRef<number | null>(null);
  const modalCloseTimerRef = useRef<number | null>(null);
  const prevModalRef = useRef<ModalType>('none');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const contentTouchStartYRef = useRef(0);

  useEffect(() => {
    if (isOpen) {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      setRendered(true);
      setClosing(false);
      return;
    }
    if (!rendered) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      if (modalCloseTimerRef.current) window.clearTimeout(modalCloseTimerRef.current);
      setRendered(false);
      setClosing(false);
      setModalClosing(false);
      setModal('none');
    }, PANEL_VIEW_TRANSITION_MS);
  }, [isOpen, rendered]);

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    if (modalCloseTimerRef.current) window.clearTimeout(modalCloseTimerRef.current);
  }, []);
  useEffect(() => {
    const prevModal = prevModalRef.current;
    prevModalRef.current = modal;
    if (modal === 'book' && prevModal !== 'book') {
      const end = Math.max(1, Math.floor(currentReadCharOffset || 0));
      setBookRangeDraft({ start: '1', end: `${end}` });
      setSelectedBookSummaryCardIds([]);
      return;
    }
    if (modal === 'chat' && prevModal !== 'chat') {
      const end = Math.max(1, Math.floor(totalMessages || 0));
      setChatRangeDraft({ start: '1', end: `${end}` });
      setSelectedChatSummaryCardIds([]);
    }
  }, [modal, currentReadCharOffset, totalMessages]);

  useEffect(() => {
    const cardIdSet = new Set(bookSummaryCards.map((card) => card.id));
    setSelectedBookSummaryCardIds((prev) => prev.filter((id) => cardIdSet.has(id)));
  }, [bookSummaryCards]);

  useEffect(() => {
    const cardIdSet = new Set(chatSummaryCards.map((card) => card.id));
    setSelectedChatSummaryCardIds((prev) => prev.filter((id) => cardIdSet.has(id)));
  }, [chatSummaryCards]);

  const defaultBubblePreset = useMemo(
    () =>
      appearanceSettings.bubbleCssPresets.find((item) => item.id === DEFAULT_NEUMORPHISM_BUBBLE_CSS_PRESET_ID)
      || appearanceSettings.bubbleCssPresets[0]
      || null,
    [appearanceSettings.bubbleCssPresets]
  );
  const selectedPreset = useMemo(() => {
    const explicit = appearanceSettings.bubbleCssPresets.find((x) => x.id === appearanceSettings.selectedBubbleCssPresetId) || null;
    return explicit || defaultBubblePreset;
  }, [appearanceSettings.bubbleCssPresets, appearanceSettings.selectedBubbleCssPresetId, defaultBubblePreset]);
  const selectedBubblePresetId = selectedPreset?.id || defaultBubblePreset?.id || '';
  const isDefaultBubblePresetSelected = selectedPreset?.id === DEFAULT_NEUMORPHISM_BUBBLE_CSS_PRESET_ID;
  const previewBubbleCss = useMemo(
    () => mapDraftCssToPreview(appearanceSettings.bubbleCssDraft || ''),
    [appearanceSettings.bubbleCssDraft]
  );
  const summaryApiPresetOptions = useMemo(() => {
    return apiPresets
      .map((preset, index) => {
        const value = `${preset.id || ''}`.trim();
        const label = typeof preset.name === 'string' && preset.name.trim()
          ? preset.name.trim()
          : `预设 ${index + 1}`;
        if (!value) return null;
        return { value, label };
      })
      .filter((item): item is { value: string; label: string } => Boolean(item));
  }, [apiPresets]);
  const summaryApiPresetValue = useMemo(() => {
    const id = `${featureSettings.summaryApiPresetId || ''}`.trim();
    if (!id) return '';
    return summaryApiPresetOptions.some((preset) => preset.value === id) ? id : '';
  }, [summaryApiPresetOptions, featureSettings.summaryApiPresetId]);
  const cardClass = isDarkMode
    ? 'bg-[#2d3748] shadow-[6px_6px_12px_#232b39,-6px_-6px_12px_#374357]'
    : 'bg-[#e0e5ec] shadow-[6px_6px_12px_#a3b1c6,-6px_-6px_12px_#ffffff]';
  const raisedCardClass = isDarkMode ? 'bg-[#2d3748] shadow-[6px_6px_12px_#232b39,-6px_-6px_12px_#374357]' : 'neu-flat';
  const pressedClass = isDarkMode
    ? 'bg-[#2d3748] shadow-[inset_5px_5px_10px_#232b39,inset_-5px_-5px_10px_#374357]'
    : 'bg-[#e0e5ec] shadow-[inset_5px_5px_10px_#a3b1c6,inset_-5px_-5px_10px_#ffffff]';
  const btnClass = isDarkMode
    ? 'bg-[#2d3748] shadow-[5px_5px_10px_#232b39,-5px_-5px_10px_#374357] text-slate-200'
    : 'bg-[#e0e5ec] shadow-[5px_5px_10px_#a3b1c6,-5px_-5px_10px_#ffffff] text-slate-700';
  const inputClass = isDarkMode
    ? 'bg-[#2d3748] shadow-[inset_4px_4px_8px_#232b39,inset_-4px_-4px_8px_#374357] text-slate-200 placeholder-slate-500'
    : 'bg-[#e0e5ec] shadow-[inset_4px_4px_8px_#a3b1c6,inset_-4px_-4px_8px_#ffffff] text-slate-600 placeholder-slate-400';
  const headingClass = isDarkMode ? 'text-slate-200' : 'text-slate-700';
  const panelMainCardBaseClass = isDarkMode ? 'bg-[#2d3748]' : 'bg-[#e0e5ec]';
  const panelSurfaceShadowClass = isDarkMode
    ? 'shadow-[4px_6px_12px_rgba(35,43,57,0.28),-4px_6px_12px_rgba(35,43,57,0.28)]'
    : 'shadow-[4px_6px_12px_rgba(163,177,198,0.28),-4px_6px_12px_rgba(163,177,198,0.28)]';
  const tabSideShadowClass = isDarkMode
    ? 'shadow-[6px_7px_14px_rgba(35,43,57,0.36),-6px_7px_14px_rgba(35,43,57,0.36)]'
    : 'shadow-[6px_7px_14px_rgba(163,177,198,0.36),-6px_7px_14px_rgba(163,177,198,0.36)]';
  const tabTopSoftShadowClass = isDarkMode
    ? 'shadow-[0_-4px_10px_rgba(35,43,57,0.28)]'
    : 'shadow-[0_-4px_10px_rgba(163,177,198,0.28)]';
  const panelMainCardShadowClass = panelSurfaceShadowClass;
  const tabActivePlateClass = `${panelMainCardBaseClass} ${tabSideShadowClass} ${tabTopSoftShadowClass}`;
  const activeBtnClass = isDarkMode
    ? 'active:shadow-[inset_3px_3px_6px_#232b39,inset_-3px_-3px_6px_#374357] active:translate-y-px'
    : 'active:shadow-[inset_3px_3px_6px_#a3b1c6,inset_-3px_-3px_6px_#ffffff] active:translate-y-px';
  const iconDangerEnabledClass = isDarkMode ? 'text-[#cf8f97]' : 'text-[#bf616b]';
  const iconDisabledGrayClass = isDarkMode ? 'text-slate-500' : 'text-slate-400';
  const disabledIconButtonClass = `${btnClass} ${iconDisabledGrayClass} opacity-55 cursor-not-allowed`;
  const enabledDangerIconButtonClass = `${iconDangerEnabledClass} ${btnClass} ${activeBtnClass}`;
  const archiveCardDefaultClass = isDarkMode ? 'bg-[#1a202c] text-slate-200' : 'bg-white text-slate-700';
  const archiveCardCurrentClass = isDarkMode
    ? 'bg-rose-500/20 text-slate-100 border border-rose-300/40'
    : 'bg-rose-200 text-slate-700 border border-rose-400/60';
  const archiveWarningIconClass = isDarkMode ? 'text-amber-300/90' : 'text-amber-600/85';
  const activeTabIndex = TAB_ORDER.indexOf(tab);
  const tabContentAnimClass = tabDirection === 'right' ? 'stats-slide-left' : 'stats-slide-right';
  const panelMotionStyle = { animationDuration: `${PANEL_VIEW_TRANSITION_MS}ms` } as const;

  const handleTabChange = (newTab: TabKey) => {
    if (newTab === tab) return;
    const oldIndex = TAB_ORDER.indexOf(tab);
    const newIndex = TAB_ORDER.indexOf(newTab);
    setTabDirection(newIndex > oldIndex ? 'right' : 'left');
    setTab(newTab);
  };

  const numInput = (value: number, onChange: (v: number) => void) => (
    <LooseNumberInput
      value={value}
      onCommit={onChange}
      className={`w-14 h-8 rounded-lg px-2 text-xs text-right outline-none [appearance:textfield] ${inputClass}`}
    />
  );
  const openModal = (nextModal: Exclude<ModalType, 'none'>) => {
    if (modalCloseTimerRef.current) window.clearTimeout(modalCloseTimerRef.current);
    setModalClosing(false);
    setModal(nextModal);
  };
  const closeModal = () => {
    if (modal === 'none') return;
    if (modalCloseTimerRef.current) window.clearTimeout(modalCloseTimerRef.current);
    setModalClosing(true);
    modalCloseTimerRef.current = window.setTimeout(() => {
      setModal('none');
      setModalClosing(false);
    }, MODAL_FADE_TRANSITION_MS);
  };

  useEffect(() => {
    if (!rendered || !isOpen) return;
    const el = contentScrollRef.current;
    if (!el) return;
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      stabilizeScrollBoundary(el);
      contentTouchStartYRef.current = touch.clientY;
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      const isScrollable = el.scrollHeight > el.clientHeight + 1;
      if (!isScrollable) {
        if (event.cancelable) event.preventDefault();
        return;
      }
      const deltaY = touch.clientY - contentTouchStartYRef.current;
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if ((atTop && deltaY > 0) || (atBottom && deltaY < 0)) {
        if (event.cancelable) event.preventDefault();
      }
    };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
    };
  }, [rendered, isOpen]);

  const renderSummaryModal = () => {
    if (modal !== 'book' && modal !== 'chat') return null;
    const isBook = modal === 'book';
    const cards = isBook ? bookSummaryCards : chatSummaryCards;
    const onEdit = isBook ? onEditBookSummaryCard : onEditChatSummaryCard;
    const onDelete = isBook ? onDeleteBookSummaryCard : onDeleteChatSummaryCard;
    const onMergeCards = isBook ? onMergeBookSummaryCards : onMergeChatSummaryCards;
    const selectedCardIds = isBook ? selectedBookSummaryCardIds : selectedChatSummaryCardIds;
    const setSelectedCardIds = isBook ? setSelectedBookSummaryCardIds : setSelectedChatSummaryCardIds;
    const selectedIdSet = new Set(selectedCardIds);
    const startDraft = isBook ? bookRangeDraft.start : chatRangeDraft.start;
    const endDraft = isBook ? bookRangeDraft.end : chatRangeDraft.end;
    const commitRangeField = (field: 'start' | 'end') => {
      if (isBook) {
        const source = field === 'start' ? bookRangeDraft.start : bookRangeDraft.end;
        const normalized = normalizeLooseInt(source);
        setBookRangeDraft((prev) => ({ ...prev, [field]: `${normalized}` }));
        return;
      }
      const source = field === 'start' ? chatRangeDraft.start : chatRangeDraft.end;
      const normalized = normalizeLooseInt(source);
      setChatRangeDraft((prev) => ({ ...prev, [field]: `${normalized}` }));
    };
    const trigger = () => {
      const rawStart = normalizeLooseInt(startDraft);
      const rawEnd = normalizeLooseInt(endDraft);
      const s = Math.min(rawStart, rawEnd);
      const e = Math.max(rawStart, rawEnd);
      if (isBook) {
        setBookRangeDraft({ start: `${rawStart}`, end: `${rawEnd}` });
      } else {
        setChatRangeDraft({ start: `${rawStart}`, end: `${rawEnd}` });
      }
      if (isBook) onRequestManualBookSummary(s, e);
      else onRequestManualChatSummary(s, e);
    };
    const toggleCardSelected = (cardId: string) => {
      setSelectedCardIds((prev) =>
        prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId]
      );
    };
    const mergeSelectedCards = () => {
      if (selectedCardIds.length < 2) return;
      onMergeCards(selectedCardIds);
      setSelectedCardIds([]);
    };
    return (
      <div className={`fixed inset-0 z-[95] flex items-center justify-center p-6 ${modalClosing ? 'app-fade-exit' : 'app-fade-enter'}`}>
        <button type="button" className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={closeModal} />
        <div className={`relative w-full max-w-2xl max-h-[80vh] rounded-3xl p-5 flex flex-col ${isDarkMode ? 'bg-[#2d3748] border-slate-600' : 'bg-[#e0e5ec] border-white/50'} border shadow-2xl ${modalClosing ? 'app-fade-exit' : 'app-fade-enter'}`}>
          <div className="flex items-center justify-between mb-4">
            <div className={`text-lg font-bold ${headingClass}`}>{isBook ? '书籍内容总结' : '聊天记录总结'}</div>
            <button type="button" onClick={closeModal} className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-rose-400 transition-colors ${btnClass} ${activeBtnClass}`}>
              <X size={18} />
            </button>
          </div>
          <div className={`rounded-2xl p-4 ${pressedClass}`}>
            <div className="text-xs text-slate-500 mb-3">
              {isBook ? `当前阅读：${currentReadCharOffset}` : `当前消息总数：${totalMessages}`}
            </div>
            <div className="w-full max-w-sm mx-auto flex items-center gap-2 mb-3">
              <input type="text" inputMode="decimal" value={startDraft}
                onChange={(e) => isBook ? setBookRangeDraft((p) => ({ ...p, start: e.target.value })) : setChatRangeDraft((p) => ({ ...p, start: e.target.value }))}
                onBlur={() => commitRangeField('start')}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  commitRangeField('start');
                  e.currentTarget.blur();
                }}
                className={`min-w-0 flex-1 h-10 rounded-xl px-3 text-sm outline-none ${inputClass}`} />
              <span className="w-5 text-center text-slate-500">—</span>
              <input type="text" inputMode="decimal" value={endDraft}
                onChange={(e) => isBook ? setBookRangeDraft((p) => ({ ...p, end: e.target.value })) : setChatRangeDraft((p) => ({ ...p, end: e.target.value }))}
                onBlur={() => commitRangeField('end')}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  commitRangeField('end');
                  e.currentTarget.blur();
                }}
                className={`min-w-0 flex-1 h-10 rounded-xl px-3 text-sm outline-none ${inputClass}`} />
            </div>
            <button type="button" onClick={trigger} disabled={summaryTaskRunning}
              className={`w-full h-10 rounded-xl text-sm font-bold flex items-center justify-center gap-2 text-white bg-rose-400 shadow-lg hover:bg-rose-500 active:scale-95 transition-all disabled:opacity-50 disabled:active:scale-100 ${summaryTaskRunning ? 'cursor-not-allowed' : ''}`}>
              {summaryTaskRunning && <Loader2 size={14} className="animate-spin" />}
              {summaryTaskRunning ? '处理中...' : '手动总结'}
            </button>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
              <span>已选中 {selectedCardIds.length} 张卡片</span>
              <button
                type="button"
                onClick={mergeSelectedCards}
                disabled={selectedCardIds.length < 2}
                className={`h-8 px-3 rounded-full text-xs font-bold transition-all ${
                  selectedCardIds.length >= 2
                    ? `text-rose-400 ${btnClass} ${activeBtnClass}`
                    : disabledIconButtonClass
                }`}
              >
                合并选中卡片
              </button>
            </div>
          </div>
          <div className="mt-4 flex-1 overflow-y-auto no-scrollbar px-4 py-4">
            <div className="space-y-5">
              {cards.length === 0 && <div className="text-xs text-slate-500 text-center py-10">暂无总结卡片</div>}
              {cards.map((card) => {
                const isCardSelected = selectedIdSet.has(card.id);
                const selectedCheckboxStyle = isCardSelected
                  ? {
                      backgroundColor: 'rgb(var(--theme-400) / 1)',
                      borderColor: 'rgb(var(--theme-400) / 1)',
                    }
                  : undefined;
                return (
                <div key={card.id} className={`rounded-2xl p-4 ${raisedCardClass} ${isCardSelected ? 'ring-2 ring-rose-300/80' : ''}`}>
                  <div className="mb-3 flex justify-center">
                    <button
                      type="button"
                      onClick={() => toggleCardSelected(card.id)}
                      className={`h-8 px-3 rounded-full text-xs font-bold flex items-center justify-center gap-2 transition-all ${btnClass} ${activeBtnClass} !text-slate-500`}
                    >
                      <span className={`w-4 h-4 rounded border flex items-center justify-center ${
                        isCardSelected ? 'text-white' : 'border-slate-400'
                      }`} style={selectedCheckboxStyle}>
                        {isCardSelected && <Check size={10} />}
                      </span>
                      {isCardSelected ? '已选' : '选择'}
                    </button>
                  </div>
                  <textarea defaultValue={card.content} onBlur={(e) => onEdit(card.id, e.target.value)}
                    className={`w-full min-h-[96px] rounded-xl p-3 text-sm outline-none resize-y ${inputClass}`} />
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                    <span>{isBook ? `字符区间` : `消息区间`}：{card.start}-{card.end}</span>
                    <div className="flex items-center gap-2">
                      <span>{ts(card.updatedAt)}</span>
                      <button type="button" onClick={() => onDelete(card.id)} className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${enabledDangerIconButtonClass}`}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              )})}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderBgUrlModal = () => {
    if (modal !== 'bgUrl') return null;
    return (
      <div className={`fixed inset-0 z-[95] flex items-center justify-center p-6 ${modalClosing ? 'app-fade-exit' : 'app-fade-enter'}`}>
        <button type="button" className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={closeModal} />
        <div className={`relative w-full max-w-md rounded-2xl p-6 ${isDarkMode ? 'bg-[#2d3748] border-slate-600' : 'bg-[#e0e5ec] border-white/50'} border shadow-2xl ${modalClosing ? 'app-fade-exit' : 'app-fade-enter'}`}>
          <button type="button" onClick={closeModal} className={`absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-rose-400 transition-colors ${btnClass} ${activeBtnClass}`}>
            <X size={18} />
          </button>
          <h3 className={`text-lg font-bold mb-6 ${headingClass}`}>输入网络链接</h3>
          <input
            type="text"
            value={bgUrlInput}
            onChange={(e) => setBgUrlInput(e.target.value)}
            placeholder="https://example.com/image.png"
            className={`w-full h-12 px-4 rounded-xl text-sm outline-none mb-4 ${inputClass}`}
          />
          <div className="flex gap-3">
            <button onClick={closeModal} className={`flex-1 h-11 rounded-full text-slate-500 text-sm font-bold ${btnClass} ${activeBtnClass} transition-all`}>
              取消
            </button>
            <button
              onClick={() => {
                onSetChatBackgroundImageFromUrl(bgUrlInput.trim());
                closeModal();
                setBgUrlInput('');
              }}
              disabled={!bgUrlInput.trim()}
              className={`flex-1 h-11 rounded-full text-white bg-rose-400 shadow-lg hover:bg-rose-500 text-sm font-bold disabled:opacity-50 ${activeBtnClass} transition-all`}
            >
              确认
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (!rendered) return null;

  return (
    <>
      <div
        className={`absolute inset-0 z-[90] ${isDarkMode ? 'bg-[#2d3748]' : 'bg-[#e0e5ec]'}`}
        style={{
          paddingTop: `${Math.max(0, safeAreaTop || 0)}px`,
          paddingBottom: `${Math.max(0, safeAreaBottom || 0)}px`,
        }}
      >
        <div className={`h-full overflow-hidden overscroll-none ${closing ? 'app-view-exit-right' : 'app-view-enter-left'} ${isDarkMode ? 'bg-[#2d3748]' : 'bg-[#e0e5ec]'}`} style={panelMotionStyle}>
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className={`flex items-center gap-3 p-4 z-10 transition-colors ${isDarkMode ? 'bg-[#2d3748]' : 'bg-[#e0e5ec]'}`}>
              <button type="button" onClick={onClose} className={`w-10 h-10 rounded-full flex items-center justify-center hover:text-rose-400 transition-colors ${btnClass} ${activeBtnClass}`}>
                <ArrowLeft size={18} />
              </button>
              <div className={`text-base font-bold ${headingClass}`}>更多设置</div>
            </div>

            {/* Bookmark-style Tabs */}
            <div className="px-4 pt-2 pb-0">
              <div className="relative grid grid-cols-3 overflow-visible">
                <div
                  className="absolute inset-y-0 left-0 w-1/3 pointer-events-none transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{ transform: `translateX(${Math.max(0, activeTabIndex) * 100}%)` }}
                >
                  <div className={`h-11 rounded-t-2xl ${tabActivePlateClass}`} />
                </div>
                {TAB_ITEMS.map((it) => (
                  <button
                    key={it.key}
                    type="button"
                    onClick={() => handleTabChange(it.key)}
                    className={`relative z-10 h-11 text-sm font-bold rounded-t-2xl transition-all flex items-center justify-center gap-1.5 ${
                      tab === it.key
                        ? (isDarkMode ? 'text-rose-300' : 'text-rose-500')
                        : 'bg-transparent text-slate-400 hover:text-slate-300'
                    }`}
                  >
                    <it.icon size={16} />
                    <span>{it.label}</span>
                    {tab === it.key && (
                      <div className={`absolute bottom-0 left-0 right-0 h-1 ${isDarkMode ? 'bg-[#2d3748]' : 'bg-[#e0e5ec]'}`} />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Content Area */}
            <div
              ref={contentScrollRef}
              className="flex-1 min-h-0 overflow-y-auto overscroll-none no-scrollbar px-4 pb-6"
              style={{ overscrollBehaviorY: 'none', WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
            >
              <div className={closing ? 'app-view-exit-right' : 'app-view-enter-left'} style={panelMotionStyle}>
                <div key={tab} className={tabContentAnimClass}>
                  <div className={`rounded-t-none rounded-b-2xl p-4 ${panelMainCardBaseClass} ${panelMainCardShadowClass}`}>
                {tab === 'appearance' && (
                  <div className="space-y-0">
                    {/* 气泡字体大小 */}
                    <div className="py-5">
                      <div className={`text-sm font-bold mb-3 ${headingClass}`}>气泡字体大小</div>
                      <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                        <span>缩放比例</span>
                        <span>{Math.round(appearanceSettings.bubbleFontSizeScale * 100)}%</span>
                      </div>
                      <div className="relative h-2">
                        <div className={`absolute inset-0 rounded-full ${isDarkMode ? 'bg-slate-700' : 'bg-black/5'}`} />
                        <div className="absolute inset-y-0 left-0 rounded-full bg-rose-300" style={{ width: `${((Math.round(appearanceSettings.bubbleFontSizeScale * 100) - 70) / 180) * 100}%` }} />
                        <input type="range" min="70" max="250" step="5" value={Math.round(appearanceSettings.bubbleFontSizeScale * 100)}
                          onChange={(e) => onUpdateAppearanceSettings({ bubbleFontSizeScale: clampInt(Number(e.target.value || '100'), 70, 250) / 100 })}
                          className="app-range absolute top-1/2 -translate-y-1/2 left-0 w-full h-5 bg-transparent appearance-none cursor-pointer z-10" />
                      </div>
                    </div>

                    <div className="w-full h-[1px] bg-slate-300/20 my-0" />

                    {/* 聊天背景图片 */}
                    <div className="py-5">
                      <div className={`text-sm font-bold mb-3 ${headingClass}`}>聊天背景图片</div>
                      <div className={`mb-3 aspect-square rounded-2xl overflow-hidden border border-slate-300/20 ${pressedClass}`}>
                        {appearanceSettings.chatBackgroundImage ? (
                          <ResolvedImage src={appearanceSettings.chatBackgroundImage} alt="bg" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <ImageIcon size={44} className={isDarkMode ? 'text-slate-500' : 'text-slate-400'} />
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => fileInputRef.current?.click()} className={`flex-1 h-10 rounded-xl text-sm flex items-center justify-center gap-2 ${btnClass} ${activeBtnClass} transition-all`}>
                          <ImageIcon size={16} />
                          <span>本地上传</span>
                        </button>
                        <button type="button" onClick={() => openModal('bgUrl')} className={`flex-1 h-10 rounded-xl text-sm flex items-center justify-center gap-2 ${btnClass} ${activeBtnClass} transition-all`}>
                          <LinkIcon size={16} />
                          <span>网络链接</span>
                        </button>
                        <button
                          type="button"
                          onClick={onClearChatBackgroundImage}
                          disabled={!appearanceSettings.chatBackgroundImage}
                          className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                            appearanceSettings.chatBackgroundImage
                              ? enabledDangerIconButtonClass
                              : disabledIconButtonClass
                          }`}
                        >
                          <Trash2 size={16} />
                        </button>
                        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ''; if (f) void onUploadChatBackgroundImage(f); }} />
                      </div>
                    </div>

                    <div className="w-full h-[1px] bg-slate-300/20 my-0" />

                    {/* 时间显示 */}
                    <div className="py-5">
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-bold ${headingClass}`}>时间显示</span>
                        <Toggle checked={appearanceSettings.showMessageTime} onClick={() => onUpdateAppearanceSettings({ showMessageTime: !appearanceSettings.showMessageTime })} pressedClass={pressedClass} activeClass={activeBtnClass} />
                      </div>
                    </div>

                    <div className="w-full h-[1px] bg-slate-300/20 my-0" />

                    {/* 自定义气泡 CSS */}
                    <div className="py-5">
                      <div className={`text-sm font-bold mb-3 ${headingClass}`}>自定义气泡 CSS</div>
                      <textarea
                        value={appearanceSettings.bubbleCssDraft}
                        onChange={(e) => {
                          const nextDraft = e.target.value;
                          if (nextDraft.length === 0 && defaultBubblePreset) {
                            onUpdateAppearanceSettings({
                              bubbleCssDraft: defaultBubblePreset.css,
                              selectedBubbleCssPresetId: defaultBubblePreset.id,
                            });
                            return;
                          }
                          onUpdateAppearanceSettings({ bubbleCssDraft: nextDraft });
                        }}
                        placeholder={BUBBLE_CSS_PLACEHOLDER}
                        className={`w-full min-h-[120px] rounded-xl p-3 text-xs outline-none resize-y ${inputClass} mb-3`}
                      />
                      <style>{previewBubbleCss}</style>

                      {/* 预览区域 - 添加凹陷边框和字体缩放 */}
                      <div className={`rm-bubble-preview rm-bubble-preview-scroll overflow-hidden rounded-xl p-3 mb-3 ${pressedClass}`}>
                        <div className="space-y-2" style={{ fontSize: `${14 * appearanceSettings.bubbleFontSizeScale}px` }}>
                          <div className="flex justify-start">
                            <div className={`rm-preview-bubble rm-preview-bubble-ai max-w-[86%] rounded-2xl rounded-bl px-5 py-3 border-none ${
                              isDarkMode
                                ? 'bg-[#1a202c] text-slate-300 shadow-md'
                                : 'bg-[#e0e5ec] shadow-[5px_5px_10px_#c3c8ce,-5px_-5px_10px_#fdffff] text-slate-700'
                            }`}>
                              AI 气泡预览
                            </div>
                          </div>
                          <div className="flex justify-end">
                            <div className={`rm-preview-bubble rm-preview-bubble-user max-w-[86%] rounded-2xl rounded-br px-5 py-3 border-none ${
                              isDarkMode
                                ? 'bg-[rgb(var(--theme-500)_/_1)] text-white shadow-md'
                                : 'bg-[rgb(var(--theme-400)_/_1)] text-white shadow-[5px_5px_10px_#d1d5db,-5px_-5px_10px_#ffffff]'
                            }`}>
                              用户气泡预览
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 预设选择 */}
                      <div className="mb-3">
                        <SingleSelectDropdown
                          options={appearanceSettings.bubbleCssPresets.map((p) => ({ value: p.id, label: p.name }))}
                          value={selectedBubblePresetId}
                          onChange={(val) => onSelectBubbleCssPreset(val || defaultBubblePreset?.id || null)}
                          placeholder="选择预设"
                          inputClass={inputClass}
                          cardClass={cardClass}
                          isDarkMode={isDarkMode}
                        />
                      </div>

                      {/* 应用和清空 */}
                      <div className="flex gap-2 mb-3">
                        <button type="button" onClick={onApplyBubbleCssDraft} className={`flex-1 h-10 rounded-xl text-sm text-rose-400 ${btnClass} ${activeBtnClass} transition-all`}>
                          应用
                        </button>
                        <button type="button" onClick={onClearBubbleCssDraft} className={`flex-1 h-10 rounded-xl text-sm ${btnClass} ${activeBtnClass} transition-all`}>
                          清空
                        </button>
                      </div>

                      {/* 预设管理 */}
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={presetName}
                          onChange={(e) => setPresetName(e.target.value)}
                          placeholder="预设名称"
                          className={`w-full h-10 rounded-xl px-3 text-sm outline-none ${inputClass}`}
                        />
                        <div className="flex w-full items-center justify-between">
                          <button
                            type="button"
                            onClick={() => {
                              if (presetName.trim()) {
                                if (editingPresetId) {
                                  onRenameBubbleCssPreset(editingPresetId, presetName.trim());
                                  setEditingPresetId(null);
                                } else {
                                  onSaveBubbleCssPreset(presetName.trim());
                                }
                                setPresetName('');
                              }
                            }}
                            className={`w-10 h-10 aspect-square shrink-0 rounded-xl flex items-center justify-center text-rose-400 ${btnClass} ${activeBtnClass} transition-all`}
                            title="保存"
                          >
                            <Save size={16} />
                          </button>
                          <button
                            type="button"
                            disabled={!selectedPreset || isDefaultBubblePresetSelected}
                            onClick={() => {
                              if (selectedPreset && !isDefaultBubblePresetSelected) {
                                setPresetName(selectedPreset.name);
                                setEditingPresetId(selectedPreset.id);
                              }
                            }}
                            className={`w-10 h-10 aspect-square shrink-0 rounded-xl flex items-center justify-center transition-all ${
                              selectedPreset && !isDefaultBubblePresetSelected
                                ? `${btnClass} ${activeBtnClass}`
                                : disabledIconButtonClass
                            }`}
                            title="重命名"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            type="button"
                            disabled={!selectedPreset || isDefaultBubblePresetSelected}
                            onClick={() => selectedPreset && !isDefaultBubblePresetSelected && onDeleteBubbleCssPreset(selectedPreset.id)}
                            className={`w-10 h-10 aspect-square shrink-0 rounded-xl flex items-center justify-center transition-all ${
                              selectedPreset && !isDefaultBubblePresetSelected
                                ? enabledDangerIconButtonClass
                                : disabledIconButtonClass
                            }`}
                            title="删除"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="w-full h-[1px] bg-slate-300/20 my-0" />

                    <div className="py-5">
                      <button
                        type="button"
                        onClick={onResetAppearanceSettings}
                        className={`w-full h-10 rounded-xl text-sm font-bold flex items-center justify-center gap-2 text-slate-500 ${btnClass} ${activeBtnClass} transition-all`}
                      >
                        <RefreshCw size={14} />
                        重置美化设置
                      </button>
                    </div>
                  </div>
                )}

                {tab === 'feature' && (
                  <div className="space-y-0">
                    {/* 阅读原文字数 */}
                    <div className="py-5">
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-bold ${headingClass}`}>阅读原文字数</span>
                        {numInput(featureSettings.readingExcerptCharCount, (v) => onUpdateFeatureSettings({ readingExcerptCharCount: v }))}
                      </div>
                    </div>

                    <div className="w-full h-[1px] bg-slate-300/20 my-0" />

                    {/* 记忆消息条数 */}
                    <div className="py-5">
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-bold ${headingClass}`}>记忆消息条数</span>
                        {numInput(featureSettings.memoryBubbleCount, (v) => onUpdateFeatureSettings({ memoryBubbleCount: v }))}
                      </div>
                    </div>

                    <div className="w-full h-[1px] bg-slate-300/20 my-0" />

                    {/* 回复最小条数 */}
                    <div className="py-5">
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-bold ${headingClass}`}>回复最小条数</span>
                        {numInput(featureSettings.replyBubbleMin, (v) => onUpdateFeatureSettings({ replyBubbleMin: v }))}
                      </div>
                    </div>

                    <div className="w-full h-[1px] bg-slate-300/20 my-0" />

                    {/* 回复最大条数 */}
                    <div className="py-5">
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-bold ${headingClass}`}>回复最大条数</span>
                        {numInput(featureSettings.replyBubbleMax, (v) => onUpdateFeatureSettings({ replyBubbleMax: v }))}
                      </div>
                    </div>

                    <div className="w-full h-[1px] bg-slate-300/20 my-0" />

                    {/* 聊天自动总结 */}
                    <div className="py-5">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-sm font-bold ${headingClass}`}>聊天自动总结</span>
                        <Toggle checked={featureSettings.autoChatSummaryEnabled} onClick={() => onUpdateFeatureSettings({ autoChatSummaryEnabled: !featureSettings.autoChatSummaryEnabled })} pressedClass={pressedClass} activeClass={activeBtnClass} />
                      </div>
                      <div className={`grid transition-[grid-template-rows] duration-300 ${featureSettings.autoChatSummaryEnabled ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                        <div className="overflow-hidden">
                          <div className="pt-2 flex items-center justify-between text-xs text-slate-500">
                            <span>触发条数</span>
                            {numInput(featureSettings.autoChatSummaryTriggerCount, (v) => onUpdateFeatureSettings({ autoChatSummaryTriggerCount: v }))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="w-full h-[1px] bg-slate-300/20 my-0" />

                    {/* 书籍自动总结 */}
                    <div className="py-5">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-sm font-bold ${headingClass}`}>书籍自动总结</span>
                        <Toggle checked={featureSettings.autoBookSummaryEnabled} onClick={() => onUpdateFeatureSettings({ autoBookSummaryEnabled: !featureSettings.autoBookSummaryEnabled })} pressedClass={pressedClass} activeClass={activeBtnClass} />
                      </div>
                      <div className={`grid transition-[grid-template-rows] duration-300 ${featureSettings.autoBookSummaryEnabled ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                        <div className="overflow-hidden">
                          <div className="pt-2 flex items-center justify-between text-xs text-slate-500">
                            <span>触发字数</span>
                            {numInput(featureSettings.autoBookSummaryTriggerChars, (v) => onUpdateFeatureSettings({ autoBookSummaryTriggerChars: v }))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="w-full h-[1px] bg-slate-300/20 my-0" />

                    {/* 总结专用副 API */}
                    <div className="py-5">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <div className={`text-sm font-bold ${headingClass}`}>总结专用副 API</div>
                          <div className="text-xs text-slate-500 mt-1">只用于聊天/书籍总结</div>
                        </div>
                        <Toggle checked={featureSettings.summaryApiEnabled} onClick={() => onUpdateFeatureSettings({ summaryApiEnabled: !featureSettings.summaryApiEnabled })} pressedClass={pressedClass} activeClass={activeBtnClass} />
                      </div>
                      <div className={`grid transition-[grid-template-rows] duration-300 ${featureSettings.summaryApiEnabled ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                        <div className={featureSettings.summaryApiEnabled ? 'overflow-visible' : 'overflow-hidden'}>
                          <div className="pt-3 space-y-3">
                            <SingleSelectDropdown
                              options={summaryApiPresetOptions}
                              value={summaryApiPresetValue}
                              onChange={(val) => onUpdateFeatureSettings({ summaryApiPresetId: val || null })}
                              placeholder={summaryApiPresetOptions.length > 0 ? '选择已保存预设' : '请先到 API 设置保存预设'}
                              inputClass={inputClass}
                              cardClass={cardClass}
                              isDarkMode={isDarkMode}
                              disabled={summaryApiPresetOptions.length === 0}
                            />
                            {summaryApiPresetOptions.length === 0 && (
                              <div className="text-[11px] text-slate-500">请先在设置 - API 配置中保存预设</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="w-full h-[1px] bg-slate-300/20 my-0" />

                    <div className="py-5">
                      <button
                        type="button"
                        onClick={onResetFeatureSettings}
                        className={`w-full h-10 rounded-xl text-sm font-bold flex items-center justify-center gap-2 text-slate-500 ${btnClass} ${activeBtnClass} transition-all`}
                      >
                        <RefreshCw size={14} />
                        重置功能设置
                      </button>
                    </div>
                  </div>
                )}

                {tab === 'session' && (
                  <div className="space-y-0">
                    {/* 当前会话token */}
                    <div className="py-5">
                      <div className="flex items-center justify-between mb-3">
                        <div className={`text-sm font-bold ${headingClass}`}>当前会话token</div>
                        <div className="text-xs text-slate-500">预估总计 {sessionPromptTokenEstimate.totalTokens}</div>
                      </div>
                      <div
                        className={`rounded-2xl p-3 border ${
                          isDarkMode
                            ? 'bg-[#1f2937] border-slate-700/70'
                            : 'bg-white border-slate-200 shadow-sm'
                        }`}
                      >
                        <div className="space-y-2">
                          {sessionPromptTokenEstimate.sections.map((section) => (
                            <div key={section.key} className="flex items-center justify-between text-xs">
                              <span className={`${headingClass} opacity-85`}>{section.label}</span>
                              <span className="font-mono text-slate-500">{section.tokens}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="w-full h-[1px] bg-slate-300/20 my-0" />

                    {/* 会话存档选择 */}
                    <div className="py-5">
                      <div className={`text-sm font-bold mb-3 ${headingClass}`}>会话存档选择</div>
                      {archiveOptions.length === 0 ? (
                        <div className="text-xs text-slate-500 text-center py-6">暂无可用存档</div>
                      ) : (
                        <div className="space-y-2">
                          {archiveOptions.map((a) => (
                            <div
                              key={a.conversationKey}
                              className={`rounded-xl p-3 flex items-center justify-between ${
                                a.isCurrent
                                  ? archiveCardCurrentClass
                                  : archiveCardDefaultClass
                              }`}
                            >
                              <button
                                type="button"
                                disabled={a.isCurrent}
                                onClick={() => onSelectArchive(a)}
                                className={`flex-1 text-left transition-all ${!a.isCurrent ? 'cursor-pointer hover:opacity-80' : ''}`}
                              >
                                <div className="text-sm font-bold">{a.personaName} × {a.characterName}</div>
                                <div className="text-[11px] opacity-70 mt-1">更新时间：{ts(a.updatedAt)}</div>
                              </button>

                              <div className="flex shrink-0 items-center gap-2">
                                {a.isCurrent && (
                                  <span className="w-5 h-5 rounded-full bg-rose-400 text-white flex items-center justify-center">
                                    <Check size={12} />
                                  </span>
                                )}
                                {onDeleteArchive && (
                                  <button
                                    type="button"
                                    onClick={() => onDeleteArchive(a.conversationKey)}
                                    className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${enabledDangerIconButtonClass}`}
                                    title="删除会话存档"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                )}
                                {!a.isValid && (
                                  <span
                                    className={`w-5 h-5 flex items-center justify-center ${archiveWarningIconClass}`}
                                    title="该存档引用的角色或用户已删除"
                                  >
                                    <AlertTriangle size={12} />
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="w-full h-[1px] bg-slate-300/20 my-0" />

                    {/* 书籍内容总结 */}
                    <div className="py-5">
                      <button
                        type="button"
                        onClick={() => openModal('book')}
                        className={`w-full h-10 rounded-xl text-sm font-bold text-rose-400 ${btnClass} ${activeBtnClass} transition-all`}
                      >
                        书籍内容总结
                      </button>
                    </div>

                    <div className="w-full h-[1px] bg-slate-300/20 my-0" />

                    {/* 聊天记录总结 */}
                    <div className="py-5">
                      <button
                        type="button"
                        onClick={() => openModal('chat')}
                        className={`w-full h-10 rounded-xl text-sm font-bold text-rose-400 ${btnClass} ${activeBtnClass} transition-all`}
                      >
                        聊天记录总结
                      </button>
                    </div>
                  </div>
                )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {renderSummaryModal()}
      {renderBgUrlModal()}
    </>
  );
};

export default ReaderMoreSettingsPanel;
