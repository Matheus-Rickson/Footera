/**
 * Worker do Laboratório: roda um cenário (ou monta as opções de um formulário) fora do processo principal, para a janela não travar.
 * Cancelar = o processo principal encerra o worker (terminate): funciona até no meio de uma partida.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { optionsFor, runScenario } from '../core/registry.ts';
import type { OptionSource, ParamValue } from '../core/types.ts';

type Job =
  | { type: 'run'; id: string; params: Record<string, unknown> }
  | { type: 'options'; source: OptionSource; params: Record<string, ParamValue> };

const job = workerData as Job;
const post = (m: unknown) => parentPort!.postMessage(m);

(async () => {
  try {
    if (job.type === 'options') { post({ type: 'result', value: optionsFor(job.source, job.params) }); return; }
    const report = await runScenario(job.id, job.params, { cancelled: () => false, onProgress: (p) => post({ type: 'progress', value: p }) });
    post({ type: 'result', value: report });
  } catch (e) {
    post({ type: 'error', value: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
  }
})();
