"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Persistent Worker Thread für CPU-intensive Berechnungen.
 * Empfängt CalculationRequest-Payloads via postMessage,
 * führt runCalculation aus und sendet das Ergebnis zurück.
 */
const worker_threads_1 = require("worker_threads");
const calcService_1 = require("../services/calcService");
if (!worker_threads_1.parentPort) {
    throw new Error('calcWorker muss als Worker Thread gestartet werden');
}
worker_threads_1.parentPort.on('message', async (msg) => {
    try {
        const result = await (0, calcService_1.runCalculation)(msg.payload);
        worker_threads_1.parentPort.postMessage({ id: msg.id, ok: true, result });
    }
    catch (err) {
        worker_threads_1.parentPort.postMessage({ id: msg.id, ok: false, error: err?.message ?? 'Worker error' });
    }
});
