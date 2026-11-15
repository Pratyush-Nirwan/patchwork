import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { encryptSetupToken, decryptSetupToken } from "./setup-token";

// Section E: Security settings schema
export const SecuritySettingsSchema = z.object({
  passwordMinLength: z.number().int().min(6).max(128).default(8),
  passwordRequireMixedCase: z.boolean().default(false),
  passwordRequireDigit: z.boolean().default(false),
  passwordRequireSymbol: z.boolean().default(false),
  sessionLifetimeMs: z.number().int().min(60000).default(7 * 24 * 60 * 60 * 1000), // 7 days
  sessionIdleTimeoutMs: z
    .number()
    .int()
    .refine(
      (v) => v === 0 || (v >= 60_000 && v <= 30 * 24 * 60 * 60 * 1000),
      "Idle timeout must be 0 (disabled) or between 1 minute and 30 days"
    )
    .default(0), // 0 = disabled
  rateLimitMaxFailures: z.number().int().min(1).max(100).default(5),
  rateLimitWindowMs: z.number().int().min(1000).max(86400000).default(15 * 60 * 1000), // 15 mins
});
export type SecuritySettings = z.infer<typeof SecuritySettingsSchema>;

// Section F: Storage settings schema
export const StorageSettingsSchema = z.object({
  maxAttachmentBytes: z.number().int().min(1024).max(104857600).default(5 * 1024 * 1024), // 5MB
  allowedMimeTypes: z.array(z.string()).default([
    "text/plain",
    "text/markdown",
    "text/x-markdown",
    "text/csv",
    "application/json",
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
  ]),
  allowedExtensions: z.array(z.string()).default([
    ".txt",
    ".md",
    ".markdown",
    ".csv",
    ".json",
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
  ]),
});
export type StorageSettings = z.infer<typeof StorageSettingsSchema>;

// Section H: Integrations settings schema
export const IntegrationsSettingsSchema = z.object({
  allowedHosts: z.array(z.string()).default(["github.com", "gitlab.com"]),
  githubTokenCiphertext: z.string().nullable().default(null),
  githubTokenIv: z.string().nullable().default(null),
  githubTokenAuthTag: z.string().nullable().default(null),
  gitlabTokenCiphertext: z.string().nullable().default(null),
  gitlabTokenIv: z.string().nullable().default(null),
  gitlabTokenAuthTag: z.string().nullable().default(null),
  cacheDurationSec: z.number().int().min(0).max(86400).default(300),
});
export type IntegrationsSettings = z.infer<typeof IntegrationsSettingsSchema>;

// Section I: Appearance settings schema
export const PriorityConfigSchema = z.object({
  key: z.string(),
  label: z.string(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be valid hex color"),
});

export const LabelConfigSchema = z.object({
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be valid hex color"),
});

export const DefaultColumnConfigSchema = z.object({
  name: z.string().min(1),
  wipLimit: z.number().int().min(0).nullable().default(null),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be valid hex color"),
});

export const AppearanceSettingsSchema = z.object({
  defaultTheme: z.enum(["light", "dark", "system"]).default("system"),
  dateTimeFormat: z.enum([
    "YYYY-MM-DD HH:mm",
    "MM/DD/YYYY hh:mm A",
    "DD/MM/YYYY HH:mm",
  ]).default("YYYY-MM-DD HH:mm"),
  priorities: z.array(PriorityConfigSchema).default([
    { key: "urgent", label: "Urgent", color: "#EF4444" },
    { key: "high", label: "High", color: "#F97316" },
    { key: "medium", label: "Medium", color: "#EAB308" },
    { key: "low", label: "Low", color: "#3B82F6" },
    { key: "none", label: "None", color: "#64748B" },
  ]),
  labels: z.array(LabelConfigSchema).default([
    { name: "bug", color: "#EF4444" },
    { name: "feature", color: "#3B82F6" },
    { name: "documentation", color: "#10B981" },
    { name: "frontend", color: "#8B5CF6" },
    { name: "backend", color: "#F59E0B" },
  ]),
  defaultColumns: z.array(DefaultColumnConfigSchema).default([
    { name: "Backlog", wipLimit: null, color: "#434B56" },
    { name: "In Progress", wipLimit: 5, color: "#C84317" },
    { name: "Review", wipLimit: 3, color: "#C2410C" },
    { name: "Done", wipLimit: null, color: "#15803D" },
  ]),
});
export type AppearanceSettings = z.infer<typeof AppearanceSettingsSchema>;

// Team default columns override schema
export const TeamDefaultColumnsSchema = z.record(
  z.string(),
  z.array(DefaultColumnConfigSchema)
).default({});
export type TeamDefaultColumns = z.infer<typeof TeamDefaultColumnsSchema>;

export const SETTINGS_SCHEMAS = {
  security: SecuritySettingsSchema,
  storage: StorageSettingsSchema,
  integrations: IntegrationsSettingsSchema,
  appearance: AppearanceSettingsSchema,
  team_default_columns: TeamDefaultColumnsSchema,
} as const;

export type SettingKey = keyof typeof SETTINGS_SCHEMAS;

export type SettingType<K extends SettingKey> = z.infer<
  (typeof SETTINGS_SCHEMAS)[K]
>;

// In-memory cache
const settingsCache = new Map<string, unknown>();

export function clearSettingsCache(key?: SettingKey): void {
  if (key) {
    settingsCache.delete(key);
  } else {
    settingsCache.clear();
  }
}

export function getDefaultSetting<K extends SettingKey>(key: K): SettingType<K> {
  const schema = SETTINGS_SCHEMAS[key];
  return schema.parse({}) as SettingType<K>;
}

export async function getSystemSetting<K extends SettingKey>(
  key: K
): Promise<SettingType<K>> {
  if (settingsCache.has(key)) {
    return settingsCache.get(key) as SettingType<K>;
  }

  const [row] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);

  const schema = SETTINGS_SCHEMAS[key];
  let parsed: SettingType<K>;

  if (!row || !row.value) {
    parsed = schema.parse({}) as SettingType<K>;
  } else {
    const result = schema.safeParse(row.value);
    if (result.success) {
      parsed = result.data as SettingType<K>;
    } else {
      parsed = schema.parse({}) as SettingType<K>;
    }
  }

  settingsCache.set(key, parsed);
  return parsed;
}

export async function setSystemSetting<K extends SettingKey>(
  key: K,
  value: unknown,
  userId?: string
): Promise<SettingType<K>> {
  const schema = SETTINGS_SCHEMAS[key];
  const validated = schema.parse(value) as SettingType<K>;

  const [existing] = await db
    .select({ key: systemSettings.key })
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);

  if (existing) {
    await db
      .update(systemSettings)
      .set({
        value: validated,
        updatedById: userId || null,
        updatedAt: new Date(),
      })
      .where(eq(systemSettings.key, key));
  } else {
    await db.insert(systemSettings).values({
      key,
      value: validated,
      updatedById: userId || null,
      updatedAt: new Date(),
    });
  }

  settingsCache.set(key, validated);
  return validated;
}

export async function resetSystemSetting<K extends SettingKey>(
  key: K,
  userId?: string
): Promise<SettingType<K>> {
  const defaultValue = getDefaultSetting(key);
  return setSystemSetting(key, defaultValue, userId);
}

// Integration token helpers
export function encryptIntegrationToken(token: string): {
  ciphertext: string;
  iv: string;
  authTag: string;
} {
  return encryptSetupToken(token);
}

export function decryptIntegrationToken(record: {
  ciphertext: string | null;
  iv: string | null;
  authTag: string | null;
}): string | null {
  if (!record.ciphertext || !record.iv || !record.authTag) return null;
  try {
    return decryptSetupToken({
      ciphertext: record.ciphertext,
      iv: record.iv,
      authTag: record.authTag,
    });
  } catch {
    return null;
  }
}
