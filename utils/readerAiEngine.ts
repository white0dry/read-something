import { GoogleGenAI } from '@google/genai';
import { ApiConfig, Chapter, ReaderHighlightRange, ReaderPositionState } from '../types';
import { Character, WorldBookEntry } from '../components/settings/types';
import {
  beginConversationGeneration,
  buildCharacterPromptRecord,
  ChatBubble,
  clamp,
  compactText,
  finishConversationGeneration,
  GenerationMode,
} from './readerChatRuntime';

export interface ReadingContextSnapshot {
  joinedBookText: string;
  excerpt: string;
  excerptStart: number;
  excerptEnd: number;
  highlightedSnippets: string[];
}

interface ParsedAiReply {
  bubblePayload: string;
  underlineText: string | null;
}

interface CharacterWorldBookSections {
  before: WorldBookEntry[];
  after: WorldBookEntry[];
}

interface RunConversationGenerationParams {
  mode: GenerationMode;
  conversationKey: string;
  sourceMessages: ChatBubble[];
  apiConfig: ApiConfig;
  userRealName: string;
  userNickname: string;
  characterRealName: string;
  characterNickname: string;
  characterDescription: string;
  characterWorldBookEntries: CharacterWorldBookSections;
  activeBookId: string | null;
  activeBookTitle: string;
  chatHistorySummary: string;
  readingPrefixSummaryByBookId: Record<string, string>;
  readingContext: ReadingContextSnapshot;
  aiProactiveUnderlineEnabled: boolean;
  aiProactiveUnderlineProbability: number;
  pendingMessages?: ChatBubble[];
  allowEmptyPending?: boolean;
  onAddAiUnderlineRange?: (payload: { start: number; end: number; generationId: string }) => void;
  signal?: AbortSignal;
  memoryBubbleCount?: number;
  replyBubbleMin?: number;
  replyBubbleMax?: number;
}

type RunGenerationSkipReason =
  | 'no-pending'
  | 'invalid-api-config'
  | 'busy'
  | 'blocked'
  | 'aborted'
  | 'error';

type RunConversationGenerationResult =
  | {
      status: 'ok';
      baseMessages: ChatBubble[];
      aiMessages: ChatBubble[];
      generationId: string;
    }
  | {
      status: 'skip';
      reason: RunGenerationSkipReason;
      silent: boolean;
      message?: string;
    };

const CONTEXT_VIEWPORT_TAIL_WEIGHT = 0.82;
const DEFAULT_MEMORY_BUBBLE_COUNT = 100;
const DEFAULT_REPLY_BUBBLE_MIN = 3;
const DEFAULT_REPLY_BUBBLE_MAX = 8;

const DATA_IMAGE_REGEX = /data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=\s]+/gi;
const IMAGE_REF_REGEX = /idb:\/\/[a-zA-Z0-9._-]+/gi;
const IMAGE_TAG_REGEX = /<img\b[^>]*>/gi;
const MARKDOWN_IMAGE_REGEX = /!\[[^\]]*]\((data:image[^)]+|idb:\/\/[^)]+)\)/gi;
const IMAGE_PLACEHOLDER_REGEX = /\[(?:image|img|media|鍥剧墖|鍥惧儚)[:锛歖[^\]]*]/gi;

export const sanitizeTextForAiPrompt = (raw: string) => {
  if (!raw) return '';
  return raw
    .replace(DATA_IMAGE_REGEX, ' ')
    .replace(IMAGE_REF_REGEX, ' ')
    .replace(IMAGE_TAG_REGEX, ' ')
    .replace(MARKDOWN_IMAGE_REGEX, ' ')
    .replace(IMAGE_PLACEHOLDER_REGEX, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const normalizeReaderLayoutText = (raw: string) => {
  const normalizedText = sanitizeTextForAiPrompt(raw).replace(/\r\n/g, '\n').trim();
  if (!normalizedText) return '';

  const splitByBlankLine = normalizedText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (splitByBlankLine.length > 1) {
    return splitByBlankLine.join('\n');
  }

  return normalizedText
    .split('\n')
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .join('\n');
};

const toFiniteNonNegativeInt = (value: unknown) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.floor(numeric));
};

const scaleOffsetByLength = (offset: number, sourceLength: number, targetLength: number) => {
  if (targetLength <= 0) return 0;
  if (sourceLength <= 0) {
    return clamp(Math.round(offset), 0, targetLength);
  }
  const safeOffset = clamp(Math.round(offset), 0, sourceLength);
  return clamp(Math.round((safeOffset / sourceLength) * targetLength), 0, targetLength);
};

const ensureBubbleCount = (items: string[], minCount: number, maxCount: number) => {
  let lines = items.map(compactText).filter(Boolean);
  if (lines.length > maxCount) lines = lines.slice(0, maxCount);
  if (lines.length >= minCount) return lines;

  const raw = compactText(lines.join(' '));
  const splitByPunctuation = raw
    .split(/[銆傦紒锛??锛?\n]+/)
    .map(compactText)
    .filter(Boolean);

  lines = splitByPunctuation.length > 0 ? splitByPunctuation : lines;
  if (lines.length > maxCount) lines = lines.slice(0, maxCount);
  if (lines.length >= minCount) return lines;

  if (raw) {
    const chunkSize = Math.max(2, Math.ceil(raw.length / Math.max(minCount, 1)));
    const chunks: string[] = [];
    for (let index = 0; index < raw.length && chunks.length < maxCount; index += chunkSize) {
      chunks.push(raw.slice(index, index + chunkSize));
    }
    if (chunks.length > 0) lines = chunks;
  }

  const fallback = lines[0] || '鏀跺埌';
  while (lines.length < minCount) {
    lines.push(fallback);
  }
  return lines.slice(0, maxCount);
};

const normalizeAiBubbleLines = (raw: string, minCount: number, maxCount: number) => {
  const trimmed = raw.trim();
  if (!trimmed) return ensureBubbleCount([], minCount, maxCount);

  let cleaned = trimmed;
  cleaned = cleaned.replace(/```(?:[\w-]+)?\n?/g, '');
  cleaned = cleaned.replace(/```/g, '');

  const tagMatches = [...cleaned.matchAll(/<bubble>([\s\S]*?)<\/bubble>/gi)]
    .map((match) => compactText(match[1] || ''))
    .filter(Boolean);
  if (tagMatches.length > 0) return ensureBubbleCount(tagMatches, minCount, maxCount);

  const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const marked = lines
    .map((line) => line.match(/^\[姘旀场\]\s*(.+)$/)?.[1] || line.match(/^銆愭皵娉°€慭s*(.+)$/)?.[1] || '')
    .map(compactText)
    .filter(Boolean);
  if (marked.length > 0) return ensureBubbleCount(marked, minCount, maxCount);

  const plainLines = lines
    .map((line) => line.replace(/^\d+[\.\)\s]*/, ''))
    .map(compactText)
    .filter(Boolean);
  return ensureBubbleCount(plainLines.length > 0 ? plainLines : [cleaned], minCount, maxCount);
};

const parseAiReplyPayload = (raw: string): ParsedAiReply => {
  const lines = raw.split(/\r?\n/);
  let firstUnderline: string | null = null;
  const bubbleLines: string[] = [];

  lines.forEach((line) => {
    const matched = line.match(/^\s*\[鍒掔嚎\]\s*(.+)\s*$/);
    if (matched) {
      if (!firstUnderline) {
        const text = compactText(matched[1] || '');
        if (text) firstUnderline = text;
      }
      return;
    }
    bubbleLines.push(line);
  });

  return {
    bubblePayload: bubbleLines.join('\n'),
    underlineText: firstUnderline,
  };
};

const findAiUnderlineRangeInExcerpt = (
  underlineText: string,
  context: Pick<ReadingContextSnapshot, 'excerpt' | 'excerptStart'>
) => {
  const needle = underlineText.replace(/\s+/g, '');
  if (!needle) return null;

  const excerpt = context.excerpt || '';
  if (!excerpt) return null;

  const compactChars: string[] = [];
  const compactToRawIndex: number[] = [];
  for (let index = 0; index < excerpt.length; index += 1) {
    const char = excerpt[index];
    if (/\s/.test(char)) continue;
    compactChars.push(char);
    compactToRawIndex.push(index);
  }
  if (compactChars.length === 0) return null;

  const compactExcerpt = compactChars.join('');
  const compactMatchStart = compactExcerpt.lastIndexOf(needle);
  if (compactMatchStart < 0) return null;

  const compactMatchEnd = compactMatchStart + needle.length - 1;
  const rawStart = compactToRawIndex[compactMatchStart];
  const rawEnd = compactToRawIndex[compactMatchEnd];
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return null;

  const globalStart = context.excerptStart + rawStart;
  const globalEnd = context.excerptStart + rawEnd + 1;
  if (globalEnd <= globalStart) return null;
  return { start: globalStart, end: globalEnd };
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (!signal?.aborted) return;
  throw new DOMException('The operation was aborted.', 'AbortError');
};

const isAbortError = (error: unknown) => {
  if (!error) return false;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  return error instanceof Error && /abort/i.test(error.message);
};

const parseResponseError = async (response: Response, fallback: string) => {
  try {
    const raw = await response.text();
    const compact = raw.replace(/\s+/g, ' ').trim();
    if (!compact) return fallback;

    try {
      const parsed = JSON.parse(compact) as
        | { error?: { message?: string } | string; message?: string; detail?: string }
        | null;
      const candidate =
        (typeof parsed?.error === 'string' ? parsed.error : parsed?.error?.message) ||
        parsed?.message ||
        parsed?.detail;
      if (typeof candidate === 'string' && candidate.trim()) {
        return `${fallback}: ${candidate.trim()}`;
      }
    } catch {
      // ignore JSON parse and fallback to plain text
    }

    return `${fallback}: ${compact.slice(0, 180)}`;
  } catch {
    return fallback;
  }
};

const callAiModel = async (prompt: string, apiConfig: ApiConfig, signal?: AbortSignal) => {
  const provider = apiConfig.provider;
  const endpoint = (apiConfig.endpoint || '').trim().replace(/\/+$/, '');
  const apiKey = (apiConfig.apiKey || '').trim();
  const model = (apiConfig.model || '').trim();

  throwIfAborted(signal);

  if (provider === 'GEMINI') {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
    });
    throwIfAborted(signal);
    return response.text || '';
  }

  if (provider === 'CLAUDE') {
    const response = await fetch(`${endpoint}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal,
    });
    if (!response.ok) {
      const baseMessage = `Claude API Error ${response.status}`;
      throw new Error(await parseResponseError(response, baseMessage));
    }
    const data = await response.json();
    throwIfAborted(signal);
    return data.content?.[0]?.text || '';
  }

  const response = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.85,
    }),
    signal,
  });
  if (!response.ok) {
    const baseMessage = `API Error ${response.status}`;
    throw new Error(await parseResponseError(response, baseMessage));
  }
  const data = await response.json();
  throwIfAborted(signal);
  return data.choices?.[0]?.message?.content || '';
};

const getWorldBookOrderCode = (entry: WorldBookEntry) => {
  const match = `${entry.title || ''} ${entry.content || ''}`.match(/(\d+(?:\.\d+)?)/);
  if (!match) return Number.POSITIVE_INFINITY;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

const sortWorldBookEntriesByCode = (entries: WorldBookEntry[]) =>
  entries
    .map((entry, index) => ({ entry, index, code: getWorldBookOrderCode(entry) }))
    .sort((left, right) => {
      if (left.code !== right.code) return left.code - right.code;
      return left.index - right.index;
    })
    .map((item) => item.entry);

const formatWorldBookSection = (entries: WorldBookEntry[], title: string) => {
  if (entries.length === 0) return `${title}:(none)`;
  return [
    `${title}:`,
    ...entries.map((entry, index) => {
      const code = getWorldBookOrderCode(entry);
      const codeText = Number.isFinite(code) ? code.toString() : '-';
      const entryTitle = entry.title?.trim() || `Entry ${index + 1}`;
      const entryContent = entry.content?.trim() || '(empty)';
      return `[WorldBook-${index + 1} | code:${codeText} | category:${entry.category}] ${entryTitle}\n${entryContent}`;
    }),
  ].join('\n');
};

const buildAiPrompt = (params: {
  mode: GenerationMode;
  sourceMessages: ChatBubble[];
  pendingMessages: ChatBubble[];
  readingContext: ReadingContextSnapshot;
  allowAiUnderlineInThisReply: boolean;
  characterWorldBookEntries: CharacterWorldBookSections;
  userRealName: string;
  userNickname: string;
  characterRealName: string;
  characterNickname: string;
  characterDescription: string;
  activeBookTitle: string;
  activeBookSummary: string;
  chatHistorySummary: string;
  memoryBubbleCount: number;
  replyBubbleMin: number;
  replyBubbleMax: number;
}) => {
  const {
    mode,
    sourceMessages,
    pendingMessages,
    readingContext,
    allowAiUnderlineInThisReply,
    characterWorldBookEntries,
    userRealName,
    userNickname,
    characterRealName,
    characterNickname,
    characterDescription,
    activeBookTitle,
    activeBookSummary,
    chatHistorySummary,
    memoryBubbleCount,
    replyBubbleMin,
    replyBubbleMax,
  } = params;

  const { excerpt, highlightedSnippets } = readingContext;
  const recentHistory = sourceMessages
    .slice(-memoryBubbleCount)
    .map((message) => message.promptRecord)
    .join('\n');

  const latestUserRecord =
    [...sourceMessages].reverse().find((message) => message.sender === 'user')?.promptRecord || '（暂无用户消息）';
  const pendingRecordText =
    pendingMessages.length > 0
      ? pendingMessages.map((message) => message.promptRecord).join('\n')
      : mode === 'proactive'
        ? '（本轮为角色主动发起，无待回复用户消息）'
        : latestUserRecord;

  const safeExcerpt = sanitizeTextForAiPrompt(excerpt);
  const safeHasReadableExcerpt = compactText(safeExcerpt).length > 0;
  const safeHighlightedSnippets = highlightedSnippets.map((item) => sanitizeTextForAiPrompt(item)).filter(Boolean);
  const safeActiveBookSummary = sanitizeTextForAiPrompt(activeBookSummary);
  const safeChatHistorySummary = sanitizeTextForAiPrompt(chatHistorySummary);
  const safeRecentHistory = sanitizeTextForAiPrompt(recentHistory);
  const safePendingRecordText = sanitizeTextForAiPrompt(pendingRecordText);

  const proactiveUnderlineRule = allowAiUnderlineInThisReply
    ? '【主动划线规则】你可以额外输出 0 或 1 行 `[划线] 文本`，且该文本必须来自当前前文原句。'
    : '【主动划线规则】本轮不要输出任何 `[划线]` 行。';
  const triggerModeRule =
    mode === 'proactive'
      ? '【触发方式】本轮是角色主动发起消息，不是对用户输入的被动回复。'
      : '【触发方式】本轮是用户手动请求你的回复。';

  return [
    `你是角色 ${characterRealName}。`,
    `你的聊天显示名是 ${characterNickname}。`,
    `当前共读用户真实名：${userRealName}。`,
    `当前共读用户显示名：${userNickname}。`,
    triggerModeRule,
    '',
    formatWorldBookSection(characterWorldBookEntries.before, '【世界书-角色定义前】'),
    '【角色设定】',
    characterDescription,
    formatWorldBookSection(characterWorldBookEntries.after, '【世界书-角色定义后】'),
    '',
    `【当前书籍】${activeBookTitle || '未选择书籍'}`,
    `【书籍前文总结】${safeActiveBookSummary || '（尚未生成）'}`,
    `【聊天前文总结】${safeChatHistorySummary || '（尚未生成）'}`,
    '',
    '【当前阅读进度前文（最多800字符）】',
    safeHasReadableExcerpt ? safeExcerpt : '（当前无可用前文）',
    '',
    '【前文中的高亮重点】',
    safeHighlightedSnippets.length > 0 ? safeHighlightedSnippets.map((item) => `- ${item}`).join('\n') : '（暂无）',
    safeHighlightedSnippets.length === 0 ? '【高亮状态】当前没有任何高亮句子，禁止编造高亮内容。' : '',
    '',
    '【最近聊天记录】',
    `【本轮记忆条数】${memoryBubbleCount}`,
    safeRecentHistory || '（暂无）',
    '',
    '【本轮待回复用户消息】',
    safePendingRecordText || '（暂无）',
    '',
    '【场景与语气要求】',
    '- 当前场景是两人正在共读同一本书。',
    '- 语气要口语化、短句、像即时聊天。',
    '- 不能剧透用户尚未阅读到的后文。',
    '- 如果高亮重点为空，不要提及任何不存在的高亮句子。',
    proactiveUnderlineRule,
    '',
    '【输出格式要求（必须严格遵守）】',
    `- 只输出 ${replyBubbleMin} 到 ${replyBubbleMax} 行。`,
    '- 每一行必须以 [气泡] 开头。',
    '- [气泡] 后面只写一条聊天消息。',
    '- `[划线]` 行最多 1 行，且可选。',
    '- 不要输出解释、标题、编号或代码块。',
    '',
    '[气泡] 示例',
    '[气泡] 继续示例',
    '[气泡] 结束示例',
  ]
    .filter(Boolean)
    .join('\n');
};

const getManualPendingMessages = (sourceMessages: ChatBubble[]) => {
  const pending = sourceMessages.filter((message) => message.sender === 'user' && !message.sentToAi);
  const lastMessage = sourceMessages[sourceMessages.length - 1] || null;
  const fallbackLatestUserMessage = pending.length === 0 && lastMessage?.sender === 'user' ? lastMessage : null;
  return fallbackLatestUserMessage ? [fallbackLatestUserMessage] : pending;
};

export const buildCharacterWorldBookSections = (
  activeCharacter: Character | null,
  worldBookEntries: WorldBookEntry[]
): CharacterWorldBookSections => {
  const boundCategories = new Set(
    (activeCharacter?.boundWorldBookCategories || []).map((category) => category.trim()).filter(Boolean)
  );
  if (boundCategories.size === 0) {
    return {
      before: [],
      after: [],
    };
  }
  const scopedEntries = worldBookEntries.filter((entry) => boundCategories.has(entry.category));
  return {
    before: sortWorldBookEntriesByCode(scopedEntries.filter((entry) => entry.insertPosition === 'BEFORE')),
    after: sortWorldBookEntriesByCode(scopedEntries.filter((entry) => entry.insertPosition === 'AFTER')),
  };
};

export const buildReadingContextSnapshot = (params: {
  chapters: Chapter[];
  bookText: string;
  highlightRangesByChapter: Record<string, ReaderHighlightRange[]>;
  readingPosition: ReaderPositionState | null;
  visibleRatio?: number;
}): ReadingContextSnapshot => {
  const { chapters, bookText, highlightRangesByChapter, readingPosition } = params;
  const visibleRatio = clamp(params.visibleRatio || 0, 0, 1);

  const chapterMeta =
    chapters.length > 0
      ? chapters.map((chapter) => {
          const rawText = chapter.content || '';
          const normalizedText = normalizeReaderLayoutText(rawText);
          return {
            rawLength: rawText.length,
            normalizedLength: normalizedText.length,
            normalizedText,
          };
        })
      : [];

  const joinedBookText =
    chapterMeta.length > 0
      ? chapterMeta.map((item) => item.normalizedText).join('')
      : normalizeReaderLayoutText(bookText);

  const chapterRawOffsets = new Map<number, number>();
  const chapterNormalizedOffsets = new Map<number, number>();
  if (chapterMeta.length > 0) {
    let rawCursor = 0;
    let normalizedCursor = 0;
    chapterMeta.forEach((chapter, index) => {
      chapterRawOffsets.set(index, rawCursor);
      chapterNormalizedOffsets.set(index, normalizedCursor);
      rawCursor += chapter.rawLength;
      normalizedCursor += chapter.normalizedLength;
    });
  }

  const totalNormalizedLength = joinedBookText.length;
  const totalRawLength =
    chapterMeta.length > 0
      ? chapterMeta.reduce((sum, chapter) => sum + chapter.rawLength, 0)
      : (bookText || '').length;
  const safeRawOffset = clamp(readingPosition?.globalCharOffset || 0, 0, totalRawLength);

  let contextEnd = scaleOffsetByLength(safeRawOffset, totalRawLength, totalNormalizedLength);
  const chapterIndex = readingPosition?.chapterIndex;
  const hasValidChapterIndex =
    chapterMeta.length > 0 &&
    chapterIndex !== null &&
    typeof chapterIndex === 'number' &&
    chapterIndex >= 0 &&
    chapterIndex < chapterMeta.length;

  if (hasValidChapterIndex) {
    const chapter = chapterMeta[chapterIndex as number];
    const chapterRawStart = chapterRawOffsets.get(chapterIndex as number) || 0;
    const chapterNormalizedStart = chapterNormalizedOffsets.get(chapterIndex as number) || 0;
    const chapterRawOffset = clamp(readingPosition?.chapterCharOffset || 0, 0, chapter.rawLength);
    const viewportTailOffset = Math.round(chapter.rawLength * visibleRatio * CONTEXT_VIEWPORT_TAIL_WEIGHT);
    const shiftedChapterRawOffset = clamp(chapterRawOffset + viewportTailOffset, 0, chapter.rawLength);
    const shiftedChapterNormalizedOffset = scaleOffsetByLength(
      shiftedChapterRawOffset,
      chapter.rawLength,
      chapter.normalizedLength
    );
    contextEnd = clamp(chapterNormalizedStart + shiftedChapterNormalizedOffset, 0, totalNormalizedLength);
    if (contextEnd <= 0 && totalNormalizedLength > 0) {
      const fallbackRawGlobal = clamp(chapterRawStart + chapterRawOffset, 0, totalRawLength);
      contextEnd = scaleOffsetByLength(fallbackRawGlobal, totalRawLength, totalNormalizedLength);
    }
  } else if (totalRawLength > 0) {
    const viewportTailOffset = Math.round(totalRawLength * visibleRatio * CONTEXT_VIEWPORT_TAIL_WEIGHT);
    const shiftedRawOffset = clamp(safeRawOffset + viewportTailOffset, 0, totalRawLength);
    contextEnd = scaleOffsetByLength(shiftedRawOffset, totalRawLength, totalNormalizedLength);
  }

  contextEnd = clamp(contextEnd, 0, totalNormalizedLength);
  const start = clamp(contextEnd - 800, 0, contextEnd);
  const excerpt = joinedBookText.slice(start, contextEnd);

  const highlightedSnippets: string[] = [];
  Object.entries(highlightRangesByChapter || {}).forEach(([key, ranges]) => {
    const safeRanges = Array.isArray(ranges) ? ranges : [];
    let base = 0;
    if (key.startsWith('chapter-')) {
      const parsedChapterIndex = Number(key.replace('chapter-', ''));
      if (!Number.isFinite(parsedChapterIndex) || !chapterNormalizedOffsets.has(parsedChapterIndex)) return;
      base = chapterNormalizedOffsets.get(parsedChapterIndex) || 0;
    } else if (key !== 'full') {
      return;
    }

    safeRanges.forEach((range) => {
      const localStart = toFiniteNonNegativeInt((range as ReaderHighlightRange).start);
      const localEnd = toFiniteNonNegativeInt((range as ReaderHighlightRange).end);
      if (localStart === null || localEnd === null) return;
      const rangeStart = base + Math.min(localStart, localEnd);
      const rangeEnd = base + Math.max(localStart, localEnd);
      if (rangeEnd <= rangeStart) return;
      if (rangeEnd <= start || rangeStart >= contextEnd) return;

      const clippedStart = clamp(rangeStart, start, contextEnd);
      const clippedEnd = clamp(rangeEnd, start, contextEnd);
      if (clippedEnd <= clippedStart) return;

      const snippet = compactText(joinedBookText.slice(clippedStart, clippedEnd));
      if (!snippet) return;
      if (highlightedSnippets.includes(snippet)) return;
      highlightedSnippets.push(snippet);
    });
  });

  return {
    joinedBookText,
    excerpt,
    excerptStart: start,
    excerptEnd: contextEnd,
    highlightedSnippets: highlightedSnippets.slice(0, 12),
  };
};

const validateApiConfig = (apiConfig: ApiConfig): string | null => {
  const endpoint = (apiConfig.endpoint || '').trim();
  const apiKey = (apiConfig.apiKey || '').trim();
  const model = (apiConfig.model || '').trim();
  if (!apiKey) return '璇峰厛璁剧疆 API Key';
  if (!model) return '璇峰厛璁剧疆妯″瀷鍚嶇О';
  if (apiConfig.provider !== 'GEMINI' && !endpoint) return '璇峰厛璁剧疆 API 鍦板潃';
  return null;
};

export const runConversationGeneration = async (
  params: RunConversationGenerationParams
): Promise<RunConversationGenerationResult> => {
  const {
    mode,
    conversationKey,
    sourceMessages,
    apiConfig,
    userRealName,
    userNickname,
    characterRealName,
    characterNickname,
    characterDescription,
    characterWorldBookEntries,
    activeBookId,
    activeBookTitle,
    chatHistorySummary,
    readingPrefixSummaryByBookId,
    readingContext,
    aiProactiveUnderlineEnabled,
    aiProactiveUnderlineProbability,
    onAddAiUnderlineRange,
    signal: outerSignal,
    memoryBubbleCount,
    replyBubbleMin,
    replyBubbleMax,
  } = params;

  const validationMessage = validateApiConfig(apiConfig);
  if (validationMessage) {
    return {
      status: 'skip',
      reason: 'invalid-api-config',
      silent: mode === 'proactive',
      message: validationMessage,
    };
  }

  const pendingMessages =
    params.pendingMessages || (mode === 'manual' ? getManualPendingMessages(sourceMessages) : []);
  const allowEmptyPending = params.allowEmptyPending ?? mode === 'proactive';
  if (!allowEmptyPending && pendingMessages.length === 0) {
    return {
      status: 'skip',
      reason: 'no-pending',
      silent: mode === 'proactive',
      message: '褰撳墠娌℃湁寰呭彂閫佺殑鐢ㄦ埛娑堟伅',
    };
  }

  const beginResult = beginConversationGeneration(conversationKey, mode);
  if (beginResult.status === 'duplicate') {
    return {
      status: 'skip',
      reason: 'busy',
      silent: mode === 'proactive',
    };
  }
  if (beginResult.status === 'blocked') {
    return {
      status: 'skip',
      reason: 'blocked',
      silent: mode === 'proactive',
    };
  }

  const requestId = beginResult.requestId;
  const controller = beginResult.controller;
  const forwardAbort = () => controller.abort('outer-signal-aborted');
  if (outerSignal) {
    if (outerSignal.aborted) {
      controller.abort('outer-signal-aborted');
    } else {
      outerSignal.addEventListener('abort', forwardAbort);
    }
  }
  const innerSignal = controller.signal;

  try {
    throwIfAborted(innerSignal);

    const activeBookSummary = activeBookId ? readingPrefixSummaryByBookId[activeBookId] || '' : '';
    const normalizedUnderlineProbability = clamp(Math.floor(aiProactiveUnderlineProbability), 0, 100);
    const allowAiUnderlineInThisReply =
      aiProactiveUnderlineEnabled && Math.random() * 100 < normalizedUnderlineProbability;
    const memoryCountRaw = Number(memoryBubbleCount);
    const normalizedMemoryBubbleCount = Number.isFinite(memoryCountRaw)
      ? Math.round(memoryCountRaw)
      : DEFAULT_MEMORY_BUBBLE_COUNT;
    const replyMinRaw = Number(replyBubbleMin);
    const normalizedReplyMin = Number.isFinite(replyMinRaw)
      ? Math.round(replyMinRaw)
      : DEFAULT_REPLY_BUBBLE_MIN;
    const replyMaxRaw = Number(replyBubbleMax);
    const normalizedReplyMax = Number.isFinite(replyMaxRaw)
      ? Math.round(replyMaxRaw)
      : DEFAULT_REPLY_BUBBLE_MAX;
    const resolvedReplyBubbleMin = Math.min(normalizedReplyMin, normalizedReplyMax);
    const resolvedReplyBubbleMax = Math.max(normalizedReplyMin, normalizedReplyMax);

    const prompt = buildAiPrompt({
      mode,
      sourceMessages,
      pendingMessages,
      readingContext,
      allowAiUnderlineInThisReply,
      characterWorldBookEntries,
      userRealName,
      userNickname,
      characterRealName,
      characterNickname,
      characterDescription,
      activeBookTitle,
      activeBookSummary,
      chatHistorySummary,
      memoryBubbleCount: normalizedMemoryBubbleCount,
      replyBubbleMin: resolvedReplyBubbleMin,
      replyBubbleMax: resolvedReplyBubbleMax,
    });
    console.groupCollapsed(`[AI Prompt:${mode}] ${new Date().toLocaleTimeString()}`);
    console.log(prompt);
    console.groupEnd();

    const rawReply = await callAiModel(prompt, apiConfig, innerSignal);
    throwIfAborted(innerSignal);
    const parsedReply = parseAiReplyPayload(rawReply);
    const bubbleLines = normalizeAiBubbleLines(
      parsedReply.bubblePayload || rawReply,
      resolvedReplyBubbleMin,
      resolvedReplyBubbleMax
    );
    const generationId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    if (allowAiUnderlineInThisReply && parsedReply.underlineText && onAddAiUnderlineRange) {
      const underlineRange = findAiUnderlineRangeInExcerpt(parsedReply.underlineText, {
        excerpt: readingContext.excerpt,
        excerptStart: readingContext.excerptStart,
      });
      if (underlineRange) {
        onAddAiUnderlineRange({
          start: underlineRange.start,
          end: underlineRange.end,
          generationId,
        });
      }
    }

    const now = Date.now();
    const aiMessages: ChatBubble[] = bubbleLines.map((line, index) => {
      const timestamp = now + index * 1000;
      return {
        id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
        sender: 'character',
        content: compactText(line),
        timestamp,
        promptRecord: buildCharacterPromptRecord(characterRealName, line, timestamp),
        sentToAi: true,
        generationId,
      };
    });

    const pendingIds = new Set(pendingMessages.map((item) => item.id));
    const baseMessages = sourceMessages.map((message) =>
      pendingIds.has(message.id) ? { ...message, sentToAi: true } : message
    );

    return {
      status: 'ok',
      baseMessages,
      aiMessages,
      generationId,
    };
  } catch (error) {
    if (isAbortError(error) || innerSignal.aborted) {
      return {
        status: 'skip',
        reason: 'aborted',
        silent: true,
      };
    }
    return {
      status: 'skip',
      reason: 'error',
      silent: mode === 'proactive',
      message: error instanceof Error ? error.message : '发送失败',
    };
  } finally {
    if (outerSignal) {
      outerSignal.removeEventListener('abort', forwardAbort);
    }
    finishConversationGeneration(conversationKey, requestId, 'completed');
  }
};


