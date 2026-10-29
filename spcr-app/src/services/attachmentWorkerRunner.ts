import { parentPort, workerData } from 'node:worker_threads';
import { parseAttachmentBufferLowLevel } from './attachmentWorkerTask.js';

(async () => {
  if (!parentPort) return;
  try {
    if (workerData?.simulateHangMs && workerData.simulateHangMs > 0) {
      const end = Date.now() + Number(workerData.simulateHangMs);
      while (Date.now() < end) {
        // Intentional CPU spin for isolated worker-thread timeout test
      }
    }
    const buf = Buffer.from(workerData.bytes);
    const outcome = await parseAttachmentBufferLowLevel(buf, workerData.metadata, workerData.limits);
    parentPort.postMessage({ ok: true, outcome });
  } catch (err: any) {
    parentPort.postMessage({
      ok: false,
      error: err?.message || 'Worker parse error',
    });
  }
})();

