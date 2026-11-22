import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowRight,
  Bot,
  Check,
  Copy,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import type { FactoryName } from '../shared/plannerTypes.ts';
import type { NavTab } from './Sidebar.tsx';

export interface ShehreenAction {
  navigateTab?: NavTab | '';
  filterFactory?: FactoryName | 'ALL' | '';
  filterLine?: string;
  searchQuery?: string;
  actionLabel?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  action?: ShehreenAction;
  isError?: boolean;
  retryPrompt?: string;
}

interface ShehreenAssistantProps {
  open: boolean;
  onToggleOpen: (open: boolean) => void;
  currentTab: NavTab;
  selectedFactory: FactoryName | 'ALL';
  selectedLine: string;
  onApplyAction: (action: ShehreenAction) => void;
}

const STARTER_PROMPTS = [
  {
    label: 'Recent FO Needed',
    prompt: 'Kon kon recent Running ar immediate Upcoming PG gulote ekhon FO lagbe?',
  },
  {
    label: 'Draft FO Email',
    prompt: 'Write a short polite email to our fabric team requesting urgent FO release.',
  },
  {
    label: 'Excel Formula Help',
    prompt: 'Excel-e SUMIFS formula diye PG-wise total cutting qty kibhabe ber korbo?',
  },
  {
    label: 'Output & Issue Qty',
    prompt: 'Factory-wise Issue Qty koto ebong kon line e new style output kobe start hobe?',
  },
  {
    label: 'Team Chat / Friendly Help',
    prompt: 'Hey Shehreen! Ajke team er kaj easy korar jonno 3 ta quick productivity tip daw.',
  },
];

function formatInlineSegments(line: string, keyPrefix: string): ReactNode[] {
  const tokens = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return tokens.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={`${keyPrefix}-b-${idx}`} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={`${keyPrefix}-c-${idx}`}
          className="px-1 py-0.5 rounded bg-slate-100 text-slate-900 font-mono text-[11px]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={`${keyPrefix}-t-${idx}`}>{part}</span>;
  });
}

function renderFormattedReply(text: string, isUser: boolean): ReactNode {
  if (isUser) {
    return <span className="whitespace-pre-wrap">{text}</span>;
  }
  const lines = text.split('\n');
  return (
    <div className="space-y-1">
      {lines.map((line, idx) => {
        if (!line.trim()) {
          return <div key={`sp-${idx}`} className="h-1" />;
        }
        return (
          <div key={`ln-${idx}`} className="leading-relaxed break-words">
            {formatInlineSegments(line, `ln-${idx}`)}
          </div>
        );
      })}
    </div>
  );
}

export function ShehreenAssistant({
  open,
  onToggleOpen,
  currentTab,
  selectedFactory,
  selectedLine,
  onApplyAction,
}: ShehreenAssistantProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-shehreen',
      role: 'model',
      text:
        'Assalamu Alaikum! Ami **SHEHREEN**, apnar team-er friend & smart AI teammate.\n\nAmake je kono kichu jiggesh korte paren — email draft, Excel formula, garment/IE math, translation, casual team chat, ba live PG/FO/Output Start/Cutting data. English, বাংলা, ba Banglish-e likhun!',
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending, open]);

  const sendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || sending) return;

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      role: 'user',
      text: trimmed,
    };

    const historyPayload = messages
      .filter((m) => m.id !== 'welcome-shehreen' && !m.isError)
      .slice(-10)
      .map((m) => ({ role: m.role, text: m.text }));

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 45_000);

      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message: trimmed,
          history: historyPayload,
          currentTab,
          selectedFactory,
          selectedLine,
        }),
      });
      window.clearTimeout(timeoutId);

      const rawBody = await res.text();
      let data: {
        ok?: boolean;
        reply?: string;
        navigateTab?: NavTab | '';
        filterFactory?: FactoryName | 'ALL' | '';
        filterLine?: string;
        searchQuery?: string;
        actionLabel?: string;
        error?: string;
      } = {};
      try {
        data = JSON.parse(rawBody);
      } catch {
        data = { ok: false, error: 'Server returned an unexpected response. Please try again.' };
      }

      if (!res.ok || !data.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: 'model',
            text: data.error || 'Shehreen could not complete your request right now.',
            isError: true,
            retryPrompt: trimmed,
          },
        ]);
        return;
      }

      const hasAction = Boolean(
        data.navigateTab || data.filterFactory || data.filterLine || data.searchQuery
      );

      setMessages((prev) => [
        ...prev,
        {
          id: `mod-${Date.now()}`,
          role: 'model',
          text: data.reply || 'Done!',
          action: hasAction
            ? {
                navigateTab: data.navigateTab || '',
                filterFactory: data.filterFactory || '',
                filterLine: data.filterLine || '',
                searchQuery: data.searchQuery || '',
                actionLabel: data.actionLabel || 'Open Matching View',
              }
            : undefined,
        },
      ]);
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'model',
          text: isAbort
            ? 'Request timed out — please click Retry and Shehreen will answer right away.'
            : 'Network error while contacting Shehreen AI. Please try again.',
          isError: true,
          retryPrompt: trimmed,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleCopyText = async (msgId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text.replace(/\*\*/g, ''));
      setCopiedId(msgId);
      setTimeout(() => setCopiedId((prev) => (prev === msgId ? null : prev)), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleResetChat = () => {
    setMessages([
      {
        id: 'welcome-shehreen',
        role: 'model',
        text:
          'Fresh chat ready! Ami **SHEHREEN** — team chat, buyer email draft, Excel formula, garment math, ba live PG/FO/Output Start sob kichute ami help korte pari!',
      },
    ]);
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => onToggleOpen(true)}
          aria-label="Open SHEHREEN AI Assistant"
          className="fixed bottom-4 right-4 z-50 inline-flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-900 hover:bg-blue-600 text-white shadow-lg border border-slate-700 transition-colors cursor-pointer group"
        >
          <span className="w-8 h-8 rounded-lg bg-blue-600 group-hover:bg-white/20 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </span>
          <span className="text-left">
            <span className="block text-xs font-bold tracking-wide leading-none">SHEHREEN AI</span>
            <span className="block text-[10px] text-slate-300 mt-1 leading-none">
              Team Friend · Ask Anything
            </span>
          </span>
        </button>
      )}

      {open && (
        <aside
          aria-label="SHEHREEN AI Assistant"
          className="fixed inset-x-3 bottom-3 sm:inset-x-auto sm:bottom-4 sm:right-4 z-50 sm:w-[440px] h-[min(640px,calc(100dvh-2rem))] bg-white border border-slate-200 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="bg-slate-900 text-white px-4 py-3.5 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-sm font-bold tracking-wide truncate">
                    SHEHREEN
                  </h2>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold">
                    AI Friend
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 truncate">
                  Team Friend · Work Helper · Live Planning &amp; FO
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleResetChat}
                title="Reset conversation"
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onToggleOpen(false)}
                title="Close Shehreen"
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Starter Prompt Chips */}
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-1.5 overflow-x-auto shrink-0">
            {STARTER_PROMPTS.map((item) => (
              <button
                key={item.label}
                type="button"
                disabled={sending}
                onClick={() => void sendMessage(item.prompt)}
                className="px-2.5 py-1 rounded-lg bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 text-[11px] font-medium text-slate-700 hover:text-blue-800 whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50"
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-3.5 space-y-3 bg-slate-50/50"
          >
            {messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                      isUser
                        ? 'bg-blue-700 text-white rounded-br-sm'
                        : msg.isError
                          ? 'bg-red-50 text-red-800 border border-red-200 rounded-bl-sm'
                          : 'bg-white text-slate-800 border border-slate-200 shadow-sm rounded-bl-sm'
                    }`}
                  >
                    {renderFormattedReply(msg.text, isUser)}
                  </div>

                  {!isUser && !msg.isError && msg.id !== 'welcome-shehreen' && (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {msg.action && (
                        <button
                          type="button"
                          onClick={() => onApplyAction(msg.action!)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-blue-700 text-white text-[11px] font-semibold transition-colors cursor-pointer shadow-sm"
                        >
                          <span>{msg.action.actionLabel || 'Open Matching Page & Filter'}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleCopyText(msg.id, msg.text)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-200/70 transition-colors cursor-pointer"
                      >
                        {copiedId === msg.id ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span className="text-emerald-700">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {msg.isError && msg.retryPrompt && (
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => void sendMessage(msg.retryPrompt!)}
                      className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Retry</span>
                    </button>
                  )}
                </div>
              );
            })}

            {sending && (
              <div className="flex items-start">
                <div className="px-3.5 py-2.5 rounded-2xl rounded-bl-sm bg-white border border-slate-200 text-xs text-slate-600 inline-flex items-center gap-2 shadow-sm">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                  <span>Shehreen reply likhche...</span>
                </div>
              </div>
            )}
          </div>

          {/* Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage(input);
            }}
            className="p-3 bg-white border-t border-slate-200 flex items-end gap-2 shrink-0"
          >
            <textarea
              ref={inputRef}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage(input);
                }
              }}
              placeholder="Ask anything — email draft, Excel formula, PG/FO, or chat with Shehreen..."
              disabled={sending}
              className="flex-1 px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 focus:bg-white focus:border-blue-500 focus:outline-none text-xs text-slate-900 resize-none leading-snug"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send message to Shehreen"
              className="h-10 px-3.5 rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-40 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send</span>
            </button>
          </form>
        </aside>
      )}
    </>
  );
}
