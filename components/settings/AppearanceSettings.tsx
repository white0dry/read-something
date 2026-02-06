import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Moon, Sun, Type, Palette, RotateCcw, Smartphone, X } from 'lucide-react';
import { ThemeClasses, AppSettings } from './types';
import ModalPortal from '../ModalPortal';

interface AppearanceSettingsProps {
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  theme: ThemeClasses;
  onBack: () => void;
}

interface RgbValue {
  r: number;
  g: number;
  b: number;
}

const COLOR_MODAL_TRANSITION_MS = 220;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const hexToRgb = (hex: string): RgbValue => {
  const normalized = hex.replace('#', '');
  if (!/^[\da-fA-F]{6}$/.test(normalized)) {
    return { r: 226, g: 138, b: 157 };
  }
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16)
  };
};

const rgbToHex = ({ r, g, b }: RgbValue) =>
  `#${[r, g, b].map(v => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

const normalizeHexInput = (raw: string) => {
  const cleaned = raw.replace(/[^#0-9a-fA-F]/g, '').replace(/#/g, '');
  return `#${cleaned.slice(0, 6).toUpperCase()}`;
};

const isValidHexColor = (value: string) => /^#[0-9A-F]{6}$/.test(value);

const AppearanceSettings: React.FC<AppearanceSettingsProps> = ({
  isDarkMode,
  onToggleDarkMode,
  settings,
  setSettings,
  theme,
  onBack
}) => {
  const { containerClass, animationClass, cardClass, headingClass, pressedClass, btnClass, inputClass, isDarkMode: mode } = theme;
  const [isColorModalOpen, setIsColorModalOpen] = useState(false);
  const [isColorModalClosing, setIsColorModalClosing] = useState(false);
  const [draftColor, setDraftColor] = useState<RgbValue>(() => hexToRgb(settings.themeColor));
  const [hexInput, setHexInput] = useState(settings.themeColor.toUpperCase());
  const colorModalTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setHexInput(settings.themeColor.toUpperCase());
  }, [settings.themeColor]);

  useEffect(() => {
    return () => {
      if (colorModalTimerRef.current) window.clearTimeout(colorModalTimerRef.current);
    };
  }, []);

  const renderToggle = (isActive: boolean, onToggle: () => void) => (
    <button onClick={onToggle} className={`w-14 h-8 rounded-full p-1 flex items-center transition-all ${pressedClass}`}>
      <div className={`w-6 h-6 rounded-full shadow-sm flex items-center justify-center transition-all transform duration-300 ${isActive ? 'translate-x-6 bg-rose-400' : 'translate-x-0 bg-slate-400'}`} />
    </button>
  );

  const renderHeader = (title: string, onBackAction?: () => void) => (
    <header className="mb-6 pt-2 flex items-center gap-4">
      {onBackAction && (
        <button onClick={onBackAction} className={`w-10 h-10 rounded-full flex items-center justify-center hover:text-rose-400 transition-colors active:scale-95 ${btnClass}`}>
          <ArrowLeft size={20} />
        </button>
      )}
      <h1 className={`text-2xl font-bold ${headingClass}`}>{title}</h1>
    </header>
  );

  const resetTheme = () => {
    const defaultColor = '#E28A9D';
    setSettings(prev => ({ ...prev, themeColor: defaultColor }));
    setDraftColor(hexToRgb(defaultColor));
    setHexInput(defaultColor);
  };

  const openColorModal = () => {
    if (colorModalTimerRef.current) {
      window.clearTimeout(colorModalTimerRef.current);
      colorModalTimerRef.current = null;
    }
    setIsColorModalClosing(false);
    setDraftColor(hexToRgb(settings.themeColor));
    setIsColorModalOpen(true);
  };

  const closeColorModal = () => {
    if (!isColorModalOpen) return;
    setIsColorModalClosing(true);
    if (colorModalTimerRef.current) window.clearTimeout(colorModalTimerRef.current);
    colorModalTimerRef.current = window.setTimeout(() => {
      setIsColorModalOpen(false);
      setIsColorModalClosing(false);
    }, COLOR_MODAL_TRANSITION_MS);
  };

  const updateDraftChannel = (channel: keyof RgbValue, value: number) => {
    setDraftColor(prev => ({ ...prev, [channel]: clamp(value, 0, 255) }));
  };

  const applyDraftColor = () => {
    const nextColor = rgbToHex(draftColor);
    setSettings(prev => ({ ...prev, themeColor: nextColor }));
    closeColorModal();
  };

  const handleHexInputChange = (raw: string) => {
    const normalized = normalizeHexInput(raw);
    setHexInput(normalized);
    if (isValidHexColor(normalized)) {
      setSettings(prev => ({ ...prev, themeColor: normalized }));
      setDraftColor(hexToRgb(normalized));
    }
  };

  const handleHexInputBlur = () => {
    if (isValidHexColor(hexInput)) {
      setSettings(prev => ({ ...prev, themeColor: hexInput }));
      return;
    }
    setHexInput(settings.themeColor.toUpperCase());
  };

  return (
    <div className={`flex-1 flex flex-col p-6 pb-28 overflow-y-auto no-scrollbar relative ${containerClass} ${animationClass}`}>
      {renderHeader('外观偏好', onBack)}

      <div className={`${cardClass} p-4 flex flex-col gap-6 rounded-2xl`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center text-rose-400 ${pressedClass}`}>
              {isDarkMode ? <Moon size={22} /> : <Sun size={22} />}
            </div>
            <span className={`font-bold ${headingClass}`}>深色模式</span>
          </div>
          {renderToggle(isDarkMode, onToggleDarkMode)}
        </div>

        <div className="w-full h-[1px] bg-slate-300/20" />

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center text-rose-400 ${pressedClass}`}>
                <Palette size={22} />
              </div>
              <div>
                <div className={`font-bold ${headingClass}`}>主题色</div>
                <div className="text-xs text-slate-500">自定义应用强调色</div>
              </div>
            </div>
            <button
              onClick={resetTheme}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-rose-400 ${btnClass}`}
              title="重置为默认"
            >
              <RotateCcw size={14} />
            </button>
          </div>

          <div className="flex items-center gap-4 px-2 h-12">
            <button onClick={openColorModal} className={`flex-1 h-full rounded-xl overflow-hidden ${pressedClass}`} title="打开 RGB 调色面板">
              <span className="block w-full h-full" style={{ backgroundColor: settings.themeColor }} />
            </button>
            <input
              type="text"
              value={hexInput}
              onChange={(e) => handleHexInputChange(e.target.value)}
              onBlur={handleHexInputBlur}
              className={`px-4 h-full rounded-xl font-mono uppercase min-w-[116px] text-center outline-none ${inputClass}`}
              style={{ fontSize: 'calc(13px * var(--app-font-scale, 1))' }}
              maxLength={7}
              spellCheck={false}
            />
          </div>
        </div>

        <div className="w-full h-[1px] bg-slate-300/20" />

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center text-slate-500 ${pressedClass}`}>
              <Type size={22} />
            </div>
            <div className="flex-1">
              <div className="flex justify-between items-center">
                <span className={`font-bold ${headingClass}`}>字体大小</span>
                <span className="text-xs text-rose-400 font-bold">{Math.round(settings.fontSizeScale * 100)}%</span>
              </div>
            </div>
          </div>

          <div className="px-2">
            <div className="relative h-2 w-full mt-2 mb-2">
              <input
                type="range"
                min="80"
                max="120"
                step="5"
                value={settings.fontSizeScale * 100}
                onChange={(e) => setSettings(prev => ({ ...prev, fontSizeScale: parseInt(e.target.value, 10) / 100 }))}
                className="app-range absolute top-1/2 -translate-y-1/2 left-0 w-full h-5 bg-transparent appearance-none cursor-pointer z-10"
              />
              <div className={`absolute top-0 left-0 h-full rounded-lg w-full ${mode ? 'bg-slate-700' : 'bg-black/5'}`} />
              <div className="absolute top-0 left-0 h-full bg-rose-300 rounded-lg pointer-events-none" style={{ width: `${((settings.fontSizeScale * 100 - 80) / 40) * 100}%` }} />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 px-1">
              <span>小</span>
              <span>标准</span>
              <span>大</span>
            </div>
          </div>
        </div>

        <div className="w-full h-[1px] bg-slate-300/20" />

        <div className="flex flex-col gap-4 pb-2">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center text-slate-500 ${pressedClass}`}>
              <Smartphone size={22} />
            </div>
            <div>
              <div className={`font-bold ${headingClass}`}>屏幕适配</div>
              <div className="text-xs text-slate-500">调节顶部刘海与底部横条留白</div>
            </div>
          </div>

          <div className="px-2 mt-2">
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>顶部留白</span>
              <span>{settings.safeAreaTop || 0}px</span>
            </div>
            <div className="relative h-2 w-full mb-4">
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={settings.safeAreaTop || 0}
                onChange={(e) => setSettings(prev => ({ ...prev, safeAreaTop: parseInt(e.target.value, 10) }))}
                className="app-range absolute top-1/2 -translate-y-1/2 left-0 w-full h-5 bg-transparent appearance-none cursor-pointer z-10"
              />
              <div className={`absolute top-0 left-0 h-full rounded-lg w-full ${mode ? 'bg-slate-700' : 'bg-black/5'}`} />
              <div className="absolute top-0 left-0 h-full bg-rose-300 rounded-lg pointer-events-none" style={{ width: `${settings.safeAreaTop || 0}%` }} />
            </div>
          </div>

          <div className="px-2">
            <div className="flex justify-between text-xs text-slate-500 mb-1">
              <span>底部留白</span>
              <span>{settings.safeAreaBottom || 0}px</span>
            </div>
            <div className="relative h-2 w-full">
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={settings.safeAreaBottom || 0}
                onChange={(e) => setSettings(prev => ({ ...prev, safeAreaBottom: parseInt(e.target.value, 10) }))}
                className="app-range absolute top-1/2 -translate-y-1/2 left-0 w-full h-5 bg-transparent appearance-none cursor-pointer z-10"
              />
              <div className={`absolute top-0 left-0 h-full rounded-lg w-full ${mode ? 'bg-slate-700' : 'bg-black/5'}`} />
              <div className="absolute top-0 left-0 h-full bg-rose-300 rounded-lg pointer-events-none" style={{ width: `${settings.safeAreaBottom || 0}%` }} />
            </div>
          </div>
        </div>
      </div>

      {isColorModalOpen && (
        <ModalPortal>
          <div className={`fixed inset-0 z-[130] flex items-center justify-center p-4 pb-28 bg-black/30 backdrop-blur-sm ${isColorModalClosing ? 'app-fade-exit' : 'app-fade-enter'}`}>
          <div className={`${cardClass} w-full max-w-sm rounded-2xl p-6 shadow-2xl border-2 border-red-100/10 relative ${isColorModalClosing ? 'app-fade-exit' : 'app-fade-enter'}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-lg font-bold ${headingClass}`}>RGB 调色</h3>
              <button onClick={closeColorModal} className={`w-8 h-8 rounded-full text-slate-400 hover:text-rose-400 ${btnClass}`}>
                <X size={16} />
              </button>
            </div>

            <div className={`h-20 rounded-2xl mb-4 ${pressedClass} p-2`}>
              <div className="w-full h-full rounded-xl border border-white/20" style={{ backgroundColor: rgbToHex(draftColor) }} />
            </div>

            <div className="space-y-4">
              {(['r', 'g', 'b'] as const).map(channel => (
                <div key={channel} className="flex items-center gap-3">
                  <span className="w-5 text-xs font-bold uppercase text-slate-500">{channel}</span>
                  <div className="relative flex-1 h-2">
                    <div className={`absolute inset-0 rounded-full ${mode ? 'bg-slate-700' : 'bg-black/10'}`} />
                    <div className="absolute inset-y-0 left-0 rounded-full bg-rose-300" style={{ width: `${(draftColor[channel] / 255) * 100}%` }} />
                    <input
                      type="range"
                      min="0"
                      max="255"
                      value={draftColor[channel]}
                      onChange={(e) => updateDraftChannel(channel, parseInt(e.target.value, 10))}
                      className="app-range absolute top-1/2 -translate-y-1/2 left-0 w-full h-5 bg-transparent appearance-none cursor-pointer z-10"
                    />
                  </div>
                  <input
                    type="number"
                    min="0"
                    max="255"
                    value={draftColor[channel]}
                    onChange={(e) => updateDraftChannel(channel, parseInt(e.target.value || '0', 10))}
                    className={`w-16 h-8 text-center text-xs rounded-lg outline-none ${inputClass} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                  />
                </div>
              ))}
            </div>

            <div className={`mt-4 p-2 rounded-xl text-center font-mono text-xs uppercase ${inputClass}`}>
              {rgbToHex(draftColor)}
            </div>

            <div className="mt-5 flex gap-3">
              <button onClick={closeColorModal} className={`flex-1 py-3 rounded-full text-slate-500 text-sm font-bold ${btnClass}`}>
                取消
              </button>
              <button onClick={applyDraftColor} className="flex-1 py-3 rounded-full text-white bg-rose-400 shadow-lg hover:bg-rose-500 active:scale-95 transition-all font-bold text-sm">
                应用
              </button>
            </div>
          </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

export default AppearanceSettings;
