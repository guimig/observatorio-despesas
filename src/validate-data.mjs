import {readFile} from 'node:fs/promises';
import { validatePublishedData } from './store.mjs';
import {readPublicDictionaries} from './siop-public-catalog.mjs';
import { readProcurement } from './procurement-store.mjs';
import { readNotices } from './pncp-notices-store.mjs';
import { readAtas } from './pncp-atas-store.mjs';
import {readCguContractEvidence} from './cgu-contract-evidence.mjs';
import {validateParticipantReferences} from './collect-pncp-ata-participants.mjs';
import {validateTenderCatalog} from './collect-pncp-tender-items.mjs';
import { summarizeInstrumentTypes } from '../assets/instrument-types.js';
import { auditMonth } from '../assets/quality.js';

try {
  const result = await validatePublishedData(process.cwd());
  await readPublicDictionaries(process.cwd());
  const procurement = await readProcurement(process.cwd());
  const notices = await readNotices(process.cwd());
  const atas = await readAtas(process.cwd());
  await readCguContractEvidence(process.cwd());
  try{validateParticipantReferences(JSON.parse(await readFile('data/procurement/ata-participants.json','utf8')),atas.atas)}
  catch(e){if(e.code!=='ENOENT')throw e}
  try{validateTenderCatalog(JSON.parse(await readFile('data/procurement/tender-items.json','utf8')),notices.notices)}
  catch(e){if(e.code!=='ENOENT')throw e}
  const total = result.months.reduce((n, month) => n + month.documents.length, 0);
  const audits=result.months.map(month=>auditMonth(month));
  const problems=audits.filter(audit=>audit.issues.length);
  if(problems.length)throw Error('Inconsistência estrutural no acervo');
  const pending=audits.reduce((n,audit)=>n+audit.enrichment.pending,0);
  const reviews=audits.reduce((n,audit)=>n+audit.links.liquidationValueReviews,0);
  const instruments = procurement?.contracts || [];
  const kinds = summarizeInstrumentTypes(instruments);
  console.log('Dados públicos validados: '+instruments.length+' instrumentos PNCP/Compras ('+
    kinds.formal+' contratos formais, '+kinds.commitments+' empenhos substitutivos, '+
    (kinds.other+kinds.unclassified)+' outros/não classificados); '+
    (notices?.notices.length||0)+' licitações/contratações; '+
    atas.atas.length+' atas PNCP; '+
    result.months.length+' mês(es); '+total+' documento(s); '+pending+
    ' consulta(s) complementar(es) pendente(s); '+reviews+
    ' liquidação(ões) para revisão documental; nenhum CPF integral.');
} catch {
  console.error('Validação de dados públicos falhou: esquema, privacidade ou integridade.');
  process.exitCode = 1;
}
