/**
 * Laboratório (docs/LAB.md): tipos compartilhados pelo núcleo de cenários, pela janela (lab/renderer) e pelo terminal (lab/cli.ts).
 * Um cenário recebe parâmetros validados e devolve um Relatório feito de seções genéricas: a janela, o terminal e o HTML exportado
 * desenham as mesmas seções, então um teste rodado no terminal e na janela mostra exatamente os mesmos números.
 */

export type Cell = string | number | null;
export type Tone = 'ok' | 'warn' | 'bad';

export type Section =
  | { kind: 'kpis'; title?: string; items: Array<{ label: string; value: string; hint?: string; tone?: Tone }> }
  | { kind: 'table'; title: string; columns: string[]; rows: Cell[][]; note?: string; /** colunas numéricas alinhadas à direita */ numeric?: number[] }
  | { kind: 'checks'; title: string; items: Array<{ label: string; value: string; target: string; ok: boolean }> }
  | { kind: 'bars'; title: string; items: Array<{ label: string; value: number; display?: string }>; note?: string }
  | { kind: 'events'; title: string; items: Array<{ minute: string; team: 0 | 1 | null; text: string }> }
  | { kind: 'text'; title?: string; body: string; tone?: Tone };

export interface Report {
  scenario: string; title: string;
  params: Record<string, ParamValue>;
  startedAt: string; ms: number;
  sections: Section[];
  /** dados brutos para quem quiser ir além (exportados no JSON) */ data?: unknown;
}

export type ParamValue = string | number | boolean;
/** fontes de opções que dependem do universo escolhido ou do disco */
export type OptionSource = 'clubs' | 'formations' | 'saves';

export type ParamDef =
  | { key: string; label: string; kind: 'number'; default: number; min: number; max: number; step?: number; help?: string }
  | { key: string; label: string; kind: 'text'; default: string; help?: string }
  | { key: string; label: string; kind: 'boolean'; default: boolean; help?: string }
  | { key: string; label: string; kind: 'select'; default: string; options?: Array<{ value: string; label: string }>;
      /** opções vindas do universo/disco (somadas às fixas, que vêm primeiro) */ source?: OptionSource; help?: string };

export interface Progress { done: number; total: number; label?: string }
export interface RunContext {
  onProgress: (p: Progress) => void;
  /** cancelado pelo usuário: o cenário deve parar e lançar `Cancelled` */
  cancelled: () => boolean;
}

export interface Scenario {
  id: string; title: string; description: string;
  params: ParamDef[];
  run: (params: Record<string, ParamValue>, ctx: RunContext) => Promise<Omit<Report, 'scenario' | 'title' | 'params' | 'startedAt' | 'ms'>>;
}

export class Cancelled extends Error { constructor() { super('Execução cancelada.'); this.name = 'Cancelled'; } }
export class ParamError extends Error { constructor(msg: string) { super(msg); this.name = 'ParamError'; } }
