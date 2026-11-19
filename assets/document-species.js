/** Espécie do documento SIAFI ≠ etapa completa nem situação do lançamento.
 * A fase é atribuída pela CGU; não presumir pagamento liquidado, original,
 * anulado ou estornado apenas pela sigla no identificador.
 */
const NAMES={
 NE:'Nota de Empenho',
 NS:'Nota de Sistema',
 NL:'Nota de Lançamento',
 OB:'Ordem Bancária',
 DF:'Documento de Arrecadação de Receitas Federais (DARF)',
 DR:'Documento de Arrecadação',
 GR:'Guia de Recolhimento da União'
};
export function documentSpecies(document) {
  const id=typeof document==='string'?document:document?.id;
  const match=typeof id==='string'&&
    /^158459\d{5}20\d{2}([A-Z]{2})\d{6}$/.exec(id);
  if(!match)return {code:null,label:'Espécie não identificada'};
  const code=match[1];
  return {code,label:NAMES[code]??'Documento SIAFI '+code};
}
export function financialPhaseDescription(phase) {
  if(phase===1)return 'Empenho — fase informada pela CGU';
  if(phase===2)return 'Liquidação — documentos classificados pela CGU';
  if(phase===3)return 'Pagamento — documentos classificados pela CGU';
  return 'Fase não reconhecida';
}
