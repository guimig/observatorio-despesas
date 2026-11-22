/** Relatorio local de auditoria; protege planilhas contra formula injection. */
export function filterAuditFindings(findings=[],{status='all',query=''}={}){
 const q=String(query).trim().toLowerCase();
 return findings.filter(r=>(status==='all'||r.status===status)&&
  (!q||[r.instrument,r.reference,r.procurementId].some(v=>String(v||'').toLowerCase().includes(q))));
}
function safeCsvCell(value){
 let s=String(value??'');
 if(/^[\s\u0000-\u001f]*[=+@-]/.test(s))s="'"+s;
 return '"'+s.replace(/"/g,'""')+'"';
}
export function auditFindingsCsv(findings=[]){
 const rows=[['Instrumento PNCP','Referencia de NE','Situacao','Licitacao PNCP']];
 for(const r of findings)rows.push([r.instrument,r.reference,r.status,r.procurementId||'']);
 return '\uFEFF'+rows.map(row=>row.map(safeCsvCell).join(';')).join('\r\n')+'\r\n';
}
