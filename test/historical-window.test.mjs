import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historicalWindow,diagnoseCoverage,auditBaseline,baselineMarkdown} from '../src/diagnose-coverage.mjs';

const now=new Date('2026-11-22T18:00:00Z');
const coverage=(date,ok=true)=>[1,2,3].map(phase=>({
 date,phase,complete:ok,count:0,invalid:0
}));
const month=(name,dates=[])=>({month:name,documents:[],relations:[],coverage:dates.flatMap(date=>coverage(date)),itemsByDocument:{}});

test('janela contabiliza integralmente meses sem arquivos e dias encerrados',()=>{
 const report=historicalWindow([month('2026-10',['2026-10-01','2026-10-02']),
  month('2026-11',['2026-11-01'])],{now,earliestMonth:'2026-09'});
 assert.equal(report.monthsExpected,3);
 assert.deepEqual(report.monthsMissing,['2026-09']);
 assert.equal(report.closedDays,30+31+21);
 assert.equal(report.completeDays,3);
 assert.equal(report.missingDays,30+29+20);
 assert.equal(report.partialDays,0);
 assert.equal(report.percentComplete,Number((300/82).toFixed(2)));
});

test('janela distingue dia parcial de dia sem consulta',()=>{
 const m=month('2026-11',['2026-11-01']);
 m.coverage.push({date:'2026-11-02',phase:1,complete:true,count:0,invalid:0});
 const result=historicalWindow([m],{now,earliestMonth:'2026-11'});
 assert.equal(result.completeDays,1);
 assert.equal(result.partialDays,1);
 assert.equal(result.missingDays,19);
});

test('nao conta hoje, futuro e mes seguinte como cobertura pendente',()=>{
 const result=historicalWindow([],{
  now:new Date('2027-01-01T14:00:00Z'),earliestMonth:'2027-01'});
 assert.equal(result.closedDays,0);
 assert.equal(result.monthsExpected,0);
 assert.equal(result.percentComplete,null);
});

test('baseline publico omite identificadores SIAFI e gera resumo de auditoria',()=>{
 const ne='158459264222026NE000001';
 const m=month('2026-11',['2026-11-01']);
 m.documents.push({id:ne,phase:1,date:'2026-11-01',cents:100});
 m.coverage=coverage('2026-11-01').map(c=>({...c,count:c.phase===1?1:0}));
 const report=diagnoseCoverage([m],{now,earliestMonth:'2026-11'});
 const baseline=auditBaseline(report,{revision:'abc123'});
 assert.equal(baseline.history.completeDays,1);
 assert.equal(baseline.months[0].missingDays,20);
 assert.equal(baseline.phaseCounts[1],1);
 const markdown=baselineMarkdown(baseline);
 assert.match(markdown,/1\/21 dias encerrados/);
 assert.equal(markdown.includes(ne),false);
 assert.equal(JSON.stringify(baseline).includes(ne),false);
});

test('baseline lista meses sem arquivo e usa somente dias encerrados nas linhas',()=>{
 const localNight=new Date('2026-03-02T02:30:00Z'); // 1º de março em Brasília
 const report=diagnoseCoverage([month('2026-03',['2026-03-01'])],{
  now:localNight,earliestMonth:'2026-02'
 });
 const baseline=auditBaseline(report);
 const [february,march]=baseline.months;
 assert.equal(february.month,'2026-02');
 assert.equal(february.hasFile,false);
 assert.equal(february.missingDays,28);
 assert.equal(february.pendingTotal,null);
 assert.equal(march.month,'2026-03');
 assert.equal(march.hasFile,true);
 assert.equal(march.fullyCoveredDays,0);
 assert.equal(march.daysWithCoverage,0);
 assert.equal(march.expectedDays,0);
 assert.equal(baseline.history.closedDays,28);
 assert.match(baselineMarkdown(baseline),/\| 2026-02 \| Ausente \| 0\/28 \| 0 \| 28 \| — \|/);
});
