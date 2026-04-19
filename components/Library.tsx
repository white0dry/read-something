import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Book as BookIcon, Plus, Clock, Edit2, Check, UserCircle, LogOut, Link2, Search, Filter, MoreVertical, X, Image, Trash2, Link, FileText, FileUp, List, Sparkles, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, LayoutGrid, AlignJustify, HelpCircle, ChevronDown } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { Book, Chapter, ApiConfig, RagPreset } from '../types';
import { Persona, Character } from './settings/types';
import ModalPortal from './ModalPortal';
import ResolvedImage from './ResolvedImage';
import { deleteImageByRef, saveImageFile } from '../utils/imageStorage';
import { getBookContent, getBookTextLength } from '../utils/bookContentStorage';
import type { ParsedBookImportResult } from '../utils/bookImportParser';

interface LibraryProps {
  books: Book[];
  onOpenBook: (book: Book) => void;
  onAddBook: (book: Book) => Promise<boolean> | boolean;
  onRequestImportBook?: () => boolean;
  onUpdateBook: (book: Book) => void;
  onDeleteBook: (id: string) => void;
  showNotification?: (message: string, type?: 'success' | 'error') => void;
  isDarkMode: boolean;
  userSignature: string;
  onUpdateSignature: (text: string) => void;
  activeSignatureUpdateEnabled: boolean;
  signatureUpdateProbability: number;
  personas: Persona[];
  activePersonaId: string | null;
  onSelectPersona: (id: string | null) => void;
  characters: Character[];
  activeCharacterId: string | null;
  onSelectCharacter: (id: string | null) => void;
  apiConfig: ApiConfig;
  ragPresets: RagPreset[];
  activeRagPresetId: string;
}

// Custom Feather Icon provided by user
const FeatherIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" className={`bi bi-feather ${className}`} viewBox="0 0 16 16">
    <path d="M15.807.531c-.174-.177-.41-.289-.64-.363a3.8 3.8 0 0 0-.833-.15c-.62-.049-1.394 0-2.252.175C10.365.545 8.264 1.415 6.315 3.1S3.147 6.824 2.557 8.523c-.294.847-.44 1.634-.429 2.268.005.316.05.62.154.88q.025.061.056.122A68 68 0 0 0 .08 15.198a.53.53 0 0 0 .157.72.504.504 0 0 0 .705-.16 68 68 0 0 1 2.158-3.26c.285.141.616.195.958.182.513-.02 1.098-.188 1.723-.49 1.25-.605 2.744-1.787 4.303-3.642l1.518-1.55a.53.53 0 0 0 0-.739l-.729-.744 1.311.209a.5.5 0 0 0 .443-.15l.663-.684c.663-.68 1.292-1.325 1.763-1.892.314-.378.585-.752.754-1.107.163-.345.278-.773.112-1.188a.5.5 0 0 0-.112-.172M3.733 11.62C5.385 9.374 7.24 7.215 9.309 5.394l1.21 1.234-1.171 1.196-.027.03c-1.5 1.789-2.891 2.867-3.977 3.393-.544.263-.99.378-1.324.39a1.3 1.3 0 0 1-.287-.018Zm6.769-7.22c1.31-1.028 2.7-1.914 4.172-2.6a7 7 0 0 1-.4.523c-.442.533-1.028 1.134-1.681 1.804l-.51.524zm3.346-3.357C9.594 3.147 6.045 6.8 3.149 10.678c.007-.464.121-1.086.37-1.806.533-1.535 1.65-3.415 3.455-4.976 1.807-1.561 3.746-2.36 5.31-2.68a8 8 0 0 1 1.564-.173"/>
  </svg>
);

// Updated SVG Book Cover
const DefaultBookCover = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-full h-full text-slate-400 p-4" fill="currentColor" viewBox="0 0 16 16">
    <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783"/>
  </svg>
);

type SortField = 'title' | 'author' | 'progress' | 'id' | 'length';
type SortDirection = 'asc' | 'desc';
type ViewMode = 'grid' | 'list';
const SUPPORTED_BOOK_IMPORT_SUFFIXES = ['txt', 'docx', 'docm', 'dotx', 'dotm', 'pdf', 'epub', 'mobi'] as const;
const BOOK_IMPORT_ACCEPT = SUPPORTED_BOOK_IMPORT_SUFFIXES.map((suffix) => `.${suffix}`).join(',');
const SUPPORTED_IMPORT_SUFFIX_SET = new Set(SUPPORTED_BOOK_IMPORT_SUFFIXES.map((suffix) => suffix.toLowerCase()));
const BUILT_IN_TUTORIAL_BOOK_ID = '__built_in_tutorial__';
const TUTORIAL_UNREAD_KEY = '__built_in_tutorial_unread__';
const SIGNATURE_AI_LAST_SUCCESS_DATE_KEY = 'lib_signature_ai_last_success_date';
const SIGNATURE_AI_DRAW_STATE_KEY = 'lib_signature_ai_draw_state_v1';
const SIGNATURE_AI_UPDATE_PROMPT_KEY = 'app_signature_ai_update_prompt_v1';
const SIGNATURE_AI_MAX_CHARS = 120;
const SIGNATURE_AUTO_DRAW_SLOTS = [
  { hour: 9, minute: 0 },
  { hour: 14, minute: 0 },
  { hour: 21, minute: 0 },
] as const;

interface SignatureAutoDrawState {
  dateKey: string;
  attemptedSlotIndexes: number[];
}
const isBuiltInTutorialBook = (bookId: string) => bookId === BUILT_IN_TUTORIAL_BOOK_ID;
const isTutorialUnread = (): boolean => {
  try {
    return localStorage.getItem(TUTORIAL_UNREAD_KEY) === '1';
  } catch {
    return false;
  }
};

const getSupportedSuffixFromName = (name: string) => {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  const suffix = match?.[1] || '';
  if (!suffix) return '';
  return SUPPORTED_IMPORT_SUFFIX_SET.has(suffix) ? suffix : '';
};

const getUrlFileName = (url: string) => {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split('/').filter(Boolean).pop() || '';
    return segment ? decodeURIComponent(segment) : '';
  } catch {
    const sanitized = url.split('?')[0].split('#')[0];
    const segment = sanitized.split('/').filter(Boolean).pop() || '';
    return segment ? decodeURIComponent(segment) : '';
  }
};

const getFileNameFromContentDisposition = (headerValue: string | null) => {
  if (!headerValue) return '';
  const filenameStarMatch = headerValue.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (filenameStarMatch?.[1]) {
    try {
      return decodeURIComponent(filenameStarMatch[1].trim()).split(/[\\/]/).pop() || '';
    } catch {
      return filenameStarMatch[1].trim().split(/[\\/]/).pop() || '';
    }
  }

  const filenameMatch = headerValue.match(/filename\s*=\s*"?([^";]+)"?/i);
  if (filenameMatch?.[1]) {
    return filenameMatch[1].trim().split(/[\\/]/).pop() || '';
  }
  return '';
};

const inferSuffixFromContentType = (contentType: string) => {
  const normalizedType = contentType.toLowerCase();
  if (normalizedType.includes('application/epub+zip')) return 'epub';
  if (normalizedType.includes('application/pdf')) return 'pdf';
  if (normalizedType.includes('application/x-mobipocket-ebook')) return 'mobi';
  if (normalizedType.includes('application/vnd.amazon.ebook')) return 'mobi';
  if (normalizedType.includes('mobipocket')) return 'mobi';
  if (normalizedType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) return 'docx';
  if (normalizedType.includes('application/vnd.ms-word.document.macroenabled.12')) return 'docm';
  if (normalizedType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.template')) return 'dotx';
  if (normalizedType.includes('application/vnd.ms-word.template.macroenabled.12')) return 'dotm';
  if (normalizedType.includes('text/plain')) return 'txt';
  return '';
};

const ensureFileNameWithSuffix = (sourceName: string, suffix: string) => {
  const cleaned = sourceName.trim().replace(/[\\/:*?"<>|]/g, '_');
  const baseName = cleaned || 'imported-book';
  return getSupportedSuffixFromName(baseName) ? baseName : `${baseName}.${suffix}`;
};

const getLocalDateKey = (now = new Date()) => {
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const Library: React.FC<LibraryProps> = ({ 
  books,
  onOpenBook, 
  onAddBook,
  onRequestImportBook,
  onUpdateBook,
  onDeleteBook,
  showNotification,
  isDarkMode,
  userSignature,
  onUpdateSignature,
  activeSignatureUpdateEnabled,
  signatureUpdateProbability,
  personas,
  activePersonaId,
  onSelectPersona,
  characters,
  activeCharacterId,
  onSelectCharacter,
  apiConfig,
  ragPresets,
  activeRagPresetId
}) => {
  const MODAL_TRANSITION_MS = 240;
  const containerClass = isDarkMode ? 'bg-[#2d3748] text-slate-200' : 'neu-bg text-slate-600';
  const headingClass = isDarkMode ? 'text-slate-200' : 'text-slate-700';
  const subTextClass = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const cardClass = isDarkMode ? 'bg-[#2d3748] shadow-[6px_6px_12px_#232b39,-6px_-6px_12px_#374357]' : 'neu-flat';
  const pressedClass = isDarkMode ? 'bg-[#2d3748] shadow-[inset_3px_3px_6px_#232b39,inset_-3px_-3px_6px_#374357]' : 'neu-pressed';
  const inputClass = isDarkMode ? 'bg-[#2d3748] shadow-[inset_3px_3px_6px_#232b39,inset_-3px_-3px_6px_#374357] text-slate-200 placeholder-slate-500' : 'neu-pressed text-slate-600 placeholder-slate-400';
  const btnClass = isDarkMode ? 'bg-[#2d3748] shadow-[5px_5px_10px_#232b39,-5px_-5px_10px_#374357] text-slate-200' : 'neu-btn';
  const compactEditButtonClass = `w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-rose-400 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all duration-150 active:scale-95 ${
    isDarkMode
      ? `${btnClass} active:shadow-[inset_2px_2px_4px_#232b39,inset_-2px_-2px_4px_#374357]`
      : `${btnClass} active:shadow-[inset_2px_2px_4px_#c3c8ce,inset_-2px_-2px_4px_#fdffff]`
  }`;

  // State for signature editing
  const [isSignatureNoteOpen, setIsSignatureNoteOpen] = useState(false);
  const [isEditingSig, setIsEditingSig] = useState(false);
  const [tempSig, setTempSig] = useState(userSignature);
  const [isGeneratingAiSignature, setIsGeneratingAiSignature] = useState(false);
  
  // State for menus
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isCharMenuOpen, setIsCharMenuOpen] = useState(false);
  
  // State for Search, Filtering, Sorting and View Mode
  const [searchTerm, setSearchTerm] = useState('');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  
  // Persistent States initialization
  const [selectedTags, setSelectedTags] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('lib_selectedTags');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  
  const [sortField, setSortField] = useState<SortField>(() => {
    return (localStorage.getItem('lib_sortField') as SortField) || 'id';
  });
  
  const [sortDirection, setSortDirection] = useState<SortDirection>(() => {
    return (localStorage.getItem('lib_sortDirection') as SortDirection) || 'desc';
  });
  
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem('lib_viewMode') as ViewMode) || 'grid';
  });

  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);

  // State for Book Editing
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isLoadingBookContent, setIsLoadingBookContent] = useState(false);
  const [closingModal, setClosingModal] = useState<'edit' | 'import' | null>(null);
  
  // State for Book Importing
  const [importingBook, setImportingBook] = useState<Partial<Book>>({
      title: '', author: '', coverUrl: '', tags: [], fullText: '', chapterRegex: ''
  });
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  // Common Modal State
  const [urlInputMode, setUrlInputMode] = useState(false);
  const [tempCoverUrl, setTempCoverUrl] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [txtFileUrlMode, setTxtFileUrlMode] = useState(false);
  const [tempTxtUrl, setTempTxtUrl] = useState('');
  const [detectedChapters, setDetectedChapters] = useState<number>(0);
  const [detectedCharCountChapters, setDetectedCharCountChapters] = useState<number>(0);
  const [isImportStructuredChapterMode, setIsImportStructuredChapterMode] = useState(false);
  const [isEditStructuredChapterMode, setIsEditStructuredChapterMode] = useState(false);
  const [importCharCount, setImportCharCount] = useState('');
  const [editCharCount, setEditCharCount] = useState('');
  const [sessionGeneratedImageRefs, setSessionGeneratedImageRefs] = useState<string[]>([]);
  
  // State for Deletion Confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<{show: boolean, msg: string}>({ show: false, msg: '' });
  const [isErrorModalClosing, setIsErrorModalClosing] = useState(false);

  // State for RAG toggle in modals
  const [importRagEnabled, setImportRagEnabled] = useState(false);
  const [importRagPresetId, setImportRagPresetId] = useState(activeRagPresetId);
  const [editRagEnabled, setEditRagEnabled] = useState(false);
  const [editRagPresetId, setEditRagPresetId] = useState(activeRagPresetId);
  const [showRagHelpModal, setShowRagHelpModal] = useState(false);
  const [isRagHelpModalClosing, setIsRagHelpModalClosing] = useState(false);
  const [ragPresetDropdownOpen, setRagPresetDropdownOpen] = useState(false);
  const [isRagDropdownClosing, setIsRagDropdownClosing] = useState(false);
  const [ragDropdownPos, setRagDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const ragDropdownTriggerRef = useRef<HTMLDivElement>(null);

  // State for AI Regex Generation
  const [isGeneratingRegex, setIsGeneratingRegex] = useState(false);
  const [isAutoSplittingChapters, setIsAutoSplittingChapters] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());

  const signatureAutoTriggerTimerRef = useRef<number | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const charMenuRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const txtFileInputRef = useRef<HTMLInputElement>(null);
  const editModalCloseTimerRef = useRef<number | null>(null);
  const importModalCloseTimerRef = useRef<number | null>(null);
  const errorModalCloseTimerRef = useRef<number | null>(null);

  // Sync prop changes
  useEffect(() => {
    if (!isEditingSig) setTempSig(userSignature);
  }, [userSignature, isEditingSig]);
  const clearSignatureAutoTriggerTimer = () => {
    if (signatureAutoTriggerTimerRef.current) {
      window.clearTimeout(signatureAutoTriggerTimerRef.current);
      signatureAutoTriggerTimerRef.current = null;
    }
  };

  const normalizeSignatureDrawState = (raw: unknown, now = new Date()): SignatureAutoDrawState => {
    const today = getLocalDateKey(now);
    if (!raw || typeof raw !== 'object') {
      return { dateKey: today, attemptedSlotIndexes: [] };
    }
    const source = raw as Partial<SignatureAutoDrawState>;
    const dateKey = typeof source.dateKey === 'string' ? source.dateKey : '';
    if (dateKey !== today) {
      return { dateKey: today, attemptedSlotIndexes: [] };
    }
    const attemptedSlotIndexes = Array.isArray(source.attemptedSlotIndexes)
      ? Array.from(
          new Set(
            source.attemptedSlotIndexes
              .map((value) => Number(value))
              .filter((value) => Number.isInteger(value) && value >= 0 && value < SIGNATURE_AUTO_DRAW_SLOTS.length)
          )
        )
      : [];
    return { dateKey: today, attemptedSlotIndexes };
  };

  const readSignatureDrawState = (now = new Date()): SignatureAutoDrawState => {
    try {
      const raw = localStorage.getItem(SIGNATURE_AI_DRAW_STATE_KEY);
      return normalizeSignatureDrawState(raw ? JSON.parse(raw) : null, now);
    } catch {
      return normalizeSignatureDrawState(null, now);
    }
  };

  const saveSignatureDrawState = (state: SignatureAutoDrawState) => {
    try {
      localStorage.setItem(SIGNATURE_AI_DRAW_STATE_KEY, JSON.stringify(state));
    } catch {
      // Ignore localStorage write failures.
    }
  };

  const resolveDueSignatureDrawSlotIndex = (state: SignatureAutoDrawState, now = new Date()) => {
    const attempted = new Set(state.attemptedSlotIndexes);
    for (let index = 0; index < SIGNATURE_AUTO_DRAW_SLOTS.length; index += 1) {
      if (attempted.has(index)) continue;
      const slot = SIGNATURE_AUTO_DRAW_SLOTS[index];
      const slotTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        slot.hour,
        slot.minute,
        0,
        0
      );
      if (now.getTime() >= slotTime.getTime()) {
        return index;
      }
    }
    return null;
  };

  const resolveNextSignatureDrawAt = (state: SignatureAutoDrawState, now = new Date()) => {
    const attempted = new Set(state.attemptedSlotIndexes);
    for (let index = 0; index < SIGNATURE_AUTO_DRAW_SLOTS.length; index += 1) {
      if (attempted.has(index)) continue;
      const slot = SIGNATURE_AUTO_DRAW_SLOTS[index];
      const slotTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        slot.hour,
        slot.minute,
        0,
        0
      );
      if (now.getTime() < slotTime.getTime()) {
        return slotTime.getTime();
      }
    }
    const tomorrowFirstSlot = SIGNATURE_AUTO_DRAW_SLOTS[0];
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      tomorrowFirstSlot.hour,
      tomorrowFirstSlot.minute,
      0,
      0
    ).getTime();
  };

  // Sync RAG state when editingBook changes
  useEffect(() => {
    if (editingBook) {
      setEditRagEnabled(!!editingBook.ragEnabled);
      setEditRagPresetId(editingBook.ragModelPresetId || activeRagPresetId);
    }
  }, [editingBook?.id]);

  // RAG dropdown open/close helpers
  const openRagDropdown = () => {
    if (ragDropdownTriggerRef.current) {
      const rect = ragDropdownTriggerRef.current.getBoundingClientRect();
      setRagDropdownPos({ top: rect.bottom + 8, left: rect.left, width: rect.width });
    }
    setRagPresetDropdownOpen(true);
  };
  const closeRagDropdown = () => {
    if (!ragPresetDropdownOpen || isRagDropdownClosing) return;
    setIsRagDropdownClosing(true);
    setTimeout(() => {
      setRagPresetDropdownOpen(false);
      setIsRagDropdownClosing(false);
    }, 200);
  };

  // Effects to save persistent states
  useEffect(() => { localStorage.setItem('lib_selectedTags', JSON.stringify(selectedTags)); }, [selectedTags]);
  useEffect(() => { localStorage.setItem('lib_sortField', sortField); }, [sortField]);
  useEffect(() => { localStorage.setItem('lib_sortDirection', sortDirection); }, [sortDirection]);
  useEffect(() => { localStorage.setItem('lib_viewMode', viewMode); }, [viewMode]);
  useEffect(() => {
    return () => {
      if (editModalCloseTimerRef.current) window.clearTimeout(editModalCloseTimerRef.current);
      if (importModalCloseTimerRef.current) window.clearTimeout(importModalCloseTimerRef.current);
      if (errorModalCloseTimerRef.current) window.clearTimeout(errorModalCloseTimerRef.current);
      clearSignatureAutoTriggerTimer();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockNow(Date.now());
    }, 60000);
    return () => window.clearInterval(timer);
  }, []);


  // Click outside to close menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsProfileMenuOpen(false);
      }
      if (charMenuRef.current && !charMenuRef.current.contains(event.target as Node)) {
        setIsCharMenuOpen(false);
      }
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
      if (sortRef.current && !sortRef.current.contains(event.target as Node)) {
        setIsSortMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // --- Logic for Parsing Chapters ---
  const parseChapters = (text: string, regexStr: string): Chapter[] => {
    if (!text) return [];
    if (!regexStr.trim()) {
        return [{ title: '全文', content: text }];
    }

    try {
        const regex = new RegExp(`(${regexStr}.*)`, 'gm');
        const matches = [...text.matchAll(regex)];

        if (matches.length === 0) {
            return [{ title: '全文', content: text }];
        }

        const chapters: Chapter[] = [];

        if (matches[0].index && matches[0].index > 0) {
            chapters.push({
                title: '序章 / 前言',
                content: text.substring(0, matches[0].index)
            });
        }

        for (let i = 0; i < matches.length; i++) {
            const match = matches[i];
            const title = match[0].split('\n')[0].trim();
            const startIndex = match.index!;
            const endIndex = (i < matches.length - 1) ? matches[i + 1].index! : text.length;
            const content = text.substring(startIndex, endIndex);
            chapters.push({ title, content });
        }
        return chapters;

    } catch (e) {
        console.error('Regex error:', e);
        return [{ title: 'Regex Error', content: text }];
    }
  };

  // ─── Fixed character-count chapter splitting ───
  const CHARCOUNT_MIN = 500;
  const CHARCOUNT_MAX = 50000;
  const CHARCOUNT_DEFAULT = 2000;

  /** Check if position i in text is a genuine sentence-ending punctuation.
   *  Avoids false positives: decimals (3.14), numbered lists (5.这是), abbreviations (Dr.Smith). */
  const isSafeSentenceEnd = (text: string, i: number): boolean => {
    const ch = text[i];
    // CJK sentence-end punctuation — unambiguous
    if (ch === '。' || ch === '！' || ch === '？' || ch === '；' || ch === '…' || ch === '｡') return true;
    // English ! ? ; — almost always sentence-end
    if (ch === '!' || ch === '?' || ch === ';') return true;
    // English period . — needs context check
    if (ch === '.') {
      const prev = i > 0 ? text[i - 1] : '';
      const next = i < text.length - 1 ? text[i + 1] : '';
      // Decimal: 3.14 or list number: 5.
      if (/\d/.test(prev) || /\d/.test(next)) return false;
      // Abbreviation: next char is non-whitespace, non-quote, non-bracket
      if (next && !/[\s"'"\u201C\u201D\u2018\u2019\uFF09)\]】》]/.test(next)) return false;
      return true;
    }
    return false;
  };

  const parseChaptersByCharCount = (text: string, targetCount: number): Chapter[] => {
    if (!text) return [];
    const target = Math.max(CHARCOUNT_MIN, Math.min(CHARCOUNT_MAX, targetCount));
    const chapters: Chapter[] = [];
    let cursor = 0;
    let chapterIndex = 1;

    while (cursor < text.length) {
      const remaining = text.length - cursor;
      // If remaining text fits within 130% of target, make it the last chapter
      if (remaining <= target * 1.3) {
        const content = text.substring(cursor).trimStart();
        if (content) chapters.push({ title: `第${chapterIndex}章`, content });
        break;
      }

      const idealEnd = cursor + target;
      let breakPoint = -1;

      // Strategy 1: Find paragraph boundary (\n) backward from idealEnd
      const backLimit = Math.max(cursor + 1, idealEnd - Math.floor(target * 0.3));
      for (let i = idealEnd; i >= backLimit; i--) {
        if (text[i] === '\n') { breakPoint = i + 1; break; }
      }

      // Strategy 2: Find paragraph boundary forward from idealEnd
      if (breakPoint === -1) {
        const fwdLimit = Math.min(text.length, idealEnd + Math.floor(target * 0.3));
        for (let i = idealEnd + 1; i < fwdLimit; i++) {
          if (text[i] === '\n') { breakPoint = i + 1; break; }
        }
      }

      // Strategy 3: Find sentence boundary backward from idealEnd
      if (breakPoint === -1) {
        for (let i = idealEnd; i >= backLimit; i--) {
          if (isSafeSentenceEnd(text, i)) { breakPoint = i + 1; break; }
        }
      }

      // Fallback: hard cut at idealEnd
      if (breakPoint === -1) breakPoint = idealEnd;

      const content = text.substring(cursor, breakPoint).trimStart();
      if (content) chapters.push({ title: `第${chapterIndex}章`, content });
      cursor = breakPoint;
      chapterIndex++;
    }
    return chapters;
  };

  const normalizeTocLine = (raw: string) => {
    return raw
      .replace(/^[\s\u3000]+|[\s\u3000]+$/g, '')
      .replace(/[·•●⋯….\-_=]{2,}\s*\d+\s*$/g, '')
      .replace(/\s+\d+\s*$/g, '')
      .replace(/[ \t\u3000]+/g, ' ')
      .trim();
  };

  const normalizeTitleForMatch = (line: string) =>
    line.toLowerCase().replace(/[\s\u3000:：·•⋯….,，。!?！？'"“”‘’()（）\[\]【】\-—_]/g, '');

  const isLikelyChapterTitle = (line: string) => {
    if (!line) return false;
    if (line.length < 2 || line.length > 120) return false;
    if (/^(目录|contents?)$/i.test(line)) return false;
    if (/^(第[\s　]*[0-9一二三四五六七八九十百千万零〇两]+[\s　]*[章节卷回部篇集幕].*)$/.test(line)) return true;
    if (/^(chapter|chap\.?)\s*[0-9ivxlcdm]+[\s:：.\-_].*$/i.test(line)) return true;
    if (/^(序章|前言|楔子|引子|后记|尾声|番外|附录|终章)$/.test(line)) return true;
    return false;
  };

  const isLikelyNarrativeLine = (line: string) => {
    const trimmed = (line || '').trim();
    if (!trimmed || trimmed.length < 20) return false;
    if (!/[。！？.!?]/.test(trimmed)) return false;
    if (/^[\d\s\-.•·●_=]+$/.test(trimmed)) return false;
    return true;
  };

  const sanitizeTocTitles = (titles: string[]) => {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const raw of titles) {
      const cleaned = normalizeTocLine(raw).replace(/^["'“”‘’]|["'“”‘’]$/g, '').trim();
      if (!cleaned) continue;
      const key = normalizeTitleForMatch(cleaned);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      normalized.push(cleaned);
      if (normalized.length >= 400) break;
    }
    return normalized;
  };

  const extractTocTitlesFromText = (text: string): string[] => {
    const normalizedText = (text || '').replace(/\r\n?/g, '\n');
    const lines = normalizedText.split('\n');
    if (lines.length === 0) return [];

    const tocAnchor = lines.findIndex((line, idx) => idx < 1200 && /(目录|contents?)/i.test(line.trim()));
    const start = tocAnchor >= 0 ? tocAnchor + 1 : 0;
    const end = Math.min(lines.length, start + 700);

    const titles: string[] = [];
    let emptyRun = 0;
    for (let i = start; i < end; i += 1) {
      const cleaned = normalizeTocLine(lines[i] || '');
      if (!cleaned) {
        emptyRun += 1;
        if (titles.length >= 3 && emptyRun >= 3) break;
        continue;
      }
      emptyRun = 0;
      if (!isLikelyChapterTitle(cleaned)) continue;
      titles.push(cleaned);
    }
    return sanitizeTocTitles(titles);
  };

  const findTocBodyStartLine = (lines: string[], titleKeys: string[]) => {
    const tocAnchor = lines.findIndex((line, idx) => idx < 1200 && /(目录|contents?)/i.test(line.trim()));
    if (tocAnchor < 0) return 0;

    const keySet = new Set(titleKeys.filter(Boolean));
    const tocProbeEnd = Math.min(lines.length, tocAnchor + 2200);
    let lastTocLine = tocAnchor;

    for (let i = tocAnchor + 1; i < tocProbeEnd; i += 1) {
      const key = normalizeTitleForMatch(normalizeTocLine(lines[i] || ''));
      if (key && keySet.has(key)) {
        lastTocLine = i;
        continue;
      }

      if (i - lastTocLine > 120 && isLikelyNarrativeLine(lines[i] || '')) {
        return Math.max(lastTocLine + 1, i - 2);
      }
    }

    for (let i = lastTocLine + 1; i < Math.min(lines.length, lastTocLine + 900); i += 1) {
      const current = lines[i] || '';
      const next = lines[i + 1] || '';
      const key = normalizeTitleForMatch(normalizeTocLine(current));
      if (key && keySet.has(key) && isLikelyNarrativeLine(next)) {
        return i;
      }
      if (isLikelyNarrativeLine(current)) {
        return Math.max(lastTocLine + 1, i - 1);
      }
    }

    return lastTocLine + 1;
  };

  const splitChaptersByTocTitles = (text: string, titles: string[]): Chapter[] => {
    const normalizedTitles = sanitizeTocTitles(titles);
    if (normalizedTitles.length < 2) return [];

    const normalizedText = (text || '').replace(/\r\n?/g, '\n');
    const lines = normalizedText.split('\n');
    if (lines.length === 0) return [];

    const lineOffsets: number[] = new Array(lines.length).fill(0);
    let offsetCursor = 0;
    for (let i = 0; i < lines.length; i += 1) {
      lineOffsets[i] = offsetCursor;
      offsetCursor += lines[i].length + (i < lines.length - 1 ? 1 : 0);
    }

    const titleKeys = normalizedTitles.map((title) => normalizeTitleForMatch(title));
    const startLine = findTocBodyStartLine(lines, titleKeys);
    const hits: Array<{ title: string; offset: number }> = [];
    let scanLine = Math.max(0, startLine);

    for (let t = 0; t < normalizedTitles.length; t += 1) {
      const wanted = titleKeys[t];
      if (!wanted) continue;
      let foundLine = -1;
      for (let i = scanLine; i < lines.length; i += 1) {
        const lineKey = normalizeTitleForMatch(normalizeTocLine(lines[i] || ''));
        if (!lineKey) continue;
        if (lineKey === wanted || (lineKey.length > 8 && (lineKey.includes(wanted) || wanted.includes(lineKey)))) {
          foundLine = i;
          break;
        }
      }
      if (foundLine < 0) continue;
      hits.push({
        title: normalizeTocLine(lines[foundLine] || normalizedTitles[t]),
        offset: lineOffsets[foundLine],
      });
      scanLine = foundLine + 1;
    }

    if (hits.length < 2) return [];

    const chapters: Chapter[] = [];
    if (hits[0].offset > 0) {
      const preface = normalizedText.slice(0, hits[0].offset).trim();
      if (preface) chapters.push({ title: '序章 / 前言', content: preface });
    }

    for (let i = 0; i < hits.length; i += 1) {
      const start = hits[i].offset;
      const end = i < hits.length - 1 ? hits[i + 1].offset : normalizedText.length;
      if (end <= start) continue;
      const content = normalizedText.slice(start, end).trim();
      if (!content) continue;
      chapters.push({ title: hits[i].title || `第${i + 1}章`, content });
    }

    return chapters;
  };

  const parseAiTitleList = (raw: string): string[] => {
    const cleaned = (raw || '')
      .replace(/```(?:json|javascript|js|text)?\n?([\s\S]*?)```/gi, '$1')
      .trim();
    if (!cleaned) return [];

    try {
      const parsed = JSON.parse(cleaned);
      const titleList = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { titles?: unknown[] }).titles)
        ? (parsed as { titles: unknown[] }).titles
        : [];
      if (titleList.length > 0) {
        return titleList.map((item) => String(item || '').trim()).filter(Boolean);
      }
    } catch {
      // Fall through to line parsing.
    }

    return cleaned
      .split('\n')
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)、．])\s*/, '').trim())
      .filter(Boolean);
  };

  const requestAiTocTitles = async (text: string): Promise<string[]> => {
    if (!apiConfig.apiKey) return [];

    const normalizedText = (text || '').replace(/\r\n?/g, '\n');
    if (!normalizedText) return [];
    const lines = normalizedText.split('\n');
    const tocAnchor = lines.findIndex((line, idx) => idx < 1500 && /(目录|contents?)/i.test((line || '').trim()));
    const sample =
      tocAnchor >= 0
        ? lines.slice(Math.max(0, tocAnchor - 10), Math.min(lines.length, tocAnchor + 1000)).join('\n').slice(0, 70000)
        : normalizedText.slice(0, 70000);

    const endpoint = apiConfig.endpoint.replace(/\/+$/, '');
    const systemPrompt = `你是电子书目录提取助手。请从文本中提取章节标题，按顺序返回 JSON。
输出要求：
1. 只输出 JSON 数组，或 {"titles": [...]}；
2. 每项是章节标题字符串；
3. 不要输出解释、注释、markdown；
4. 如果识别不到章节目录，返回 []。`;

    let aiRaw = '';
    if (apiConfig.provider === 'GEMINI') {
      const ai = new GoogleGenAI({ apiKey: apiConfig.apiKey });
      const response = await ai.models.generateContent({
        model: apiConfig.model || 'gemini-3-pro-preview',
        contents: `${systemPrompt}\n\n文本：\n${sample}`,
      });
      aiRaw = response.text || '';
    } else if (apiConfig.provider === 'CLAUDE') {
      const response = await fetch(`${endpoint}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiConfig.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: apiConfig.model,
          max_tokens: 1000,
          messages: [{ role: 'user', content: `${systemPrompt}\n\n文本：\n${sample}` }],
        }),
      });
      if (!response.ok) throw new Error(`Claude API Error: ${response.status}`);
      const data = await response.json();
      aiRaw = data.content?.[0]?.text || '';
    } else {
      const response = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiConfig.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: apiConfig.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `文本：\n${sample}` },
          ],
          temperature: 0.1,
        }),
      });
      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      const data = await response.json();
      aiRaw = data.choices?.[0]?.message?.content || '';
    }

    return sanitizeTocTitles(parseAiTitleList(aiRaw));
  };

  const parseImportedBookFileAsync = async (file: File): Promise<ParsedBookImportResult> => {
    const parserModule = await import('../utils/bookImportParser');
    return parserModule.parseImportedBookFile(file);
  };

  const resolveTocAssistedChapters = async (
    fullText: string,
    options?: { notifyMissingApi?: boolean }
  ): Promise<Chapter[] | null> => {
    const localTitles = extractTocTitlesFromText(fullText);
    const localSplit = splitChaptersByTocTitles(fullText, localTitles);
    if (localSplit.length >= 2) return localSplit;

    if (!apiConfig.apiKey) {
      if (options?.notifyMissingApi) {
        showNotification?.('请设置api', 'error');
      }
      return null;
    }

    try {
      const aiTitles = await requestAiTocTitles(fullText);
      const aiSplit = splitChaptersByTocTitles(fullText, aiTitles);
      if (aiSplit.length >= 2) return aiSplit;
    } catch (error) {
      console.warn('AI chapter assist failed, fallback to original chapters:', error);
    }

    return null;
  };

  const maybeAssistEpubSplit = async (
    parsed: ParsedBookImportResult
  ): Promise<ParsedBookImportResult> => {
    if (parsed.format !== 'epub') return parsed;
    if ((parsed.chapters?.length || 0) > 1) return parsed;
    if (!parsed.fullText || parsed.fullText.length < 6000) return parsed;

    showNotification?.('正在分析目录……');
    const assistedChapters = await resolveTocAssistedChapters(parsed.fullText, { notifyMissingApi: true });
    if (assistedChapters && assistedChapters.length >= 2) {
      return { ...parsed, chapters: assistedChapters };
    }
    return parsed;
  };

  const hasStructuredChapterBlocks = (chapters: Chapter[] | undefined) => {
    if (!Array.isArray(chapters) || chapters.length === 0) return false;
    const hasAnyBlocks = chapters.some((chapter) => Array.isArray(chapter.blocks) && chapter.blocks.length > 0);
    if (!hasAnyBlocks) return false;
    if (chapters.length > 1) return true;
    return chapters.some((chapter) => Array.isArray(chapter.blocks) && chapter.blocks.some((block) => block.type === 'image'));
  };

  const cleanupImageRefs = (imageRefs: string[]) => {
    imageRefs.forEach((imageRef) => {
      if (!imageRef) return;
      deleteImageByRef(imageRef).catch((error) => {
        console.error('Failed to cleanup temporary import image:', error);
      });
    });
  };

  const replaceSessionGeneratedImageRefs = (nextRefs: string[]) => {
    setSessionGeneratedImageRefs((prev) => {
      const staleRefs = prev.filter((ref) => !nextRefs.includes(ref));
      if (staleRefs.length > 0) cleanupImageRefs(staleRefs);
      return nextRefs;
    });
  };

  const clearSessionGeneratedImageRefs = (cleanup: boolean) => {
    setSessionGeneratedImageRefs((prev) => {
      if (cleanup && prev.length > 0) cleanupImageRefs(prev);
      return [];
    });
  };

  const getStructuredChapterMode = (isEdit: boolean) => {
    return isEdit ? isEditStructuredChapterMode : isImportStructuredChapterMode;
  };

  const resolveChaptersForSave = (book: Partial<Book>, isEdit: boolean) => {
    // Highest priority: fixed character-count splitting
    const charCountStr = isEdit ? editCharCount : importCharCount;
    const charCountNum = parseInt(charCountStr);
    if (charCountStr.trim() && charCountNum >= CHARCOUNT_MIN) {
      return parseChaptersByCharCount(book.fullText || '', charCountNum);
    }
    // Then: structured chapters (EPUB/PDF/WORD)
    const structuredEnabled = getStructuredChapterMode(isEdit);
    const structuredChapters = Array.isArray(book.chapters) ? book.chapters : [];
    if (structuredEnabled && structuredChapters.length > 0) {
      return structuredChapters;
    }
    // Fallback: regex
    return parseChapters(book.fullText || '', book.chapterRegex || '');
  };

  useEffect(() => {
    let text = '';
    let regex = '';
    let structuredChapterCount = 0;
    
    if (isImportModalOpen) {
        text = importingBook.fullText || '';
        regex = importingBook.chapterRegex || '';
        if (isImportStructuredChapterMode && Array.isArray(importingBook.chapters)) {
          structuredChapterCount = importingBook.chapters.length;
        }
    } else if (isEditModalOpen && editingBook) {
        text = editingBook.fullText || '';
        regex = editingBook.chapterRegex || '';
        if (isEditStructuredChapterMode && Array.isArray(editingBook.chapters)) {
          structuredChapterCount = editingBook.chapters.length;
        }
    }

    // Charcount detection (independent)
    const charCountStr = isImportModalOpen ? importCharCount : editCharCount;
    const charCountNum = parseInt(charCountStr);
    if (text && charCountStr.trim() && charCountNum >= CHARCOUNT_MIN) {
        setDetectedCharCountChapters(parseChaptersByCharCount(text, charCountNum).length);
    } else {
        setDetectedCharCountChapters(0);
    }

    // Regex / structured detection
    if (structuredChapterCount > 0) {
        setDetectedChapters(structuredChapterCount);
        return;
    }

    if (text) {
        const chapters = parseChapters(text, regex);
        setDetectedChapters(chapters.length);
    } else {
        setDetectedChapters(0);
    }
  }, [
    importingBook.fullText,
    importingBook.chapterRegex,
    importingBook.chapters,
    editingBook?.fullText,
    editingBook?.chapterRegex,
    editingBook?.chapters,
    isImportStructuredChapterMode,
    isEditStructuredChapterMode,
    isImportModalOpen,
    isEditModalOpen,
    importCharCount,
    editCharCount,
  ]);

  const openSignatureNote = () => {
    setTempSig(userSignature);
    setIsEditingSig(false);
    setIsSignatureNoteOpen(true);
  };

  const closeSignatureNote = () => {
    setIsSignatureNoteOpen(false);
    setIsEditingSig(false);
    setTempSig(userSignature);
  };

  const handleSaveSig = () => {
    const next = Array.from(tempSig).slice(0, SIGNATURE_AI_MAX_CHARS).join('');
    onUpdateSignature(next);
    setTempSig(next);
    setIsEditingSig(false);
  };

  const handleCancelSigEdit = () => {
    setTempSig(userSignature);
    setIsEditingSig(false);
  };

  const handleSignatureEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSaveSig();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelSigEdit();
    }
  };

  const handleSelectCharacter = (charId: string | null) => {
    onSelectCharacter(charId);
    setIsCharMenuOpen(false);

    if (charId) {
       const selectedChar = characters.find(c => c.id === charId);
       if (selectedChar) {
          const boundPersona = personas.find(p => p.boundRoles.includes(selectedChar.name));
          if (boundPersona) {
             onSelectPersona(boundPersona.id);
          }
       }
    }
  };

  // --- Filtering & Searching & Sorting Logic ---
  const allTags: string[] = Array.from(
    new Set(
      books.flatMap((book) =>
        Array.isArray(book.tags)
          ? book.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
          : []
      )
    )
  );
  const filteredBooks = books.filter(book => {
    const matchesSearch = 
      book.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
      book.author.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTags = selectedTags.length === 0 || selectedTags.every(tag => book.tags?.includes(tag));
    return matchesSearch && matchesTags;
  });
  const getTextLength = (book: Partial<Book>) => getBookTextLength(book);

  // Apply Sorting
  const sortedBooks = [...filteredBooks].sort((a, b) => {
    let result = 0;
    switch (sortField) {
      case 'title':
        result = a.title.localeCompare(b.title, 'zh');
        break;
      case 'author':
        result = a.author.localeCompare(b.author, 'zh');
        break;
      case 'progress':
        result = a.progress - b.progress;
        break;
      case 'length':
        const lenA = getTextLength(a);
        const lenB = getTextLength(b);
        result = lenA - lenB;
        break;
      case 'id':
      default:
        // Assume ID is timestamp-based, or just fallback order
        result = parseInt(a.id) - parseInt(b.id);
        break;
    }
    return sortDirection === 'asc' ? result : -result;
  });

  const toggleTagFilter = (tag: string) => {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };
  const isSearching = searchTerm.trim() !== '' || selectedTags.length > 0;

  // --- Modal Logic (Shared for Edit/Import) ---

  const resetModalState = () => {
     setTempCoverUrl('');
     setUrlInputMode(false);
     setTagInput('');
     setTempTxtUrl('');
     setTxtFileUrlMode(false);
     setDetectedChapters(0);
     setIsGeneratingRegex(false);
     setIsImportStructuredChapterMode(false);
     setIsEditStructuredChapterMode(false);
  };

  // Open Edit
  const openEditModal = (e: React.MouseEvent, book: Book) => {
    e.stopPropagation();
    if (isBuiltInTutorialBook(book.id)) return;
    clearSessionGeneratedImageRefs(true);
    if (editModalCloseTimerRef.current) {
      window.clearTimeout(editModalCloseTimerRef.current);
      editModalCloseTimerRef.current = null;
    }
    setEditingBook({ ...book, tags: book.tags || [], fullText: '', chapters: [] });
    setIsEditStructuredChapterMode(false);
    setEditCharCount(book.chapterCharCount ? String(book.chapterCharCount) : '');
    setIsLoadingBookContent(true);
    setClosingModal(prev => prev === 'edit' ? null : prev);
    setIsEditModalOpen(true);
    resetModalState();

    getBookContent(book.id)
      .then((content) => {
        setEditingBook(prev => {
          if (!prev || prev.id !== book.id) return prev;
          return {
            ...prev,
            fullText: content?.fullText || '',
            chapters: content?.chapters || [],
          };
        });
        setIsEditStructuredChapterMode(hasStructuredChapterBlocks(content?.chapters || []));
      })
      .catch((error) => {
        console.error('Failed to load book content for edit modal:', error);
        setIsEditStructuredChapterMode(false);
        openErrorModal('读取书籍正文失败，请稍后重试。');
      })
      .finally(() => {
        setIsLoadingBookContent(false);
      });
  };

  // Open Import
  const openImportModal = () => {
     if (onRequestImportBook && onRequestImportBook() === false) return;
     clearSessionGeneratedImageRefs(true);
     if (importModalCloseTimerRef.current) {
       window.clearTimeout(importModalCloseTimerRef.current);
       importModalCloseTimerRef.current = null;
     }
     setImportingBook({
         title: '', author: '', coverUrl: '', tags: [], fullText: '', chapterRegex: '', progress: 0, lastRead: '从未阅读'
     });
     setIsImportStructuredChapterMode(false);
     setImportCharCount('');
     setClosingModal(prev => prev === 'import' ? null : prev);
     setIsImportModalOpen(true);
     resetModalState();
  };

  const closeEditModal = (options?: { preserveGeneratedImages?: boolean }) => {
    if (!isEditModalOpen) return;
    if (!options?.preserveGeneratedImages) {
      clearSessionGeneratedImageRefs(true);
    }
    setIsLoadingBookContent(false);
    setClosingModal('edit');
    if (editModalCloseTimerRef.current) window.clearTimeout(editModalCloseTimerRef.current);
    editModalCloseTimerRef.current = window.setTimeout(() => {
      setIsEditModalOpen(false);
      setEditingBook(null);
      setIsEditStructuredChapterMode(false);
      setClosingModal(prev => prev === 'edit' ? null : prev);
    }, MODAL_TRANSITION_MS);
  };

  const closeImportModal = (options?: { preserveGeneratedImages?: boolean }) => {
    if (!isImportModalOpen) return;
    if (!options?.preserveGeneratedImages) {
      clearSessionGeneratedImageRefs(true);
    }
    setClosingModal('import');
    if (importModalCloseTimerRef.current) window.clearTimeout(importModalCloseTimerRef.current);
    importModalCloseTimerRef.current = window.setTimeout(() => {
      setIsImportModalOpen(false);
      setImportingBook({});
      setIsImportStructuredChapterMode(false);
      setImportRagEnabled(false);
      setImportRagPresetId(activeRagPresetId);
      setClosingModal(prev => prev === 'import' ? null : prev);
    }, MODAL_TRANSITION_MS);
  };

  const openErrorModal = (msg: string) => {
    if (errorModalCloseTimerRef.current) {
      window.clearTimeout(errorModalCloseTimerRef.current);
      errorModalCloseTimerRef.current = null;
    }
    setIsErrorModalClosing(false);
    setErrorModal({ show: true, msg });
  };

  const closeErrorModal = () => {
    if (!errorModal.show) return;
    setIsErrorModalClosing(true);
    if (errorModalCloseTimerRef.current) window.clearTimeout(errorModalCloseTimerRef.current);
    errorModalCloseTimerRef.current = window.setTimeout(() => {
      setErrorModal({ show: false, msg: '' });
      setIsErrorModalClosing(false);
    }, MODAL_TRANSITION_MS);
  };

  // Save Edit
  const saveBookChanges = () => {
    if (editingBook) {
      // Mutual exclusion check: regex and charcount can't both have values
      if (editCharCount.trim() && (editingBook.chapterRegex || '').trim()) {
        openErrorModal('正则拆章和定字拆章只能二选一，请清空其中一个输入框。');
        return;
      }
      const chapters = resolveChaptersForSave(editingBook, true);
      const updatedBook = {
        ...editingBook,
        chapterRegex: isEditStructuredChapterMode ? '' : (editingBook.chapterRegex || ''),
        chapterCharCount: editCharCount.trim() ? parseInt(editCharCount) : undefined,
        chapters,
        ragEnabled: editRagEnabled,
        ragModelPresetId: editRagEnabled ? editRagPresetId : undefined,
      };
      onUpdateBook(updatedBook);
      clearSessionGeneratedImageRefs(false);
      closeEditModal({ preserveGeneratedImages: true });
    }
  };

  // Save Import
  const saveImportBook = async () => {
     if (importingBook.title) {
        // Mutual exclusion check: regex and charcount can't both have values
        const importRegex = isImportStructuredChapterMode ? '' : (importingBook.chapterRegex || '');
        if (importCharCount.trim() && importRegex.trim()) {
          openErrorModal('正则拆章和定字拆章只能二选一，请清空其中一个输入框。');
          return;
        }
        const text = importingBook.fullText || '';
        const chapters = resolveChaptersForSave(importingBook, false);

        const newBook: Book = {
            id: Date.now().toString(),
            title: importingBook.title,
            author: importingBook.author || '佚名',
            coverUrl: importingBook.coverUrl || '',
            tags: importingBook.tags || [],
            progress: 0,
            lastRead: '从未阅读',
            fullText: text,
            chapterRegex: importRegex,
            chapters: chapters,
            chapterCharCount: importCharCount.trim() ? parseInt(importCharCount) : undefined,
            ragEnabled: importRagEnabled,
            ragModelPresetId: importRagEnabled ? importRagPresetId : undefined,
        };
        const saved = await onAddBook(newBook);
        if (!saved) return;
        clearSessionGeneratedImageRefs(false);
        closeImportModal({ preserveGeneratedImages: true });
     }
  };

  // Handlers for Inputs
  const handleCoverFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const targetBook = isEditModalOpen ? editingBook : importingBook;
    const setTarget = isEditModalOpen ? setEditingBook : setImportingBook;

    if (file && targetBook) {
      const oldCover = targetBook.coverUrl || '';
      try {
        const imageRef = await saveImageFile(file);
        // @ts-ignore
        setTarget({ ...targetBook, coverUrl: imageRef });
        if (oldCover && oldCover !== imageRef) {
          deleteImageByRef(oldCover).catch(err => console.error('Failed to delete old cover image:', err));
        }
      } catch (error) {
        console.error('Failed to save cover image:', error);
        openErrorModal('图片保存失败，请重试或使用网络链接。');
      } finally {
        e.target.value = '';
      }
    }
  };

  const handleCoverUrlSubmit = () => {
    const targetBook = isEditModalOpen ? editingBook : importingBook;
    const setTarget = isEditModalOpen ? setEditingBook : setImportingBook;

    if (targetBook && tempCoverUrl.trim()) {
      const oldCover = targetBook.coverUrl || '';
      // @ts-ignore
      setTarget({ ...targetBook, coverUrl: tempCoverUrl });
      if (oldCover && oldCover !== tempCoverUrl) {
        deleteImageByRef(oldCover).catch(err => console.error('Failed to delete old cover image:', err));
      }
      setUrlInputMode(false);
      setTempCoverUrl('');
    }
  };

  const applyParsedBookImportResult = (
    parsed: ParsedBookImportResult,
    setTarget: typeof setEditingBook | typeof setImportingBook,
    isEdit: boolean
  ) => {
    const structuredMode =
      parsed.format === 'epub' || parsed.format === 'pdf' || parsed.format === 'mobi' || hasStructuredChapterBlocks(parsed.chapters);

    if (isEdit) {
      setIsEditStructuredChapterMode(structuredMode);
    } else {
      setIsImportStructuredChapterMode(structuredMode);
    }

    replaceSessionGeneratedImageRefs(parsed.generatedImageRefs || []);
    // @ts-ignore
    setTarget(prev => ({
      ...prev,
      title: parsed.title,
      author: parsed.author,
      coverUrl: parsed.coverUrl || '',
      fullText: parsed.fullText || '',
      chapters: parsed.chapters || [],
      chapterRegex: structuredMode ? '' : (prev?.chapterRegex || ''),
    }));
  };

  const handleBookFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const setTarget = isEditModalOpen ? setEditingBook : setImportingBook;

    if (!file) {
      e.target.value = '';
      return;
    }

    try {
      showNotification?.('导入中……');
      const parsed = await parseImportedBookFileAsync(file);
      const assistedParsed = await maybeAssistEpubSplit(parsed);
      applyParsedBookImportResult(assistedParsed, setTarget, isEditModalOpen);
    } catch (error) {
      console.error('Failed to parse imported file:', error);
      const message = error instanceof Error ? error.message : 'Unable to parse the selected file.';
      openErrorModal(`导入失败：${message}`);
    } finally {
      e.target.value = '';
    }
  };

  const handleTxtUrlSubmit = async () => {
    const targetBook = isEditModalOpen ? editingBook : importingBook;
    const setTarget = isEditModalOpen ? setEditingBook : setImportingBook;
    const sourceUrl = tempTxtUrl.trim();
    if (!targetBook || !sourceUrl) return;

    try {
      showNotification?.('导入中……');
      const response = await fetch(sourceUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const contentType = (response.headers.get('content-type') || blob.type || '').toLowerCase();
      const nameFromHeader = getFileNameFromContentDisposition(response.headers.get('content-disposition'));
      const nameFromUrl = getUrlFileName(sourceUrl);
      const sourceName = nameFromHeader || nameFromUrl || 'imported-book';

      let suffix = getSupportedSuffixFromName(sourceName);
      if (!suffix) {
        suffix = inferSuffixFromContentType(contentType);
      }
      if (!suffix) {
        throw new Error('无法识别文件格式。请使用带有 .txt / .docx / .epub / .pdf / .mobi 后缀的链接，或提供正确的文件 Content-Type。');
      }

      const fileName = ensureFileNameWithSuffix(sourceName, suffix);
      const remoteFile = new File([blob], fileName, {
        type: blob.type || contentType || 'application/octet-stream',
      });

      const parsed = await parseImportedBookFileAsync(remoteFile);
      const assistedParsed = await maybeAssistEpubSplit(parsed);
      applyParsedBookImportResult(assistedParsed, setTarget, isEditModalOpen);
      setTxtFileUrlMode(false);
      setTempTxtUrl('');
    } catch (error) {
      console.error('Failed to parse imported file from URL:', error);
      const message = error instanceof Error ? error.message : '无法读取链接内容';
      openErrorModal(`导入失败：${message}`);
    }
  };

  const addTag = () => {
    const targetBook = isEditModalOpen ? editingBook : importingBook;
    const setTarget = isEditModalOpen ? setEditingBook : setImportingBook;

    if (targetBook && tagInput.trim() && !targetBook.tags?.includes(tagInput.trim())) {
      const currentTags = targetBook.tags || [];
      // @ts-ignore
      setTarget({ ...targetBook, tags: [...currentTags, tagInput.trim()] });
      setTagInput('');
    }
  };

  const removeTag = (tagToRemove: string) => {
    const targetBook = isEditModalOpen ? editingBook : importingBook;
    const setTarget = isEditModalOpen ? setEditingBook : setImportingBook;

    if (targetBook) {
      const currentTags = targetBook.tags || [];
      // @ts-ignore
      setTarget({ ...targetBook, tags: currentTags.filter(t => t !== tagToRemove) });
    }
  };

  const handleManualAutoSplitChapters = async () => {
    const targetBook = isEditModalOpen ? editingBook : importingBook;
    const setTarget = isEditModalOpen ? setEditingBook : setImportingBook;
    const fullText = targetBook?.fullText || '';

    if (!fullText.trim()) {
      openErrorModal('请先导入书籍正文内容');
      return;
    }
    if (isAutoSplittingChapters) return;

    setIsAutoSplittingChapters(true);
    showNotification?.('正在分析目录……');
    try {
      const assistedChapters = await resolveTocAssistedChapters(fullText, { notifyMissingApi: true });
      if (!assistedChapters || assistedChapters.length < 2) {
        if (apiConfig.apiKey) {
          showNotification?.('未识别到可用目录，保持原章节', 'error');
        }
        return;
      }

      // @ts-ignore
      setTarget((prev) => ({
        ...prev,
        chapters: assistedChapters,
        chapterRegex: '',
      }));
      if (isEditModalOpen) {
        setIsEditStructuredChapterMode(true);
      } else {
        setIsImportStructuredChapterMode(true);
      }
      showNotification?.(`分章完成，共 ${assistedChapters.length} 章`, 'success');
    } catch (error) {
      console.error('Manual chapter split failed:', error);
      showNotification?.('自动分章节失败，请稍后重试', 'error');
    } finally {
      setIsAutoSplittingChapters(false);
    }
  };

  // AI Regex Auto Generate with Real API
  const handleAutoGenerateRegex = async () => {
      if (!apiConfig.apiKey) {
        openErrorModal('请先在设置中配置 API Key');
        return;
      }

      const targetBook = isEditModalOpen ? editingBook : importingBook;
      const setTarget = isEditModalOpen ? setEditingBook : setImportingBook;
      const currentInput = targetBook?.chapterRegex || '';

      if (!currentInput.trim()) {
          openErrorModal('请先在输入框中填入一个章节标题示例，例如："第一章 起点" 或 "Chapter 1"');
          return;
      }

      setIsGeneratingRegex(true);

      const systemPrompt = `你是一个正则表达式专家。用户提供了一个小说章节标题示例。
请生成一个 JavaScript 正则表达式来匹配此类章节标题。
重要规则：
1. 必须匹配行首 (^) ，因为我们要按行匹配章节。
2. 兼容数字变化（阿拉伯数字、中文数字）。
3. 只返回正则表达式字符串本身，不要包含斜杠 /.../，不要 markdown，不要解释代码。
4. 如果示例包含多余空格，正则应兼容空格 (\\s*)。
5. 请容错用户可能输入的多行文本，只针对第一行标题生成正则。

输入: "第1章 开始"
输出: ^第\\s*[0-9]+\\s*章

输入: "Chapter 1"
输出: ^Chapter\\s*\\d+`;

      try {
        let regexResult = '';
        const endpoint = apiConfig.endpoint.replace(/\/+$/, '');

        if (apiConfig.provider === 'GEMINI') {
           const ai = new GoogleGenAI({ apiKey: apiConfig.apiKey });
           const response = await ai.models.generateContent({
             model: apiConfig.model || 'gemini-3-pro-preview',
             contents: `${systemPrompt}\n\n用户输入示例: "${currentInput}"`,
           });

           regexResult = response.text || '';

        } else if (apiConfig.provider === 'CLAUDE') {
            const response = await fetch(`${endpoint}/v1/messages`, {
              method: 'POST',
              headers: {
                'x-api-key': apiConfig.apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
              },
              body: JSON.stringify({
                model: apiConfig.model,
                max_tokens: 100,
                messages: [
                  { role: 'user', content: `${systemPrompt}\n\n用户输入示例: "${currentInput}"` }
                ]
              })
            });
            if (!response.ok) throw new Error(`Claude API Error: ${response.status}`);
            const data = await response.json();
            regexResult = data.content?.[0]?.text || '';

        } else {
            const response = await fetch(`${endpoint}/chat/completions`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiConfig.apiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                model: apiConfig.model,
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: `用户输入示例: "${currentInput}"` }
                ]
              })
            });
            if (!response.ok) throw new Error(`API Error: ${response.status}`);
            const data = await response.json();
            regexResult = data.choices?.[0]?.message?.content || '';
        }

        let cleaned = regexResult;
        cleaned = cleaned.replace(/```(?:regex|javascript|js)?\n?([\s\S]*?)```/gi, '$1');
        const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l);
        const regexLine = lines.find(l => l.startsWith('^'));
        if (regexLine) {
            cleaned = regexLine;
        } else {
            cleaned = cleaned.replace(/^["']|["']$/g, '');
            if (cleaned.startsWith('/') && cleaned.lastIndexOf('/') > 0) {
                 cleaned = cleaned.substring(1, cleaned.lastIndexOf('/'));
            }
        }
        cleaned = cleaned.trim();

        if (cleaned) {
           // @ts-ignore
           setTarget({ ...targetBook, chapterRegex: cleaned });
        } else {
           throw new Error('API 返回内容无法解析为正则');
        }

      } catch (e: any) {
         const errorMessage = e instanceof Error ? e.message : String(e);
         openErrorModal('自动生成失败: ' + errorMessage);
      } finally {
         setIsGeneratingRegex(false);
      }
  };

  const handleDeleteClick = () => {
    if (editingBook) {
      setDeleteConfirmId(editingBook.id);
    }
  };

  const confirmDelete = () => {
    if (deleteConfirmId) {
      onDeleteBook(deleteConfirmId);
      setDeleteConfirmId(null);
      closeEditModal();
    }
  };

  // Resolve active persona (USER)
  const activePersona = personas.find(p => p.id === activePersonaId);
  const userDisplayName = activePersona ? activePersona.name : 'User';
  const defaultUserImg = 'https://i.postimg.cc/50zdSZBZ/49161205-p0.png';

  // Resolve active character (CHAR)
  const activeCharacter = characters.find(c => c.id === activeCharacterId);
  const defaultCharImg = 'https://i.postimg.cc/ZY3jJTK4/56163534-p0.jpg';
  const charDisplayName = activeCharacter ? (activeCharacter.nickname || activeCharacter.name) : 'Char';

  const sanitizeAiSignatureText = (raw: string) => {
    let cleaned = (raw || '').trim();
    if (!cleaned) return '';

    cleaned = cleaned.replace(/```(?:json|text|markdown)?\s*([\s\S]*?)```/gi, '$1').trim();

    if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
      try {
        const parsed = JSON.parse(cleaned);
        if (typeof parsed === 'string') cleaned = parsed;
        else if (Array.isArray(parsed)) cleaned = String(parsed.find((item) => typeof item === 'string') || '');
        else if (parsed && typeof parsed === 'object') {
          const obj = parsed as Record<string, unknown>;
          cleaned = String(
            obj.signature ?? obj.text ?? obj.content ?? obj.message ?? obj.result ?? ''
          );
        }
      } catch {
        // Keep raw text fallback.
      }
    }

    cleaned = cleaned
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)[0] || '';

    cleaned = cleaned.replace(/^(今日签名|签名|文案|留言|一句话|推荐语)\s*[:：\-]\s*/i, '').trim();

    const chars = Array.from(cleaned);
    if (chars.length > SIGNATURE_AI_MAX_CHARS) {
      cleaned = chars.slice(0, SIGNATURE_AI_MAX_CHARS).join('');
    }
    return cleaned;
  };

  const requestAiSignatureSuggestion = async (systemPrompt: string, userPrompt: string): Promise<string> => {
    const endpoint = apiConfig.endpoint.replace(/\/+$/, '');
    if (apiConfig.provider === 'GEMINI') {
      const ai = new GoogleGenAI({ apiKey: apiConfig.apiKey });
      const response = await ai.models.generateContent({
        model: apiConfig.model || 'gemini-3-pro-preview',
        contents: `${systemPrompt}\n\n${userPrompt}`,
      });
      return response.text || '';
    }

    if (apiConfig.provider === 'CLAUDE') {
      const response = await fetch(`${endpoint}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiConfig.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: apiConfig.model,
          max_tokens: 180,
          messages: [{ role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }],
        }),
      });
      if (!response.ok) throw new Error(`Claude API Error: ${response.status}`);
      const data = await response.json();
      return data.content?.[0]?.text || '';
    }

    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: apiConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.9,
      }),
    });
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  };

  const updateSignatureByAi = async () => {
    if (isGeneratingAiSignature) return false;
    if (!apiConfig.apiKey) {
      return false;
    }

    setIsGeneratingAiSignature(true);
    try {
      const systemPrompt = `你是阅读应用里的签名文案助手。
请写一句中文短句，适合作为主页签名。
要求：
1. 只能输出一句话，不要解释，不要 markdown；
2. 语气自然、温柔、真诚，不鸡汤、不说教；
3. 长度控制在 ${SIGNATURE_AI_MAX_CHARS} 字以内；
4. 内容可来自读书感悟、心情、内心话、感慨、摘抄风格。`;
      const userPrompt = `请生成今日签名。可参考：
- 当前签名：${userSignature || '（空）'}
- 用户昵称：${userDisplayName}
- 角色昵称：${charDisplayName}`;

      const raw = await requestAiSignatureSuggestion(systemPrompt, userPrompt);
      const nextSignature = sanitizeAiSignatureText(raw);
      if (!nextSignature) throw new Error('empty_signature');

      onUpdateSignature(nextSignature);
      try {
        localStorage.setItem(SIGNATURE_AI_LAST_SUCCESS_DATE_KEY, getLocalDateKey());
        localStorage.setItem(
          SIGNATURE_AI_UPDATE_PROMPT_KEY,
          JSON.stringify({
            updatedAt: Date.now(),
            content: nextSignature,
            characterName: charDisplayName,
          })
        );
      } catch {
        // Ignore localStorage write failures.
      }
      showNotification?.('AI 便签已更新', 'success');
      return true;
    } catch (error) {
      console.error('AI signature update failed:', error);
      return false;
    } finally {
      setIsGeneratingAiSignature(false);
    }
  };

  useEffect(() => {
    clearSignatureAutoTriggerTimer();
    if (isEditingSig || !apiConfig.apiKey || isGeneratingAiSignature || !activeSignatureUpdateEnabled) {
      return;
    }

    const normalizedProbability = Math.max(0, Math.min(100, Math.round(signatureUpdateProbability)));

    const scheduleNextRun = (delayMs: number) => {
      clearSignatureAutoTriggerTimer();
      signatureAutoTriggerTimerRef.current = window.setTimeout(() => {
        void runSignatureAutoDrawScheduler();
      }, Math.max(1000, delayMs));
    };

    const runSignatureAutoDrawScheduler = async () => {
      if (document.visibilityState !== 'visible') {
        scheduleNextRun(60 * 1000);
        return;
      }

      const now = new Date();
      const state = readSignatureDrawState(now);
      const dueSlotIndex = resolveDueSignatureDrawSlotIndex(state, now);

      if (dueSlotIndex !== null) {
        const nextState: SignatureAutoDrawState = {
          dateKey: state.dateKey,
          attemptedSlotIndexes: Array.from(new Set([...state.attemptedSlotIndexes, dueSlotIndex])),
        };
        saveSignatureDrawState(nextState);

        if (Math.random() * 100 < normalizedProbability) {
          await updateSignatureByAi();
        }

        scheduleNextRun(1500);
        return;
      }

      const nextAt = resolveNextSignatureDrawAt(state, now);
      scheduleNextRun(nextAt - now.getTime());
    };

    void runSignatureAutoDrawScheduler();

    return () => {
      clearSignatureAutoTriggerTimer();
    };
  }, [
    isEditingSig,
    activeSignatureUpdateEnabled,
    signatureUpdateProbability,
    apiConfig.apiKey,
    apiConfig.provider,
    apiConfig.endpoint,
    apiConfig.model,
    userDisplayName,
    charDisplayName,
    isGeneratingAiSignature,
  ]);

  const renderAvatar = (imageUrl: string | undefined, isDefaultUser: boolean, isDefaultChar: boolean, type: 'USER' | 'CHAR') => {
    if (imageUrl) {
      return <ResolvedImage src={imageUrl} alt="Avatar" className="w-full h-full object-cover" />;
    }
    if (type === 'USER') {
      if (isDefaultUser) return <ResolvedImage src={defaultUserImg} alt="Default User" className="w-full h-full object-cover" />;
      return <UserCircle className="text-slate-400 w-3/5 h-3/5" />;
    } else {
      if (isDefaultChar) return <ResolvedImage src={defaultCharImg} alt="Default Char" className="w-full h-full object-cover" />;
      return <FeatherIcon className="text-slate-400 w-3/5 h-3/5" />;
    }
  };

  const formatLastReadTime = (lastReadAt?: number, fallback = '从未阅读') => {
    if (!lastReadAt || Number.isNaN(lastReadAt)) return fallback;

    const diffMs = Math.max(0, clockNow - lastReadAt);
    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 60) return `${Math.max(1, diffMinutes)}分钟前`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}小时前`;

    const date = new Date(lastReadAt);
    const pad = (value: number) => value.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const recentBook = useMemo(() => {
    const candidates = books.filter(book => typeof book.lastReadAt === 'number' && book.lastReadAt > 0);
    if (candidates.length === 0) return null;
    return [...candidates].sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0))[0];
  }, [books]);

  // Reusable Modal Content Render
  const renderBookForm = (book: Partial<Book>, isEdit: boolean) => {
    const structuredChapterMode = getStructuredChapterMode(isEdit);
    return (
      <div className="overflow-y-auto no-scrollbar flex-1 -mx-2 px-2 space-y-5 pb-4">
        <div className={`p-4 rounded-xl space-y-3 ${isDarkMode ? 'bg-black/20' : 'bg-slate-100/50'}`}>
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-start gap-2">
              <FileUp size={14} className="mt-[1px] shrink-0" />
              <span className="leading-tight">
                导入文本
                <span
                  className="block font-bold opacity-70 tracking-normal mt-0.5"
                  style={{ fontSize: 'calc(10px * var(--app-font-scale, 1))' }}
                >
                  (TXT / WORD / PDF / EPUB / MOBI)
                </span>
              </span>
            </label>
            <span className="text-[10px] text-slate-400">{book.fullText ? '已加载内容' : '未选择'}</span>
          </div>
          {!txtFileUrlMode ? (
            <div className="flex gap-2">
              <button
                onClick={() => txtFileInputRef.current?.click()}
                className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 ${btnClass} text-slate-500 hover:text-rose-400`}
              >
                <FileText size={12} /> 本地文件
              </button>
              <input
                type="file"
                ref={txtFileInputRef}
                className="hidden"
                accept={BOOK_IMPORT_ACCEPT}
                onChange={handleBookFileSelect}
              />

              <button
                onClick={() => setTxtFileUrlMode(true)}
                className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 ${btnClass} text-slate-500 hover:text-rose-400`}
              >
                <Link size={12} /> 网络链接
              </button>
            </div>
          ) : (
            <div className="w-full flex gap-2 app-view-enter-left">
              <input
                type="text"
                value={tempTxtUrl}
                onChange={(e) => setTempTxtUrl(e.target.value)}
                placeholder="输入文件链接..."
                className={`flex-1 px-3 py-1.5 text-xs rounded-lg outline-none ${inputClass}`}
              />
              <button onClick={handleTxtUrlSubmit} className="text-rose-400"><Check size={16} /></button>
              <button onClick={() => setTxtFileUrlMode(false)} className="text-slate-400"><X size={16} /></button>
            </div>
          )}
          {book.fullText && (
            <div className="text-[10px] text-emerald-500 flex items-center gap-1">
              <Check size={10} /> 内容已加载 ({book.fullText.length} 字符)
            </div>
          )}
        </div>

        <div className="space-y-1">
          <div className="flex justify-between items-center mb-1">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">正文内容</label>
            <span className="text-[10px] text-slate-400">{book.fullText ? `${book.fullText.length} 字` : '0 字'}</span>
          </div>
          <textarea
            value={book.fullText || ''}
            onChange={(e) => {
              if (isEdit) {
                setIsEditStructuredChapterMode(false);
                setEditingBook({ ...editingBook!, fullText: e.target.value });
                return;
              }
              setIsImportStructuredChapterMode(false);
              setImportingBook({ ...importingBook, fullText: e.target.value });
            }}
            placeholder="可在此处粘贴或编辑书籍正文..."
            className={`w-full p-3 text-xs rounded-xl outline-none resize-none h-32 leading-relaxed ${inputClass}`}
          />
        </div>

        <div className={`p-4 rounded-xl space-y-3 ${isDarkMode ? 'bg-black/20' : 'bg-slate-100/50'}`}>
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Image size={14} /> 封面图片
            </label>
            <span className="text-[10px] text-slate-400">{book.coverUrl ? '已设置' : '默认封面'}</span>
          </div>

          <div className="flex items-center gap-4">
            <div className={`w-16 h-20 rounded-lg overflow-hidden flex-shrink-0 shadow-sm ${cardClass}`}>
              {book.coverUrl ? (
                <ResolvedImage src={book.coverUrl} className="w-full h-full object-cover" alt="Cover" />
              ) : (
                <DefaultBookCover />
              )}
            </div>

            <div className="flex-1">
              {!urlInputMode ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 ${btnClass} text-slate-500 hover:text-rose-400`}
                  >
                    <FileUp size={12} /> 本地上传
                  </button>
                  <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleCoverFileSelect} />

                  <button
                    onClick={() => setUrlInputMode(true)}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1 ${btnClass} text-slate-500 hover:text-rose-400`}
                  >
                    <Link size={12} /> 网络链接
                  </button>
                </div>
              ) : (
                <div className="w-full flex gap-2 app-view-enter-left">
                  <input
                    type="text"
                    value={tempCoverUrl}
                    onChange={(e) => setTempCoverUrl(e.target.value)}
                    placeholder="输入图片链接..."
                    className={`flex-1 px-3 py-1.5 text-xs rounded-lg outline-none ${inputClass}`}
                  />
                  <button onClick={handleCoverUrlSubmit} className="text-rose-400"><Check size={16} /></button>
                  <button onClick={() => setUrlInputMode(false)} className="text-slate-400"><X size={16} /></button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">书名</label>
            <input
              type="text"
              value={book.title}
              onChange={(e) => isEdit ? setEditingBook({ ...editingBook!, title: e.target.value }) : setImportingBook({ ...importingBook, title: e.target.value })}
              className={`w-full px-4 py-3 text-sm rounded-xl outline-none ${inputClass}`}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">作者</label>
            <input
              type="text"
              value={book.author}
              onChange={(e) => isEdit ? setEditingBook({ ...editingBook!, author: e.target.value }) : setImportingBook({ ...importingBook, author: e.target.value })}
              className={`w-full px-4 py-3 text-sm rounded-xl outline-none ${inputClass}`}
            />
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex justify-end items-center gap-2 mb-1">
            <button
              onClick={handleAutoGenerateRegex}
              disabled={isGeneratingRegex || structuredChapterMode}
              className={`px-4 py-2 rounded-xl flex items-center justify-center gap-1 text-xs font-bold text-rose-400 transition-all active:scale-95 whitespace-nowrap disabled:opacity-50 ${btnClass}`}
              title={structuredChapterMode ? '已启用结构化章节模式' : '输入示例标题后点击自动生成'}
            >
              <Sparkles size={14} className={isGeneratingRegex ? 'animate-spin' : ''} />
              {isGeneratingRegex ? '生成中...' : '自动生成'}
            </button>
            <button
              onClick={handleManualAutoSplitChapters}
              disabled={isAutoSplittingChapters || !(book.fullText || '').trim()}
              className={`px-4 py-2 rounded-xl flex items-center justify-center gap-1 text-xs font-bold text-rose-400 transition-all active:scale-95 whitespace-nowrap disabled:opacity-50 ${btnClass}`}
              title={(book.fullText || '').trim() ? '按目录标题尝试自动分章节' : '请先导入正文内容'}
            >
              <List size={14} className={isAutoSplittingChapters ? 'animate-spin' : ''} />
              {isAutoSplittingChapters ? '分章中...' : '一键分章节'}
            </button>
          </div>

          <div className="flex justify-between items-center mb-1">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1 flex items-center gap-1">
              章节匹配正则
            </label>
            <span className={`text-[10px] ${detectedChapters > 0 ? 'text-emerald-500' : 'text-slate-400'}`}>
              {detectedChapters > 0 ? `检测到 ${detectedChapters} 章` : '默认全文一章'}
            </span>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={book.chapterRegex || ''}
              onChange={(e) => {
                if (structuredChapterMode) return;
                if (isEdit) {
                  setEditingBook({ ...editingBook!, chapterRegex: e.target.value });
                  return;
                }
                setImportingBook({ ...importingBook, chapterRegex: e.target.value });
              }}
              disabled={structuredChapterMode}
              placeholder={structuredChapterMode ? '已启用内建章节结构' : '例如: ^第\\s*[0-9]+\\s*章'}
              className={`flex-1 px-4 py-3 text-sm rounded-xl outline-none ${inputClass} ${structuredChapterMode ? 'opacity-60 cursor-not-allowed' : ''}`}
            />
          </div>
          <p className="text-[10px] text-slate-400 px-2 leading-tight mt-1">
            {structuredChapterMode
              ? '检测到内建章节结构，已禁用正则拆章。'
              : '输入示例标题（如“第一章 起点”）后点击自动生成。'}
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1 mb-1 block">
            按字数切分章节
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              min={CHARCOUNT_MIN}
              max={CHARCOUNT_MAX}
              step={100}
              value={isEdit ? editCharCount : importCharCount}
              onChange={(e) => isEdit ? setEditCharCount(e.target.value) : setImportCharCount(e.target.value)}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (!v) return;
                const n = Math.max(CHARCOUNT_MIN, Math.min(CHARCOUNT_MAX, parseInt(v) || CHARCOUNT_DEFAULT));
                isEdit ? setEditCharCount(String(n)) : setImportCharCount(String(n));
              }}
              placeholder="每章目标字数，如 2000"
              className={`flex-1 px-4 py-3 text-sm rounded-xl outline-none ${inputClass}`}
            />
            <span className={`shrink-0 min-w-[6rem] flex items-center justify-end text-[10px] whitespace-nowrap ${detectedCharCountChapters > 0 ? 'text-emerald-500' : 'text-slate-400'}`}>
              {detectedCharCountChapters > 0 ? `检测到 ${detectedCharCountChapters} 章` : '默认全文一章'}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">标签</label>
          <div className={`w-full p-2 rounded-xl flex flex-wrap gap-2 min-h-[48px] ${inputClass}`}>
            {book.tags && book.tags.map((tag, idx) => (
              <span key={idx} className="bg-rose-400 text-white text-xs px-2 py-1 rounded-lg flex items-center gap-1 animate-fade-in">
                {tag}
                <button onClick={() => removeTag(tag)} className="hover:text-rose-100"><X size={10} /></button>
              </span>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTag()}
              placeholder={book.tags && book.tags.length > 0 ? '+ 添加' : '添加标签...'}
              className={`bg-transparent outline-none text-sm flex-1 min-w-[60px] py-1 px-2 ${isDarkMode ? 'placeholder:text-slate-500' : 'placeholder:text-slate-400'}`}
            />
          </div>
        </div>

        {/* RAG索引设置 */}
        {(() => {
          const ragEnabled = isEdit ? editRagEnabled : importRagEnabled;
          const setRagEnabled = isEdit ? setEditRagEnabled : setImportRagEnabled;
          const ragPresetId = isEdit ? editRagPresetId : importRagPresetId;
          const setRagPresetId = isEdit ? setEditRagPresetId : setImportRagPresetId;
          const selectedPreset = ragPresets.find(p => p.id === ragPresetId) || ragPresets[0];
          return (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">建立RAG索引库</label>
                  <button
                    type="button"
                    onClick={() => setShowRagHelpModal(true)}
                    className="text-slate-400 hover:text-rose-400 transition-colors"
                  >
                    <HelpCircle size={14} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setRagEnabled(!ragEnabled)}
                  className={`w-14 h-8 rounded-full relative transition-colors duration-300 ${ragEnabled ? 'bg-rose-400' : pressedClass}`}
                >
                  <div className={`w-6 h-6 rounded-full bg-white shadow-md absolute top-1 transition-transform duration-300 ${ragEnabled ? 'translate-x-7' : 'translate-x-1'}`} />
                </button>
              </div>

              <div
                className={`overflow-hidden transition-all duration-300 ease-in-out ${ragEnabled ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'}`}
              >
                <div className="pt-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1 mb-1 block">RAG模型预设</label>
                  <div
                    ref={ragDropdownTriggerRef}
                    onClick={() => { if (ragPresetDropdownOpen) closeRagDropdown(); else openRagDropdown(); }}
                    className={`w-full px-4 py-3 rounded-xl flex items-center justify-between cursor-pointer transition-all active:scale-[0.99] ${inputClass}`}
                  >
                    <span className="text-sm truncate">
                      {selectedPreset?.name || '选择预设...'}
                    </span>
                    <div className="opacity-50">
                      <ChevronDown size={16} className={`transition-transform duration-200 ${ragPresetDropdownOpen && !isRagDropdownClosing ? 'rotate-180' : ''}`} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    );
  };

  const renderSortMenu = () => (
    <div className={`absolute right-0 top-12 w-48 rounded-2xl p-3 z-30 shadow-xl border border-slate-400/10 animate-fade-in ${cardClass}`}>
       <div className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">排序方式</div>
       <div className="space-y-1">
         {[
           { id: 'title', label: '书名' },
           { id: 'author', label: '作者' },
           { id: 'progress', label: '阅读进度' },
           { id: 'id', label: '上传时间' },
           { id: 'length', label: '字数' }
         ].map((opt) => (
           <div 
             key={opt.id}
             onClick={() => {
               if (sortField === opt.id) {
                 setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
               } else {
                 setSortField(opt.id as SortField);
                 setSortDirection('desc');
               }
             }}
             className={`flex items-center justify-between p-2 rounded-lg text-sm cursor-pointer transition-colors ${
                sortField === opt.id ? 'bg-rose-400/10 text-rose-400' : 'hover:bg-black/5 dark:hover:bg-white/5 text-slate-500'
             }`}
           >
             <span>{opt.label}</span>
             {sortField === opt.id && (
               sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
             )}
           </div>
         ))}
       </div>
    </div>
  );

  return (
    <>
      <div className={`flex-1 flex flex-col p-6 pb-28 overflow-y-auto no-scrollbar ${containerClass}`}>
        <header className="flex justify-between items-start mb-8 pt-2 relative">
          <div className="flex-1 pr-4 min-w-0">
            <h1 className={`text-2xl font-bold ${headingClass}`}>书架</h1>
            
            {/* Editable Signature */}
            <div className="mt-1 min-h-8 flex items-center">
              <div
                onClick={openSignatureNote}
                className={`group flex items-center justify-between gap-2 cursor-pointer py-1 -ml-1 px-1 rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5 w-full max-w-[240px]`}
              >
                <p className={`flex-1 min-w-0 mr-2 text-sm ${subTextClass} truncate`}>
                  {userSignature || <span className="opacity-50 italic">点击查看签名...</span>}
                </p>
                <Edit2 size={12} className="opacity-0 group-hover:opacity-50 text-slate-400 flex-shrink-0" />
              </div>
            </div>
          </div>

          {/* Dual Avatars Area */}
          <div className="flex items-center gap-2 flex-shrink-0">
              
              {/* 1. Character Avatar & Menu */}
              <div className="relative" ref={charMenuRef}>
                  <div 
                     onClick={() => setIsCharMenuOpen(!isCharMenuOpen)}
                     className="flex flex-col items-center gap-1 cursor-pointer group"
                  >
                     <div className={`relative w-12 h-12 rounded-full flex items-center justify-center overflow-hidden border-2 border-transparent transition-all group-hover:border-rose-300 ${isDarkMode ? 'bg-[#2d3748] shadow-[5px_5px_10px_#232b39,-5px_-5px_10px_#374357]' : 'neu-btn'}`}>
                       {renderAvatar(activeCharacter?.avatar, false, !activeCharacterId, 'CHAR')}
                     </div>
                     <div className={`absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] shadow-sm z-10 border border-white/10 ${isDarkMode ? 'bg-[#2d3748] text-blue-400' : 'bg-[#e0e5ec] text-blue-400'}`}>
                        <FeatherIcon size={12} />
                     </div>
                     <span className="text-[10px] font-bold text-slate-400 group-hover:text-rose-400 transition-colors max-w-[50px] truncate">
                       {charDisplayName}
                     </span>
                  </div>
                  {isCharMenuOpen && (
                    <div className={`absolute right-0 top-14 w-48 rounded-2xl p-2 z-50 animate-fade-in ${cardClass} border border-slate-400/10`}>
                       <div className="px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                         切换角色
                       </div>
                       <div className="max-h-48 overflow-y-auto space-y-1">
                          <div 
                            onClick={() => handleSelectCharacter(null)}
                            className={`flex items-center gap-3 p-2 rounded-xl cursor-pointer transition-colors ${!activeCharacterId ? 'bg-rose-400/10 text-rose-400' : 'hover:bg-black/5 dark:hover:bg-white/5 text-slate-500'}`}
                          >
                             <div className="w-8 h-8 rounded-full overflow-hidden bg-slate-200 flex-shrink-0">
                                <ResolvedImage src={defaultCharImg} className="w-full h-full object-cover" alt="Default Char" />
                             </div>
                             <div className="flex-1 min-w-0">
                                <div className="font-bold text-sm truncate">Char</div>
                                <div className="text-[10px] opacity-70">默认</div>
                             </div>
                             {!activeCharacterId && <Check size={14} />}
                          </div>
                          {characters.map(c => (
                             <div 
                               key={c.id}
                               onClick={() => handleSelectCharacter(c.id)}
                               className={`flex items-center gap-3 p-2 rounded-xl cursor-pointer transition-colors ${activeCharacterId === c.id ? 'bg-rose-400/10 text-rose-400' : 'hover:bg-black/5 dark:hover:bg-white/5 text-slate-500'}`}
                             >
                                <div className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center bg-slate-200 flex-shrink-0">
                                   {c.avatar ? <ResolvedImage src={c.avatar} className="w-full h-full object-cover" alt={c.name} /> : <FeatherIcon size={16} className="text-slate-500" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                   <div className="font-bold text-sm truncate">{c.nickname || c.name}</div>
                                   <div className="text-[10px] opacity-70 truncate">{c.name}</div>
                                </div>
                                {activeCharacterId === c.id && <Check size={14} />}
                             </div>
                          ))}
                          {characters.length === 0 && (
                             <div className="p-3 text-center text-xs text-slate-400 italic">暂无更多角色<br/>请在设置中添加</div>
                          )}
                       </div>
                    </div>
                  )}
              </div>

              <div className="flex items-center justify-center text-rose-400 -mt-4">
                 <Link2 size={16} />
              </div>

              {/* 2. User Avatar & Menu */}
              <div className="relative" ref={menuRef}>
                  <div 
                     onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                     className="flex flex-col items-center gap-1 cursor-pointer group"
                  >
                     <div className={`relative w-12 h-12 rounded-full flex items-center justify-center overflow-hidden border-2 border-transparent transition-all group-hover:border-rose-300 ${isDarkMode ? 'bg-[#2d3748] shadow-[5px_5px_10px_#232b39,-5px_-5px_10px_#374357]' : 'neu-btn'}`}>
                       {renderAvatar(activePersona?.avatar, !activePersonaId, false, 'USER')}
                     </div>
                     <div className={`absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] shadow-sm z-10 border border-white/10 ${isDarkMode ? 'bg-[#2d3748] text-blue-400' : 'bg-[#e0e5ec] text-blue-400'}`}>
                        <UserCircle size={12} />
                     </div>
                     <span className="text-[10px] font-bold text-slate-400 group-hover:text-rose-400 transition-colors max-w-[60px] truncate">
                       {userDisplayName}
                     </span>
                  </div>
                  {isProfileMenuOpen && (
                    <div className={`absolute right-0 top-14 w-48 rounded-2xl p-2 z-50 animate-fade-in ${cardClass} border border-slate-400/10`}>
                       <div className="px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                         切换用户
                       </div>
                       <div className="max-h-48 overflow-y-auto space-y-1">
                          <div 
                            onClick={() => { onSelectPersona(null); setIsProfileMenuOpen(false); }}
                            className={`flex items-center gap-3 p-2 rounded-xl cursor-pointer transition-colors ${!activePersonaId ? 'bg-rose-400/10 text-rose-400' : 'hover:bg-black/5 dark:hover:bg-white/5 text-slate-500'}`}
                          >
                             <div className="w-8 h-8 rounded-full overflow-hidden bg-slate-200 flex-shrink-0">
                                <ResolvedImage src={defaultUserImg} className="w-full h-full object-cover" alt="Default User" />
                             </div>
                             <div className="flex-1 min-w-0">
                                <div className="font-bold text-sm truncate">User</div>
                                <div className="text-[10px] opacity-70">默认</div>
                             </div>
                             {!activePersonaId && <Check size={14} />}
                          </div>
                          {personas.map(p => (
                             <div 
                               key={p.id}
                               onClick={() => { onSelectPersona(p.id); setIsProfileMenuOpen(false); }}
                               className={`flex items-center gap-3 p-2 rounded-xl cursor-pointer transition-colors ${activePersonaId === p.id ? 'bg-rose-400/10 text-rose-400' : 'hover:bg-black/5 dark:hover:bg-white/5 text-slate-500'}`}
                             >
                                <div className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center bg-slate-200 flex-shrink-0">
                                   {p.avatar ? <ResolvedImage src={p.avatar} className="w-full h-full object-cover" alt={p.name} /> : <div className="w-full h-full flex items-center justify-center bg-slate-300 text-white"><UserCircle size={16} /></div>}
                                </div>
                                <div className="flex-1 min-w-0">
                                   <div className="font-bold text-sm truncate">{p.name}</div>
                                   <div className="text-[10px] opacity-70 truncate">{p.userNickname}</div>
                                </div>
                                {activePersonaId === p.id && <Check size={14} />}
                             </div>
                          ))}
                          {personas.length === 0 && (
                             <div className="p-3 text-center text-xs text-slate-400 italic">暂无更多用户<br/>请在设置中添加</div>
                          )}
                       </div>
                    </div>
                  )}
              </div>
          </div>
        </header>

        {/* Recent Read Card - Always visible if book exists, regardless of view mode if searching is inactive */}
        {recentBook && (
          <div className="mb-8">
            <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 pl-1">最近阅读</h2>
            <div 
              onClick={() => onOpenBook(recentBook)}
              className={`${cardClass} app-card-press p-5 flex gap-5 cursor-pointer rounded-2xl relative group`}
            >
              <div className="w-20 h-28 flex-shrink-0 rounded-lg overflow-hidden shadow-md app-card-press-media relative">
                {recentBook.coverUrl ? (
                    <ResolvedImage src={recentBook.coverUrl} alt="Cover" className="w-full h-full object-cover opacity-90" />
                ) : (
                    <DefaultBookCover />
                )}
                {isBuiltInTutorialBook(recentBook.id) && isTutorialUnread() && (
                  <span className="absolute top-1.5 right-1.5 w-3 h-3 rounded-full shadow-md animate-pulse z-10" style={{ backgroundColor: 'rgb(var(--theme-500) / 1)' }} />
                )}
              </div>
              <div className="flex flex-col justify-between flex-1 py-1">
                <div>
                  <h3 className={`text-lg font-bold line-clamp-1 ${headingClass}`}>{recentBook.title}</h3>
                  <p className={`text-sm ${subTextClass}`}>{recentBook.author}</p>
                </div>
                <div>
                   <div className="flex justify-between text-xs text-slate-400 mb-2">
                     <span>已读 {recentBook.progress}%</span>
                     <span><Clock size={12} className="inline mr-1"/>{formatLastReadTime(recentBook.lastReadAt, recentBook.lastRead)}</span>
                   </div>
                   <div className={`w-full h-2 rounded-full overflow-hidden p-[2px] ${pressedClass}`}>
                     {/* Theme colored progress bar */}
                     <div className="h-full bg-rose-400 rounded-full opacity-80" style={{ width: `${recentBook.progress}%` }} />
                   </div>
                </div>
              </div>
              
              {/* Edit Button for Recent Book */}
              {!isBuiltInTutorialBook(recentBook.id) && (
              <button
                onClick={(e) => openEditModal(e, recentBook)}
                className={`absolute top-4 right-4 ${compactEditButtonClass}`}
              >
                <Edit2 size={16} />
              </button>
              )}
            </div>
          </div>
        )}

        {/* Grid Header with Search & Filter & Sort */}
        <div className="mb-4">
          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3 pl-1">
             {isSearching ? '搜索结果' : '全部书籍'}
          </h2>
          <div className="flex gap-2 mb-4">
             {/* Search Bar */}
             <div className={`flex-1 flex items-center px-3 py-2 rounded-xl gap-2 ${inputClass}`}>
                <Search size={16} className="text-slate-400" />
                <input 
                  type="text" 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="搜索..." 
                  className="bg-transparent outline-none w-full text-sm"
                />
                {searchTerm && (
                   <button onClick={() => setSearchTerm('')} className="text-slate-400 hover:text-slate-600">
                      <X size={14} />
                   </button>
                )}
             </div>

             {/* Filter Button */}
             <div className="relative" ref={filterRef}>
               <button 
                  onClick={() => setIsFilterOpen(!isFilterOpen)}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-95 ${isFilterOpen || selectedTags.length > 0 ? 'bg-rose-400 text-white shadow-md' : `${cardClass} text-slate-400 hover:text-rose-400`}`}
               >
                  <Filter size={18} />
               </button>
               {/* Filter Dropdown */}
               {isFilterOpen && (
                  <div className={`absolute right-0 top-12 w-48 rounded-2xl p-3 z-30 shadow-xl border border-slate-400/10 animate-fade-in ${cardClass}`}>
                     <div className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">按标签筛选</div>
                     <div className="flex flex-wrap gap-2">
                        {allTags.map(tag => (
                           <button 
                              key={tag}
                              onClick={() => toggleTagFilter(tag)}
                              className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                                 selectedTags.includes(tag)
                                 ? 'bg-rose-400 border-rose-400 text-white'
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
                           <button onClick={() => setSelectedTags([])} className="text-xs text-rose-400 w-full text-center hover:underline">
                              清除筛选
                           </button>
                        </div>
                     )}
                  </div>
               )}
             </div>
             
             {/* Sort Button */}
             <div className="relative" ref={sortRef}>
               <button 
                  onClick={() => setIsSortMenuOpen(!isSortMenuOpen)}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-95 ${isSortMenuOpen ? 'bg-rose-400 text-white shadow-md' : `${cardClass} text-slate-400 hover:text-rose-400`}`}
               >
                  <ArrowUpDown size={18} />
               </button>
               {isSortMenuOpen && renderSortMenu()}
             </div>

             {/* View Toggle Button */}
             <div className="relative">
                 <button 
                    onClick={() => setViewMode(prev => prev === 'grid' ? 'list' : 'grid')}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-95 ${cardClass} text-slate-400 hover:text-rose-400`}
                 >
                    {viewMode === 'grid' ? <AlignJustify size={18} /> : <LayoutGrid size={18} />}
                 </button>
             </div>
          </div>
        </div>

        {/* View Mode Rendering */}
        {viewMode === 'grid' ? (
           <div key="grid" className="grid grid-cols-2 gap-6 animate-fade-in">
               {/* Add New Book Button (Import) - Only in Grid or List? Let's keep it in both but style differently if list */}
                <div 
                  onClick={openImportModal}
                  className={`aspect-[3/4] rounded-2xl flex flex-col items-center justify-center hover:text-rose-400 transition-all cursor-pointer border-2 border-transparent hover:border-rose-100/20 active:scale-[0.98] ${pressedClass} ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}
                >
                   <Plus size={32} />
                   <span className="text-sm font-medium mt-2">导入书籍</span>
                  <span
                    className="leading-none mt-1 opacity-60 whitespace-nowrap"
                    style={{ fontSize: 'calc(9px * var(--app-font-scale, 1))' }}
                  >
                    TXT / WORD / PDF / EPUB / MOBI
                  </span>
                </div>

               {/* Grid Books */}
               {sortedBooks.map(book => (
                 <div key={book.id} onClick={() => onOpenBook(book)} className="flex flex-col gap-3 cursor-pointer group">
                   <div className={`relative aspect-[3/4] rounded-2xl overflow-hidden lib-cover-card-press ${cardClass}`}>
                     <div className="w-full h-full rounded-2xl overflow-hidden opacity-90 hover:opacity-100 lib-cover-card-media">
                        {book.coverUrl ? (
                             <ResolvedImage src={book.coverUrl} className="w-full h-full object-cover" alt={book.title} />
                        ) : (
                             <DefaultBookCover />
                        )}
                     </div>
                     
                     {book.progress > 0 && (
                       <div className="absolute bottom-2 left-2 right-2 h-1.5 bg-black/40 rounded-full overflow-hidden p-[1px] backdrop-blur-sm">
                         <div className="h-full bg-rose-400 rounded-full" style={{ width: `${book.progress}%` }} />
                       </div>
                     )}

                     {book.tags && book.tags.length > 0 && (
                       <div className="absolute top-3 left-3 right-12 flex flex-wrap gap-1 max-h-[60%] overflow-hidden content-start">
                          {book.tags.slice(0, 2).map((tag, i) => (
                            <span key={i} className="bg-black/40 text-white/90 px-2 py-1 rounded-md backdrop-blur-sm shadow-sm truncate max-w-full" style={{ fontSize: 'calc(9px * var(--app-font-scale, 1))' }}>
                               {tag}
                            </span>
                          ))}
                          {book.tags.length > 2 && (
                            <span className="bg-black/40 text-white/90 px-2 py-1 rounded-md backdrop-blur-sm shadow-sm" style={{ fontSize: 'calc(9px * var(--app-font-scale, 1))' }}>
                               +{book.tags.length - 2}
                            </span>
                          )}
                       </div>
                     )}

                     {isBuiltInTutorialBook(book.id) && isTutorialUnread() && (
                       <span className="absolute top-2.5 right-2.5 w-3 h-3 rounded-full shadow-md animate-pulse" style={{ backgroundColor: 'rgb(var(--theme-500) / 1)' }} />
                     )}

                     {!isBuiltInTutorialBook(book.id) && (
                     <button
                        onClick={(e) => openEditModal(e, book)}
                        className="absolute top-2 right-2 w-7 h-7 bg-black/40 hover:bg-rose-500 text-white rounded-full flex items-center justify-center backdrop-blur-sm transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100"
                     >
                        <Edit2 size={14} />
                     </button>
                     )}
                   </div>
                   <div className="pl-1">
                     <h3 className={`font-bold text-sm line-clamp-1 ${headingClass}`}>{book.title}</h3>
                     <p className={`text-xs line-clamp-1 ${subTextClass}`}>{book.author}</p>
                   </div>
                 </div>
               ))}
           </div>
        ) : (
           <div key="list" className="flex flex-col gap-3 animate-fade-in">
               {/* Add New Book (List Mode) */}
                <div 
                   onClick={openImportModal}
                   className={`p-4 rounded-2xl flex items-center justify-center gap-2 hover:text-rose-400 transition-all cursor-pointer border-2 border-transparent hover:border-rose-100/20 active:scale-[0.98] ${pressedClass} ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}
                >
                   <Plus size={18} />
                  <span className="text-sm"><span className="font-medium">导入书籍</span> <span className="opacity-60 font-normal">TXT / WORD / PDF / EPUB / MOBI</span></span>
                </div>
               
               {/* List Books */}
               {sortedBooks.map(book => (
                 <div 
                    key={book.id} 
                    onClick={() => onOpenBook(book)}
                    className={`${cardClass} app-card-press p-4 rounded-2xl flex items-stretch gap-4 group cursor-pointer`}
                 >
                    {/* Cover Image instead of Icon */}
                    <div className={`w-14 rounded-lg overflow-hidden flex-shrink-0 shadow-sm relative ${pressedClass} min-h-[4.5rem] app-card-press-media`}>
                       {book.coverUrl ? (
                          <ResolvedImage src={book.coverUrl} className="w-full h-full object-cover absolute inset-0" alt={book.title} />
                       ) : (
                          <div className="absolute inset-0"><DefaultBookCover /></div>
                       )}
                       {isBuiltInTutorialBook(book.id) && isTutorialUnread() && (
                         <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full shadow-md animate-pulse z-10" style={{ backgroundColor: 'rgb(var(--theme-500) / 1)' }} />
                       )}
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                       <div>
                           <div className="flex justify-between items-start">
                              <h3 className={`font-bold text-sm truncate ${headingClass}`}>{book.title}</h3>
                              <span className="text-[10px] text-slate-400 whitespace-nowrap ml-2 flex-shrink-0">
                                 {getTextLength(book) > 10000 ? `${Math.floor(getTextLength(book) / 10000)}万字` : `${getTextLength(book)}字`}
                              </span>
                           </div>
                           <p className={`text-xs ${subTextClass} truncate mt-0.5`}>{book.author}</p>
                       </div>
                       
                       {/* Tags in List View */}
                       {book.tags && book.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2 mb-1 w-full overflow-hidden">
                             {book.tags.slice(0, 3).map((tag, i) => (
                               <span key={i} className={`px-1.5 py-0.5 rounded-md max-w-[5rem] truncate ${isDarkMode ? 'bg-black/20 text-slate-400' : 'bg-slate-200 text-slate-500'}`} style={{ fontSize: 'calc(9px * var(--app-font-scale, 1))' }}>
                                  {tag}
                               </span>
                             ))}
                             {book.tags.length > 3 && (
                                <span className={`px-1.5 py-0.5 rounded-md ${isDarkMode ? 'bg-black/20 text-slate-400' : 'bg-slate-200 text-slate-500'}`} style={{ fontSize: 'calc(9px * var(--app-font-scale, 1))' }}>
                                   +{book.tags.length - 3}
                                </span>
                             )}
                          </div>
                       )}

                       {/* Mini Progress */}
                       <div className="flex items-center gap-2">
                          <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${isDarkMode ? 'bg-black/20' : 'bg-slate-200'}`}>
                             <div className="h-full bg-rose-400 rounded-full" style={{ width: `${book.progress}%` }} />
                          </div>
                          <span className="text-[10px] text-slate-400 flex-shrink-0">{book.progress}%</span>
                       </div>
                    </div>

                    {/* Actions */}
                    {!isBuiltInTutorialBook(book.id) && (
                    <div className="flex flex-col justify-center">
                        <button
                            onClick={(e) => openEditModal(e, book)}
                            className={compactEditButtonClass}
                         >
                            <Edit2 size={14} />
                         </button>
                    </div>
                    )}
                 </div>
               ))}
           </div>
        )}
      </div>

      {/* Signature Note Modal */}
      {isSignatureNoteOpen && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-[105] flex items-center justify-center p-6 pb-28 bg-black/35 backdrop-blur-sm app-fade-enter"
            onClick={closeSignatureNote}
          >
            <div
              className={`relative w-full max-w-sm rounded-2xl border shadow-2xl p-5 ${
                isDarkMode ? 'bg-[#3a3628] border-amber-200/20 text-amber-50' : 'bg-[#fff6d8] border-amber-200 text-slate-700'
              }`}
              style={{
                backgroundImage: isDarkMode
                  ? 'repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 28px)'
                  : 'repeating-linear-gradient(0deg, rgba(180,140,60,0.10) 0px, rgba(180,140,60,0.10) 1px, transparent 1px, transparent 28px)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={`absolute -top-2 left-6 w-12 h-3 rounded-sm rotate-[-8deg] ${isDarkMode ? 'bg-amber-300/50' : 'bg-amber-200/90'} shadow`} />
              <div className={`absolute -top-1 right-10 w-10 h-3 rounded-sm rotate-[6deg] ${isDarkMode ? 'bg-amber-300/45' : 'bg-amber-200/85'} shadow`} />

              <div className="flex items-center justify-between mb-3">
                <span />
                <div className="flex items-center gap-1">
                  {isEditingSig ? (
                    <>
                      <button
                        type="button"
                        onClick={handleCancelSigEdit}
                        className={`w-7 h-7 rounded-full flex items-center justify-center ${isDarkMode ? 'hover:bg-white/10 text-amber-100/80' : 'hover:bg-amber-100 text-amber-700'}`}
                        title="取消编辑"
                      >
                        <X size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveSig}
                        className={`w-7 h-7 rounded-full flex items-center justify-center ${isDarkMode ? 'hover:bg-emerald-400/20 text-emerald-300' : 'hover:bg-emerald-100 text-emerald-600'}`}
                        title="保存签名"
                      >
                        <Check size={14} />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setTempSig(userSignature); setIsEditingSig(true); }}
                      className={`w-7 h-7 rounded-full flex items-center justify-center ${isDarkMode ? 'hover:bg-white/10 text-amber-100/85' : 'hover:bg-amber-100 text-amber-700'}`}
                      title="编辑签名"
                    >
                      <Edit2 size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={closeSignatureNote}
                    className={`w-7 h-7 rounded-full flex items-center justify-center ${isDarkMode ? 'hover:bg-white/10 text-amber-100/80' : 'hover:bg-amber-100 text-amber-700'}`}
                    title="关闭便签"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {isEditingSig ? (
                <div>
                  <textarea
                    autoFocus
                    value={tempSig}
                    maxLength={SIGNATURE_AI_MAX_CHARS}
                    onChange={(e) => setTempSig(e.target.value)}
                    onKeyDown={handleSignatureEditKeyDown}
                    className={`w-full min-h-[160px] p-1 text-sm leading-relaxed outline-none resize-none bg-transparent ${
                      isDarkMode ? 'text-amber-50 placeholder-amber-100/45' : 'text-slate-700 placeholder-slate-500'
                    }`}
                    placeholder="写下你的签名..."
                  />
                  <div className={`mt-2 text-[11px] text-right ${isDarkMode ? 'text-amber-100/70' : 'text-amber-700/70'}`}>
                    {Array.from(tempSig).length}/{SIGNATURE_AI_MAX_CHARS}
                  </div>
                </div>
              ) : (
                <div className={`rounded-xl p-3 min-h-[160px] whitespace-pre-wrap break-words text-sm leading-relaxed bg-transparent ${isDarkMode ? 'text-amber-50' : 'text-slate-700'}`}>
                  {userSignature || <span className="opacity-50 italic">还没有签名，点右上角铅笔写一句吧。</span>}
                </div>
              )}
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Edit Book Modal */}
      {isEditModalOpen && editingBook && (
        <ModalPortal>
          <div className={`fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-500/20 backdrop-blur-sm ${closingModal === 'edit' ? 'app-fade-exit' : 'app-fade-enter'}`}>
          <div className={`${isDarkMode ? 'bg-[#2d3748] border-slate-600' : 'neu-bg border-white/50'} w-full max-w-sm rounded-2xl p-6 shadow-2xl border relative flex flex-col ${closingModal === 'edit' ? 'app-fade-exit' : 'app-fade-enter'}`} style={{ maxHeight: 'calc(var(--app-screen-height) - 9rem)' }}>
            <button onClick={closeEditModal} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
              <X size={20} />
            </button>
            
            <h3 className={`text-lg font-bold mb-6 text-center ${headingClass}`}>编辑书籍信息</h3>

            {isLoadingBookContent && (
              <div className="mb-3 text-xs text-slate-400 text-center">正在加载书籍正文...</div>
            )}
            {renderBookForm(editingBook, true)}

            {/* Actions */}
            <div className="mt-2 flex gap-3">
               <button 
                  onClick={handleDeleteClick}
                  className={`p-3 rounded-full text-rose-500 hover:bg-rose-500/10 transition-colors ${btnClass}`}
                  title="删除书籍"
               >
                  <Trash2 size={20} />
               </button>
               <button 
                  onClick={saveBookChanges}
                  disabled={isLoadingBookContent}
                  className={`flex-1 py-3 rounded-full text-white bg-rose-400 shadow-lg hover:bg-rose-500 active:scale-95 transition-all font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed`}
               >
                  保存修改
               </button>
            </div>
          </div>
          </div>
        </ModalPortal>
      )}

      {/* Import Book Modal */}
      {isImportModalOpen && (
         <ModalPortal>
           <div className={`fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-500/20 backdrop-blur-sm ${closingModal === 'import' ? 'app-fade-exit' : 'app-fade-enter'}`}>
            <div className={`${isDarkMode ? 'bg-[#2d3748] border-slate-600' : 'neu-bg border-white/50'} w-full max-w-sm rounded-2xl p-6 shadow-2xl border relative flex flex-col ${closingModal === 'import' ? 'app-fade-exit' : 'app-fade-enter'}`} style={{ maxHeight: 'calc(var(--app-screen-height) - 9rem)' }}>
               <button onClick={closeImportModal} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
                  <X size={20} />
               </button>
               
               <h3 className={`text-lg font-bold mb-6 text-center ${headingClass}`}>导入新书籍</h3>

               {renderBookForm(importingBook, false)}

               {/* Actions */}
               <div className="mt-2 flex gap-3">
                  <button 
                     onClick={closeImportModal}
                     className={`flex-1 py-3 rounded-full text-slate-500 text-sm font-bold ${btnClass}`}
                  >
                     取消
                  </button>
                  <button 
                     onClick={saveImportBook}
                     disabled={!importingBook.title}
                     className={`flex-1 py-3 rounded-full text-white bg-rose-400 shadow-lg hover:bg-rose-500 active:scale-95 transition-all font-bold text-sm disabled:opacity-50 disabled:active:scale-100`}
                  >
                     确认导入
                  </button>
               </div>
            </div>
           </div>
         </ModalPortal>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
         <ModalPortal>
           <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm animate-fade-in">
            <div className={`${cardClass} w-full max-w-xs rounded-2xl p-6 shadow-2xl border-2 border-rose-100/10 relative flex flex-col items-center text-center`}>
               <div className={`w-12 h-12 rounded-full ${isDarkMode ? 'bg-rose-500/20' : 'bg-rose-100'} text-rose-500 flex items-center justify-center mb-4`}>
                  <Trash2 size={24} />
               </div>
               <h3 className={`text-lg font-bold mb-2 ${isDarkMode ? 'text-rose-400' : 'text-rose-500'}`}>
                  确认删除?
               </h3>
               <p className="text-sm text-slate-500 mb-6">
                  该操作无法撤销，书籍及阅读进度将被永久删除。
               </p>
               <div className="flex gap-3 w-full">
                  <button 
                     onClick={() => setDeleteConfirmId(null)}
                     className={`flex-1 py-2 rounded-full text-slate-500 text-sm font-bold ${btnClass}`}
                  >
                     取消
                  </button>
                  <button 
                     onClick={confirmDelete}
                     className={`flex-1 py-2 rounded-full text-white bg-rose-500 shadow-lg hover:bg-rose-600 active:scale-95 transition-all font-bold text-sm`}
                  >
                     删除
                  </button>
               </div>
            </div>
           </div>
         </ModalPortal>
      )}

      {/* Error Alert Modal (Reused for AI errors) */}
      {errorModal.show && (
         <ModalPortal>
           <div className={`fixed inset-0 z-[120] flex items-center justify-center p-6 pb-28 bg-black/40 backdrop-blur-sm ${isErrorModalClosing ? 'app-fade-exit' : 'app-fade-enter'}`}>
             <div className={`${cardClass} w-full max-w-xs rounded-2xl p-6 shadow-2xl border-2 border-red-100/10 relative flex flex-col items-center text-center ${isErrorModalClosing ? 'app-fade-exit' : 'app-fade-enter'}`}>
                <div className={`w-12 h-12 rounded-full ${isDarkMode ? 'bg-red-500/20' : 'bg-red-100'} text-red-500 flex items-center justify-center mb-4`}>
                   <AlertTriangle size={24} />
                </div>
                <h3 className={`text-lg font-bold mb-2 ${isDarkMode ? 'text-red-400' : 'text-red-500'}`}>
                   操作失败
                </h3>
                <p className="text-sm text-slate-500 mb-6 whitespace-pre-wrap">
                   {errorModal.msg}
                </p>
                <button 
                   onClick={closeErrorModal}
                   className={`w-full py-2 rounded-full text-white bg-red-500 shadow-lg hover:bg-red-600 active:scale-95 transition-all font-bold text-sm`}
                >
                   关闭
                </button>
             </div>
           </div>
         </ModalPortal>
      )}

      {/* RAG Preset Dropdown Portal */}
      {(ragPresetDropdownOpen || isRagDropdownClosing) && (
        <ModalPortal>
          <div className="fixed inset-0 z-[110]" onClick={closeRagDropdown}>
            <div
              style={{ position: 'fixed', top: ragDropdownPos.top, left: ragDropdownPos.left, width: ragDropdownPos.width }}
              className={`p-2 rounded-xl max-h-48 overflow-y-auto ${cardClass} border border-slate-400/10 shadow-2xl ${isRagDropdownClosing ? 'reader-flyout-exit' : 'reader-flyout-enter'}`}
              onClick={(e) => e.stopPropagation()}
            >
              {ragPresets.map((preset: RagPreset) => {
                const currentPresetId = editingBook ? editRagPresetId : importRagPresetId;
                const setCurrentPresetId = editingBook ? setEditRagPresetId : setImportRagPresetId;
                const isSelected = preset.id === currentPresetId;
                return (
                  <div
                    key={preset.id}
                    onClick={() => { setCurrentPresetId(preset.id); closeRagDropdown(); }}
                    className={`flex items-center gap-2 p-2 rounded-lg text-sm cursor-pointer transition-colors ${
                      isSelected
                        ? 'text-rose-400 font-bold bg-rose-400/10'
                        : isDarkMode ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-rose-400 border-rose-400' : 'border-slate-400'}`}>
                      {isSelected && <Check size={10} className="text-white" />}
                    </div>
                    <span className="truncate">{preset.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </ModalPortal>
      )}

      {/* RAG Help Modal */}
      {showRagHelpModal && (
        <ModalPortal>
          <div
            className={`fixed inset-0 z-[120] flex items-center justify-center p-6 pb-28 bg-black/40 backdrop-blur-sm ${isRagHelpModalClosing ? 'app-fade-exit' : 'app-fade-enter'}`}
            onClick={() => {
              setIsRagHelpModalClosing(true);
              setTimeout(() => { setShowRagHelpModal(false); setIsRagHelpModalClosing(false); }, MODAL_TRANSITION_MS);
            }}
          >
            <div
              className={`${cardClass} w-full max-w-sm rounded-2xl p-6 shadow-2xl border border-slate-400/10 relative ${isRagHelpModalClosing ? 'app-fade-exit' : 'app-fade-enter'}`}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className={`text-base font-bold mb-4 text-center ${headingClass}`}>RAG（检索增强生成）功能说明</h3>

              <div className="space-y-3 text-xs text-slate-500 leading-relaxed">
                <div>
                  <div className="font-bold text-rose-400 flex items-center gap-1 mb-1"><Search size={12} /> 作用</div>
                  为书籍建立向量索引库，在阅读、评论、出题等场景中能根据用户输入更精准检索书中相关段落，跨章节内容关联能力更强。
                </div>
                <div>
                  <div className="font-bold text-rose-400 flex items-center gap-1 mb-1"><BookIcon size={12} /> 涉及功能</div>
                  阅读区伴读聊天 · 共读集出题与笔记评论
                </div>
                <div>
                  <div className="font-bold text-rose-400 flex items-center gap-1 mb-1"><AlertTriangle size={12} /> 注意事项</div>
                  <ul className="list-disc pl-4 mt-1 space-y-1">
                    <li>开启后首次构建索引耗时较长（取决于书籍篇幅和使用模型）并且会占用一定本地存储空间</li>
                    <li>构建过程中请保持应用运行（可切至后台，但不要杀掉应用进程）</li>
                    <li>构建期间无法导入其他书籍或打开其他书的阅读界面</li>
                    <li>可在「设置 → API设置」底部的 RAG模型预设配置中添加RAG专用模型预设</li>
                  </ul>
                </div>
              </div>

              <button
                onClick={() => {
                  setIsRagHelpModalClosing(true);
                  setTimeout(() => { setShowRagHelpModal(false); setIsRagHelpModalClosing(false); }, MODAL_TRANSITION_MS);
                }}
                className={`w-full mt-5 py-2.5 rounded-full text-rose-400 text-sm font-bold ${btnClass}`}
              >
                知道了
              </button>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
};

export default Library;
