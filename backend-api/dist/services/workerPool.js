"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCalculationInWorker = runCalculationInWorker;
exports.getPoolStatus = getPoolStatus;
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
const worker_threads_1 = require("worker_threads");
const path = __importStar(require("path"));
const os = __importStar(require("os"));
// ── Pool-Größe ─────────────────────────────────────────────────────────────
const POOL_SIZE = Math.min(Math.max(2, os.cpus().length - 1), 8);
const QUEUE_LIMIT = 500;
// ── Pfad zum Worker-Skript ─────────────────────────────────────────────────
const isTs = __filename.endsWith('.ts');
const workerPath = isTs
    ? path.join(__dirname, '../workers/calcWorker.ts')
    : path.join(__dirname, '../workers/calcWorker.js');
const workerExecArgv = isTs
    ? ['--require', require.resolve('ts-node/register/transpile-only')]
    : [];
// ── Zustand ────────────────────────────────────────────────────────────────
const pool = [];
const queue = [];
let nextId = 0;
// ── Worker erstellen ───────────────────────────────────────────────────────
function spawnWorker() {
    const worker = new worker_threads_1.Worker(workerPath, { execArgv: workerExecArgv });
    const wrapper = { worker, busy: false };
    // Nachrichten von Worker-Instanz entgegennehmen
    worker.on('message', (msg) => {
        const item = inflightMap.get(msg.id);
        if (!item)
            return;
        inflightMap.delete(msg.id);
        wrapper.busy = false;
        if (msg.ok) {
            item.resolve(msg.result);
        }
        else {
            item.reject(new Error(msg.error ?? 'Worker-Fehler'));
        }
        // Nächsten Auftrag aus der Queue bedienen
        const next = queue.shift();
        if (next)
            dispatch(wrapper, next);
    });
    worker.on('error', (err) => {
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
function replaceWorker(wrapper) {
    const idx = pool.indexOf(wrapper);
    if (idx !== -1)
        pool.splice(idx, 1);
    // In-Flight-Requests des abgestürzten Workers abschließen
    for (const [id, item] of inflightMap.entries()) {
        // Wir wissen nicht welchem Worker der Request zugeordnet war →
        // versuche denselben Job neu zu senden falls Queue nicht voll ist
        inflightMap.delete(id);
        wrapper.busy = false;
        if (queue.length < QUEUE_LIMIT) {
            queue.push(item);
        }
        else {
            item.reject(new Error('Worker abgestürzt, Neuversuch nicht möglich (Queue voll)'));
        }
    }
    const replacement = spawnWorker();
    pool.push(replacement);
    // Ausstehende Jobs aufnehmen
    const pending = queue.splice(0, 1);
    if (pending.length)
        dispatch(replacement, pending[0]);
}
// Map job-id → QueueItem für aktive Worker-Aufträge
const inflightMap = new Map();
function dispatch(wrapper, item) {
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
function runCalculationInWorker(payload) {
    return new Promise((resolve, reject) => {
        if (queue.length >= QUEUE_LIMIT) {
            return reject(new Error('Server überlastet – bitte kurz warten und erneut versuchen'));
        }
        const id = nextId++;
        const item = { id, payload, resolve, reject };
        const free = pool.find(w => !w.busy);
        if (free) {
            dispatch(free, item);
        }
        else {
            queue.push(item);
        }
    });
}
/** Aktueller Zustand des Pools (für Monitoring / Health-Check). */
function getPoolStatus() {
    return {
        poolSize: pool.length,
        busyWorkers: pool.filter(w => w.busy).length,
        queueLength: queue.length,
    };
}
