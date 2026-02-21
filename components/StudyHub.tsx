import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Plus, ArrowLeft, Search, X, Filter, Trash2, MessageCircle,
  Send, ChevronLeft, ChevronRight, Check, RotateCcw, HelpCircle,
  Loader2, BookMarked, CheckCircle2, NotebookPen, CircleCheckBig,
  BookPlus, UserCircle, Edit2, Link, FileUp, ChevronDown, Feather, Scroll,
} from 'lucide-react';
import {
  Book, ApiConfig, RagApiConfigResolver, Notebook, StudyNote, StudyNoteCommentThread,
  StudyNoteCommentMessage, QuizSession, QuizConfig, QuizQuestion,
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
import { getBookContent } from '../utils/bookContentStorage';
import { estimateRagSafeOffset, retrieveRelevantChunks, isEmbedModelLoaded } from '../utils/ragEngine';

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
  showNotification: (message: string, type?: 'success' | 'error') => void;
  ragApiConfigResolver?: RagApiConfigResolver;
}

type HubTab = 'notes' | 'quiz';
type NotesView = 'list' | 'detail' | 'editor';
type QuizView = 'history' | 'config' | 'play' | 'result';

const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const StudyHub: React.FC<StudyHubProps> = ({
  isDarkMode, books, personas, activePersonaId, characters,
  activeCharacterId, worldBookEntries, apiConfig, readingExcerptCharCount, showNotification,
  ragApiConfigResolver,
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

  // ─── Top-level state ───
  const [activeTab, setActiveTab] = useState<HubTab>('notes');

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

  // ─── Load data ───
  useEffect(() => {
    getAllNotebooks().then(setNotebooks).catch(() => {});
    getAllQuizSessions().then(setQuizSessions).catch(() => {});
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
    const updatedNote = { ...activeNote, content: noteContent, updatedAt: Date.now() };
    const updatedNb = {
      ...activeNotebook,
      notes: activeNotebook.notes.map((n) => n.id === updatedNote.id ? updatedNote : n),
      updatedAt: Date.now(),
    };
    setActiveNote(updatedNote);
    setActiveNotebook(updatedNb);
    saveNotebook(updatedNb);
    setNotebooks((prev) => prev.map((n) => n.id === updatedNb.id ? updatedNb : n));
  }, [activeNotebook, activeNote, noteContent]);

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

    const wasNotLoaded = !isEmbedModelLoaded();
    if (wasNotLoaded) showNotification('RAG 语义模型首次加载中…');

    try {
      const topK = options?.topK || 3;
      const perBook = options?.perBook || false;

      // 准备每本书的安全偏移量
      const bookInfos: Array<{ bookId: string; title: string; safeOffset: number }> = [];
      for (const bookId of bookIds) {
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

      if (perBook) {
        // ── 逐书独立检索模式：每本书独立获得 topK 个片段 ──
        // 不在 query 中注入书名——perBook 已限定在单本书的 embeddings 中检索，
        // 注入书名反而会让不同 query 的 embedding 过于相似（公共前缀主导向量）。
        for (const { bookId, safeOffset } of bookInfos) {
          // 第一轮：全书范围检索，然后按阅读进度过滤
          const fullScope: Record<string, number> = { [bookId]: Number.MAX_SAFE_INTEGER };
          const candidates = await retrieveRelevantChunks(normalizedQuery, fullScope, {
            topK: topK * 6,
            perBookTopK: topK * 6,
          }, ragApiConfigResolver);

          const safeChunks = candidates
            .filter((chunk) => chunk.endOffset <= safeOffset)
            .slice(0, topK);
          const selected = [...safeChunks];

          // 第二轮回退：直接在安全范围内检索
          if (selected.length < topK) {
            const safeScope: Record<string, number> = { [bookId]: safeOffset };
            const fallbackChunks = await retrieveRelevantChunks(normalizedQuery, safeScope, {
              topK,
              perBookTopK: topK,
            }, ragApiConfigResolver);
            const seen = new Set(selected.map((c) => c.id));
            for (const chunk of fallbackChunks) {
              if (seen.has(chunk.id)) continue;
              seen.add(chunk.id);
              selected.push(chunk);
              if (selected.length >= topK) break;
            }
          }

          if (selected.length > 0) {
            ragContextByBookId[bookId] = selected.slice(0, topK).map((c) => c.text).join('\n---\n');
          }
        }
      } else {
        // ── 全局检索模式（笔记评论等使用）：所有书合起来取 topK ──
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
          });
        }
      }

      if (wasNotLoaded && isEmbedModelLoaded()) showNotification('RAG 语义模型加载成功');
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
          books, activeNotebook.boundBookIds, readingExcerptCharCount,
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
        books, activeNotebook.boundBookIds, readingExcerptCharCount,
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
      const bookContexts = await prepareBookContexts(books, activeNotebook.boundBookIds, readingExcerptCharCount);

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
        books, qcBookIds, readingExcerptCharCount,
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
      setQuizError(`生成失败：${err instanceof Error ? err.message : '未知错误'}`);
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
        session.overallComment = '（总评生成失败）';
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

  const renderTabBar = () => (
    <div className={`relative grid grid-cols-2 rounded-xl p-1 mx-6 overflow-hidden ${pressedClass}`}>
      <div
        className={`pointer-events-none absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] rounded-lg transition-transform duration-300 ${
          activeTab === 'quiz' ? 'translate-x-full' : 'translate-x-0'
        } ${isDarkMode ? 'bg-[#2d3748] shadow-[6px_6px_12px_#232b39]' : 'bg-[var(--neu-bg)] shadow-[6px_6px_12px_var(--neu-shadow-dark)]'}`}
      />
      <button
        onClick={() => setActiveTab('notes')}
        className={`relative z-10 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold transition-colors ${
          activeTab === 'notes' ? (isDarkMode ? 'text-white' : 'text-rose-400') : 'text-slate-500'
        }`}
      >
        <NotebookPen size={16} /> 读书笔记
      </button>
      <button
        onClick={() => setActiveTab('quiz')}
        className={`relative z-10 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold transition-colors ${
          activeTab === 'quiz' ? (isDarkMode ? 'text-white' : 'text-rose-400') : 'text-slate-500'
        }`}
      >
        <CircleCheckBig size={16} /> 内容问答
      </button>
    </div>
  );

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

    return (
      <ModalPortal>
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-500/20 backdrop-blur-sm ${closingPaperModal ? 'app-fade-exit' : 'app-fade-enter'}`}
          onClick={closePaperModal}
        >
          <div onClick={(e) => e.stopPropagation()}
            className={`${isDarkMode ? 'bg-[#2d3748] border-slate-600' : 'neu-bg border-white/50'} w-full max-w-sm rounded-2xl px-2 py-5 border relative flex flex-col ${closingPaperModal ? 'app-fade-exit' : 'app-fade-enter'}`}
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
        <div className="flex-1 overflow-y-auto px-6 no-scrollbar">
          <div className="pb-24 space-y-3 animate-fade-in">
            {activeNotebook.notes.length === 0 && (
              <div className="text-center py-12 text-slate-400">
                <NotebookPen size={40} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">还没有笔记</p>
              </div>
            )}

            {activeNotebook.notes.map((note) => (
              <div key={note.id} onClick={() => openNoteEditor(note)}
                className={`p-4 rounded-2xl cursor-pointer transition-all active:scale-[0.98] border ${isDarkMode ? 'border-slate-700/30' : 'border-amber-200/40'}`}
                style={{
                  backgroundColor: paperStyle.bg,
                  ...(paperStyle.css !== 'none' && { backgroundImage: paperStyle.css }),
                  ...(paperStyle.size && { backgroundSize: paperStyle.size }),
                  ...(paperStyle.position && { backgroundPosition: paperStyle.position }),
                  ...(paperStyle.border && { border: paperStyle.border }),
                  ...(paperStyle.shadow && { boxShadow: paperStyle.shadow }),
                }}
              >
                <p className={`text-sm line-clamp-2 ${headingClass}`} style={{ fontFamily: '"Noto Serif SC", "Source Han Serif CN", serif' }}>{note.content || '空白笔记'}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className={`text-[10px] ${subTextClass}`}>
                    {new Date(note.updatedAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <div className="flex items-center gap-2">
                    {note.commentThreads.length > 0 && (
                      <span className={`text-[10px] flex items-center gap-0.5 ${subTextClass}`}>
                        <MessageCircle size={10} /> {note.commentThreads.length}
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
            ))}
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

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 no-scrollbar">
          <div className="pt-3 pb-24 space-y-4 animate-fade-in">

        {/* Lined paper */}
        <div className={`rounded-2xl overflow-hidden ${cardClass}`}
          style={{
            backgroundColor: paperStyle.bg,
            ...(paperStyle.isCustomImage && paperStyle.css !== 'none' && { backgroundImage: paperStyle.css, backgroundSize: 'cover', backgroundPosition: 'center' }),
            ...(!paperStyle.isCustomImage && paperStyle.css !== 'none' && { backgroundImage: paperStyle.css }),
            ...(paperStyle.border && { border: paperStyle.border }),
            ...(paperStyle.shadow && { boxShadow: paperStyle.shadow }),
          }}
        >
          <div className="relative">
            {/* Margin line (hidden when non-default paper) */}
            {!paperStyle.hideMarginLine && (
              <div className="absolute top-0 bottom-0 left-10" style={{ width: '2px', background: marginLineColor }} />
            )}

            <textarea
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="随便写点什么吧"
              className={`w-full min-h-[300px] resize-none bg-transparent outline-none ${paperStyle.hideMarginLine ? 'pl-4' : 'pl-14'} pr-4 pt-4 pb-4 text-sm no-scrollbar`}
              style={{
                lineHeight: `${lineHeight}px`,
                ...(!paperStyle.isCustomImage && paperStyle.css !== 'none' && {
                  backgroundImage: paperStyle.css,
                  backgroundPosition: '0 0',
                  ...(paperStyle.size ? { backgroundSize: paperStyle.size } : {}),
                }),
                color: isDarkMode ? '#e2e8f0' : '#334155',
                fontFamily: '"Noto Serif SC", "Source Han Serif CN", serif',
              }}
            />
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
        {activeQuizSession.overallComment && (
          <div className={`${cardClass} rounded-2xl p-4`}>
            <div className="flex items-center gap-2 mb-2">
              <BookMarked size={16} className="text-rose-400" />
              <span className={`text-sm font-medium ${headingClass}`}>{activeQuizSession.characterName || 'AI'} 的总评</span>
            </div>
            <p className={`text-sm ${isDarkMode ? 'text-amber-200/80' : 'text-amber-800/80'}`}
              style={{ fontFamily: '"Noto Serif SC", serif', fontStyle: 'italic', lineHeight: '1.8' }}
            >
              {activeQuizSession.overallComment}
            </p>
          </div>
        )}

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
    <div className={`flex-1 flex flex-col overflow-hidden ${containerClass}`}>
      {/* Header - matching Settings page: p-6 container + pt-2 header = pt-8 total */}
      <header className="px-6 mb-4 pt-8">
        <h1 className={`text-2xl font-bold ${headingClass}`}>共读集</h1>
      </header>

      {/* Tab Bar */}
      {renderTabBar()}

      {/* Notes views — each view manages its own fixed header + scroll area */}
      {activeTab === 'notes' && (
        <div key={notesView} className={`flex-1 flex flex-col overflow-hidden ${notesViewAnimClass}`}>
          {notesView === 'list' && renderNotebookList()}
          {notesView === 'detail' && renderNotebookDetail()}
          {notesView === 'editor' && renderNoteEditor()}
        </div>
      )}

      {/* Quiz views — each view manages its own layout */}
      {activeTab === 'quiz' && (
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
