import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Settings as SettingsIcon, 
  Book, 
  ChevronRight, 
  Key, 
  HardDrive, 
  UserCircle,
  ArrowLeft,
  Download,
  Upload,
  Palette,
  Loader2,
  X,
  ImageIcon,
  Link as LinkIcon,
  Volume2,
  AlertTriangle
  } from 'lucide-react';
import { SettingsView, Persona, Character, WorldBookEntry, ThemeClasses, ApiConfig, ApiPreset, AppSettings, TtsConfig, TtsPreset } from './settings/types';
import { RagPreset } from '../types';
import PersonaSettings from './settings/PersonaSettings';
import CharacterSettings from './settings/CharacterSettings';
import WorldBookSettings from './settings/WorldBookSettings';
import AppearanceSettings from './settings/AppearanceSettings';
import ApiSettings from './settings/ApiSettings';
import TtsSettings from './settings/TtsSettings';
import ModalPortal from './ModalPortal';
import { deleteImageByRef, saveImageFile } from '../utils/imageStorage';
import {
  StorageCategoryKey,
  StorageAnalysisResult,
  analyzeAppStorageUsage,
  createAppArchivePayload,
  formatBytes,
  restoreAppArchivePayload,
} from '../utils/appArchive';
import {
  createVocabularyArchivePayload,
  restoreVocabularyArchivePayloadMerge,
} from '../utils/vocabularyArchive';

interface SettingsProps {
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  
  // Lifted States
  apiConfig: ApiConfig;
  setApiConfig: React.Dispatch<React.SetStateAction<ApiConfig>>;
  apiPresets: ApiPreset[];
  setApiPresets: React.Dispatch<React.SetStateAction<ApiPreset[]>>;
  
  appSettings: AppSettings;
  setAppSettings: React.Dispatch<React.SetStateAction<AppSettings>>;

  personas: Persona[];
  setPersonas: React.Dispatch<React.SetStateAction<Persona[]>>;
  characters: Character[];
  setCharacters: React.Dispatch<React.SetStateAction<Character[]>>;
  worldBookEntries: WorldBookEntry[];
  setWorldBookEntries: React.Dispatch<React.SetStateAction<WorldBookEntry[]>>;
  wbCategories: string[];
  setWbCategories: React.Dispatch<React.SetStateAction<string[]>>;
  ragPresets: RagPreset[];
  setRagPresets: React.Dispatch<React.SetStateAction<RagPreset[]>>;
  activeRagPresetId: string;
  setActiveRagPresetId: (id: string) => void;
  ttsConfig: TtsConfig;
  setTtsConfig: React.Dispatch<React.SetStateAction<TtsConfig>>;
  ttsPresets: TtsPreset[];
  setTtsPresets: React.Dispatch<React.SetStateAction<TtsPreset[]>>;
}

// Custom Feather Icon provided by user
const FeatherIcon = ({ size = 16, className = "" }: { size?: number, className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="currentColor" className={`bi bi-feather ${className}`} viewBox="0 0 16 16">
    <path d="M15.807.531c-.174-.177-.41-.289-.64-.363a3.8 3.8 0 0 0-.833-.15c-.62-.049-1.394 0-2.252.175C10.365.545 8.264 1.415 6.315 3.1S3.147 6.824 2.557 8.523c-.294.847-.44 1.634-.429 2.268.005.316.05.62.154.88q.025.061.056.122A68 68 0 0 0 .08 15.198a.53.53 0 0 0 .157.72.504.504 0 0 0 .705-.16 68 68 0 0 1 2.158-3.26c.285.141.616.195.958.182.513-.02 1.098-.188 1.723-.49 1.25-.605 2.744-1.787 4.303-3.642l1.518-1.55a.53.53 0 0 0 0-.739l-.729-.744 1.311.209a.5.5 0 0 0 .443-.15l.663-.684c.663-.68 1.292-1.325 1.763-1.892.314-.378.585-.752.754-1.107.163-.345.278-.773.112-1.188a.5.5 0 0 0-.112-.172M3.733 11.62C5.385 9.374 7.24 7.215 9.309 5.394l1.21 1.234-1.171 1.196-.027.03c-1.5 1.789-2.891 2.867-3.977 3.393-.544.263-.99.378-1.324.39a1.3 1.3 0 0 1-.287-.018Zm6.769-7.22c1.31-1.028 2.7-1.914 4.172-2.6a7 7 0 0 1-.4.523c-.442.533-1.028 1.134-1.681 1.804l-.51.524zm3.346-3.357C9.594 3.147 6.045 6.8 3.149 10.678c.007-.464.121-1.086.37-1.806.533-1.535 1.65-3.415 3.455-4.976 1.807-1.561 3.746-2.36 5.31-2.68a8 8 0 0 1 1.564-.173"/>
  </svg>
);

const parseHexColor = (hex: string) => {
  const raw = (hex || '').trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16),
  };
};

const toHexColor = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;

const blendHexColor = (
  baseHex: string,
  target: { r: number; g: number; b: number },
  ratio: number
) => {
  const base = parseHexColor(baseHex);
  if (!base) return baseHex;
  const t = Math.max(0, Math.min(1, ratio));
  return toHexColor(
    base.r + (target.r - base.r) * t,
    base.g + (target.g - base.g) * t,
    base.b + (target.b - base.b) * t
  );
};

const resolveStorageColorForMode = (hex: string, isDarkMode: boolean) => {
  if (!isDarkMode) return hex;
  const lifted = blendHexColor(hex, { r: 255, g: 255, b: 255 }, 0.2);
  return blendHexColor(lifted, { r: 88, g: 94, b: 109 }, 0.06);
};

const Settings: React.FC<SettingsProps> = ({ 
  isDarkMode, 
  onToggleDarkMode,
  apiConfig,
  setApiConfig,
  apiPresets,
  setApiPresets,
  appSettings,
  setAppSettings,
  personas,
  setPersonas,
  characters,
  setCharacters,
  worldBookEntries,
  setWorldBookEntries,
  wbCategories,
  setWbCategories,
  ragPresets,
  setRagPresets,
  activeRagPresetId,
  setActiveRagPresetId,
  ttsConfig,
  setTtsConfig,
  ttsPresets,
  setTtsPresets
}) => {
  const STORAGE_WARNING_TOTAL_USAGE_RATIO = 0.7;
  const STORAGE_WARNING_TOTAL_FALLBACK_BYTES = 300 * 1024 * 1024;
  const STORAGE_WARNING_CATEGORY_BYTES = 30 * 1024 * 1024;
  const STORAGE_WARNING_CATEGORY_RATIO = 0.35;

  const SETTINGS_VIEW_TRANSITION_MS = 260;
  const [currentView, setCurrentView] = useState<SettingsView>('MAIN');
  const [transitionAnimationClass, setTransitionAnimationClass] = useState('app-view-enter-left');
  const [isSwitchingView, setIsSwitchingView] = useState(false);
  
  // Avatar Selection Modal State
  const [avatarModal, setAvatarModal] = useState<{
    isOpen: boolean;
    targetId: string | null;
    targetType: 'PERSONA' | 'CHARACTER';
  }>({ isOpen: false, targetId: null, targetType: 'PERSONA' });
  const [urlInputMode, setUrlInputMode] = useState(false);
  const [tempUrl, setTempUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const archiveFileInputRef = useRef<HTMLInputElement>(null);
  const vocabularyArchiveFileInputRef = useRef<HTMLInputElement>(null);
  const viewTransitionTimerRef = useRef<number | null>(null);
  const viewTransitionUnlockTimerRef = useRef<number | null>(null);
  const storageDonutAnimRef = useRef<number | null>(null);
  const [storageAnalysis, setStorageAnalysis] = useState<StorageAnalysisResult | null>(null);
  const [storageAnalysisLoading, setStorageAnalysisLoading] = useState(false);
  const [storageAnalysisError, setStorageAnalysisError] = useState('');
  const [storageDonutReveal, setStorageDonutReveal] = useState(0);
  const [archiveExporting, setArchiveExporting] = useState(false);
  const [archiveImporting, setArchiveImporting] = useState(false);
  const [vocabularyArchiveExporting, setVocabularyArchiveExporting] = useState(false);
  const [vocabularyArchiveImporting, setVocabularyArchiveImporting] = useState(false);
  const [storageWarningKeys, setStorageWarningKeys] = useState<Set<StorageCategoryKey>>(new Set());
  const [hasStorageWarning, setHasStorageWarning] = useState(false);
  const [storageQuotaBytes, setStorageQuotaBytes] = useState<number | null>(null);

  // Theme Classes
  const theme: ThemeClasses = {
    containerClass: isDarkMode ? 'bg-[#2d3748] text-slate-200' : 'neu-bg text-slate-600',
    headingClass: isDarkMode ? 'text-slate-200' : 'text-slate-700',
    cardClass: isDarkMode ? 'bg-[#2d3748] shadow-[6px_6px_12px_#232b39,-6px_-6px_12px_#374357]' : 'neu-flat',
    pressedClass: isDarkMode ? 'bg-[#2d3748] shadow-[inset_3px_3px_6px_#232b39,inset_-3px_-3px_6px_#374357]' : 'neu-pressed',
    sectionIconClass: `w-12 h-12 rounded-full flex items-center justify-center ${isDarkMode ? 'bg-[#2d3748] shadow-[inset_3px_3px_6px_#232b39,inset_-3px_-3px_6px_#374357]' : 'neu-pressed'}`,
    inputClass: isDarkMode ? 'bg-[#2d3748] shadow-[inset_3px_3px_6px_#232b39,inset_-3px_-3px_6px_#374357] text-slate-200 placeholder-slate-500' : 'neu-pressed text-slate-600 placeholder-slate-400',
    btnClass: isDarkMode ? 'bg-[#2d3748] shadow-[5px_5px_10px_#232b39,-5px_-5px_10px_#374357] text-slate-200' : 'neu-btn',
    activeBorderClass: 'border-2 border-rose-300 relative z-20',
    baseBorderClass: 'border-2 border-transparent relative z-0',
    animationClass: transitionAnimationClass,
    isDarkMode
  };

  const { containerClass, animationClass, cardClass, headingClass, pressedClass, sectionIconClass, inputClass, btnClass } = theme;

  // --- Helpers ---
  useEffect(() => {
    return () => {
      if (viewTransitionTimerRef.current) window.clearTimeout(viewTransitionTimerRef.current);
      if (viewTransitionUnlockTimerRef.current) window.clearTimeout(viewTransitionUnlockTimerRef.current);
      if (storageDonutAnimRef.current) window.cancelAnimationFrame(storageDonutAnimRef.current);
    };
  }, []);

  const switchView = (view: SettingsView) => {
    if (isSwitchingView || view === currentView) return;

    setIsSwitchingView(true);
    setTransitionAnimationClass('app-view-exit-right');

    if (viewTransitionTimerRef.current) window.clearTimeout(viewTransitionTimerRef.current);
    if (viewTransitionUnlockTimerRef.current) window.clearTimeout(viewTransitionUnlockTimerRef.current);

    viewTransitionTimerRef.current = window.setTimeout(() => {
      setCurrentView(view);
      setTransitionAnimationClass('app-view-enter-left');
      viewTransitionUnlockTimerRef.current = window.setTimeout(() => {
        setIsSwitchingView(false);
      }, SETTINGS_VIEW_TRANSITION_MS);
    }, SETTINGS_VIEW_TRANSITION_MS);
  };

  const navigateTo = (view: SettingsView) => {
    switchView(view);
  };

  const goBack = (toView: SettingsView = 'MAIN') => {
    switchView(toView);
  };
  
  const renderHeader = (title: string, onBack?: () => void) => (
    <header className="mb-6 pt-2 flex items-center gap-4">
      {onBack && (
        <button onClick={onBack} className={`w-10 h-10 rounded-full flex items-center justify-center hover:text-rose-400 transition-colors active:scale-95 ${btnClass}`}>
          <ArrowLeft size={20} />
        </button>
      )}
      <h1 className={`text-2xl font-bold ${headingClass}`}>{title}</h1>
    </header>
  );

  const renderToggle = (isActive: boolean, onToggle: () => void) => (
      <button 
        onClick={onToggle}
        className={`w-14 h-8 rounded-full p-1 flex items-center transition-all ${pressedClass}`}
      >
        <div className={`w-6 h-6 rounded-full shadow-sm flex items-center justify-center transition-all transform duration-300 ${isActive ? 'translate-x-6 bg-rose-400' : 'translate-x-0 bg-slate-400'}`}>
        </div>
      </button>
  );

  const updateSetting = (field: keyof AppSettings, value: any) => {
    setAppSettings(prev => ({ ...prev, [field]: value }));
  };

  const analyzeStorageWarnings = (
    analysis: StorageAnalysisResult,
    quotaBytes: number | null,
  ): { hasWarning: boolean; keys: Set<StorageCategoryKey> } => {
    const warningKeys = new Set<StorageCategoryKey>();
    const totalBytes = Math.max(0, Number(analysis.totalBytes || 0));
    const totalByRatio = Number.isFinite(Number(quotaBytes || 0)) && Number(quotaBytes) > 0
      ? totalBytes / Number(quotaBytes)
      : 0;
    const hasTotalWarning = totalBytes >= STORAGE_WARNING_TOTAL_FALLBACK_BYTES
      || totalByRatio >= STORAGE_WARNING_TOTAL_USAGE_RATIO;

    analysis.items.forEach((item) => {
      const ratio = totalBytes > 0 ? item.bytes / totalBytes : 0;
      if (item.bytes >= STORAGE_WARNING_CATEGORY_BYTES && ratio >= STORAGE_WARNING_CATEGORY_RATIO) {
        warningKeys.add(item.key);
      }
    });

    return {
      hasWarning: hasTotalWarning || warningKeys.size > 0,
      keys: warningKeys,
    };
  };

  const resolveStorageQuotaBytes = async (): Promise<number | null> => {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    try {
      const estimate = await navigator.storage.estimate();
      const quota = Number(estimate?.quota || 0);
      if (!Number.isFinite(quota) || quota <= 0) return null;
      return quota;
    } catch {
      return null;
    }
  };

  const refreshStorageAnalysis = async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    if (!silent) {
      setStorageAnalysisLoading(true);
      setStorageAnalysisError('');
      setStorageDonutReveal(0);
      setStorageAnalysis(null);
    }
    try {
      const [analysis, quota] = await Promise.all([
        analyzeAppStorageUsage(),
        resolveStorageQuotaBytes(),
      ]);
      setStorageAnalysis(analysis);
      setStorageQuotaBytes(quota);
      const warning = analyzeStorageWarnings(analysis, quota);
      setStorageWarningKeys(warning.keys);
      setHasStorageWarning(warning.hasWarning);
    } catch (error) {
      console.error('Failed to analyze storage usage:', error);
      if (!silent) {
        setStorageAnalysisError('存储分析失败，请稍后重试');
      }
    } finally {
      if (!silent) {
        setStorageAnalysisLoading(false);
      }
    }
  };

  useEffect(() => {
    if (currentView !== 'STORAGE') return;
    void refreshStorageAnalysis();
  }, [currentView]);

  useEffect(() => {
    void refreshStorageAnalysis({ silent: true });
  }, []);

  useEffect(() => {
    if (storageDonutAnimRef.current) {
      window.cancelAnimationFrame(storageDonutAnimRef.current);
      storageDonutAnimRef.current = null;
    }

    if (currentView !== 'STORAGE' || storageAnalysisLoading || !storageAnalysis) {
      setStorageDonutReveal(0);
      return;
    }

    setStorageDonutReveal(0);
    const durationMs = 820;
    let startedAt = 0;
    const tick = (now: number) => {
      if (!startedAt) startedAt = now;
      const progress = Math.max(0, Math.min(1, (now - startedAt) / durationMs));
      const eased = 1 - (1 - progress) ** 3;
      setStorageDonutReveal(eased);
      if (progress < 1) {
        storageDonutAnimRef.current = window.requestAnimationFrame(tick);
      } else {
        storageDonutAnimRef.current = null;
      }
    };

    storageDonutAnimRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (storageDonutAnimRef.current) {
        window.cancelAnimationFrame(storageDonutAnimRef.current);
        storageDonutAnimRef.current = null;
      }
    };
  }, [currentView, storageAnalysisLoading, storageAnalysis?.generatedAt]);

  const handleExportArchive = async () => {
    if (archiveExporting || archiveImporting || vocabularyArchiveExporting || vocabularyArchiveImporting) return;
    setArchiveExporting(true);
    try {
      const EXPORT_TIMEOUT = 120_000;
      const payloadPromise = createAppArchivePayload();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('导出超时，数据量可能过大')), EXPORT_TIMEOUT)
      );
      const payload = await Promise.race([payloadPromise, timeoutPromise]);
      const json = JSON.stringify(payload);
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const date = new Date();
      const pad = (value: number) => `${value}`.padStart(2, '0');
      const fileName = `读点书-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.json`;

      if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [new File([], '')] })) {
        const file = new File([blob], fileName, { type: blob.type });
        try {
          await navigator.share({ files: [file] });
          return;
        } catch {
          /* user cancelled or not supported, fall through to anchor */
        }
      }

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      console.error('Failed to export archive:', error);
      alert(error instanceof Error ? `导出失败：${error.message}` : '导出失败，请稍后重试。');
    } finally {
      setArchiveExporting(false);
    }
  };

  const handleImportArchive = () => {
    if (archiveExporting || archiveImporting || vocabularyArchiveExporting || vocabularyArchiveImporting) return;
    archiveFileInputRef.current?.click();
  };

  const handleImportArchiveFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const confirmed = window.confirm('导入将覆盖当前设备上所有本地存档数据，确定继续吗？');
    if (!confirmed) return;

    setArchiveImporting(true);
    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText);
      await restoreAppArchivePayload(parsed);
      alert('导入成功，应用即将刷新。');
      window.location.reload();
    } catch (error) {
      console.error('Failed to import archive:', error);
      const message = error instanceof Error ? error.message : '未知错误';
      alert(`导入失败：${message}`);
    } finally {
      setArchiveImporting(false);
    }
  };

  const exportVocabularyArchiveAsFile = async (): Promise<void> => {
    const payload = await createVocabularyArchivePayload();
    const json = JSON.stringify(payload);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const date = new Date();
    const pad = (value: number) => `${value}`.padStart(2, '0');
    const fileName = `读点书-词库-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.json`;

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleExportVocabularyArchive = async () => {
    if (archiveExporting || archiveImporting || vocabularyArchiveExporting || vocabularyArchiveImporting) return;
    setVocabularyArchiveExporting(true);
    try {
      await exportVocabularyArchiveAsFile();
    } catch (error) {
      console.error('Failed to export vocabulary archive:', error);
      alert(error instanceof Error ? `导出失败：${error.message}` : '导出失败，请稍后重试。');
    } finally {
      setVocabularyArchiveExporting(false);
    }
  };

  const handleImportVocabularyArchive = () => {
    if (archiveExporting || archiveImporting || vocabularyArchiveExporting || vocabularyArchiveImporting) return;
    vocabularyArchiveFileInputRef.current?.click();
  };

  const handleImportVocabularyArchiveFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const confirmed = window.confirm('导入将按“合并去重”写入生词本与词库，确定继续吗？');
    if (!confirmed) return;

    setVocabularyArchiveImporting(true);
    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText);
      await restoreVocabularyArchivePayloadMerge(parsed);
      alert('词库导入成功，页面将刷新以同步最新数据。');
      window.location.reload();
    } catch (error) {
      console.error('Failed to import vocabulary archive:', error);
      const message = error instanceof Error ? error.message : '未知错误';
      alert(`导入失败：${message}`);
    } finally {
      setVocabularyArchiveImporting(false);
    }
  };

  // --- Avatar Handlers ---
  const openAvatarModal = (id: string, type: 'PERSONA' | 'CHARACTER') => {
    setAvatarModal({ isOpen: true, targetId: id, targetType: type });
    setUrlInputMode(false);
    setTempUrl('');
  };

  const closeAvatarModal = () => {
    setAvatarModal({ ...avatarModal, isOpen: false });
  };

  const updateAvatar = (imageUrl: string) => {
    if (!avatarModal.targetId) return;

    const previousAvatar =
      avatarModal.targetType === 'PERSONA'
        ? personas.find(p => p.id === avatarModal.targetId)?.avatar
        : characters.find(c => c.id === avatarModal.targetId)?.avatar;

    if (avatarModal.targetType === 'PERSONA') {
      setPersonas(prev => prev.map(p => p.id === avatarModal.targetId ? { ...p, avatar: imageUrl } : p));
    } else {
      setCharacters(prev => prev.map(c => c.id === avatarModal.targetId ? { ...c, avatar: imageUrl } : c));
    }

    if (previousAvatar && previousAvatar !== imageUrl) {
      deleteImageByRef(previousAvatar).catch(err => console.error('Failed to delete old avatar image:', err));
    }

    closeAvatarModal();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const imageRef = await saveImageFile(file);
        updateAvatar(imageRef);
      } catch (error) {
        console.error('Failed to save avatar image:', error);
        alert('图片保存失败，请重试或改用网络链接。');
      } finally {
        e.target.value = '';
      }
    }
  };

  const renderAvatarModal = () => {
    if (!avatarModal.isOpen) return null;
    return (
      <ModalPortal>
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-500/20 backdrop-blur-sm animate-fade-in">
        <div className={`${isDarkMode ? 'bg-[#2d3748] border-slate-600' : 'neu-bg border-white/50'} w-full max-w-sm rounded-2xl p-6 shadow-2xl border relative`}>
          <button onClick={closeAvatarModal} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
          
          <h3 className={`text-lg font-bold mb-6 text-center ${headingClass}`}>更换头像</h3>

          {!urlInputMode ? (
            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className={`${cardClass} aspect-square flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-rose-400 active:scale-95 transition-all rounded-2xl`}
              >
                <ImageIcon size={32} />
                <span className="text-sm font-medium">本地上传</span>
              </button>
              <button 
                onClick={() => setUrlInputMode(true)}
                className={`${cardClass} aspect-square flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-rose-400 active:scale-95 transition-all rounded-2xl`}
              >
                <LinkIcon size={32} />
                <span className="text-sm font-medium">网络链接</span>
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="image/*"
                onChange={handleFileSelect}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4 app-view-enter-left">
              <input 
                type="text" 
                value={tempUrl}
                onChange={(e) => setTempUrl(e.target.value)}
                placeholder="https://example.com/image.png"
                className={`w-full p-4 rounded-xl text-sm outline-none ${inputClass}`}
              />
              <div className="flex gap-3 mt-2">
                <button onClick={() => setUrlInputMode(false)} className={`flex-1 py-3 rounded-full text-slate-500 text-sm font-bold ${btnClass}`}>
                  返回
                </button>
                <button 
                  onClick={() => updateAvatar(tempUrl)}
                  disabled={!tempUrl.trim()}
                  className={`flex-1 py-3 rounded-full text-rose-400 text-sm font-bold disabled:opacity-50 ${btnClass}`}
                >
                  确认
                </button>
              </div>
            </div>
          )}
        </div>
        </div>
      </ModalPortal>
    );
  };

  const storageTotalBytes = storageAnalysis?.totalBytes || 0;
  const storageLegendItems = useMemo(() => {
    if (currentView !== 'STORAGE' || storageAnalysisLoading || !storageAnalysis) {
      return [];
    }
    const source = storageAnalysis?.items || [];
    return source.map((item) => ({
      ...item,
      color: resolveStorageColorForMode(item.color, isDarkMode),
    }));
  }, [currentView, storageAnalysisLoading, storageAnalysis, isDarkMode]);
  const storageDonutGradient = useMemo(() => {
    const fallbackColor = isDarkMode ? '#4B5563' : '#CBD5E1';
    if (storageTotalBytes <= 0 || storageLegendItems.length === 0) {
      return `conic-gradient(from -90deg, ${fallbackColor} 0deg 360deg)`;
    }

    const revealAngle = Math.max(0, Math.min(360, 360 * storageDonutReveal));
    let cursor = 0;
    const segments: string[] = [];

    storageLegendItems
      .filter((item) => item.bytes > 0)
      .forEach((item) => {
        if (cursor >= revealAngle) return;
        const start = cursor;
        const sweep = (item.bytes / storageTotalBytes) * 360;
        cursor = Math.min(360, cursor + sweep);
        const visibleEnd = Math.min(cursor, revealAngle);
        if (visibleEnd > start) {
          segments.push(`${item.color} ${start}deg ${visibleEnd}deg`);
        }
      });

    if (revealAngle < 360) {
      segments.push(`${fallbackColor} ${revealAngle}deg 360deg`);
    }
    if (segments.length === 0) {
      return `conic-gradient(from -90deg, ${fallbackColor} 0deg 360deg)`;
    }
    return `conic-gradient(from -90deg, ${segments.join(', ')})`;
  }, [isDarkMode, storageLegendItems, storageTotalBytes, storageDonutReveal]);
  const storageLegendCardClass = isDarkMode
    ? 'bg-[#2d3748] shadow-[5px_5px_10px_#232b39,-5px_-5px_10px_#374357]'
    : 'bg-[#e0e5ec] shadow-[5px_5px_10px_#a3b1c6,-5px_-5px_10px_#ffffff]';

  // --- Render Sub-Menus ---
  
  if (currentView === 'PERSONA') {
    return (
      <>
        <PersonaSettings 
          personas={personas} 
          setPersonas={setPersonas} 
          characters={characters} 
          theme={theme} 
          onBack={() => goBack()} 
          onOpenAvatarModal={openAvatarModal}
        />
        {renderAvatarModal()}
      </>
    );
  }

  if (currentView === 'CHARACTER') {
    return (
      <>
        <CharacterSettings
          characters={characters}
          setCharacters={setCharacters}
          personas={personas}
          wbCategories={wbCategories}
          setWbCategories={setWbCategories}
          worldBookEntries={worldBookEntries}
          setWorldBookEntries={setWorldBookEntries}
          theme={theme}
          onBack={() => goBack()}
          onOpenAvatarModal={openAvatarModal}
        />
        {renderAvatarModal()}
      </>
    );
  }

  if (currentView === 'WORLDBOOK') {
    return (
      <WorldBookSettings 
        wbCategories={wbCategories}
        setWbCategories={setWbCategories}
        worldBookEntries={worldBookEntries}
        setWorldBookEntries={setWorldBookEntries}
        theme={theme}
        onBack={() => goBack()}
      />
    );
  }

  if (currentView === 'API') {
    return (
      <ApiSettings
        config={apiConfig}
        setConfig={setApiConfig}
        presets={apiPresets}
        setPresets={setApiPresets}
        theme={theme}
        onBack={() => goBack()}
        ragPresets={ragPresets}
        setRagPresets={setRagPresets}
        activeRagPresetId={activeRagPresetId}
        setActiveRagPresetId={setActiveRagPresetId}
      />
    );
  }

  if (currentView === 'APPEARANCE') {
    return (
      <AppearanceSettings 
        isDarkMode={isDarkMode}
        onToggleDarkMode={onToggleDarkMode}
        settings={appSettings}
        setSettings={setAppSettings}
        theme={theme}
        onBack={() => goBack()}
      />
    );
  }

  if (currentView === 'TTS') {
    return (
      <div key="TTS" className={`flex-1 flex flex-col p-6 pb-28 overflow-y-auto no-scrollbar relative ${containerClass} ${animationClass}`}>
        <TtsSettings
          config={ttsConfig}
          setConfig={setTtsConfig}
          presets={ttsPresets}
          setPresets={setTtsPresets}
          theme={{
            containerClass: theme.containerClass,
            headingClass: theme.headingClass,
            cardClass: theme.cardClass,
            pressedClass: theme.pressedClass,
            inputClass: theme.inputClass,
            btnClass: theme.btnClass,
            activeBorderClass: theme.activeBorderClass,
            baseBorderClass: theme.baseBorderClass,
            isDarkMode,
          }}
          onBack={() => goBack()}
        />
      </div>
    );
  }

  if (currentView === 'STORAGE') {
    return (
      <div key="STORAGE" className={`flex-1 flex flex-col p-6 pb-28 overflow-y-auto no-scrollbar relative ${containerClass} ${animationClass}`}>
        {renderHeader("存储分析", () => goBack())}
        <div className={`${cardClass} p-5 rounded-2xl`}>
          {storageAnalysisLoading && (
            <div className="flex items-center justify-end mb-2">
              <div className="h-9 px-3 rounded-full text-xs font-bold flex items-center gap-1.5 text-slate-500">
                <Loader2 size={13} className="animate-spin" />
                分析中...
              </div>
            </div>
          )}

          {storageAnalysisError && (
            <div className={`mb-4 rounded-xl p-3 text-xs ${pressedClass}`}>
              {storageAnalysisError}
            </div>
          )}

          <div className="flex flex-col items-center">
            <div className={`relative w-48 h-48 rounded-full ${pressedClass} p-4`}>
              <div
                className="w-full h-full rounded-full"
                style={{ background: storageDonutGradient }}
              />
              <div className={`absolute inset-[34px] rounded-full flex flex-col items-center justify-center ${pressedClass}`}>
                <div className={`text-[11px] uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>总占用</div>
                <div className={`text-lg font-black ${headingClass}`}>{formatBytes(storageTotalBytes)}</div>
                {storageQuotaBytes && storageQuotaBytes > 0 && (
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {Math.min(100, Math.max(0, (storageTotalBytes / storageQuotaBytes) * 100)).toFixed(1)}%
                  </div>
                )}
              </div>
            </div>
            {hasStorageWarning && (
              <div className="mt-3 h-7 px-3 rounded-full text-[11px] font-semibold flex items-center gap-1.5 text-amber-500 bg-amber-100/30 dark:bg-amber-400/10">
                <AlertTriangle size={12} />
                存储偏高，建议备份
              </div>
            )}
          </div>

          <div className="mt-5 space-y-2">
            {storageLegendItems.map((item) => (
              <div key={item.key} className={`rounded-xl px-3 py-2 flex items-center justify-between ${storageLegendCardClass}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                  <span className={`text-sm font-bold truncate ${headingClass}`}>{item.label}</span>
                  {storageWarningKeys.has(item.key) && (
                    <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] bg-amber-100/80 text-amber-600 dark:bg-amber-400/20 dark:text-amber-300">
                      !
                    </span>
                  )}
                </div>
                <div className="text-right ml-3">
                  <div className={`text-xs font-semibold ${headingClass}`}>{formatBytes(item.bytes)}</div>
                  <div className="text-[11px] text-slate-500">{item.percentage.toFixed(1)}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (currentView !== 'MAIN') {
     return (
        <div key={currentView} className={`flex-1 flex flex-col p-6 pb-28 overflow-y-auto no-scrollbar relative ${containerClass} ${animationClass}`}>
          {renderHeader("设置详情", () => goBack())}
          <div className={`${cardClass} p-8 text-center text-slate-400 rounded-2xl`}>
            <p>功能开发中...</p>
          </div>
        </div>
     );
  }

  // --- Main Settings View ---
  return (
    <div key="MAIN" className={`flex-1 flex flex-col p-6 pb-28 overflow-y-auto no-scrollbar relative ${containerClass} ${animationClass}`}>
      {renderHeader("设置")}

      {/* AI Companion Settings (Peidu) */}
      <section className="mb-8">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 px-1">陪读</h2>
        <div className={`${cardClass} p-2 flex flex-col gap-2 rounded-2xl`}>
           {/* User Persona */}
           <div 
             onClick={() => navigateTo('PERSONA')}
             className="p-3 rounded-xl flex items-center justify-between cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.98] transition-all"
           >
             <div className="flex items-center gap-4">
               <div className={`${sectionIconClass} text-rose-400`}>
                 <UserCircle size={22} />
               </div>
                <div>
                  <div className={`font-bold ${headingClass}`}>管理用户人设</div>
                  <div className="text-xs text-slate-500">已设置 {personas.length} 个</div>
                </div>
             </div>
             <div className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 ${isDarkMode ? cardClass : 'neu-flat'}`}>
                <ChevronRight size={16} />
             </div>
          </div>

          <div className="w-full h-[1px] bg-slate-300/20 mx-2" />

          {/* AI Character */}
          <div 
             onClick={() => navigateTo('CHARACTER')}
             className="p-3 rounded-xl flex items-center justify-between cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.98] transition-all"
          >
             <div className="flex items-center gap-4">
               <div className={`${sectionIconClass} text-rose-400`}>
                 <FeatherIcon size={22} />
               </div>
                <div>
                  <div className={`font-bold ${headingClass}`}>管理角色</div>
                  <div className="text-xs text-slate-500">已设置 {characters.length} 个</div>
                </div>
             </div>
             <div className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 ${isDarkMode ? cardClass : 'neu-flat'}`}>
                <ChevronRight size={16} />
             </div>
          </div>
          
          <div className="w-full h-[1px] bg-slate-300/20 mx-2" />

          {/* World Book */}
          <div 
             onClick={() => navigateTo('WORLDBOOK')}
             className="p-3 rounded-xl flex items-center justify-between cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.98] transition-all"
          >
             <div className="flex items-center gap-4">
               <div className={`${sectionIconClass} text-rose-400`}>
                 <Book size={22} />
               </div>
                <div>
                  <div className={`font-bold ${headingClass}`}>世界书</div>
                  <div className="text-xs text-slate-500">已收录 {worldBookEntries.length} 条设定</div>
                </div>
             </div>
             <div className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 ${isDarkMode ? cardClass : 'neu-flat'}`}>
                <ChevronRight size={16} />
             </div>
          </div>

          <div className="w-full h-[1px] bg-slate-300/20 mx-2" />

          {/* AI Proactive Underline Toggle & Config */}
          <div className="p-3">
             <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-bold ml-2 ${headingClass}`}>主动高亮内容</span>
                {renderToggle(
                  appSettings.aiProactiveUnderlineEnabled,
                  () => updateSetting('aiProactiveUnderlineEnabled', !appSettings.aiProactiveUnderlineEnabled)
                )}
             </div>

             <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${appSettings.aiProactiveUnderlineEnabled ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                <div className="overflow-hidden">
                  <div className="mt-4 pl-4 pr-2 pb-4">
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <div className="flex justify-between text-xs text-slate-500 mb-2 font-medium">
                          <span>高亮触发概率 (%)</span>
                        </div>
                        <div className="relative h-2 w-full">
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={appSettings.aiProactiveUnderlineProbability}
                            onChange={(e) => updateSetting('aiProactiveUnderlineProbability', parseInt(e.target.value))}
                            className="app-range absolute top-1/2 -translate-y-1/2 left-0 w-full h-5 bg-transparent appearance-none cursor-pointer z-10"
                          />
                          <div className={`absolute top-0 left-0 h-full rounded-lg w-full ${isDarkMode ? 'bg-slate-700' : 'bg-black/5'}`} />
                          <div
                            className="absolute top-0 left-0 h-full bg-rose-300 rounded-lg pointer-events-none"
                            style={{ width: `${appSettings.aiProactiveUnderlineProbability}%` }}
                          />
                        </div>
                      </div>
                      <input
                        type="number"
                        value={appSettings.aiProactiveUnderlineProbability}
                        onChange={(e) => {
                          const val = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                          updateSetting('aiProactiveUnderlineProbability', val);
                        }}
                        className={`w-16 h-8 text-center text-xs rounded-lg outline-none ${inputClass} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                      />
                    </div>
                  </div>
                </div>
             </div>
          </div>

          <div className="w-full h-[1px] bg-slate-300/20 mx-2" />

          {/* Active Comments Toggle & Config */}
          <div className="p-3">
             <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                   <span className={`text-sm font-bold ml-2 ${headingClass}`}>主动发送消息</span>
                </div>
                {renderToggle(appSettings.activeCommentsEnabled, () => updateSetting('activeCommentsEnabled', !appSettings.activeCommentsEnabled))}
             </div>

             <div className="flex items-center justify-between mt-3 mb-2 pl-2">
                <div className="flex flex-col">
                  <span className={`text-sm font-bold ${headingClass}`}>主动更新便签</span>
                  <span className="text-[11px] text-slate-500">每天抽签 3 次，命中后由角色更新便签</span>
                </div>
                {renderToggle(
                  appSettings.activeSignatureUpdateEnabled,
                  () => updateSetting('activeSignatureUpdateEnabled', !appSettings.activeSignatureUpdateEnabled)
                )}
             </div>
             
             {/* Active Comment Settings Expansion */}
             <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${appSettings.activeCommentsEnabled ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                <div className="overflow-hidden">
                   <div className="mt-4 pl-4 pr-2 space-y-5 pb-6">
                      <div className="flex items-center gap-4">
                        <div className="flex-1">
                          <div className="flex justify-between text-xs text-slate-500 mb-2 font-medium">
                            <span>检测间隔(秒)</span>
                          </div>
                          <div className="relative h-2 w-full">
                            <input 
                              type="range" 
                              min="10" 
                              max="600" 
                              value={appSettings.commentInterval} 
                              onChange={(e) => updateSetting('commentInterval', parseInt(e.target.value))}
                              className="app-range absolute top-1/2 -translate-y-1/2 left-0 w-full h-5 bg-transparent appearance-none cursor-pointer z-10"
                            />
                            <div className={`absolute top-0 left-0 h-full rounded-lg w-full ${isDarkMode ? 'bg-slate-700' : 'bg-black/5'}`} />
                            <div className="absolute top-0 left-0 h-full bg-rose-300 rounded-lg pointer-events-none" style={{width: `${(appSettings.commentInterval - 10) / (600 - 10) * 100}%`}} />
                          </div>
                        </div>
                        <input 
                          type="number" 
                          value={appSettings.commentInterval}
                          onChange={(e) => {
                            const val = Math.min(600, Math.max(10, parseInt(e.target.value) || 0));
                            updateSetting('commentInterval', val);
                          }}
                          className={`w-16 h-8 text-center text-xs rounded-lg outline-none ${inputClass} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`} 
                        />
                      </div>
                      
                      <div className="flex items-center gap-4">
                        <div className="flex-1">
                          <div className="flex justify-between text-xs text-slate-500 mb-2 font-medium">
                            <span>触发概率 (%)</span>
                          </div>
                          <div className="relative h-2 w-full">
                            <input 
                              type="range" 
                              min="0" 
                              max="100" 
                              value={appSettings.commentProbability} 
                              onChange={(e) => updateSetting('commentProbability', parseInt(e.target.value))}
                              className="app-range absolute top-1/2 -translate-y-1/2 left-0 w-full h-5 bg-transparent appearance-none cursor-pointer z-10"
                            />
                            <div className={`absolute top-0 left-0 h-full rounded-lg w-full ${isDarkMode ? 'bg-slate-700' : 'bg-black/5'}`} />
                            <div className="absolute top-0 left-0 h-full bg-rose-300 rounded-lg pointer-events-none" style={{width: `${appSettings.commentProbability}%`}} />
                          </div>
                        </div>
                        <input 
                          type="number" 
                          value={appSettings.commentProbability}
                          onChange={(e) => {
                             const val = Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                             updateSetting('commentProbability', val);
                          }}
                          className={`w-16 h-8 text-center text-xs rounded-lg outline-none ${inputClass} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`} 
                        />
                      </div>
                   </div>
                </div>
             </div>
          </div>
        </div>
      </section>

      {/* General Settings */}
      <section>
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 px-1">通用</h2>
        <div className={`${cardClass} p-2 flex flex-col gap-2 rounded-2xl`}>
           {/* API Config */}
           <div 
              onClick={() => navigateTo('API')}
              className="p-3 rounded-xl flex items-center justify-between cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.98] transition-all"
           >
              <div className="flex items-center gap-4">
                <div className={`${sectionIconClass} text-blue-400`}>
                  <Key size={22} />
                </div>
                <span className={`font-bold ${headingClass}`}>API 配置</span>
              </div>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 ${isDarkMode ? cardClass : 'neu-flat'}`}>
                <ChevronRight size={16} />
              </div>
           </div>

           <div className="w-full h-[1px] bg-slate-300/20 mx-2" />

           {/* TTS Voice */}
           <div
              onClick={() => navigateTo('TTS')}
              className="p-3 rounded-xl flex items-center justify-between cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.98] transition-all"
           >
              <div className="flex items-center gap-4">
                <div className={`${sectionIconClass} text-blue-400`}>
                  <Volume2 size={22} />
                </div>
                <span className={`font-bold ${headingClass}`}>TTS 语音</span>
              </div>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 ${isDarkMode ? cardClass : 'neu-flat'}`}>
                <ChevronRight size={16} />
              </div>
           </div>

           <div className="w-full h-[1px] bg-slate-300/20 mx-2" />

           {/* Storage Analysis */}
           <div 
              onClick={() => navigateTo('STORAGE')}
              className="p-3 rounded-xl flex items-center justify-between cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.98] transition-all"
           >
              <div className="flex items-center gap-4">
                <div className={`${sectionIconClass} text-slate-400`}>
                  <HardDrive size={22} />
                </div>
                <span className={`font-bold ${headingClass} flex items-center gap-2`}>
                  存储分析
                  {hasStorageWarning && (
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] bg-amber-100/80 text-amber-600 dark:bg-amber-400/20 dark:text-amber-300">
                      !
                    </span>
                  )}
                </span>
              </div>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 ${isDarkMode ? cardClass : 'neu-flat'}`}>
                <ChevronRight size={16} />
              </div>
           </div>

           <div className="w-full h-[1px] bg-slate-300/20 mx-2" />

           {/* Appearance Preferences */}
           <div 
             onClick={() => navigateTo('APPEARANCE')}
             className="p-3 rounded-xl flex items-center justify-between cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.98] transition-all"
           >
              <div className="flex items-center gap-4">
                <div className={`${sectionIconClass} text-rose-400`}>
                  <Palette size={22} />
                </div>
                <span className={`font-bold ${headingClass}`}>外观偏好</span>
              </div>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 ${isDarkMode ? cardClass : 'neu-flat'}`}>
                <ChevronRight size={16} />
              </div>
           </div>
        </div>
      </section>

      {/* Export/Import Buttons */}
      <div className="mt-8 grid grid-cols-2 gap-4 px-1">
        <button
          type="button"
          onClick={() => void handleExportArchive()}
          disabled={archiveExporting || archiveImporting || vocabularyArchiveExporting || vocabularyArchiveImporting}
          className={`${cardClass} py-4 rounded-2xl flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-rose-400 transition-colors active:scale-[0.98] disabled:opacity-55 disabled:cursor-not-allowed`}
        >
            {archiveExporting ? <Loader2 size={24} className="animate-spin" /> : <Upload size={24} />}
            <span className="text-xs font-bold">{archiveExporting ? '导出中...' : '导出存档文件'}</span>
        </button>
        <button
          type="button"
          onClick={handleImportArchive}
          disabled={archiveExporting || archiveImporting || vocabularyArchiveExporting || vocabularyArchiveImporting}
          className={`${cardClass} py-4 rounded-2xl flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-rose-400 transition-colors active:scale-[0.98] disabled:opacity-55 disabled:cursor-not-allowed`}
        >
            {archiveImporting ? <Loader2 size={24} className="animate-spin" /> : <Download size={24} />}
            <span className="text-xs font-bold">{archiveImporting ? '导入中...' : '导入存档文件'}</span>
        </button>
        <input
          ref={archiveFileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => { void handleImportArchiveFileSelected(e); }}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-4 px-1">
        <button
          type="button"
          onClick={() => void handleExportVocabularyArchive()}
          disabled={archiveExporting || archiveImporting || vocabularyArchiveExporting || vocabularyArchiveImporting}
          className={`${cardClass} py-4 rounded-2xl flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-rose-400 transition-colors active:scale-[0.98] disabled:opacity-55 disabled:cursor-not-allowed`}
        >
          {vocabularyArchiveExporting ? <Loader2 size={24} className="animate-spin" /> : <Upload size={24} />}
          <span className="text-xs font-bold">{vocabularyArchiveExporting ? '导出中...' : '导出生词与词库'}</span>
        </button>
        <button
          type="button"
          onClick={handleImportVocabularyArchive}
          disabled={archiveExporting || archiveImporting || vocabularyArchiveExporting || vocabularyArchiveImporting}
          className={`${cardClass} py-4 rounded-2xl flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-rose-400 transition-colors active:scale-[0.98] disabled:opacity-55 disabled:cursor-not-allowed`}
        >
          {vocabularyArchiveImporting ? <Loader2 size={24} className="animate-spin" /> : <Download size={24} />}
          <span className="text-xs font-bold">{vocabularyArchiveImporting ? '导入中...' : '导入生词与词库'}</span>
        </button>
        <input
          ref={vocabularyArchiveFileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => { void handleImportVocabularyArchiveFileSelected(e); }}
        />
      </div>
    </div>
  );
};

export default Settings;
