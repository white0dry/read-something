import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  ChevronDown,
  Highlighter,
  MoreHorizontal,
  Send,
  Sparkles,
  Type,
} from 'lucide-react';
import { Book, Message } from '../types';
import { getBookContent } from '../utils/bookContentStorage';

interface ReaderProps {
  onBack: () => void;
  isDarkMode: boolean;
  activeBook: Book | null;
}

const Reader: React.FC<ReaderProps> = ({ onBack, isDarkMode, activeBook }) => {
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(true);
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      sender: 'ai',
      text: '你好，我是你的陪读助手。你可以随时问我剧情、人物或细节问题。',
      timestamp: new Date(),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [bookText, setBookText] = useState('');
  const [isLoadingBookContent, setIsLoadingBookContent] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const scrollMessagesToBottom = (behavior: ScrollBehavior = 'auto') => {
    if (!messagesContainerRef.current) return;
    messagesContainerRef.current.scrollTo({
      top: messagesContainerRef.current.scrollHeight,
      behavior,
    });
  };

  useEffect(() => {
    if (!isAiPanelOpen) return;
    const rafId = window.requestAnimationFrame(() => {
      scrollMessagesToBottom('smooth');
      setHasUnreadMessages(false);
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [messages, isAiPanelOpen]);

  useEffect(() => {
    let cancelled = false;

    const loadBookText = async () => {
      if (!activeBook) {
        setBookText('');
        setIsLoadingBookContent(false);
        return;
      }

      setIsLoadingBookContent(true);
      try {
        const content = await getBookContent(activeBook.id);
        if (!cancelled) {
          setBookText(content?.fullText || activeBook.fullText || '');
        }
      } catch (error) {
        console.error('Failed to load reader content:', error);
        if (!cancelled) {
          setBookText(activeBook.fullText || '');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingBookContent(false);
        }
      }
    };

    loadBookText();
    return () => {
      cancelled = true;
    };
  }, [activeBook?.id]);

  const paragraphs = useMemo(() => {
    const normalizedText = bookText.replace(/\r\n/g, '\n').trim();
    if (!normalizedText) return [];

    const splitByBlankLine = normalizedText
      .split(/\n{2,}/)
      .map(p => p.trim())
      .filter(Boolean);

    if (splitByBlankLine.length > 1) return splitByBlankLine;

    return normalizedText
      .split('\n')
      .map(p => p.trim())
      .filter(Boolean);
  }, [bookText]);

  const handleSimulateAiMessage = () => {
    if (!isAiPanelOpen) setHasUnreadMessages(true);

    const newMsg: Message = {
      id: Date.now().toString(),
      sender: 'ai',
      text: '这个片段的情绪变化很关键，建议结合前后段一起看。',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, newMsg]);
  };

  const handleSendMessage = () => {
    if (!inputText.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: inputText,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText('');

    window.setTimeout(() => {
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: '收到。我可以继续帮你拆解这一段的叙事重点。',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, aiMsg]);
      if (!isAiPanelOpen) setHasUnreadMessages(true);
    }, 800);
  };

  const wordCount = activeBook?.fullTextLength || bookText.length;

  return (
    <div
      className={`flex flex-col h-full relative overflow-hidden transition-colors duration-300 ${
        isDarkMode ? 'dark-mode bg-[#2d3748] text-slate-300' : 'bg-[#e0e5ec] text-slate-700'
      }`}
    >
      <div className={`flex justify-between items-center p-4 z-10 transition-colors ${isDarkMode ? 'bg-[#2d3748]' : 'bg-[#e0e5ec]'}`}>
        <button onClick={onBack} className="w-10 h-10 neu-btn rounded-full text-slate-500 hover:text-slate-700">
          <ArrowLeft size={20} />
        </button>
        <div className="flex gap-2 text-sm font-serif font-medium opacity-70 min-w-0">
          <span className="truncate">{activeBook?.title || '阅读中'}</span>
          {activeBook && <span className="text-xs opacity-80 whitespace-nowrap">{wordCount}字</span>}
        </div>
        <div className="flex gap-3">
          <button className="w-10 h-10 neu-btn rounded-full text-slate-500 hover:text-slate-700">
            <Type size={18} />
          </button>
          <button className="w-10 h-10 neu-btn rounded-full text-slate-500 hover:text-slate-700">
            <MoreHorizontal size={18} />
          </button>
        </div>
      </div>

      <div
        className={`flex-1 overflow-y-auto m-4 mt-0 rounded-2xl shadow-inner transition-colors px-6 py-6 pb-24 ${
          isDarkMode ? 'bg-[#1a202c] shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)]' : 'bg-[#f0f2f5] shadow-[inset_4px_4px_8px_#d1d9e6,inset_-4px_-4px_8px_#ffffff]'
        }`}
        onClick={() => {
          if (Math.random() > 0.7) handleSimulateAiMessage();
        }}
      >
        <article className={`prose prose-lg max-w-none font-serif leading-loose ${isDarkMode ? 'prose-invert text-slate-400' : 'text-slate-800'}`}>
          {!activeBook && <p className="mb-6 indent-8 text-justify opacity-70">未选择书籍，请返回书架选择一本书。</p>}
          {activeBook && isLoadingBookContent && <p className="mb-6 indent-8 text-justify opacity-70">正在加载正文内容...</p>}
          {activeBook && !isLoadingBookContent && paragraphs.length === 0 && (
            <p className="mb-6 indent-8 text-justify opacity-70">这本书还没有正文内容。</p>
          )}
          {activeBook && !isLoadingBookContent && paragraphs.map((paragraph, index) => (
            <p key={index} className="mb-6 indent-8 text-justify">
              {paragraph}
            </p>
          ))}
        </article>
      </div>

      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 hidden">
        <div className="neu-flat text-slate-600 rounded-full flex p-2 gap-4">
          <button className="p-2 hover:text-rose-400"><Highlighter size={20} /></button>
          <button className="p-2 hover:text-rose-400"><Bookmark size={20} /></button>
          <button className="px-3 py-1 bg-rose-400 text-white rounded-full text-sm font-bold shadow-lg">Ask AI</button>
        </div>
      </div>

      {!isAiPanelOpen && hasUnreadMessages && (
        <button
          onClick={() => setIsAiPanelOpen(true)}
          className="absolute bottom-6 right-6 bg-rose-400 text-white px-4 py-3 rounded-full shadow-lg hover:bg-rose-500 transition-all animate-bounce flex items-center gap-2 z-20"
        >
          <Sparkles size={18} />
          <span className="text-sm font-medium">新消息</span>
        </button>
      )}

      {!isAiPanelOpen && !hasUnreadMessages && (
        <button
          onClick={() => setIsAiPanelOpen(true)}
          className="absolute bottom-6 right-6 w-12 h-12 neu-btn rounded-full z-20 text-rose-400"
        >
          <Sparkles size={20} />
        </button>
      )}

      <div
        className={`absolute bottom-0 left-0 right-0 h-[40vh] transition-[transform,opacity] duration-500 ease-in-out z-30 ${
          isAiPanelOpen ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'
        } ${isDarkMode ? 'bg-[#2d3748] rounded-t-3xl shadow-[0_-5px_20px_rgba(0,0,0,0.4)]' : 'neu-flat rounded-t-3xl'}`}
        style={{ boxShadow: isDarkMode ? '' : '0 -10px 20px -5px rgba(163,177,198, 0.4)' }}
      >
        <div className="h-8 flex items-center justify-center cursor-pointer opacity-60 hover:opacity-100" onClick={() => setIsAiPanelOpen(false)}>
          <div className={`w-12 h-1.5 rounded-full ${isDarkMode ? 'bg-slate-600' : 'bg-slate-300'}`} />
        </div>

        <div className="flex flex-col h-[calc(100%-2rem)]">
          <div className="px-6 pb-2 flex justify-between items-center mx-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full neu-pressed flex items-center justify-center text-[10px] text-rose-400 font-bold border-2 border-transparent">
                AI
              </div>
              <span className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                剧情分析助手
              </span>
            </div>
            <button onClick={() => setIsAiPanelOpen(false)} className="w-8 h-8 neu-btn rounded-full text-slate-400 hover:text-slate-600">
              <ChevronDown size={16} />
            </button>
          </div>

          <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4 px-6" style={{ overflowAnchor: 'none' }}>
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] px-5 py-3 text-sm leading-relaxed ${
                    msg.sender === 'user'
                      ? isDarkMode
                        ? 'bg-rose-500 text-white rounded-2xl rounded-br-none shadow-md'
                        : 'bg-rose-400 text-white rounded-2xl rounded-br-none shadow-[5px_5px_10px_#d1d5db,-5px_-5px_10px_#ffffff]'
                      : isDarkMode
                      ? 'bg-[#1a202c] text-slate-300 rounded-2xl rounded-bl-none shadow-md'
                      : 'neu-flat text-slate-700 rounded-2xl rounded-bl-none'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 pb-6">
            <div className={`flex items-center gap-3 rounded-full px-2 py-2 ${isDarkMode ? 'bg-[#1a202c] shadow-inner' : 'neu-pressed'}`}>
              <input
                type="text"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                placeholder="询问关于剧情、人物的内容..."
                className={`flex-1 bg-transparent outline-none text-sm min-w-0 px-4 ${
                  isDarkMode ? 'text-slate-200 placeholder-slate-600' : 'text-slate-700'
                }`}
              />
              <button
                onClick={handleSendMessage}
                disabled={!inputText.trim()}
                className={`p-2 rounded-full transition-all ${
                  inputText.trim()
                    ? isDarkMode
                      ? 'bg-rose-400 text-white'
                      : 'neu-flat text-rose-400 active:scale-95'
                    : 'text-slate-400 opacity-50'
                }`}
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Reader;
