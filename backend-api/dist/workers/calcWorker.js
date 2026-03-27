"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const worker_threads_1 = require("worker_threads");
const calcService_1 = require("../services/calcService");
async function main() {
    try {
        const request = worker_threads_1.workerData;
        const result = await (0, calcService_1.runCalculation)(request);
        worker_threads_1.parentPort?.postMessage({ ok: true, data: result });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown worker error';
        worker_threads_1.parentPort?.postMessage({ ok: false, error: message });
    }
}
void main();
