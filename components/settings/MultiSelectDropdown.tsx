
import React, { useState, useRef, useEffect } from 'react';
import { X, ChevronDown, Check } from 'lucide-react';

interface MultiSelectDropdownProps {
  options: string[];
  selected: string[];
  onChange: (val: string[]) => void;
  placeholder?: string;
  inputClass: string;
  cardClass: string;
  isDarkMode: boolean;
}

const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({ 
  options, 
  selected, 
  onChange, 
  placeholder = "选择...",
  inputClass,
  cardClass,
  isDarkMode
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleSelection = (option: string) => {
    if (selected.includes(option)) {
      onChange(selected.filter(s => s !== option));
    } else {
      onChange([...selected, option]);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      {/* Trigger Area - Displays Selected Chips */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full p-2 min-h-[42px] rounded-xl flex items-center justify-between cursor-pointer ${inputClass}`}
      >
        <div className="flex flex-wrap gap-1.5 w-full pr-6">
          {selected.length === 0 && <span className="text-sm opacity-50 px-2">{placeholder}</span>}
          {selected.map(item => (
            <span key={item} className="bg-rose-400 text-white text-xs px-2 py-1 rounded-lg flex items-center gap-1">
              {item}
              <span 
                onClick={(e) => { e.stopPropagation(); toggleSelection(item); }}
                className="hover:text-rose-100 cursor-pointer"
              >
                <X size={10} />
              </span>
            </span>
          ))}
        </div>
        <div className="absolute right-3 opacity-50">
           <ChevronDown size={16} />
        </div>
      </div>

      {/* Dropdown Options */}
      {isOpen && (
        <div className={`absolute top-full left-0 right-0 mt-2 p-2 rounded-xl z-[100] max-h-48 overflow-y-auto ${cardClass} border border-slate-400/10`}>
          {options.length > 0 ? options.map(opt => (
            <div 
              key={opt}
              onClick={() => toggleSelection(opt)}
              className={`flex items-center gap-2 p-2 rounded-lg text-sm cursor-pointer transition-colors ${
                selected.includes(opt) 
                  ? 'text-rose-400 font-bold bg-rose-400/10' 
                  : isDarkMode ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
               <div className={`w-4 h-4 rounded border flex items-center justify-center ${selected.includes(opt) ? 'bg-rose-400 border-rose-400' : 'border-slate-400'}`}>
                  {selected.includes(opt) && <Check size={10} className="text-white" />}
               </div>
               {opt}
            </div>
          )) : (
            <div className="p-2 text-xs text-slate-400 text-center">无可用选项</div>
          )}
        </div>
      )}
    </div>
  );
};

export default MultiSelectDropdown;
