import { parentPort, workerData } from 'worker_threads';
import { runCalculation } from '../services/calcService';
import { CalculationRequest } from '../types/pvTypes';

async function main(): Promise<void> {
	try {
		const request = workerData as CalculationRequest;
		const result = await runCalculation(request);
		parentPort?.postMessage({ ok: true, data: result });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown worker error';
		parentPort?.postMessage({ ok: false, error: message });
	}
}

void main();

