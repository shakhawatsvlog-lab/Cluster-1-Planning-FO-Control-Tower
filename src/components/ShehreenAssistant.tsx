import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowRight,
  Bot,
  Check,
  Copy,
  Globe,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import type { FactoryName } from '../shared/plannerTypes.ts';
import type { NavTab } from './Sidebar.tsx';
import { apiUrl } from '../lib/apiBase.ts';
import { buildAdminHeaders } from '../lib/adminSession.ts';

export type ShehreenMode = 'control_tower' | 'master_plan';
export type ShehreenTargetTab = NavTab | 'master_plan' | 'fo_needed';

export interface ShehreenAction {
  navigateTab?: ShehreenTargetTab | '';
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
  mode?: ShehreenMode;
  currentTab: string;
  selectedFactory: FactoryName | 'ALL';
  selectedLine: string;
  onApplyAction: (action: ShehreenAction) => void;
}

const MASTER_PLAN_STARTER_PROMPTS = [
  {
    label: 'FO Needed Today',
    prompt: 'Which Running and immediate Upcoming PGs currently need FO?',
  },
  {
    label: 'Cutting & Output',
    prompt: 'Show the current Cutting Qty, Output Qty, and Packing Qty summary by factory.',
  },
  {
    label: 'Output Start Dates',
    prompt: 'Which lines have upcoming style changes soon, and when does Output Start begin?',
  },
  {
    label: 'Excel Formula',
    prompt: 'How do I calculate PG-wise total cutting qty in Excel using SUMIFS?',
  },
  {
    label: 'Any Language',
    prompt: 'Can you summarize ALEX 1 current running styles in Bengali?',
  },
];

const CONTROL_TOWER_STARTER_PROMPTS = [
  {
    label: 'Recent FO Needed',
    prompt: 'Which recent Running and immediate Upcoming PGs need FO right now?',
  },
  {
    label: 'Draft FO Email',
    prompt: 'Write a short polite email to our fabric team requesting urgent FO release.',
  },
  {
    label: 'Excel Formula Help',
    prompt: 'How do I calculate PG-wise total cutting qty in Excel using SUMIFS?',
  },
  {
    label: 'Output & Issue Qty',
    prompt: 'What is the factory-wise Issue Qty, and when does new style output start on each line?',
  },
  {
    label: 'Team Productivity',
    prompt: 'Share 3 quick practical tips to speed up our daily garments planning workflow.',
  },
];

const DEFAULT_WELCOME_TEXT =
  "Hello! I'm **SHEHREEN**, your smart AI teammate for Alex Apparels.\n\nAsk me anything in **English** (default) — live Master Plan & FO data, Cutting/Output/Packing summaries, buyer email drafts, Excel formulas, or garment math. You can also write in **Bengali, Banglish, Hindi, Urdu, Arabic, or any language**, and I'll reply fluently in that language!";

const DEFAULT_RESET_TEXT =
  'Fresh chat ready! Ask me anything in English or any other language — live Master Plan data, FO status, Excel formulas, garment calculations, or email drafts.';

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
  mode = 'control_tower',
  currentTab,
  selectedFactory,
  selectedLine,
  onApplyAction,
}: ShehreenAssistantProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-shehreen',
      role: 'model',
      text: DEFAULT_WELCOME_TEXT,
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const starterPrompts =
    mode === 'master_plan' ? MASTER_PLAN_STARTER_PROMPTS : CONTROL_TOWER_STARTER_PROMPTS;

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

      const isPublicMasterPlan = mode === 'master_plan';
      const res = await fetch(apiUrl('/api/assistant/chat'), {
        method: 'POST',
        ...(isPublicMasterPlan ? {} : { credentials: 'include' as const }),
        headers: isPublicMasterPlan
          ? { 'Content-Type': 'application/json' }
          : buildAdminHeaders(true),
        signal: controller.signal,
        body: JSON.stringify({
          message: trimmed,
          history: historyPayload,
          scope: mode,
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
        navigateTab?: ShehreenTargetTab | '';
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
        text: DEFAULT_RESET_TEXT,
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
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom,0px))] right-[max(1rem,env(safe-area-inset-right,0px))] z-40 inline-flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-gradient-to-r from-[#07132c] via-[#0d2147] to-[#0e7490] hover:brightness-110 text-white shadow-[0_14px_32px_-12px_rgba(8,145,178,0.6)] border border-cyan-400/35 transition-all cursor-pointer group touch-manipulation"
        >
          <span className="w-8 h-8 rounded-lg bg-cyan-500/25 border border-cyan-300/35 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-cyan-200" />
          </span>
          <span className="text-left">
            <span className="block text-xs font-bold tracking-wide leading-none">SHEHREEN AI</span>
            <span className="block text-[10px] text-cyan-200/85 mt-1 leading-none">
              Ask Anything · All Languages
            </span>
          </span>
        </button>
      )}

      {open && (
        <aside
          aria-label="SHEHREEN AI Assistant"
          className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:inset-x-auto sm:bottom-[max(1rem,env(safe-area-inset-bottom,0px))] sm:right-[max(1rem,env(safe-area-inset-right,0px))] z-50 sm:w-[440px] h-[min(640px,calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-1.5rem))] ct-surface rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-[#07132c] via-[#0d2147] to-[#0a2d42] text-white px-4 py-3.5 border-b border-cyan-400/20 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center shrink-0 shadow-xs">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-sm font-bold tracking-wide truncate">
                    SHEHREEN
                  </h2>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold inline-flex items-center gap-1">
                    <Globe className="w-2.5 h-2.5" />
                    <span>EN Default · All Langs</span>
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 truncate">
                  {mode === 'master_plan'
                    ? 'Master Plan AI · Live Planning & FO Helper'
                    : 'Team Assistant · Live Planning, FO & Work Helper'}
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
          <div className="px-3 py-2 bg-slate-50/90 border-b border-slate-200 flex items-center gap-1.5 overflow-x-auto shrink-0">
            {starterPrompts.map((item) => (
              <button
                key={item.label}
                type="button"
                disabled={sending}
                onClick={() => void sendMessage(item.prompt)}
                className="px-2.5 py-1 rounded-lg bg-white hover:bg-cyan-50 border border-slate-200 hover:border-cyan-300 text-[11px] font-medium text-slate-700 hover:text-cyan-900 whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50"
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
                        ? 'bg-gradient-to-r from-[#0a1633] to-cyan-700 text-white rounded-br-sm'
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
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#0a1633] to-cyan-700 hover:brightness-110 text-white text-[11px] font-semibold transition-all cursor-pointer shadow-sm"
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
                  <span>Shehreen is writing a reply...</span>
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
              placeholder="Ask in English or any language (Bengali, Hindi, Arabic, etc.)..."
              disabled={sending}
              className="flex-1 px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 focus:bg-white focus:border-cyan-600 focus:outline-none text-xs text-slate-900 resize-none leading-snug"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send message to Shehreen"
              className="h-10 px-3.5 rounded-xl bg-gradient-to-r from-[#0a1633] to-cyan-700 hover:brightness-110 disabled:opacity-40 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
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
