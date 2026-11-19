import { validatePublishedData } from './store.mjs';

try {
  const result = await validatePublishedData(process.cwd());
  const total = result.months.reduce((n, month) => n + month.documents.length, 0);
  console.log('Dados públicos validados: ' + result.months.length +
    ' mês(es); ' + total + ' documento(s); nenhum CPF integral.');
} catch {
  console.error('Validação de dados públicos falhou: esquema, privacidade ou integridade.');
  process.exitCode = 1;
}
