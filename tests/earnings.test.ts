import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateGroupFor, computeFee, streamTypeOf, type Rate } from '../lib/earnings';

// Made-up rates that exercise every rule (not the real rate card).
let id = 0;
const R = (o: Partial<Rate>): Rate => ({
  id: ++id, brand: 'Acme', label: 'V1', account: 'Brand', period: 'All', stream_type: 'any', method: 'base_comms', tier: '',
  gmv_min: null, gmv_max: null, base_per_hour: 0, total_comms: 0, tiktok_comms: 0, shopee_comms: 0, agency_comms: 0.2,
  valid_from: null, valid_to: null, active: true, notes: '', ...o,
});
const sale = (o: Partial<Parameters<typeof computeFee>[1]>) => ({
  date: '2026-12-05', start_min: 1200, end_min: 1320, brand: 'Acme', period: 'BAU', platform: 'TikTok', tiktok_gmv: null, shopee_gmv: null, ...o,
});
const fee = (rates: Rate[], s: ReturnType<typeof sale>) => computeFee(rateGroupFor(rates, s), s);

test('base + comms, less agency', () => {
  const rates = [R({ base_per_hour: 20, total_comms: 0.1 })];
  // (20 x 2 + 10% x 834.84) x 0.8 = 98.79
  assert.equal(fee(rates, sale({ tiktok_gmv: 356.21, shopee_gmv: 478.63, platform: 'TikTok & Shopee' })).fee, 98.79);
  // no sales yet: base only
  assert.equal(fee(rates, sale({})).fee, 32);
});

test('tiers by GMV per hour; dual streams count hours twice', () => {
  const rates = [
    R({ stream_type: 'dual', period: 'BAU', tier: 'Tier 1', gmv_min: 0, gmv_max: 101, base_per_hour: 15, total_comms: 0.10 }),
    R({ stream_type: 'dual', period: 'BAU', tier: 'Tier 2', gmv_min: 101, gmv_max: 200, base_per_hour: 18, total_comms: 0.11 }),
    R({ stream_type: 'dual', period: 'BAU', tier: 'Tier 3', gmv_min: 200, gmv_max: null, base_per_hour: 22.5, total_comms: 0.12 }),
  ];
  const s = sale({ platform: 'TikTok, Shopee', tiktok_gmv: 140.2, shopee_gmv: 581.69 });
  const r = fee(rates, s);
  assert.equal(r.gmvPerHour, 180.47);            // 721.89 / (2 h x 2)
  assert.equal(r.rate?.tier, 'Tier 2');
  assert.equal(r.fee, 92.33);                    // (18 x 2 + 11% x 721.89) x 0.8
  assert.equal(fee(rates, { ...s, tiktok_gmv: 124, shopee_gmv: 0 }).rate?.tier, 'Tier 1');
  assert.equal(fee(rates, { ...s, tiktok_gmv: 1000, shopee_gmv: 0 }).rate?.tier, 'Tier 3');
  // single-platform stream: no dual rate applies
  assert.equal(fee(rates, { ...s, platform: 'Shopee' }).fee, null);
});

test('split comms per platform', () => {
  const rates = [R({ method: 'split', tiktok_comms: 0.15, shopee_comms: 0.1, agency_comms: 0.25 })];
  // (15% x 1510.96 + 10% x 240.76) x 0.75 = 188.04
  assert.equal(fee(rates, sale({ platform: 'TikTok & Shopee', tiktok_gmv: 1510.96, shopee_gmv: 240.76 })).fee, 188.04);
});

test('picks the most specific, newest valid rate', () => {
  const rates = [
    R({ label: 'Old', base_per_hour: 10, valid_to: '2026-11-30' }),
    R({ label: 'All', base_per_hour: 11, valid_from: '2026-12-01' }),
    R({ label: 'Mega', period: 'Mega', base_per_hour: 30, valid_from: '2026-12-01' }),
    R({ label: 'Off', base_per_hour: 99, active: false }),
  ];
  assert.equal(fee(rates, sale({ date: '2026-11-15' })).rate?.label, 'Old');
  assert.equal(fee(rates, sale({})).rate?.label, 'All');
  assert.equal(fee(rates, sale({ period: 'MEGA' })).rate?.label, 'Mega');
  assert.equal(fee(rates, sale({ brand: ' acme ' })).rate?.label, 'All');
  assert.equal(fee(rates, sale({ brand: 'Other' })).reason?.startsWith('No rate'), true);
});

test('stream type from platform text', () => {
  assert.equal(streamTypeOf('TikTok & Shopee'), 'dual');
  assert.equal(streamTypeOf('Shopee, TikTok'), 'dual');
  assert.equal(streamTypeOf('Shopee'), 'single');
});
