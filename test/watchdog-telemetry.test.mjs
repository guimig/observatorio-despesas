import {test} from 'node:test';
import assert from 'node:assert/strict';
import {overdueStatus} from '../src/watchdog-agenda.mjs';
test('distingue atraso de agenda e espera de runner sem alterar cooldown',()=>{
 const now=new Date('2026-11-27T16:00:00Z');
 const rows=[{status:'completed',event:'push',conclusion:'failure',created_at:'2026-11-27T13:00:00Z',run_started_at:'2026-11-27T13:30:00Z'},
 {status:'completed',event:'schedule',conclusion:'success',created_at:'2026-11-27T06:00:00Z'}];
 const r=overdueStatus(rows,8,now,{retryHours:2});
 assert.equal(r.lastScheduledAgeHours,10);assert.equal(r.lastQueueDelayMinutes,30);
 assert.equal(r.reason,'retry_failed');
});
