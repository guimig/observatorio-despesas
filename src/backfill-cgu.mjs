/** Recuperação CGU por pequenos lotes, com checkpoints no próprio JSON mensal. */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { collectWindow } from './cgu.mjs';
import { planHistoricalDays, chooseHistoricalMonth, missingCommitmentYears } from './backfill.mjs';
import { persistWindow, validateMonth, validatePublishedData } from './store.mjs';

async function readExisting(month) {
  const path = join(process.cwd(), 'data', 'months', month + '.json');
  try { return validateMonth(JSON.parse(await readFile(path, 'utf8'))); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function referencedYears() {
  const folder=join(process.cwd(),'data','months');
  const names=(await readdir(folder)).filter(name=>/^20\d{2}-(0[1-9]|1[0-2])\.json$/.test(name));
  const months=[];
  for(const name of names) months.push(await readExisting(name.slice(0,7)));
  return missingCommitmentYears(months.filter(Boolean));
}
async function main() {
  const now = new Date();
  const priorityYears=await referencedYears();
  const prioritize=process.env.BACKFILL_PRIORITY_REFERENCES !== 'false' &&
    Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',day:'numeric'}).format(now))%2===1;
  const month = await chooseHistoricalMonth({
    requestedMonth:process.env.BACKFILL_MONTH||'',
    earliestMonth:process.env.BACKFILL_EARLIEST_MONTH||'2025-01',
    now,loadExisting:readExisting,priorityYears,prioritize
  });
  if (!month) {
    console.log('Nenhuma competência histórica com dias pendentes no intervalo configurado.');
    return;
  }
  const options = {
    month, now, existing: await readExisting(month),
    batchDays: Number(process.env.BACKFILL_DAYS || 3),
    startDay: Number(process.env.BACKFILL_START_DAY || 1),
    recheck: process.env.BACKFILL_RECHECK === 'true'
  };
  const days = planHistoricalDays(options);
  if (!days.length) {
    console.log('Nenhum dia elegível para coleta histórica em ' + month +
      '. Cobertura existente preservada.');
    return;
  }
  console.log('Modo de recuperação: '+(prioritize?'NEs referenciadas sem documento':'cobertura recente')+'. Anos pendentes: '+priorityYears.join(', '));
  console.log('Plano histórico: ' + month + '; ' + days.length +
    ' dia(s) elegível(is) para o lote.');
  if (process.argv.includes('--dry-run')) {
    console.log('Simulação: nenhuma consulta e nenhum arquivo gravado.');
    return;
  }
  const token = process.env.CGU_API_KEY;
  if (!token) throw Error('CGU_API_KEY ausente no repositório');
  let succeeded = 0, failed = 0, totalDocs = 0;
  for (const date of days) {
    try {
      const patches = await collectWindow({
        token, now, dates: [date],
        maxPages: process.env.CGU_MAX_PAGES || 30,
        maxImpactPages: process.env.CGU_MAX_IMPACT_PAGES || 8
      });
      await persistWindow(process.cwd(), patches, now);
      succeeded++;
      totalDocs += patches.reduce((sum, patch) => sum + patch.documents.length, 0);
      console.log(date + ': ' + patches.length + ' fases consultadas, ' +
        patches.reduce((sum, patch) => sum + patch.coverage.count, 0) +
        ' documentos (fase incompleta: ' +
        patches.filter(patch => !patch.coverage.complete).length + ')');
    } catch {
      failed++;
      // A próxima execução recupera o dia ausente; os dias válidos são mantidos.
      console.warn(date + ': consulta não concluída; checkpoint anterior preservado.');
    }
  }
  await validatePublishedData(process.cwd());
  console.log('Resultado da coleta histórica: ' + succeeded + ' dia(s) concluído(s); ' +
    failed + ' falha(s); ' + totalDocs + ' documento(s) obtidos.');
  if (!succeeded) throw Error('Nenhum dia concluído: dados existentes mantidos');
}
main().catch(() => {
  console.error('Backfill CGU interrompido; dados de períodos anteriormente validados preservados.');
  process.exitCode = 1;
});
