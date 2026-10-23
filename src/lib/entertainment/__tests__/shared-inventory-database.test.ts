import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("shared inventory SQL authority", () => {
  let db: PGlite;
  const startsAt = '2026-10-20T20:00:00Z', endsAt = '2026-10-20T21:00:00Z';
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      alter default privileges grant all on tables to service_role;`);
    for (const file of ['20260729152402_entertainment_schedule.sql','20261013182233_shared_reservation_authority.sql','20261020175405_shared_reservation_lifecycle.sql','20261022171353_shared_entertainment_seating_only_buffers.sql']) {
      await db.exec(await readFile(path.join(process.cwd(),'supabase/migrations',file),'utf8'));
    }
  });
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    await db.exec(`truncate shared_inventory.operations,shared_inventory.claims;
      update shared_inventory.control set enabled=true,baseline_ready=true,revision=0;
      update shared_inventory.writers set enabled=true;
      insert into shared_inventory.checkpoints(source,revision,complete,checked_at,covers_from,covers_to)
      select s,'r1',true,clock_timestamp(),'2026-10-01','2026-11-01' from unnest(array['event-host','rexreplace','waitlist']) s
      on conflict(source) do update set checked_at=excluded.checked_at,complete=true,revision='r1',covers_from=excluded.covers_from,covers_to=excluded.covers_to;`);
  });
  function request(overrides: Record<string, unknown> = {}) {
    return { ownerReference:'fictional-event-1',eventId:'event-1',kind:'event',approvalReference:'verified-staff-decision-1',
      group:'bowling',resourceIds:['bowling-3','bowling-4'],startsAt,endsAt,replaceClaimIds:[],expectedRevision:0,
      sourceRevisions:{'event-host':'r1',rexreplace:'r1',waitlist:'r1'},...overrides };
  }
  async function claim(key: string, data = request(), writer = 'final-call') {
    return (await db.query<{result: Record<string, any>}>(
      'select public.shared_inventory_claim($1,$2,$3::jsonb) as result',[writer,key,JSON.stringify(data)])).rows[0].result;
  }
  it('secures one exact adjacent set, deduplicates retries, and reads back the original operation', async () => {
    const data=request(), result=await claim('operation-1',data);
    expect(result).toMatchObject({status:'secured',resourceIds:['bowling-3','bowling-4'],revision:1});
    expect(await claim('operation-1',data)).toEqual(result);
    expect((await db.query('select * from shared_inventory.claims')).rows).toHaveLength(1);
    const read=await db.query<{result: unknown}>('select shared_inventory_operation($1,$2,$3::jsonb) as result',['final-call','operation-1',JSON.stringify(data)]);
    expect(read.rows[0].result).toEqual(result);
    await expect(claim('operation-1',request({endsAt:'2026-10-20T22:00Z'}))).rejects.toThrow(/idempotency/);
  });
  it('rejects simultaneous competing callers using the same revision', async () => {
    // PGlite queues statements; deployed separate-connection lock contention remains an acceptance gate.
    const answers=await Promise.all([claim('contender-one'),claim('contender-two',request({ownerReference:'walk-in',kind:'walk-in',eventId:null}),'waitlist')]);
    expect(answers.map((r)=>r.status).sort()).toEqual(['secured','unknown']);
    expect(answers.find((r)=>r.status==='unknown')?.reason).toBe('revision_changed');
  });
  it('blocks overlap even after refreshing the revision', async () => {
    await claim('event-first');
    expect(await claim('walkin-second',request({kind:'walk-in',eventId:null,expectedRevision:1}),'waitlist')).toMatchObject({status:'conflict'});
  });
  it.each(['cutover','baseline','writer','stale source','missing source','wrong source revision'])(
    'fails closed on %s', async (failure) => {
      if(failure==='cutover') await db.exec('update shared_inventory.control set enabled=false');
      if(failure==='baseline') await db.exec('update shared_inventory.control set baseline_ready=false');
      if(failure==='writer') await db.exec("update shared_inventory.writers set enabled=false where id='waitlist'");
      if(failure==='stale source') await db.exec("update shared_inventory.checkpoints set checked_at=now()-interval '3 minutes' where source='waitlist'");
      if(failure==='missing source') await db.exec("delete from shared_inventory.checkpoints where source='waitlist'");
      if(failure==='wrong source revision') await db.exec("update shared_inventory.checkpoints set revision='r2' where source='waitlist'");
      expect(await claim('unknown-source')).toMatchObject({status:'unknown'});
      expect((await db.query('select * from shared_inventory.claims')).rows).toHaveLength(0);
    });
  it.each([['bowling-3','bowling-5'],['bowling-3','bowling-3'],['not-a-resource'],['pool-1']])(
    'rejects invalid final bowling resource set %j',async (...resourceIds) => {
      await expect(claim('invalid-resources',request({resourceIds}))).rejects.toThrow();
    });
  it('expands Big Show to five karaoke rooms and protects every room', async () => {
    const big=await claim('big-show-first',request({group:'big-show',resourceIds:[]}));
    expect(big.resourceIds).toHaveLength(5);
    expect(await claim('room-second',request({group:'karaoke',resourceIds:['private-room-gem'],kind:'room-booking',eventId:null,expectedRevision:1}),'rexreplace')).toMatchObject({status:'conflict'});
  });
  it('expands a buyout to every resource, including lanes and rooms',async () => {
    await db.exec(`insert into entertainment_resources(id,canonical_name,category,display_order)
      values ('private-room-big-show','Big Show','private-rooms',500) on conflict do nothing`);
    const buyout=await claim('buyout-first',request({group:'buyout',resourceIds:[]}),'event-host');
    expect(buyout.resourceIds).toHaveLength(29);
    expect(await claim('pool-second',request({group:'pool',resourceIds:['pool-2'],kind:'walk-in',eventId:null,expectedRevision:1}),'waitlist')).toMatchObject({status:'conflict'});
  });
  it.each([
    ['bowling', 'bowling-3'], ['darts', 'darts-2'], ['pool', 'pool-1'],
    ['shuffleboard', 'shuffleboard-1'], ['karaoke', 'private-room-gem'], ['vip', 'private-room-vip-1'],
  ])('%s allows back-to-back entertainment and rejects actual overlaps', async (group, resource) => {
    const common = { group, resourceIds: [resource] };
    await claim('first-booking', request(common));
    expect(await claim('one-minute-overlap', request({ ...common, expectedRevision: 1,
      kind: 'walk-in', eventId: null, startsAt: '2026-10-20T20:59Z', endsAt: '2026-10-20T22:00Z' }), 'waitlist'))
      .toMatchObject({ status: 'conflict' });
    expect(await claim('back-to-back-booking', request({ ...common, expectedRevision: 1,
      kind: 'room-booking', eventId: null, startsAt: '2026-10-20T21:00Z', endsAt: '2026-10-20T22:00Z' }), 'rexreplace'))
      .toMatchObject({ status: 'secured' });
    expect(await claim('event-before-booking', request({ ...common, expectedRevision: 2,
      startsAt: '2026-10-20T19:00Z', endsAt: '2026-10-20T20:00Z' })))
      .toMatchObject({ status: 'secured' });
  });
  it('accepts exact interval evidence but rejects any coverage gap', async () => {
    await db.query('update shared_inventory.checkpoints set covers_from=$1,covers_to=$2', [startsAt, endsAt]);
    expect(await claim('exact-coverage')).toMatchObject({ status: 'secured' });
    await db.exec("update shared_inventory.checkpoints set covers_from=covers_from+interval '1 second' where source='waitlist'");
    expect(await claim('missing-coverage', request({ expectedRevision: 1 })))
      .toMatchObject({ status: 'unknown', reason: 'source_evidence_incomplete' });
  });
  it('refuses to change buffer policy after authority cutover', async () => {
    await expect(db.exec(await readFile('supabase/migrations/20261022171353_shared_entertainment_seating_only_buffers.sql','utf8')))
      .rejects.toThrow(/buffer_policy_requires_disabled_authority/);
    await db.exec('rollback');
  });
  it('replaces only an owned exact claim and invalidates read-back of its old operation',async () => {
    const old=await claim('original-claim');
    await expect(claim('foreign-replace',request({replaceClaimIds:[old.claimId],ownerReference:'someone-else',expectedRevision:1}))).rejects.toThrow(/ownership/);
    const updated=await claim('extended-claim',request({replaceClaimIds:[old.claimId],endsAt:'2026-10-20T22:00Z',expectedRevision:1}));
    expect(updated.status).toBe('secured');
    const read=await db.query<{result:any}>('select shared_inventory_operation($1,$2,$3::jsonb) as result',['final-call','original-claim',JSON.stringify(request())]);
    expect(read.rows[0].result).toMatchObject({status:'unknown',reason:'claim_no_longer_active'});
    expect(await claim('original-claim')).toMatchObject({status:'unknown',reason:'claim_no_longer_active'});
  });
  it('expires checkout holds according to database time without releasing non-expiring bookings',async () => {
    const expiry=new Date(Date.now()+600000).toISOString();
    const hold=await claim('checkout-hold',request({kind:'checkout-hold',eventId:null,expiresAt:expiry}),'rexreplace');
    expect(hold.status).toBe('secured');
    await db.query("update shared_inventory.claims set expires_at=now()-interval '1 second' where id=$1",[hold.claimId]);
    expect(await claim('checkout-hold',request({kind:'checkout-hold',eventId:null,expiresAt:expiry}),'rexreplace'))
      .toMatchObject({status:'unknown',reason:'claim_no_longer_active'});
    expect(await claim('after-expiry',request({expectedRevision:1}))).toMatchObject({status:'secured'});
  });
  it('denies both RPCs and private tables to browser roles',async () => {
    const privileges=await db.query<{allowed:boolean}>(`select
      has_function_privilege('anon','shared_inventory_claim(text,text,jsonb)','execute') or
      has_function_privilege('authenticated','shared_inventory_operation(text,text,jsonb)','execute') or
      has_table_privilege('anon','shared_inventory.claims','insert') as allowed`);
    expect(privileges.rows[0].allowed).toBe(false);
  });
  it('runs with service-role privileges and prevents changing operation history',async () => {
    await db.exec('set role service_role');
    try {
      expect(await claim('service-claim')).toMatchObject({status:'secured'});
      await expect(db.exec("update shared_inventory.operations set result='{}'")).rejects.toThrow(/permission denied/);
      await expect(db.exec("delete from shared_inventory.operations")).rejects.toThrow(/permission denied/);
      await expect(db.query("select shared_inventory_operation('final-call','service-claim',null)")).rejects.toThrow(/idempotency/);
    } finally { await db.exec('reset role'); }
  });
});
