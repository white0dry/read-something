import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Plus, ArrowLeft, Search, X, Filter, Trash2, MessageCircle,
  Send, ChevronLeft, ChevronRight, Check, RotateCcw, HelpCircle,
  Loader2, BookMarked, CheckCircle2, NotebookPen, CircleCheckBig,
  BookPlus, UserCircle, Edit2, Link, FileUp, ChevronDown, Feather, Scroll,
  Heading1, Heading2, Heading3, Pilcrow, Bold, Italic, ListOrdered, List as ListIcon,
  Save, Eraser, Highlighter, Copy, ExternalLink, Volume2,
} from 'lucide-react';
import {
  Book, ApiConfig, RagApiConfigResolver, Notebook, StudyNote, StudyNoteCommentThread,
  StudyNoteCommentMessage, QuizSession, QuizConfig, QuizQuestion, ReaderCssPreset, ReaderVocabularyEntry,
} from '../types';
import { Persona, Character, WorldBookEntry } from './settings/types';
import ResolvedImage from './ResolvedImage';
import ModalPortal from './ModalPortal';
import { saveImageFile, isImageRef, getImageBlobByRef } from '../utils/imageStorage';
import {
  saveNotebook, getAllNotebooks, deleteNotebook,
  saveQuizSession, getAllQuizSessions, deleteQuizSession,
} from '../utils/studyHubStorage';
import {
  prepareBookContexts, buildNoteCommentPrompt, buildNoteReplyPrompt,
  buildQuizGenerationPrompt, parseQuizQuestions, buildQuizOverallCommentPrompt,
  parseStudyHubAiComment, getReadingGlobalCharOffset,
} from '../utils/studyHubAiEngine';
import { callAiModel, sanitizeTextForAiPrompt } from '../utils/readerAiEngine';
import { getBookContent, saveBookReaderState } from '../utils/bookContentStorage';
import { PRESET_HIGHLIGHT_COLORS, resolveHighlightItems } from '../utils/highlightUtils';
import type { ResolvedHighlightItem } from '../utils/highlightUtils';
import { estimateRagSafeOffset, retrieveRelevantChunks, isEmbedModelLoaded } from '../utils/ragEngine';
import { DEFAULT_PAPER_CSS_PRESETS, DEFAULT_PAPER_CSS_PRESET_ID, normalizeLegacyPaperCss } from '../utils/paperCssPresets';

interface StudyHubProps {
  isDarkMode: boolean;
  books: Book[];
  personas: Persona[];
  activePersonaId: string | null;
  characters: Character[];
  activeCharacterId: string | null;
  worldBookEntries: WorldBookEntry[];
  apiConfig: ApiConfig;
  readingExcerptCharCount: number;
  readingContextIgnorePanelClip: boolean;
  showNotification: (message: string, type?: 'success' | 'error') => void;
  ragApiConfigResolver?: RagApiConfigResolver;
  onJumpToBookHighlight?: (bookId: string, chapterIndex: number | null, charOffset: number) => void;
}

type HubTab = 'notes' | 'quiz' | 'highlights' | 'vocab';
type NotesView = 'list' | 'detail' | 'editor';
type QuizView = 'history' | 'config' | 'play' | 'result';
type NoteBlockStyleTag = 'p' | 'h1' | 'h2' | 'h3';
type NoteInlineStyleKey = 'bold' | 'italic';
type NoteListStyleKey = 'ordered-list' | 'bullet-list';
type NoteStylePresetKey =
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'body'
  | NoteInlineStyleKey
  | NoteListStyleKey;

type NoteToolbarState = {
  block: NoteBlockStyleTag | null;
  bold: boolean;
  italic: boolean;
  orderedList: boolean;
  bulletList: boolean;
};

type StudyHubVocabularyGroup = {
  bookId: string;
  bookTitle: string;
  items: ReaderVocabularyEntry[];
};

const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const DEFAULT_NOTE_TOOLBAR_STATE: NoteToolbarState = {
  block: null,
  bold: false,
  italic: false,
  orderedList: false,
  bulletList: false,
};

const normalizeNotebookPaperCss = (notebook: Notebook): Notebook => {
  let changed = false;

  const nextDraft = typeof notebook.paperCssDraft === 'string'
    ? normalizeLegacyPaperCss(notebook.paperCssDraft)
    : notebook.paperCssDraft;
  if (nextDraft !== notebook.paperCssDraft) changed = true;

  const nextApplied = typeof notebook.paperCssApplied === 'string'
    ? normalizeLegacyPaperCss(notebook.paperCssApplied)
    : notebook.paperCssApplied;
  if (nextApplied !== notebook.paperCssApplied) changed = true;

  let nextPresets = notebook.paperCssPresets;
  if (Array.isArray(notebook.paperCssPresets)) {
    const mapped = notebook.paperCssPresets.map((preset) => {
      const nextCss = normalizeLegacyPaperCss(preset.css || '');
      if (nextCss === preset.css) return preset;
      changed = true;
      return { ...preset, css: nextCss };
    });
    nextPresets = mapped;
  }

  if (!changed) return notebook;
  return {
    ...notebook,
    paperCssDraft: nextDraft,
    paperCssApplied: nextApplied,
    paperCssPresets: nextPresets,
  };
};

const PAPER_CSS_PLACEHOLDER = `可用类名：
.sh-paper             /* 纸张外容器 */
.sh-paper-inner       /* 纸张内层 */
.studyhub-note-editor /* 编辑器 */
  h1 / h2 / h3 / p / strong / em
  ul / ol / li
.sh-note-placeholder  /* 占位提示文字 */

暗色模式：.dark-mode .sh-paper { }
应用后自动覆盖内置纸张背景

iOS提示：li/strong等可编辑元素请勿
用 ::before/::after 伪元素，建议改
用 background-image 等元素自身属性`;

// ── Highlight book multi-select dropdown (matches MultiSelectDropdown style) ──
const HighlightBookMultiSelect = ({
  entries, selected, onToggle, onClear, inputClass, cardClass, isDarkMode,
}: {
  entries: Array<{ bookId: string; bookTitle: string; items: { id: string }[] }>;
  selected: string[];
  onToggle: (bookId: string) => void;
  onClear: () => void;
  inputClass: string;
  cardClass: string;
  isDarkMode: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClose = () => {
    if (!isOpen || isClosing) return;
    setIsClosing(true);
    setTimeout(() => { setIsOpen(false); setIsClosing(false); }, 200);
  };

  const handleToggle = () => {
    if (isOpen) { handleClose(); } else { setIsOpen(true); }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        handleClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, isClosing]);

  const selectedTitles = entries.filter(e => selected.includes(e.bookId));

  return (
    <div className="relative" ref={containerRef}>
      <div
        onClick={handleToggle}
        className={`w-full p-2 h-[42px] rounded-xl flex items-center justify-between cursor-pointer transition-all active:scale-[0.99] ${inputClass}`}
      >
        <div className="flex gap-1.5 w-full pr-6 overflow-hidden">
          {selected.length === 0 && <span className="text-sm opacity-50 px-2 whitespace-nowrap">{'所有书籍'}</span>}
          {selectedTitles.map(entry => (
            <span key={entry.bookId} className="bg-rose-400 text-white text-xs px-2 py-1 rounded-lg flex items-center gap-1 shrink-0 max-w-[7rem]">
              <span className="truncate">{entry.bookTitle}</span>
              <span
                onClick={(e) => { e.stopPropagation(); onToggle(entry.bookId); }}
                className="hover:text-rose-100 cursor-pointer shrink-0"
              >
                <X size={10} />
              </span>
            </span>
          ))}
        </div>
        <div className="absolute right-3 opacity-50">
          <ChevronDown size={16} className={`transition-transform duration-200 ${isOpen && !isClosing ? 'rotate-180' : ''}`} />
        </div>
      </div>
      {(isOpen || isClosing) && (
        <div className={`absolute top-full left-0 right-0 mt-2 rounded-xl z-[100] max-h-52 flex flex-col ${cardClass} border border-slate-400/10 shadow-2xl ${isClosing ? 'reader-flyout-exit' : 'reader-flyout-enter'}`}>
          <div className="px-2 pt-2 pb-1 border-b border-slate-400/10 flex-shrink-0 flex items-center justify-between">
            <button
              onClick={() => { if (selected.length > 0) { onClear(); handleClose(); } }}
              className={`text-[11px] ${selected.length > 0 ? 'text-rose-400 hover:underline cursor-pointer' : 'text-slate-400/50 cursor-default'}`}
            >
              {'清除筛选'}
            </button>
            <span className="text-[10px] text-slate-400">{'已选 '}{selected.length}{' 项'}</span>
          </div>
          <div className="p-2 overflow-y-auto flex-1">
          {entries.map(entry => (
            <div
              key={entry.bookId}
              onClick={() => onToggle(entry.bookId)}
              className={`flex items-center gap-2 p-2 rounded-lg text-sm cursor-pointer transition-colors ${
                selected.includes(entry.bookId)
                  ? 'text-rose-400 font-bold bg-rose-400/10'
                  : isDarkMode ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                selected.includes(entry.bookId) ? 'bg-rose-400 border-rose-400' : 'border-slate-400'
              }`}>
                {selected.includes(entry.bookId) && <Check size={10} className="text-white" />}
              </div>
              <span className="truncate">{entry.bookTitle} ({entry.items.length})</span>
            </div>
          ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Expandable highlight text with smooth height transition ──
const ExpandableHighlightText = ({ text, isExpanded, isDarkMode }: {
  text: string; isExpanded: boolean; isDarkMode: boolean;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  // 3 lines at text-sm (14px) × leading-relaxed (1.625) = 68.25px
  const collapsedPx = 68;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (isExpanded) {
      el.style.maxHeight = el.scrollHeight + 'px';
    } else {
      // Set to current scrollHeight, force reflow, then collapse — gives browser two concrete px values to transition between
      el.style.maxHeight = el.scrollHeight + 'px';
      el.offsetHeight; // force reflow
      el.style.maxHeight = collapsedPx + 'px';
    }
  }, [isExpanded]);

  const paragraphs = text.split('\n').filter(p => p.trim());
  const isMultiPara = paragraphs.length > 1;

  return (
    <div
      ref={ref}
      className={`text-sm leading-relaxed overflow-hidden transition-[max-height] duration-300 ease-in-out ${
        isDarkMode ? 'text-slate-200' : 'text-slate-700'
      }`}
      style={{ maxHeight: collapsedPx + 'px' }}
    >
      {isMultiPara ? paragraphs.map((p, i) => (
        <p key={i} className={i > 0 ? 'mt-2' : ''} style={{ textIndent: '2em' }}>{p}</p>
      )) : text}
    </div>
  );
};

interface PaperCssOptionItem {
  value: string;
  label: string;
}

const PaperCssSingleSelectDropdown = ({
  options,
  value,
  onChange,
  placeholder = '选择...',
  inputClass,
  cardClass,
  isDarkMode,
}: {
  options: PaperCssOptionItem[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  inputClass: string;
  cardClass: string;
  isDarkMode: boolean;
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

  const selectedOption = options.find((o) => o.value === value) || (value ? { value, label: value } : null);

  return (
    <div className="relative" ref={containerRef}>
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
          {options.length > 0 ? options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <div
                key={opt.value}
                onClick={() => { onChange(opt.value); setIsOpen(false); }}
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

const StudyHub: React.FC<StudyHubProps> = ({
  isDarkMode, books, personas, activePersonaId, characters,
  activeCharacterId, worldBookEntries, apiConfig, readingExcerptCharCount,
  readingContextIgnorePanelClip, showNotification, ragApiConfigResolver,
  onJumpToBookHighlight,
}) => {
  // ─── Theme classes (matching Library.tsx) ───
  const containerClass = isDarkMode ? 'bg-[#2d3748] text-slate-200' : 'neu-bg text-slate-600';
  const cardClass = isDarkMode
    ? 'bg-[#2d3748] shadow-[6px_6px_12px_#232b39,-6px_-6px_12px_#374357]'
    : 'neu-flat';
  const pressedClass = isDarkMode
    ? 'bg-[#2d3748] shadow-[inset_3px_3px_6px_#232b39,inset_-3px_-3px_6px_#374357]'
    : 'neu-pressed';
  const inputClass = isDarkMode
    ? 'bg-[#2d3748] shadow-[inset_3px_3px_6px_#232b39,inset_-3px_-3px_6px_#374357] text-slate-200 placeholder-slate-500'
    : 'bg-[var(--neu-bg)] shadow-[inset_5px_5px_10px_var(--neu-shadow-dark),inset_-5px_-5px_10px_var(--neu-shadow-light)] text-slate-600 placeholder-slate-400';
  const btnClass = isDarkMode
    ? 'bg-[#2d3748] shadow-[5px_5px_10px_#232b39,-5px_-5px_10px_#374357] text-slate-200'
    : 'neu-btn';
  const headingClass = isDarkMode ? 'text-slate-200' : 'text-slate-700';
  const subTextClass = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const activeBtnClass = isDarkMode
    ? 'active:shadow-[inset_3px_3px_6px_#232b39,inset_-3px_-3px_6px_#374357] active:translate-y-px'
    : 'active:shadow-[inset_3px_3px_6px_var(--neu-shadow-dark),inset_-3px_-3px_6px_var(--neu-shadow-light)] active:translate-y-px';
  const disabledIconButtonClass = `${btnClass} ${isDarkMode ? 'text-slate-500' : 'text-slate-400'} opacity-55 cursor-not-allowed`;
  const enabledDangerIconButtonClass = `${isDarkMode ? 'text-[#cf8f97]' : 'text-[#bf616b]'} ${btnClass} ${activeBtnClass}`;

  // ─── Top-level state ───
  const [activeTab, setActiveTab] = useState<HubTab>('notes');
  const [renderedTab, setRenderedTab] = useState<HubTab>('notes');
  const [hubTabAnimClass, setHubTabAnimClass] = useState('');
  const [isSwitchingHubTab, setIsSwitchingHubTab] = useState(false);
  const hubTabTimerRef = useRef<number | null>(null);
  const hubTabUnlockRef = useRef<number | null>(null);

  // ─── Highlights state ───
  const [highlightsLoading, setHighlightsLoading] = useState(false);
  const [allBookHighlights, setAllBookHighlights] = useState<
    Array<{ bookId: string; bookTitle: string; items: ResolvedHighlightItem[] }>
  >([]);
  const [hubHighlightColorFilter, setHubHighlightColorFilter] = useState<string | null>(null);
  const [hubHighlightBookFilter, setHubHighlightBookFilter] = useState<string[]>([]);
  const [expandedHighlightIds, setExpandedHighlightIds] = useState<Set<string>>(new Set());

  // ─── Vocabulary state ───
  const [vocabularyLoading, setVocabularyLoading] = useState(false);
  const [allBookVocabulary, setAllBookVocabulary] = useState<StudyHubVocabularyGroup[]>([]);
  const [vocabularySearchTerm, setVocabularySearchTerm] = useState('');
  const [vocabularyBookFilter, setVocabularyBookFilter] = useState<string[]>([]);

  // ─── Notes state ───
  const [notesView, setNotesView] = useState<NotesView>('list');
  const [notesViewAnimClass, setNotesViewAnimClass] = useState('');
  const [isSwitchingNotesView, setIsSwitchingNotesView] = useState(false);
  const notesViewTimerRef = useRef<number | null>(null);
  const notesViewUnlockRef = useRef<number | null>(null);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [activeNotebook, setActiveNotebook] = useState<Notebook | null>(null);
  const [activeNote, setActiveNote] = useState<StudyNote | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [closingCreateModal, setClosingCreateModal] = useState(false);
  const [noteContent, setNoteContent] = useState('');
  const [noteToolbarState, setNoteToolbarState] = useState<NoteToolbarState>(DEFAULT_NOTE_TOOLBAR_STATE);
  const [noteToolbarPressedKey, setNoteToolbarPressedKey] = useState<NoteStylePresetKey | null>(null);
  const [isNoteEditorFocused, setIsNoteEditorFocused] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [commentReplyInputs, setCommentReplyInputs] = useState<Record<string, string>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // ─── Create notebook modal state ───
  const [createTitle, setCreateTitle] = useState('');
  const [createPersonaId, setCreatePersonaId] = useState<string>(activePersonaId || '');
  const [createSelectedBookIds, setCreateSelectedBookIds] = useState<string[]>([]);
  const [createSearchTerm, setCreateSearchTerm] = useState('');
  const [createSelectedTags, setCreateSelectedTags] = useState<string[]>([]);
  const [createFilterOpen, setCreateFilterOpen] = useState(false);
  const [createCoverUrl, setCreateCoverUrl] = useState('');
  const [coverUrlInputMode, setCoverUrlInputMode] = useState(false);
  const [tempCoverUrl, setTempCoverUrl] = useState('');
  const [personaDropdownOpen, setPersonaDropdownOpen] = useState(false);

  // ─── Edit notebook modal state ───
  const [showEditModal, setShowEditModal] = useState(false);
  const [closingEditModal, setClosingEditModal] = useState(false);
  const [editingNotebookId, setEditingNotebookId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSelectedBookIds, setEditSelectedBookIds] = useState<string[]>([]);
  const [editCoverUrl, setEditCoverUrl] = useState('');
  const [editCoverUrlInputMode, setEditCoverUrlInputMode] = useState(false);
  const [editTempCoverUrl, setEditTempCoverUrl] = useState('');
  const [editSearchTerm, setEditSearchTerm] = useState('');
  const [editSelectedTags, setEditSelectedTags] = useState<string[]>([]);
  const [editFilterOpen, setEditFilterOpen] = useState(false);

  // ─── Paper background modal state ───
  const [showPaperModal, setShowPaperModal] = useState(false);
  const [closingPaperModal, setClosingPaperModal] = useState(false);
  const [paperUrlMode, setPaperUrlMode] = useState(false);
  const [tempPaperUrl, setTempPaperUrl] = useState('');
  const paperFileInputRef = useRef<HTMLInputElement | null>(null);
  const [resolvedPaperBgUrl, setResolvedPaperBgUrl] = useState<string>('');

  // ─── Paper CSS editor state ───
  const [paperCssDraft, setPaperCssDraft] = useState('');
  const [paperCssPresetName, setPaperCssPresetName] = useState('');
  const [paperCssEditingPresetId, setPaperCssEditingPresetId] = useState<string | null>(null);
  const [paperCssApplySuccess, setPaperCssApplySuccess] = useState(false);
  const [paperCssClearSuccess, setPaperCssClearSuccess] = useState(false);
  const [paperCssSaveSuccess, setPaperCssSaveSuccess] = useState(false);
  const [paperCssEditSuccess, setPaperCssEditSuccess] = useState(false);
  const paperCssApplyTimerRef = useRef<number | null>(null);
  const paperCssClearTimerRef = useRef<number | null>(null);
  const paperCssSaveTimerRef = useRef<number | null>(null);
  const paperCssEditTimerRef = useRef<number | null>(null);

  // ─── Quiz state ───
  const [quizView, setQuizView] = useState<QuizView>('history');
  const [quizViewAnimClass, setQuizViewAnimClass] = useState('');
  const [isSwitchingQuizView, setIsSwitchingQuizView] = useState(false);
  const quizViewTimerRef = useRef<number | null>(null);
  const quizViewUnlockRef = useRef<number | null>(null);
  const [quizSessions, setQuizSessions] = useState<QuizSession[]>([]);
  const [activeQuizSession, setActiveQuizSession] = useState<QuizSession | null>(null);
  const [quizCurrentIndex, setQuizCurrentIndex] = useState(0);
  const [quizUserAnswers, setQuizUserAnswers] = useState<Record<string, number[]>>({});
  const [isQuizGenerating, setIsQuizGenerating] = useState(false);
  const [quizError, setQuizError] = useState('');
  const [quizSlideDir, setQuizSlideDir] = useState<'left' | 'right'>('right');
  const [isQuizCommentRefreshing, setIsQuizCommentRefreshing] = useState(false);

  // ─── Quiz config state ───
  const [qcBookIds, setQcBookIds] = useState<string[]>([]);
  const [qcCount, setQcCount] = useState(10);
  const [qcType, setQcType] = useState<'single' | 'multiple' | 'truefalse'>('single');
  const [qcOptionCount, setQcOptionCount] = useState(4);
  const [qcPrompt, setQcPrompt] = useState('');
  const [qcSearchTerm, setQcSearchTerm] = useState('');
  const [qcSelectedTags, setQcSelectedTags] = useState<string[]>([]);
  const [qcFilterOpen, setQcFilterOpen] = useState(false);
  const [showQuizConfigModal, setShowQuizConfigModal] = useState(false);
  const [closingQuizConfigModal, setClosingQuizConfigModal] = useState(false);
  const [qcCountText, setQcCountText] = useState('10');

  // ─── Character select for AI comment (multi-select, max 3) ───
  const [showCharSelect, setShowCharSelect] = useState(false);
  const [selectedCharIds, setSelectedCharIds] = useState<string[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const coverFileInputRef = useRef<HTMLInputElement>(null);
  const editCoverFileInputRef = useRef<HTMLInputElement>(null);
  const charDropdownRef = useRef<HTMLDivElement>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const noteEditorRef = useRef<HTMLDivElement | null>(null);
  const noteEditorSyncingRef = useRef(false);
  const noteEditorComposingRef = useRef(false);

  // ─── Load data ───
  useEffect(() => {
    let cancelled = false;
    const loadData = async () => {
      try {
        const [loadedNotebooks, loadedQuizSessions] = await Promise.all([
          getAllNotebooks(),
          getAllQuizSessions(),
        ]);
        if (cancelled) return;

        const normalizedNotebooks = loadedNotebooks.map(normalizeNotebookPaperCss);
        setNotebooks(normalizedNotebooks);
        setQuizSessions(loadedQuizSessions);

        const changedNotebooks = normalizedNotebooks.filter((notebook, index) => notebook !== loadedNotebooks[index]);
        if (changedNotebooks.length > 0) {
          await Promise.all(changedNotebooks.map((notebook) => saveNotebook(notebook).catch(() => undefined)));
        }
      } catch {
        // keep default empty state
      }
    };

    void loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Load highlights when switching to highlights tab ───
  useEffect(() => {
    if (activeTab !== 'highlights') return;
    let cancelled = false;
    const loadAllHighlights = async () => {
      setHighlightsLoading(true);
      try {
        const results: typeof allBookHighlights = [];
        for (const book of books) {
          const content = await getBookContent(book.id);
          if (!content?.readerState?.highlightsByChapter) continue;
          const items = resolveHighlightItems(
            content.readerState.highlightsByChapter,
            content.chapters || [],
            content.fullText || '',
          );
          if (items.length === 0) continue;
          results.push({ bookId: book.id, bookTitle: book.title, items });
        }
        if (!cancelled) setAllBookHighlights(results);
      } catch (error) {
        console.error('Failed to load highlights:', error);
      } finally {
        if (!cancelled) setHighlightsLoading(false);
      }
    };
    void loadAllHighlights();
    return () => { cancelled = true; };
  }, [activeTab, books]);

  // ─── Load vocabulary when switching to vocabulary tab ───
  useEffect(() => {
    if (activeTab !== 'vocab') return;
    let cancelled = false;
    const loadAllVocabulary = async () => {
      setVocabularyLoading(true);
      try {
        const results: StudyHubVocabularyGroup[] = [];
        for (const book of books) {
          const content = await getBookContent(book.id);
          const rawEntries = content?.readerState?.vocabularyEntries;
          if (!Array.isArray(rawEntries) || rawEntries.length === 0) continue;
          const normalizedEntries = rawEntries
            .map((entry, index) => {
              if (!entry || typeof entry !== 'object') return null;
              const term = typeof entry.term === 'string' ? entry.term.trim() : '';
              if (!term) return null;
              const normalizedTerm = typeof entry.normalizedTerm === 'string' && entry.normalizedTerm.trim().length > 0
                ? entry.normalizedTerm.trim()
                : term.toLocaleLowerCase();
              return {
                id: typeof entry.id === 'string' && entry.id.trim().length > 0 ? entry.id : `${book.id}_vocab_${index}`,
                term,
                normalizedTerm,
              } satisfies ReaderVocabularyEntry;
            })
            .filter((entry): entry is ReaderVocabularyEntry => entry !== null);
          if (normalizedEntries.length === 0) continue;
          results.push({ bookId: book.id, bookTitle: book.title, items: normalizedEntries });
        }
        if (!cancelled) setAllBookVocabulary(results);
      } catch (error) {
        console.error('Failed to load vocabulary:', error);
      } finally {
        if (!cancelled) setVocabularyLoading(false);
      }
    };
    void loadAllVocabulary();
    return () => { cancelled = true; };
  }, [activeTab, books]);

  useEffect(() => {
    return () => {
      if (hubTabTimerRef.current) window.clearTimeout(hubTabTimerRef.current);
      if (hubTabUnlockRef.current) window.clearTimeout(hubTabUnlockRef.current);
    };
  }, []);

  // ─── Auto-save note content with debounce ───
  useEffect(() => {
    if (!activeNote || notesView !== 'editor') return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      handleSaveNote();
    }, 800);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteContent]);

  // ─── Close character dropdown on click outside ───
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (charDropdownRef.current && !charDropdownRef.current.contains(event.target as Node)) {
        setShowCharSelect(false);
      }
    };
    if (showCharSelect) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCharSelect]);

  // ─── Resolve paper background URL (handle idb:// refs) ───
  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    const resolve = async () => {
      const url = activeNotebook?.paperBgUrl?.trim();
      if (!url || url.startsWith('__builtin:')) { setResolvedPaperBgUrl(''); return; }
      if (!isImageRef(url)) { setResolvedPaperBgUrl(url); return; }
      try {
        const blob = await getImageBlobByRef(url);
        if (!blob || cancelled) { setResolvedPaperBgUrl(''); return; }
        objectUrl = URL.createObjectURL(blob);
        setResolvedPaperBgUrl(objectUrl);
      } catch { if (!cancelled) setResolvedPaperBgUrl(''); }
    };
    resolve();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [activeNotebook?.paperBgUrl]);

  // ─── Sync paper CSS draft from activeNotebook ───
  useEffect(() => {
    if (activeNotebook) {
      setPaperCssDraft(activeNotebook.paperCssDraft || '');
      setPaperCssPresetName('');
      setPaperCssEditingPresetId(null);
    }
  }, [activeNotebook?.id]);

  // ─── Compute paper style for note cards & editor ───
  const paperStyle = (() => {
    const val = activeNotebook?.paperBgUrl || '';
    const lineColor = isDarkMode ? 'rgba(100,116,139,0.15)' : 'rgba(180,160,130,0.25)';
    const defaultBg = isDarkMode ? '#1e2533' : '#fefcf3';
    const defaultLine = `repeating-linear-gradient(transparent, transparent 31px, ${lineColor} 31px, ${lineColor} 32px)`;

    // Default lined paper
    if (!val) return { bg: defaultBg, css: defaultLine, isCustomImage: false, isDefault: true, hideMarginLine: false };

    // Built-in styles
    if (val === '__builtin:grid') {
      const c = isDarkMode ? 'rgba(100,116,139,0.12)' : 'rgba(180,160,130,0.2)';
      return { bg: defaultBg, css: `repeating-linear-gradient(transparent, transparent 31px, ${c} 31px, ${c} 32px), repeating-linear-gradient(90deg, transparent, transparent 31px, ${c} 31px, ${c} 32px)`, isCustomImage: false, isDefault: false, hideMarginLine: true };
    }
    if (val === '__builtin:dots') {
      const c = isDarkMode ? 'rgba(100,116,139,0.25)' : 'rgba(180,160,130,0.35)';
      return { bg: defaultBg, css: `radial-gradient(circle, ${c} 1px, transparent 1px)`, size: '24px 24px', isCustomImage: false, isDefault: false, hideMarginLine: true };
    }
    if (val === '__builtin:kraft') {
      return {
        bg: '#f8eed7',
        css: 'radial-gradient(circle at center, transparent 54%, rgba(139, 69, 19, 0.08) 86%, rgba(139, 69, 19, 0.16) 100%), linear-gradient(135deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.16) 40%, rgba(255, 255, 255, 0) 100%)',
        isCustomImage: false,
        isDefault: false,
        hideMarginLine: true,
        border: '1px solid rgba(139, 69, 19, 0.18)',
        shadow: 'inset 0 0 42px rgba(139, 69, 19, 0.18), inset 0 0 14px rgba(101, 67, 33, 0.16), inset 0 0 4px rgba(60, 40, 20, 0.16), 2px 4px 10px rgba(0, 0, 0, 0.16)',
      };
    }
    if (val === '__builtin:green') {
      const bg = isDarkMode ? '#1a2a1a' : '#e8f0e0';
      const c = isDarkMode ? 'rgba(80,120,80,0.15)' : 'rgba(120,160,100,0.2)';
      return { bg, css: `repeating-linear-gradient(transparent, transparent 31px, ${c} 31px, ${c} 32px)`, isCustomImage: false, isDefault: false, hideMarginLine: false };
    }
    if (val === '__builtin:blank') {
      return { bg: defaultBg, css: 'none', isCustomImage: false, isDefault: false, hideMarginLine: true };
    }

    // Custom image
    if (resolvedPaperBgUrl) {
      return { bg: undefined, css: `url(${resolvedPaperBgUrl})`, size: 'cover', position: 'center', isCustomImage: true, isDefault: false, hideMarginLine: true };
    }

    return { bg: defaultBg, css: defaultLine, isCustomImage: false, isDefault: true, hideMarginLine: false };
  })();

  // ─── Helpers ───
  const allTags: string[] = Array.from(
    new Set(books.flatMap((b) => (Array.isArray(b.tags) ? b.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0) : []))),
  );

  const getPersona = (id: string) => personas.find((p) => p.id === id);
  const getCharacter = (id: string) => characters.find((c) => c.id === id);
  const getBook = (id: string) => books.find((b) => b.id === id);

  const escapeHtml = (value: string): string => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const normalizeInlineText = (value: string): string => value.replace(/\u00A0/g, ' ');

  const stripMarkdownForPreview = (value: string): string => value
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/\n+/g, ' ')
    .trim();

  const renderInlineMarkdownToHtml = (value: string): string => {
    const escaped = escapeHtml(value);
    return escaped
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');
  };

  const renderMarkdownToHtml = useCallback((markdown: string): string => {
    const normalized = (markdown || '').replace(/\r/g, '').trim();
    if (!normalized) return '<p><br></p>';

    const lines = normalized.split('\n');
    const parts: string[] = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index].trim();
      if (!line) {
        index += 1;
        continue;
      }

      const heading1Match = line.match(/^#\s+(.+)$/);
      if (heading1Match) {
        parts.push(`<h1>${renderInlineMarkdownToHtml(heading1Match[1].trim())}</h1>`);
        index += 1;
        continue;
      }

      const heading2Match = line.match(/^##\s+(.+)$/);
      if (heading2Match) {
        parts.push(`<h2>${renderInlineMarkdownToHtml(heading2Match[1].trim())}</h2>`);
        index += 1;
        continue;
      }

      const heading3Match = line.match(/^###\s+(.+)$/);
      if (heading3Match) {
        parts.push(`<h3>${renderInlineMarkdownToHtml(heading3Match[1].trim())}</h3>`);
        index += 1;
        continue;
      }

      if (/^[-*+]\s+/.test(line)) {
        const items: string[] = [];
        while (index < lines.length) {
          const itemLine = lines[index].trim();
          const match = itemLine.match(/^[-*+]\s+(.+)$/);
          if (!match) break;
          items.push(`<li>${renderInlineMarkdownToHtml(match[1].trim())}</li>`);
          index += 1;
        }
        parts.push(`<ul>${items.join('')}</ul>`);
        continue;
      }

      if (/^\d+\.\s+/.test(line)) {
        const items: string[] = [];
        while (index < lines.length) {
          const itemLine = lines[index].trim();
          const match = itemLine.match(/^\d+\.\s+(.+)$/);
          if (!match) break;
          items.push(`<li>${renderInlineMarkdownToHtml(match[1].trim())}</li>`);
          index += 1;
        }
        parts.push(`<ol>${items.join('')}</ol>`);
        continue;
      }

      parts.push(`<p>${renderInlineMarkdownToHtml(line)}</p>`);
      index += 1;
    }

    return parts.join('') || '<p><br></p>';
  }, []);

  const extractInlineMarkdownFromNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return normalizeInlineText(node.textContent || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();
    // <br> within a block element is either a browser placeholder or a soft break;
    // our markdown format doesn't support inline breaks, so emit a space instead of
    // '\n' to prevent single paragraphs from being split into multiple blocks.
    if (tag === 'br') return ' ';

    const childText = Array.from(element.childNodes).map(extractInlineMarkdownFromNode).join('');
    if (tag === 'strong' || tag === 'b') {
      const trimmed = childText.trim();
      if (!trimmed) return '';
      return `**${trimmed}**`;
    }
    if (tag === 'em' || tag === 'i') {
      const trimmed = childText.trim();
      if (!trimmed) return '';
      return `*${trimmed}*`;
    }
    return childText;
  };

  const extractBlocksFromNode = (node: Node): string[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = normalizeInlineText(node.textContent || '').trim();
      return text ? [text] : [];
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return [];

    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();

    if (tag === 'h1') {
      const text = extractInlineMarkdownFromNode(element).trim();
      return text ? [`# ${text}`] : [];
    }
    if (tag === 'h2') {
      const text = extractInlineMarkdownFromNode(element).trim();
      return text ? [`## ${text}`] : [];
    }
    if (tag === 'h3') {
      const text = extractInlineMarkdownFromNode(element).trim();
      return text ? [`### ${text}`] : [];
    }
    if (tag === 'p') {
      const text = extractInlineMarkdownFromNode(element).trim();
      return text ? [text] : [];
    }
    if (tag === 'ul') {
      const items: string[] = [];
      Array.from(element.childNodes).forEach((child) => {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const childTag = (child as HTMLElement).tagName.toLowerCase();
          if (childTag === 'li') {
            const text = extractInlineMarkdownFromNode(child).trim();
            if (text) items.push(`- ${text}`);
          } else if (childTag === 'ul' || childTag === 'ol') {
            // Nested list (browser anomaly) — process as separate list block
            items.push(...extractBlocksFromNode(child));
          } else {
            // Non-LI children (div/span created by browser with list-style-type:none)
            const text = extractInlineMarkdownFromNode(child).trim();
            if (text) items.push(`- ${text}`);
          }
        } else {
          const text = extractInlineMarkdownFromNode(child).trim();
          if (text) items.push(`- ${text}`);
        }
      });
      return items;
    }
    if (tag === 'ol') {
      const items: string[] = [];
      let idx = 0;
      Array.from(element.childNodes).forEach((child) => {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const childTag = (child as HTMLElement).tagName.toLowerCase();
          if (childTag === 'li') {
            const text = extractInlineMarkdownFromNode(child).trim();
            if (text) { items.push(`${idx + 1}. ${text}`); idx++; }
          } else if (childTag === 'ul' || childTag === 'ol') {
            // Nested list (browser anomaly) — process as separate list block
            items.push(...extractBlocksFromNode(child));
          } else {
            const text = extractInlineMarkdownFromNode(child).trim();
            if (text) { items.push(`${idx + 1}. ${text}`); idx++; }
          }
        } else {
          const text = extractInlineMarkdownFromNode(child).trim();
          if (text) { items.push(`${idx + 1}. ${text}`); idx++; }
        }
      });
      return items;
    }
    if (tag === 'div' || tag === 'section' || tag === 'article') {
      const blocks = Array.from(element.childNodes).flatMap(extractBlocksFromNode);
      if (blocks.length > 0) return blocks;
      const text = extractInlineMarkdownFromNode(element).trim();
      return text ? [text] : [];
    }

    const text = extractInlineMarkdownFromNode(element).trim();
    return text ? [text] : [];
  };

  const extractMarkdownFromEditorHtml = useCallback((html: string): string => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return '';
    const blocks = Array.from(root.childNodes).flatMap(extractBlocksFromNode);
    return blocks.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }, []);

  const syncNoteEditorFromMarkdown = useCallback((markdown: string) => {
    const editor = noteEditorRef.current;
    if (!editor) return;
    const nextHtml = renderMarkdownToHtml(markdown);
    if (editor.innerHTML === nextHtml) return;
    noteEditorSyncingRef.current = true;
    editor.innerHTML = nextHtml;
    noteEditorSyncingRef.current = false;
  }, [renderMarkdownToHtml]);

  // Sync markdown from editor DOM — does NOT touch pending inline state.
  const syncNoteContentFromEditor = useCallback(() => {
    const editor = noteEditorRef.current;
    if (!editor) return;
    const markdown = extractMarkdownFromEditorHtml(editor.innerHTML);
    setNoteContent(markdown);
  }, [extractMarkdownFromEditorHtml]);

  /** Convert stray <div> inside <ul>/<ol> back to <li> (iOS Safari Chinese IME + list-style-type:none) */
  const normalizeListChildDivs = useCallback(() => {
    const editor = noteEditorRef.current;
    if (!editor) return;
    const strayDivs = editor.querySelectorAll('ul > div, ol > div');
    if (strayDivs.length === 0) return;
    strayDivs.forEach((div) => {
      const li = document.createElement('li');
      while (div.firstChild) li.appendChild(div.firstChild);
      div.parentNode!.replaceChild(li, div);
    });
  }, []);

  /** Normalize <b> → <strong> and <i> → <em> so CSS targeting strong/em always works
   *  (execCommand('bold') creates <b> on Safari, but user CSS targets <strong>)
   *  Preserves cursor position across the replacement. */
  const normalizeInlineTags = useCallback(() => {
    const editor = noteEditorRef.current;
    if (!editor) return;
    // Early return if nothing to normalize — avoids touching the selection,
    // which would destroy the browser's pending execCommand format state
    // (e.g. bold mode toggled at a collapsed cursor on iOS Safari).
    if (!editor.querySelector('b') && !editor.querySelector('i')) return;

    // Save selection
    const sel = window.getSelection();
    let savedAnchorNode = sel?.anchorNode ?? null;
    let savedAnchorOffset = sel?.anchorOffset ?? 0;
    let savedFocusNode = sel?.focusNode ?? null;
    let savedFocusOffset = sel?.focusOffset ?? 0;

    const tagsToNormalize: Array<[string, string]> = [['b', 'strong'], ['i', 'em']];
    for (const [from, to] of tagsToNormalize) {
      const elements = editor.querySelectorAll(from);
      elements.forEach((el) => {
        const replacement = document.createElement(to);
        while (el.firstChild) replacement.appendChild(el.firstChild);
        el.parentNode!.replaceChild(replacement, el);
        // Update saved selection refs if they pointed to the replaced element
        if (savedAnchorNode === el) savedAnchorNode = replacement;
        if (savedFocusNode === el) savedFocusNode = replacement;
      });
    }

    // Restore selection
    if (sel && savedAnchorNode && editor.contains(savedAnchorNode)) {
      try {
        const range = document.createRange();
        range.setStart(savedAnchorNode, savedAnchorOffset);
        if (savedFocusNode && editor.contains(savedFocusNode)) {
          range.setEnd(savedFocusNode, savedFocusOffset);
        } else {
          range.collapse(true);
        }
        sel.removeAllRanges();
        sel.addRange(range);
      } catch { /* offset out of bounds — browser will recover */ }
    }
  }, []);

  const handleNoteEditorInput = useCallback(() => {
    if (noteEditorSyncingRef.current) return;
    if (!noteEditorComposingRef.current) {
      normalizeListChildDivs();
      normalizeInlineTags();
    }
    syncNoteContentFromEditor();
  }, [syncNoteContentFromEditor, normalizeListChildDivs, normalizeInlineTags]);

  const areNoteToolbarStatesEqual = (left: NoteToolbarState, right: NoteToolbarState) =>
    left.block === right.block &&
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.orderedList === right.orderedList &&
    left.bulletList === right.bulletList;

  const resolveNoteBlockStyle = useCallback((): NoteBlockStyleTag | null => {
    const editor = noteEditorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return null;

    const anchorNode = selection.anchorNode;
    if (!anchorNode || !editor.contains(anchorNode)) return null;

    let probe: Node | null = anchorNode;
    while (probe && probe !== editor) {
      if (probe.nodeType === Node.ELEMENT_NODE) {
        const tag = (probe as HTMLElement).tagName.toLowerCase();
        if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'p') return tag as NoteBlockStyleTag;
      }
      probe = probe.parentNode;
    }
    return 'p';
  }, []);


  const resolveNoteSelectionSnapshot = useCallback((): {
    selection: Selection;
    range: Range;
    editor: HTMLDivElement;
    collapsed: boolean;
    currentBlock: HTMLElement | null;
  } | null => {
    const editor = noteEditorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if (!anchorNode || !focusNode) return null;
    if (!editor.contains(anchorNode) || !editor.contains(focusNode)) return null;

    let currentBlock: HTMLElement | null = null;
    let probe: Node | null = anchorNode;
    while (probe && probe !== editor) {
      if (probe.nodeType === Node.ELEMENT_NODE) {
        const element = probe as HTMLElement;
        const tag = element.tagName.toLowerCase();
        if (tag === 'p' || tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'li') {
          currentBlock = element;
          break;
        }
      }
      probe = probe.parentNode;
    }
    if (!currentBlock) {
      const firstBlock = editor.querySelector('p, h1, h2, h3, li');
      currentBlock = firstBlock instanceof HTMLElement ? firstBlock : null;
    }

    return {
      selection,
      range,
      editor,
      collapsed: selection.isCollapsed,
      currentBlock,
    };
  }, []);

  const isNoteBlockEffectivelyEmpty = useCallback((element: HTMLElement) => {
    const text = (element.textContent || '').replace(/\u200B/g, '').trim();
    if (text) return false;
    const hasMedia = !!element.querySelector('img, video, audio, iframe, table, blockquote, pre');
    return !hasMedia;
  }, []);

  const placeCaretAtNodeStart = useCallback((selection: Selection, node: HTMLElement) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const insertTypingTargetAfterCurrentBlock = useCallback((target: NoteBlockStyleTag | NoteListStyleKey) => {
    const snapshot = resolveNoteSelectionSnapshot();
    if (!snapshot) return false;

    const { selection, editor, currentBlock } = snapshot;
    let anchor: HTMLElement | null = currentBlock
      ? ((currentBlock.tagName.toLowerCase() === 'li'
        ? (currentBlock.closest('ol, ul') as HTMLElement | null)
        : currentBlock) || currentBlock)
      : editor.lastElementChild as HTMLElement | null;

    // Walk up to ensure anchor is a direct child of editor (prevents nesting lists)
    while (anchor && anchor.parentElement && anchor.parentElement !== editor) {
      anchor = anchor.parentElement;
    }
    if (!anchor || anchor.parentElement !== editor) anchor = editor.lastElementChild as HTMLElement | null;

    let insertRoot: HTMLElement;
    let caretNode: HTMLElement;
    if (target === 'ordered-list' || target === 'bullet-list') {
      const list = document.createElement(target === 'ordered-list' ? 'ol' : 'ul');
      const item = document.createElement('li');
      item.appendChild(document.createElement('br'));
      list.appendChild(item);
      insertRoot = list;
      caretNode = item;
    } else {
      const block = document.createElement(target);
      block.appendChild(document.createElement('br'));
      insertRoot = block;
      caretNode = block;
    }

    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(insertRoot, anchor.nextSibling);
    } else {
      editor.appendChild(insertRoot);
    }
    editor.focus();
    placeCaretAtNodeStart(selection, caretNode);
    return true;
  }, [placeCaretAtNodeStart, resolveNoteSelectionSnapshot]);

  const refreshNoteToolbarState = useCallback(() => {
    const editor = noteEditorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const anchorNode = selection.anchorNode;
    if (!anchorNode || !editor.contains(anchorNode)) return;

    // DOM traversal for block type and list detection
    let block: NoteBlockStyleTag | null = null;
    let inOrderedList = false;
    let inBulletList = false;

    let probe: Node | null = anchorNode;
    while (probe && probe !== editor) {
      if (probe.nodeType === Node.ELEMENT_NODE) {
        const tag = (probe as HTMLElement).tagName.toLowerCase();
        if (!block && (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'p')) block = tag as NoteBlockStyleTag;
        if (!inOrderedList && tag === 'ol') inOrderedList = true;
        if (!inBulletList && tag === 'ul') inBulletList = true;
      }
      probe = probe.parentNode;
    }
    if (!block && !inOrderedList && !inBulletList) block = 'p';

    // Use queryCommandState for bold/italic — this is the browser's authoritative
    // source of truth, including its internal "pending" state for collapsed cursors.
    // Reliable now that headings have font-weight: normal !important in CSS.
    const hasBold = document.queryCommandState('bold');
    const hasItalic = document.queryCommandState('italic');

    const nextState: NoteToolbarState = {
      block: block || null,
      bold: hasBold,
      italic: hasItalic,
      orderedList: inOrderedList,
      bulletList: inBulletList,
    };
    setNoteToolbarState((prev) => (areNoteToolbarStatesEqual(prev, nextState) ? prev : nextState));
  }, []);

  const runNoteEditorCommand = useCallback((command: string, value?: string) => {
    const editor = noteEditorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false, value);
    window.requestAnimationFrame(() => {
      syncNoteContentFromEditor();
      refreshNoteToolbarState();
    });
  }, [syncNoteContentFromEditor, refreshNoteToolbarState]);

  const toggleNoteBlockStyle = useCallback((blockTag: NoteBlockStyleTag) => {
    const snapshot = resolveNoteSelectionSnapshot();
    const current = resolveNoteBlockStyle();
    const next = current === blockTag ? 'p' : blockTag;

    if (snapshot?.collapsed) {
      const currentBlock = snapshot.currentBlock;
      const hasExistingText = currentBlock
        ? !isNoteBlockEffectivelyEmpty(currentBlock)
        : !!snapshot.editor.textContent?.trim();
      if (hasExistingText) {
        insertTypingTargetAfterCurrentBlock(next);
        window.requestAnimationFrame(() => {
          syncNoteContentFromEditor();
          refreshNoteToolbarState();
        });
        return;
      }
    }

    runNoteEditorCommand('formatBlock', next);
  }, [syncNoteContentFromEditor, insertTypingTargetAfterCurrentBlock, isNoteBlockEffectivelyEmpty, refreshNoteToolbarState, resolveNoteBlockStyle, resolveNoteSelectionSnapshot, runNoteEditorCommand]);

  const toggleNoteInlineStyle = useCallback((styleKey: NoteInlineStyleKey) => {
    const editor = noteEditorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(styleKey, false);
    // queryCommandState now reflects the new state immediately after execCommand
    refreshNoteToolbarState();
    syncNoteContentFromEditor();
  }, [syncNoteContentFromEditor, refreshNoteToolbarState]);

  const toggleNoteListStyle = useCallback((styleKey: NoteListStyleKey) => {
    const snapshot = resolveNoteSelectionSnapshot();
    const isOrdered = styleKey === 'ordered-list';
    const isAlreadyActive = isOrdered ? noteToolbarState.orderedList : noteToolbarState.bulletList;

    if (snapshot?.collapsed) {
      const currentBlock = snapshot.currentBlock;
      const hasExistingText = currentBlock
        ? !isNoteBlockEffectivelyEmpty(currentBlock)
        : !!snapshot.editor.textContent?.trim();
      if (hasExistingText) {
        const nextTarget: NoteBlockStyleTag | NoteListStyleKey = isAlreadyActive ? 'p' : styleKey;
        insertTypingTargetAfterCurrentBlock(nextTarget);
        window.requestAnimationFrame(() => {
          syncNoteContentFromEditor();
          refreshNoteToolbarState();
        });
        return;
      }

      // Empty block → replace it directly in DOM to avoid execCommand + CSS reflow
      // caret-jump bug (custom CSS ::before pseudo-elements on UL LI can cause
      // the browser to misplace the caret after insertUnorderedList).
      if (currentBlock && !isAlreadyActive) {
        const list = document.createElement(isOrdered ? 'ol' : 'ul');
        const item = document.createElement('li');
        item.appendChild(document.createElement('br'));
        list.appendChild(item);

        const isLiInList = currentBlock.tagName.toLowerCase() === 'li';
        if (isLiInList) {
          // Switching list type (e.g. OL→UL): remove <li> from old list,
          // insert new list at editor top-level to prevent nesting.
          const parentList = currentBlock.closest('ol, ul');
          if (parentList) {
            parentList.removeChild(currentBlock);
            if (parentList.children.length === 0) {
              // Old list is now empty — replace it with the new list
              parentList.parentNode?.replaceChild(list, parentList);
            } else {
              // Old list still has items — insert new list after it at editor level
              let topAnchor: HTMLElement | null = parentList as HTMLElement;
              while (topAnchor.parentElement && topAnchor.parentElement !== snapshot.editor) {
                topAnchor = topAnchor.parentElement;
              }
              topAnchor.parentNode?.insertBefore(list, topAnchor.nextSibling);
            }
          } else {
            snapshot.editor.appendChild(list);
          }
        } else {
          // Normal case (empty <p>, <h1> etc.) — direct replacement
          currentBlock.parentNode?.replaceChild(list, currentBlock);
        }

        snapshot.editor.focus();
        placeCaretAtNodeStart(snapshot.selection, item);
        window.requestAnimationFrame(() => {
          syncNoteContentFromEditor();
          refreshNoteToolbarState();
        });
        return;
      }
    }

    runNoteEditorCommand(isOrdered ? 'insertOrderedList' : 'insertUnorderedList');
  }, [syncNoteContentFromEditor, insertTypingTargetAfterCurrentBlock, isNoteBlockEffectivelyEmpty, noteToolbarState.bulletList, noteToolbarState.orderedList, refreshNoteToolbarState, resolveNoteSelectionSnapshot, runNoteEditorCommand, placeCaretAtNodeStart]);

  const handleNoteStyleButtonPointerDown = useCallback((key: NoteStylePresetKey, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setNoteToolbarPressedKey(key);
  }, []);

  const clearPressedNoteStyleButton = useCallback(() => {
    setNoteToolbarPressedKey(null);
  }, []);

  const handleNoteEditorPaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    document.execCommand('insertText', false, text);
    window.requestAnimationFrame(() => {
      syncNoteContentFromEditor();
      refreshNoteToolbarState();
    });
  }, [syncNoteContentFromEditor, refreshNoteToolbarState]);

  const noteStylePresets: Array<{
    key: NoteStylePresetKey;
    label: string;
    icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
    onClick: () => void;
    active: boolean;
  }> = [
    { key: 'heading-1', label: '一级标题', icon: Heading1, onClick: () => toggleNoteBlockStyle('h1'), active: noteToolbarState.block === 'h1' },
    { key: 'heading-2', label: '二级标题', icon: Heading2, onClick: () => toggleNoteBlockStyle('h2'), active: noteToolbarState.block === 'h2' },
    { key: 'heading-3', label: '三级标题', icon: Heading3, onClick: () => toggleNoteBlockStyle('h3'), active: noteToolbarState.block === 'h3' },
    { key: 'body', label: '正文段落', icon: Pilcrow, onClick: () => toggleNoteBlockStyle('p'), active: noteToolbarState.block === 'p' },
    { key: 'bold', label: '粗体', icon: Bold, onClick: () => toggleNoteInlineStyle('bold'), active: noteToolbarState.bold },
    { key: 'italic', label: '斜体', icon: Italic, onClick: () => toggleNoteInlineStyle('italic'), active: noteToolbarState.italic },
    { key: 'ordered-list', label: '有序列表', icon: ListOrdered, onClick: () => toggleNoteListStyle('ordered-list'), active: noteToolbarState.orderedList },
    { key: 'bullet-list', label: '无序列表', icon: ListIcon, onClick: () => toggleNoteListStyle('bullet-list'), active: noteToolbarState.bulletList },
  ];

  useEffect(() => {
    if (notesView !== 'editor') return;
    syncNoteEditorFromMarkdown(noteContent);
  }, [notesView, activeNote?.id, syncNoteEditorFromMarkdown]);

  useEffect(() => {
    if (notesView !== 'editor') {
      setNoteToolbarState(DEFAULT_NOTE_TOOLBAR_STATE);
      setNoteToolbarPressedKey(null);
      setIsNoteEditorFocused(false);
      return;
    }
    const handleSelectionChange = () => {
      refreshNoteToolbarState();
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    window.requestAnimationFrame(refreshNoteToolbarState);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [notesView, activeNote?.id, refreshNoteToolbarState]);

  useEffect(() => {
    if (!noteToolbarPressedKey) return;
    const release = () => setNoteToolbarPressedKey(null);
    window.addEventListener('pointerup', release, { passive: true });
    window.addEventListener('pointercancel', release, { passive: true });
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [noteToolbarPressedKey]);

  const filterBooks = (searchTerm: string, selectedTags: string[]) => {
    return books.filter((book) => {
      const matchesSearch = book.title.toLowerCase().includes(searchTerm.toLowerCase()) || book.author.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesTags = selectedTags.length === 0 || selectedTags.every((tag) => book.tags?.includes(tag));
      return matchesSearch && matchesTags;
    });
  };

  const getNotebookCoverUrl = (nb: Notebook): string => {
    if (nb.coverUrl) return nb.coverUrl;
    const firstBook = nb.boundBookIds.length > 0 ? getBook(nb.boundBookIds[0]) : null;
    return firstBook?.coverUrl || '';
  };

  // ─── Notes view transition (matching Settings.tsx pattern) ───
  const NOTES_VIEW_TRANSITION_MS = 260;

  const switchNotesView = useCallback((view: NotesView, beforeSwitch?: () => void) => {
    if (isSwitchingNotesView || view === notesView) {
      beforeSwitch?.();
      return;
    }
    setIsSwitchingNotesView(true);
    setNotesViewAnimClass('app-view-exit-right');

    if (notesViewTimerRef.current) window.clearTimeout(notesViewTimerRef.current);
    if (notesViewUnlockRef.current) window.clearTimeout(notesViewUnlockRef.current);

    notesViewTimerRef.current = window.setTimeout(() => {
      beforeSwitch?.();
      setNotesView(view);
      setNotesViewAnimClass('app-view-enter-left');
      notesViewUnlockRef.current = window.setTimeout(() => {
        setIsSwitchingNotesView(false);
        setNotesViewAnimClass('');
      }, NOTES_VIEW_TRANSITION_MS);
    }, NOTES_VIEW_TRANSITION_MS);
  }, [isSwitchingNotesView, notesView]);

  // ─── Quiz view transition (mirroring notes pattern) ───
  const QUIZ_VIEW_TRANSITION_MS = 260;

  const switchQuizView = useCallback((view: QuizView, beforeSwitch?: () => void) => {
    if (isSwitchingQuizView || view === quizView) {
      beforeSwitch?.();
      return;
    }
    setIsSwitchingQuizView(true);
    setQuizViewAnimClass('app-view-exit-right');

    if (quizViewTimerRef.current) window.clearTimeout(quizViewTimerRef.current);
    if (quizViewUnlockRef.current) window.clearTimeout(quizViewUnlockRef.current);

    quizViewTimerRef.current = window.setTimeout(() => {
      beforeSwitch?.();
      setQuizView(view);
      setQuizViewAnimClass('app-view-enter-left');
      quizViewUnlockRef.current = window.setTimeout(() => {
        setIsSwitchingQuizView(false);
        setQuizViewAnimClass('');
      }, QUIZ_VIEW_TRANSITION_MS);
    }, QUIZ_VIEW_TRANSITION_MS);
  }, [isSwitchingQuizView, quizView]);

  // ─── Top-level tab transition (notes / highlights / quiz) ───
  const HUB_TAB_TRANSITION_MS = 260;

  const switchHubTab = useCallback((nextTab: HubTab) => {
    setActiveTab(nextTab);
    if (nextTab === renderedTab && !isSwitchingHubTab) return;

    setIsSwitchingHubTab(true);
    setHubTabAnimClass('app-view-exit-right');

    if (hubTabTimerRef.current) window.clearTimeout(hubTabTimerRef.current);
    if (hubTabUnlockRef.current) window.clearTimeout(hubTabUnlockRef.current);

    hubTabTimerRef.current = window.setTimeout(() => {
      setRenderedTab(nextTab);
      setHubTabAnimClass('app-view-enter-left');
      hubTabUnlockRef.current = window.setTimeout(() => {
        setIsSwitchingHubTab(false);
        setHubTabAnimClass('');
      }, HUB_TAB_TRANSITION_MS);
    }, HUB_TAB_TRANSITION_MS);
  }, [renderedTab, isSwitchingHubTab]);

  // ─── Modal close helpers ───
  const closeCreateModal = () => {
    setClosingCreateModal(true);
    setTimeout(() => {
      setShowCreateModal(false);
      setClosingCreateModal(false);
    }, 220);
  };

  const closeEditModal = () => {
    setClosingEditModal(true);
    setTimeout(() => {
      setShowEditModal(false);
      setClosingEditModal(false);
      setEditingNotebookId(null);
    }, 220);
  };

  const closeQuizConfigModal = () => {
    setClosingQuizConfigModal(true);
    setTimeout(() => {
      setShowQuizConfigModal(false);
      setClosingQuizConfigModal(false);
    }, 220);
  };

  // ─── Notebook CRUD ───
  const handleCreateNotebook = async () => {
    if (createSelectedBookIds.length === 0) return;
    const title = createTitle.trim() || createSelectedBookIds.map((id) => getBook(id)?.title || '').filter(Boolean).join('、');
    const nb: Notebook = {
      id: uid(),
      title,
      personaId: createPersonaId,
      boundBookIds: createSelectedBookIds,
      coverUrl: createCoverUrl || undefined,
      paperCssPresets: DEFAULT_PAPER_CSS_PRESETS.map((p) => ({ ...p })),
      selectedPaperCssPresetId: DEFAULT_PAPER_CSS_PRESET_ID,
      notes: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveNotebook(nb);
    setNotebooks((prev) => [nb, ...prev]);
    closeCreateModal();
    setCreateTitle('');
    setCreateSelectedBookIds([]);
    setCreateSearchTerm('');
    setCreateSelectedTags([]);
    setCreateCoverUrl('');
    setCoverUrlInputMode(false);
    setTempCoverUrl('');
  };

  const handleDeleteNotebook = async (id: string) => {
    await deleteNotebook(id);
    setNotebooks((prev) => prev.filter((n) => n.id !== id));
    setDeleteConfirmId(null);
  };

  const openNotebook = (nb: Notebook) => {
    switchNotesView('detail', () => setActiveNotebook(nb));
  };

  const openEditNotebookModal = (e: React.MouseEvent, nb: Notebook) => {
    e.stopPropagation();
    setEditingNotebookId(nb.id);
    setEditTitle(nb.title);
    setEditSelectedBookIds([...nb.boundBookIds]);
    setEditCoverUrl(nb.coverUrl || '');
    setEditCoverUrlInputMode(false);
    setEditTempCoverUrl('');
    setEditSearchTerm('');
    setEditSelectedTags([]);
    setEditFilterOpen(false);
    setShowEditModal(true);
  };

  const handleSaveEditNotebook = async () => {
    if (!editingNotebookId || editSelectedBookIds.length === 0) return;
    const nb = notebooks.find((n) => n.id === editingNotebookId);
    if (!nb) return;
    const title = editTitle.trim() || editSelectedBookIds.map((id) => getBook(id)?.title || '').filter(Boolean).join('、');
    const updated: Notebook = {
      ...nb,
      title,
      boundBookIds: editSelectedBookIds,
      coverUrl: editCoverUrl || undefined,
      updatedAt: Date.now(),
    };
    await saveNotebook(updated);
    setNotebooks((prev) => prev.map((n) => n.id === updated.id ? updated : n));
    if (activeNotebook?.id === updated.id) setActiveNotebook(updated);
    closeEditModal();
  };

  // ─── Cover upload helpers ───
  const handleCoverFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, isEdit: boolean) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const imageRef = await saveImageFile(file);
      if (isEdit) {
        setEditCoverUrl(imageRef);
      } else {
        setCreateCoverUrl(imageRef);
      }
    } catch (err) {
      console.error('Cover upload error:', err);
    }
    e.target.value = '';
  };

  // ─── Paper background helpers ───
  const closePaperModal = () => {
    setClosingPaperModal(true);
    setTimeout(() => { setShowPaperModal(false); setClosingPaperModal(false); }, 220);
  };

  const handlePaperFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeNotebook) return;
    try {
      const imageRef = await saveImageFile(file);
      const updated = { ...activeNotebook, paperBgUrl: imageRef, updatedAt: Date.now() };
      await saveNotebook(updated);
      setActiveNotebook(updated);
      setNotebooks((prev) => prev.map((n) => n.id === updated.id ? updated : n));
      closePaperModal();
    } catch (err) {
      console.error('Paper bg upload error:', err);
    }
    e.target.value = '';
  };

  const handlePaperUrlConfirm = async () => {
    if (!activeNotebook || !tempPaperUrl.trim()) return;
    const updated = { ...activeNotebook, paperBgUrl: tempPaperUrl.trim(), updatedAt: Date.now() };
    await saveNotebook(updated);
    setActiveNotebook(updated);
    setNotebooks((prev) => prev.map((n) => n.id === updated.id ? updated : n));
    closePaperModal();
  };

  const handlePaperReset = async () => {
    if (!activeNotebook) return;
    const updated = { ...activeNotebook, paperBgUrl: undefined, updatedAt: Date.now() };
    await saveNotebook(updated);
    setActiveNotebook(updated);
    setNotebooks((prev) => prev.map((n) => n.id === updated.id ? updated : n));
    closePaperModal();
  };

  // ─── Paper CSS editor handlers ───

  const updateNotebook = async (patch: Partial<Notebook>) => {
    if (!activeNotebook) return;
    const updated = normalizeNotebookPaperCss({ ...activeNotebook, ...patch, updatedAt: Date.now() });
    setActiveNotebook(updated);
    setNotebooks((prev) => prev.map((n) => n.id === updated.id ? updated : n));
    await saveNotebook(updated);
  };

  /** Apply = visual only — inject CSS but don't persist to the preset */
  const handleApplyPaperCss = async () => {
    normalizeInlineTags();
    await updateNotebook({ paperCssDraft, paperCssApplied: paperCssDraft });
  };

  const handleClearPaperCss = async () => {
    setPaperCssDraft('');
    await updateNotebook({
      paperCssDraft: '',
      paperCssApplied: '',
      selectedPaperCssPresetId: DEFAULT_PAPER_CSS_PRESET_ID,
    });
  };

  const handleSavePaperCssPreset = (name: string) => {
    const safeName = name.trim();
    if (!safeName || !activeNotebook) {
      showNotification('请输入预设名称', 'error');
      return;
    }
    const nextId = `paper-css-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newPreset: ReaderCssPreset = { id: nextId, name: safeName, css: paperCssDraft };
    const nextPresets = [...(activeNotebook.paperCssPresets ?? DEFAULT_PAPER_CSS_PRESETS), newPreset];
    void updateNotebook({ paperCssPresets: nextPresets, selectedPaperCssPresetId: nextId, paperCssApplied: paperCssDraft });
  };

  const handleDeletePaperCssPreset = (presetId: string) => {
    if (!activeNotebook || presetId === DEFAULT_PAPER_CSS_PRESET_ID) return;
    const prev = activeNotebook.paperCssPresets ?? [...DEFAULT_PAPER_CSS_PRESETS];
    const next = prev.filter((p) => p.id !== presetId);
    const resetSelected = activeNotebook.selectedPaperCssPresetId === presetId;
    void updateNotebook({
      paperCssPresets: next,
      ...(resetSelected ? { selectedPaperCssPresetId: DEFAULT_PAPER_CSS_PRESET_ID, paperCssDraft: '', paperCssApplied: '' } : {}),
    });
    if (resetSelected) setPaperCssDraft('');
  };

  const handleRenamePaperCssPreset = (presetId: string, name: string) => {
    const safeName = name.trim();
    if (!safeName || !activeNotebook) {
      showNotification('请输入新的预设名称', 'error');
      return;
    }
    const next = (activeNotebook.paperCssPresets ?? [...DEFAULT_PAPER_CSS_PRESETS]).map((p) =>
      p.id === presetId ? { ...p, name: safeName, css: paperCssDraft } : p,
    );
    void updateNotebook({ paperCssPresets: next, paperCssApplied: paperCssDraft });
  };

  const handleSelectPaperCssPreset = (presetId: string | null) => {
    if (!activeNotebook || !presetId) return;
    const preset = (activeNotebook.paperCssPresets ?? DEFAULT_PAPER_CSS_PRESETS).find((p) => p.id === presetId);
    if (!preset) return;
    const normalizedCss = normalizeLegacyPaperCss(preset.css);
    setPaperCssDraft(normalizedCss);
    void updateNotebook({ selectedPaperCssPresetId: presetId, paperCssDraft: normalizedCss });
  };

  // ─── Note CRUD ───
  const handleAddNote = () => {
    if (!activeNotebook) return;
    const note: StudyNote = {
      id: uid(),
      content: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      commentThreads: [],
    };
    const updated = { ...activeNotebook, notes: [note, ...activeNotebook.notes], updatedAt: Date.now() };
    switchNotesView('editor', () => {
      setActiveNotebook(updated);
      setActiveNote(note);
      setNoteContent('');
    });
    saveNotebook(updated);
    setNotebooks((prev) => prev.map((n) => n.id === updated.id ? updated : n));
  };

  const handleSaveNote = useCallback(() => {
    if (!activeNotebook || !activeNote) return;
    // Read directly from editor DOM to guarantee latest content (avoids stale-state edge cases)
    const editor = noteEditorRef.current;
    const latestContent = (editor && notesView === 'editor')
      ? extractMarkdownFromEditorHtml(editor.innerHTML)
      : noteContent;
    const updatedNote = { ...activeNote, content: latestContent, updatedAt: Date.now() };
    const updatedNb = {
      ...activeNotebook,
      notes: activeNotebook.notes.map((n) => n.id === updatedNote.id ? updatedNote : n),
      updatedAt: Date.now(),
    };
    setActiveNote(updatedNote);
    setActiveNotebook(updatedNb);
    saveNotebook(updatedNb);
    setNotebooks((prev) => prev.map((n) => n.id === updatedNb.id ? updatedNb : n));
  }, [activeNotebook, activeNote, noteContent, notesView, extractMarkdownFromEditorHtml]);

  const openNoteEditor = (note: StudyNote) => {
    switchNotesView('editor', () => {
      setActiveNote(note);
      setNoteContent(note.content);
    });
  };

  const handleDeleteNote = (noteId: string) => {
    if (!activeNotebook) return;
    const updated = {
      ...activeNotebook,
      notes: activeNotebook.notes.filter((n) => n.id !== noteId),
      updatedAt: Date.now(),
    };
    setActiveNotebook(updated);
    saveNotebook(updated);
    setNotebooks((prev) => prev.map((n) => n.id === updated.id ? updated : n));
  };

  // ─── RAG：检索相关片段（全书候选 + 发送前按阅读进度过滤防剧透） ───
  const buildStudyHubRagQuery = (params: {
    noteText?: string;
    latestUserReply?: string;
  }): string => {
    const noteText = sanitizeTextForAiPrompt(params.noteText || '').trim();
    const latestUserReply = sanitizeTextForAiPrompt(params.latestUserReply || '').trim();
    if (latestUserReply && noteText) return `${latestUserReply}\n${noteText}`.slice(-1200);
    if (latestUserReply) return latestUserReply.slice(-1200);
    if (noteText) return noteText.slice(-1200);
    return '';
  };

  const getRagContext = async (
    query: string,
    bookIds: string[],
    options?: { topK?: number; perBook?: boolean },
  ): Promise<Record<string, string>> => {
    const normalizedQuery = sanitizeTextForAiPrompt(query || '').trim();
    if (!normalizedQuery) return {};

    // 只对开启了 RAG 的书籍执行检索，每本书独立检测
    const ragEnabledBookIds = bookIds.filter((id) => {
      const book = books.find((b) => b.id === id);
      return book?.ragEnabled;
    });
    if (ragEnabledBookIds.length === 0) return {};

    const wasNotLoaded = !isEmbedModelLoaded();
    if (wasNotLoaded) showNotification('RAG 语义模型首次加载中…');

    let hadAnySuccess = false;
    let hadAnyFailure = false;
    try {
      const topK = options?.topK || 3;
      const perBook = options?.perBook || false;

      // 准备每本书的安全偏移量（仅 RAG 已启用的书）
      const bookInfos: Array<{ bookId: string; title: string; safeOffset: number }> = [];
      for (const bookId of ragEnabledBookIds) {
        const book = books.find((b) => b.id === bookId);
        if (!book) continue;
        const stored = await getBookContent(bookId);
        const fallbackOffset = Math.max(0, Math.floor(getReadingGlobalCharOffset(book, stored)));
        const safeOffset = estimateRagSafeOffset(
          stored?.chapters || [],
          stored?.readerState?.readingPosition || null,
          fallbackOffset,
        );
        bookInfos.push({ bookId, title: book.title, safeOffset });
      }

      const ragContextByBookId: Record<string, string> = {};
      const retrieveSafeChunksForBook = async (bookId: string, safeOffset: number, targetTopK: number) => {
        if (safeOffset <= 0 || targetTopK <= 0) return [] as Awaited<ReturnType<typeof retrieveRelevantChunks>>;

        // 第一轮：全书范围检索，然后按阅读进度过滤
        const fullScope: Record<string, number> = { [bookId]: Number.MAX_SAFE_INTEGER };
        const candidates = await retrieveRelevantChunks(normalizedQuery, fullScope, {
          topK: targetTopK * 6,
          perBookTopK: targetTopK * 6,
        }, ragApiConfigResolver);

        const safeChunks = candidates
          .filter((chunk) => chunk.endOffset <= safeOffset)
          .slice(0, targetTopK);
        const selected = [...safeChunks];

        // 第二轮回退：直接在安全范围内检索
        if (selected.length < targetTopK) {
          const safeScope: Record<string, number> = { [bookId]: safeOffset };
          const fallbackChunks = await retrieveRelevantChunks(normalizedQuery, safeScope, {
            topK: targetTopK,
            perBookTopK: targetTopK,
          }, ragApiConfigResolver);
          const seen = new Set(selected.map((c) => c.id));
          for (const chunk of fallbackChunks) {
            if (seen.has(chunk.id)) continue;
            seen.add(chunk.id);
            selected.push(chunk);
            if (selected.length >= targetTopK) break;
          }
        }

        return selected.slice(0, targetTopK);
      };

      if (perBook) {
        // ── 逐书独立检索模式：每本书独立获得 topK 个片段 ──
        // 不在 query 中注入书名——perBook 已限定在单本书的 embeddings 中检索，
        // 注入书名反而会让不同 query 的 embedding 过于相似（公共前缀主导向量）。
        for (const { bookId, safeOffset } of bookInfos) {
          try {
            const selected = await retrieveSafeChunksForBook(bookId, safeOffset, topK);
            if (selected.length > 0) {
              ragContextByBookId[bookId] = selected.map((c) => c.text).join('\n---\n');
              hadAnySuccess = true;
            }
          } catch (error) {
            hadAnyFailure = true;
            console.warn(`[RAG] Retrieval failed for book ${bookId}, skipping:`, error);
          }
        }
      } else {
        // ── 全局检索模式（笔记评论等使用）：所有书合起来取 topK ──
        try {
          const offsetByBookId: Record<string, number> = {};
          const fullBookScopeByBookId: Record<string, number> = {};
          for (const { bookId, safeOffset } of bookInfos) {
            offsetByBookId[bookId] = safeOffset;
            fullBookScopeByBookId[bookId] = Number.MAX_SAFE_INTEGER;
          }

          const candidateTopK = Math.max(topK * 6, Math.max(1, bookIds.length) * 8);
          const candidatePerBookTopK = bookIds.length <= 1 ? candidateTopK : 8;
          const candidates = await retrieveRelevantChunks(normalizedQuery, fullBookScopeByBookId, {
            topK: candidateTopK,
            perBookTopK: candidatePerBookTopK,
          }, ragApiConfigResolver);

          const safeChunks = candidates
            .filter((chunk) => chunk.endOffset <= (offsetByBookId[chunk.bookId] || 0))
            .slice(0, topK);
          const selectedChunks = [...safeChunks];

          if (selectedChunks.length < topK) {
            const fallbackPerBookTopK = bookIds.length <= 1 ? topK : 2;
            const fallbackChunks = await retrieveRelevantChunks(normalizedQuery, offsetByBookId, {
              topK,
              perBookTopK: fallbackPerBookTopK,
            }, ragApiConfigResolver);
            const seenChunkIds = new Set(selectedChunks.map((chunk) => chunk.id));
            for (const chunk of fallbackChunks) {
              if (seenChunkIds.has(chunk.id)) continue;
              seenChunkIds.add(chunk.id);
              selectedChunks.push(chunk);
              if (selectedChunks.length >= topK) break;
            }
          }

          if (selectedChunks.length > 0) {
            const groupedChunks: Record<string, string[]> = {};
            for (const chunk of selectedChunks.slice(0, topK)) {
              if (!groupedChunks[chunk.bookId]) groupedChunks[chunk.bookId] = [];
              groupedChunks[chunk.bookId].push(chunk.text);
            }
            Object.entries(groupedChunks).forEach(([bookId, texts]) => {
              ragContextByBookId[bookId] = texts.join('\n---\n');
              hadAnySuccess = true;
            });
          }
        } catch (error) {
          hadAnyFailure = true;
          console.warn('[RAG] Global retrieval failed, fallback to per-book retrieval:', error);
          const fallbackPerBookTopK = bookIds.length <= 1 ? topK : 2;
          for (const { bookId, safeOffset } of bookInfos) {
            try {
              const selected = await retrieveSafeChunksForBook(bookId, safeOffset, fallbackPerBookTopK);
              if (selected.length > 0) {
                ragContextByBookId[bookId] = selected.map((c) => c.text).join('\n---\n');
                hadAnySuccess = true;
              }
            } catch (bookError) {
              hadAnyFailure = true;
              console.warn(`[RAG] Retrieval failed for book ${bookId}, skipping:`, bookError);
            }
          }
        }
      }

      if (wasNotLoaded && isEmbedModelLoaded()) {
        showNotification('RAG 语义模型加载成功');
      } else if (wasNotLoaded && !hadAnySuccess && hadAnyFailure) {
        showNotification('RAG 语义模型加载失败', 'error');
      }
      return ragContextByBookId;
    } catch (err) {
      console.warn('[RAG] Retrieval failed, continuing without:', err);
      if (wasNotLoaded) showNotification('RAG 语义模型加载失败', 'error');
    }
    return {};
  };

  // ─── AI Comment (multi-character batch) ───
  const handleSummonAiCommentBatch = async () => {
    if (!activeNotebook || !activeNote || isAiLoading || selectedCharIds.length === 0) return;
    setShowCharSelect(false);
    setIsAiLoading(true);

    const persona = getPersona(activeNotebook.personaId);
    if (!persona) { setIsAiLoading(false); return; }

    let currentNote = activeNote;

    for (const charId of selectedCharIds) {
      const character = getCharacter(charId);
      if (!character) continue;

      try {
        const controller = new AbortController();
        abortRef.current = controller;

        const bookContexts = await prepareBookContexts(
          books, activeNotebook.boundBookIds, readingExcerptCharCount, readingContextIgnorePanelClip,
        );

        const ragQuery = buildStudyHubRagQuery({ noteText: noteContent });
        const ragContextByBookId = await getRagContext(ragQuery, activeNotebook.boundBookIds, { topK: 3, perBook: true });

        const prompt = buildNoteCommentPrompt({
          userPersona: persona, character, worldBookEntries, noteContent, bookContexts, ragContextByBookId,
        });

        console.log('[StudyHub Prompt]', prompt);

        const reply = await callAiModel(prompt, apiConfig, controller.signal);

        const newThread: StudyNoteCommentThread = {
          id: uid(),
          characterId: character.id,
          characterName: character.nickname || character.name,
          characterAvatar: character.avatar,
          messages: [{ id: uid(), role: 'ai', content: parseStudyHubAiComment(reply), createdAt: Date.now() }],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        currentNote = { ...currentNote, commentThreads: [...currentNote.commentThreads, newThread], updatedAt: Date.now() };
        const updatedNb = {
          ...activeNotebook,
          notes: activeNotebook.notes.map((n) => n.id === currentNote.id ? currentNote : n),
          updatedAt: Date.now(),
        };
        setActiveNote(currentNote);
        setActiveNotebook(updatedNb);
        await saveNotebook(updatedNb);
        setNotebooks((prev) => prev.map((n) => n.id === updatedNb.id ? updatedNb : n));
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') break;
        console.error('AI comment error:', err);
        const msg = err instanceof Error ? err.message : '未知错误';
        showNotification(`AI 评论生成失败：${msg}`, 'error');
      }
    }

    setSelectedCharIds([]);
    setIsAiLoading(false);
    abortRef.current = null;
  };

  const handleReplyToThread = async (threadId: string) => {
    if (!activeNotebook || !activeNote || isAiLoading) return;
    const replyText = (commentReplyInputs[threadId] || '').trim();
    if (!replyText) return;

    const thread = activeNote.commentThreads.find((t) => t.id === threadId);
    if (!thread) return;

    const persona = getPersona(activeNotebook.personaId);
    const character = getCharacter(thread.characterId);
    if (!persona || !character) return;

    // Add user reply immediately
    const userMsg: StudyNoteCommentMessage = { id: uid(), role: 'user', content: replyText, createdAt: Date.now() };
    const updatedMessages = [...thread.messages, userMsg];

    let updatedNote = {
      ...activeNote,
      commentThreads: activeNote.commentThreads.map((t) =>
        t.id === threadId ? { ...t, messages: updatedMessages, updatedAt: Date.now() } : t,
      ),
      updatedAt: Date.now(),
    };
    setActiveNote(updatedNote);
    setCommentReplyInputs((prev) => ({ ...prev, [threadId]: '' }));

    // Call AI for reply
    setIsAiLoading(true);
    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const bookContexts = await prepareBookContexts(
        books, activeNotebook.boundBookIds, readingExcerptCharCount, readingContextIgnorePanelClip,
      );

      const ragQuery = buildStudyHubRagQuery({ noteText: noteContent, latestUserReply: replyText });
      const ragContextByBookId = await getRagContext(ragQuery, activeNotebook.boundBookIds, { topK: 3, perBook: true });

      const previousMessages = updatedMessages.map((m) => ({ role: m.role, content: m.content }));
      const prompt = buildNoteReplyPrompt({
        userPersona: persona, character, worldBookEntries, noteContent,
        bookContexts, previousMessages, latestUserReply: replyText, ragContextByBookId,
      });

      console.log('[StudyHub Prompt]', prompt);

      const aiReply = await callAiModel(prompt, apiConfig, controller.signal);

      const aiMsg: StudyNoteCommentMessage = { id: uid(), role: 'ai', content: parseStudyHubAiComment(aiReply), createdAt: Date.now() };
      const finalMessages = [...updatedMessages, aiMsg];

      updatedNote = {
        ...updatedNote,
        commentThreads: updatedNote.commentThreads.map((t) =>
          t.id === threadId ? { ...t, messages: finalMessages, updatedAt: Date.now() } : t,
        ),
        updatedAt: Date.now(),
      };
      setActiveNote(updatedNote);

      const updatedNb = {
        ...activeNotebook,
        notes: activeNotebook.notes.map((n) => n.id === updatedNote.id ? updatedNote : n),
        updatedAt: Date.now(),
      };
      setActiveNotebook(updatedNb);
      await saveNotebook(updatedNb);
      setNotebooks((prev) => prev.map((n) => n.id === updatedNb.id ? updatedNb : n));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('AI reply error:', err);
      const msg = err instanceof Error ? err.message : '未知错误';
      showNotification(`AI 回复生成失败：${msg}`, 'error');
    } finally {
      setIsAiLoading(false);
      abortRef.current = null;
    }
  };

  // ─── Delete / Refresh AI comment ───
  const handleDeleteAiComment = async (threadId: string, msgIdx: number) => {
    if (!activeNotebook || !activeNote) return;
    let updatedNote: StudyNote;
    if (msgIdx === 0) {
      // Delete entire thread
      updatedNote = { ...activeNote, commentThreads: activeNote.commentThreads.filter((t) => t.id !== threadId), updatedAt: Date.now() };
    } else {
      // Truncate messages to before this AI message
      updatedNote = {
        ...activeNote,
        commentThreads: activeNote.commentThreads.map((t) =>
          t.id === threadId ? { ...t, messages: t.messages.slice(0, msgIdx), updatedAt: Date.now() } : t,
        ),
        updatedAt: Date.now(),
      };
    }
    setActiveNote(updatedNote);
    const updatedNb = { ...activeNotebook, notes: activeNotebook.notes.map((n) => n.id === updatedNote.id ? updatedNote : n), updatedAt: Date.now() };
    setActiveNotebook(updatedNb);
    await saveNotebook(updatedNb);
    setNotebooks((prev) => prev.map((n) => n.id === updatedNb.id ? updatedNb : n));
  };

  const handleRefreshAiComment = async (threadId: string, msgIdx: number) => {
    if (!activeNotebook || !activeNote || isAiLoading) return;
    const thread = activeNote.commentThreads.find((t) => t.id === threadId);
    if (!thread) return;
    const persona = getPersona(activeNotebook.personaId);
    const character = getCharacter(thread.characterId);
    if (!persona || !character) return;

    // Truncate messages for prompt context (don't update UI yet to prevent scroll jump)
    const truncated = thread.messages.slice(0, msgIdx);
    setIsAiLoading(true);

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const bookContexts = await prepareBookContexts(books, activeNotebook.boundBookIds, readingExcerptCharCount, readingContextIgnorePanelClip);

      let prompt: string;
      if (msgIdx === 0) {
        // Re-generate initial comment
        const ragQuery = buildStudyHubRagQuery({ noteText: noteContent });
        const ragContextByBookId = await getRagContext(ragQuery, activeNotebook.boundBookIds, { topK: 3, perBook: true });
        prompt = buildNoteCommentPrompt({ userPersona: persona, character, worldBookEntries, noteContent, bookContexts, ragContextByBookId });
      } else {
        // Re-generate reply (previous message should be user's)
        const previousMessages = truncated.map((m) => ({ role: m.role, content: m.content }));
        const latestUserReply = truncated[truncated.length - 1]?.content || '';
        const ragQuery = buildStudyHubRagQuery({ noteText: noteContent, latestUserReply });
        const ragContextByBookId = await getRagContext(ragQuery, activeNotebook.boundBookIds, { topK: 3, perBook: true });
        prompt = buildNoteReplyPrompt({ userPersona: persona, character, worldBookEntries, noteContent, bookContexts, previousMessages, latestUserReply, ragContextByBookId });
      }

      console.log('[StudyHub Prompt]', prompt);
      const aiReply = await callAiModel(prompt, apiConfig, controller.signal);
      const aiMsg: StudyNoteCommentMessage = { id: uid(), role: 'ai', content: parseStudyHubAiComment(aiReply), createdAt: Date.now() };

      const updatedNote = {
        ...activeNote,
        commentThreads: activeNote.commentThreads.map((t) =>
          t.id === threadId ? { ...t, messages: [...truncated, aiMsg], updatedAt: Date.now() } : t,
        ),
        updatedAt: Date.now(),
      };
      setActiveNote(updatedNote);
      const updatedNb = { ...activeNotebook, notes: activeNotebook.notes.map((n) => n.id === updatedNote.id ? updatedNote : n), updatedAt: Date.now() };
      setActiveNotebook(updatedNb);
      await saveNotebook(updatedNb);
      setNotebooks((prev) => prev.map((n) => n.id === updatedNb.id ? updatedNb : n));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('AI refresh error:', err);
      const msg = err instanceof Error ? err.message : '未知错误';
      showNotification(`AI 评论刷新失败：${msg}`, 'error');
    } finally {
      setIsAiLoading(false);
      abortRef.current = null;
    }
  };

  // ─── Quiz ───
  const handleStartQuiz = async () => {
    if (qcBookIds.length === 0 || !qcPrompt.trim() || isQuizGenerating) return;
    setIsQuizGenerating(true);
    setQuizError('');

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const bookContexts = await prepareBookContexts(
        books, qcBookIds, readingExcerptCharCount, readingContextIgnorePanelClip,
      );

      if (bookContexts.length === 0) {
        setQuizError('无法获取书籍内容，请确认所选书籍已导入且有阅读进度。');
        setIsQuizGenerating(false);
        return;
      }

      const ragQuery = qcPrompt.trim();
      const ragContextByBookId = ragQuery ? await getRagContext(ragQuery, qcBookIds, { topK: 5, perBook: true }) : {};

      const config: QuizConfig = {
        bookIds: qcBookIds,
        questionCount: qcCount,
        questionType: qcType,
        optionCount: qcType === 'truefalse' ? 2 : qcOptionCount,
        customPrompt: qcPrompt,
      };

      const prompt = buildQuizGenerationPrompt({ bookContexts, config, ragContextByBookId });
      console.log('[StudyHub Prompt]', prompt);
      const raw = await callAiModel(prompt, apiConfig, controller.signal);
      const questions = parseQuizQuestions(raw);

      if (questions.length === 0) {
        setQuizError('AI 未能生成有效的题目，请重试或调整提示词。');
        setIsQuizGenerating(false);
        return;
      }

      const session: QuizSession = {
        id: uid(),
        config,
        questions,
        userAnswers: {},
        characterId: activeCharacterId || '',
        characterName: getCharacter(activeCharacterId || '')?.nickname || getCharacter(activeCharacterId || '')?.name || '',
        overallComment: '',
        createdAt: Date.now(),
      };

      setShowQuizConfigModal(false);
      setClosingQuizConfigModal(false);
      switchQuizView('play', () => {
        setActiveQuizSession(session);
        setQuizCurrentIndex(0);
        setQuizUserAnswers({});
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : '未知错误';
      setQuizError(`生成失败：${msg}`);
      showNotification(`问答集生成失败：${msg}`, 'error');
    } finally {
      setIsQuizGenerating(false);
      abortRef.current = null;
    }
  };

  const handleSelectAnswer = (questionId: string, optionIndex: number) => {
    if (!activeQuizSession) return;
    const q = activeQuizSession.questions.find((qq) => qq.id === questionId);
    if (!q) return;

    setQuizUserAnswers((prev) => {
      const current = prev[questionId] || [];
      if (q.type === 'multiple') {
        return { ...prev, [questionId]: current.includes(optionIndex) ? current.filter((i) => i !== optionIndex) : [...current, optionIndex] };
      }
      return { ...prev, [questionId]: [optionIndex] };
    });
  };

  const handleSubmitQuiz = async () => {
    if (!activeQuizSession) return;

    const session = { ...activeQuizSession, userAnswers: quizUserAnswers, completedAt: Date.now() };
    setActiveQuizSession(session);

    // Generate overall comment
    const persona = getPersona(activePersonaId || '');
    const character = getCharacter(activeCharacterId || '');
    if (persona && character) {
      setIsAiLoading(true);
      try {
        const bookTitles = session.config.bookIds.map((id) => getBook(id)?.title || '').filter(Boolean);
        const prompt = buildQuizOverallCommentPrompt({
          userPersona: persona, character, worldBookEntries, questions: session.questions,
          userAnswers: quizUserAnswers, bookTitles,
        });
        console.log('[StudyHub Prompt]', prompt);
        const comment = await callAiModel(prompt, apiConfig);
        session.overallComment = parseStudyHubAiComment(comment);
        session.characterId = character.id;
        session.characterName = character.nickname || character.name;
      } catch (err) {
        console.error('Quiz comment error:', err);
        const msg = err instanceof Error ? err.message : '未知错误';
        session.overallComment = '（总评生成失败）';
        showNotification(`总评生成失败：${msg}`, 'error');
      } finally {
        setIsAiLoading(false);
      }
    }

    setActiveQuizSession(session);
    await saveQuizSession(session);
    setQuizSessions((prev) => {
      const exists = prev.some((s) => s.id === session.id);
      return exists ? prev.map((s) => s.id === session.id ? session : s) : [session, ...prev];
    });
    switchQuizView('result');
  };

  const handleRefreshQuizOverallComment = async () => {
    if (!activeQuizSession || isQuizCommentRefreshing || isAiLoading) return;

    const persona = getPersona(activePersonaId || '');
    const character =
      getCharacter(activeQuizSession.characterId || '') || getCharacter(activeCharacterId || '');
    if (!persona || !character) {
      showNotification('缺少用户人设或角色，无法刷新总评', 'error');
      return;
    }

    setIsQuizCommentRefreshing(true);
    try {
      const bookTitles = activeQuizSession.config.bookIds
        .map((id) => getBook(id)?.title || '')
        .filter(Boolean);
      const prompt = buildQuizOverallCommentPrompt({
        userPersona: persona,
        character,
        worldBookEntries,
        questions: activeQuizSession.questions,
        userAnswers: activeQuizSession.userAnswers,
        bookTitles,
      });
      console.log('[StudyHub Prompt]', prompt);
      const comment = await callAiModel(prompt, apiConfig);
      const refreshedSession: QuizSession = {
        ...activeQuizSession,
        overallComment: parseStudyHubAiComment(comment),
        characterId: character.id,
        characterName: character.nickname || character.name,
      };

      setActiveQuizSession(refreshedSession);
      await saveQuizSession(refreshedSession);
      setQuizSessions((prev) => {
        const exists = prev.some((s) => s.id === refreshedSession.id);
        return exists
          ? prev.map((s) => (s.id === refreshedSession.id ? refreshedSession : s))
          : [refreshedSession, ...prev];
      });
      showNotification('角色总评已刷新');
    } catch (err) {
      console.error('Quiz comment refresh error:', err);
      const msg = err instanceof Error ? err.message : '未知错误';
      showNotification(`总评刷新失败：${msg}`, 'error');
    } finally {
      setIsQuizCommentRefreshing(false);
    }
  };

  const handleDeleteQuizSession = async (id: string) => {
    await deleteQuizSession(id);
    setQuizSessions((prev) => prev.filter((s) => s.id !== id));
    setDeleteConfirmId(null);
  };

  const handleExitQuizPlay = async () => {
    if (!activeQuizSession) { switchQuizView('history'); return; }
    // 保存当前答题进度（即使未完成）
    const session = { ...activeQuizSession, userAnswers: quizUserAnswers };
    await saveQuizSession(session);
    // 如果是新 session 才添加到列表，否则更新
    setQuizSessions((prev) => {
      const exists = prev.some((s) => s.id === session.id);
      return exists ? prev.map((s) => s.id === session.id ? session : s) : [session, ...prev];
    });
    switchQuizView('history', () => { setActiveQuizSession(null); });
  };

  // ─── Book selector (shared UI for create notebook & quiz config) ───
  // Compact list view for notebook modals, grid view for quiz
  const renderBookSelector = (
    searchTerm: string, setSearchTerm: (v: string) => void,
    selectedTags: string[], setSelectedTags: (v: string[]) => void,
    filterOpen: boolean, setFilterOpen: (v: boolean) => void,
    selectedBookIds: string[], toggleBook: (id: string) => void,
    useListView?: boolean,
  ) => {
    const filtered = filterBooks(searchTerm, selectedTags);

    return (
      <div className="space-y-3">
        {/* Search & Filter */}
        <div className="flex gap-2">
          <div className={`flex-1 flex items-center px-3 py-2 rounded-xl gap-2 ${inputClass}`}>
            <Search size={16} className="text-slate-400" />
            <input
              type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索书籍..." className="bg-transparent outline-none w-full text-sm focus:ring-0 focus:outline-none"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
            )}
          </div>
          <div className="relative">
            <button
              onClick={() => setFilterOpen(!filterOpen)}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-95 ${
                filterOpen || selectedTags.length > 0 ? 'bg-rose-400 text-white shadow-md' : `${cardClass} text-slate-400 hover:text-rose-400`
              }`}
            >
              <Filter size={18} />
            </button>
            {filterOpen && (
              <div className={`absolute right-0 top-12 w-48 rounded-2xl p-3 z-30 shadow-xl border border-slate-400/10 animate-fade-in ${cardClass}`}>
                <div className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">按标签筛选</div>
                <div className="flex flex-wrap gap-2">
                  {allTags.map((tag) => (
                    <button key={tag} onClick={() => setSelectedTags(selectedTags.includes(tag) ? selectedTags.filter((t) => t !== tag) : [...selectedTags, tag])}
                      className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                        selectedTags.includes(tag) ? 'bg-rose-400 border-rose-400 text-white'
                        : isDarkMode ? 'border-slate-600 text-slate-400 hover:border-slate-500' : 'border-slate-300 text-slate-500 hover:border-slate-400'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                  {allTags.length === 0 && <span className="text-xs text-slate-500 italic">无标签可用</span>}
                </div>
                {selectedTags.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-slate-200/10">
                    <button onClick={() => setSelectedTags([])} className="text-xs text-rose-400 w-full text-center hover:underline">清除筛选</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Books - List or Grid */}
        {useListView ? (
          <div className="space-y-2 max-h-60 overflow-y-auto p-0.5 -m-0.5">
            {filtered.map((book) => {
              const isSelected = selectedBookIds.includes(book.id);
              return (
                <div key={book.id} onClick={() => toggleBook(book.id)}
                  className={`flex items-center gap-3 p-2 rounded-xl cursor-pointer transition-all active:scale-[0.98] ${isSelected ? 'ring-1 ring-rose-400' : ''} ${isDarkMode ? 'bg-white/5' : 'bg-white'}`}
                >
                  <div className={`w-10 h-14 rounded-lg overflow-hidden flex-shrink-0 ${pressedClass}`}>
                    {book.coverUrl ? (
                      <ResolvedImage src={book.coverUrl} className="w-full h-full object-cover" alt={book.title} />
                    ) : (
                      <div className={`w-full h-full flex items-center justify-center text-[8px] ${subTextClass}`}>{book.title.slice(0, 2)}</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`font-bold text-sm truncate ${headingClass}`}>{book.title}</div>
                    <div className={`text-xs truncate ${subTextClass}`}>{book.author}</div>
                  </div>
                  {isSelected && <CheckCircle2 size={18} className="text-rose-400 flex-shrink-0" />}
                </div>
              );
            })}
            {filtered.length === 0 && <div className={`text-center py-6 text-sm ${subTextClass}`}>暂无匹配的书籍</div>}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 max-h-60 overflow-y-auto p-0.5 -m-0.5">
            {filtered.map((book) => {
              const isSelected = selectedBookIds.includes(book.id);
              return (
                <div key={book.id} onClick={() => toggleBook(book.id)}
                  className={`relative aspect-[3/4] rounded-xl overflow-hidden cursor-pointer transition-all ${isSelected ? 'ring-1 ring-rose-400' : ''} ${isDarkMode ? 'bg-white/5' : 'bg-white'}`}
                >
                  {book.coverUrl ? (
                    <ResolvedImage src={book.coverUrl} className="w-full h-full object-cover" alt={book.title} />
                  ) : (
                    <div className={`w-full h-full flex items-center justify-center text-xs p-1 text-center ${subTextClass}`}>{book.title}</div>
                  )}
                  {isSelected && (
                    <div className="absolute inset-0 bg-rose-400/30 flex items-center justify-center">
                      <CheckCircle2 size={24} className="text-white drop-shadow" />
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5">
                    <span className="text-[10px] text-white line-clamp-1">{book.title}</span>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <div className={`col-span-3 text-center py-6 text-sm ${subTextClass}`}>暂无匹配的书籍</div>}
          </div>
        )}
      </div>
    );
  };

  // ─── Cover upload section (shared for create & edit) ───
  const renderCoverSection = (
    coverUrl: string, setCoverUrl: (v: string) => void,
    urlMode: boolean, setUrlMode: (v: boolean) => void,
    tempUrl: string, setTempUrl: (v: string) => void,
    fileInputRef: React.RefObject<HTMLInputElement | null>,
    isEdit: boolean,
  ) => (
    <div>
      <label className={`text-xs font-medium mb-2 block ${subTextClass}`}>笔记本封面</label>
      <div className="flex items-center gap-4">
        <div className={`w-16 h-20 rounded-lg overflow-hidden flex-shrink-0 ${pressedClass}`}>
          {coverUrl ? (
            <ResolvedImage src={coverUrl} className="w-full h-full object-cover" alt="Cover" />
          ) : (
            <div className={`w-full h-full flex items-center justify-center ${subTextClass}`}>
              <BookPlus size={20} className="opacity-40" />
            </div>
          )}
        </div>
        <div className="flex-1">
          {!urlMode ? (
            <div className="flex gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 ${btnClass} text-slate-500 hover:text-rose-400`}
              >
                <FileUp size={12} /> 本地上传
              </button>
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => handleCoverFileSelect(e, isEdit)} />
              <button
                onClick={() => setUrlMode(true)}
                className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 ${btnClass} text-slate-500 hover:text-rose-400`}
              >
                <Link size={12} /> 网络链接
              </button>
            </div>
          ) : (
            <div className="w-full flex gap-2 animate-fade-in">
              <input
                type="text" value={tempUrl} onChange={(e) => setTempUrl(e.target.value)}
                placeholder="输入图片链接..."
                className={`flex-1 px-3 py-1.5 text-xs rounded-lg outline-none focus:ring-0 focus:outline-none ${inputClass}`}
              />
              <button onClick={() => { setCoverUrl(tempUrl); setUrlMode(false); setTempUrl(''); }} className="text-rose-400"><Check size={16} /></button>
              <button onClick={() => { setUrlMode(false); setTempUrl(''); }} className="text-slate-400"><X size={16} /></button>
            </div>
          )}
          {coverUrl && (
            <button onClick={() => setCoverUrl('')} className="text-[10px] text-rose-400 mt-1 hover:underline">移除封面</button>
          )}
        </div>
      </div>
    </div>
  );

  // ─── Custom persona dropdown (shared for create & edit) ───
  const renderPersonaDropdown = (
    selectedId: string, setSelectedId: (v: string) => void,
    isOpen: boolean, setIsOpen: (v: boolean) => void,
    disabled?: boolean,
  ) => {
    const selectedPersona = getPersona(selectedId);
    return (
      <div className="relative">
        <label className={`text-xs font-medium mb-1 block ${subTextClass}`}>选择笔记本主人（无法更改）</label>
        <div
          onClick={() => !disabled && setIsOpen(!isOpen)}
          className={`w-full p-2 min-h-[42px] rounded-xl flex items-center justify-between transition-all ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer active:scale-[0.99]'} ${inputClass}`}
        >
          <span className="text-sm truncate">{selectedPersona?.name || '请选择'}</span>
          {!disabled && <ChevronDown size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />}
        </div>
        {isOpen && !disabled && (
          <div className={`absolute top-full left-0 right-0 mt-2 p-2 rounded-xl z-[50] max-h-60 overflow-y-auto ${cardClass} border border-slate-400/10 animate-fade-in`}>
            {personas.map((p) => {
              const isSelected = p.id === selectedId;
              return (
                <div key={p.id}
                  onClick={() => { setSelectedId(p.id); setIsOpen(false); }}
                  className={`flex items-center gap-2 p-2 rounded-lg text-sm cursor-pointer transition-colors ${
                    isSelected
                      ? 'text-rose-400 font-bold bg-rose-400/10'
                      : isDarkMode ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <div className={`w-4 h-4 rounded border flex items-center justify-center ${isSelected ? 'bg-rose-400 border-rose-400' : isDarkMode ? 'border-slate-500' : 'border-slate-400'}`}>
                    {isSelected && <Check size={10} className="text-white" />}
                  </div>
                  {p.avatar ? (
                    <ResolvedImage src={p.avatar} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center ${pressedClass}`}><UserCircle size={14} className="text-slate-400" /></div>
                  )}
                  <span className="truncate">{p.name}</span>
                </div>
              );
            })}
            {personas.length === 0 && <div className="p-2 text-center text-xs text-slate-400 italic">暂无人设</div>}
          </div>
        )}
      </div>
    );
  };

  // ══════════════════════════════════════════════
  //  RENDER: Tab Bar (toggle slider style)
  // ══════════════════════════════════════════════

  // ── Highlight collection handlers ──

  const handleCopyHighlight = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showNotification('已复制到剪贴板', 'success');
    } catch { /* ignore */ }
  };

  const handlePronounceVocabulary = (term: string) => {
    const text = term.trim();
    if (!text) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      showNotification('当前浏览器不支持发音', 'error');
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = /[\u4e00-\u9fff]/.test(text) ? 'zh-CN' : 'en-US';
      utterance.rate = 0.95;
      window.speechSynthesis.speak(utterance);
    } catch {
      showNotification('发音失败', 'error');
    }
  };

  const handleDeleteStudyHubHighlight = async (bookId: string, item: ResolvedHighlightItem) => {
    try {
      const content = await getBookContent(bookId);
      if (!content?.readerState?.highlightsByChapter) return;
      const existing = content.readerState.highlightsByChapter[item.chapterKey] || [];
      const updated = existing.filter(
        r => !(r.start === item.range.start && r.end === item.range.end && r.color === item.range.color)
      );
      const nextHighlights = { ...content.readerState.highlightsByChapter };
      if (updated.length === 0) {
        delete nextHighlights[item.chapterKey];
      } else {
        nextHighlights[item.chapterKey] = updated;
      }
      await saveBookReaderState(bookId, { ...content.readerState, highlightsByChapter: nextHighlights });
      setAllBookHighlights(prev =>
        prev.map(entry => {
          if (entry.bookId !== bookId) return entry;
          return { ...entry, items: entry.items.filter(i => i.id !== item.id) };
        }).filter(entry => entry.items.length > 0)
      );
      showNotification('高亮已删除', 'success');
    } catch {
      showNotification('删除失败', 'error');
    }
  };

  const handleDeleteVocabularyEntry = async (bookId: string, vocabEntryId: string) => {
    try {
      const content = await getBookContent(bookId);
      if (!content?.readerState) return;
      const existing = Array.isArray(content.readerState.vocabularyEntries)
        ? content.readerState.vocabularyEntries
        : [];
      const nextEntries = existing.filter((item) => item.id !== vocabEntryId);
      await saveBookReaderState(bookId, { ...content.readerState, vocabularyEntries: nextEntries });
      setAllBookVocabulary((prev) =>
        prev
          .map((entry) => entry.bookId === bookId
            ? { ...entry, items: entry.items.filter((item) => item.id !== vocabEntryId) }
            : entry
          )
          .filter((entry) => entry.items.length > 0)
      );
      showNotification('生词已删除', 'success');
    } catch {
      showNotification('删除失败', 'error');
    }
  };

  const filteredHighlightGroups = useMemo(
    () =>
      allBookHighlights
        .filter((entry) => hubHighlightBookFilter.length === 0 || hubHighlightBookFilter.includes(entry.bookId))
        .map((entry) => ({
          ...entry,
          items: entry.items.filter(
            (item) => !hubHighlightColorFilter || item.range.color === hubHighlightColorFilter
          ),
        }))
        .filter((entry) => entry.items.length > 0),
    [allBookHighlights, hubHighlightBookFilter, hubHighlightColorFilter]
  );

  const filteredVocabularyGroups = useMemo(() => {
    const keyword = vocabularySearchTerm.trim().toLocaleLowerCase();
    return allBookVocabulary
      .filter((entry) => vocabularyBookFilter.length === 0 || vocabularyBookFilter.includes(entry.bookId))
      .map((entry) => ({
        ...entry,
        items: entry.items.filter((item) => {
          if (!keyword) return true;
          return item.term.toLocaleLowerCase().includes(keyword);
        }),
      }))
      .filter((entry) => entry.items.length > 0);
  }, [allBookVocabulary, vocabularyBookFilter, vocabularySearchTerm]);

  const totalVocabularyCount = useMemo(
    () => allBookVocabulary.reduce((acc, entry) => acc + entry.items.length, 0),
    [allBookVocabulary]
  );

  const usedHighlightColors = useMemo(() => {
    const colors = new Set<string>();
    for (const entry of allBookHighlights) {
      for (const item of entry.items) {
        colors.add(item.range.color);
      }
    }
    return colors;
  }, [allBookHighlights]);

  const renderTabBar = () => {
    const tabOrder: HubTab[] = ['notes', 'highlights', 'vocab', 'quiz'];
    const tabIndex = Math.max(0, tabOrder.indexOf(activeTab));
    return (
    <div className={`relative grid grid-cols-4 rounded-xl p-1 mx-6 overflow-hidden ${pressedClass}`}>
      <div
        className={`pointer-events-none absolute top-1 bottom-1 left-1 w-[calc((100%-0.5rem)/4)] rounded-lg transition-transform duration-300 ${isDarkMode ? 'bg-[#2d3748] shadow-[6px_6px_12px_#232b39]' : 'bg-[var(--neu-bg)] shadow-[6px_6px_12px_var(--neu-shadow-dark)]'}`}
        style={{ transform: `translateX(${tabIndex * 100}%)` }}
      />
      <button
        onClick={() => switchHubTab('notes')}
        className={`relative z-10 flex items-center justify-center gap-1 py-2.5 rounded-lg text-sm font-bold transition-colors ${
          activeTab === 'notes' ? (isDarkMode ? 'text-white' : 'text-rose-400') : 'text-slate-500'
        }`}
      >
        <NotebookPen size={14} /> 笔记
      </button>
      <button
        onClick={() => switchHubTab('highlights')}
        className={`relative z-10 flex items-center justify-center gap-1 py-2.5 rounded-lg text-sm font-bold transition-colors ${
          activeTab === 'highlights' ? (isDarkMode ? 'text-white' : 'text-rose-400') : 'text-slate-500'
        }`}
      >
        <Highlighter size={14} /> 摘录
      </button>
      <button
        onClick={() => switchHubTab('vocab')}
        className={`relative z-10 flex items-center justify-center gap-1 py-2.5 rounded-lg text-sm font-bold transition-colors ${
          activeTab === 'vocab' ? (isDarkMode ? 'text-white' : 'text-rose-400') : 'text-slate-500'
        }`}
      >
        <BookMarked size={14} /> 生词
      </button>
      <button
        onClick={() => switchHubTab('quiz')}
        className={`relative z-10 flex items-center justify-center gap-1 py-2.5 rounded-lg text-sm font-bold transition-colors ${
          activeTab === 'quiz' ? (isDarkMode ? 'text-white' : 'text-rose-400') : 'text-slate-500'
        }`}
      >
        <CircleCheckBig size={14} /> 问答
      </button>
    </div>
    );
  };

  // ══════════════════════════════════════════════
  //  RENDER: Notes — Notebook List
  // ══════════════════════════════════════════════

  const renderNotebookList = () => (
    <>
      {/* Fixed header — outside scroll */}
      <div className="flex items-center justify-between px-6 pt-4 pb-2">
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">我的笔记本</h2>
        <button onClick={() => { setShowCreateModal(true); setCreatePersonaId(activePersonaId || personas[0]?.id || ''); }}
          className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-95 ${btnClass} text-rose-400`}
        >
          <Plus size={20} />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 no-scrollbar">
        <div className="pt-3 pb-24 space-y-3 animate-fade-in">
          {notebooks.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <BookPlus size={48} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">还没有笔记本</p>
              <p className="text-xs mt-1">点击右上角 + 创建第一本</p>
            </div>
          )}

          {notebooks.map((nb) => {
            const boundBooks = nb.boundBookIds.map(getBook).filter(Boolean) as Book[];
            const persona = getPersona(nb.personaId);
            const coverUrl = getNotebookCoverUrl(nb);
            return (
              <div key={nb.id} onClick={() => openNotebook(nb)}
                className={`${cardClass} p-4 rounded-2xl cursor-pointer transition-all active:scale-[0.98] ${isDarkMode ? 'active:shadow-[inset_3px_3px_6px_#232b39,inset_-3px_-3px_6px_#374357]' : 'active:shadow-[inset_5px_5px_10px_var(--neu-shadow-dark),inset_-5px_-5px_10px_var(--neu-shadow-light)]'}`}
              >
                <div className="flex items-center gap-3">
                  {/* Notebook cover thumbnail (fixed size) */}
                  <div className={`w-14 h-20 rounded-lg overflow-hidden flex-shrink-0 ${pressedClass}`}>
                    {coverUrl ? (
                      <ResolvedImage src={coverUrl} className="w-full h-full object-cover" alt={nb.title} />
                    ) : (
                      <div className={`w-full h-full flex items-center justify-center ${subTextClass}`}>
                        <BookPlus size={18} className="opacity-40" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className={`font-bold text-sm truncate ${headingClass}`}>{nb.title}</h3>
                    <p className={`text-xs mt-0.5 ${subTextClass}`}>
                      {persona ? persona.name : '未知用户'} · {nb.notes.length} 篇笔记
                    </p>
                    <p className={`text-[10px] mt-1 ${subTextClass}`}>
                      {new Date(nb.updatedAt).toLocaleDateString('zh-CN')}
                    </p>
                    {boundBooks.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {boundBooks.slice(0, 2).map((book) => (
                          <span key={book.id} className={`text-[10px] px-1.5 py-0.5 rounded-md ${isDarkMode ? 'bg-black/20 text-slate-400' : 'bg-slate-200 text-slate-500'}`}>
                            {book.title.length > 6 ? book.title.slice(0, 6) + '...' : book.title}
                          </span>
                        ))}
                        {boundBooks.length > 2 && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-md ${isDarkMode ? 'bg-black/20 text-slate-400' : 'bg-slate-200 text-slate-500'}`}>+{boundBooks.length - 2}</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <button
                      onClick={(e) => openEditNotebookModal(e, nb)}
                      className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${btnClass} ${subTextClass} hover:text-rose-400`}
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(deleteConfirmId === nb.id ? null : nb.id); }}
                      className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${btnClass} ${subTextClass} hover:text-rose-400`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {deleteConfirmId === nb.id && (
                  <div className="mt-3 flex items-center justify-end gap-2 animate-fade-in">
                    <span className="text-xs text-rose-400">确认删除？</span>
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteNotebook(nb.id); }}
                      className="px-3 py-1 bg-rose-400 text-white text-xs rounded-lg">删除</button>
                    <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(null); }}
                      className={`px-3 py-1 text-xs rounded-lg ${btnClass}`}>取消</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );

  // ══════════════════════════════════════════════
  //  RENDER: Create Notebook Modal (centered)
  // ══════════════════════════════════════════════

  const renderCreateModal = () => {
    if (!showCreateModal) return null;

    const toggleBookForCreate = (id: string) => {
      setCreateSelectedBookIds((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);
    };

    return (
      <ModalPortal>
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-500/20 backdrop-blur-sm ${closingCreateModal ? 'app-fade-exit' : 'app-fade-enter'}`}
          onClick={closeCreateModal}
        >
          <div onClick={(e) => e.stopPropagation()}
            className={`${isDarkMode ? 'bg-[#2d3748] border-slate-600' : 'neu-bg border-white/50'} w-full max-w-sm rounded-2xl px-2 py-5 border relative flex flex-col ${closingCreateModal ? 'app-fade-exit' : 'app-fade-enter'}`}
            style={{ maxHeight: 'calc(var(--app-screen-height) - 5rem)' }}
          >
            <button onClick={closeCreateModal} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
              <X size={20} />
            </button>

            <h3 className={`text-lg font-bold mb-4 text-center ${headingClass}`}>创建笔记本</h3>

            <div className="overflow-y-auto no-scrollbar flex-1 px-4 space-y-4">
              {/* Title */}
              <div>
                <label className={`text-xs font-medium mb-1 block ${subTextClass}`}>笔记本标题</label>
                <input type="text" value={createTitle} onChange={(e) => setCreateTitle(e.target.value)}
                  placeholder="留空则自动使用书名" className={`w-full px-3 py-2 rounded-xl text-sm focus:ring-0 focus:outline-none ${inputClass}`}
                />
              </div>

              {/* Cover */}
              {renderCoverSection(createCoverUrl, setCreateCoverUrl, coverUrlInputMode, setCoverUrlInputMode, tempCoverUrl, setTempCoverUrl, coverFileInputRef, false)}

              {/* Persona */}
              {renderPersonaDropdown(createPersonaId, setCreatePersonaId, personaDropdownOpen, setPersonaDropdownOpen)}

              {/* Book Selection (compact list) */}
              <div>
                <label className={`text-xs font-medium mb-2 block ${subTextClass}`}>
                  绑定书籍 {createSelectedBookIds.length > 0 && <span className="text-rose-400">（已选 {createSelectedBookIds.length} 本）</span>}
                </label>
                {renderBookSelector(
                  createSearchTerm, setCreateSearchTerm,
                  createSelectedTags, setCreateSelectedTags,
                  createFilterOpen, setCreateFilterOpen,
                  createSelectedBookIds, toggleBookForCreate,
                  true,
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2 px-4">
              <button onClick={closeCreateModal} className={`flex-1 py-2.5 rounded-xl text-sm ${btnClass}`}>取消</button>
              <button onClick={handleCreateNotebook}
                disabled={createSelectedBookIds.length === 0}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  createSelectedBookIds.length > 0 ? 'bg-rose-400 text-white shadow-md active:scale-95' : `${pressedClass} text-slate-400`
                }`}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>
    );
  };

  // ══════════════════════════════════════════════
  //  RENDER: Paper Background Modal
  // ══════════════════════════════════════════════

  const BUILTIN_PAPERS = [
    { id: 'default', name: '横线', value: '', bg: isDarkMode ? '#1e2533' : '#fefcf3',
      css: `repeating-linear-gradient(transparent, transparent 31px, ${isDarkMode ? 'rgba(100,116,139,0.15)' : 'rgba(180,160,130,0.25)'} 31px, ${isDarkMode ? 'rgba(100,116,139,0.15)' : 'rgba(180,160,130,0.25)'} 32px)` },
    { id: 'grid', name: '方格', value: '__builtin:grid', bg: isDarkMode ? '#1e2533' : '#fefcf3',
      css: `repeating-linear-gradient(transparent, transparent 31px, ${isDarkMode ? 'rgba(100,116,139,0.12)' : 'rgba(180,160,130,0.2)'} 31px, ${isDarkMode ? 'rgba(100,116,139,0.12)' : 'rgba(180,160,130,0.2)'} 32px), repeating-linear-gradient(90deg, transparent, transparent 31px, ${isDarkMode ? 'rgba(100,116,139,0.12)' : 'rgba(180,160,130,0.2)'} 31px, ${isDarkMode ? 'rgba(100,116,139,0.12)' : 'rgba(180,160,130,0.2)'} 32px)` },
    { id: 'dots', name: '圆点', value: '__builtin:dots', bg: isDarkMode ? '#1e2533' : '#fefcf3',
      css: `radial-gradient(circle, ${isDarkMode ? 'rgba(100,116,139,0.25)' : 'rgba(180,160,130,0.35)'} 1px, transparent 1px)`, size: '24px 24px' },
    { id: 'kraft', name: '牛皮纸', value: '__builtin:kraft', bg: '#f8eed7',
      css: 'radial-gradient(circle at center, transparent 54%, rgba(139, 69, 19, 0.08) 86%, rgba(139, 69, 19, 0.16) 100%), linear-gradient(135deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.16) 40%, rgba(255, 255, 255, 0) 100%)',
      border: '1px solid rgba(139, 69, 19, 0.18)',
      shadow: 'inset 0 0 18px rgba(139, 69, 19, 0.16), inset 0 0 8px rgba(101, 67, 33, 0.14), inset 0 0 3px rgba(60, 40, 20, 0.14), 0 2px 6px rgba(0, 0, 0, 0.14)' },
    { id: 'green', name: '护眼绿', value: '__builtin:green', bg: isDarkMode ? '#1a2a1a' : '#e8f0e0',
      css: `repeating-linear-gradient(transparent, transparent 31px, ${isDarkMode ? 'rgba(80,120,80,0.15)' : 'rgba(120,160,100,0.2)'} 31px, ${isDarkMode ? 'rgba(80,120,80,0.15)' : 'rgba(120,160,100,0.2)'} 32px)` },
    { id: 'blank', name: '空白', value: '__builtin:blank', bg: isDarkMode ? '#1e2533' : '#fefcf3', css: 'none' },
  ];

  const renderPaperModal = () => {
    if (!showPaperModal || !activeNotebook) return null;
    const currentPaper = activeNotebook.paperBgUrl || '';
    const cssPresets: ReaderCssPreset[] = activeNotebook.paperCssPresets ?? DEFAULT_PAPER_CSS_PRESETS;
    const cssSelectedId = activeNotebook.selectedPaperCssPresetId || DEFAULT_PAPER_CSS_PRESET_ID;
    const cssSelectedPreset = cssPresets.find((p) => p.id === cssSelectedId) || null;

    return (
      <ModalPortal>
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-500/20 backdrop-blur-sm ${closingPaperModal ? 'app-fade-exit' : 'app-fade-enter'}`}
          onClick={closePaperModal}
        >
          <div onClick={(e) => e.stopPropagation()}
            className={`${isDarkMode ? 'bg-[#2d3748] border-slate-600' : 'neu-bg border-white/50'} w-full max-w-sm max-h-[85vh] rounded-2xl px-2 py-5 border relative flex flex-col overflow-y-auto no-scrollbar ${closingPaperModal ? 'app-fade-exit' : 'app-fade-enter'}`}
          >
            <button onClick={closePaperModal} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
              <X size={20} />
            </button>

            <h3 className={`text-lg font-bold mb-4 text-center ${headingClass}`}>选择纸张背景</h3>

            <div className="px-4 space-y-4">
              {/* Built-in paper styles */}
              <div className="grid grid-cols-3 gap-2">
                {BUILTIN_PAPERS.map((paper) => {
                  const isActive = paper.value === currentPaper;
                  return (
                    <button key={paper.id} onClick={async () => {
                      const updated = { ...activeNotebook, paperBgUrl: paper.value || undefined, updatedAt: Date.now() };
                      await saveNotebook(updated);
                      setActiveNotebook(updated);
                      setNotebooks((prev) => prev.map((n) => n.id === updated.id ? updated : n));
                    }}
                      className={`rounded-xl overflow-hidden border-2 transition-all ${isActive ? 'border-rose-400 scale-[0.97]' : 'border-transparent'}`}
                    >
                      <div className="w-full h-16 rounded-t-lg"
                        style={{
                          backgroundColor: paper.bg,
                          backgroundImage: paper.css === 'none' ? undefined : paper.css,
                          ...(paper.size ? { backgroundSize: paper.size } : {}),
                          ...((paper as { border?: string }).border ? { border: (paper as { border?: string }).border } : {}),
                          ...((paper as { shadow?: string }).shadow ? { boxShadow: (paper as { shadow?: string }).shadow } : {}),
                        }}
                      />
                      <p className={`text-[10px] py-1 text-center ${isActive ? 'text-rose-400 font-bold' : subTextClass}`}>{paper.name}</p>
                    </button>
                  );
                })}
              </div>

              {/* Custom image preview */}
              {currentPaper && !currentPaper.startsWith('__builtin:') && resolvedPaperBgUrl && (
                <div className={`w-full h-24 rounded-xl overflow-hidden ${pressedClass} relative`}>
                  <img src={resolvedPaperBgUrl} className="w-full h-full object-cover" alt="自定义纸张" />
                  <span className="absolute bottom-1 right-2 text-[10px] text-white/70 bg-black/30 px-1.5 rounded">自定义</span>
                </div>
              )}

              {/* Upload buttons or URL input */}
              {!paperUrlMode ? (
                <div className="flex gap-2">
                  <button onClick={() => paperFileInputRef.current?.click()}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm ${btnClass} ${subTextClass}`}
                  >
                    <FileUp size={14} /> 本地上传
                  </button>
                  <button onClick={() => setPaperUrlMode(true)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm ${btnClass} ${subTextClass}`}
                  >
                    <Link size={14} /> 网络链接
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input type="text" value={tempPaperUrl} onChange={(e) => setTempPaperUrl(e.target.value)}
                    placeholder="输入图片URL..." className={`flex-1 px-3 py-2 rounded-xl text-sm focus:ring-0 focus:outline-none ${inputClass}`}
                  />
                  <button onClick={handlePaperUrlConfirm}
                    disabled={!tempPaperUrl.trim()}
                    className={`px-3 py-2 rounded-xl text-sm ${tempPaperUrl.trim() ? 'bg-rose-400 text-white active:scale-95' : `${pressedClass} text-slate-400`}`}
                  >
                    <Check size={16} />
                  </button>
                  <button onClick={() => { setPaperUrlMode(false); setTempPaperUrl(''); }}
                    className={`px-3 py-2 rounded-xl text-sm ${btnClass} ${subTextClass}`}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}

              {/* Reset to default */}
              {activeNotebook.paperBgUrl && (
                <button onClick={handlePaperReset}
                  className={`w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm ${btnClass} ${subTextClass}`}
                >
                  <RotateCcw size={14} /> 恢复默认纸张
                </button>
              )}

              {/* ═══ 自定义纸张 CSS ═══ */}
              <div className={`w-full h-[1px] ${isDarkMode ? 'bg-slate-600/40' : 'bg-slate-300/40'}`} />

              <div className="space-y-3">
                <div className={`text-sm font-bold ${headingClass}`}>自定义纸张 CSS</div>

                {/* CSS textarea */}
                <textarea
                  value={paperCssDraft}
                  onChange={(e) => setPaperCssDraft(e.target.value)}
                  placeholder={PAPER_CSS_PLACEHOLDER}
                  className={`w-full min-h-[120px] rounded-xl p-3 text-xs outline-none resize-y ${inputClass}`}
                />

                {/* Preset dropdown */}
                <PaperCssSingleSelectDropdown
                  options={cssPresets.map((p) => ({ value: p.id, label: p.name }))}
                  value={cssSelectedId}
                  onChange={(val) => handleSelectPaperCssPreset(val || DEFAULT_PAPER_CSS_PRESET_ID)}
                  placeholder="默认"
                  inputClass={inputClass}
                  cardClass={cardClass}
                  isDarkMode={isDarkMode}
                />

                {/* Apply & Clear */}
                <div className="flex gap-2">
                  <button type="button" onClick={() => {
                    if (paperCssApplyTimerRef.current) window.clearTimeout(paperCssApplyTimerRef.current);
                    setTimeout(() => void handleApplyPaperCss(), 80);
                    setPaperCssApplySuccess(true);
                    paperCssApplyTimerRef.current = window.setTimeout(() => setPaperCssApplySuccess(false), 1600);
                  }} className={`flex-1 h-10 rounded-xl text-sm ${btnClass} ${activeBtnClass} flex items-center justify-center gap-1.5`}
                    style={{ color: paperCssApplySuccess ? 'rgb(var(--theme-500) / 1)' : undefined, transition: 'color 0.3s ease' }}
                  >
                    <span className={`inline-flex transition-all duration-300 ${paperCssApplySuccess ? 'w-[15px] opacity-100 scale-100' : 'w-0 opacity-0 scale-50'}`} style={{ overflow: 'hidden' }}>
                      <Check size={15} className="shrink-0" />
                    </span>
                    应用
                  </button>
                  <button type="button" onClick={() => {
                    if (paperCssClearTimerRef.current) window.clearTimeout(paperCssClearTimerRef.current);
                    setTimeout(() => void handleClearPaperCss(), 80);
                    setPaperCssClearSuccess(true);
                    paperCssClearTimerRef.current = window.setTimeout(() => setPaperCssClearSuccess(false), 1600);
                  }} className={`flex-1 h-10 rounded-xl text-sm ${btnClass} ${activeBtnClass} flex items-center justify-center gap-1.5`}
                    style={{ color: paperCssClearSuccess ? 'rgb(var(--theme-500) / 1)' : undefined, transition: 'color 0.3s ease' }}
                  >
                    <span className={`inline-flex transition-all duration-300 ${paperCssClearSuccess ? 'w-[15px] opacity-100 scale-100' : 'w-0 opacity-0 scale-50'}`} style={{ overflow: 'hidden' }}>
                      <Eraser size={15} className="shrink-0" />
                    </span>
                    清空
                  </button>
                </div>

                {/* Preset management */}
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={paperCssPresetName}
                    onChange={(e) => setPaperCssPresetName(e.target.value)}
                    placeholder="预设名称"
                    className={`w-full h-10 rounded-xl px-3 text-sm outline-none ${inputClass}`}
                  />
                  <div className="flex w-full items-center justify-between">
                    {/* Save / Rename */}
                    <button
                      type="button"
                      onClick={() => {
                        normalizeInlineTags();
                        const name = paperCssPresetName.trim();
                        if (paperCssEditingPresetId && name) {
                          handleRenamePaperCssPreset(paperCssEditingPresetId, name);
                          setPaperCssEditingPresetId(null);
                          setPaperCssPresetName('');
                        } else if (name) {
                          handleSavePaperCssPreset(name);
                          setPaperCssPresetName('');
                        } else {
                          const selectedId = activeNotebook?.selectedPaperCssPresetId;
                          if (selectedId && activeNotebook) {
                            const presets = (activeNotebook.paperCssPresets ?? [...DEFAULT_PAPER_CSS_PRESETS]).map((p) =>
                              p.id === selectedId ? { ...p, css: paperCssDraft } : p
                            );
                            void updateNotebook({ paperCssApplied: paperCssDraft, paperCssPresets: presets });
                          }
                        }
                        if (paperCssSaveTimerRef.current) window.clearTimeout(paperCssSaveTimerRef.current);
                        setPaperCssSaveSuccess(true);
                        paperCssSaveTimerRef.current = window.setTimeout(() => setPaperCssSaveSuccess(false), 1600);
                      }}
                      className={`w-10 h-10 aspect-square shrink-0 rounded-xl flex items-center justify-center relative overflow-hidden ${btnClass} ${activeBtnClass} transition-all`}
                      style={{ color: 'rgb(var(--theme-500) / 1)' }}
                      title="保存"
                    >
                      <Save size={16} className={`transition-all duration-300 ${paperCssSaveSuccess ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`} />
                      <Check size={16} className={`absolute transition-all duration-300 ${paperCssSaveSuccess ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`} />
                    </button>
                    {/* Edit (rename) */}
                    <button
                      type="button"
                      disabled={!cssSelectedPreset}
                      onClick={() => {
                        if (cssSelectedPreset) {
                          setPaperCssPresetName(cssSelectedPreset.name);
                          setPaperCssEditingPresetId(cssSelectedPreset.id);
                          if (paperCssEditTimerRef.current) window.clearTimeout(paperCssEditTimerRef.current);
                          setPaperCssEditSuccess(true);
                          paperCssEditTimerRef.current = window.setTimeout(() => setPaperCssEditSuccess(false), 1600);
                        }
                      }}
                      className={`w-10 h-10 aspect-square shrink-0 rounded-xl flex items-center justify-center relative overflow-hidden transition-all ${
                        cssSelectedPreset ? `${btnClass} ${activeBtnClass}` : disabledIconButtonClass
                      }`}
                      title="重命名"
                    >
                      <Edit2 size={16} className={`transition-all duration-300 ${paperCssEditSuccess ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`} />
                      <Check size={16} className={`absolute transition-all duration-300 ${paperCssEditSuccess ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`} />
                    </button>
                    {/* Delete */}
                    <button
                      type="button"
                      disabled={!cssSelectedPreset}
                      onClick={() => cssSelectedPreset && handleDeletePaperCssPreset(cssSelectedPreset.id)}
                      className={`w-10 h-10 aspect-square shrink-0 rounded-xl flex items-center justify-center transition-all ${
                        cssSelectedPreset ? enabledDangerIconButtonClass : disabledIconButtonClass
                      }`}
                      title="删除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <input type="file" ref={paperFileInputRef} className="hidden" accept="image/*" onChange={handlePaperFileSelect} />
          </div>
        </div>
      </ModalPortal>
    );
  };

  //  RENDER: Edit Notebook Modal (centered)
  // ══════════════════════════════════════════════

  const renderEditModal = () => {
    if (!showEditModal || !editingNotebookId) return null;
    const nb = notebooks.find((n) => n.id === editingNotebookId);
    if (!nb) return null;
    const persona = getPersona(nb.personaId);

    const toggleBookForEdit = (id: string) => {
      setEditSelectedBookIds((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);
    };

    return (
      <ModalPortal>
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-500/20 backdrop-blur-sm ${closingEditModal ? 'app-fade-exit' : 'app-fade-enter'}`}
          onClick={closeEditModal}
        >
          <div onClick={(e) => e.stopPropagation()}
            className={`${isDarkMode ? 'bg-[#2d3748] border-slate-600' : 'neu-bg border-white/50'} w-full max-w-sm rounded-2xl px-2 py-5 border relative flex flex-col ${closingEditModal ? 'app-fade-exit' : 'app-fade-enter'}`}
            style={{ maxHeight: 'calc(var(--app-screen-height) - 5rem)' }}
          >
            <button onClick={closeEditModal} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
              <X size={20} />
            </button>

            <h3 className={`text-lg font-bold mb-4 text-center ${headingClass}`}>编辑笔记本</h3>

            <div className="overflow-y-auto no-scrollbar flex-1 px-4 space-y-4">
              {/* Title */}
              <div>
                <label className={`text-xs font-medium mb-1 block ${subTextClass}`}>笔记本标题</label>
                <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="留空则自动使用书名" className={`w-full px-3 py-2 rounded-xl text-sm focus:ring-0 focus:outline-none ${inputClass}`}
                />
              </div>

              {/* Cover */}
              {renderCoverSection(editCoverUrl, setEditCoverUrl, editCoverUrlInputMode, setEditCoverUrlInputMode, editTempCoverUrl, setEditTempCoverUrl, editCoverFileInputRef, true)}

              {/* Persona (disabled) */}
              <div className="relative">
                <label className={`text-xs font-medium mb-1 block ${subTextClass}`}>笔记本主人（无法更改）</label>
                <div className={`w-full p-2 min-h-[42px] rounded-xl flex items-center opacity-60 cursor-not-allowed ${inputClass}`}>
                  <span className="text-sm truncate">{persona?.name || '未知用户'}</span>
                </div>
              </div>

              {/* Book Selection (compact list) */}
              <div>
                <label className={`text-xs font-medium mb-2 block ${subTextClass}`}>
                  绑定书籍 {editSelectedBookIds.length > 0 && <span className="text-rose-400">（已选 {editSelectedBookIds.length} 本）</span>}
                </label>
                {renderBookSelector(
                  editSearchTerm, setEditSearchTerm,
                  editSelectedTags, setEditSelectedTags,
                  editFilterOpen, setEditFilterOpen,
                  editSelectedBookIds, toggleBookForEdit,
                  true,
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2 px-4">
              <button onClick={closeEditModal} className={`flex-1 py-2.5 rounded-xl text-sm ${btnClass}`}>取消</button>
              <button onClick={handleSaveEditNotebook}
                disabled={editSelectedBookIds.length === 0}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  editSelectedBookIds.length > 0 ? 'bg-rose-400 text-white shadow-md active:scale-95' : `${pressedClass} text-slate-400`
                }`}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>
    );
  };

  // ══════════════════════════════════════════════
  //  RENDER: Notebook Detail (note list)
  // ══════════════════════════════════════════════

  const renderNotebookDetail = () => {
    if (!activeNotebook) return null;
    const boundBooks = activeNotebook.boundBookIds.map(getBook).filter(Boolean) as Book[];
    const persona = getPersona(activeNotebook.personaId);
    const coverUrl = getNotebookCoverUrl(activeNotebook);

    return (
      <>
        {/* Fixed header — outside scroll */}
        <div className="px-6 pt-4 pb-4 space-y-4">
          {/* Circular back button */}
          <button onClick={() => switchNotesView('list', () => setActiveNotebook(null))}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95 ${btnClass}`}
          >
            <ArrowLeft size={20} />
          </button>

          {/* Overview card */}
          <div className={`p-4 rounded-2xl ${isDarkMode ? 'bg-white/5' : 'bg-white'}`}>
            <div className="flex items-start gap-4">
              {/* Notebook cover */}
              <div className={`w-14 h-20 rounded-lg overflow-hidden flex-shrink-0 ${pressedClass}`}>
                {coverUrl ? (
                  <ResolvedImage src={coverUrl} className="w-full h-full object-cover" alt={activeNotebook.title} />
                ) : (
                  <div className={`w-full h-full flex items-center justify-center ${subTextClass}`}>
                    <BookPlus size={20} className="opacity-40" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className={`font-bold text-base ${headingClass}`}>{activeNotebook.title}</h2>
                {/* Author info */}
                <div className="flex items-center gap-2 mt-1.5">
                  {persona?.avatar ? (
                    <ResolvedImage src={persona.avatar} className="w-5 h-5 rounded-full object-cover" />
                  ) : (
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center ${pressedClass}`}><UserCircle size={12} className="text-slate-400" /></div>
                  )}
                  <span className={`text-xs ${subTextClass}`}>{persona?.name || '未知用户'}</span>
                </div>
                {/* Bound books */}
                {boundBooks.length > 0 && (
                  <div className="flex flex-nowrap gap-1 mt-2 overflow-hidden">
                    {boundBooks.slice(0, 3).map((book) => (
                      <span key={book.id} className={`text-[10px] px-2 py-0.5 rounded-md whitespace-nowrap flex-shrink-0 ${isDarkMode ? 'bg-black/20 text-slate-400' : 'bg-slate-200 text-slate-500'}`}>
                        {book.title.length > 6 ? book.title.slice(0, 6) + '...' : book.title}
                      </span>
                    ))}
                    {boundBooks.length > 3 && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-md whitespace-nowrap flex-shrink-0 ${isDarkMode ? 'bg-black/20 text-slate-400' : 'bg-slate-200 text-slate-500'}`}>+{boundBooks.length - 3}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className={`text-sm ${subTextClass}`}>{activeNotebook.notes.length} 篇笔记</span>
            <div className="flex items-center gap-2">
              <button onClick={() => { setPaperUrlMode(false); setTempPaperUrl(''); setShowPaperModal(true); }}
                className={`flex items-center gap-1 px-3 py-2 rounded-xl text-sm transition-all active:scale-95 ${btnClass} ${subTextClass}`}
              >
                <Scroll size={16} /> 选纸张
              </button>
              <button onClick={handleAddNote}
                className={`flex items-center gap-1 px-3 py-2 rounded-xl text-sm transition-all active:scale-95 ${btnClass} ${subTextClass}`}
              >
                <Feather size={16} /> 写笔记
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 no-scrollbar">
          <div className="pb-24 space-y-3 animate-fade-in">
            {activeNotebook.notes.length === 0 && (
              <div className="text-center py-12 text-slate-400">
                <NotebookPen size={40} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">还没有笔记</p>
              </div>
            )}

            {activeNotebook.notes.map((note) => {
              const totalCommentCount = note.commentThreads.reduce(
                (sum, thread) => sum + Math.max(0, thread.messages.length),
                0
              );
              return (
              <div key={note.id} onClick={() => openNoteEditor(note)}
                className={`sh-paper p-4 rounded-2xl cursor-pointer transition-all active:scale-[0.98] border ${isDarkMode ? 'border-slate-700/30' : 'border-amber-200/40'}`}
                style={{
                  backgroundColor: paperStyle.bg,
                  ...(!activeNotebook.paperCssApplied && paperStyle.css !== 'none' && { backgroundImage: paperStyle.css }),
                  ...(!activeNotebook.paperCssApplied && paperStyle.size && { backgroundSize: paperStyle.size }),
                  ...(!activeNotebook.paperCssApplied && paperStyle.position && { backgroundPosition: paperStyle.position }),
                  ...(paperStyle.border && { border: paperStyle.border }),
                  ...(paperStyle.shadow && { boxShadow: paperStyle.shadow }),
                }}
              >
                <p className={`text-sm line-clamp-2 ${headingClass}`} style={{ fontFamily: '"Noto Serif SC", "Source Han Serif CN", serif' }}>{stripMarkdownForPreview(note.content) || '空白笔记'}</p>
                <div className="flex items-center justify-between mt-2">
	                  <span className={`text-[10px] ${subTextClass}`}>
	                    {new Date(note.updatedAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
	                  </span>
	                  <div className="flex items-center gap-2">
	                    {totalCommentCount > 0 && (
	                      <span className={`text-[10px] flex items-center gap-0.5 ${subTextClass}`}>
	                        <MessageCircle size={10} /> {totalCommentCount}
	                      </span>
	                    )}
	                    <button onClick={(e) => { e.stopPropagation(); handleDeleteNote(note.id); }}
	                      className={`${subTextClass} hover:text-rose-400`}
	                    >
	                      <Trash2 size={12} />
	                    </button>
	                  </div>
	                </div>
	              </div>
	            );
            })}
          </div>
        </div>
      </>
    );
  };

  // ══════════════════════════════════════════════
  //  RENDER: Note Editor (lined paper UI)
  // ══════════════════════════════════════════════

  const renderNoteEditor = () => {
    if (!activeNotebook || !activeNote) return null;

    const lineHeight = 32;
    const marginLineColor = isDarkMode ? 'rgba(239,68,68,0.2)' : 'rgba(220,80,80,0.3)';

    return (
      <>
        {/* Fixed header — outside scroll */}
        <div className="flex items-center justify-between px-6 pt-4 pb-2">
          {/* Circular back button */}
          <button onClick={() => { handleSaveNote(); switchNotesView('detail'); }}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95 ${btnClass}`}
          >
            <ArrowLeft size={20} />
          </button>
          {/* Date */}
          <span className={`text-xs ${subTextClass}`}>
            {new Date(activeNote.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}
          </span>
        </div>

        {/* Markdown style toolbar — fixed, outside scroll */}
        <div className="w-full overflow-visible pt-1 pb-3 px-6">
          <div className="grid grid-cols-8 gap-2 overflow-visible">
            {noteStylePresets.map((preset) => {
              const Icon = preset.icon;
              const isPressed = noteToolbarPressedKey === preset.key;
              return (
                <button
                  key={preset.key}
                  type="button"
                  title={preset.label}
                  aria-label={preset.label}
                  onPointerDown={(event) => handleNoteStyleButtonPointerDown(preset.key, event)}
                  onMouseDown={(e) => e.preventDefault()}
                  onPointerUp={clearPressedNoteStyleButton}
                  onPointerLeave={clearPressedNoteStyleButton}
                  onPointerCancel={clearPressedNoteStyleButton}
                  onClick={preset.onClick}
                  className={`w-full h-9 rounded-lg text-xs font-semibold flex items-center justify-center whitespace-nowrap transition-all ${
                    isPressed ? `${pressedClass} scale-[0.96]` : `${btnClass} active:scale-[0.98]`
                  } ${preset.active ? '' : 'text-slate-500 hover:text-slate-400'}`}
                  style={preset.active ? { color: 'rgb(var(--theme-500) / 1)' } : undefined}
                >
                  <Icon size={16} strokeWidth={2.15} />
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 no-scrollbar">
          <div className="pt-3 pb-24 space-y-4 animate-fade-in">

        {/* Lined paper */}
        <div className={`sh-paper rounded-2xl overflow-hidden ${cardClass}`}
          style={{
            backgroundColor: paperStyle.bg,
            ...(!activeNotebook.paperCssApplied && paperStyle.isCustomImage && paperStyle.css !== 'none' && { backgroundImage: paperStyle.css, backgroundSize: 'cover', backgroundPosition: 'center' }),
            ...(!activeNotebook.paperCssApplied && !paperStyle.isCustomImage && paperStyle.css !== 'none' && { backgroundImage: paperStyle.css }),
            ...(paperStyle.border && { border: paperStyle.border }),
            ...(paperStyle.shadow && { boxShadow: paperStyle.shadow }),
          }}
        >
          <div className="sh-paper-inner relative">
            {/* Margin line (hidden when non-default paper or custom CSS applied) */}
            {!paperStyle.hideMarginLine && !activeNotebook.paperCssApplied && (
              <div className="absolute top-0 bottom-0 left-10" style={{ width: '2px', background: marginLineColor }} />
            )}

            <div
              ref={noteEditorRef}
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              onInput={handleNoteEditorInput}
              onCompositionStart={() => { noteEditorComposingRef.current = true; }}
              onCompositionEnd={() => {
                noteEditorComposingRef.current = false;
                normalizeListChildDivs();
                normalizeInlineTags();
              }}
              onFocus={() => {
                setIsNoteEditorFocused(true);
                refreshNoteToolbarState();
              }}
              onBlur={() => {
                setIsNoteEditorFocused(false);
              }}
              onKeyUp={refreshNoteToolbarState}
              onMouseUp={refreshNoteToolbarState}
              onPaste={handleNoteEditorPaste}
              className={`studyhub-note-editor w-full min-h-[300px] bg-transparent outline-none ${paperStyle.hideMarginLine || activeNotebook.paperCssApplied ? 'pl-4' : 'pl-14'} pr-4 pt-4 pb-4 text-sm no-scrollbar overflow-x-hidden break-words`}
              style={{
                lineHeight: `${lineHeight}px`,
                ...(!activeNotebook.paperCssApplied && !paperStyle.isCustomImage && paperStyle.css !== 'none' && {
                  backgroundImage: paperStyle.css,
                  backgroundPosition: '0 0',
                  ...(paperStyle.size ? { backgroundSize: paperStyle.size } : {}),
                }),
                color: isDarkMode ? '#e2e8f0' : '#334155',
                fontFamily: '"Noto Serif SC", "Source Han Serif CN", serif',
              }}
            ></div>
            {!noteContent.trim() && !isNoteEditorFocused && (
              <div
                className={`sh-note-placeholder absolute top-4 pointer-events-none text-sm ${paperStyle.hideMarginLine || activeNotebook.paperCssApplied ? 'left-4' : 'left-14'} ${subTextClass}`}
                style={{ lineHeight: `${lineHeight}px` }}
              >
                随便写点什么吧
              </div>
            )}
          </div>
        </div>

        {/* Separator between note and comments */}
        <div className={`border-t ${isDarkMode ? 'border-slate-600/30' : 'border-slate-300/40'}`} />

        {/* Comment Section */}
        <div className="space-y-3" ref={charDropdownRef}>
          <div className="flex items-center justify-between">
            <span className={`text-sm font-medium ${headingClass}`}>评论区</span>

            {/* Summon button */}
            <button
              onClick={() => {
                if (!showCharSelect) setSelectedCharIds([]);
                setShowCharSelect(!showCharSelect);
              }}
              disabled={isAiLoading || !noteContent.trim()}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-all active:scale-95 ${
                isAiLoading || !noteContent.trim()
                  ? `${pressedClass} text-slate-400`
                  : showCharSelect
                    ? `${pressedClass} text-rose-400`
                    : `${btnClass} text-rose-400`
              }`}
            >
              {isAiLoading ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
              <span>召唤</span>
              <ChevronDown size={14} className={`transition-transform duration-200 ${showCharSelect ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {/* Inline character multi-select panel */}
          {showCharSelect && (
            <div className={`p-3 rounded-2xl animate-fade-in ${cardClass} border border-slate-400/10`}>
              <p className={`text-[10px] px-1 pb-2 ${subTextClass}`}>选择角色来评论（最多3个）</p>
              <div className="max-h-11 overflow-y-auto no-scrollbar space-y-1">
                {characters.map((ch) => {
                  const isSelected = selectedCharIds.includes(ch.id);
                  return (
                    <div
                      key={ch.id}
                      onClick={() => {
                        setSelectedCharIds((prev) => {
                          if (prev.includes(ch.id)) return prev.filter((id) => id !== ch.id);
                          if (prev.length >= 3) return prev;
                          return [...prev, ch.id];
                        });
                      }}
                      className={`flex items-center gap-2 p-2 rounded-lg text-sm cursor-pointer transition-colors ${
                        isSelected
                          ? 'text-rose-400 font-bold bg-rose-400/10'
                          : isDarkMode ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                        isSelected ? 'bg-rose-400 border-rose-400' : 'border-slate-400'
                      }`}>
                        {isSelected && <Check size={10} className="text-white" />}
                      </div>
                      {ch.avatar ? (
                        <ResolvedImage src={ch.avatar} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${pressedClass}`}>
                          <UserCircle size={14} className="text-slate-400" />
                        </div>
                      )}
                      <span className="truncate">{ch.nickname || ch.name}</span>
                    </div>
                  );
                })}
              </div>
              <div className={`grid transition-all duration-300 ease-in-out ${
                selectedCharIds.length > 0 ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0 mt-0'
              }`}>
                <div className="overflow-hidden">
                  <button
                    onClick={handleSummonAiCommentBatch}
                    className="w-full py-2 rounded-xl text-sm font-medium bg-rose-400 text-white shadow-md active:scale-95 transition-all"
                  >
                    召唤 {selectedCharIds.length} 个角色评论
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Comment Threads — 小红书楼中楼 style */}
          {activeNote.commentThreads.map((thread) => {
            const firstMsg = thread.messages[0];
            if (!firstMsg) return null;
            const persona = getPersona(activeNotebook.personaId);
            const userName = persona?.name || '未知用户';

            return (
              <div key={thread.id} className="flex gap-2.5">
                {/* Avatar */}
                <div className="flex-shrink-0 pt-0.5">
                  {thread.characterAvatar ? (
                    <ResolvedImage src={thread.characterAvatar} className="w-8 h-8 rounded-full object-cover" />
                  ) : (
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${pressedClass}`}>
                      <UserCircle size={16} className="text-slate-400" />
                    </div>
                  )}
                </div>

                {/* Content column */}
                <div className="flex-1 min-w-0">
                  {/* Top-level AI comment (楼主) */}
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold ${headingClass}`}>{getCharacter(thread.characterId)?.nickname || thread.characterName}</span>
                    <span className={`text-[10px] ${subTextClass}`}>
                      {new Date(firstMsg.createdAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className={`text-sm leading-relaxed mt-1 ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                    {firstMsg.content}
                  </p>
                  {/* Actions for top-level AI comment */}
                  <div className="flex justify-end gap-3 mt-1.5">
                    <button onClick={() => handleRefreshAiComment(thread.id, 0)} disabled={isAiLoading}
                      className={`${subTextClass} hover:text-rose-400 transition-colors disabled:opacity-40`}>
                      <RotateCcw size={12} />
                    </button>
                    <button onClick={() => handleDeleteAiComment(thread.id, 0)}
                      className={`${subTextClass} hover:text-rose-400 transition-colors`}>
                      <Trash2 size={12} />
                    </button>
                  </div>

                  {/* 楼中楼 replies */}
                  {thread.messages.length > 1 && (
                    <div className={`mt-2 pt-2 space-y-2 border-t ${isDarkMode ? 'border-slate-700/30' : 'border-slate-200'}`}>
                      {thread.messages.slice(1).map((msg, i) => {
                        const msgIdx = i + 1;
                        const isAi = msg.role === 'ai';
                        const displayName = isAi ? (getCharacter(thread.characterId)?.nickname || thread.characterName) : userName;
                        return (
                          <div key={msg.id} className="flex gap-2">
                            {/* Avatar */}
                            <div className="flex-shrink-0 pt-0.5">
                              {isAi ? (
                                thread.characterAvatar ? (
                                  <ResolvedImage src={thread.characterAvatar} className="w-6 h-6 rounded-full object-cover" />
                                ) : (
                                  <div className={`w-6 h-6 rounded-full flex items-center justify-center ${pressedClass}`}>
                                    <UserCircle size={12} className="text-slate-400" />
                                  </div>
                                )
                              ) : (
                                persona?.avatar ? (
                                  <ResolvedImage src={persona.avatar} className="w-6 h-6 rounded-full object-cover" />
                                ) : (
                                  <div className={`w-6 h-6 rounded-full flex items-center justify-center ${pressedClass}`}>
                                    <UserCircle size={12} className="text-slate-400" />
                                  </div>
                                )
                              )}
                            </div>
                            {/* Content column */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-bold ${isAi ? (isDarkMode ? 'text-slate-300' : 'text-slate-700') : 'text-rose-400'}`}>
                                  {displayName}
                                </span>
                                <span className={`text-[10px] ${subTextClass}`}>
                                  {new Date(msg.createdAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <p className={`text-xs leading-relaxed mt-0.5 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                                {msg.content}
                              </p>
                              {isAi && (
                                <div className="flex justify-end gap-3 mt-0.5">
                                  <button onClick={() => handleRefreshAiComment(thread.id, msgIdx)} disabled={isAiLoading}
                                    className={`${subTextClass} hover:text-rose-400 transition-colors disabled:opacity-40`}>
                                    <RotateCcw size={10} />
                                  </button>
                                  <button onClick={() => handleDeleteAiComment(thread.id, msgIdx)}
                                    className={`${subTextClass} hover:text-rose-400 transition-colors`}>
                                    <Trash2 size={10} />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Reply input (inside content column) */}
                  <div className={`flex items-center mt-2 rounded-xl overflow-hidden ${inputClass}`}>
                    <input
                      type="text"
                      value={commentReplyInputs[thread.id] || ''}
                      onChange={(e) => setCommentReplyInputs((prev) => ({ ...prev, [thread.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReplyToThread(thread.id); } }}
                      placeholder="回复..."
                      disabled={isAiLoading}
                      className="flex-1 px-3 py-2 text-sm bg-transparent focus:ring-0 focus:outline-none"
                    />
                    <button
                      onClick={() => handleReplyToThread(thread.id)}
                      disabled={isAiLoading || !(commentReplyInputs[thread.id] || '').trim()}
                      className={`px-2.5 py-2 flex-shrink-0 transition-colors ${
                        isAiLoading || !(commentReplyInputs[thread.id] || '').trim()
                          ? 'text-slate-400' : 'text-rose-400'
                      }`}
                    >
                      {isAiLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
          </div>
        </div>
      </>
    );
  };

  // ══════════════════════════════════════════════
  //  RENDER: Quiz — History List
  // ══════════════════════════════════════════════

  const renderQuizHistory = () => {
    return (
      <>
        {/* Fixed header — outside scroll */}
        <div className="flex items-center justify-between px-6 pt-4 pb-2">
          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">问答记录</h2>
          <button onClick={() => { setQuizError(''); setShowQuizConfigModal(true); }}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-95 ${btnClass} text-rose-400`}
          >
            <Plus size={20} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 no-scrollbar">
          <div className="pt-3 pb-24 space-y-3 animate-fade-in">

        {isQuizGenerating && (
          <div className={`${cardClass} p-4 rounded-2xl`}>
            <div className="flex items-center gap-3">
              <Loader2 size={20} className="animate-spin text-rose-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${headingClass}`}>问答生成中…</p>
                <p className={`text-xs mt-1 ${subTextClass}`}>
                  {qcBookIds.map((id) => getBook(id)?.title || '').filter(Boolean).join('、') || '所选书籍'} · {qcCount}题{qcType === 'truefalse' ? '判断题' : qcType === 'multiple' ? '多选题' : '单选题'}
                </p>
              </div>
            </div>
          </div>
        )}

        {quizSessions.length === 0 && !isQuizGenerating && (
          <div className="text-center py-12 text-slate-400">
            <HelpCircle size={48} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">还没有问答记录</p>
            <p className="text-xs mt-1">点击右上角 + 开始新的问答</p>
          </div>
        )}

          {quizSessions.map((session) => {
            const bookTitles = session.config.bookIds.map((id) => getBook(id)?.title || '').filter(Boolean);
            const totalQ = session.questions.length;
            let correctCount = 0;
            session.questions.forEach((q) => {
              const ans = session.userAnswers[q.id] || [];
              if (ans.length === q.correctAnswerIndices.length && ans.every((a) => q.correctAnswerIndices.includes(a))) correctCount++;
            });
            const isIncomplete = !session.completedAt;
            const answeredCount = session.questions.filter((q) => (session.userAnswers[q.id]?.length || 0) > 0).length;
            const pct = totalQ > 0 ? Math.round((correctCount / totalQ) * 100) : 0;

            return (
              <div key={session.id}
                onClick={() => {
                  if (session.completedAt) {
                    switchQuizView('result', () => { setActiveQuizSession(session); });
                  } else {
                    switchQuizView('play', () => {
                      setActiveQuizSession(session);
                      setQuizUserAnswers(session.userAnswers || {});
                      const firstUnanswered = session.questions.findIndex((q) => !(session.userAnswers[q.id]?.length));
                      setQuizCurrentIndex(firstUnanswered >= 0 ? firstUnanswered : 0);
                      setQuizSlideDir('right');
                    });
                  }
                }}
                className={`${cardClass} p-4 rounded-2xl cursor-pointer transition-all active:scale-[0.98]`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${headingClass}`}>{bookTitles.join('、') || '未知书籍'}</p>
                    <p className={`text-xs mt-1 ${subTextClass}`}>
                      {isIncomplete
                        ? `${totalQ} 题 · 已答 ${answeredCount}/${totalQ} · ${session.config.questionType === 'truefalse' ? '判断题' : session.config.questionType === 'multiple' ? '多选题' : '单选题'}`
                        : `${totalQ} 题 · 正确率 ${pct}% · ${session.config.questionType === 'truefalse' ? '判断题' : session.config.questionType === 'multiple' ? '多选题' : '单选题'}`
                      }
                    </p>
                    <p className={`text-[10px] mt-1 ${isIncomplete ? (isDarkMode ? 'text-[#FFCB69]' : 'text-[#C99A2E]') : subTextClass}`}>
                      {session.completedAt ? new Date(session.completedAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '答题中…点击继续'}
                    </p>
                  </div>
                  {isIncomplete ? (
                    <div className={`text-lg font-bold ${isDarkMode ? 'text-[#FFCB69]' : 'text-[#C99A2E]'}`}>{answeredCount}/{totalQ}</div>
                  ) : (
                    <div className={`text-lg font-bold ${pct >= 80 ? (isDarkMode ? 'text-[#A8AD94]' : 'text-[#797D62]') : pct >= 60 ? (isDarkMode ? 'text-[#FFCB69]' : 'text-[#C99A2E]') : 'text-rose-400'}`}>{pct}%</div>
                  )}
                </div>

                <div className="flex items-center justify-end mt-2">
                  <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(deleteConfirmId === session.id ? null : session.id); }}
                    className={`${subTextClass} hover:text-rose-400`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {deleteConfirmId === session.id && (
                  <div className="mt-2 flex items-center justify-end gap-2 animate-fade-in">
                    <span className="text-xs text-rose-400">确认删除？</span>
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteQuizSession(session.id); }}
                      className="px-3 py-1 bg-rose-400 text-white text-xs rounded-lg">删除</button>
                    <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(null); }}
                      className={`px-3 py-1 text-xs rounded-lg ${btnClass}`}>取消</button>
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </div>
      </>
    );
  };

  // ══════════════════════════════════════════════
  //  RENDER: Quiz — Config Modal
  // ══════════════════════════════════════════════

  const renderQuizConfigModal = () => {
    if (!showQuizConfigModal) return null;

    const toggleBookForQuiz = (id: string) => {
      setQcBookIds((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);
    };

    const handleCountInputBlur = () => {
      const num = parseInt(qcCountText, 10);
      if (isNaN(num) || num < 1) { setQcCount(1); setQcCountText('1'); }
      else if (num > 50) { setQcCount(50); setQcCountText('50'); }
      else { setQcCount(num); setQcCountText(String(num)); }
    };

    return (
      <ModalPortal>
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-500/20 backdrop-blur-sm ${closingQuizConfigModal ? 'app-fade-exit' : 'app-fade-enter'}`}
          onClick={closeQuizConfigModal}
        >
          <div onClick={(e) => e.stopPropagation()}
            className={`${isDarkMode ? 'bg-[#2d3748] border-slate-600' : 'neu-bg border-white/50'} w-full max-w-sm rounded-2xl px-2 py-5 border relative flex flex-col ${closingQuizConfigModal ? 'app-fade-exit' : 'app-fade-enter'}`}
            style={{ maxHeight: 'calc(var(--app-screen-height) - 5rem)' }}
          >
            <button onClick={closeQuizConfigModal} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
              <X size={20} />
            </button>

            <h3 className={`text-lg font-bold mb-4 text-center ${headingClass}`}>配置问答</h3>

            <div className="overflow-y-auto no-scrollbar flex-1 px-4 space-y-4">
              {/* Book Selection */}
              <div>
                <label className={`text-xs font-medium mb-2 block ${subTextClass}`}>
                  选择书籍 {qcBookIds.length > 0 && <span className="text-rose-400">（已选 {qcBookIds.length} 本）</span>}
                </label>
                {renderBookSelector(
                  qcSearchTerm, setQcSearchTerm,
                  qcSelectedTags, setQcSelectedTags,
                  qcFilterOpen, setQcFilterOpen,
                  qcBookIds, toggleBookForQuiz,
                  true,
                )}
              </div>

              {/* Question Count */}
              <div>
                <label className={`text-xs font-medium mb-2 block ${subTextClass}`}>题目数量</label>
                <div className="flex items-center gap-3">
                  <div className="relative h-2 flex-1">
                    <input type="range" min={1} max={50} value={qcCount}
                      onChange={(e) => { const v = Number(e.target.value); setQcCount(v); setQcCountText(String(v)); }}
                      className="app-range absolute top-1/2 -translate-y-1/2 left-0 w-full h-5 bg-transparent appearance-none cursor-pointer z-10"
                    />
                    <div className={`absolute top-0 left-0 h-full rounded-full w-full ${isDarkMode ? 'bg-slate-700' : 'bg-black/5'}`} />
                    <div className="absolute top-0 left-0 h-full bg-rose-300 rounded-full pointer-events-none" style={{ width: `${((qcCount - 1) / 49) * 100}%` }} />
                  </div>
                  <input type="text" inputMode="numeric"
                    value={qcCountText}
                    onChange={(e) => setQcCountText(e.target.value)}
                    onBlur={handleCountInputBlur}
                    className={`w-12 text-center text-sm py-1 rounded-lg focus:ring-0 focus:outline-none ${inputClass}`}
                  />
                </div>
              </div>

              {/* Question Type */}
              <div>
                <label className={`text-xs font-medium mb-2 block ${subTextClass}`}>题目类型</label>
                <div className="flex gap-2">
                  {([['single', '单选题'], ['multiple', '多选题'], ['truefalse', '判断题']] as const).map(([key, label]) => (
                    <button key={key} onClick={() => setQcType(key)}
                      className={`flex-1 py-2 rounded-xl text-sm transition-all ${
                        qcType === key ? 'bg-rose-400 text-white shadow-md' : `${btnClass}`
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Option Count (for single/multiple) */}
              {qcType !== 'truefalse' && (
                <div>
                  <label className={`text-xs font-medium mb-2 block ${subTextClass}`}>选项数量</label>
                  <div className="flex gap-2">
                    {[2, 3, 4, 5].map((n) => (
                      <button key={n} onClick={() => setQcOptionCount(n)}
                        className={`w-10 h-10 rounded-xl text-sm transition-all flex items-center justify-center ${
                          qcOptionCount === n ? 'bg-rose-400 text-white shadow-md' : `${btnClass}`
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom Prompt (required) */}
              <div>
                <label className={`text-xs font-medium mb-2 block ${subTextClass}`}>
                  自定义提示词 <span className="text-rose-400">*</span>
                </label>
                <textarea value={qcPrompt} onChange={(e) => setQcPrompt(e.target.value)}
                  placeholder="例如：请重点考察人物关系和情节理解..."
                  className={`w-full px-3 py-2 rounded-xl text-sm min-h-[80px] resize-none focus:ring-0 focus:outline-none ${inputClass}`}
                />
              </div>

              {/* Error */}
              {quizError && <div className="text-sm text-rose-400 bg-rose-400/10 p-3 rounded-xl">{quizError}</div>}
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2 px-4">
              <button onClick={closeQuizConfigModal} className={`flex-1 py-2.5 rounded-xl text-sm ${btnClass}`}>取消</button>
              <button onClick={handleStartQuiz}
                disabled={qcBookIds.length === 0 || !qcPrompt.trim() || isQuizGenerating}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  qcBookIds.length > 0 && qcPrompt.trim() && !isQuizGenerating ? 'bg-rose-400 text-white shadow-md active:scale-95' : `${pressedClass} text-slate-400`
                }`}
              >
                {isQuizGenerating ? (
                  <span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> 生成中...</span>
                ) : '开始答题'}
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>
    );
  };

  // ══════════════════════════════════════════════
  //  RENDER: Quiz — Flashcard Play
  // ══════════════════════════════════════════════

  const renderQuizPlay = () => {
    if (!activeQuizSession) return null;
    const questions = activeQuizSession.questions;
    const current = questions[quizCurrentIndex];
    if (!current) return null;

    const selected = quizUserAnswers[current.id] || [];
    const total = questions.length;

    return (
      <div className="pt-4 pb-24 space-y-4 animate-fade-in">
        {/* Progress */}
        <div className="flex items-center gap-3">
          <button onClick={handleExitQuizPlay}
            className={`${subTextClass} hover:text-rose-400`}
          >
            <X size={20} />
          </button>
          <div className={`flex-1 h-2 rounded-full overflow-hidden ${pressedClass}`}>
            <div className="h-full bg-rose-400 rounded-full transition-all" style={{ width: `${((quizCurrentIndex + 1) / total) * 100}%` }} />
          </div>
          <span className={`text-sm font-medium ${headingClass}`}>{quizCurrentIndex + 1}/{total}</span>
        </div>

        {/* Question Card */}
        <div key={current.id} className={`${cardClass} rounded-2xl p-6 min-h-[300px] flex flex-col ${quizSlideDir === 'right' ? 'animate-slide-in-right' : 'animate-slide-in-left'}`}>
          <div className={`text-[10px] uppercase tracking-wider mb-2 ${subTextClass}`}>
            {current.type === 'truefalse' ? '判断题' : current.type === 'multiple' ? '多选题' : '单选题'}
          </div>
          <p className={`text-base font-medium mb-6 flex-shrink-0 ${headingClass}`}>{current.question}</p>

          <div className="space-y-3 flex-1">
            {current.options.map((opt, idx) => {
              const isSelected = selected.includes(idx);
              return (
                <button key={idx} onClick={() => handleSelectAnswer(current.id, idx)}
                  className={`w-full text-left p-3 rounded-xl text-sm transition-all flex items-center gap-3 ${
                    isSelected ? 'bg-rose-400 text-white shadow-md' : `${btnClass}`
                  }`}
                >
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    isSelected ? 'bg-white/20' : `${pressedClass}`
                  }`}>
                    {String.fromCharCode(65 + idx)}
                  </span>
                  <span className="flex-1">{opt}</span>
                  {isSelected && <Check size={16} />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between gap-3">
          <button onClick={() => { setQuizSlideDir('left'); setQuizCurrentIndex((i) => Math.max(0, i - 1)); }}
            disabled={quizCurrentIndex === 0}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${quizCurrentIndex === 0 ? `${pressedClass} text-slate-400` : `${btnClass} text-rose-400 active:scale-95`}`}
          >
            <ChevronLeft size={20} />
          </button>

          {quizCurrentIndex === total - 1 ? (
            <button onClick={handleSubmitQuiz}
              className="flex-1 py-3 rounded-xl text-sm font-medium bg-rose-400 text-white shadow-md active:scale-95 transition-all"
            >
              {isAiLoading ? (
                <span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> 正在生成总评...</span>
              ) : '提交答案'}
            </button>
          ) : (
            <button onClick={() => { setQuizSlideDir('right'); setQuizCurrentIndex((i) => Math.min(total - 1, i + 1)); }}
              className="flex-1 py-3 rounded-xl text-sm font-medium bg-rose-400 text-white shadow-md active:scale-95 transition-all"
            >
              下一题
            </button>
          )}

          <button onClick={() => { setQuizSlideDir('right'); setQuizCurrentIndex((i) => Math.min(total - 1, i + 1)); }}
            disabled={quizCurrentIndex === total - 1}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${quizCurrentIndex === total - 1 ? `${pressedClass} text-slate-400` : `${btnClass} text-rose-400 active:scale-95`}`}
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
    );
  };

  // ══════════════════════════════════════════════
  //  RENDER: Quiz — Result Page
  // ══════════════════════════════════════════════

  const renderQuizResult = () => {
    if (!activeQuizSession) return null;
    const questions = activeQuizSession.questions;
    const answers = activeQuizSession.userAnswers;

    let correctCount = 0;
    questions.forEach((q) => {
      const ans = answers[q.id] || [];
      if (ans.length === q.correctAnswerIndices.length && ans.every((a) => q.correctAnswerIndices.includes(a))) correctCount++;
    });
    const pct = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;

    return (
      <div className="pt-2 pb-24 space-y-4 animate-fade-in">
        {/* Score Overview */}
        <div className={`${cardClass} rounded-2xl p-6 text-center`}>
          <div className={`text-4xl font-bold ${pct >= 80 ? (isDarkMode ? 'text-[#A8AD94]' : 'text-[#797D62]') : pct >= 60 ? (isDarkMode ? 'text-[#FFCB69]' : 'text-[#C99A2E]') : 'text-rose-400'}`}>
            {pct}%
          </div>
          <p className={`text-sm mt-1 ${subTextClass}`}>{correctCount}/{questions.length} 题正确</p>
          <div className={`w-full h-2 rounded-full overflow-hidden mt-3 ${pressedClass}`}>
            <div className={`h-full rounded-full ${pct >= 80 ? (isDarkMode ? 'bg-[#A8AD94]' : 'bg-[#797D62]') : pct >= 60 ? (isDarkMode ? 'bg-[#FFCB69]' : 'bg-[#C99A2E]') : 'bg-rose-400'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Question Details */}
        <div className="space-y-3">
          {questions.map((q, idx) => {
            const userAns = answers[q.id] || [];
            const isCorrect = userAns.length === q.correctAnswerIndices.length && userAns.every((a) => q.correctAnswerIndices.includes(a));

            return (
              <div key={q.id} className={`${cardClass} rounded-2xl p-4`}>
                <div className="flex items-start gap-2 mb-2">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                    isCorrect ? (isDarkMode ? 'bg-[#A8AD94] text-white' : 'bg-[#797D62] text-white') : 'bg-rose-400 text-white'
                  }`}>
                    {idx + 1}
                  </span>
                  <p className={`text-sm ${headingClass}`}>{q.question}</p>
                </div>

                <div className="pl-8 space-y-1.5">
                  {q.options.map((opt, oi) => {
                    const isUserChoice = userAns.includes(oi);
                    const isCorrectOpt = q.correctAnswerIndices.includes(oi);

                    let optClass = `text-xs px-2 py-1 rounded-lg `;
                    if (isUserChoice && isCorrectOpt) optClass += isDarkMode ? 'bg-[#A8AD94]/20 text-[#A8AD94] font-medium' : 'bg-[#797D62]/20 text-[#797D62] font-medium';
                    else if (isUserChoice && !isCorrectOpt) optClass += 'bg-rose-400/20 text-rose-400 line-through';
                    else if (isCorrectOpt) optClass += isDarkMode ? 'bg-[#A8AD94]/10 text-[#A8AD94]' : 'bg-[#797D62]/10 text-[#797D62]';
                    else optClass += subTextClass;

                    return (
                      <div key={oi} className={optClass}>
                        {String.fromCharCode(65 + oi)}. {opt}
                        {isUserChoice && !isCorrectOpt && ' \✗'}
                        {isCorrectOpt && ' \✓'}
                      </div>
                    );
                  })}

                  {q.explanation && (
                    <p className={`text-[11px] mt-2 ${isDarkMode ? 'text-amber-200/60' : 'text-amber-700/60'}`} style={{ fontStyle: 'italic' }}>
                      {q.explanation}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* AI Overall Comment */}
        <div className={`${cardClass} rounded-2xl p-4`}>
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <BookMarked size={16} className="text-rose-400 flex-shrink-0" />
              <span className={`text-sm font-medium truncate ${headingClass}`}>
                {activeQuizSession.characterName || 'AI'} 的总评
              </span>
            </div>
            <button
              type="button"
              onClick={handleRefreshQuizOverallComment}
              disabled={isQuizCommentRefreshing || isAiLoading}
              aria-label="刷新总评"
              title="刷新总评"
              className={`w-8 h-8 rounded-lg text-xs font-medium flex items-center justify-center transition-all ${
                isQuizCommentRefreshing || isAiLoading
                  ? `${pressedClass} text-slate-400 cursor-not-allowed`
                  : `${btnClass} text-rose-400 active:scale-95`
              }`}
            >
              {isQuizCommentRefreshing ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
            </button>
          </div>
          {activeQuizSession.overallComment ? (
            <p
              className={`text-sm ${isDarkMode ? 'text-amber-200/80' : 'text-amber-800/80'}`}
              style={{ fontFamily: '"Noto Serif SC", serif', fontStyle: 'italic', lineHeight: '1.8' }}
            >
              {activeQuizSession.overallComment}
            </p>
          ) : (
            <p className={`text-xs ${subTextClass}`}>暂无总评，点击右上角刷新按钮重新生成。</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button onClick={() => { switchQuizView('history', () => { setActiveQuizSession(null); }); }}
            className={`flex-1 py-2.5 rounded-xl text-sm ${btnClass}`}
          >
            返回列表
          </button>
          <button onClick={() => { switchQuizView('history', () => { setActiveQuizSession(null); setQuizError(''); setShowQuizConfigModal(true); }); }}
            className="flex-1 py-2.5 rounded-xl text-sm bg-rose-400 text-white shadow-md active:scale-95 transition-all flex items-center justify-center gap-1"
          >
            <RotateCcw size={14} /> 再来一次
          </button>
        </div>
      </div>
    );
  };

  // ══════════════════════════════════════════════
  //  MAIN RENDER
  // ══════════════════════════════════════════════

  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${containerClass} ${isDarkMode ? 'dark-mode' : ''}`}>
      {/* Header - matching Settings page: p-6 container + pt-2 header = pt-8 total */}
      <header className="px-6 mb-4 pt-8">
        <h1 className={`text-2xl font-bold ${headingClass}`}>共读集</h1>
      </header>

      {/* Tab Bar */}
      {renderTabBar()}

      {/* Notes views — each view manages its own fixed header + scroll area */}
      {renderedTab === 'notes' && (
        <div className={`flex-1 flex flex-col overflow-hidden ${hubTabAnimClass}`}>
          <div key={notesView} className={`flex-1 flex flex-col overflow-hidden ${notesViewAnimClass}`}>
            {activeNotebook?.paperCssApplied && <style>{activeNotebook.paperCssApplied}</style>}
            {notesView === 'list' && renderNotebookList()}
            {notesView === 'detail' && renderNotebookDetail()}
            {notesView === 'editor' && renderNoteEditor()}
          </div>
        </div>
      )}

      {/* Quiz views — each view manages its own layout */}
      {renderedTab === 'quiz' && (
        <div className={`flex-1 flex flex-col overflow-hidden ${hubTabAnimClass}`}>
          <div key={quizView} className={`flex-1 flex flex-col overflow-hidden ${quizViewAnimClass}`}>
            {quizView === 'history' && renderQuizHistory()}
            {quizView === 'config' && (
              <div className="flex-1 overflow-y-auto px-6 no-scrollbar" />
            )}
            {quizView === 'play' && (
              <div className="flex-1 overflow-y-auto px-6 no-scrollbar">{renderQuizPlay()}</div>
            )}
            {quizView === 'result' && (
              <>
                <div className="px-6 py-4 flex-shrink-0">
                  <button onClick={() => { switchQuizView('history', () => { setActiveQuizSession(null); }); }}
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95 ${btnClass}`}
                  >
                    <ArrowLeft size={20} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-6 no-scrollbar">{renderQuizResult()}</div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Highlights / excerpts view */}
      {renderedTab === 'highlights' && (
        <div className={`flex-1 flex flex-col overflow-hidden ${hubTabAnimClass}`}>
          {/* Fixed header — matching notes header (h-10 = 40px row height) */}
          <div className="flex items-center justify-between px-6 pt-4 pb-2">
            <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">{'所有摘录'}</h2>
            <div className="flex items-center gap-1.5 h-10">
              <button
                type="button"
                onClick={() => setHubHighlightColorFilter(null)}
                className={`h-6 px-2 rounded-full text-[10px] font-bold transition-all ${
                  !hubHighlightColorFilter
                    ? 'text-rose-400 bg-rose-400/10'
                    : isDarkMode ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                {'全部'}
              </button>
              {PRESET_HIGHLIGHT_COLORS.filter(c => usedHighlightColors.has(c)).map(color => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setHubHighlightColorFilter(hubHighlightColorFilter === color ? null : color)}
                  className={`w-5 h-5 rounded-full border-2 transition-all ${
                    hubHighlightColorFilter === color ? 'border-rose-400 scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          {/* Fixed book filter dropdown */}
          {allBookHighlights.length > 1 && (() => {
            const toggleBook = (bookId: string) => {
              setHubHighlightBookFilter(prev =>
                prev.includes(bookId) ? prev.filter(id => id !== bookId) : [...prev, bookId]
              );
            };
            return (
              <div className="px-6 pt-1 pb-3">
                <HighlightBookMultiSelect
                  entries={allBookHighlights}
                  selected={hubHighlightBookFilter}
                  onToggle={toggleBook}
                  onClear={() => setHubHighlightBookFilter([])}
                  inputClass={inputClass}
                  cardClass={cardClass}
                  isDarkMode={isDarkMode}
                />
              </div>
            );
          })()}

          {/* Scrollable highlight list */}
          <div className="flex-1 overflow-y-auto px-6 pb-24 no-scrollbar">
            {highlightsLoading && allBookHighlights.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin text-slate-400" />
              </div>
            )}
            {!highlightsLoading && allBookHighlights.length === 0 && (
              <div className="text-center text-slate-400 text-sm py-8">
                {'还没有高亮摘录'}
              </div>
            )}
            {allBookHighlights.length > 0 && filteredHighlightGroups.length === 0 && (
              <div className="text-center text-slate-400 text-sm py-8">
                {'当前筛选条件下暂无摘录'}
              </div>
            )}
            {filteredHighlightGroups.map((entry) => {
                return (
                  <div key={entry.bookId} className="mb-6">
                    <h3 className={`text-xs font-bold uppercase tracking-wider mb-2 ${
                      isDarkMode ? 'text-slate-400' : 'text-slate-500'
                    }`}>
                      {entry.bookTitle} ({entry.items.length})
                    </h3>
                    <div className="space-y-3">
                    {entry.items.map(item => {
                      const isExpanded = expandedHighlightIds.has(item.id);
                      const toggleExpand = () => {
                        setExpandedHighlightIds(prev => {
                          const next = new Set(prev);
                          if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                          return next;
                        });
                      };
                      return (
                      <div
                        key={item.id}
                        className={`rounded-xl p-3 cursor-pointer transition-all ${cardClass}`}
                        onClick={toggleExpand}
                      >
                        <div className="flex items-start gap-2">
                          <div
                            className="w-1 self-stretch rounded-full flex-shrink-0"
                            style={{ backgroundColor: item.range.color }}
                          />
                          <div className="flex-1 min-w-0">
                            <ExpandableHighlightText text={item.text} isExpanded={isExpanded} isDarkMode={isDarkMode} />
                            <p className="text-[10px] text-slate-400 mt-1">
                              {item.chapterTitle}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => handleCopyHighlight(item.text)}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center ${btnClass}`}
                          >
                            <Copy size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteStudyHubHighlight(entry.bookId, item)}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center ${enabledDangerIconButtonClass}`}
                          >
                            <Trash2 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onJumpToBookHighlight?.(entry.bookId, item.chapterIndex, item.range.start)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-white bg-rose-400 shadow-lg hover:bg-rose-500 active:scale-95 transition-all"
                          >
                            <ExternalLink size={13} />
                          </button>
                        </div>
                      </div>
                      );
                    })}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {renderedTab === 'vocab' && (
        <div className={`flex-1 flex flex-col overflow-hidden ${hubTabAnimClass}`}>
          <div className="flex items-center justify-between px-6 pt-4 pb-2">
            <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider">生词本</h2>
            <span className={`text-xs ${subTextClass}`}>共 {totalVocabularyCount} 词</span>
          </div>

          <div className="px-6 pt-1 pb-3">
            <div className={`h-10 rounded-xl px-3 flex items-center gap-2 ${inputClass}`}>
              <Search size={15} className="opacity-60" />
              <input
                value={vocabularySearchTerm}
                onChange={(e) => setVocabularySearchTerm(e.target.value)}
                placeholder="搜索生词"
                className="flex-1 bg-transparent outline-none text-sm placeholder:text-slate-400"
              />
              {!!vocabularySearchTerm && (
                <button
                  type="button"
                  onClick={() => setVocabularySearchTerm('')}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-rose-400"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {allBookVocabulary.length > 1 && (() => {
            const entries = allBookVocabulary.map((entry) => ({
              bookId: entry.bookId,
              bookTitle: entry.bookTitle,
              items: entry.items.map((item) => ({ id: item.id })),
            }));
            const toggleBook = (bookId: string) => {
              setVocabularyBookFilter((prev) =>
                prev.includes(bookId) ? prev.filter((id) => id !== bookId) : [...prev, bookId]
              );
            };
            return (
              <div className="px-6 pb-3">
                <HighlightBookMultiSelect
                  entries={entries}
                  selected={vocabularyBookFilter}
                  onToggle={toggleBook}
                  onClear={() => setVocabularyBookFilter([])}
                  inputClass={inputClass}
                  cardClass={cardClass}
                  isDarkMode={isDarkMode}
                />
              </div>
            );
          })()}

          <div className="flex-1 overflow-y-auto px-6 pb-24 no-scrollbar">
            {vocabularyLoading && allBookVocabulary.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin text-slate-400" />
              </div>
            )}
            {!vocabularyLoading && allBookVocabulary.length === 0 && (
              <div className="text-center text-slate-400 text-sm py-8">
                还没有生词，阅读时选中后点顶部 + 即可加入
              </div>
            )}
            {allBookVocabulary.length > 0 && filteredVocabularyGroups.length === 0 && (
              <div className="text-center text-slate-400 text-sm py-8">
                当前筛选条件下暂无生词
              </div>
            )}
            {filteredVocabularyGroups.map((entry) => (
              <div key={entry.bookId} className="mb-6">
                <h3 className={`text-xs font-bold uppercase tracking-wider mb-2 ${
                  isDarkMode ? 'text-slate-400' : 'text-slate-500'
                }`}>
                  {entry.bookTitle} ({entry.items.length})
                </h3>
                <div className="space-y-2.5">
                  {entry.items.map((item) => (
                    <div key={item.id} className={`rounded-xl p-3 ${cardClass}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className={`text-base font-semibold break-words ${headingClass}`}>{item.term}</div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handlePronounceVocabulary(item.term)}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center ${btnClass}`}
                          >
                            <Volume2 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteVocabularyEntry(entry.bookId, item.id)}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center ${enabledDangerIconButtonClass}`}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {renderCreateModal()}
      {renderEditModal()}
      {renderPaperModal()}
      {renderQuizConfigModal()}
    </div>
  );
};

export default StudyHub;
