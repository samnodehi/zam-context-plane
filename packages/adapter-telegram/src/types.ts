// Shared types for the Telegram adapter (docs/40).

export type ComponentType =
  | 'scaffold'
  | 'skill'
  | 'tool'
  | 'history'
  | 'memory'
  | 'output_format';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type DefaultAction = 'include' | 'omit' | 'defer';
export type OmissionPolicy = 'allow' | 'fail_open' | 'never';
export type RetainPolicy = 'optional' | 'durable' | 'mandatory' | 'safety_critical';

/** The canonical 18-field component shape (schemas/inputs/component-registry.schema.json). */
export interface RegistryEntry {
  id: string;
  type: ComponentType;
  title: string;
  summary: string;
  source: string;
  tokensApprox: number;
  charsApprox: number;
  riskLevel: RiskLevel;
  requiredWhen: string[];
  safeToOmitWhen: string[];
  defaultAction: DefaultAction;
  omissionPolicy: OmissionPolicy;
  retainPolicy: RetainPolicy;
  budgetPriority: number;
  evidenceRequired: string | null;
  tags: string[];
  version: string;
  hash: string | null;
}

/** Light authoring shape for a bot's context component: body + optional governance. */
export interface BotComponent {
  id: string;
  type: ComponentType;
  title: string;
  summary: string;
  body: string;
  riskLevel?: RiskLevel;
  requiredWhen?: string[];
  safeToOmitWhen?: string[];
  defaultAction?: DefaultAction;
  omissionPolicy?: OmissionPolicy;
  retainPolicy?: RetainPolicy;
  budgetPriority?: number;
  tags?: string[];
  version?: string;
}

// --- Telegram Bot API shapes (subset we read) ---

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
}
export interface TelegramUser {
  id: number;
  username?: string;
  is_bot?: boolean;
}
export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
  from?: TelegramUser;
  reply_to_message?: TelegramMessage;
}
export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
}

/** The core's requestSignals caller tier (the 3 required fields). */
export interface RequestSignals {
  promptFamily: string;
  familyConfidence: number;
  injectionSuspect: boolean;
}
