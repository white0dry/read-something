import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, PieChart, Settings as SettingsIcon, LayoutGrid, CheckCircle2, AlertCircle } from 'lucide-react';
import Library from './components/Library';
import Reader from './components/Reader';
import Stats from './components/Stats';
import Settings from './components/Settings';
import { AppView, Book, ApiConfig, ApiPreset, AppSettings, ReaderSessionSnapshot } from './types';
import { Persona, Character, WorldBookEntry } from './components/settings/types';
import { deleteImageByRef, migrateDataUrlToImageRef } from './utils/imageStorage';
import { compactBookForState, deleteBookContent, migrateInlineBookContent, saveBookContent } from './utils/bookContentStorage';

interface Notification {
  show: boolean;
  message: string;
  type: 'success' | 'error';
}

const DEFAULT_API_CONFIG: ApiConfig = {
  provider: 'OPENAI',
  endpoint: 'https://api.openai.com/v1',
  apiKey: '',
  model: ''
};

const DEFAULT_PRESETS: ApiPreset[] = [];

// Default Rose Color
const DEFAULT_THEME_COLOR = '#e28a9d';
const FONT_BASELINE_MULTIPLIER = 1.2; // Old 120% is the new 100%
const SAFE_AREA_DEFAULT_MIGRATION_KEY = 'app_safe_area_default_v2';
const DAILY_READING_MS_STORAGE_KEY = 'app_daily_reading_ms';

const DEFAULT_APP_SETTINGS: AppSettings = {
  activeCommentsEnabled: false,
  autoParseEnabled: false,
  commentInterval: 30,
  commentProbability: 50,
  themeColor: DEFAULT_THEME_COLOR,
  fontSizeScale: 1.0,
  safeAreaTop: 0,
  safeAreaBottom: 0
};

const BUILT_IN_SAMPLE_COVER_URLS = new Set([
  'https://picsum.photos/150/220?random=1',
  'https://picsum.photos/150/220?random=2',
  'https://picsum.photos/150/220?random=3',
  'https://picsum.photos/150/220?random=4',
]);

const stripBuiltInSampleBooks = (books: Book[]): Book[] => {
  return books.filter(book => {
    const isLegacySampleId = ['1', '2', '3', '4'].includes(book.id);
    const isLegacySampleCover = BUILT_IN_SAMPLE_COVER_URLS.has(book.coverUrl);
    return !(isLegacySampleId && isLegacySampleCover);
  });
};

// Helper to convert hex to RGB values for CSS variables
const hexToRgbValues = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? 
    `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}` 
    : '226 138 157'; // Default Rose-400
};

// Helper to generate a rough palette (lighter/darker) from base color
// This is a simplified approximation to avoid heavy color libraries
const adjustColor = (hex: string, percent: number) => {
    // strip the leading # if it's there
    hex = hex.replace(/^\s*#|\s*$/g, '');

    // convert 3 char codes --> 6, e.g. `E0F` --> `EE00FF`
    if (hex.length === 3) {
        hex = hex.replace(/(.)/g, '$1$1');
    }

    var r = parseInt(hex.substr(0, 2), 16),
        g = parseInt(hex.substr(2, 2), 16),
        b = parseInt(hex.substr(4, 2), 16);

    return '#' +
       ((0|(1<<8) + r + (256 - r) * percent / 100).toString(16)).substr(1) +
       ((0|(1<<8) + g + (256 - g) * percent / 100).toString(16)).substr(1) +
       ((0|(1<<8) + b + (256 - b) * percent / 100).toString(16)).substr(1);
}

const darkenColor = (hex: string, percent: number) => {
    hex = hex.replace(/^\s*#|\s*$/g, '');
    if (hex.length === 3) hex = hex.replace(/(.)/g, '$1$1');
    var r = parseInt(hex.substr(0, 2), 16),
        g = parseInt(hex.substr(2, 2), 16),
        b = parseInt(hex.substr(4, 2), 16);

    return '#' +
       ((0|(1<<8) + r * (100 - percent) / 100).toString(16)).substr(1) +
       ((0|(1<<8) + g * (100 - percent) / 100).toString(16)).substr(1) +
       ((0|(1<<8) + b * (100 - percent) / 100).toString(16)).substr(1);
}

const formatBookLastRead = (timestamp: number) => {
  const now = Date.now();
  const diffMs = Math.max(0, now - timestamp);
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 60) return `${Math.max(1, diffMinutes)}分钟前`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}小时前`;

  const date = new Date(timestamp);
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatLocalDateKey = (timestamp: number) => {
  const date = new Date(timestamp);
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const getNextDayStartTimestamp = (timestamp: number) => {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
};

const appendReadingDurationByDay = (
  source: Record<string, number>,
  startedAt: number,
  endedAt: number
) => {
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) {
    return source;
  }

  const next = { ...source };
  let cursor = startedAt;

  while (cursor < endedAt) {
    const nextDayStart = getNextDayStartTimestamp(cursor);
    const segmentEnd = Math.min(endedAt, nextDayStart);
    const dateKey = formatLocalDateKey(cursor);
    next[dateKey] = (next[dateKey] || 0) + (segmentEnd - cursor);
    cursor = segmentEnd;
  }

  return next;
};

const App: React.FC = () => {
  const VIEW_TRANSITION_MS = 260;
  const [currentView, setCurrentView] = useState<AppView>(AppView.LIBRARY);
  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [viewAnimationClass, setViewAnimationClass] = useState('app-view-enter-left');
  const [isViewTransitioning, setIsViewTransitioning] = useState(false);
  const viewTransitionTimerRef = useRef<number | null>(null);
  const viewTransitionUnlockTimerRef = useRef<number | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('app_dark_mode');
      return saved ? JSON.parse(saved) : false;
    } catch { return false; }
  });
  
  // Global Notification State
  const [notification, setNotification] = useState<Notification>({ show: false, message: '', type: 'success' });
  const [dailyReadingMsByDate, setDailyReadingMsByDate] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(DAILY_READING_MS_STORAGE_KEY);
      if (!saved) return {};
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed !== 'object') return {};
      const normalized: Record<string, number> = {};
      Object.entries(parsed).forEach(([key, value]) => {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
          normalized[key] = value;
        }
      });
      return normalized;
    } catch {
      return {};
    }
  });
  const readingSessionStartedAtRef = useRef<number | null>(null);
  const dailyReadingMsByDateRef = useRef<Record<string, number>>(dailyReadingMsByDate);

  // --- PERSISTENT STATE ---

  // Books
  const [books, setBooks] = useState<Book[]>(() => {
    try {
      const saved = localStorage.getItem('app_books');
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? stripBuiltInSampleBooks(parsed) : [];
    } catch { return []; }
  });

  // API Config
  const [apiConfig, setApiConfig] = useState<ApiConfig>(() => {
    try {
      const saved = localStorage.getItem('app_api_config');
      return saved ? JSON.parse(saved) : DEFAULT_API_CONFIG;
    } catch { return DEFAULT_API_CONFIG; }
  });

  // API Presets
  const [apiPresets, setApiPresets] = useState<ApiPreset[]>(() => {
    try {
      const saved = localStorage.getItem('app_api_presets');
      return saved ? JSON.parse(saved) : DEFAULT_PRESETS;
    } catch { return DEFAULT_PRESETS; }
  });

  // General App Settings (Automation, Appearance)
  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('app_settings');
      return saved ? { ...DEFAULT_APP_SETTINGS, ...JSON.parse(saved) } : DEFAULT_APP_SETTINGS;
    } catch { return DEFAULT_APP_SETTINGS; }
  });

  // Personas - Init empty if not found
  const [personas, setPersonas] = useState<Persona[]>(() => {
    try {
      const saved = localStorage.getItem('app_personas');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // Characters - Init empty if not found
  const [characters, setCharacters] = useState<Character[]>(() => {
    try {
      const saved = localStorage.getItem('app_characters');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // World Book - Init empty if not found
  const [worldBookEntries, setWorldBookEntries] = useState<WorldBookEntry[]>(() => {
    try {
      const saved = localStorage.getItem('app_worldbook');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [wbCategories, setWbCategories] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('app_wb_categories');
      return saved ? JSON.parse(saved) : ['Uncategorized'];
    } catch { return ['Uncategorized']; }
  });

  // Library User Profile State
  const [userSignature, setUserSignature] = useState(() => {
    // Check for null strictly so we allow empty string as a valid signature
    const saved = localStorage.getItem('app_user_signature');
    return saved !== null ? saved : "黑夜无论怎样漫长 白昼总会到来";
  });
  
  const [activePersonaId, setActivePersonaId] = useState<string | null>(() => {
     return localStorage.getItem('app_active_persona_id') || null;
  });

  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(() => {
    return localStorage.getItem('app_active_character_id') || null;
  });

  const safeSetStorageItem = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      console.error(`Failed to persist key "${key}"`, error);
      return false;
    }
  };

  // --- EFFECTS FOR PERSISTENCE ---

  useEffect(() => { safeSetStorageItem('app_dark_mode', JSON.stringify(isDarkMode)); }, [isDarkMode]);
  useEffect(() => {
    dailyReadingMsByDateRef.current = dailyReadingMsByDate;
  }, [dailyReadingMsByDate]);
  useEffect(() => {
    safeSetStorageItem(DAILY_READING_MS_STORAGE_KEY, JSON.stringify(dailyReadingMsByDate));
  }, [dailyReadingMsByDate]);
  useEffect(() => {
    const flushReadingSession = () => {
      const openedAt = readingSessionStartedAtRef.current;
      const closedAt = Date.now();
      if (!openedAt || closedAt <= openedAt) return;

      const next = appendReadingDurationByDay(dailyReadingMsByDateRef.current, openedAt, closedAt);
      readingSessionStartedAtRef.current = null;
      dailyReadingMsByDateRef.current = next;
      setDailyReadingMsByDate(next);
      safeSetStorageItem(DAILY_READING_MS_STORAGE_KEY, JSON.stringify(next));
    };

    window.addEventListener('pagehide', flushReadingSession);
    window.addEventListener('beforeunload', flushReadingSession);

    return () => {
      window.removeEventListener('pagehide', flushReadingSession);
      window.removeEventListener('beforeunload', flushReadingSession);
    };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const openedAt = readingSessionStartedAtRef.current;
      if (!openedAt) return;

      const now = Date.now();
      let cursor = openedAt;
      let next = dailyReadingMsByDateRef.current;
      let changed = false;

      while (cursor < now && formatLocalDateKey(cursor) !== formatLocalDateKey(now)) {
        const boundary = getNextDayStartTimestamp(cursor);
        const segmentEnd = Math.min(boundary, now);
        next = appendReadingDurationByDay(next, cursor, segmentEnd);
        cursor = segmentEnd;
        changed = true;
      }

      if (changed) {
        dailyReadingMsByDateRef.current = next;
        setDailyReadingMsByDate(next);
      }

      readingSessionStartedAtRef.current = cursor;
    }, 15000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark-mode', isDarkMode);
    document.body.classList.toggle('dark-mode', isDarkMode);
  }, [isDarkMode]);
  useEffect(() => {
    const iosNavigator = window.navigator as Navigator & { standalone?: boolean };
    const isIOSDevice = /iPad|iPhone|iPod/.test(iosNavigator.userAgent) || (iosNavigator.platform === 'MacIntel' && iosNavigator.maxTouchPoints > 1);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || iosNavigator.standalone === true;

    const readSafeAreaInsetBottom = () => {
      const probe = document.createElement('div');
      probe.style.position = 'fixed';
      probe.style.left = '0';
      probe.style.right = '0';
      probe.style.bottom = '0';
      probe.style.height = '0';
      probe.style.paddingBottom = 'env(safe-area-inset-bottom)';
      probe.style.visibility = 'hidden';
      probe.style.pointerEvents = 'none';
      document.body.appendChild(probe);
      const inset = parseFloat(window.getComputedStyle(probe).paddingBottom || '0');
      probe.remove();
      return Number.isFinite(inset) ? inset : 0;
    };

    const resolveScreenHeight = () => {
      const isLandscape = window.matchMedia('(orientation: landscape)').matches;
      const screenHeight = isLandscape ? window.screen.width : window.screen.height;
      return Number.isFinite(screenHeight) && screenHeight > 0 ? screenHeight : 0;
    };

    const syncAppScreenHeight = () => {
      const visualHeight = window.visualViewport?.height ?? 0;
      const innerHeight = window.innerHeight || 0;
      const clientHeight = document.documentElement.clientHeight || 0;
      let nextHeight = Math.max(visualHeight, innerHeight, clientHeight);

      // iOS standalone can report a viewport that excludes the bottom home-indicator zone.
      // Expand by safe-area inset and clamp to physical CSS screen height to avoid overshoot.
      if (isIOSDevice && isStandalone) {
        const safeAreaBottom = readSafeAreaInsetBottom();
        const screenHeight = resolveScreenHeight();
        const expandedHeight = nextHeight + safeAreaBottom;
        nextHeight = screenHeight > 0 ? Math.min(screenHeight, expandedHeight) : expandedHeight;
      }

      document.documentElement.style.setProperty('--app-screen-height', `${nextHeight}px`);
    };

    syncAppScreenHeight();
    window.addEventListener('resize', syncAppScreenHeight);
    window.addEventListener('orientationchange', syncAppScreenHeight);
    window.visualViewport?.addEventListener('resize', syncAppScreenHeight);

    return () => {
      window.removeEventListener('resize', syncAppScreenHeight);
      window.removeEventListener('orientationchange', syncAppScreenHeight);
      window.visualViewport?.removeEventListener('resize', syncAppScreenHeight);
    };
  }, []);
  useEffect(() => {
    try {
      if (localStorage.getItem(SAFE_AREA_DEFAULT_MIGRATION_KEY)) return;
      setAppSettings(prev => {
        const top = prev.safeAreaTop || 0;
        const bottom = prev.safeAreaBottom || 0;
        if (top === 0 && bottom === 10) {
          return { ...prev, safeAreaBottom: 0 };
        }
        return prev;
      });
      localStorage.setItem(SAFE_AREA_DEFAULT_MIGRATION_KEY, '1');
    } catch {
      // no-op: localStorage might be unavailable in private contexts
    }
  }, []);
  useEffect(() => {
    const compactedBooks = books.map(compactBookForState);
    safeSetStorageItem('app_books', JSON.stringify(compactedBooks));
  }, [books]);
  useEffect(() => { safeSetStorageItem('app_api_config', JSON.stringify(apiConfig)); }, [apiConfig]);
  useEffect(() => { safeSetStorageItem('app_api_presets', JSON.stringify(apiPresets)); }, [apiPresets]);
  useEffect(() => { safeSetStorageItem('app_settings', JSON.stringify(appSettings)); }, [appSettings]);
  useEffect(() => { safeSetStorageItem('app_personas', JSON.stringify(personas)); }, [personas]);
  useEffect(() => { safeSetStorageItem('app_characters', JSON.stringify(characters)); }, [characters]);
  useEffect(() => { safeSetStorageItem('app_worldbook', JSON.stringify(worldBookEntries)); }, [worldBookEntries]);
  useEffect(() => { safeSetStorageItem('app_wb_categories', JSON.stringify(wbCategories)); }, [wbCategories]);
  
  // New persistence
  useEffect(() => { safeSetStorageItem('app_user_signature', userSignature); }, [userSignature]);
  useEffect(() => { safeSetStorageItem('app_active_persona_id', activePersonaId || ''); }, [activePersonaId]);
  useEffect(() => { safeSetStorageItem('app_active_character_id', activeCharacterId || ''); }, [activeCharacterId]);

  // One-time migration: move old inline images/text out of localStorage into IndexedDB.
  useEffect(() => {
    let cancelled = false;

    const migrateStateData = async () => {
      try {
        const migratedPersonas = await Promise.all(
          personas.map(async (persona) => {
            if (!persona.avatar || !persona.avatar.startsWith('data:image/')) return persona;
            try {
              const avatarRef = await migrateDataUrlToImageRef(persona.avatar);
              return { ...persona, avatar: avatarRef };
            } catch {
              return persona;
            }
          })
        );

        const migratedCharacters = await Promise.all(
          characters.map(async (character) => {
            if (!character.avatar || !character.avatar.startsWith('data:image/')) return character;
            try {
              const avatarRef = await migrateDataUrlToImageRef(character.avatar);
              return { ...character, avatar: avatarRef };
            } catch {
              return character;
            }
          })
        );

        const booksWithMigratedCover = await Promise.all(
          books.map(async (book) => {
            if (!book.coverUrl || !book.coverUrl.startsWith('data:image/')) return book;
            try {
              const coverRef = await migrateDataUrlToImageRef(book.coverUrl);
              return { ...book, coverUrl: coverRef };
            } catch {
              return book;
            }
          })
        );
        const migratedBooks = await migrateInlineBookContent(booksWithMigratedCover);

        if (cancelled) return;

        const personasChanged = migratedPersonas.some((p, idx) => p.avatar !== personas[idx]?.avatar);
        const charactersChanged = migratedCharacters.some((c, idx) => c.avatar !== characters[idx]?.avatar);
        const booksChanged = migratedBooks.some((book, idx) => {
          const original = books[idx];
          if (!original) return true;
          return (
            book.coverUrl !== original.coverUrl ||
            (book.fullText || '') !== (original.fullText || '') ||
            (book.fullTextLength || 0) !== (original.fullTextLength || 0) ||
            (book.chapterCount || 0) !== (original.chapterCount || 0) ||
            (book.chapters?.length || 0) !== (original.chapters?.length || 0)
          );
        });

        if (personasChanged) setPersonas(migratedPersonas);
        if (charactersChanged) setCharacters(migratedCharacters);
        if (booksChanged) setBooks(migratedBooks);
      } catch (error) {
        console.error('State migration failed:', error);
      }
    };

    migrateStateData();
    return () => { cancelled = true; };
  }, []);

  // --- THEME & FONT SIZE APPLICATION ---

  useEffect(() => {
    const effectiveFontScale = appSettings.fontSizeScale * FONT_BASELINE_MULTIPLIER;

    // Apply Font Size Global Scale
    document.documentElement.style.fontSize = `${effectiveFontScale * 90}%`;

    // Calculate Colors
    const baseColor = appSettings.themeColor;
    
    // Generate Palette (Approximate)
    const c50 = adjustColor(baseColor, 95);
    const c100 = adjustColor(baseColor, 90);
    const c200 = adjustColor(baseColor, 75);
    const c300 = adjustColor(baseColor, 60);
    const c400 = baseColor; // Main
    const c500 = darkenColor(baseColor, 10);
    const c600 = darkenColor(baseColor, 20);
    const c700 = darkenColor(baseColor, 30);
    const c800 = darkenColor(baseColor, 40);
    const c900 = darkenColor(baseColor, 50);

    // Apply CSS Variables to Root
    const root = document.documentElement;
    root.style.setProperty('--app-font-scale', `${effectiveFontScale}`);
    root.style.setProperty('--theme-50', hexToRgbValues(c50));
    root.style.setProperty('--theme-100', hexToRgbValues(c100));
    root.style.setProperty('--theme-200', hexToRgbValues(c200));
    root.style.setProperty('--theme-300', hexToRgbValues(c300));
    root.style.setProperty('--theme-400', hexToRgbValues(c400));
    root.style.setProperty('--theme-500', hexToRgbValues(c500));
    root.style.setProperty('--theme-600', hexToRgbValues(c600));
    root.style.setProperty('--theme-700', hexToRgbValues(c700));
    root.style.setProperty('--theme-800', hexToRgbValues(c800));
    root.style.setProperty('--theme-900', hexToRgbValues(c900));

    // Update Neumorphic Highlight
    root.style.setProperty('--neu-highlight', isDarkMode ? c300 : c400);

  }, [appSettings.themeColor, appSettings.fontSizeScale, isDarkMode]);


  // Auto-Fetch / Check Connection on App Launch
  useEffect(() => {
    const checkConnection = async () => {
      if (!apiConfig.apiKey) return;
      try {
        const endpoint = apiConfig.endpoint.replace(/\/+$/, '');
        let response;
        if (apiConfig.provider === 'GEMINI') {
          response = await fetch(`${endpoint}/models?key=${apiConfig.apiKey}`);
        } else if (apiConfig.provider === 'CLAUDE') {
           response = await fetch(`${endpoint}/v1/models`, {
             headers: { 'x-api-key': apiConfig.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
          });
        } else {
          response = await fetch(`${endpoint}/models`, {
             headers: { 'Authorization': `Bearer ${apiConfig.apiKey}`, 'Content-Type': 'application/json' }
          });
        }
        if (response && response.ok) {
          showNotification('\u62c9\u53d6\u6a21\u578b\u6210\u529f', 'success');
        } else {
          showNotification('\u62c9\u53d6\u6a21\u578b\u5931\u8d25', 'error');
        }
      } catch (error) { 
        console.error("Auto-fetch failed", error);
        showNotification('\u62c9\u53d6\u6a21\u578b\u5931\u8d25', 'error');
      }
    };
    checkConnection();
  }, []); 

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ show: true, message, type });
    setTimeout(() => {
      setNotification(prev => ({ ...prev, show: false }));
    }, 3000);
  };

  useEffect(() => {
    return () => {
      if (viewTransitionTimerRef.current) window.clearTimeout(viewTransitionTimerRef.current);
      if (viewTransitionUnlockTimerRef.current) window.clearTimeout(viewTransitionUnlockTimerRef.current);
    };
  }, []);

  const transitionToView = (nextView: AppView, nextBook: Book | null = null) => {
    if (isViewTransitioning) return;
    if (nextView === currentView && nextView !== AppView.READER) return;

    setIsViewTransitioning(true);
    setViewAnimationClass('app-view-exit-right');

    if (viewTransitionTimerRef.current) window.clearTimeout(viewTransitionTimerRef.current);
    if (viewTransitionUnlockTimerRef.current) window.clearTimeout(viewTransitionUnlockTimerRef.current);

    viewTransitionTimerRef.current = window.setTimeout(() => {
      if (nextView === AppView.READER) {
        readingSessionStartedAtRef.current = Date.now();
      }
      setActiveBook(nextView === AppView.READER ? nextBook : null);
      setCurrentView(nextView);
      setViewAnimationClass('app-view-enter-left');

      viewTransitionUnlockTimerRef.current = window.setTimeout(() => {
        setIsViewTransitioning(false);
      }, VIEW_TRANSITION_MS);
    }, VIEW_TRANSITION_MS);
  };

  const handleOpenBook = (book: Book) => {
    const openedAt = Date.now();
    setBooks(prev =>
      prev.map(item =>
        item.id === book.id
          ? {
              ...item,
              lastReadAt: openedAt,
              lastRead: formatBookLastRead(openedAt),
            }
          : item
      )
    );
    transitionToView(AppView.READER, book);
  };

  const handleBackToLibrary = (snapshot?: ReaderSessionSnapshot) => {
    const closedAt = snapshot?.lastReadAt || Date.now();
    const openedAt = readingSessionStartedAtRef.current;
    if (openedAt && closedAt > openedAt) {
      const next = appendReadingDurationByDay(dailyReadingMsByDateRef.current, openedAt, closedAt);
      dailyReadingMsByDateRef.current = next;
      setDailyReadingMsByDate(next);
    }
    readingSessionStartedAtRef.current = null;

    if (snapshot) {
      setBooks(prev =>
        prev.map(book =>
          book.id === snapshot.bookId
            ? {
                ...book,
                progress: snapshot.progress,
                lastReadAt: snapshot.lastReadAt,
                lastRead: formatBookLastRead(snapshot.lastReadAt),
              }
            : book
        )
      );
    }
    transitionToView(AppView.LIBRARY);
  };

  const handleAddBook = async (newBook: Book) => {
    const fullText = newBook.fullText || '';
    const chapters = newBook.chapters || [];

    try {
      await saveBookContent(newBook.id, fullText, chapters);
      const compacted = compactBookForState({ ...newBook, fullText, chapters });
      setBooks(prev => [compacted, ...prev]);
      showNotification('成功导入');
    } catch (error) {
      console.error('Failed to persist new book content:', error);
      showNotification('Failed to save book content', 'error');
    }
  };

  const handleUpdateBook = async (updatedBook: Book) => {
    const fullText = updatedBook.fullText || '';
    const chapters = updatedBook.chapters || [];

    try {
      await saveBookContent(updatedBook.id, fullText, chapters);
      const compacted = compactBookForState({ ...updatedBook, fullText, chapters });
      setBooks(prev => prev.map(b => (b.id === updatedBook.id ? compacted : b)));
      showNotification('书本信息已更新');
    } catch (error) {
      console.error('Failed to persist updated book content:', error);
      showNotification('Failed to save changes', 'error');
    }
  };

  const handleDeleteBook = (bookId: string) => {
    const targetBook = books.find(b => b.id === bookId);
    if (targetBook?.coverUrl) {
      deleteImageByRef(targetBook.coverUrl).catch(err => console.error('Failed to delete deleted-book cover image:', err));
    }
    deleteBookContent(bookId).catch(err => console.error('Failed to delete deleted-book text content:', err));

    setBooks(prev => prev.filter(b => b.id !== bookId));
    showNotification('书本已删除');
  };

  const manualSafeAreaTop = Math.max(0, appSettings.safeAreaTop || 0);
  const manualSafeAreaBottom = Math.max(0, appSettings.safeAreaBottom || 0);
  const appWrapperClass = `relative flex flex-col h-full font-sans overflow-hidden transition-colors duration-300 ${isDarkMode ? 'dark-mode bg-[#2d3748] text-slate-200' : 'bg-[#e0e5ec] text-slate-600'}`;
  const appWrapperStyle: React.CSSProperties = {
    minHeight: 'var(--app-screen-height)',
    height: 'var(--app-screen-height)',
    paddingTop: `${manualSafeAreaTop}px`
  };

  // If in Reader mode
  if (currentView === AppView.READER) {
    return (
      <div 
        className={appWrapperClass}
        style={{ 
          ...appWrapperStyle,
          paddingBottom: `${manualSafeAreaBottom}px`
        }}
      >
        <div className={`flex-1 flex flex-col overflow-hidden ${viewAnimationClass}`}>
          <Reader onBack={handleBackToLibrary} isDarkMode={isDarkMode} activeBook={activeBook} />
        </div>
      </div>
    );
  }

  return (
    <div 
      className={appWrapperClass}
      style={appWrapperStyle}
    >
      
      {/* Global Notification */}
      <div
        className={`fixed left-1/2 -translate-x-1/2 z-50 transition-all duration-500 ease-out transform ${notification.show ? 'translate-y-0 opacity-100' : '-translate-y-20 opacity-0 pointer-events-none'}`}
        style={{ top: `${manualSafeAreaTop + 24}px` }}
      >
        <div className={`px-6 py-3 rounded-full flex items-center gap-3 border backdrop-blur-md ${isDarkMode ? 'bg-[#2d3748] text-slate-200 border-slate-700/70 shadow-[6px_6px_12px_#232b39,-6px_-6px_12px_#374357]' : 'bg-[#e0e5ec] text-slate-600 border-white/20 shadow-[6px_6px_12px_rgba(0,0,0,0.1),-6px_-6px_12px_rgba(255,255,255,0.8)]'}`}>
           {notification.type === 'success' ? <CheckCircle2 size={20} className="text-emerald-500" /> : <AlertCircle size={20} className="text-rose-500" />}
           <span className="font-bold text-sm">{notification.message}</span>
        </div>
      </div>

      {/* Main Content Area */}
      <div className={`flex-1 flex flex-col overflow-hidden relative ${viewAnimationClass}`}>
        {currentView === AppView.LIBRARY && (
          <Library 
            books={books}
            onOpenBook={handleOpenBook} 
            onAddBook={handleAddBook}
            onUpdateBook={handleUpdateBook}
            onDeleteBook={handleDeleteBook}
            isDarkMode={isDarkMode} 
            userSignature={userSignature}
            onUpdateSignature={setUserSignature}
            personas={personas}
            activePersonaId={activePersonaId}
            onSelectPersona={setActivePersonaId}
            characters={characters}
            activeCharacterId={activeCharacterId}
            onSelectCharacter={setActiveCharacterId}
            apiConfig={apiConfig}
          />
        )}
        {currentView === AppView.STATS && (
          <Stats
            isDarkMode={isDarkMode}
            dailyReadingMsByDate={dailyReadingMsByDate}
            themeColor={appSettings.themeColor}
          />
        )}
        {currentView === AppView.SETTINGS && (
          <Settings 
            isDarkMode={isDarkMode} 
            onToggleDarkMode={() => setIsDarkMode(!isDarkMode)} 
            
            // API
            apiConfig={apiConfig}
            setApiConfig={setApiConfig}
            apiPresets={apiPresets}
            setApiPresets={setApiPresets}

            // Global App Settings
            appSettings={appSettings}
            setAppSettings={setAppSettings}

            // Data
            personas={personas}
            setPersonas={setPersonas}
            characters={characters}
            setCharacters={setCharacters}
            worldBookEntries={worldBookEntries}
            setWorldBookEntries={setWorldBookEntries}
            wbCategories={wbCategories}
            setWbCategories={setWbCategories}
          />
        )}
      </div>

      {/* Bottom Navigation */}
      <nav 
        className="absolute left-0 right-0 z-40 px-6 pointer-events-none"
        style={{ bottom: `${manualSafeAreaBottom + 8}px` }}
      >
        <div className={`flex w-full justify-around items-center py-3 px-2 rounded-2xl pointer-events-auto ${isDarkMode ? 'bg-[#2d3748] shadow-[5px_5px_10px_#232b39,-5px_-5px_10px_#374357]' : 'neu-flat'}`}>
          <button 
            onClick={() => transitionToView(AppView.LIBRARY)}
            disabled={isViewTransitioning}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${currentView === AppView.LIBRARY ? 'text-rose-400 shadow-[inset_3px_3px_6px_rgba(0,0,0,0.2),inset_-3px_-3px_6px_rgba(255,255,255,0.1)]' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <LayoutGrid size={22} strokeWidth={currentView === AppView.LIBRARY ? 2.5 : 2} />
          </button>
          
          <button 
            onClick={() => transitionToView(AppView.STATS)}
            disabled={isViewTransitioning}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${currentView === AppView.STATS ? 'text-rose-400 shadow-[inset_3px_3px_6px_rgba(0,0,0,0.2),inset_-3px_-3px_6px_rgba(255,255,255,0.1)]' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <PieChart size={22} strokeWidth={currentView === AppView.STATS ? 2.5 : 2} />
          </button>

          <button 
            onClick={() => transitionToView(AppView.SETTINGS)}
            disabled={isViewTransitioning}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${currentView === AppView.SETTINGS ? 'text-rose-400 shadow-[inset_3px_3px_6px_rgba(0,0,0,0.2),inset_-3px_-3px_6px_rgba(255,255,255,0.1)]' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <SettingsIcon size={22} strokeWidth={currentView === AppView.SETTINGS ? 2.5 : 2} />
          </button>
        </div>
      </nav>
    </div>
  );
};

export default App;

