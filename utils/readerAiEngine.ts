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

export type PromptTokenSectionKey =
  | 'userPersona'
  | 'characterPersona'
  | 'worldBook'
  | 'bookExcerpt'
  | 'bookSummary'
  | 'chatRaw'
  | 'chatSummary'
  | 'otherInstructions';

export interface PromptTokenBreakdownItem {
  key: PromptTokenSectionKey;
  label: string;
  tokens: number;
}

export interface PromptTokenEstimate {
  totalTokens: number;
  sections: PromptTokenBreakdownItem[];
}

interface RunConversationGenerationParams {
  mode: GenerationMode;
  conversationKey: string;
  sourceMessages: ChatBubble[];
  apiConfig: ApiConfig;
  userRealName: string;
  userNickname: string;
  userDescription: string;
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
  ragContext?: string;
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
const DEFAULT_READING_EXCERPT_CHAR_COUNT = 800;
const DEFAULT_MEMORY_BUBBLE_COUNT = 100;
const DEFAULT_REPLY_BUBBLE_MIN = 3;
const DEFAULT_REPLY_BUBBLE_MAX = 8;
const CJK_CHAR_REGEX = /[\u3400-\u4DBF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/g;
const PROMPT_TOKEN_SECTION_ORDER: PromptTokenSectionKey[] = [
  'userPersona',
  'characterPersona',
  'worldBook',
  'bookExcerpt',
  'bookSummary',
  'chatRaw',
  'chatSummary',
  'otherInstructions',
];
const PROMPT_TOKEN_SECTION_LABELS: Record<PromptTokenSectionKey, string> = {
  userPersona: '用户人设',
  characterPersona: '角色人设',
  worldBook: '世界书',
  bookExcerpt: '书籍原文',
  bookSummary: '书籍总结',
  chatRaw: '聊天原文',
  chatSummary: '聊天总结',
  otherInstructions: '其他指令',
};

const DATA_IMAGE_REGEX = /data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=\s]+/gi;
const IMAGE_REF_REGEX = /idb:\/\/[a-zA-Z0-9._-]+/gi;
const IMAGE_TAG_REGEX = /<img\b[^>]*>/gi;
const MARKDOWN_IMAGE_REGEX = /!\[[^\]]*]\((data:image[^)]+|idb:\/\/[^)]+)\)/gi;
const IMAGE_PLACEHOLDER_REGEX = /\[(?:image|img|media|图片|图像)[：:][^\]]*]/gi;

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
    .split(/[。！？?!\n]+/)
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

  const fallback = lines[0] || '收到';
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
    .map((line) => line.match(/^\[气泡\]\s*(.+)$/)?.[1] || line.match(/^【气泡】\s*(.+)$/)?.[1] || '')
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
    const matched = line.match(/^\s*\[划线\]\s*(.+)\s*$/);
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

export const callAiModel = async (prompt: string, apiConfig: ApiConfig, signal?: AbortSignal) => {
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

export const formatWorldBookSection = (entries: WorldBookEntry[], title: string) => {
  if (entries.length === 0) return `${title}\n（无）`;
  const contents = entries
    .map((entry) => compactText(entry.content || ''))
    .filter(Boolean);
  if (contents.length === 0) return `${title}\n（无）`;
  return [title, ...contents].join('\n');
};

interface BuildAiPromptParams {
  mode: GenerationMode;
  sourceMessages: ChatBubble[];
  pendingMessages: ChatBubble[];
  readingContext: ReadingContextSnapshot;
  allowAiUnderlineInThisReply: boolean;
  characterWorldBookEntries: CharacterWorldBookSections;
  userRealName: string;
  userNickname: string;
  userDescription: string;
  characterRealName: string;
  characterNickname: string;
  characterDescription: string;
  activeBookTitle: string;
  activeBookSummary: string;
  chatHistorySummary: string;
  memoryBubbleCount: number;
  replyBubbleMin: number;
  replyBubbleMax: number;
  ragContext?: string;
}

interface PromptLineItem {
  section: PromptTokenSectionKey;
  text: string;
}

interface EstimateConversationPromptTokensParams {
  mode: GenerationMode;
  sourceMessages: ChatBubble[];
  pendingMessages?: ChatBubble[];
  readingContext: ReadingContextSnapshot;
  allowAiUnderlineInThisReply?: boolean;
  characterWorldBookEntries: CharacterWorldBookSections;
  userRealName: string;
  userNickname: string;
  userDescription: string;
  characterRealName: string;
  characterNickname: string;
  characterDescription: string;
  activeBookTitle: string;
  activeBookSummary: string;
  chatHistorySummary: string;
  memoryBubbleCount?: number;
  replyBubbleMin?: number;
  replyBubbleMax?: number;
}

const pushPromptLine = (target: PromptLineItem[], section: PromptTokenSectionKey, text: string) => {
  target.push({ section, text });
};

const estimateTokensByText = (raw: string) => {
  const text = raw.trim();
  if (!text) return 0;
  const cjkCount = (text.match(CJK_CHAR_REGEX) || []).length;
  const nonCjkLength = text.replace(CJK_CHAR_REGEX, '').replace(/\s+/g, '').length;
  return Math.max(1, cjkCount + Math.ceil(nonCjkLength / 4));
};

const buildAiPromptLineItems = (params: BuildAiPromptParams): PromptLineItem[] => {
  const {
    mode,
    sourceMessages,
    pendingMessages,
    readingContext,
    allowAiUnderlineInThisReply,
    characterWorldBookEntries,
    userRealName,
    userNickname,
    userDescription,
    characterRealName,
    characterDescription,
    activeBookTitle,
    activeBookSummary,
    chatHistorySummary,
    memoryBubbleCount,
    replyBubbleMin,
    replyBubbleMax,
    ragContext,
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
        ? `（这次是你主动找${userNickname}聊的）`
        : latestUserRecord;

  const safeExcerpt = sanitizeTextForAiPrompt(excerpt);
  const safeHasReadableExcerpt = compactText(safeExcerpt).length > 0;
  const safeHighlightedSnippets = highlightedSnippets.map((item) => sanitizeTextForAiPrompt(item)).filter(Boolean);
  const safeActiveBookSummary = sanitizeTextForAiPrompt(activeBookSummary);
  const safeChatHistorySummary = sanitizeTextForAiPrompt(chatHistorySummary);
  const safeRecentHistory = sanitizeTextForAiPrompt(recentHistory);
  const safePendingRecordText = sanitizeTextForAiPrompt(pendingRecordText);
  const safeUserDescription = sanitizeTextForAiPrompt(userDescription);

  const proactiveUnderlineRule = allowAiUnderlineInThisReply
    ? '【划线规则】如果读到触动你的句子，可以额外输出 0 或 1 行 `[划线] 文本`，这句话必须是当前读到的书中原句，禁止编造。'
    : '【划线规则】这次聊天不需要划线，不要输出任何 `[划线]` 行。';
  const triggerModeRule =
    mode === 'proactive'
      ? `【怎么聊】这次是你主动找${userNickname}说话——也许是读到了什么有感触的地方，也许只是想聊聊，如果有没回应的${userNickname}信息，先好好回应。`
      : `【怎么聊】这次是${userNickname}先开口找你聊的，好好回应吧。`;

  const lines: PromptLineItem[] = [];
  pushPromptLine(lines, 'otherInstructions', '<identity>');
  pushPromptLine(lines, 'characterPersona', `你现在就是 ${characterRealName}，用Ta的方式去感受、去说话。`);
  pushPromptLine(lines, 'userPersona', `和你一起读书的人叫${userRealName}，不过你叫Ta「${userNickname}」。`);
  pushPromptLine(lines, 'otherInstructions', triggerModeRule);
  pushPromptLine(lines, 'otherInstructions', '</identity>');
  pushPromptLine(lines, 'otherInstructions', '');
  pushPromptLine(lines, 'otherInstructions', '<user_profile>');
  pushPromptLine(lines, 'userPersona', `【${userRealName}的信息】`);
  pushPromptLine(lines, 'userPersona', safeUserDescription || '（暂无用户信息）');
  pushPromptLine(lines, 'otherInstructions', '</user_profile>');
  pushPromptLine(lines, 'otherInstructions', '');
  pushPromptLine(lines, 'otherInstructions', '<char_profile');
  pushPromptLine(lines, 'worldBook', formatWorldBookSection(characterWorldBookEntries.before, '【以下是补充信息】'));
  pushPromptLine(lines, 'characterPersona', '【你是谁】');
  pushPromptLine(lines, 'characterPersona', characterDescription);
  pushPromptLine(lines, 'worldBook', formatWorldBookSection(characterWorldBookEntries.after, '【以下是补充信息】'));
  pushPromptLine(lines, 'otherInstructions', '</char_profile>');
  pushPromptLine(lines, 'otherInstructions', '');
  pushPromptLine(lines, 'otherInstructions', '<book_context>');
  pushPromptLine(lines, 'otherInstructions', `【你们在读的书】${activeBookTitle || '还没选好要读什么'}`);
  pushPromptLine(lines, 'bookSummary', `【书籍前文梗概】${safeActiveBookSummary || '（还没整理出来）'}`);
  pushPromptLine(lines, 'otherInstructions', '');
  pushPromptLine(lines, 'otherInstructions', '【现在读到的书籍内容】');
  pushPromptLine(lines, 'bookExcerpt', safeHasReadableExcerpt ? safeExcerpt : '（暂时还没加载出来）');
  pushPromptLine(lines, 'otherInstructions', '');
  pushPromptLine(lines, 'otherInstructions', `【「${userNickname}」印象深刻的句子】`);
  pushPromptLine(
    lines,
    'bookExcerpt',
    safeHighlightedSnippets.length > 0
      ? safeHighlightedSnippets.map((item) => `- ${item}`).join('\n')
      : '（目前还没有）'
  );
  pushPromptLine(
    lines,
    'otherInstructions',
    safeHighlightedSnippets.length === 0
      ? '【注意】现在没有任何被标记的句子，不要假装有，禁止编造。'
      : ''
  );
  pushPromptLine(lines, 'otherInstructions', '</book_context>');
  if (ragContext) {
    pushPromptLine(lines, 'otherInstructions', '');
    pushPromptLine(lines, 'otherInstructions', '<rag_context>');
    pushPromptLine(lines, 'bookExcerpt', '【相关书籍片段（语义检索）】');
    pushPromptLine(lines, 'bookExcerpt', ragContext);
    pushPromptLine(lines, 'otherInstructions', '</rag_context>');
  }
  pushPromptLine(lines, 'otherInstructions', '');
  pushPromptLine(lines, 'otherInstructions', '<chat_history>');
  pushPromptLine(lines, 'chatSummary', `【之前聊天话题】${safeChatHistorySummary || '（还未整理）'}`);
  pushPromptLine(lines, 'otherInstructions', '');
  pushPromptLine(lines, 'otherInstructions', '【最近的聊天记录】');
  pushPromptLine(lines, 'chatRaw', safeRecentHistory || '（你们还没开始聊）');
  pushPromptLine(lines, 'otherInstructions', '</chat_history>');
  pushPromptLine(lines, 'otherInstructions', '');
  pushPromptLine(lines, 'otherInstructions', '<tone_and_style>');
  pushPromptLine(lines, 'otherInstructions', `- 现在的场景是你和${userNickname}在一起读同一本书，随时可以聊两句。`);
  pushPromptLine(lines, 'otherInstructions', '- 说话要自然、口语化、短句，可省略标点，像在手机上打字聊天。');
  pushPromptLine(lines, 'otherInstructions', `- ${userNickname}还没读到后面的内容，绝对不能剧透。`);
  pushPromptLine(lines, 'otherInstructions', '- 如果没有被标记的句子，不要提任何不存在的标记内容。');
  pushPromptLine(lines, 'otherInstructions', proactiveUnderlineRule);
  pushPromptLine(lines, 'otherInstructions', '</tone_and_style>');
  pushPromptLine(lines, 'otherInstructions', '');
  pushPromptLine(lines, 'otherInstructions', '<output_format>');
  pushPromptLine(lines, 'otherInstructions', '【回复格式（务必严格遵守，不能有任何例外）】');
  pushPromptLine(lines, 'otherInstructions', `- 只分行回复 ${replyBubbleMin} 到 ${replyBubbleMax} 条消息。`);
  pushPromptLine(lines, 'otherInstructions', '- 每条消息必须以 [气泡] 开头。');
  pushPromptLine(lines, 'otherInstructions', '- [气泡] 后面写一条自然的聊天消息。');
  pushPromptLine(
    lines,
    'otherInstructions',
    allowAiUnderlineInThisReply
      ? '- 每条划线消息必须以 [划线] 开头，最多出现 1 行，可以不写。'
      : ''
  );
  pushPromptLine(lines, 'otherInstructions', '- 不要输出任何解释、标题、编号或代码块。');
  pushPromptLine(lines, 'otherInstructions', '');
  pushPromptLine(lines, 'otherInstructions', '[气泡] 示例');
  pushPromptLine(lines, 'otherInstructions', '[气泡] 继续示例');
  pushPromptLine(lines, 'otherInstructions', '[气泡] 结束示例');
  pushPromptLine(lines, 'otherInstructions', '</output_format>');
  return lines;
};

const buildAiPrompt = (params: BuildAiPromptParams) =>
  buildAiPromptLineItems(params)
    .map((item) => item.text)
    .filter(Boolean)
    .join('\n');

const getManualPendingMessages = (sourceMessages: ChatBubble[]) => {
  const pending = sourceMessages.filter((message) => message.sender === 'user' && !message.sentToAi);
  const lastMessage = sourceMessages[sourceMessages.length - 1] || null;
  const fallbackLatestUserMessage = pending.length === 0 && lastMessage?.sender === 'user' ? lastMessage : null;
  return fallbackLatestUserMessage ? [fallbackLatestUserMessage] : pending;
};

export const estimateConversationPromptTokens = (
  params: EstimateConversationPromptTokensParams
): PromptTokenEstimate => {
  const memoryCountRaw = Number(params.memoryBubbleCount);
  const normalizedMemoryBubbleCount = Number.isFinite(memoryCountRaw)
    ? Math.round(memoryCountRaw)
    : DEFAULT_MEMORY_BUBBLE_COUNT;
  const replyMinRaw = Number(params.replyBubbleMin);
  const normalizedReplyMin = Number.isFinite(replyMinRaw)
    ? Math.round(replyMinRaw)
    : DEFAULT_REPLY_BUBBLE_MIN;
  const replyMaxRaw = Number(params.replyBubbleMax);
  const normalizedReplyMax = Number.isFinite(replyMaxRaw)
    ? Math.round(replyMaxRaw)
    : DEFAULT_REPLY_BUBBLE_MAX;
  const resolvedReplyBubbleMin = Math.min(normalizedReplyMin, normalizedReplyMax);
  const resolvedReplyBubbleMax = Math.max(normalizedReplyMin, normalizedReplyMax);
  const pendingMessages =
    params.pendingMessages || (params.mode === 'manual' ? getManualPendingMessages(params.sourceMessages) : []);
  const promptLines = buildAiPromptLineItems({
    mode: params.mode,
    sourceMessages: params.sourceMessages,
    pendingMessages,
    readingContext: params.readingContext,
    allowAiUnderlineInThisReply: Boolean(params.allowAiUnderlineInThisReply),
    characterWorldBookEntries: params.characterWorldBookEntries,
    userRealName: params.userRealName,
    userNickname: params.userNickname,
    userDescription: params.userDescription,
    characterRealName: params.characterRealName,
    characterNickname: params.characterNickname,
    characterDescription: params.characterDescription,
    activeBookTitle: params.activeBookTitle,
    activeBookSummary: params.activeBookSummary,
    chatHistorySummary: params.chatHistorySummary,
    memoryBubbleCount: normalizedMemoryBubbleCount,
    replyBubbleMin: resolvedReplyBubbleMin,
    replyBubbleMax: resolvedReplyBubbleMax,
  });

  const sectionTexts = PROMPT_TOKEN_SECTION_ORDER.reduce<Record<PromptTokenSectionKey, string>>((acc, key) => {
    acc[key] = '';
    return acc;
  }, {} as Record<PromptTokenSectionKey, string>);

  promptLines.forEach((line) => {
    if (!line.text) return;
    sectionTexts[line.section] = sectionTexts[line.section]
      ? `${sectionTexts[line.section]}\n${line.text}`
      : line.text;
  });

  const sections = PROMPT_TOKEN_SECTION_ORDER.map((key) => ({
    key,
    label: PROMPT_TOKEN_SECTION_LABELS[key],
    tokens: estimateTokensByText(sectionTexts[key]),
  }));

  return {
    totalTokens: sections.reduce((sum, item) => sum + item.tokens, 0),
    sections,
  };
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
  excerptCharCount?: number;
}): ReadingContextSnapshot => {
  const { chapters, bookText, highlightRangesByChapter, readingPosition } = params;
  const visibleRatio = clamp(params.visibleRatio || 0, 0, 1);
  const excerptCharCountRaw = Number(params.excerptCharCount);
  const excerptCharCount =
    Number.isFinite(excerptCharCountRaw)
      ? Math.max(0, Math.round(excerptCharCountRaw))
      : DEFAULT_READING_EXCERPT_CHAR_COUNT;

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
  const start = clamp(contextEnd - excerptCharCount, 0, contextEnd);
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
    userDescription,
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
    ragContext,
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
      userDescription,
      characterRealName,
      characterNickname,
      characterDescription,
      activeBookTitle,
      activeBookSummary,
      chatHistorySummary,
      memoryBubbleCount: normalizedMemoryBubbleCount,
      replyBubbleMin: resolvedReplyBubbleMin,
      replyBubbleMax: resolvedReplyBubbleMax,
      ragContext,
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


