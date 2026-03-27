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
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const worker_threads_1 = require("worker_threads");
const calcService_1 = require("./calcService");
const MAX_QUEUE_SIZE = 120;
const MAX_WORKERS = Math.max(1, Math.min(4, os.cpus().length - 1));
let activeWorkers = 0;
const queue = [];
function getWorkerScriptPath() {
    const jsPath = path.resolve(__dirname, '../workers/calcWorker.js');
    const tsPath = path.resolve(__dirname, '../workers/calcWorker.ts');
    if (fs.existsSync(jsPath)) {
        return { script: jsPath, tsMode: false };
    }
    return { script: tsPath, tsMode: true };
}
async function executeWithWorker(request) {
    const { script, tsMode } = getWorkerScriptPath();
    return new Promise((resolve, reject) => {
        const worker = new worker_threads_1.Worker(script, {
            workerData: request,
            execArgv: tsMode ? [...process.execArgv, '-r', 'ts-node/register'] : process.execArgv,
        });
        worker.once('message', (message) => {
            const payload = message;
            if (payload?.ok && payload.data) {
                resolve(payload.data);
            }
            else {
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
async function runTask(task) {
    activeWorkers++;
    try {
        const result = await executeWithWorker(task.request);
        task.resolve(result);
    }
    catch {
        try {
            const fallback = await (0, calcService_1.runCalculation)(task.request);
            task.resolve(fallback);
        }
        catch (error) {
            task.reject(error);
        }
    }
    finally {
        activeWorkers--;
        drainQueue();
    }
}
function drainQueue() {
    while (activeWorkers < MAX_WORKERS && queue.length > 0) {
        const task = queue.shift();
        if (!task) {
            break;
        }
        void runTask(task);
    }
}
function runCalculationInWorker(request) {
    if (queue.length >= MAX_QUEUE_SIZE) {
        throw new Error('Berechnungsdienst ist derzeit ueberlastet. Bitte in einigen Sekunden erneut versuchen.');
    }
    return new Promise((resolve, reject) => {
        queue.push({ request, resolve, reject });
        drainQueue();
    });
}
