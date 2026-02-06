import React, { useState, useEffect, useRef } from 'react';
import { 
  ChevronDown, 
  Send, 
  Sparkles, 
  MoreHorizontal, 
  Highlighter, 
  Bookmark,
  ArrowLeft,
  Type
} from 'lucide-react';
import { Message } from '../types';

interface ReaderProps {
  onBack: () => void;
  isDarkMode: boolean;
}

const Reader: React.FC<ReaderProps> = ({ onBack, isDarkMode }) => {
  // State for AI Panel
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(true);
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', sender: 'ai', text: '你好！我是你的陪读助手。这本书的开篇非常有意思，特别是关于主角身世的描写。', timestamp: new Date() }
  ]);
  const [inputText, setInputText] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const scrollMessagesToBottom = (behavior: ScrollBehavior = 'auto') => {
    if (!messagesContainerRef.current) return;
    messagesContainerRef.current.scrollTo({
      top: messagesContainerRef.current.scrollHeight,
      behavior
    });
  };

  // Auto-scroll chat
  useEffect(() => {
    if (!isAiPanelOpen) return;
    const rafId = window.requestAnimationFrame(() => {
      scrollMessagesToBottom('smooth');
      setHasUnreadMessages(false);
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [messages, isAiPanelOpen]);

  // Simulate AI receiving context or triggering a message
  const handleSimulateAiMessage = () => {
    if (!isAiPanelOpen) {
      setHasUnreadMessages(true);
    }
    
    const newMsg: Message = {
      id: Date.now().toString(),
      sender: 'ai',
      text: '注意这里，这句心理描写暗示了后来剧情的反转，非常精妙。',
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, newMsg]);
  };

  const handleSendMessage = () => {
    if (!inputText.trim()) return;
    
    const userMsg: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: inputText,
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    
    // Simulate thinking and reply
    setTimeout(() => {
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: '确实如此。这个观点很有趣，结合之前的设定来看，完全解释得通。',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiMsg]);
      if (!isAiPanelOpen) setHasUnreadMessages(true);
    }, 1500);
  };

  return (
    <div className={`flex flex-col h-full relative overflow-hidden transition-colors duration-300 ${isDarkMode ? 'dark-mode bg-[#2d3748] text-slate-300' : 'bg-[#e0e5ec] text-slate-700'}`}>
      
      {/* Top Bar (Reader Tools - Neumorphic) */}
      <div className={`flex justify-between items-center p-4 z-10 transition-colors ${isDarkMode ? 'bg-[#2d3748]' : 'bg-[#e0e5ec]'}`}>
        <button onClick={onBack} className="w-10 h-10 neu-btn rounded-full text-slate-500 hover:text-slate-700">
          <ArrowLeft size={20} />
        </button>
        <div className="flex gap-2 text-sm font-serif font-medium opacity-70">
          第一章：重逢
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

      {/* Main Reading Area - Paper Sheet effect */}
      <div 
        className={`flex-1 overflow-y-auto m-4 mt-0 rounded-2xl shadow-inner transition-colors px-6 py-6 pb-24
          ${isDarkMode ? 'bg-[#1a202c] shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)]' : 'bg-[#f0f2f5] shadow-[inset_4px_4px_8px_#d1d9e6,inset_-4px_-4px_8px_#ffffff]'}
        `}
        onClick={() => {
            if(Math.random() > 0.7) handleSimulateAiMessage(); 
        }}
      >
        <article className={`prose prose-lg max-w-none font-serif leading-loose ${isDarkMode ? 'prose-invert text-slate-400' : 'text-slate-800'}`}>
           <p className="mb-6 indent-8 text-justify">
             那是一个异常闷热的午后，空气中弥漫着即将到来的暴雨的土腥味。林觉站在那扇斑驳的红漆木门前，手停在半空，迟迟没有敲下去。由于长途跋涉，他的衬衫早已湿透，紧紧贴在后背上，但他似乎感觉不到这些不适。他的全部注意力都被门缝里透出的一丝微光吸引住了。
           </p>
           <p className="mb-6 indent-8 text-justify">
             十年前，就是在这扇门前，他发誓永远不再回来。那时候的他年轻气盛，觉得外面的世界无比广阔，任何束缚都是对自由的亵渎。然而此刻，当他真的走遍了所谓的广阔天地，才发现最让他魂牵梦绕的，依然是这方寸之地。
           </p>
           <p className="mb-6 indent-8 text-justify">
             <span className={`${isDarkMode ? 'bg-rose-900/40 text-rose-200' : 'bg-yellow-100 text-slate-900'} cursor-pointer px-1 rounded transition-colors border-b-2 ${isDarkMode ? 'border-rose-700' : 'border-yellow-300'}`}>
               "你终究还是回来了。"
             </span>
             一个苍老的声音从身后传来。林觉猛地回头，看见李叔正坐在巷口的石墩上，手里摇着那把破旧的蒲扇，眼神浑浊却又似乎洞穿了一切。
           </p>
           <p className="mb-6 indent-8 text-justify">
             林觉苦笑了一声："是啊，李叔，我回来了。"
           </p>
           <p className="mb-6 indent-8 text-justify">
             街道两旁的梧桐树比记忆中更加高大粗壮了，遮天蔽日的叶子在风中沙沙作响。他依稀记得小时候和伙伴们在这里捉迷藏的情景，那时的笑声仿佛还回荡在耳边。可是现在，除了风声，什么也没有。时间的洪流冲刷了一切，只留下这些静默的见证者。
           </p>
           <p className="mb-6 indent-8 text-justify">
             他深吸了一口气，终于叩响了门环。清脆的金属撞击声在寂静的巷子里显得格外刺耳。没过多久，门内传来了脚步声，很轻，很慢，每一步都像是踩在他的心尖上。
           </p>
           {[...Array(5)].map((_, i) => (
             <p key={i} className="mb-6 indent-8 text-justify opacity-50">
               （此处省略后续五百字... Neumorphism 风格已应用到 UI 组件，阅读区域保持纸质质感以确保长时间阅读的舒适度。）
             </p>
           ))}
        </article>
      </div>

      {/* Floating Action Buttons */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 hidden">
          <div className="neu-flat text-slate-600 rounded-full flex p-2 gap-4">
            <button className="p-2 hover:text-rose-400"><Highlighter size={20} /></button>
            <button className="p-2 hover:text-rose-400"><Bookmark size={20} /></button>
            <button className="px-3 py-1 bg-rose-400 text-white rounded-full text-sm font-bold shadow-lg">Ask AI</button>
          </div>
      </div>

      {/* AI Notification Badge */}
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
         className={`absolute bottom-6 right-6 w-12 h-12 neu-btn rounded-full z-20 text-rose-400`}
       >
         <Sparkles size={20} />
       </button>
      )}

      {/* AI Panel (Collapsible Split Screen - Neumorphic) */}
      <div 
        className={`absolute bottom-0 left-0 right-0 h-[40vh] transition-[transform,opacity] duration-500 ease-in-out z-30 
          ${isAiPanelOpen ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'}
          ${isDarkMode ? 'bg-[#2d3748] rounded-t-3xl shadow-[0_-5px_20px_rgba(0,0,0,0.4)]' : 'neu-flat rounded-t-3xl'}
        `}
        style={{ boxShadow: isDarkMode ? '' : '0 -10px 20px -5px rgba(163,177,198, 0.4)' }}
      >
        {/* Drag Handle */}
        <div 
          className="h-8 flex items-center justify-center cursor-pointer opacity-60 hover:opacity-100"
          onClick={() => setIsAiPanelOpen(false)}
        >
          <div className={`w-12 h-1.5 rounded-full ${isDarkMode ? 'bg-slate-600' : 'bg-slate-300'}`} />
        </div>

        <div className="flex flex-col h-[calc(100%-2rem)]">
          {/* Chat Header */}
          <div className="px-6 pb-2 flex justify-between items-center mx-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full neu-pressed flex items-center justify-center text-[10px] text-rose-400 font-bold border-2 border-transparent">
                AI
              </div>
              <span className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                剧情解析助手
              </span>
            </div>
            <button onClick={() => setIsAiPanelOpen(false)} className="w-8 h-8 neu-btn rounded-full text-slate-400 hover:text-slate-600">
              <ChevronDown size={16} />
            </button>
          </div>

          {/* Messages Area */}
          <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4 px-6" style={{ overflowAnchor: 'none' }}>
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div 
                  className={`max-w-[85%] px-5 py-3 text-sm leading-relaxed
                    ${msg.sender === 'user' 
                      ? isDarkMode ? 'bg-rose-500 text-white rounded-2xl rounded-br-none shadow-md' : 'bg-rose-400 text-white rounded-2xl rounded-br-none shadow-[5px_5px_10px_#d1d5db,-5px_-5px_10px_#ffffff]'
                      : isDarkMode 
                        ? 'bg-[#1a202c] text-slate-300 rounded-2xl rounded-bl-none shadow-md'
                        : 'neu-flat text-slate-700 rounded-2xl rounded-bl-none'
                    }
                  `}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 pb-6">
            <div className={`flex items-center gap-3 rounded-full px-2 py-2 ${isDarkMode ? 'bg-[#1a202c] shadow-inner' : 'neu-pressed'}`}>
              <input 
                type="text" 
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="询问关于剧情、人物的问题..."
                className={`flex-1 bg-transparent outline-none text-sm min-w-0 px-4 ${isDarkMode ? 'text-slate-200 placeholder-slate-600' : 'text-slate-700'}`}
              />
              <button 
                onClick={handleSendMessage}
                disabled={!inputText.trim()}
                className={`p-2 rounded-full transition-all ${
                  inputText.trim() 
                    ? isDarkMode ? 'bg-rose-400 text-white' : 'neu-flat text-rose-400 active:scale-95' 
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
