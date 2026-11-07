/**
 * JSON Schema dos arquivos de pacote, gerado das MESMAS regras Zod usadas pelo jogo (docs/schema/*.schema.json).
 * Editores como o VS Code usam esses arquivos para autocompletar e validar enquanto o autor escreve o patch.
 * Cobre só os tipos Zod usados em `format.ts`; um tipo novo sem conversão gera erro (para não publicar schema errado).
 */
import { z } from 'zod';
import { fileSchemas, manifestSchema, PACK_FILES } from './format.ts';

type Json = Record<string, unknown>;

function convert(t: z.ZodTypeAny): Json {
  const def = t._def as { typeName: string } & Record<string, unknown>;
  switch (def.typeName) {
    case 'ZodOptional': return convert((t as z.ZodOptional<z.ZodTypeAny>).unwrap());
    case 'ZodNullable': { const inner = convert((t as z.ZodNullable<z.ZodTypeAny>).unwrap()); return { anyOf: [inner, { type: 'null' }] }; }
    case 'ZodLiteral': return { const: def.value };
    case 'ZodBoolean': return { type: 'boolean' };
    case 'ZodUnion': return { anyOf: (def.options as z.ZodTypeAny[]).map(convert) };
    case 'ZodEnum': return { type: 'string', enum: [...(def.values as string[])] };
    case 'ZodString': {
      const out: Json = { type: 'string' };
      for (const c of def.checks as Array<{ kind: string; value?: number; regex?: RegExp }>) {
        if (c.kind === 'min') out.minLength = c.value; else if (c.kind === 'max') out.maxLength = c.value; else if (c.kind === 'regex') out.pattern = c.regex!.source;
      }
      return out;
    }
    case 'ZodNumber': {
      const out: Json = { type: 'number' };
      for (const c of def.checks as Array<{ kind: string; value?: number }>) {
        if (c.kind === 'int') out.type = 'integer'; else if (c.kind === 'min') out.minimum = c.value; else if (c.kind === 'max') out.maximum = c.value;
      }
      return out;
    }
    case 'ZodArray': {
      const a = def as unknown as { type: z.ZodTypeAny; maxLength: { value: number } | null; minLength: { value: number } | null };
      return { type: 'array', items: convert(a.type), ...(a.maxLength ? { maxItems: a.maxLength.value } : {}), ...(a.minLength ? { minItems: a.minLength.value } : {}) };
    }
    case 'ZodObject': {
      const shape = (t as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Json = {}; const required: string[] = [];
      for (const [k, v] of Object.entries(shape)) {
        properties[k] = convert(v as z.ZodTypeAny);
        if (!(v as z.ZodTypeAny).isOptional()) required.push(k);
      }
      return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: def.unknownKeys === 'strict' ? false : true };
    }
    default: throw new Error(`jsonSchema: tipo Zod sem conversão (${def.typeName})`);
  }
}

const TITLES: Record<string, string> = {
  manifest: 'Manifesto do pacote de dados', countries: 'Países', leagues: 'Ligas', stadiums: 'Estádios', clubs: 'Clubes', players: 'Jogadores', coaches: 'Técnicos', cups: 'Copas e supercopas',
};

/** Um schema por arquivo do pacote (nome do arquivo → conteúdo). */
export function packJsonSchemas(): Record<string, Json> {
  const out: Record<string, Json> = {};
  const head = (name: string) => ({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: `https://footera.local/schema/${name}.schema.json`, title: `FOOTERA — ${TITLES[name]}` });
  out['manifest.schema.json'] = { ...head('manifest'), ...convert(manifestSchema) };
  for (const f of PACK_FILES) out[`${f}.schema.json`] = { ...head(f), type: 'array', items: convert(fileSchemas[f]) };
  return out;
}
