import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('conferencia historica e opt-in e nao altera competencia exibida',async()=>{
 const app=await readFile('assets/app.js','utf8');
 const html=await readFile('index.html','utf8');
 assert.match(html,/id="historical-ne-load"/);
 assert.match(app,/addEventListener\('click',loadHistoricalNeEvidence\)/);
 const method=app.slice(app.indexOf('async function loadHistoricalNeEvidence()'),app.indexOf('function loadedCguDocuments()'));
 assert.match(method,/state\.manifest\.months\.filter\(m=>!cache\.has\(m\)\)/);
 assert.match(method,/await fetchMonth\(month\)/);
 const loader=app.slice(app.indexOf('async function fetchMonth('),app.indexOf('async function locateLinkedDocument('));
 assert.match(loader,/data\.unit !== '158459'/);
 assert.match(loader,/data\.month !== month/);
 assert.match(method,/if\(noticesData\)renderNotices\(\)/);
 assert.doesNotMatch(method,/state\.month\s*=/);
 assert.doesNotMatch(method,/cache\.set\(month,data\).*state\.data\s*=/);
});
