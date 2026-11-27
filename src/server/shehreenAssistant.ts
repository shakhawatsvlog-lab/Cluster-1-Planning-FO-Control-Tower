import { getSmtpStatus } from './emailService.ts';
import { getWorkspaceState } from './workspaceStore.ts';
import {
  askShehreenAssistantCore,
  type AssistantNavTab,
  type ShehreenChatRequest,
  type ShehreenChatResponse,
  type ShehreenHistoryTurn,
} from './shehreenCore.ts';

export type {
  AssistantNavTab,
  ShehreenChatRequest,
  ShehreenChatResponse,
  ShehreenHistoryTurn,
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
  });
}
