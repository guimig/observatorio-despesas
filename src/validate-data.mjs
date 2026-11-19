import { validatePublishedData } from './store.mjs';
import { readProcurement } from './procurement-store.mjs';
import { readNotices } from './pncp-notices-store.mjs';

try {
  const result = await validatePublishedData(process.cwd());
  const procurement = await readProcurement(process.cwd());
  const notices = await readNotices(process.cwd());
  const total = result.months.reduce((n, month) => n + month.documents.length, 0);
  console.log('Dados públicos validados: '+(procurement?.contracts.length||0)+' contratos; '+(notices?.notices.length||0)+' licitacoes/contratacoes; ' + result.months.length +
    ' mês(es); ' + total + ' documento(s); nenhum CPF integral.');
} catch {
  console.error('Validação de dados públicos falhou: esquema, privacidade ou integridade.');
  process.exitCode = 1;
}
