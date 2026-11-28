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
import type { PersistedWorkspaceData } from './workspaceLogic.ts';

export type AssistantScope = 'control_tower' | 'master_plan';

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

export type MasterPlanNavTab = 'master_plan' | 'fo_needed';

export type ShehreenNavTab = AssistantNavTab | MasterPlanNavTab;

const VALID_CONTROL_TOWER_TABS = new Set<AssistantNavTab>([
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

const VALID_MASTER_PLAN_TABS = new Set<MasterPlanNavTab>([
  'master_plan',
  'fo_needed',
]);

const VALID_FACTORIES = new Set<string>(['ALL', ...ALLOWED_FACTORIES]);

export interface ShehreenHistoryTurn {
  role: 'user' | 'model';
  text: string;
}

export interface ShehreenChatRequest {
  message: string;
  history?: ShehreenHistoryTurn[];
  scope?: AssistantScope;
  currentTab?: string;
  selectedFactory?: string;
  selectedLine?: string;
}

export interface ShehreenChatResponse {
  reply: string;
  navigateTab: ShehreenNavTab | '';
  filterFactory: FactoryName | 'ALL' | '';
  filterLine: string;
  searchQuery: string;
  actionLabel: string;
}

export interface ShehreenRuntimeDeps {
  aiEnabled: boolean;
  geminiApiKey: string;
  state: PersistedWorkspaceData;
  smtpConfigured: boolean;
  scope?: AssistantScope;
}

const CONTROL_TOWER_PAGES_GUIDE = `
WEBSITE PAGES (Alex Apparels — Cluster 1 Control Tower):
- "dashboard": KPI Dashboard — 4-Factory cards, PG Issue Qty (= Order Qty), Output Start (Running End + 1D), step-by-step Recent PG-Wise FO Need Checklist (Running & immediate Upcoming orders), Full Qty Released remarks, Saved FO Box (download .xlsx or send email), "Set Running Styles".
- "cutting_entry": Daily Cutting Entry — Factory Online Sheet Links (ALEX 1, 3, 5, 12), auto-sync, .xlsx/.csv upload, manual cutting log.
- "fo_checklist": Weekly Fabric Order Checklist — confirm Issued Qty & Date with OK.
- "database": Master Plan (Line-Wise) — edit Order Qty, End Date, Order Status (Open/Order Closed), upload master plan.
- "tracker": Fabric Order Tracker — edit FO Issue Qty, Daily Target, FO#, FO Date, FO Status, Notes.
- "fo_required": FO Required List — sorted open slots needing FO.
- "action_required": Action Required List — Qty pending, Cutting <= 10D, overdue triggers, Open Capacity.
- "reminders": Daily Email Reminders — SMTP setup, recipients, scheduled/manual summary emails.
- "control_panel": Control Panel — admin lock/unlock, site title, password change via email code, JSON backup/restore.
`.trim();

const MASTER_PLAN_PAGES_GUIDE = `
WEBSITE PAGES (Alpine Master Plan — Read-Only Public Portal):
- "master_plan": Master Plan Dashboard — Select a factory (ALEX 1, ALEX 3, ALEX 5, ALEX 12), inspect line-wise Running, Upcoming (Next), and Queued styles, Order Qty, Cutting Qty, Output Qty, Packing Qty, End Date, and Output Start estimates, and filter by Line, Status, Date Range, or search PG#/Style.
- "fo_needed": FO Needed Checklist — Read-only Recent PG-Wise FO Needed summary across factories showing Issue Qty, FO Date Needed, FO Status (Pending / Under Process / Completed), and Excel export.
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
    const hay = `${r.factory} ${r.zone} ${r.line} ${r.pgNumber} ${r.style} ${r.nextStyle}`.toLowerCase();
    if (
      tokens.some((tok) => {
        if (
          /^(the|and|for|with|what|when|where|which|show|tell|give|have|this|that|from|kon|tar|koto|hobe|lagbe|ache|koro|bhai|apu|friend|help|how|qty|plan|master|line|style|output|cutting|packing)$/.test(
            tok
          )
        ) {
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
  state: PersistedWorkspaceData,
  smtpConfigured: boolean,
  scope: AssistantScope,
  userMessage: string,
  currentTab?: string,
  selectedFactory?: string,
  selectedLine?: string
): string {
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

  const recentFoItems = pgItems.filter(
    (item) => !item.isFullQtyReleased && item.isActionableWindow && item.needsFo
  );
  const laterPgItems = pgItems.filter(
    (item) => !item.isFullQtyReleased && !item.isActionableWindow
  );

  const factoryLines = ALLOWED_FACTORIES.map((fac) => {
    const facRecords = evaluated.filter((r) => r.factory === fac);
    const stats = pgSummary.byFactory[fac];
    const lineCount = new Set(facRecords.map((r) => r.line)).size;
    const runningCount = facRecords.filter((r) => r.lifecycleStage === 'Running').length;
    const upcomingCount = facRecords.filter((r) => r.lifecycleStage === 'Upcoming (Next)').length;
    const orderQty = facRecords.reduce((sum, r) => sum + (r.plannedQty || 0), 0);
    const cuttingQty = facRecords.reduce((sum, r) => sum + (r.cuttingFinishedQty || 0), 0);
    const outputQty = facRecords.reduce((sum, r) => sum + (r.outputQty || 0), 0);
    const packingQty = facRecords.reduce((sum, r) => sum + (r.packingQty || 0), 0);
    const recentFacCount = recentFoItems.filter((p) => p.factory === fac).length;
    return `  - ${fac} (${lineCount}L, Run=${runningCount}, Next=${upcomingCount}): OrderQty=${orderQty.toLocaleString()}, CutQty=${cuttingQty.toLocaleString()}, OutQty=${outputQty.toLocaleString()}, PackQty=${packingQty.toLocaleString()}, RecentFO=${recentFacCount}, TotalImmediatePG=${stats.uniquePgCount}, Released=${stats.releasedPgCount}, IssueQty=${stats.issueQty.toLocaleString()}`;
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
    const outQty = item.primaryRecord.outputQty;
    const packQty = item.primaryRecord.packingQty;
    return `  * [${item.stageTag}] ${item.factory} | ${item.pgNumber} | ${item.lines.join(',')} | ${
      item.style
    } | Qty:${item.issueQty ?? item.orderQty ?? 'Pending'} | Cut:${item.cuttingFinishedQty} | OutQty:${
      outQty !== null && outQty !== undefined ? outQty : '—'
    } | PackQty:${
      packQty !== null && packQty !== undefined ? packQty : '—'
    } | OutStart:${outStr} | FO:${foStr} | ${item.statusLabel}${
      item.sheetRemark ? ` | "${item.sheetRemark}"` : ''
    }`;
  };

  const pgChecklistLines = pgItems.slice(0, 45).map(formatPgRow);

  const matchedSpecific = findQueryMatchedRecords(evaluated, userMessage);
  const matchedSection =
    matchedSpecific.length > 0
      ? `\nMATCHED SLOTS FOR USER QUERY:\n${matchedSpecific
          .map(
            (r) =>
              `  * ${r.factory} ${r.line} S${r.slot} [${r.lifecycleStage}] | ${r.pgNumber} | ${r.style} | OrderQty:${
                r.plannedQty ?? 'Pending'
              } | IssueQty:${r.effectiveIssueQty ?? 'Pending'} | CutQty:${r.cuttingFinishedQty} | OutQty:${
                r.outputQty !== null && r.outputQty !== undefined ? r.outputQty : '—'
              } | PackQty:${
                r.packingQty !== null && r.packingQty !== undefined ? r.packingQty : '—'
              } | End:${formatDisplayDate(r.endDateIso)} | OutStart:${formatDisplayDate(
                r.newStyleOutputStartIso || r.estimatedOutputStartIso
              )} | FO:${r.foStatus}${r.sheetRemark ? ` | "${r.sheetRemark}"` : ''}`
          )
          .join('\n')}`
      : '';

  const configuredUrls = ALLOWED_FACTORIES.filter((fac) =>
    Boolean(state.cuttingSheetSync.factoryUrls?.[fac]?.trim())
  );

  const adminMetaLine =
    scope === 'control_tower'
      ? `\n- Sync/Mail: SheetLinks=${configuredUrls.join(',') || 'None'} | LastSync=${
          state.cuttingSheetSync.lastStatus
        } | SMTP=${smtpConfigured ? 'Configured' : 'NotSet'}`
      : `\n- Portal Mode: Public Master Plan Read-Only View | LastSheetSync=${
          state.cuttingSheetSync.lastUpdatedAtIso || 'Available'
        }`;

  return `
LIVE WORKSPACE (RefDate: ${refDate}, View: tab=${
    currentTab || (scope === 'master_plan' ? 'master_plan' : 'dashboard')
  }, factory=${selectedFactory || 'ALL'}, line=${selectedLine || 'ALL'}):
- Rules: OutputStart=RunEnd+1D | InputStart=RunEnd-${ruleOptions.inputStartOffsetDays}D | FO=Input-${
    ruleOptions.upcomingFoOffsetDays
  }D | CutAlert<=${ruleOptions.cuttingAlertDays}D
- Summary: Recent FO Needed PGs=${recentFoItems.length} | Later/Step-by-Step PGs=${
    laterPgItems.length
  } | Released PGs=${pgSummary.releasedPgCount} | Immediate Issue Qty=${pgSummary.totalPgIssueQty.toLocaleString()} pcs | Queued Future Slots=${
    evaluated.filter((r) => r.lifecycleStage === 'Queued').length
  } | SavedBox=${state.records.filter((r) => r.upcomingFoSelected).length}${adminMetaLine}
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

export async function askShehreenAssistantCore(
  req: ShehreenChatRequest,
  runtime: ShehreenRuntimeDeps
): Promise<ShehreenChatResponse> {
  if (!runtime.aiEnabled) {
    return {
      reply:
        'Shehreen AI Assistant is temporarily disabled (AI_ENABLED=false). All planning, FO, cutting, and Excel export features continue working normally.',
      navigateTab: '',
      filterFactory: '',
      filterLine: '',
      searchQuery: '',
      actionLabel: '',
    };
  }

  const apiKey = (runtime.geminiApiKey || '').trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Please add GEMINI_API_KEY in Settings > Secrets so Shehreen AI can respond.'
    );
  }

  const scope: AssistantScope =
    runtime.scope || req.scope === 'master_plan' ? runtime.scope || req.scope || 'control_tower' : 'control_tower';

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const liveContext = buildLiveWorkspaceContext(
    runtime.state,
    runtime.smtpConfigured,
    scope,
    req.message,
    req.currentTab,
    req.selectedFactory,
    req.selectedLine
  );

  const pagesGuide = scope === 'master_plan' ? MASTER_PLAN_PAGES_GUIDE : CONTROL_TOWER_PAGES_GUIDE;
  const tabRuleDescription =
    scope === 'master_plan'
      ? 'Tab ID ONLY when opening a Master Plan portal view helps: "master_plan" or "fo_needed". Empty string "" for general chat/help.'
      : 'Tab ID ONLY when opening a Control Tower page helps: dashboard, cutting_entry, fo_checklist, database, tracker, fo_required, action_required, reminders, control_panel. Empty string "" for general chat/help.';
  const factoryRuleDescription =
    scope === 'master_plan'
      ? 'Optional factory filter: ALEX 1, ALEX 3, ALEX 5, ALEX 12, or empty string "" (Master Plan shows one factory at a time, so never output "ALL" here).'
      : 'Optional factory filter: ALL, ALEX 1, ALEX 3, ALEX 5, ALEX 12, or empty string "".';

  const systemInstruction = `
You are **SHEHREEN**, a warm, smart, and helpful AI teammate for the Alex Apparels team. You assist merchandisers, planners, industrial engineers, fabric sourcing, cutting/output/packing teams, and factory staff.

CORE RULES:
1. **Default Language Is English — Support Every Language Fluently**:
   - **DEFAULT TO ENGLISH**: Always write your response in clear, natural, professional-yet-friendly **English** by default (for English questions, neutral/short queries such as a PG#, style code, factory name like "ALEX 3", or when no other language is requested).
   - **RESPOND IN ANY LANGUAGE REQUESTED OR USED**: Automatically detect the language or script of the user's latest message. If the user writes in **any other language** — including **Bengali (বাংলা)**, **Banglish (Romanized Bengali)**, **Hindi (हिन्दी)**, **Urdu (اردو)**, **Arabic (العربية)**, **Spanish**, **French**, **Chinese**, **Japanese**, **Korean**, **Turkish**, **Indonesian**, or any other language — OR explicitly asks you to reply or translate into a specific language, respond fluently and naturally in that exact language.
   - Keep standard garments production identifiers clear across all languages (PG#, FO, ALEX 1, ALEX 3, ALEX 5, ALEX 12, Cutting Qty, Output Qty, Packing Qty, Output Start, SMV).
2. **Answer Anything & Help Freely**:
   - You can help with ANY topic the user asks: live factory Master Plan data (Running/Upcoming/Queued lines, Order Qty, Cutting Qty, Output Qty, Packing Qty, Output Start, FO Needed), buyer/supplier emails, Excel or Google Sheets formulas (SUMIFS, XLOOKUP, VLOOKUP, IF), garment/IE math (SMV, efficiency %, daily target, fabric consumption, GSM, cutting/output/packing balance), translations across any languages, summarizing pasted notes, general tech help, or friendly team conversation.
   - Never refuse general questions or invent a person's name unless they share it.
3. **Accurate Live Workspace Grounding**:
   - Whenever the user asks about factory data, PG numbers, lines, styles, Cutting Qty, Output Qty, Packing Qty, FO status, or Output Start dates, use ONLY exact figures/dates from LIVE WORKSPACE below (never guess or fabricate PG numbers or quantities).
   - If the user is on the public Master Plan portal, never mention internal admin-only credentials, SMTP details, or Control Tower admin settings.
4. **Smart Page Navigation JSON**:
   - Only set \`navigateTab\`, \`filterFactory\`, \`filterLine\`, \`searchQuery\`, and \`actionLabel\` when switching a tab or filtering the view genuinely helps the user's query.
   - For general chat, emails, Excel formulas, translations, or math questions, leave \`navigateTab\`, \`filterFactory\`, \`filterLine\`, \`searchQuery\`, and \`actionLabel\` as empty strings \`""\`.

${pagesGuide}

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
          'Helpful, natural response from Shehreen. Default to English; if the user writes in or requests any other language (Bengali, Banglish, Hindi, Urdu, Arabic, etc.), reply fluently in that language.',
      },
      navigateTab: {
        type: Type.STRING,
        description: tabRuleDescription,
      },
      filterFactory: {
        type: Type.STRING,
        description: factoryRuleDescription,
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
          'Short button label in the same language as the reply ONLY when navigateTab/filter is set (e.g. "Open Master Plan · ALEX 1"), otherwise empty string "".',
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
  const navigateTab: ShehreenNavTab | '' =
    scope === 'master_plan'
      ? VALID_MASTER_PLAN_TABS.has(rawTab as MasterPlanNavTab)
        ? (rawTab as MasterPlanNavTab)
        : ''
      : VALID_CONTROL_TOWER_TABS.has(rawTab as AssistantNavTab)
        ? (rawTab as AssistantNavTab)
        : '';

  const rawFactory =
    typeof parsed.filterFactory === 'string' ? parsed.filterFactory.trim().toUpperCase() : '';
  const filterFactory: FactoryName | 'ALL' | '' = VALID_FACTORIES.has(rawFactory)
    ? scope === 'master_plan' && rawFactory === 'ALL'
      ? ''
      : (rawFactory as FactoryName | 'ALL')
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
