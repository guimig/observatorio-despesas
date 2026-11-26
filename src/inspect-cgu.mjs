/** Inventário estritamente estrutural: nunca imprime valores retornados pela API. */
import { documentUrl, getCguArray, isoDate, normalizeBudgetNature, CGU_NATURE_FIELDS } from './cgu.mjs';

const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,60}$/;
export function structuralFields(record, maxDepth = 2) {
  const result = [];
  const visit = (obj, prefix, depth) => {
    if (!obj || typeof obj !== 'object' || depth > maxDepth) return;
    for (const key of Object.keys(obj).sort()) {
      // Não registrar valores ou nomes dinâmicos como possíveis chaves de objeto.
      if (!SAFE_KEY.test(key)) continue;
      const value = obj[key];
      const type = value === null ? 'null' :
        Array.isArray(value) ? 'array' : typeof value;
      if (!['string', 'number', 'boolean', 'object', 'array', 'null'].includes(type)) continue;
      const path = prefix ? prefix + '.' + key : key;
      result.push(path + ':' + type);
      if (depth < maxDepth && type === 'object') visit(value, path, depth + 1);
      // Arrays contêm valores que não devem ser logados nem inspecionados.
    }
  };
  visit(record, '', 0);
  return result.sort();
}

async function main() {
  const date = process.env.CGU_SAMPLE_DATE || '13/11/2026';
  isoDate(date);
  const token = process.env.CGU_API_KEY;
  if (!token) throw Error('CGU_API_KEY não configurada');
  for (const phase of [1, 2, 3]) {
    const records = await getCguArray(documentUrl(date, phase, 1), { token });
    if (!records.length) {
      console.log('Fase ' + phase + ': nenhum documento na data escolhida.');
      continue;
    }
    // Somente nomes/categorias de campos em logs; nenhum valor dos registros.
    console.log('Fase ' + phase + ': campos e tipos = ' +
      structuralFields(records[0]).join(', '));
    // Contagens da primeira pagina, nao cobertura global. Nunca imprime valores.
    const fields=Object.fromEntries(Object.entries(CGU_NATURE_FIELDS).map(([key,source])=>[
      key,{present:records.filter(row=>Object.hasOwn(row,source)).length,
      usable:records.filter(row=>Object.hasOwn(normalizeBudgetNature(row),key)).length}
    ]));
    console.log('Classificacao orcamentaria: '+JSON.stringify({phase,sample:records.length,fields}));
  }
  console.log('Inventário de esquema concluído sem publicar documentos ou informações pessoais.');
}
if (process.argv[1] && import.meta.url === new URL('file://' +
  (await import('node:path')).resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('Inventário estrutural da CGU não concluído (sem expor resposta).');
    process.exitCode = 1;
  });
}
