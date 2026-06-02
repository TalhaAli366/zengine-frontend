'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Search, ChevronDown, Loader2 } from 'lucide-react';

interface SearchableSelectOption {
  id: string | number;
  label: string;
  value: string;
}

interface SearchableSelectProps {
  label: string;
  placeholder?: string;
  searchType: 'campaign' | 'hashtag' | 'sound';
  value: string;
  onChange: (value: string, label?: string) => void;
  apiBaseUrl?: string;
}

export default function SearchableSelect({
  label,
  placeholder = 'Type to search...',
  searchType,
  value,
  onChange,
  apiBaseUrl = '/api/filters/search',
}: SearchableSelectProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchableSelectOption[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const search = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        type: searchType,
        q: searchQuery,
        limit: '20',
      });
      const response = await fetch(`${apiBaseUrl}?${params.toString()}`);
      if (!response.ok) {
        setResults([]);
        return;
      }
      const data = await response.json();
      const items: SearchableSelectOption[] = (data.data || []).map((item: any) => {
        if (searchType === 'campaign') {
          return { id: item.id, label: item.name, value: item.id };
        } else if (searchType === 'hashtag') {
          return { id: item.id, label: `#${item.tag}`, value: item.id.toString() };
        } else {
          return { id: item.id, label: item.name || item.sound_id, value: item.id.toString() };
        }
      });
      setResults(items);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [searchType, apiBaseUrl]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setIsOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      search(val);
    }, 1500);
  };

  const handleFocus = () => {
    setIsOpen(true);
    inputRef.current?.focus();
  };

  const handleSelect = (option: SearchableSelectOption) => {
    onChange(option.value, option.label);
    setSelectedLabel(option.label);
    setQuery('');
    setResults([]);
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange('');
    setSelectedLabel('');
    setQuery('');
    setResults([]);
    inputRef.current?.focus();
  };

  const hasValue = value !== '' && value !== undefined;

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        {label}
      </label>
      {hasValue && !isOpen ? (
        <div className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50">
          <span className="flex-1 text-sm text-gray-900 truncate">{selectedLabel}</span>
          <button
            type="button"
            onClick={handleClear}
            className="p-0.5 text-gray-400 hover:text-gray-600 transition-colors"
            title="Clear selection"
          >
            <X className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleFocus}
            className="p-0.5 text-gray-400 hover:text-gray-600 transition-colors"
            title="Change selection"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="w-4 h-4 text-gray-400" />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            onFocus={handleFocus}
            placeholder={placeholder}
            className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 text-sm"
          />
          {loading && (
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
              <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
            </div>
          )}
        </div>
      )}

      {isOpen && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {results.map((option) => (
            <button
              key={option.id}
              type="button"
              className="w-full text-left px-4 py-2 text-sm hover:bg-blue-50 text-gray-900 transition-colors"
              onClick={() => handleSelect(option)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {isOpen && !loading && query.length >= 1 && results.length === 0 && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-sm text-gray-500">
          No results found
        </div>
      )}
    </div>
  );
}