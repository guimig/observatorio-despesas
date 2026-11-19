import { collectWindow } from './cgu.mjs';
import { persistWindow, validatePublishedData, mergeMonth } from './store.mjs';

async function main() {
  const token = process.env.CGU_API_KEY;
  if (!token) throw Error('CGU_API_KEY não configurada neste repositório');
  const now = new Date();
  const patches = await collectWindow({
    token, now,
    lookback: process.env.CGU_LOOKBACK_DAYS || 7,
    maxPages: process.env.CGU_MAX_PAGES || 30,
    maxImpactPages: process.env.CGU_MAX_IMPACT_PAGES || 8
  });
  const partial = patches.filter(patch => !patch.coverage.complete);
  const invalid = patches.reduce((acc, patch) => acc + patch.coverage.invalid, 0);
  const count = patches.reduce((acc, patch) => acc + patch.coverage.count, 0);
  if (process.argv.includes('--dry-run')) {
    // Validação em memória; nenhum dado é gravado durante um diagnóstico.
    const months = new Map();
    for (const patch of patches) {
      const month = patch.coverage.date.slice(0, 7);
      if (!months.has(month)) months.set(month, []);
      months.get(month).push(patch);
    }
    for (const [month, group] of months) mergeMonth(null, month, group, now);
    console.log('Simulação CGU: '+patches.length+' consultas; '+count+
      ' documentos; consultas parciais: '+partial.length+'; valores ausentes: '+invalid);
    return;
  }
  const outcome = await persistWindow(process.cwd(), patches, now);
  await validatePublishedData(process.cwd());
  console.log('CGU UG 158459: '+patches.length+' consultas; '+count+
    ' documentos; consultas parciais: '+partial.length+
    '; valores ausentes: '+invalid+
    '; meses modificados: '+outcome.updatedMonths.join(', ')+
    '; nenhum dado pessoal bruto persistido');
}
main().catch(error => {
  // Mensagens controladas: nunca registrar body da API, token ou payloads.
  const allowed = /^(CGU HTTP \d+|CGU_API_KEY |CGU indisponível|Formato|Configuração|Consulta)/;
  console.error(allowed.test(error.message) ? error.message :
    'Coleta interrompida. Não publicar resultados potencialmente inválidos.');
  process.exitCode = 1;
});
