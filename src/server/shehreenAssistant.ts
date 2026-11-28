import { getSmtpStatus } from './emailService.ts';
import { getWorkspaceState } from './workspaceStore.ts';
import {
  askShehreenAssistantCore,
  type AssistantNavTab,
  type AssistantScope,
  type MasterPlanNavTab,
  type ShehreenChatRequest,
  type ShehreenChatResponse,
  type ShehreenHistoryTurn,
  type ShehreenNavTab,
} from './shehreenCore.ts';

export type {
  AssistantNavTab,
  AssistantScope,
  MasterPlanNavTab,
  ShehreenChatRequest,
  ShehreenChatResponse,
  ShehreenHistoryTurn,
  ShehreenNavTab,
};

const isAiEnabled = (): boolean =>
  (process.env.AI_ENABLED || '').trim().toLowerCase() !== 'false';

export async function askShehreenAssistant(
  req: ShehreenChatRequest
): Promise<ShehreenChatResponse> {
  return askShehreenAssistantCore(req, {
    aiEnabled: isAiEnabled(),
    geminiApiKey: (process.env.GEMINI_API_KEY || '').trim(),
    state: getWorkspaceState(),
    smtpConfigured: getSmtpStatus().configured,
    scope: req.scope,
  });
}
