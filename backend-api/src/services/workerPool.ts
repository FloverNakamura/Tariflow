/**
 * Worker Thread Pool für /api/calculate.
 *
 * Spawnt N persistente Worker-Threads (N = CPU-Kerne − 1, mind. 2, max. 8).
 * Eingehende Requests werden an freie Worker delegiert; ist kein Worker frei,
 * landen sie in einer Queue. Queue-Limit: 500 Items → danach 503-Fehler.
 *
 * ts-node-Kompatibilität: läuft der Server über ts-node (src/*.ts), wird
 * '--require ts-node/register' als execArgv an die Worker übergeben.
 * Im kompilierten Build (dist/*.js) wird der Worker direkt als JS geladen.
 */
import { Worker } from 'worker_threads';
import * as path from 'path';
import * as os from 'os';
import { CalculationRequest, CalculationResponse } from '../types/pvTypes';

// ── Pool-Größe ─────────────────────────────────────────────────────────────
const POOL_SIZE   = Math.min(Math.max(2, os.cpus().length - 1), 8);
const QUEUE_LIMIT = 500;

// ── Pfad zum Worker-Skript ─────────────────────────────────────────────────
const isTs = __filename.endsWith('.ts');
const workerPath = isTs
  ? path.join(__dirname, '../workers/calcWorker.ts')
  : path.join(__dirname, '../workers/calcWorker.js');
const workerExecArgv = isTs
  ? ['--require', require.resolve('ts-node/register/transpile-only')]
  : [];

// ── Interne Typen ──────────────────────────────────────────────────────────
interface WorkerWrapper {
  worker: Worker;
  busy:   boolean;
}

interface QueueItem {
  id:      number;
  payload: CalculationRequest;
  resolve: (v: CalculationResponse) => void;
  reject:  (e: Error) => void;
}

// ── Zustand ────────────────────────────────────────────────────────────────
const pool:  WorkerWrapper[] = [];
const queue: QueueItem[]     = [];
let   nextId = 0;

// ── Worker erstellen ───────────────────────────────────────────────────────
function spawnWorker(): WorkerWrapper {
  const worker  = new Worker(workerPath, { execArgv: workerExecArgv });
  const wrapper: WorkerWrapper = { worker, busy: false };

  // Nachrichten von Worker-Instanz entgegennehmen
  worker.on('message', (msg: { id: number; ok: boolean; result?: CalculationResponse; error?: string }) => {
    const item = inflightMap.get(msg.id);
    if (!item) return;

    inflightMap.delete(msg.id);
    wrapper.busy = false;

    if (msg.ok) {
      item.resolve(msg.result!);
    } else {
      item.reject(new Error(msg.error ?? 'Worker-Fehler'));
    }

    // Nächsten Auftrag aus der Queue bedienen
    const next = queue.shift();
    if (next) dispatch(wrapper, next);
  });

  worker.on('error', (err: Error) => {
    console.error('[WorkerPool] Worker-Fehler:', err.message);
    replaceWorker(wrapper);
  });

  worker.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[WorkerPool] Worker beendet mit Code ${code}`);
      replaceWorker(wrapper);
    }
  });

  return wrapper;
}

/**
 * Abstürzenden Worker aus dem Pool entfernen und neu ersetzen.
 * Alle In-Flight-Requests dieses Workers werden mit Fehler rejected.
 */
function replaceWorker(wrapper: WorkerWrapper): void {
  const idx = pool.indexOf(wrapper);
  if (idx !== -1) pool.splice(idx, 1);

  // In-Flight-Requests des abgestürzten Workers abschließen
  for (const [id, item] of inflightMap.entries()) {
    // Wir wissen nicht welchem Worker der Request zugeordnet war →
    // versuche denselben Job neu zu senden falls Queue nicht voll ist
    inflightMap.delete(id);
    wrapper.busy = false;
    if (queue.length < QUEUE_LIMIT) {
      queue.push(item);
    } else {
      item.reject(new Error('Worker abgestürzt, Neuversuch nicht möglich (Queue voll)'));
    }
  }

  const replacement = spawnWorker();
  pool.push(replacement);

  // Ausstehende Jobs aufnehmen
  const pending = queue.splice(0, 1);
  if (pending.length) dispatch(replacement, pending[0]);
}

// Map job-id → QueueItem für aktive Worker-Aufträge
const inflightMap = new Map<number, QueueItem>();

function dispatch(wrapper: WorkerWrapper, item: QueueItem): void {
  wrapper.busy = true;
  inflightMap.set(item.id, item);
  wrapper.worker.postMessage({ id: item.id, payload: item.payload });
}

// ── Pool initialisieren ────────────────────────────────────────────────────
for (let i = 0; i < POOL_SIZE; i++) {
  pool.push(spawnWorker());
}
console.log(`[WorkerPool] ${POOL_SIZE} Worker gestartet (${isTs ? 'ts-node' : 'kompiliert'})`);

// ── Öffentliche API ────────────────────────────────────────────────────────
export function runCalculationInWorker(payload: CalculationRequest): Promise<CalculationResponse> {
  return new Promise((resolve, reject) => {
    if (queue.length >= QUEUE_LIMIT) {
      return reject(new Error('Server überlastet – bitte kurz warten und erneut versuchen'));
    }

    const id   = nextId++;
    const item: QueueItem = { id, payload, resolve, reject };
    const free = pool.find(w => !w.busy);

    if (free) {
      dispatch(free, item);
    } else {
      queue.push(item);
    }
  });
}

/** Aktueller Zustand des Pools (für Monitoring / Health-Check). */
export function getPoolStatus() {
  return {
    poolSize:    pool.length,
    busyWorkers: pool.filter(w => w.busy).length,
    queueLength: queue.length,
  };
}
