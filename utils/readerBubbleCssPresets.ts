import { ReaderCssPreset } from '../types';

export const DEFAULT_NEUMORPHISM_BUBBLE_CSS_PRESET_ID = 'builtin-default-neumorphism-v1';
export const GLASS_MORPHISM_BUBBLE_CSS_PRESET_ID = 'builtin-glass-morphism-v1';

const REMOVED_PRESET_IDS = new Set<string>([
  'builtin-retro-snow-v1',
]);

const REMOVED_PRESET_NAMES = new Set<string>([
  '雪笺旧梦',
  '闆鏃фⅵ',
]);

export const LEGACY_DEFAULT_NEUMORPHISM_BUBBLE_CSS = [
  '/* Default neumorphism bubble style */',
  '.rm-bubble {',
  '  border-style: solid;',
  '  transition: background 0.25s ease, color 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;',
  '}',
  '',
  '.rm-bubble-ai {',
  '  background: #e0e5ec;',
  '  color: #334155;',
  '  border-color: rgba(148, 163, 184, 0.35);',
  '  box-shadow: 5px 5px 10px #c3c8ce, -5px -5px 10px #fdffff;',
  '}',
  '',
  '.rm-bubble-user {',
  '  background: #fb7185;',
  '  color: #ffffff;',
  '  border-color: rgba(255, 255, 255, 0.24);',
  '  box-shadow: 5px 5px 10px rgba(209, 213, 219, 0.9), -5px -5px 10px rgba(255, 255, 255, 0.96);',
  '}',
  '',
  '.dark-mode .rm-bubble-ai {',
  '  background: #1a202c;',
  '  color: #cbd5e1;',
  '  border-color: rgba(148, 163, 184, 0.2);',
  '  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.38);',
  '}',
  '',
  '.dark-mode .rm-bubble-user {',
  '  background: #f43f5e;',
  '  color: #ffffff;',
  '  border-color: rgba(255, 255, 255, 0.18);',
  '  box-shadow: 0 8px 16px rgba(244, 63, 94, 0.28);',
  '}',
].join('\n');

export const DEFAULT_NEUMORPHISM_BUBBLE_CSS = [
  '/* Default neumorphism bubble style */',
  '.rm-bubble {',
  '  border: none;',
  '  transition: background 0.25s ease, color 0.25s ease, box-shadow 0.25s ease;',
  '}',
  '',
  '.rm-bubble-ai {',
  '  background: #e0e5ec;',
  '  color: #334155;',
  '  box-shadow: 5px 5px 10px #c3c8ce, -5px -5px 10px #fdffff;',
  '}',
  '',
  '.rm-bubble-user {',
  '  background: rgb(var(--theme-400) / 1);',
  '  color: #ffffff;',
  '  box-shadow: 5px 5px 10px rgba(163, 177, 198, 0.34), -5px -5px 10px rgba(255, 255, 255, 0.84);',
  '}',
  '',
  '.dark-mode .rm-bubble-ai {',
  '  background: #1a202c;',
  '  color: #cbd5e1;',
  '  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.38);',
  '}',
  '',
  '.dark-mode .rm-bubble-user {',
  '  background: rgb(var(--theme-500) / 1);',
  '  color: #ffffff;',
  '  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgb(var(--theme-300) / 0.16);',
  '}',
].join('\n');

const GLASS_MORPHISM_BUBBLE_CSS = [
  '/* Glass morphism */',
  '.rm-bubble {',
  '  border-width: 1px;',
  '  border-style: solid;',
  '  backdrop-filter: blur(14px) saturate(170%);',
  '  -webkit-backdrop-filter: blur(14px) saturate(170%);',
  '}',
  '',
  '.rm-bubble-ai {',
  '  background: linear-gradient(135deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0.32));',
  '  border-color: rgba(255, 255, 255, 0.75);',
  '  color: #1e293b;',
  '  box-shadow: 0 8px 24px rgba(30, 41, 59, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.72);',
  '}',
  '',
  '.rm-bubble-user {',
  '  background: linear-gradient(135deg, rgba(125, 211, 252, 0.58), rgba(56, 189, 248, 0.33));',
  '  border-color: rgba(255, 255, 255, 0.58);',
  '  color: #082f49;',
  '  box-shadow: 0 8px 24px rgba(14, 116, 144, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.56);',
  '}',
  '',
  '.dark-mode .rm-bubble-ai {',
  '  background: linear-gradient(135deg, rgba(30, 41, 59, 0.66), rgba(15, 23, 42, 0.46));',
  '  border-color: rgba(255, 255, 255, 0.12);',
  '  color: #f8fafc;',
  '  box-shadow: 0 8px 24px rgba(2, 6, 23, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08);',
  '}',
  '',
  '.dark-mode .rm-bubble-user {',
  '  background: linear-gradient(135deg, rgba(2, 132, 199, 0.46), rgba(3, 105, 161, 0.28));',
  '  border-color: rgba(125, 211, 252, 0.26);',
  '  color: #f0f9ff;',
  '  box-shadow: 0 8px 24px rgba(2, 132, 199, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.14);',
  '}',
].join('\n');

const BUILTIN_READER_BUBBLE_CSS_PRESETS: ReaderCssPreset[] = [
  {
    id: DEFAULT_NEUMORPHISM_BUBBLE_CSS_PRESET_ID,
    name: '默认',
    css: DEFAULT_NEUMORPHISM_BUBBLE_CSS,
  },
  {
    id: GLASS_MORPHISM_BUBBLE_CSS_PRESET_ID,
    name: '玻璃拟态',
    css: GLASS_MORPHISM_BUBBLE_CSS,
  },
];

export const DEFAULT_READER_BUBBLE_CSS_PRESETS: ReaderCssPreset[] = BUILTIN_READER_BUBBLE_CSS_PRESETS.map((item) => ({ ...item }));

const BUILTIN_IDS = new Set<string>(BUILTIN_READER_BUBBLE_CSS_PRESETS.map((item) => item.id));

const normalizeReaderCssPreset = (value: unknown): ReaderCssPreset | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<ReaderCssPreset>;
  const id = typeof source.id === 'string' ? source.id.trim() : '';
  const name = typeof source.name === 'string' ? source.name.trim() : '';
  const css = typeof source.css === 'string' ? source.css : '';
  if (!id || !name) return null;
  return { id, name, css };
};

export const normalizeReaderBubbleCssPresets = (source: unknown): ReaderCssPreset[] => {
  if (!Array.isArray(source)) return DEFAULT_READER_BUBBLE_CSS_PRESETS.map((item) => ({ ...item }));

  const customPresets: ReaderCssPreset[] = [];
  const seenCustomIds = new Set<string>();

  source.forEach((rawItem) => {
    const preset = normalizeReaderCssPreset(rawItem);
    if (!preset) return;
    if (BUILTIN_IDS.has(preset.id)) return;
    if (REMOVED_PRESET_IDS.has(preset.id)) return;
    if (REMOVED_PRESET_NAMES.has(preset.name)) return;
    if (seenCustomIds.has(preset.id)) return;
    seenCustomIds.add(preset.id);
    customPresets.push(preset);
  });

  return [
    ...BUILTIN_READER_BUBBLE_CSS_PRESETS.map((item) => ({ ...item })),
    ...customPresets.map((item) => ({ ...item })),
  ];
};
