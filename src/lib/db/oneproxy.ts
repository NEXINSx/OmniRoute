import { randomUUID } from "crypto";
import { getDbInstance } from "./core";
import { backupDbFile } from "./backup";

type JsonRecord = Record<string, unknown>;

export interface OneproxyProxyRecord {
  id: string;
  name: string;
  type: string;
  host: string;
  port: number;
  region: string | null;
  notes: string | null;
  status: string;
  source: string;
  qualityScore: number | null;
  latencyMs: number | null;
  anonymity: string | null;
  googleAccess: boolean;
  lastValidated: string | null;
  countryCode: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OneproxyUpsertInput {
  ip: string;
  port: number;
  protocol: string;
  country?: string | null;
  countryCode?: string | null;
  anonymity?: string | null;
  qualityScore?: number | null;
  latencyMs?: number | null;
  googleAccess?: boolean;
  lastValidated?: string | null;
}

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function mapProxyRow(row: unknown): OneproxyProxyRecord {
  const r = toRecord(row);
  return {
    id: typeof r.id === "string" ? r.id : "",
    name: typeof r.name === "string" ? r.name : "",
    type: typeof r.type === "string" ? r.type : "http",
    host: typeof r.host === "string" ? r.host : "",
    port: Number(r.port) || 0,
    region: typeof r.region === "string" ? r.region : null,
    notes: typeof r.notes === "string" ? r.notes : null,
    status: typeof r.status === "string" ? r.status : "active",
    source: typeof r.source === "string" ? r.source : "oneproxy",
    qualityScore: typeof r.quality_score === "number" ? r.quality_score : null,
    latencyMs: typeof r.latency_ms === "number" ? r.latency_ms : null,
    anonymity: typeof r.anonymity === "string" ? r.anonymity : null,
    googleAccess: r.google_access === 1 || r.google_access === true,
    lastValidated: typeof r.last_validated === "string" ? r.last_validated : null,
    countryCode: typeof r.country_code === "string" ? r.country_code : null,
    createdAt: typeof r.created_at === "string" ? r.created_at : "",
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : "",
  };
}

export async function listOneproxyProxies(options?: {
  protocol?: string;
  countryCode?: string;
  minQuality?: number;
  limit?: number;
}): Promise<OneproxyProxyRecord[]> {
  const db = getDbInstance();

  let sql = "SELECT * FROM proxy_registry WHERE source = 'oneproxy' AND status = 'active'";
  const params: unknown[] = [];

  if (options?.protocol) {
    sql += " AND type = ?";
    params.push(options.protocol);
  }
  if (options?.countryCode) {
    sql += " AND country_code = ?";
    params.push(options.countryCode);
  }
  if (options?.minQuality != null) {
    sql += " AND quality_score >= ?";
    params.push(options.minQuality);
  }

  sql += " ORDER BY quality_score DESC, last_validated DESC";

  if (options?.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  const rows = db.prepare(sql).all(...params);
  return rows.map(mapProxyRow);
}

export async function upsertOneproxyProxy(
  input: OneproxyUpsertInput
): Promise<{ proxy: OneproxyProxyRecord | null; action: "created" | "updated" }> {
  const db = getDbInstance();
  const now = new Date().toISOString();

  const name = `${input.protocol?.toUpperCase() || "HTTP"} - ${input.countryCode || "Unknown"} - ${input.ip}`;

  const existing = db
    .prepare("SELECT id FROM proxy_registry WHERE host = ? AND port = ? AND source = 'oneproxy'")
    .get(input.ip, input.port) as { id?: string } | undefined;

  if (existing?.id) {
    db.prepare(
      `UPDATE proxy_registry
       SET status = ?, quality_score = ?, latency_ms = ?, anonymity = ?,
           google_access = ?, last_validated = ?, country_code = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      "active",
      input.qualityScore ?? null,
      input.latencyMs ?? null,
      input.anonymity ?? null,
      input.googleAccess ? 1 : 0,
      input.lastValidated ?? now,
      input.countryCode ?? null,
      now,
      existing.id
    );
    backupDbFile("pre-write");
    const proxy = await getOneproxyProxyById(existing.id);
    return { proxy, action: "updated" };
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO proxy_registry
     (id, name, type, host, port, region, notes, status, source,
      quality_score, latency_ms, anonymity, google_access, last_validated, country_code,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    name,
    input.protocol || "http",
    input.ip,
    input.port,
    input.countryCode ?? null,
    null,
    "active",
    "oneproxy",
    input.qualityScore ?? null,
    input.latencyMs ?? null,
    input.anonymity ?? null,
    input.googleAccess ? 1 : 0,
    input.lastValidated ?? now,
    input.countryCode ?? null,
    now,
    now
  );
  backupDbFile("pre-write");
  const proxy = await getOneproxyProxyById(id);
  return { proxy, action: "created" };
}

export async function getOneproxyProxyById(id: string): Promise<OneproxyProxyRecord | null> {
  const db = getDbInstance();
  const row = db
    .prepare("SELECT * FROM proxy_registry WHERE id = ? AND source = 'oneproxy'")
    .get(id);
  if (!row) return null;
  return mapProxyRow(row);
}

export async function getOneproxyProxyForRotation(options?: {
  strategy?: "random" | "quality" | "sequential";
}): Promise<OneproxyProxyRecord | null> {
  const db = getDbInstance();
  const strategy = options?.strategy || "quality";

  let sql = "SELECT * FROM proxy_registry WHERE source = 'oneproxy' AND status = 'active'";

  switch (strategy) {
    case "quality":
      sql += " ORDER BY quality_score DESC, latency_ms ASC LIMIT 1";
      break;
    case "random":
      sql += " ORDER BY RANDOM() LIMIT 1";
      break;
    case "sequential":
      sql += " ORDER BY last_validated ASC LIMIT 1";
      break;
  }

  const row = db.prepare(sql).get();
  if (!row) return null;
  return mapProxyRow(row);
}

export async function markOneproxyProxyFailed(host: string, port: number): Promise<boolean> {
  const db = getDbInstance();
  const result = db
    .prepare(
      `UPDATE proxy_registry
       SET quality_score = MAX(0, COALESCE(quality_score, 50) - 10),
           status = CASE WHEN COALESCE(quality_score, 50) <= 10 THEN 'inactive' ELSE status END,
           updated_at = datetime('now')
       WHERE host = ? AND port = ? AND source = 'oneproxy'`
    )
    .run(host, port);
  backupDbFile("pre-write");
  return result.changes > 0;
}
