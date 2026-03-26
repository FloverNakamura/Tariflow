/**
 * Persistent Worker Thread für CPU-intensive Berechnungen.
 * Empfängt CalculationRequest-Payloads via postMessage,
 * führt runCalculation aus und sendet das Ergebnis zurück.
 */
import { parentPort } from 'worker_threads';
import { runCalculation } from '../services/calcService';
import { CalculationRequest } from '../types/pvTypes';

if (!parentPort) {
  throw new Error('calcWorker muss als Worker Thread gestartet werden');
}

parentPort.on('message', async (msg: { id: number; payload: CalculationRequest }) => {
  try {
    const result = await runCalculation(msg.payload);
    parentPort!.postMessage({ id: msg.id, ok: true, result });
  } catch (err: any) {
    parentPort!.postMessage({ id: msg.id, ok: false, error: err?.message ?? 'Worker error' });
  }
});
