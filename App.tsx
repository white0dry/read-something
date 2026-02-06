import React, { useState, useEffect } from 'react';
import { BookOpen, PieChart, Settings as SettingsIcon, LayoutGrid, CheckCircle2, AlertCircle } from 'lucide-react';
import Library from './components/Library';
import Reader from './components/Reader';
import Stats from './components/Stats';
import Settings from './components/Settings';
import { AppView, Book, ApiConfig, ApiPreset, AppSettings } from './types';
import { Persona, Character, WorldBookEntry } from './components/settings/types';

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

const MOCK_BOOKS_INIT: Book[] = [
  { id: '1', title: '三体：黑暗森林', author: '刘慈欣', coverUrl: 'https://picsum.photos/150/220?random=1', progress: 45, lastRead: '2小时前', tags: ['科幻', '硬核', '必读'], chapters: [], fullText: '' },
  { id: '2', title: '百年孤独', author: '加西亚·马尔克斯', coverUrl: 'https://picsum.photos/150/220?random=2', progress: 12, lastRead: '昨天', tags: ['文学', '魔幻现实'], chapters: [], fullText: '' },
  { id: '3', title: '人类简史', author: '尤瓦尔·赫拉利', coverUrl: 'https://picsum.photos/150/220?random=3', progress: 88, lastRead: '3天前', tags: ['历史', '科普'], chapters: [], fullText: '' },
  { id: '4', title: '解忧杂货店', author: '东野圭吾', coverUrl: 'https://picsum.photos/150/220?random=4', progress: 0, lastRead: '', tags: ['小说', '治愈'], chapters: [], fullText: '' },
];

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

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<AppView>(AppView.LIBRARY);
  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('app_dark_mode');
      return saved ? JSON.parse(saved) : false;
    } catch { return false; }
  });
  
  // Global Notification State
  const [notification, setNotification] = useState<Notification>({ show: false, message: '', type: 'success' });

  // --- PERSISTENT STATE ---

  // Books
  const [books, setBooks] = useState<Book[]>(() => {
    try {
      const saved = localStorage.getItem('app_books');
      return saved ? JSON.parse(saved) : MOCK_BOOKS_INIT;
    } catch { return MOCK_BOOKS_INIT; }
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
      return saved ? JSON.parse(saved) : ['未分类'];
    } catch { return ['未分类']; }
  });

  // Library User Profile State
  const [userSignature, setUserSignature] = useState(() => {
    // Check for null strictly so we allow empty string as a valid signature
    const saved = localStorage.getItem('app_user_signature');
    return saved !== null ? saved : "黑夜无论怎样悠长 白昼总会到来";
  });
  
  const [activePersonaId, setActivePersonaId] = useState<string | null>(() => {
     return localStorage.getItem('app_active_persona_id') || null;
  });

  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(() => {
    return localStorage.getItem('app_active_character_id') || null;
  });

  // --- EFFECTS FOR PERSISTENCE ---

  useEffect(() => localStorage.setItem('app_dark_mode', JSON.stringify(isDarkMode)), [isDarkMode]);
  useEffect(() => localStorage.setItem('app_books', JSON.stringify(books)), [books]);
  useEffect(() => localStorage.setItem('app_api_config', JSON.stringify(apiConfig)), [apiConfig]);
  useEffect(() => localStorage.setItem('app_api_presets', JSON.stringify(apiPresets)), [apiPresets]);
  useEffect(() => localStorage.setItem('app_settings', JSON.stringify(appSettings)), [appSettings]);
  useEffect(() => localStorage.setItem('app_personas', JSON.stringify(personas)), [personas]);
  useEffect(() => localStorage.setItem('app_characters', JSON.stringify(characters)), [characters]);
  useEffect(() => localStorage.setItem('app_worldbook', JSON.stringify(worldBookEntries)), [worldBookEntries]);
  useEffect(() => localStorage.setItem('app_wb_categories', JSON.stringify(wbCategories)), [wbCategories]);
  
  // New persistence
  useEffect(() => localStorage.setItem('app_user_signature', userSignature), [userSignature]);
  useEffect(() => localStorage.setItem('app_active_persona_id', activePersonaId || ''), [activePersonaId]);
  useEffect(() => localStorage.setItem('app_active_character_id', activeCharacterId || ''), [activeCharacterId]);

  // --- THEME & FONT SIZE APPLICATION ---

  useEffect(() => {
    // Apply Font Size Global Scale
    document.documentElement.style.fontSize = `${appSettings.fontSizeScale * 90}%`;

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
        if (response && response.ok) showNotification('拉取模型成功', 'success');
      } catch (error) { 
        console.error("Auto-fetch failed", error);
        showNotification('拉取模型失败', 'error');
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

  const handleOpenBook = (book: Book) => {
    setActiveBook(book);
    setCurrentView(AppView.READER);
  };

  const handleBackToLibrary = () => {
    setActiveBook(null);
    setCurrentView(AppView.LIBRARY);
  };

  const handleAddBook = (newBook: Book) => {
    setBooks(prev => [newBook, ...prev]);
    showNotification('导入书籍成功');
  };

  const handleUpdateBook = (updatedBook: Book) => {
    setBooks(prev => prev.map(b => b.id === updatedBook.id ? updatedBook : b));
    showNotification('书籍信息已更新');
  };

  const handleDeleteBook = (bookId: string) => {
    setBooks(prev => prev.filter(b => b.id !== bookId));
    showNotification('书籍已删除');
  };

  const appWrapperClass = `flex flex-col h-full font-sans overflow-hidden transition-colors duration-300 ${isDarkMode ? 'dark-mode bg-[#2d3748] text-slate-200' : 'bg-[#e0e5ec] text-slate-600'}`;

  // If in Reader mode
  if (currentView === AppView.READER) {
    return (
      <div 
        className={appWrapperClass}
        style={{ 
          paddingTop: `${appSettings.safeAreaTop || 0}px`, 
          paddingBottom: `${appSettings.safeAreaBottom || 0}px` 
        }}
      >
        <Reader onBack={handleBackToLibrary} isDarkMode={isDarkMode} />
      </div>
    );
  }

  return (
    <div 
      className={appWrapperClass}
      style={{ 
        paddingTop: `${appSettings.safeAreaTop || 0}px`, 
        // We apply bottom padding to the main container to ensure content isn't hidden behind the floating nav
        paddingBottom: `${appSettings.safeAreaBottom || 0}px` 
      }}
    >
      
      {/* Global Notification */}
      <div 
        className={`fixed left-1/2 -translate-x-1/2 z-50 transition-all duration-500 ease-out transform ${notification.show ? 'translate-y-0 opacity-100' : '-translate-y-20 opacity-0 pointer-events-none'}`}
        style={{ top: `${(appSettings.safeAreaTop || 0) + 24}px` }}
      >
        <div className={`px-6 py-3 rounded-full flex items-center gap-3 shadow-[6px_6px_12px_rgba(0,0,0,0.1),-6px_-6px_12px_rgba(255,255,255,0.8)] border border-white/20 backdrop-blur-md ${isDarkMode ? 'bg-[#2d3748] text-slate-200 shadow-[5px_5px_10px_#232b39,-5px_-5px_10px_#374357]' : 'bg-[#e0e5ec] text-slate-600'}`}>
           {notification.type === 'success' ? <CheckCircle2 size={20} className="text-emerald-500" /> : <AlertCircle size={20} className="text-rose-500" />}
           <span className="font-bold text-sm">{notification.message}</span>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
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
        {currentView === AppView.STATS && <Stats isDarkMode={isDarkMode} />}
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
        className={`h-20 flex items-center justify-around absolute w-full z-40 pb-2 px-6 transition-colors ${isDarkMode ? 'bg-[#2d3748]' : 'bg-[#e0e5ec]'}`}
        style={{ bottom: `${appSettings.safeAreaBottom || 0}px` }}
      >
        <div className={`flex w-full justify-around items-center py-3 px-2 rounded-2xl ${isDarkMode ? 'bg-[#2d3748] shadow-[5px_5px_10px_#232b39,-5px_-5px_10px_#374357]' : 'neu-flat'}`}>
          <button 
            onClick={() => setCurrentView(AppView.LIBRARY)}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${currentView === AppView.LIBRARY ? 'text-rose-400 shadow-[inset_3px_3px_6px_rgba(0,0,0,0.2),inset_-3px_-3px_6px_rgba(255,255,255,0.1)]' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <LayoutGrid size={22} strokeWidth={currentView === AppView.LIBRARY ? 2.5 : 2} />
          </button>
          
          <button 
            onClick={() => setCurrentView(AppView.STATS)}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${currentView === AppView.STATS ? 'text-rose-400 shadow-[inset_3px_3px_6px_rgba(0,0,0,0.2),inset_-3px_-3px_6px_rgba(255,255,255,0.1)]' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <PieChart size={22} strokeWidth={currentView === AppView.STATS ? 2.5 : 2} />
          </button>

          <button 
            onClick={() => setCurrentView(AppView.SETTINGS)}
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