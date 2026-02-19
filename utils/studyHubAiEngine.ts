import { ApiConfig, Book, QuizConfig, QuizQuestion } from '../types';
import { Persona, Character, WorldBookEntry } from '../components/settings/types';
import { getBookContent, StoredBookContent } from './bookContentStorage';
import { callAiModel, sanitizeTextForAiPrompt, buildCharacterWorldBookSections, formatWorldBookSection } from './readerAiEngine';

// ─── 获取书籍的阅读进度对应的最大章节索引 ───

export const getMaxChapterIndexByProgress = (book: Book, stored: StoredBookContent | null): number => {
  if (!stored || !stored.chapters || stored.chapters.length === 0) return -1;

  const readerPos = stored.readerState?.readingPosition;
  if (readerPos && readerPos.chapterIndex !== null && readerPos.chapterIndex !== undefined) {
    return readerPos.chapterIndex;
  }

  const progress = book.progress || 0;
  return Math.max(0, Math.floor((progress / 100) * stored.chapters.length) - 1);
};

// ─── 获取书籍阅读进度的全局字符偏移量 ───

export const getReadingGlobalCharOffset = (book: Book, stored: StoredBookContent | null): number => {
  if (!stored) return 0;

  const readerPos = stored.readerState?.readingPosition;
  if (readerPos && readerPos.globalCharOffset > 0) {
    return readerPos.globalCharOffset;
  }

  const totalLength = stored.fullText?.length || stored.chapters?.reduce((sum, ch) => sum + (ch.content || '').length, 0) || 0;
  const progress = book.progress || 0;
  return Math.floor((progress / 100) * totalLength);
};

// ─── 为书籍准备完整的 AI 上下文（前情提要 + 阅读位置前原文） ───

export interface BookAiContext {
  bookId: string;
  title: string;
  context: string;
}

export const prepareBookContexts = async (
  books: Book[],
  bookIds: string[],
  readingExcerptCharCount: number,
): Promise<BookAiContext[]> => {
  const results: BookAiContext[] = [];

  for (const bookId of bookIds) {
    const book = books.find((b) => b.id === bookId);
    if (!book) continue;

    const stored = await getBookContent(bookId);
    if (!stored) continue;

    const maxIdx = getMaxChapterIndexByProgress(book, stored);

    // 1. 收集阅读进度前的前情提要总结卡片
    const globalOffset = getReadingGlobalCharOffset(book, stored);
    const summaryCards = (stored.bookSummaryCards || [])
      .filter((c) => c.end <= globalOffset)
      .sort((a, b) => a.start - b.start);
    const summaryText = summaryCards.map((c) => c.content).filter(Boolean).join('\n');

    // 2. 提取阅读位置前的原文（取尾部 readingExcerptCharCount 字符）
    let excerptText = '';
    if (stored.chapters && stored.chapters.length > 0 && maxIdx >= 0) {
      const readerPos = stored.readerState?.readingPosition;
      let fullTextUpToPosition = '';

      // 拼接到阅读位置的章节文本
      if (readerPos && readerPos.chapterIndex !== null && readerPos.chapterIndex !== undefined) {
        for (let i = 0; i < readerPos.chapterIndex; i++) {
          fullTextUpToPosition += sanitizeTextForAiPrompt(stored.chapters[i]?.content || '');
        }
        // 最后一章只取到 chapterCharOffset
        const lastChapterText = sanitizeTextForAiPrompt(stored.chapters[readerPos.chapterIndex]?.content || '');
        if (readerPos.chapterCharOffset > 0) {
          fullTextUpToPosition += lastChapterText.slice(0, readerPos.chapterCharOffset);
        } else {
          fullTextUpToPosition += lastChapterText;
        }
      } else {
        // fallback: 按进度百分比拼接
        for (let i = 0; i <= maxIdx; i++) {
          fullTextUpToPosition += sanitizeTextForAiPrompt(stored.chapters[i]?.content || '');
        }
      }

      excerptText = fullTextUpToPosition.slice(-readingExcerptCharCount);
    } else if (stored.fullText) {
      const charEnd = globalOffset;
      excerptText = sanitizeTextForAiPrompt(
        stored.fullText.slice(Math.max(0, charEnd - readingExcerptCharCount), charEnd),
      );
    }

    if (summaryText || excerptText) {
      let context = '';
      if (summaryText) context += `\u3010\u524D\u6587\u6897\u6982\u3011\n${summaryText}\n\n`;
      if (excerptText) context += `\u3010\u5F53\u524D\u9605\u8BFB\u4F4D\u7F6E\u9644\u8FD1\u539F\u6587\u3011\n${excerptText}`;
      results.push({ bookId, title: book.title, context: context.trim() });
    }
  }

  return results;
};

// ─── 共用工具：世界书分组 ───

const buildWorldBookPromptSection = (character: Character, worldBookEntries: WorldBookEntry[]): { before: string; after: string } => {
  const wbSections = buildCharacterWorldBookSections(character, worldBookEntries);
  return {
    before: wbSections.before.length > 0 ? formatWorldBookSection(wbSections.before, '【以下是补充信息】') : '',
    after: wbSections.after.length > 0 ? formatWorldBookSection(wbSections.after, '【以下是补充信息】') : '',
  };
};

const buildBookContextSection = (
  bookContexts: BookAiContext[],
  ragContextByBookId?: Record<string, string>,
): string => {
  if (bookContexts.length === 0) return '（暂无书籍内容）';
  return bookContexts
    .map((b) => {
      const rag = ragContextByBookId?.[b.bookId]?.trim() || '';
      const ragSection = rag ? `\n\n【相关书籍片段（语义检索）】\n${rag}` : '';
      return `《${b.title}》\n${b.context}${ragSection}`;
    })
    .join('\n\n');
};

// ─── AI 回复解析：提取 [评论] 内容 ───

export const parseStudyHubAiComment = (raw: string): string => {
  const trimmed = raw.trim();
  // 提取 [评论] 或 【评论】 后的内容
  const lines = trimmed.split('\n');
  const commentLines: string[] = [];
  for (const line of lines) {
    const m = line.match(/^(?:\[评论\]|【评论】)\s*(.*)$/);
    if (m) {
      commentLines.push(m[1].trim());
    }
  }
  if (commentLines.length > 0) return commentLines.join('\n');
  // fallback：去掉前缀标记返回原文
  return trimmed.replace(/^(?:\[评论\]|【评论】)\s*/gm, '').trim();
};

// ─── Prompt 构建：笔记批注 ───

interface BuildNoteCommentPromptParams {
  userPersona: Persona;
  character: Character;
  worldBookEntries: WorldBookEntry[];
  noteContent: string;
  bookContexts: BookAiContext[];
  conversationHistory?: Array<{ role: 'user' | 'ai'; content: string }>;
  ragContextByBookId?: Record<string, string>;
}

export const buildNoteCommentPrompt = (params: BuildNoteCommentPromptParams): string => {
  const { userPersona, character, worldBookEntries, noteContent, bookContexts, conversationHistory, ragContextByBookId } = params;

  const charNickname = character.nickname || character.name;
  const userNickname = userPersona.userNickname || userPersona.name;
  const wb = buildWorldBookPromptSection(character, worldBookEntries);

  const historySection = conversationHistory && conversationHistory.length > 0
    ? `\n<chat_history>\n${conversationHistory.map((m) => `${m.role === 'ai' ? charNickname : userNickname}：${m.content}`).join('\n')}\n</chat_history>\n`
    : '';

  return `<identity>
你现在就是${character.name}，用Ta的方式去感受、去说话。
你的昵称是「${charNickname}」，和你讨论的人叫${userPersona.name}，你叫Ta「${userNickname}」。
</identity>

<user_profile>
【${userPersona.name}的信息】
${sanitizeTextForAiPrompt(userPersona.description) || '（暂无用户信息）'}
</user_profile>

<char_profile>
${wb.before ? wb.before + '\n' : ''}【你是谁】
${sanitizeTextForAiPrompt(character.description)}
${wb.after ? '\n' + wb.after : ''}
</char_profile>

<book_context>
${buildBookContextSection(bookContexts, ragContextByBookId)}
</book_context>
<note_content>
【用户写的读书笔记】
${sanitizeTextForAiPrompt(noteContent)}
</note_content>
${historySection}
<scene>
【场景说明】这是一个读书笔记讨论区。${userNickname}写了一篇读书笔记，你需要作为${character.name}对笔记进行评论批注。主要围绕读书笔记内容讨论，偶尔也可以小跑题把关注点放在${userNickname}本身。
</scene>

<tone_and_style>
- 评论的内容和语气应体现你的性格特点和说话风格。
- 可以包含对笔记内容的赞同、补充、质疑或引申讨论。
- 评论应自然、有深度。
- 禁止使用星号或括号描写动作（如 *笑了笑*、（沉思）），直接用文字表达。
- 禁止剧透${userNickname}还没读到的内容。
</tone_and_style>

<output_format>
【回复格式（务必严格遵守，不能有任何例外）】
- 只输出1条评论。
- 评论必须以 [评论] 开头。
- [评论] 后面写评论内容。
- 不要输出任何解释、标题、编号或代码块。

[评论] 示例评论内容
</output_format>`;
};

// ─── Prompt 构建：笔记评论多轮对话 ───

interface BuildNoteReplyPromptParams {
  userPersona: Persona;
  character: Character;
  worldBookEntries: WorldBookEntry[];
  noteContent: string;
  bookContexts: BookAiContext[];
  previousMessages: Array<{ role: 'user' | 'ai'; content: string }>;
  latestUserReply: string;
  ragContextByBookId?: Record<string, string>;
}

export const buildNoteReplyPrompt = (params: BuildNoteReplyPromptParams): string => {
  const { userPersona, character, worldBookEntries, noteContent, bookContexts, previousMessages, latestUserReply, ragContextByBookId } = params;

  const charNickname = character.nickname || character.name;
  const userNickname = userPersona.userNickname || userPersona.name;
  const wb = buildWorldBookPromptSection(character, worldBookEntries);

  const historyLines = previousMessages
    .map((m) => `${m.role === 'ai' ? charNickname : userNickname}：${m.content}`)
    .join('\n');

  return `<identity>
你现在就是${character.name}，用Ta的方式去感受、去说话。
你的昵称是「${charNickname}」，和你讨论的人叫${userPersona.name}，你叫Ta「${userNickname}」。
</identity>

<user_profile>
【${userPersona.name}的信息】
${sanitizeTextForAiPrompt(userPersona.description) || '（暂无用户信息）'}
</user_profile>

<char_profile>
${wb.before ? wb.before + '\n' : ''}【你是谁】
${sanitizeTextForAiPrompt(character.description)}
${wb.after ? '\n' + wb.after : ''}
</char_profile>

<book_context>
${buildBookContextSection(bookContexts, ragContextByBookId)}
</book_context>
<note_content>
【原始笔记内容】
${sanitizeTextForAiPrompt(noteContent)}
</note_content>

<chat_history>
【之前的讨论】
${historyLines}

【${userNickname}的最新回复】
${userNickname}：${latestUserReply}
</chat_history>

<scene>
【场景说明】这是读书笔记讨论区中的多轮对话。${userNickname}在回复你之前的评论，请继续以角色身份延续讨论。
</scene>

<tone_and_style>
- 保持角色一致性，延续之前的讨论风格。
- 禁止使用星号或括号描写动作（如 *笑了笑*、（沉思）），直接用文字表达。
- 绝对不能剧透${userNickname}还没读到的内容。
</tone_and_style>

<output_format>
【回复格式（务必严格遵守，不能有任何例外）】
- 只输出1条回复。
- 回复必须以 [评论] 开头。
- [评论] 后面写回复内容。
- 不要输出任何解释、标题、编号或代码块。

[评论] 示例回复内容
</output_format>`;
};

// ─── Prompt 构建：生成问答题目 ───

interface BuildQuizGenerationPromptParams {
  bookContexts: BookAiContext[];
  config: QuizConfig;
  ragContextByBookId?: Record<string, string>;
}

export const buildQuizGenerationPrompt = (params: BuildQuizGenerationPromptParams): string => {
  const { bookContexts, config, ragContextByBookId } = params;

  const typeLabel = config.questionType === 'truefalse' ? '判断题' : config.questionType === 'multiple' ? '多选题' : '单选题';

  let typeInstruction = '';
  if (config.questionType === 'truefalse') {
    typeInstruction = '每道题只有"对"和"错"两个选项，correctAnswerIndices 为 [0] 表示"对"，[1] 表示"错"。';
  } else if (config.questionType === 'multiple') {
    typeInstruction = `每道题有 ${config.optionCount} 个选项，correctAnswerIndices 包含所有正确答案的索引（至少2个）。`;
  } else {
    typeInstruction = `每道题有 ${config.optionCount} 个选项，correctAnswerIndices 只包含1个正确答案的索引。`;
  }

  return `<book_context>
${buildBookContextSection(bookContexts, ragContextByBookId)}
</book_context>

<task>
根据以上书籍内容（包括前文梗概、当前阅读位置附近原文、以及语义检索到的相关片段），生成 ${config.questionCount} 道${typeLabel}。
${typeInstruction}
</task>

<user_requirements>
${config.customPrompt || '（无额外要求）'}
</user_requirements>

<tone_and_style>
- 题目应紧扣所提供的书籍内容，根据文本的实际体裁灵活出题（如小说考察情节与人物，论文考察论点与方法，哲学著作考察概念与论证，词汇表考察释义与用法，等等）。
- 优先参考用户的自定义提示词来决定出题方向和侧重点。
- 题目不能超出所提供的书籍内容范围（防止剧透）。
- 选项应具有迷惑性，避免明显的正确/错误答案。
- 答案解释应直接阐述理由，禁止提及"根据语义检索片段"、"根据RAG结果"等内部检索机制。
</tone_and_style>

<output_format>
请严格以以下 JSON 格式返回，不要返回其他任何内容：
[
  {
    "question": "题目内容",
    "options": ["选项A", "选项B", "选项C", "选项D"],
    "correctAnswerIndices": [0],
    "type": "${config.questionType}",
    "explanation": "答案解释"
  }
]
</output_format>`;
};

// ─── 解析 AI 返回的问答题目 ───

export const parseQuizQuestions = (raw: string): QuizQuestion[] => {
  const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[0]) as Array<Record<string, unknown>>;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item, index) => {
        if (!item || typeof item.question !== 'string') return null;
        const options = Array.isArray(item.options) ? item.options.map(String) : [];
        const correctAnswerIndices = Array.isArray(item.correctAnswerIndices)
          ? item.correctAnswerIndices.filter((i): i is number => typeof i === 'number')
          : [];

        return {
          id: `q_${Date.now()}_${index}`,
          question: item.question,
          options,
          correctAnswerIndices,
          type: (item.type as QuizQuestion['type']) || 'single',
          explanation: typeof item.explanation === 'string' ? item.explanation : '',
        };
      })
      .filter((q): q is QuizQuestion => q !== null);
  } catch {
    return [];
  }
};

// ─── Prompt 构建：问答总评 ───

interface BuildQuizOverallCommentParams {
  userPersona: Persona;
  character: Character;
  worldBookEntries: WorldBookEntry[];
  questions: QuizQuestion[];
  userAnswers: Record<string, number[]>;
  bookTitles: string[];
}

export const buildQuizOverallCommentPrompt = (params: BuildQuizOverallCommentParams): string => {
  const { userPersona, character, worldBookEntries, questions, userAnswers, bookTitles } = params;

  const charNickname = character.nickname || character.name;
  const userNickname = userPersona.userNickname || userPersona.name;
  const wb = buildWorldBookPromptSection(character, worldBookEntries);

  let correctCount = 0;
  const detailLines = questions.map((q, idx) => {
    const userAns = userAnswers[q.id] || [];
    const isCorrect =
      userAns.length === q.correctAnswerIndices.length &&
      userAns.every((a) => q.correctAnswerIndices.includes(a));
    if (isCorrect) correctCount++;

    const userOptions = userAns.map((i) => q.options[i] || `选项${i}`).join('、') || '未作答';
    const correctOptions = q.correctAnswerIndices.map((i) => q.options[i] || `选项${i}`).join('、');

    return `第${idx + 1}题：${q.question}\n用户答案：${userOptions}（${isCorrect ? '正确' : '错误'}）\n正确答案：${correctOptions}`;
  });

  return `<identity>
你现在就是${character.name}，用Ta的方式去感受、去说话。
你的昵称是「${charNickname}」，和你讨论的人叫${userPersona.name}，你叫Ta「${userNickname}」。
</identity>

<user_profile>
【${userPersona.name}的信息】
${sanitizeTextForAiPrompt(userPersona.description) || '（暂无用户信息）'}
</user_profile>

<char_profile>
${wb.before ? wb.before + '\n' : ''}【你是谁】
${sanitizeTextForAiPrompt(character.description)}
${wb.after ? '\n' + wb.after : ''}
</char_profile>

<quiz_result>
【测验信息】
${userNickname}刚完成了关于${bookTitles.map((t) => `《${t}》`).join('、')}的阅读理解测验。
总计 ${questions.length} 题，答对 ${correctCount} 题，正确率 ${Math.round((correctCount / Math.max(questions.length, 1)) * 100)}%。

【答题详情】
${detailLines.join('\n\n')}
</quiz_result>

<scene>
【场景说明】${userNickname}刚完成了一场阅读理解测验，请以角色身份对Ta的整体表现进行点评，包括总体评价、薄弱环节的建议、鼓励或鞭策。
</scene>

<tone_and_style>
- 点评应体现你的性格特点和说话风格。
- 禁止使用星号或括号描写动作（如 *笑了笑*、（沉思）），直接用文字表达。
</tone_and_style>

<output_format>
【回复格式（务必严格遵守，不能有任何例外）】
- 只输出1条评论。
- 评论必须以 [评论] 开头。
- [评论] 后面写评论内容。
- 不要输出任何解释、标题、编号或代码块。

[评论] 示例评论内容
</output_format>`;
};
