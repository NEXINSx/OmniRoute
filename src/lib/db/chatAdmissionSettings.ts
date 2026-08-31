/**
 * chatAdmissionSettings.ts — Persisted settings for the chat admission controller.
 *
 * These values live in `key_value` under the `settings` namespace so they can be
 * edited from the dashboard without touching env files. Env vars still win as
 * operator overrides; DB values are the portable deployment default.
 */

import { getDbInstance } from "./core";
import { invalidateDbCache } from "./readCache";

const NAMESPACE = "settings";

export interface ChatAdmissionSettings {
  chatMaxHeavyInFlight: number;
  chatAdmissionHeapShedRatio: number;
  chatAdmissionHealthyHeadroom: number;
}

export const DEFAULT_CHAT_ADMISSION_SETTINGS: ChatAdmissionSettings = {
  chatMaxHeavyInFlight: 1,
  chatAdmissionHeapShedRatio: 0.75,
  chatAdmissionHealthyHeadroom: 1,
};

function parseEnvNumber(
  raw: string | undefined,
  fallback: number,
  parse: (raw: string) => number,
  validate: (n: number) => boolean
): number {
  if (raw === undefined) return fallback;
  const parsed = parse(raw);
  return validate(parsed) ? parsed : fallback;
}

export function readChatAdmissionSettingsFromEnv(): ChatAdmissionSettings {
  const env = process.env;

  const chatMaxHeavyInFlight = parseEnvNumber(
    env.OMNIROUTE_CHAT_MAX_HEAVY_IN_FLIGHT,
    DEFAULT_CHAT_ADMISSION_SETTINGS.chatMaxHeavyInFlight,
    (raw) => Number.parseInt(raw, 10),
    (n) => Number.isSafeInteger(n) && n >= 1
  );

  const chatAdmissionHeapShedRatio = parseEnvNumber(
    env.OMNIROUTE_CHAT_ADMISSION_HEAP_SHED_RATIO,
    DEFAULT_CHAT_ADMISSION_SETTINGS.chatAdmissionHeapShedRatio,
    (raw) => Number.parseFloat(raw),
    (n) => Number.isFinite(n) && n > 0 && n <= 1
  );

  const chatAdmissionHealthyHeadroom = parseEnvNumber(
    env.OMNIROUTE_CHAT_ADMISSION_HEALTHY_HEADROOM,
    DEFAULT_CHAT_ADMISSION_SETTINGS.chatAdmissionHealthyHeadroom,
    (raw) => Number.parseInt(raw, 10),
    (n) => Number.isSafeInteger(n) && n >= 0
  );

  return {
    chatMaxHeavyInFlight,
    chatAdmissionHeapShedRatio,
    chatAdmissionHealthyHeadroom,
  };
}

export function readChatAdmissionSettingsFromDb(): ChatAdmissionSettings {
  const db = getDbInstance();

  const row = db
    .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
    .get(NAMESPACE, "chatAdmissionSettings") as { value?: string } | undefined;

  if (!row?.value) return DEFAULT_CHAT_ADMISSION_SETTINGS;

  try {
    const parsed = JSON.parse(row.value) as Partial<ChatAdmissionSettings>;
    return {
      chatMaxHeavyInFlight:
        typeof parsed.chatMaxHeavyInFlight === "number" && parsed.chatMaxHeavyInFlight >= 1
          ? parsed.chatMaxHeavyInFlight
          : DEFAULT_CHAT_ADMISSION_SETTINGS.chatMaxHeavyInFlight,
      chatAdmissionHeapShedRatio:
        typeof parsed.chatAdmissionHeapShedRatio === "number" &&
        parsed.chatAdmissionHeapShedRatio > 0 &&
        parsed.chatAdmissionHeapShedRatio <= 1
          ? parsed.chatAdmissionHeapShedRatio
          : DEFAULT_CHAT_ADMISSION_SETTINGS.chatAdmissionHeapShedRatio,
      chatAdmissionHealthyHeadroom:
        typeof parsed.chatAdmissionHealthyHeadroom === "number" &&
        parsed.chatAdmissionHealthyHeadroom >= 0
          ? parsed.chatAdmissionHealthyHeadroom
          : DEFAULT_CHAT_ADMISSION_SETTINGS.chatAdmissionHealthyHeadroom,
    };
  } catch {
    return DEFAULT_CHAT_ADMISSION_SETTINGS;
  }
}

export function getEffectiveChatAdmissionSettings(): ChatAdmissionSettings {
  const env = readChatAdmissionSettingsFromEnv();

  const allFromEnv = Object.values(env).every(
    (v, i) => v === Object.values(DEFAULT_CHAT_ADMISSION_SETTINGS)[i]
  );

  if (!allFromEnv) return env;

  return readChatAdmissionSettingsFromDb();
}

export function getChatAdmissionSettingsSource(): Record<string, "env" | "db" | "default"> {
  const env = readChatAdmissionSettingsFromEnv();
  const envKeys = Object.keys(env) as (keyof ChatAdmissionSettings)[];

  const source: Record<string, "env" | "db" | "default"> = {};
  for (const key of envKeys) {
    const envVal = env[key];
    const defaultVal = DEFAULT_CHAT_ADMISSION_SETTINGS[key];
    if (envVal !== defaultVal) {
      source[key] = "env";
    }
  }

  if (Object.keys(source).length > 0) return source;

  const dbVal = readChatAdmissionSettingsFromDb();
  for (const key of envKeys) {
    const dbSetting = dbVal[key];
    const defaultVal = DEFAULT_CHAT_ADMISSION_SETTINGS[key];
    if (dbSetting !== defaultVal) {
      source[key] = "db";
    }
  }

  for (const key of envKeys) {
    if (!source[key]) {
      source[key] = "default";
    }
  }

  return source;
}

export async function updateChatAdmissionSettings(
  next: ChatAdmissionSettings
): Promise<ChatAdmissionSettings> {
  const db = getDbInstance();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO key_value (namespace, key, value, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(NAMESPACE, "chatAdmissionSettings", JSON.stringify(next), now);

  invalidateDbCache("settings");
  return getEffectiveChatAdmissionSettings();
}

export async function resetChatAdmissionSettings(): Promise<ChatAdmissionSettings> {
  const db = getDbInstance();

  db.prepare("DELETE FROM key_value WHERE namespace = ? AND key = ?").run(
    NAMESPACE,
    "chatAdmissionSettings"
  );
  invalidateDbCache("settings");
  return getEffectiveChatAdmissionSettings();
}
