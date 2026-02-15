import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, Trash2, Image as ImageIcon, Link as LinkIcon, Loader2, X, RefreshCw, Zap, Save, Edit2, Palette, Settings, Archive } from 'lucide-react';
import { ApiProvider, AppSettings, ReaderSummaryCard } from '../types';
import ResolvedImage from './ResolvedImage';

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

type FetchState = 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';
type TabKey = 'appearance' | 'feature' | 'session';
type ModalType = 'none' | 'book' | 'chat' | 'bgUrl';
const PANEL_VIEW_TRANSITION_MS = 260;
const MODAL_FADE_TRANSITION_MS = 220;

interface Props {
  isDarkMode: boolean;
  isOpen: boolean;
  onClose: () => void;
  appearanceSettings: AppSettings['readerMore']['appearance'];
  featureSettings: AppSettings['readerMore']['feature'];
  onUpdateAppearanceSettings: (updater: Partial<AppSettings['readerMore']['appearance']>) => void;
  onUpdateFeatureSettings: (updater: Partial<AppSettings['readerMore']['feature']>) => void;
  onUpdateSummaryApiSettings: (updater: Partial<AppSettings['readerMore']['feature']['summaryApi']>) => void;
  onUploadChatBackgroundImage: (file: File) => Promise<void>;
  onSetChatBackgroundImageFromUrl: (url: string) => void;
  onClearChatBackgroundImage: () => void;
  onApplyBubbleCssDraft: () => void;
  onSaveBubbleCssPreset: (name: string) => void;
  onDeleteBubbleCssPreset: (presetId: string) => void;
  onRenameBubbleCssPreset: (presetId: string, name: string) => void;
  onSelectBubbleCssPreset: (presetId: string | null) => void;
  onClearBubbleCssDraft: () => void;
  archiveOptions: ReaderArchiveOption[];
  onSelectArchive: (archive: ReaderArchiveOption) => void;
  onDeleteArchive?: (conversationKey: string) => void;
  bookSummaryCards: ReaderSummaryCard[];
  chatSummaryCards: ReaderSummaryCard[];
  onEditBookSummaryCard: (cardId: string, content: string) => void;
  onDeleteBookSummaryCard: (cardId: string) => void;
  onEditChatSummaryCard: (cardId: string, content: string) => void;
  onDeleteChatSummaryCard: (cardId: string) => void;
  onRequestManualBookSummary: (start: number, end: number) => void;
  onRequestManualChatSummary: (start: number, end: number) => void;
  currentReadCharOffset: number;
  totalBookChars: number;
  totalMessages: number;
  summaryTaskRunning: boolean;
  onFetchSummaryModels: () => Promise<void>;
  summaryApiModels: string[];
  summaryApiFetchState: FetchState;
  summaryApiFetchError: string;
}

const PROVIDERS: Array<{ value: ApiProvider; label: string; endpoint: string }> = [
  { value: 'OPENAI', label: 'OpenAI', endpoint: 'https://api.openai.com/v1' },
  { value: 'DEEPSEEK', label: 'DeepSeek', endpoint: 'https://api.deepseek.com' },
  { value: 'GEMINI', label: 'Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta' },
  { value: 'CLAUDE', label: 'Claude', endpoint: 'https://api.anthropic.com' },
  { value: 'CUSTOM', label: '自定义', endpoint: '' },
];
const TAB_ITEMS: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { key: 'appearance', label: '美化', icon: Palette },
  { key: 'feature', label: '功能', icon: Settings },
  { key: 'session', label: '会话', icon: Archive },
];
const TAB_ORDER: TabKey[] = ['appearance', 'feature', 'session'];

const clampInt = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? Math.round(value) : min));

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

const ReaderMoreSettingsPanel: React.FC<Props> = (props) => {
  const {
    isDarkMode,
    isOpen,
    onClose,
    appearanceSettings,
    featureSettings,
    onUpdateAppearanceSettings,
    onUpdateFeatureSettings,
    onUpdateSummaryApiSettings,
    onUploadChatBackgroundImage,
    onSetChatBackgroundImageFromUrl,
    onClearChatBackgroundImage,
    onApplyBubbleCssDraft,
    onSaveBubbleCssPreset,
    onDeleteBubbleCssPreset,
    onRenameBubbleCssPreset,
    onSelectBubbleCssPreset,
    onClearBubbleCssDraft,
    archiveOptions,
    onSelectArchive,
    onDeleteArchive,
    bookSummaryCards,
    chatSummaryCards,
    onEditBookSummaryCard,
    onDeleteBookSummaryCard,
    onEditChatSummaryCard,
    onDeleteChatSummaryCard,
    onRequestManualBookSummary,
    onRequestManualChatSummary,
    currentReadCharOffset,
    totalBookChars,
    totalMessages,
    summaryTaskRunning,
    onFetchSummaryModels,
    summaryApiModels,
    summaryApiFetchState,
    summaryApiFetchError,
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
  const [bookRange, setBookRange] = useState({ start: 1, end: 1 });
  const [chatRange, setChatRange] = useState({ start: 1, end: 1 });
  const closeTimerRef = useRef<number | null>(null);
  const modalCloseTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  useEffect(() => setBookRange({ start: 1, end: Math.max(1, currentReadCharOffset || 1) }), [currentReadCharOffset, modal]);
  useEffect(() => setChatRange({ start: 1, end: Math.max(1, totalMessages || 1) }), [totalMessages, modal]);

  const selectedPreset = useMemo(
    () => appearanceSettings.bubbleCssPresets.find((x) => x.id === appearanceSettings.selectedBubbleCssPresetId) || null,
    [appearanceSettings.bubbleCssPresets, appearanceSettings.selectedBubbleCssPresetId]
  );
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
  const panelMainCardShadowClass = panelSurfaceShadowClass;
  const tabActivePlateClass = `${panelMainCardBaseClass} ${panelSurfaceShadowClass}`;
  const activeBtnClass = isDarkMode
    ? 'active:shadow-[inset_3px_3px_6px_#232b39,inset_-3px_-3px_6px_#374357] active:translate-y-px'
    : 'active:shadow-[inset_3px_3px_6px_#a3b1c6,inset_-3px_-3px_6px_#ffffff] active:translate-y-px';
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

  const numInput = (value: number, onChange: (v: number) => void, min: number, max: number) => (
    <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value || '0'))}
      className={`w-14 h-8 rounded-lg px-2 text-xs text-right outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${inputClass}`} />
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

  const applySummaryApiSettings = () => {
    // Visual feedback for applying settings
    // In a real scenario, this could trigger a save or validation
  };

  const renderSummaryModal = () => {
    if (modal !== 'book' && modal !== 'chat') return null;
    const isBook = modal === 'book';
    const cards = isBook ? bookSummaryCards : chatSummaryCards;
    const onEdit = isBook ? onEditBookSummaryCard : onEditChatSummaryCard;
    const onDelete = isBook ? onDeleteBookSummaryCard : onDeleteChatSummaryCard;
    const max = isBook ? Math.max(1, totalBookChars || currentReadCharOffset || 1) : Math.max(1, totalMessages || 1);
    const start = isBook ? bookRange.start : chatRange.start;
    const end = isBook ? bookRange.end : chatRange.end;
    const trigger = () => {
      const s = clampInt(Math.min(start, end), 1, max);
      const e = clampInt(Math.max(start, end), 1, max);
      if (isBook) onRequestManualBookSummary(s, e);
      else onRequestManualChatSummary(s, e);
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
            <div className="flex items-center gap-2 mb-3">
              <input type="number" value={start} min={1} max={max}
                onChange={(e) => isBook ? setBookRange((p) => ({ ...p, start: clampInt(Number(e.target.value || '1'), 1, max) })) : setChatRange((p) => ({ ...p, start: clampInt(Number(e.target.value || '1'), 1, max) }))}
                className={`flex-1 h-10 rounded-xl px-3 text-sm outline-none ${inputClass}`} />
              <span className="text-slate-500">—</span>
              <input type="number" value={end} min={1} max={max}
                onChange={(e) => isBook ? setBookRange((p) => ({ ...p, end: clampInt(Number(e.target.value || '1'), 1, max) })) : setChatRange((p) => ({ ...p, end: clampInt(Number(e.target.value || '1'), 1, max) }))}
                className={`flex-1 h-10 rounded-xl px-3 text-sm outline-none ${inputClass}`} />
            </div>
            <button type="button" onClick={trigger} disabled={summaryTaskRunning}
              className={`w-full h-10 rounded-xl text-sm font-bold flex items-center justify-center gap-2 text-white bg-rose-400 shadow-lg hover:bg-rose-500 active:scale-95 transition-all disabled:opacity-50 disabled:active:scale-100 ${summaryTaskRunning ? 'cursor-not-allowed' : ''}`}>
              {summaryTaskRunning && <Loader2 size={14} className="animate-spin" />}
              {summaryTaskRunning ? '处理中...' : '手动总结'}
            </button>
          </div>
          <div className="mt-4 flex-1 overflow-y-auto no-scrollbar px-4 py-4">
            <div className="space-y-5">
              {cards.length === 0 && <div className="text-xs text-slate-500 text-center py-10">暂无总结卡片</div>}
              {cards.map((card) => (
                <div key={card.id} className={`rounded-2xl p-4 ${raisedCardClass}`}>
                  <textarea defaultValue={card.content} onBlur={(e) => onEdit(card.id, e.target.value)}
                    className={`w-full min-h-[96px] rounded-xl p-3 text-sm outline-none resize-y ${inputClass}`} />
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                    <span>{isBook ? `字符区间` : `消息区间`}：{card.start}-{card.end}</span>
                    <div className="flex items-center gap-2">
                      <span>{ts(card.updatedAt)}</span>
                      <button type="button" onClick={() => onDelete(card.id)} className={`w-7 h-7 rounded-full text-rose-400 flex items-center justify-center transition-all ${btnClass} ${activeBtnClass}`}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
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
      <div className="absolute inset-0 z-[90]">
        <div className={`absolute inset-0 ${closing ? 'app-view-exit-right' : 'app-view-enter-left'} ${isDarkMode ? 'bg-[#2d3748]' : 'bg-[#e0e5ec]'}`} style={panelMotionStyle}>
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="px-4 pt-4 pb-3 flex items-center gap-3">
              <button type="button" onClick={onClose} className={`w-10 h-10 rounded-full flex items-center justify-center hover:text-rose-400 transition-colors ${btnClass} ${activeBtnClass}`}>
                <ArrowLeft size={18} />
              </button>
              <div className={`text-base font-bold ${headingClass}`}>更多设置</div>
            </div>

            {/* Bookmark-style Tabs */}
            <div className="px-4 pb-0">
              <div className="relative grid grid-cols-3">
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
            <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-6 overflow-visible">
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
                              ? `text-rose-400 ${btnClass} ${activeBtnClass}`
                              : `text-slate-400 opacity-50 cursor-not-allowed ${btnClass}`
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
                        onChange={(e) => onUpdateAppearanceSettings({ bubbleCssDraft: e.target.value })}
                        className={`w-full min-h-[120px] rounded-xl p-3 text-xs outline-none resize-y ${inputClass} mb-3`}
                      />
                      <style>{appearanceSettings.bubbleCssDraft || ''}</style>

                      {/* 预览区域 - 添加凹陷边框和字体缩放 */}
                      <div className={`rounded-xl p-3 mb-3 ${pressedClass}`}>
                        <div className="space-y-2" style={{ fontSize: `${14 * appearanceSettings.bubbleFontSizeScale}px` }}>
                          <div className="flex justify-start">
                            <div className={`rm-bubble rm-bubble-ai max-w-[86%] rounded-2xl rounded-bl px-5 py-3 ${
                              appearanceSettings.bubbleCssDraft
                                ? ''
                                : isDarkMode
                                  ? 'bg-[#1a202c] text-slate-300 shadow-md'
                                  : 'bg-[#e0e5ec] shadow-[5px_5px_10px_#c3c8ce,-5px_-5px_10px_#fdffff] text-slate-700'
                            }`}>
                              AI 气泡预览
                            </div>
                          </div>
                          <div className="flex justify-end">
                            <div className={`rm-bubble rm-bubble-user max-w-[86%] rounded-2xl rounded-br px-5 py-3 ${
                              appearanceSettings.bubbleCssDraft
                                ? ''
                                : isDarkMode
                                  ? 'bg-rose-500 text-white shadow-md'
                                  : 'bg-rose-400 text-white shadow-[5px_5px_10px_#d1d5db,-5px_-5px_10px_#ffffff]'
                            }`}>
                              用户气泡预览
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 预设选择 */}
                      <div className="mb-3">
                        <SingleSelectDropdown
                          options={appearanceSettings.bubbleCssPresets.map(p => ({ value: p.id, label: p.name }))}
                          value={appearanceSettings.selectedBubbleCssPresetId || ''}
                          onChange={(val) => onSelectBubbleCssPreset(val || null)}
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
                            disabled={!selectedPreset}
                            onClick={() => {
                              if (selectedPreset) {
                                setPresetName(selectedPreset.name);
                                setEditingPresetId(selectedPreset.id);
                              }
                            }}
                            className={`w-10 h-10 aspect-square shrink-0 rounded-xl flex items-center justify-center transition-all ${selectedPreset ? `${btnClass} ${activeBtnClass}` : 'opacity-40 cursor-not-allowed bg-transparent'}`}
                            title="重命名"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            type="button"
                            disabled={!selectedPreset}
                            onClick={() => selectedPreset && onDeleteBubbleCssPreset(selectedPreset.id)}
                            className={`w-10 h-10 aspect-square shrink-0 rounded-xl flex items-center justify-center transition-all ${
                              selectedPreset
                                ? `text-rose-400 ${btnClass} ${activeBtnClass}`
                                : 'text-slate-400 opacity-40 cursor-not-allowed bg-transparent'
                            }`}
                            title="删除"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {tab === 'feature' && (
                  <div className="space-y-0">
                    {/* 记忆消息条数 */}
                    <div className="py-5">
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-bold ${headingClass}`}>记忆消息条数</span>
                        {numInput(featureSettings.memoryBubbleCount, (v) => onUpdateFeatureSettings({ memoryBubbleCount: clampInt(v, 20, 5000) }), 20, 5000)}
                      </div>
                    </div>

                    <div className="w-full h-[1px] bg-slate-300/20 my-0" />

                    {/* 回复最小条数 */}
                    <div className="py-5">
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-bold ${headingClass}`}>回复最小条数</span>
                        {numInput(featureSettings.replyBubbleMin, (v) => onUpdateFeatureSettings({ replyBubbleMin: clampInt(v, 1, 20), replyBubbleMax: Math.max(clampInt(v, 1, 20), featureSettings.replyBubbleMax) }), 1, 20)}
                      </div>
                    </div>

                    <div className="w-full h-[1px] bg-slate-300/20 my-0" />

                    {/* 回复最大条数 */}
                    <div className="py-5">
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-bold ${headingClass}`}>回复最大条数</span>
                        {numInput(featureSettings.replyBubbleMax, (v) => onUpdateFeatureSettings({ replyBubbleMax: clampInt(v, 1, 20), replyBubbleMin: Math.min(clampInt(v, 1, 20), featureSettings.replyBubbleMin) }), 1, 20)}
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
                            {numInput(featureSettings.autoChatSummaryTriggerCount, (v) => onUpdateFeatureSettings({ autoChatSummaryTriggerCount: clampInt(v, 100, 5000) }), 100, 5000)}
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
                            {numInput(featureSettings.autoBookSummaryTriggerChars, (v) => onUpdateFeatureSettings({ autoBookSummaryTriggerChars: clampInt(v, 1000, 50000) }), 1000, 50000)}
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
                        <div className="overflow-hidden">
                          <div className="pt-3 space-y-3">
                            {/* 服务商选择 */}
                            <SingleSelectDropdown
                              options={PROVIDERS.map(p => ({ value: p.value, label: p.label }))}
                              value={featureSettings.summaryApi.provider}
                              onChange={(val) => {
                                const provider = val as ApiProvider;
                                const endpoint = PROVIDERS.find((p) => p.value === provider)?.endpoint || '';
                                onUpdateSummaryApiSettings({ provider, endpoint, model: '' });
                              }}
                              placeholder="选择服务商"
                              inputClass={inputClass}
                              cardClass={cardClass}
                              isDarkMode={isDarkMode}
                            />

                            <input
                              type="text"
                              value={featureSettings.summaryApi.endpoint}
                              onChange={(e) => onUpdateSummaryApiSettings({ endpoint: e.target.value })}
                              className={`w-full h-10 rounded-xl px-3 text-sm outline-none ${inputClass}`}
                              placeholder="API 地址"
                            />

                            <input
                              type="password"
                              value={featureSettings.summaryApi.apiKey}
                              onChange={(e) => onUpdateSummaryApiSettings({ apiKey: e.target.value })}
                              className={`w-full h-10 rounded-xl px-3 text-sm outline-none ${inputClass}`}
                              placeholder="API Key"
                            />

                            <div className="flex items-center gap-2">
                              <div className="flex-1">
                                <SingleSelectDropdown
                                  options={summaryApiModels.map(m => ({ value: m, label: m }))}
                                  value={featureSettings.summaryApi.model}
                                  onChange={(val) => onUpdateSummaryApiSettings({ model: val })}
                                  placeholder={summaryApiModels.length > 0 ? "选择模型..." : "请先拉取模型..."}
                                  inputClass={inputClass}
                                  cardClass={cardClass}
                                  isDarkMode={isDarkMode}
                                />
                              </div>

                              {/* 状态指示灯 */}
                              <div className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                                summaryApiFetchState === 'SUCCESS' ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' :
                                summaryApiFetchState === 'ERROR' ? 'bg-red-500 shadow-[0_0_8px_#ef4444]' :
                                summaryApiFetchState === 'LOADING' ? 'bg-amber-400 animate-pulse' : 'bg-slate-300'
                              }`} />

                              <button
                                type="button"
                                onClick={() => void onFetchSummaryModels()}
                                disabled={summaryApiFetchState === 'LOADING'}
                                className={`h-10 px-3 rounded-xl text-xs text-slate-500 flex items-center gap-1 transition-all ${
                                  summaryApiFetchState === 'LOADING'
                                    ? 'opacity-50 cursor-not-allowed'
                                    : activeBtnClass
                                } ${btnClass}`}
                              >
                                <RefreshCw size={10} className={summaryApiFetchState === 'LOADING' ? 'animate-spin' : ''} />
                                拉取模型
                              </button>
                            </div>

                            {summaryApiFetchError && <div className="text-[11px] text-rose-400">{summaryApiFetchError}</div>}

                            <button
                              type="button"
                              onClick={applySummaryApiSettings}
                              className={`w-full h-10 rounded-xl text-sm font-bold flex items-center justify-center gap-2 text-white bg-rose-400 shadow-lg hover:bg-rose-500 ${activeBtnClass} transition-all`}
                            >
                              <Zap size={16} />
                              应用设置
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {tab === 'session' && (
                  <div className="space-y-0">
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
                                  ? (isDarkMode ? 'bg-[#1a202c] text-rose-300' : 'bg-white text-rose-500')
                                  : a.isValid
                                    ? `${pressedClass} ${!a.isCurrent ? 'cursor-pointer hover:opacity-80' : ''}`
                                    : 'bg-rose-500/10 text-rose-400 border border-rose-300/40'
                              } ${!a.isValid || a.isCurrent ? 'opacity-70' : ''}`}
                            >
                              <button
                                type="button"
                                disabled={!a.isValid || a.isCurrent}
                                onClick={() => onSelectArchive(a)}
                                className={`flex-1 text-left transition-all ${a.isValid && !a.isCurrent ? activeBtnClass : ''}`}
                              >
                                <div className="text-sm font-bold">{a.personaName} × {a.characterName}</div>
                                <div className="text-[11px] opacity-70 mt-1">更新时间：{ts(a.updatedAt)}</div>
                              </button>

                              <div className="flex items-center gap-2">
                                {a.isCurrent && (
                                  <span className="w-5 h-5 rounded-full bg-rose-400 text-white flex items-center justify-center">
                                    <Check size={12} />
                                  </span>
                                )}
                                {!a.isValid && (
                                  <button
                                    type="button"
                                    onClick={() => onDeleteArchive?.(a.conversationKey)}
                                    className="w-5 h-5 rounded-full bg-rose-400 text-white flex items-center justify-center active:scale-95 transition-all"
                                  >
                                    <Trash2 size={12} />
                                  </button>
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
                        书籍总结浮窗
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
                        聊天总结浮窗
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
