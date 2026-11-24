/** Build estático por allowlist: somente a interface e JSONs públicos validados. */
import { copyFile, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validatePublishedData } from './store.mjs';
import { readProcurement } from './procurement-store.mjs';
import { readNotices } from './pncp-notices-store.mjs';
import { readAtas } from './pncp-atas-store.mjs';
import {buildCoverageIndex} from './coverage-index.mjs';
import {validateParticipantReferences} from './collect-pncp-ata-participants.mjs';
import {validateTenderCatalog} from './collect-pncp-tender-items.mjs';

export async function buildSite(root = process.cwd(), destination = 'dist') {
  const base = resolve(root), output = resolve(base, destination);
  if (output === base || !output.startsWith(base + '/')) {
    throw Error('Destino de publicação não autorizado');
  }
  const { manifest, months } = await validatePublishedData(base);
  const procurement = await readProcurement(base);
  const notices = await readNotices(base);
  const atas = await readAtas(base);
  await rm(output, { recursive: true, force: true });
  await mkdir(join(output, 'assets'), { recursive: true });
  await mkdir(join(output, 'data', 'months'), { recursive: true });

  for (const file of ['index.html', '.nojekyll', 'assets/app.js', 'assets/procurement-links.js', 'assets/procurement-financial-evidence.js', 'assets/procurement-evidence-coverage.js', 'assets/procurement-evidence-audit.js', 'assets/procurement-audit-report.js', 'assets/procurement-structured-filters.js', 'assets/pncp-modalities.js', 'assets/instrument-types.js', 'assets/document-species.js', 'assets/quality.js', 'assets/coverage-panel.js', 'assets/trajectory.js', 'assets/dialog-scroll.js', 'assets/siafi-movement-audit.js', 'assets/siafi-movement-reconciliation.js', 'assets/style.css',
    'data/manifest.json']) {
    await copyFile(join(base, file), join(output, file));
  }
  if (procurement) {
    await mkdir(join(output,'data','procurement'),{recursive:true});
    await copyFile(join(base,'data','procurement','contracts.json'),
      join(output,'data','procurement','contracts.json'));
  }
  if (notices) {
    await mkdir(join(output,'data','procurement'),{recursive:true});
    await copyFile(join(base,'data','procurement','notices.json'),
      join(output,'data','procurement','notices.json'));
  }
  if (atas.atas.length || atas.checks.length) {
    await mkdir(join(output,'data','procurement'),{recursive:true});
    await copyFile(join(base,'data','procurement','atas.json'),
      join(output,'data','procurement','atas.json'));
  }
  let tender=null,participants=null;
  try {
    tender=JSON.parse(await readFile(join(base,'data','procurement','tender-items.json'),'utf8'));
    validateTenderCatalog(tender,notices?.notices||[]);
    await mkdir(join(output,'data','procurement'),{recursive:true});
    await copyFile(join(base,'data','procurement','tender-items.json'),join(output,'data','procurement','tender-items.json'));
  } catch(e) { if(e.code!=='ENOENT')throw e; }
  try{participants=validateParticipantReferences(JSON.parse(await readFile(join(base,'data','procurement','ata-participants.json'),'utf8')),atas.atas)}
  catch(e){if(e.code!=='ENOENT')throw e}
  if(participants){
    await mkdir(join(output,'data','procurement'),{recursive:true});
    await copyFile(join(base,'data','procurement','ata-participants.json'),join(output,'data','procurement','ata-participants.json'));
  }
  const index=buildCoverageIndex({months,manifest,procurement,notices,atas,tender,participants});
  await writeFile(join(output,'data','coverage-index.json'),JSON.stringify(index)+'\n');
  for (const month of manifest.months) {
    const file = month + '.json';
    await copyFile(join(base, 'data', 'months', file),
      join(output, 'data', 'months', file));
  }
  // Confere que só arquivos enumerados entraram no site; nenhum segredo ou fonte bruta.
  const exported = JSON.parse(await readFile(join(output, 'data', 'manifest.json'), 'utf8'));
  if (exported.months.length !== months.length) throw Error('Manifesto publicado inconsistente');
  return { months: months.length, documents: months.reduce((n, month) =>
    n + month.documents.length, 0), ...(procurement?{contracts:procurement.contracts.length}:{}), ...(notices?{notices:notices.notices.length}:{}) };
}

if (process.argv[1] && import.meta.url === new URL('file://' + resolve(process.argv[1])).href) {
  buildSite().then(result => console.log('Artefato público validado: ' + result.months +
    ' competência(s); ' + result.documents + ' documento(s).'))
    .catch(() => {
      console.error('Publicação bloqueada: artefato inválido, dados pessoais ou arquivo ausente.');
      process.exitCode = 1;
    });
}
