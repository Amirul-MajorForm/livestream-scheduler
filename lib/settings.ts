import 'server-only';
import { query, one } from './db';
import { ORIGINAL_RULES, type PlanningRules } from './scheduler';

/**
 * Planning rules used by this app. They start as the original Apps Script behaviour, except that the
 * same brand may stream on different platforms at the same time (agreed with ops).
 */
export const DEFAULT_RULES: PlanningRules = { ...ORIGINAL_RULES, sameBrandDifferentPlatformOk: true };

export async function getRules(): Promise<PlanningRules> {
  const row = await one('SELECT value FROM settings WHERE key = $1', ['planning_rules']);
  return { ...DEFAULT_RULES, ...((row?.value as Partial<PlanningRules>) || {}) };
}

export async function saveRules(rules: PlanningRules, userId: number) {
  await query(`INSERT INTO settings(key, value, updated_by) VALUES ('planning_rules', $1, $2)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`, [JSON.stringify(rules), userId]);
}

export async function getSetting<T>(key: string, fallback: T): Promise<{ value: T; updatedAt: string | null; updatedBy: string | null }> {
  const row = await one(`SELECT s.value, s.updated_at, u.email FROM settings s LEFT JOIN users u ON u.id = s.updated_by WHERE s.key = $1`, [key]);
  return { value: row ? (row.value as T) : fallback, updatedAt: row ? new Date(row.updated_at).toISOString() : null, updatedBy: row?.email ?? null };
}

export async function saveSetting(key: string, value: unknown, userId: number) {
  await query(`INSERT INTO settings(key, value, updated_by) VALUES ($1, $2, $3)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`, [key, JSON.stringify(value), userId]);
}
