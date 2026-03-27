import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { CalculationRequest, CalculationResponse } from '../types/pvTypes';
import { runCalculation } from './calcService';

interface QueueTask {
	request: CalculationRequest;
	resolve: (value: CalculationResponse) => void;
	reject: (reason?: unknown) => void;
}

const MAX_QUEUE_SIZE = 120;
const MAX_WORKERS = Math.max(1, Math.min(4, os.cpus().length - 1));

let activeWorkers = 0;
const queue: QueueTask[] = [];

function getWorkerScriptPath(): { script: string; tsMode: boolean } {
	const jsPath = path.resolve(__dirname, '../workers/calcWorker.js');
	const tsPath = path.resolve(__dirname, '../workers/calcWorker.ts');

	if (fs.existsSync(jsPath)) {
		return { script: jsPath, tsMode: false };
	}
	return { script: tsPath, tsMode: true };
}

async function executeWithWorker(request: CalculationRequest): Promise<CalculationResponse> {
	const { script, tsMode } = getWorkerScriptPath();
	return new Promise((resolve, reject) => {
		const worker = new Worker(script, {
			workerData: request,
			execArgv: tsMode ? [...process.execArgv, '-r', 'ts-node/register'] : process.execArgv,
		});

		worker.once('message', (message: unknown) => {
			const payload = message as { ok: boolean; data?: CalculationResponse; error?: string };
			if (payload?.ok && payload.data) {
				resolve(payload.data);
			} else {
				reject(new Error(payload?.error || 'Worker calculation failed.'));
			}
		});

		worker.once('error', (error) => {
			reject(error);
		});

		worker.once('exit', (code) => {
			if (code !== 0) {
				reject(new Error(`Worker exited with code ${code}`));
			}
		});
	});
}

async function runTask(task: QueueTask): Promise<void> {
	activeWorkers++;
	try {
		const result = await executeWithWorker(task.request);
		task.resolve(result);
	} catch {
		try {
			const fallback = await runCalculation(task.request);
			task.resolve(fallback);
		} catch (error) {
			task.reject(error);
		}
	} finally {
		activeWorkers--;
		drainQueue();
	}
}

function drainQueue(): void {
	while (activeWorkers < MAX_WORKERS && queue.length > 0) {
		const task = queue.shift();
		if (!task) {
			break;
		}
		void runTask(task);
	}
}

export function runCalculationInWorker(request: CalculationRequest): Promise<CalculationResponse> {
	if (queue.length >= MAX_QUEUE_SIZE) {
		throw new Error('Berechnungsdienst ist derzeit ueberlastet. Bitte in einigen Sekunden erneut versuchen.');
	}

	return new Promise((resolve, reject) => {
		queue.push({ request, resolve, reject });
		drainQueue();
	});
}

