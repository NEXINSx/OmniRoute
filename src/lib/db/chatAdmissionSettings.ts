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

export function readChatAdmissionSettingsFromEnv(): ChatAdmissionSettings {
  const env = process.env;

  const chatMaxHeavyInFlightRaw = env.OMNIROUTE_CHAT_MAX_HEAVY_IN_FLIGHT;
  const chatMaxHeavyInFlight =
    chatMaxHeavyInFlightRaw !== undefined
      ? (() => {
          const parsed = Number.parseInt(chatMaxHeavyInFlightRaw, 10);
          return Number.isSafeInteger(parsed) && parsed >= 1
            ? parsed
            : DEFAULT_CHAT_ADMISSION_SETTINGS.chatMaxHeavyInFlight;
        })()
      : DEFAULT_CHAT_ADMISSION_SETTINGS.chatMaxHeavyInFlight;

  const chatAdmissionHeapShedRatioRaw = env.OMNIROUTE_CHAT_ADMISSION_HEAP_SHED_RATIO;
  const chatAdmissionHeapShedRatio =
    chatAdmissionHeapShedRatioRaw !== undefined
      ? (() => {
          const parsed = Number.parseFloat(chatAdmissionHeapShedRatioRaw);
          return Number.isFinite(parsed) && parsed > 0 && parsed <= 1
            ? parsed
            : DEFAULT_CHAT_ADMISSION_SETTINGS.chatAdmissionHeapShedRatio;
        })()
      : DEFAULT_CHAT_ADMISSION_SETTINGS.chatAdmissionHeapShedRatio;

  const chatAdmissionHealthyHeadroomRaw = env.OMNIROUTE_CHAT_ADMISSION_HEALTHY_HEADROOM;
  const chatAdmissionHealthyHeadroom =
    chatAdmissionHealthyHeadroomRaw !== undefined
      ? (() => {
          const parsed = Number.parseInt(chatAdmissionHealthyHeadroomRaw, 10);
          return Number.isSafeInteger(parsed) && parsed >= 0
            ? parsed
            : DEFAULT_CHAT_ADMISSION_SETTINGS.chatAdmissionHealthyHeadroom;
        })()
      : DEFAULT_CHAT_ADMISSION_SETTINGS.chatAdmissionHealthyHeadroom;

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
    const parsed = JSON.parse(row.value) as Partial<ChatAdmissionSettings> | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_CHAT_ADMISSION_SETTINGS;

    const chatMaxHeavyInFlight =
      typeof parsed.chatMaxHeavyInFlight === "number" &&
      Number.isSafeInteger(parsed.chatMaxHeavyInFlight) &&
      parsed.chatMaxHeavyInFlight >= 1
        ? parsed.chatMaxHeavyInFlight
        : DEFAULT_CHAT_ADMISSION_SETTINGS.chatMaxHeavyInFlight;

    const chatAdmissionHeapShedRatio =
      typeof parsed.chatAdmissionHeapShedRatio === "number" &&
      Number.isFinite(parsed.chatAdmissionHeapShedRatio) &&
      parsed.chatAdmissionHeapShedRatio > 0 &&
      parsed.chatAdmissionHeapShedRatio <= 1
        ? parsed.chatAdmissionHeapShedRatio
        : DEFAULT_CHAT_ADMISSION_SETTINGS.chatAdmissionHeapShedRatio;

    const chatAdmissionHealthyHeadroom =
      typeof parsed.chatAdmissionHealthyHeadroom === "number" &&
      Number.isSafeInteger(parsed.chatAdmissionHealthyHeadroom) &&
      parsed.chatAdmissionHealthyHeadroom >= 0
        ? parsed.chatAdmissionHealthyHeadroom
        : DEFAULT_CHAT_ADMISSION_SETTINGS.chatAdmissionHealthyHeadroom;

    return {
      chatMaxHeavyInFlight,
      chatAdmissionHeapShedRatio,
      chatAdmissionHealthyHeadroom,
    };
  } catch {
    return DEFAULT_CHAT_ADMISSION_SETTINGS;
  }
}

export function getEffectiveChatAdmissionSettings(): ChatAdmissionSettings {
  const envSettings = readChatAdmissionSettingsFromEnv();
  const dbSettings = readChatAdmissionSettingsFromDb();

  const chatMaxHeavyInFlight =
    envSettings.chatMaxHeavyInFlight !== DEFAULT_CHAT_ADMISSION_SETTINGS.chatMaxHeavyInFlight
      ? envSettings.chatMaxHeavyInFlight
      : dbSettings.chatMaxHeavyInFlight;

  const chatAdmissionHeapShedRatio =
    envSettings.chatAdmissionHeapShedRatio !==
    DEFAULT_CHAT_ADMISSION_SETTINGS.chatAdmissionHeapShedRatio
      ? envSettings.chatAdmissionHeapShedRatio
      : dbSettings.chatAdmissionHeapShedRatio;

  const chatAdmissionHealthyHeadroom =
    envSettings.chatAdmissionHealthyHeadroom !==
    DEFAULT_CHAT_ADMISSION_SETTINGS.chatAdmissionHealthyHeadroom
      ? envSettings.chatAdmissionHealthyHeadroom
      : dbSettings.chatAdmissionHealthyHeadroom;

  return {
    chatMaxHeavyInFlight,
    chatAdmissionHeapShedRatio,
    chatAdmissionHealthyHeadroom,
  };
}

export function getChatAdmissionSettingsSource(): Record<string, "env" | "db" | "default"> {
  const env = process.env;
  const source: Record<string, "env" | "db" | "default"> = {};

  source.chatMaxHeavyInFlight = env.OMNIROUTE_CHAT_MAX_HEAVY_IN_FLIGHT !== undefined ? "env" : "db";

  source.chatAdmissionHeapShedRatio =
    env.OMNIROUTE_CHAT_ADMISSION_HEAP_SHED_RATIO !== undefined ? "env" : "db";

  source.chatAdmissionHealthyHeadroom =
    env.OMNIROUTE_CHAT_ADMISSION_HEALTHY_HEADROOM !== undefined ? "env" : "db";

  return source;
}

export async function updateChatAdmissionSettings(
  next: ChatAdmissionSettings
): Promise<ChatAdmissionSettings> {
  const db = getDbInstance();
  const payload = {
    chatMaxHeavyInFlight: Math.max(
      1,
      Number.isSafeInteger(next.chatMaxHeavyInFlight)
        ? next.chatMaxHeavyInFlight
        : DEFAULT_CHAT_ADMISSION_SETTINGS.chatMaxHeavyInFlight
    ),
    chatAdmissionHeapShedRatio: Math.max(
      0,
      Math.min(
        1,
        Number.isFinite(next.chatAdmissionHeapShedRatio)
          ? next.chatAdmissionHeapShedRatio
          : DEFAULT_CHAT_ADMISSION_SETTINGS.chatAdmissionHeapShedRatio
      )
    ),
    chatAdmissionHealthyHeadroom: Math.max(
      0,
      Number.isSafeInteger(next.chatAdmissionHealthyHeadroom)
        ? next.chatAdmissionHealthyHeadroom
        : DEFAULT_CHAT_ADMISSION_SETTINGS.chatAdmissionHealthyHeadroom
    ),
  };

  db.prepare("INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)").run(
    NAMESPACE,
    "chatAdmissionSettings",
    JSON.stringify(payload)
  );

  invalidateDbCache("settings");
  return payload;
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
