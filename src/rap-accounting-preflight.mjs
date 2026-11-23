/**
 * Preflight LOCAL para um futuro extrato autorizado SIAFI/Tesouro Gerencial.
 * Nao consulta, grava, registra nem publica registros contabeis.
 * A estrutura abaixo e contrato PROPOSTO, nao leiaute confirmado do Tesouro.
 * Mesmo preflight aprovado nao homologa contas, saldos ou publicacao.
 */
const NE=/^158459\d{5}(20\d{2})NE\d{6}$/;
const DATE=/^20\d{2}-\d{2}-\d{2}$/;
const MODALITIES=new Set(['RPP','RPNP_A_LIQUIDAR','RPNP_EM_LIQUIDACAO']);
const TYPES=new Set(['saldo']);
const own=(value,name)=>Object.hasOwn(value,name);
function date(value){
 if(typeof value!=='string'||!DATE.test(value))return false;
 const parsed=new Date(value+'T00:00:00Z');
 return !Number.isNaN(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value;
}
function positiveYear(value){
 return Number.isSafeInteger(value)&&value>=2000&&value<=2099;
}
function cents(value){
 return Number.isSafeInteger(value)&&value>=0;
}
const fail=(code)=>({ok:false,reason:code,recordsValidated:0,
  controlGroupsValidated:0,publishEligible:false});

/** Identidade contabil da posicao, nao chave para agregar documentos CGU. */
function dimensions(row){
 return [row.unit,row.management,row.commitment,row.inscriptionYear,
   row.modality,row.asOf].join('|');
}
function validDimensions(row,meta){
 if(!row||typeof row!=='object'||Array.isArray(row))return false;
 const ne=NE.exec(row.commitment||'');
 return row.unit==='158459'&&
   typeof row.management==='string'&&/^\d{5}$/.test(row.management)&&
   ne&&ne[0].slice(6,11)===row.management&&
   positiveYear(row.inscriptionYear)&&row.inscriptionYear>=Number(ne[1])&&
   MODALITIES.has(row.modality)&&row.asOf===meta.asOf&&
   row.entryType==='saldo'&&TYPES.has(row.entryType)&&cents(row.balanceCents);
}
function validControl(control,meta){
 return !!control&&typeof control==='object'&&!Array.isArray(control)&&
   control.unit==='158459'&&control.asOf===meta.asOf&&
   positiveYear(control.inscriptionYear)&&
   MODALITIES.has(control.modality)&&
   cents(control.balanceCents)&&
   Number.isSafeInteger(control.rows)&&control.rows>=0;
}
function controlKey(item){
 return [item.inscriptionYear,item.modality].join('|');
}

/**
 * Exige leitura fechada (nenhum registro ausente) e controle independente
 * por ano de inscricao/modalidade, incluindo controles de saldo ZERO.
 * Recusa campos inesperados para evitar confiar no formato errado.
 * Nao devolve valores monetarios, IDs, nomes ou trechos da origem.
 */
export function preflightRapAccountingSnapshot(snapshot){
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))
   return fail('invalid_snapshot');
 const {metadata,rows,controls}=snapshot;
 if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))
   return fail('missing_metadata');
 const requiredMeta=['system','reportId','extractedAt','asOf','unit','scope',
   'granularity','complete','accountingRuleVersion'];
 if(requiredMeta.some(key=>!own(metadata,key)))return fail('missing_metadata');
 if(metadata.system!=='SIAFI_TESOURO_GERENCIAL'||
    metadata.unit!=='158459'||metadata.scope!=='unit'||
    metadata.granularity!=='commitment_inscription_modality_asof')
   return fail('unsupported_scope');
 if(!date(metadata.asOf)||typeof metadata.extractedAt!=='string'||
    Number.isNaN(Date.parse(metadata.extractedAt))||
    typeof metadata.reportId!=='string'||!/^[-\w.]{3,90}$/.test(metadata.reportId)||
    typeof metadata.accountingRuleVersion!=='string'||
    !/^[-\w.]{3,90}$/.test(metadata.accountingRuleVersion))
   return fail('invalid_provenance');
 if(metadata.complete!==true)return fail('source_incomplete');
 if(!Array.isArray(rows)||!Array.isArray(controls))
   return fail('invalid_structure');
 if(!rows.length||!controls.length)return fail('no_evidence');
 if(rows.length>100000||controls.length>10000)return fail('limit_exceeded');
 const rowFields=['unit','management','commitment','inscriptionYear',
   'modality','asOf','entryType','balanceCents'];
 const controlFields=['unit','inscriptionYear','modality','asOf','balanceCents','rows'];
 const sums=new Map(),count=new Map(),seen=new Set();
 for(const row of rows){
   if(!validDimensions(row,metadata))return fail('invalid_row');
   if(Object.keys(row).some(k=>!rowFields.includes(k)))
     return fail('unexpected_row_field');
   const id=dimensions(row);
   if(seen.has(id))return fail('duplicate_position');
   seen.add(id);
   const key=controlKey(row);
   const next=(sums.get(key)||0)+row.balanceCents;
   if(!Number.isSafeInteger(next))return fail('amount_overflow');
   sums.set(key,next);
   count.set(key,(count.get(key)||0)+1);
 }
 const seenControls=new Set();
 for(const control of controls){
   if(!validControl(control,metadata))return fail('invalid_control');
   if(Object.keys(control).some(k=>!controlFields.includes(k)))
     return fail('unexpected_control_field');
   const key=controlKey(control);
   if(seenControls.has(key))return fail('duplicate_control');
   seenControls.add(key);
   if((sums.get(key)||0)!==control.balanceCents||
      (count.get(key)||0)!==control.rows)return fail('control_mismatch');
 }
 if(seenControls.size!==sums.size)return fail('control_missing');
 return {ok:true,reason:'structure_and_controls_verified',
   recordsValidated:rows.length,controlGroupsValidated:controls.length,
   // Never promote a local technical check into a public financial indicator.
   publishEligible:false};
}
