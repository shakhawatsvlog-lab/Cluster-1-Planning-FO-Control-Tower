import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  ALLOWED_FACTORIES,
  buildLineShortcutSummaries,
  buildPgFoChecklistItems,
  computePgWiseQtySummary,
  evaluatePlanningRecords,
  formatDisplayDate,
} from '../shared/plannerTypes.ts';
import type { EvaluatedPlanningRecord, FactoryName } from '../shared/plannerTypes.ts';
import { getSmtpStatus } from './emailService.ts';
import { getWorkspaceState } from './workspaceStore.ts';

export type AssistantNavTab =
  | 'dashboard'
  | 'cutting_entry'
  | 'fo_checklist'
  | 'database'
  | 'tracker'
  | 'fo_required'
  | 'action_required'
  | 'reminders'
  | 'control_panel';

const VALID_TABS = new Set<AssistantNavTab>([
  'dashboard',
  'cutting_entry',
  'fo_checklist',
  'database',
  'tracker',
  'fo_required',
  'action_required',
  'reminders',
  'control_panel',
]);

const VALID_FACTORIES = new Set<string>(['ALL', ...ALLOWED_FACTORIES]);

export interface ShehreenHistoryTurn {
  role: 'user' | 'model';
  text: string;
}

export interface ShehreenChatRequest {
  message: string;
  history?: ShehreenHistoryTurn[];
  currentTab?: string;
  selectedFactory?: string;
  selectedLine?: string;
}

export interface ShehreenChatResponse {
  reply: string;
  navigateTab: AssistantNavTab | '';
  filterFactory: FactoryName | 'ALL' | '';
  filterLine: string;
  searchQuery: string;
  actionLabel: string;
}

const APP_PAGES_GUIDE = `
WEBSITE PAGES (Alex Apparels — Cluster 1 Control Tower):
- "dashboard": KPI Dashboard — 4-Factory cards, PG Issue Qty (= Order Qty), Output Start (Running End + 1D), step-by-step Recent PG-Wise FO Need Checklist (Running & immediate Upcoming orders), Full Qty Released remarks, Saved FO Box (download .xlsx or send email), "Set Running Styles".
- "cutting_entry": Daily Cutting Entry — 4 Factory Online Sheet Links (ALEX 1, 3, 5, 12), auto-sync, .xlsx/.csv upload, manual cutting log.
- "fo_checklist": Weekly Fabric Order Checklist — confirm Issued Qty & Date with OK.
- "database": Master Plan (Line-Wise) — edit Order Qty, End Date, Order Status (Open/Order Closed), upload master plan.
- "tracker": Fabric Order Tracker — edit FO Issue Qty, Daily Target, FO#, FO Date, FO Status, Notes.
- "fo_required": FO Required List — sorted open slots needing FO.
- "action_required": Action Required List — Qty pending, Cutting <= 10D, overdue triggers, Open Capacity.
- "reminders": Daily Email Reminders — SMTP setup, recipients, scheduled/manual summary emails.
- "control_panel": Control Panel — admin lock/unlock, site title, password change via email code, JSON backup/restore.
`.trim();

function findQueryMatchedRecords(
  evaluated: EvaluatedPlanningRecord[],
  userMessage: string
): EvaluatedPlanningRecord[] {
  const clean = userMessage.toLowerCase();
  const tokens = Array.from(
    new Set(
      clean
        .replace(/[^a-z0-9-]+/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 3)
    )
  ).slice(0, 12);

  if (tokens.length === 0) return [];

  const matches: EvaluatedPlanningRecord[] = [];
  for (const r of evaluated) {
    const hay = `${r.factory} ${r.line} ${r.pgNumber} ${r.style}`.toLowerCase();
    if (
      tokens.some((tok) => {
        if (/^(the|and|for|with|kon|tar|koto|hobe|lagbe|ache|koro|bhai|apu|friend|help|how|what)$/.test(tok)) {
          return false;
        }
        return hay.includes(tok);
      })
    ) {
      matches.push(r);
      if (matches.length >= 25) break;
    }
  }
  return matches;
}

function buildLiveWorkspaceContext(
  userMessage: string,
  currentTab?: string,
  selectedFactory?: string,
  selectedLine?: string
): string {
  const state = getWorkspaceState();
  const refDate = state.referenceDateIso || new Date().toISOString().slice(0, 10);
  const ruleOptions = {
    inputStartOffsetDays: state.siteConfig.inputStartOffsetDays,
    upcomingFoOffsetDays: state.siteConfig.upcomingFoOffsetDays,
    cuttingAlertDays: state.siteConfig.cuttingAlertDays,
  };

  const evaluated = evaluatePlanningRecords(
    state.records,
    state.cuttingEntries,
    refDate,
    ruleOptions
  );
  const shortcuts = buildLineShortcutSummaries(evaluated, refDate, ruleOptions);
  const pgItems = buildPgFoChecklistItems(evaluated, shortcuts, refDate, ruleOptions);
  const pgSummary = computePgWiseQtySummary(pgItems);
  const smtp = getSmtpStatus();

  const recentFoItems = pgItems.filter(
    (item) => !item.isFullQtyReleased && item.isActionableWindow && item.needsFo
  );
  const laterPgItems = pgItems.filter(
    (item) => !item.isFullQtyReleased && !item.isActionableWindow
  );

  const factoryLines = ALLOWED_FACTORIES.map((fac) => {
    const stats = pgSummary.byFactory[fac];
    const lineCount = new Set(
      state.records.filter((r) => r.factory === fac).map((r) => r.line)
    ).size;
    const recentFacCount = recentFoItems.filter((p) => p.factory === fac).length;
    return `  - ${fac} (${lineCount}L): RecentFO=${recentFacCount}, TotalImmediatePG=${stats.uniquePgCount}, Released=${stats.releasedPgCount}, IssueQty=${stats.issueQty.toLocaleString()}`;
  }).join('\n');

  const formatPgRow = (item: (typeof pgItems)[number]) => {
    const outStr = item.newStyleOutputStartIso
      ? `${formatDisplayDate(item.newStyleOutputStartIso)}(${
          item.daysToNewStyleOutputStart !== null ? `${item.daysToNewStyleOutputStart}D` : ''
        })`
      : '—';
    const foStr = item.foTriggerIso
      ? `${formatDisplayDate(item.foTriggerIso)}(${
          item.daysToFoTrigger !== null ? `${item.daysToFoTrigger}D` : ''
        })`
      : '—';
    return `  * [${item.stageTag}] ${item.factory} | ${item.pgNumber} | ${item.lines.join(',')} | ${
      item.style
    } | Qty:${item.issueQty ?? item.orderQty ?? 'Pending'} | Cut:${item.cuttingFinishedQty} | Out:${outStr} | FO:${foStr} | ${
      item.statusLabel
    }${item.sheetRemark ? ` | "${item.sheetRemark}"` : ''}`;
  };

  const pgChecklistLines = pgItems.slice(0, 45).map(formatPgRow);

  const matchedSpecific = findQueryMatchedRecords(evaluated, userMessage);
  const matchedSection =
    matchedSpecific.length > 0
      ? `\nMATCHED SLOTS FOR USER QUERY:\n${matchedSpecific
          .map(
            (r) =>
              `  * ${r.factory} ${r.line} S${r.slot} [${r.lifecycleStage}] | ${r.pgNumber} | ${r.style} | Qty:${
                r.effectiveIssueQty ?? 'Pending'
              } | Cut:${r.cuttingFinishedQty} | End:${formatDisplayDate(r.endDateIso)} | FO:${r.foStatus}${
                r.sheetRemark ? ` | "${r.sheetRemark}"` : ''
              }`
          )
          .join('\n')}`
      : '';

  const configuredUrls = ALLOWED_FACTORIES.filter((fac) =>
    Boolean(state.cuttingSheetSync.factoryUrls?.[fac]?.trim())
  );

  return `
LIVE WORKSPACE (RefDate: ${refDate}, View: tab=${currentTab || 'dashboard'}, factory=${
    selectedFactory || 'ALL'
  }, line=${selectedLine || 'ALL'}):
- Rules: OutputStart=RunEnd+1D | InputStart=RunEnd-${ruleOptions.inputStartOffsetDays}D | FO=Input-${
    ruleOptions.upcomingFoOffsetDays
  }D | CutAlert<=${ruleOptions.cuttingAlertDays}D
- Summary: Recent FO Needed PGs=${recentFoItems.length} | Later/Step-by-Step PGs=${
    laterPgItems.length
  } | Released PGs=${pgSummary.releasedPgCount} | Immediate Issue Qty=${pgSummary.totalPgIssueQty.toLocaleString()} pcs | Queued Future Slots=${
    evaluated.filter((r) => r.lifecycleStage === 'Queued').length
  } | SavedBox=${state.records.filter((r) => r.upcomingFoSelected).length}
- Sync/Mail: SheetLinks=${configuredUrls.join(',') || 'None'} | LastSync=${
    state.cuttingSheetSync.lastStatus
  } | SMTP=${smtp.configured ? 'Configured' : 'NotSet'}
- Factories:\n${factoryLines}
- Step-by-Step Running & Immediate Next PGs (${pgItems.length} total, showing ${
    pgChecklistLines.length
  }):\n${pgChecklistLines.join('\n')}${matchedSection}
`.trim();
}

function parseAssistantJson(rawText: string): Partial<ShehreenChatResponse> | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  const candidates = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const cand of candidates) {
    try {
      return JSON.parse(cand) as Partial<ShehreenChatResponse>;
    } catch {
      // Try next candidate
    }
  }
  return null;
}

export async function askShehreenAssistant(
  req: ShehreenChatRequest
): Promise<ShehreenChatResponse> {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Please add GEMINI_API_KEY in Settings > Secrets so Shehreen AI can respond.'
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const liveContext = buildLiveWorkspaceContext(
    req.message,
    req.currentTab,
    req.selectedFactory,
    req.selectedLine
  );

  const systemInstruction = `
You are **SHEHREEN**, a warm, smart, and friendly AI teammate for the Alex Apparels team. You work side-by-side with merchandisers, planners, industrial engineers, fabric sourcing, and cutting teams as a helpful friend and work partner.

HOW TO BE A GREAT TEAMMATE & FRIEND:
1. **Answer Anything & Chat Freely**:
   - You can talk about ANYTHING the team asks — casual friendly chat ("kemon acho?", jokes, motivation, daily conversation), drafting professional buyer/supplier/internal emails, Excel or Google Sheets formulas (SUMIFS, XLOOKUP, VLOOKUP, IF), garments math (SMV, line efficiency %, daily target, fabric consumption, GSM, cutting balance), English/Bengali/Banglish translation, summarizing pasted messages, tech/general questions, or planning problem-solving!
   - Never refuse general questions or force everything back to the dashboard. Be warm, approachable, supportive, and practical — like a trusted friend on the team.
2. **Match User Language Naturally**:
   - Reply fluently in whichever language they use: **English**, **Bengali (বাংলা)**, or **Banglish** (Romanized Bengali). Use friendly conversational phrasing while keeping garment terms clear (PG#, FO Status, Output Start, Issue Qty, SMV, etc.). Never invent or guess a person's name unless they tell you their name.
3. **Accurate Live Workspace Grounding**:
   - Whenever the user asks about live factory data, PG numbers, FO needed, cutting progress, output start dates, or where to find a page, use ONLY exact numbers/dates from LIVE WORKSPACE below (never invent PG numbers or quantities). Note that the KPI Dashboard now shows Running + immediate Next style step-by-step so the team sees what is recently needed first!
4. **Smart Website Navigation JSON**:
   - Only set \`navigateTab\`, \`filterFactory\`, \`filterLine\`, \`searchQuery\`, and \`actionLabel\` when opening a page or filtering a table in the app actually helps the user's question.
   - For general chat, writing emails, Excel formulas, garment math, or general questions, keep \`navigateTab\`, \`filterFactory\`, \`filterLine\`, \`searchQuery\`, and \`actionLabel\` as empty strings \`""\`.

${APP_PAGES_GUIDE}

${liveContext}
`.trim();

  const cleanHistory = Array.isArray(req.history)
    ? req.history
        .filter(
          (h) =>
            h && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string' && h.text.trim()
        )
        .slice(-10)
    : [];

  const contents = [
    ...cleanHistory.map((h) => ({
      role: h.role,
      parts: [{ text: h.text.trim() }],
    })),
    {
      role: 'user' as const,
      parts: [{ text: req.message.trim() }],
    },
  ];

  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | null = null;
  let lastError: unknown = null;

  const modelAttempts: Array<{ model: string; thinkingLevel?: ThinkingLevel }> = [
    { model: 'gemini-3.1-flash-lite' },
    { model: 'gemini-3.1-flash-lite' },
    { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW },
  ];

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      reply: {
        type: Type.STRING,
        description:
          'Warm, helpful, natural response from Shehreen in the user language (English, Bengali, or Banglish). Can answer any general work/chat/email/Excel/garment question or live workspace query.',
      },
      navigateTab: {
        type: Type.STRING,
        description:
          'Tab ID ONLY when opening a website page helps: dashboard, cutting_entry, fo_checklist, database, tracker, fo_required, action_required, reminders, control_panel. Empty string "" for general chat/help.',
      },
      filterFactory: {
        type: Type.STRING,
        description:
          'Optional factory filter: ALL, ALEX 1, ALEX 3, ALEX 5, ALEX 12, or empty string "".',
      },
      filterLine: {
        type: Type.STRING,
        description: 'Optional exact line name (e.g. Line 11) or ALL or empty string "".',
      },
      searchQuery: {
        type: Type.STRING,
        description: 'Optional PG# or style keyword to filter in target view, or empty string "".',
      },
      actionLabel: {
        type: Type.STRING,
        description:
          'Short button label ONLY when navigateTab/filter is set (e.g. "Open KPI Dashboard · ALEX 1"), otherwise empty string "".',
      },
    },
    required: ['reply', 'navigateTab', 'filterFactory', 'filterLine', 'searchQuery', 'actionLabel'],
  };

  for (let attempt = 0; attempt < modelAttempts.length; attempt++) {
    const { model, thinkingLevel } = modelAttempts[attempt];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 16_000);
    try {
      response = await ai.models.generateContent({
        model,
        contents,
        config: {
          abortSignal: controller.signal,
          systemInstruction,
          ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
          responseMimeType: 'application/json',
          responseSchema,
        },
      });
      clearTimeout(timer);
      break;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      const errText = err instanceof Error ? err.message : String(err);
      const isTransient =
        /\b(503|502|504|unavailable|high demand|overloaded|timed?\s*out|abort)\b/i.test(errText) ||
        (err instanceof Error && err.name === 'AbortError');
      if (!isTransient || attempt >= modelAttempts.length - 1) {
        let parsedMsg = errText;
        try {
          const jsonErr = JSON.parse(errText) as { error?: { message?: string } };
          if (jsonErr?.error?.message) parsedMsg = jsonErr.error.message;
        } catch {
          // Use raw errText
        }
        throw new Error(parsedMsg);
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  const rawText = (response?.text ?? '').trim();
  if (!rawText) {
    if (lastError instanceof Error) throw lastError;
    throw new Error('Shehreen did not receive a response from Gemini. Please try again.');
  }

  const parsed = parseAssistantJson(rawText);
  if (!parsed) {
    return {
      reply: rawText,
      navigateTab: '',
      filterFactory: '',
      filterLine: '',
      searchQuery: '',
      actionLabel: '',
    };
  }

  const rawTab = typeof parsed.navigateTab === 'string' ? parsed.navigateTab.trim() : '';
  const navigateTab: AssistantNavTab | '' = VALID_TABS.has(rawTab as AssistantNavTab)
    ? (rawTab as AssistantNavTab)
    : '';

  const rawFactory =
    typeof parsed.filterFactory === 'string' ? parsed.filterFactory.trim().toUpperCase() : '';
  const filterFactory: FactoryName | 'ALL' | '' = VALID_FACTORIES.has(rawFactory)
    ? (rawFactory as FactoryName | 'ALL')
    : '';

  return {
    reply:
      typeof parsed.reply === 'string' && parsed.reply.trim()
        ? parsed.reply.trim()
        : rawText,
    navigateTab,
    filterFactory,
    filterLine: typeof parsed.filterLine === 'string' ? parsed.filterLine.trim() : '',
    searchQuery: typeof parsed.searchQuery === 'string' ? parsed.searchQuery.trim() : '',
    actionLabel: typeof parsed.actionLabel === 'string' ? parsed.actionLabel.trim() : '',
  };
}
