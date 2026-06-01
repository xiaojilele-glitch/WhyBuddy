/**
 * Browser-side cost store backed by IndexedDB.
 *
 * In pure frontend mode (runtimeMode === "frontend"), cost data is collected
 * from browser-side LLM calls (`callBrowserLLM`) and persisted to IndexedDB
 * so it survives page refreshes.
 *
 * @see Requirements 12.1, 12.2, 12.3
 */

import type {
  AgentCostSummary,
  Budget,
  CostRecord,
  CostSnapshot,
} from "@shared/cost";
import {
  DEFAULT_BUDGET,
  estimateCost,
  PRICING_TABLE,
  DEFAULT_PRICING,
} from "@shared/cost";

// ---------------------------------------------------------------------------
// IndexedDB constants
// ---------------------------------------------------------------------------

const DB_NAME = "whybuddy-cost";
const DB_VERSION = 1;
const STORE_COST_RECORDS = "cost-records";
const STORE_BUDGET = "budget";

// ---------------------------------------------------------------------------
// IndexedDB helpers (mirrors browser-runtime-storage.ts patterns)
// ---------------------------------------------------------------------------

function canUseIndexedDb(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

// ---------------------------------------------------------------------------
// Database lifecycle
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

function openCostDatabase(): Promise<IDBDatabase> {
  if (!canUseIndexedDb()) {
    return Promise.reject(new Error("IndexedDB is not available in this browser."));
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_COST_RECORDS)) {
          db.createObjectStore(STORE_COST_RECORDS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_BUDGET)) {
          db.createObjectStore(STORE_BUDGET, { keyPath: "key" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return dbPromise;
}

// ---------------------------------------------------------------------------
// Low-level read / write
// ---------------------------------------------------------------------------

async function readAllRecords(): Promise<CostRecord[]> {
  const db = await openCostDatabase();
  const tx = db.transaction(STORE_COST_RECORDS, "readonly");
  const store = tx.objectStore(STORE_COST_RECORDS);
  const result = await requestToPromise(store.getAll() as IDBRequest<CostRecord[]>);
  await transactionToPromise(tx);
  return result;
}

async function putRecord(record: CostRecord): Promise<void> {
  const db = await openCostDatabase();
  const tx = db.transaction(STORE_COST_RECORDS, "readwrite");
  tx.objectStore(STORE_COST_RECORDS).put(record);
  await transactionToPromise(tx);
}

async function clearRecords(): Promise<void> {
  const db = await openCostDatabase();
  const tx = db.transaction(STORE_COST_RECORDS, "readwrite");
  tx.objectStore(STORE_COST_RECORDS).clear();
  await transactionToPromise(tx);
}

async function readBudget(): Promise<Budget | null> {
  const db = await openCostDatabase();
  const tx = db.transaction(STORE_BUDGET, "readonly");
  const store = tx.objectStore(STORE_BUDGET);
  const row = await requestToPromise(
    store.get("browser_budget") as IDBRequest<{ key: string; value: Budget } | undefined>
  );
  await transactionToPromise(tx);
  return row?.value ?? null;
}

async function writeBudget(budget: Budget): Promise<void> {
  const db = await openCostDatabase();
  const tx = db.transaction(STORE_BUDGET, "readwrite");
  tx.objectStore(STORE_BUDGET).put({ key: "browser_budget", value: budget });
  await transactionToPromise(tx);
}

// ---------------------------------------------------------------------------
// Snapshot computation
// ---------------------------------------------------------------------------

function computeSnapshot(records: CostRecord[], budget: Budget): CostSnapshot {
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalCost = 0;

  const agentMap = new Map<
    string,
    { tokensIn: number; tokensOut: number; totalCost: number; callCount: number }
  >();

  for (const r of records) {
    totalTokensIn += r.tokensIn;
    totalTokensOut += r.tokensOut;
    totalCost += r.actualCost;

    if (r.agentId) {
      const existing = agentMap.get(r.agentId) ?? {
        tokensIn: 0,
        tokensOut: 0,
        totalCost: 0,
        callCount: 0,
      };
      existing.tokensIn += r.tokensIn;
      existing.tokensOut += r.tokensOut;
      existing.totalCost += r.actualCost;
      existing.callCount += 1;
      agentMap.set(r.agentId, existing);
    }
  }

  const agentCosts: AgentCostSummary[] = Array.from(agentMap.entries())
    .map(([agentId, data]) => ({
      agentId,
      agentName: agentId,
      tokensIn: data.tokensIn,
      tokensOut: data.tokensOut,
      totalCost: data.totalCost,
      callCount: data.callCount,
    }))
    .sort((a, b) => b.totalCost - a.totalCost);

  const budgetUsedPercent =
    budget.maxCost > 0 ? Math.min(totalCost / budget.maxCost, 1) : 0;
  const tokenUsedPercent =
    budget.maxTokens > 0
      ? Math.min((totalTokensIn + totalTokensOut) / budget.maxTokens, 1)
      : 0;

  return {
    totalTokensIn,
    totalTokensOut,
    totalCost,
    totalCalls: records.length,
    budgetUsedPercent,
    tokenUsedPercent,
    agentCosts,
    alerts: [],
    downgradeLevel: "none",
    budget,
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Unique id generator (simple counter + timestamp) */
let idCounter = 0;
function generateId(): string {
  return `bc_${Date.now()}_${++idCounter}`;
}

/**
 * Record a cost entry from a browser-side LLM call.
 *
 * Call this after `callBrowserLLM` completes (success or failure).
 * The record is written to IndexedDB immediately.
 */
export async function recordBrowserCost(
  record: Omit<CostRecord, "id" | "unitPriceIn" | "unitPriceOut" | "actualCost"> & {
    id?: string;
    unitPriceIn?: number;
    unitPriceOut?: number;
    actualCost?: number;
  }
): Promise<CostRecord> {
  const pricing = PRICING_TABLE[record.model] ?? DEFAULT_PRICING;
  const full: CostRecord = {
    id: record.id ?? generateId(),
    timestamp: record.timestamp,
    model: record.model,
    tokensIn: record.tokensIn,
    tokensOut: record.tokensOut,
    unitPriceIn: record.unitPriceIn ?? pricing.input,
    unitPriceOut: record.unitPriceOut ?? pricing.output,
    actualCost:
      record.actualCost ?? estimateCost(record.model, record.tokensIn, record.tokensOut),
    durationMs: record.durationMs,
    agentId: record.agentId,
    missionId: record.missionId,
    sessionId: record.sessionId,
    error: record.error,
  };

  try {
    await putRecord(full);
  } catch (err) {
    // IndexedDB unavailable — degrade silently (data lost on refresh)
    console.warn("[BrowserCostStore] Failed to persist cost record:", err);
  }

  return full;
}

/**
 * Load all cost records from IndexedDB.
 * Call on page load to restore previous session data.
 */
export async function loadBrowserCostRecords(): Promise<CostRecord[]> {
  try {
    return await readAllRecords();
  } catch (err) {
    console.warn("[BrowserCostStore] Failed to load cost records:", err);
    return [];
  }
}

/**
 * Clear all cost records from IndexedDB.
 */
export async function clearBrowserCostRecords(): Promise<void> {
  try {
    await clearRecords();
  } catch (err) {
    console.warn("[BrowserCostStore] Failed to clear cost records:", err);
  }
}

/**
 * Compute a CostSnapshot from stored IndexedDB records.
 */
export async function computeBrowserCostSnapshot(
  budgetOverride?: Budget
): Promise<CostSnapshot> {
  const records = await loadBrowserCostRecords();
  const budget = budgetOverride ?? (await loadBrowserBudget());
  return computeSnapshot(records, budget);
}

/**
 * Load the browser-side budget from IndexedDB, falling back to defaults.
 */
export async function loadBrowserBudget(): Promise<Budget> {
  try {
    return (await readBudget()) ?? { ...DEFAULT_BUDGET };
  } catch {
    return { ...DEFAULT_BUDGET };
  }
}

/**
 * Persist a budget configuration to IndexedDB.
 */
export async function saveBrowserBudget(budget: Budget): Promise<void> {
  try {
    await writeBudget(budget);
  } catch (err) {
    console.warn("[BrowserCostStore] Failed to persist budget:", err);
  }
}
