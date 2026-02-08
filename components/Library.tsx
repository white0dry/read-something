import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Book as BookIcon, Plus, Clock, Edit2, Check, UserCircle, LogOut, Link2, Search, Filter, MoreVertical, X, Image, Trash2, Link, FileText, FileUp, List, Sparkles, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, LayoutGrid, AlignJustify } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { Book, Chapter, ApiConfig } from '../types';
import { Persona, Character } from './settings/types';
import ModalPortal from './ModalPortal';
import ResolvedImage from './ResolvedImage';
import { deleteImageByRef, saveImageFile } from '../utils/imageStorage';
import { getBookContent, getBookTextLength } from '../utils/bookContentStorage';

interface LibraryProps {
  books: Book[];
  onOpenBook: (book: Book) => void;
  onAddBook: (book: Book) => void;
  onUpdateBook: (book: Book) => void;
  onDeleteBook: (id: string) => void;
  isDarkMode: boolean;
  userSignature: string;
  onUpdateSignature: (text: string) => void;
  personas: Persona[];
  activePersonaId: string | null;
  onSelectPersona: (id: string | null) => void;
  characters: Character[];
  activeCharacterId: string | null;
  onSelectCharacter: (id: string | null) => void;
  apiConfig: ApiConfig;
}

// Custom Feather Icon provided by user
const FeatherIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" className={`bi bi-feather ${className}`} viewBox="0 0 16 16">
    <path d="M15.807.531c-.174-.177-.41-.289-.64-.363a3.8 3.8 0 0 0-.833-.15c-.62-.049-1.394 0-2.252.175C10.365.545 8.264 1.415 6.315 3.1S3.147 6.824 2.557 8.523c-.294.847-.44 1.634-.429 2.268.005.316.05.62.154.88q.025.061.056.122A68 68 0 0 0 .08 15.198a.53.53 0 0 0 .157.72.504.504 0 0 0 .705-.16 68 68 0 0 1 2.158-3.26c.285.141.616.195.958.182.513-.02 1.098-.188 1.723-.49 1.25-.605 2.744-1.787 4.303-3.642l1.518-1.55a.53.53 0 0 0 0-.739l-.729-.744 1.311.209a.5.5 0 0 0 .443-.15l.663-.684c.663-.68 1.292-1.325 1.763-1.892.314-.378.585-.752.754-1.107.163-.345.278-.773.112-1.188a.5.5 0 0 0-.112-.172M3.733 11.62C5.385 9.374 7.24 7.215 9.309 5.394l1.21 1.234-1.171 1.196-.027.03c-1.5 1.789-2.891 2.867-3.977 3.393-.544.263-.99.378-1.324.39a1.3 1.3 0 0 1-.287-.018Zm6.769-7.22c1.31-1.028 2.7-1.914 4.172-2.6a7 7 0 0 1-.4.523c-.442.533-1.028 1.134-1.681 1.804l-.51.524zm3.346-3.357C9.594 3.147 6.045 6.8 3.149 10.678c.007-.464.121-1.086.37-1.806.533-1.535 1.65-3.415 3.455-4.976 1.807-1.561 3.746-2.36 5.31-2.68a8 8 0 0 1 1.564-.173"/>
  </svg>
);

// Updated SVG Book Cover
const DefaultBookCover = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-full h-full bg-slate-200 dark:bg-slate-700 text-slate-400 p-4" fill="currentColor" viewBox="0 0 16 16">
    <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783"/>
  </svg>
);

type SortField = 'title' | 'author' | 'progress' | 'id' | 'length';
type SortDirection = 'asc' | 'desc';
type ViewMode = 'grid' | 'list';

const Library: React.FC<LibraryProps> = ({ 
  books,
  onOpenBook, 
  onAddBook,
  onUpdateBook,
  onDeleteBook,
  isDarkMode,
  userSignature,
  onUpdateSignature,
  personas,
  activePersonaId,
  onSelectPersona,
  characters,
  activeCharacterId,
  onSelectCharacter,
  apiConfig
}) => {
  const MODAL_TRANSITION_MS = 240;
  const containerClass = isDarkMode ? 'bg-[#2d3748] text-slate-200' : 'neu-bg text-slate-600';
  const headingClass = isDarkMode ? 'text-slate-200' : 'text-slate-700';
  const subTextClass = isDarkMode ? 'text-slate-400' : 'text-slate-500';
  const cardClass = isDarkMode ? 'bg-[#2d3748] shadow-[6px_6px_12px_#232b39,-6px_-6px_12px_#374357]' : 'neu-flat';
  const pressedClass = isDarkMode ? 'bg-[#2d3748] shadow-[inset_3px_3px_6px_#232b39,inset_-3px_-3px_6px_#374357]' : 'neu-pressed';
  const inputClass = isDarkMode ? 'bg-[#2d3748] shadow-[inset_3px_3px_6px_#232b39,inset_-3px_-3px_6px_#374357] text-slate-200 placeholder-slate-500' : 'neu-pressed text-slate-600 placeholder-slate-400';
  const btnClass = isDarkMode ? 'bg-[#2d3748] shadow-[5px_5px_10px_#232b39,-5px_-5px_10px_#374357] text-slate-200' : 'neu-btn';

  // State for signature editing
  const [isEditingSig, setIsEditingSig] = useState(false);
  const [tempSig, setTempSig] = useState(userSignature);
  
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
  
  // State for Deletion Confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<{show: boolean, msg: string}>({ show: false, msg: '' });
  const [isErrorModalClosing, setIsErrorModalClosing] = useState(false);

  // State for AI Regex Generation
  const [isGeneratingRegex, setIsGeneratingRegex] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());

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
  useEffect(() => setTempSig(userSignature), [userSignature]);

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
        console.error("Regex error:", e);
        return [{ title: 'Regex Error', content: text }];
    }
  };

  useEffect(() => {
    let text = '';
    let regex = '';
    
    if (isImportModalOpen) {
        text = importingBook.fullText || '';
        regex = importingBook.chapterRegex || '';
    } else if (isEditModalOpen && editingBook) {
        text = editingBook.fullText || '';
        regex = editingBook.chapterRegex || '';
    }

    if (text) {
        const chapters = parseChapters(text, regex);
        setDetectedChapters(chapters.length);
    } else {
        setDetectedChapters(0);
    }
  }, [importingBook.fullText, importingBook.chapterRegex, editingBook?.fullText, editingBook?.chapterRegex, isImportModalOpen, isEditModalOpen]);


  const handleSaveSig = () => {
    onUpdateSignature(tempSig);
    setIsEditingSig(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSaveSig();
    if (e.key === 'Escape') {
      setTempSig(userSignature);
      setIsEditingSig(false);
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
  const allTags = Array.from(new Set(books.flatMap(b => b.tags || [])));
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
  };

  // Open Edit
  const openEditModal = (e: React.MouseEvent, book: Book) => {
    e.stopPropagation();
    if (editModalCloseTimerRef.current) {
      window.clearTimeout(editModalCloseTimerRef.current);
      editModalCloseTimerRef.current = null;
    }
    setEditingBook({ ...book, tags: book.tags || [], fullText: '', chapters: [] });
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
      })
      .catch((error) => {
        console.error('Failed to load book content for edit modal:', error);
        openErrorModal('读取书籍正文失败，请稍后重试。');
      })
      .finally(() => {
        setIsLoadingBookContent(false);
      });
  };

  // Open Import
  const openImportModal = () => {
     if (importModalCloseTimerRef.current) {
       window.clearTimeout(importModalCloseTimerRef.current);
       importModalCloseTimerRef.current = null;
     }
     setImportingBook({
         title: '', author: '', coverUrl: '', tags: [], fullText: '', chapterRegex: '', progress: 0, lastRead: '从未阅读'
     });
     setClosingModal(prev => prev === 'import' ? null : prev);
     setIsImportModalOpen(true);
     resetModalState();
  };

  const closeEditModal = () => {
    if (!isEditModalOpen) return;
    setIsLoadingBookContent(false);
    setClosingModal('edit');
    if (editModalCloseTimerRef.current) window.clearTimeout(editModalCloseTimerRef.current);
    editModalCloseTimerRef.current = window.setTimeout(() => {
      setIsEditModalOpen(false);
      setEditingBook(null);
      setClosingModal(prev => prev === 'edit' ? null : prev);
    }, MODAL_TRANSITION_MS);
  };

  const closeImportModal = () => {
    if (!isImportModalOpen) return;
    setClosingModal('import');
    if (importModalCloseTimerRef.current) window.clearTimeout(importModalCloseTimerRef.current);
    importModalCloseTimerRef.current = window.setTimeout(() => {
      setIsImportModalOpen(false);
      setImportingBook({});
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
      // Re-parse chapters if regex exists
      const chapters = parseChapters(editingBook.fullText || '', editingBook.chapterRegex || '');
      const updatedBook = { ...editingBook, chapters };
      onUpdateBook(updatedBook);
      closeEditModal();
    }
  };

  // Save Import
  const saveImportBook = () => {
     if (importingBook.title) {
        const text = importingBook.fullText || '';
        const regex = importingBook.chapterRegex || '';
        const chapters = parseChapters(text, regex);

        const newBook: Book = {
            id: Date.now().toString(),
            title: importingBook.title,
            author: importingBook.author || '佚名',
            coverUrl: importingBook.coverUrl || '', // Empty for default
            tags: importingBook.tags || [],
            progress: 0,
            lastRead: '从未阅读',
            fullText: text,
            chapterRegex: regex,
            chapters: chapters
        };
        onAddBook(newBook);
        closeImportModal();
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

  const handleTxtFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      const targetBook = isEditModalOpen ? editingBook : importingBook;
      const setTarget = isEditModalOpen ? setEditingBook : setImportingBook;

      if (file && targetBook) {
          const reader = new FileReader();
          reader.onload = (e) => {
              const text = (e.target?.result || '') as string;
              // @ts-ignore
              setTarget(prev => ({ ...prev, fullText: text, title: prev.title || file.name.replace('.txt', '') }));
          };
          reader.readAsText(file); // Default encoding UTF-8
      }
  };

  const handleTxtUrlSubmit = async () => {
      const targetBook = isEditModalOpen ? editingBook : importingBook;
      const setTarget = isEditModalOpen ? setEditingBook : setImportingBook;

      if (targetBook && tempTxtUrl.trim()) {
          try {
              const res = await fetch(tempTxtUrl);
              const text = await res.text();
              // @ts-ignore
              setTarget(prev => ({ ...prev, fullText: text }));
              setTxtFileUrlMode(false);
              setTempTxtUrl('');
          } catch (e: any) {
              alert("无法读取链接内容");
          }
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

  // AI Regex Auto Generate with Real API
  const handleAutoGenerateRegex = async () => {
      if (!apiConfig.apiKey) {
        openErrorModal("请先在设置中配置 API Key");
        return;
      }

      const targetBook = isEditModalOpen ? editingBook : importingBook;
      const setTarget = isEditModalOpen ? setEditingBook : setImportingBook;
      const currentInput = targetBook?.chapterRegex || '';

      if (!currentInput.trim()) {
          openErrorModal("请先在输入框中填入一个章节标题示例，例如：'第一章 起点' 或 'Chapter 1'");
          return;
      }

      setIsGeneratingRegex(true);

      const systemPrompt = `你是一个正则表达式专家。用户提供了一个小说章节标题示例。
请生成一个JavaScript正则表达式来匹配此类章节标题。
重要规则：
1. 必须匹配行首 (^)，因为我们要按行匹配章节。
2. 兼容数字变化（阿拉伯数字、中文数字）。
3. 只返回正则表达式字符串本身，不要包含斜杠 /.../，不要 markdown，不要解释代码。
4. 如果示例包含多余空格，正则应兼容空格 (\\s*)。
5. 请容错用户可能输入的多行文本，只针对第一行标题生成正则。

输入: "第1章 开始"
输出: ^第\\s*[0-9]+\\s*章

输入: "Chapter 1"
输出: ^Chapter\\s*\\d+`;

      try {
        let regexResult = "";
        const endpoint = apiConfig.endpoint.replace(/\/+$/, '');

        if (apiConfig.provider === 'GEMINI') {
           // Use @google/genai SDK
           const ai = new GoogleGenAI({ apiKey: apiConfig.apiKey });
           const response = await ai.models.generateContent({
             model: apiConfig.model || 'gemini-3-pro-preview',
             contents: `${systemPrompt}\n\n用户输入示例: "${currentInput}"`,
           });
           
           regexResult = response.text || "";

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
            regexResult = data.content?.[0]?.text || "";

        } else {
            // OpenAI / DeepSeek
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
            regexResult = data.choices?.[0]?.message?.content || "";
        }

        // --- Robust Cleaning Logic for Input Box Tolerance ---
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
           throw new Error("API 返回内容无法解析为正则");
        }

      } catch (e: any) {
         const errorMessage = e instanceof Error ? e.message : String(e);
         openErrorModal("自动生成失败: " + errorMessage);
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
  const renderBookForm = (book: Partial<Book>, isEdit: boolean) => (
     <div className="overflow-y-auto no-scrollbar flex-1 -mx-2 px-2 space-y-5 pb-4">
        {/* File Import Section (Import Only) */}
        {!isEdit && (
            <div className={`p-4 rounded-xl space-y-3 ${isDarkMode ? 'bg-black/20' : 'bg-slate-100/50'}`}>
                <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                        <FileUp size={14} /> 导入文本 (TXT)
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
                         <input type="file" ref={txtFileInputRef} className="hidden" accept=".txt" onChange={handleTxtFileSelect} />
                         
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
                            placeholder="输入TXT链接..."
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
        )}

        {/* Content Preview/Edit Area */}
        <div className="space-y-1">
           <div className="flex justify-between items-center mb-1">
             <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">正文内容</label>
             <span className="text-[10px] text-slate-400">{book.fullText ? `${book.fullText.length} 字` : '0 字'}</span>
           </div>
           <textarea
              value={book.fullText || ''}
              onChange={(e) => isEdit ? setEditingBook({...editingBook!, fullText: e.target.value}) : setImportingBook({...importingBook, fullText: e.target.value})}
              placeholder="可在此处粘贴或编辑书籍正文..."
              className={`w-full p-3 text-xs rounded-xl outline-none resize-none h-32 leading-relaxed ${inputClass}`}
           />
        </div>

        {/* Cover Image Section - Styled to match Import Text */}
        <div className={`p-4 rounded-xl space-y-3 ${isDarkMode ? 'bg-black/20' : 'bg-slate-100/50'}`}>
            <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                    <Image size={14} /> 封面图片
                </label>
                <span className="text-[10px] text-slate-400">{book.coverUrl ? '已设置' : '默认封面'}</span>
            </div>
            
            <div className="flex items-center gap-4">
                 {/* Cover Preview */}
                 <div className={`w-16 h-20 rounded-lg overflow-hidden flex-shrink-0 shadow-sm ${cardClass}`}>
                    {book.coverUrl ? (
                       <ResolvedImage src={book.coverUrl} className="w-full h-full object-cover" alt="Cover" />
                    ) : (
                       <DefaultBookCover />
                    )}
                 </div>

                 {/* Controls */}
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

        {/* Text Fields */}
        <div className="space-y-3">
           <div className="space-y-1">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">书名</label>
              <input 
                 type="text" 
                 value={book.title}
                 onChange={(e) => isEdit ? setEditingBook({...editingBook!, title: e.target.value}) : setImportingBook({...importingBook, title: e.target.value})}
                 className={`w-full px-4 py-3 text-sm rounded-xl outline-none ${inputClass}`}
              />
           </div>
           <div className="space-y-1">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">作者</label>
              <input 
                 type="text" 
                 value={book.author}
                 onChange={(e) => isEdit ? setEditingBook({...editingBook!, author: e.target.value}) : setImportingBook({...importingBook, author: e.target.value})}
                 className={`w-full px-4 py-3 text-sm rounded-xl outline-none ${inputClass}`}
              />
           </div>
        </div>

        {/* Regex / Chapter Parsing */}
        <div className="space-y-1">
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
                     onChange={(e) => isEdit ? setEditingBook({...editingBook!, chapterRegex: e.target.value}) : setImportingBook({...importingBook, chapterRegex: e.target.value})}
                     placeholder="例如: 第[0-9]+章"
                     className={`flex-1 px-4 py-3 text-sm rounded-xl outline-none ${inputClass}`}
                 />
                 <button 
                    onClick={handleAutoGenerateRegex}
                    disabled={isGeneratingRegex}
                    className={`px-4 rounded-xl flex items-center justify-center gap-1 text-xs font-bold text-rose-400 transition-all active:scale-95 whitespace-nowrap disabled:opacity-50 ${btnClass}`}
                    title="输入示例标题后点击自动生成"
                 >
                    <Sparkles size={14} className={isGeneratingRegex ? "animate-spin" : ""} /> 
                    {isGeneratingRegex ? '生成中...' : '自动生成'}
                 </button>
             </div>
             <p className="text-[10px] text-slate-400 px-2 leading-tight mt-1">
                输入示例标题(如"第一章 起点")点击自动生成正则。
             </p>
        </div>

        {/* Tag Management */}
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
                 placeholder={book.tags && book.tags.length > 0 ? "+ 添加" : "添加标签..."}
                 className="bg-transparent outline-none text-xs flex-1 min-w-[60px] py-1"
              />
           </div>
        </div>
     </div>
  );

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
                 setSortDirection('desc'); // Default new field to desc
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
            <div className="mt-1 h-8 flex items-center">
              {isEditingSig ? (
                 <div className="flex items-center gap-2 w-full max-w-[240px]">
                   <input 
                     autoFocus
                     type="text" 
                     value={tempSig}
                     onChange={(e) => setTempSig(e.target.value)}
                     onBlur={handleSaveSig}
                     onKeyDown={handleKeyDown}
                     className={`w-full min-w-0 text-sm px-2 py-1 rounded-lg outline-none ${inputClass}`}
                   />
                   <button onMouseDown={handleSaveSig} className="text-emerald-500 flex-shrink-0"><Check size={16} /></button>
                 </div>
              ) : (
                 <div 
                   onClick={() => setIsEditingSig(true)}
                   className={`group flex items-center justify-between gap-2 cursor-pointer py-1 -ml-1 px-1 rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5 w-full max-w-[240px]`}
                 >
                   <p className={`text-sm ${subTextClass} truncate mr-2`}>{userSignature || <span className="opacity-50 italic">点击编辑签名...</span>}</p>
                   <Edit2 size={12} className="opacity-0 group-hover:opacity-50 text-slate-400 flex-shrink-0" />
                 </div>
              )}
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
              <div className="w-20 h-28 flex-shrink-0 rounded-lg overflow-hidden shadow-md app-card-press-media">
                {recentBook.coverUrl ? (
                    <ResolvedImage src={recentBook.coverUrl} alt="Cover" className="w-full h-full object-cover opacity-90" />
                ) : (
                    <DefaultBookCover />
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
              <button 
                onClick={(e) => openEditModal(e, recentBook)}
                className={`absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:text-rose-400 ${isDarkMode ? 'bg-black/20 text-slate-200' : 'bg-white/50 text-slate-600'}`}
              >
                <Edit2 size={16} />
              </button>
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
                  <span className="text-xs mt-1 opacity-60">TXT</span>
               </div>

               {/* Grid Books */}
               {sortedBooks.map(book => (
                 <div key={book.id} onClick={() => onOpenBook(book)} className="flex flex-col gap-3 cursor-pointer group app-card-press">
                   <div className={`relative aspect-[3/4] rounded-2xl overflow-hidden p-1 app-card-press-media ${cardClass}`}>
                     <div className="w-full h-full rounded-xl overflow-hidden opacity-90 hover:opacity-100 transition-opacity app-card-press-media">
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

                     <button 
                        onClick={(e) => openEditModal(e, book)}
                        className="absolute top-2 right-2 w-7 h-7 bg-black/40 hover:bg-rose-500 text-white rounded-full flex items-center justify-center backdrop-blur-sm transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100"
                     >
                        <Edit2 size={14} />
                     </button>
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
                  <span className="text-sm font-medium">导入新书籍 (TXT)</span>
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
                    <div className="flex flex-col justify-center">
                        <button 
                            onClick={(e) => openEditModal(e, book)}
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-rose-400 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity ${btnClass}`}
                         >
                            <Edit2 size={14} />
                         </button>
                    </div>
                 </div>
               ))}
           </div>
        )}
      </div>

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
              <div className="mb-3 text-xs text-slate-400 text-center">Loading book content...</div>
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
                     disabled={!importingBook.fullText || !importingBook.title}
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
    </>
  );
};

export default Library;
