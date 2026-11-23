/**
 * Integration: Dispatch Board (/api/dispatch/board).
 */
require('../setup');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');
const User = require('../../models/User');
const Load = require('../../models/Load');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');

const subToken = (user, companyRole, owner) => jwt.sign(
  { userId: String(user._id), role: 'carrier', companyRole, companyOwnerId: String(owner._id) },
  process.env.JWT_SECRET, { expiresIn: '1d' });

describe('dispatch board routes', () => {
  let app, owner, ownerToken, shipper, other;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });
  const board = (token, q = '') => request(app).get(`/api/dispatch/board${q}`).set(auth(token));
  const book = (truckId, over = {}) => createTestLoad(shipper._id, {
    status: 'accepted', acceptedBy: owner._id, assignedTruckId: truckId, title: `Load for ${truckId}`, ...over,
  });

  beforeEach(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/dispatch', require('../../routes/dispatchRoutes'));

    shipper = await createTestUser({ role: 'shipper' });
    owner = await createTestUser({
      role: 'carrier', companyRole: 'owner',
      fleet: [
        { truckId: 'T1', driverName: 'Dan Driver' },
        { truckId: 'T2' },
        { truckId: 'T3', status: 'Maintenance' },
        { truckId: 'T4' },
      ],
      drivers: [{ driverId: 'D1', name: 'Dan Driver', assignedTruckId: 'T1' }],
    });
    ownerToken = generateToken(owner);
    other = await createTestUser({ role: 'carrier', fleet: [{ truckId: 'OTHER-1' }] });
  });

  test('owner sees every truck with a correct summary', async () => {
    await book('T1');
    await book('T4', {
      status: 'in-transit', destinationLat: 32.7, destinationLng: -96.7,
      carrierLocation: { latitude: 41.9, longitude: -87.7, updatedAt: new Date(), lastAuthenticated: { latitude: 41.9, longitude: -87.7, updatedAt: new Date() } },
    });
    const res = await board(ownerToken);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.totalTrucks).toBe(4);
    expect(d.summary).toEqual({ needs_attention: 0, in_transit: 1, booked: 1, idle: 1, out_of_service: 1, unassigned: 0 });
    expect(d.trucks.map((t) => t.truckId)).toEqual(['T4', 'T1', 'T2', 'T3']); // in_transit, booked, idle, out_of_service
    const t1 = d.trucks.find((t) => t.truckId === 'T1');
    expect(t1.driverName).toBe('Dan Driver');
    expect(t1.currentLoad.title).toBe('Load for T1');
    expect(t1.currentLoad.nextEvent.type).toBe('pickup');
    expect(d.hosIncluded).toBe(false);
  });

  test('attention rows carry plain-English reasons and sort first', async () => {
    await book('T1', { pickupRisk: { level: 'at_risk', detail: { minutesLateEstimate: 42 } } });
    await book('T2');
    const d = (await board(ownerToken)).body.data;
    expect(d.trucks[0].truckId).toBe('T1');
    expect(d.trucks[0].state).toBe('needs_attention');
    expect(d.trucks[0].reasons).toEqual(['Pickup at risk: 42 min late by current position']);
    expect(d.summary.needs_attention).toBe(1);
  });

  test('role gates: dispatcher ok, driver 403, shipper 403, anonymous 401', async () => {
    const disp = await createTestUser({ role: 'carrier', companyRole: 'dispatcher', parentAccountId: owner._id });
    const drv = await createTestUser({ role: 'carrier', companyRole: 'driver', parentAccountId: owner._id });
    const dispRes = await board(subToken(disp, 'dispatcher', owner));
    expect(dispRes.status).toBe(200);
    expect(dispRes.body.data.totalTrucks).toBe(4);
    expect((await board(subToken(drv, 'driver', owner))).status).toBe(403);
    expect((await board(generateToken(shipper))).status).toBe(403);
    expect((await request(app).get('/api/dispatch/board')).status).toBe(401);
  });

  test("another company's trucks and loads never appear", async () => {
    await createTestLoad(shipper._id, { status: 'accepted', acceptedBy: other._id, assignedTruckId: 'OTHER-1', title: 'not mine' });
    await createTestLoad(shipper._id, { status: 'accepted', acceptedBy: other._id, assignedTruckId: null, title: 'not mine either' });
    const d = (await board(ownerToken)).body.data;
    expect(JSON.stringify(d)).not.toMatch(/OTHER-1|not mine/);
    expect(d.unassigned.total).toBe(0);
    const theirs = (await board(generateToken(other))).body.data;
    expect(theirs.trucks.map((t) => t.truckId)).toEqual(['OTHER-1']);
  });

  test('state filter, search (incl. regex metacharacters), and paging bounds', async () => {
    await book('T1', { origin: 'Chicago, IL' });
    const byState = (await board(ownerToken, '?state=idle')).body.data;
    expect(byState.trucks.map((t) => t.truckId)).toEqual(['T2', 'T4']);
    expect(byState.totalRows).toBe(2);
    expect(byState.summary.booked).toBe(1); // summary ignores the filter

    expect((await board(ownerToken, '?q=DAN')).body.data.trucks.map((t) => t.truckId)).toEqual(['T1']);
    expect((await board(ownerToken, '?q=chicago')).body.data.trucks.map((t) => t.truckId)).toEqual(['T1']);
    const meta = await board(ownerToken, `?q=${encodeURIComponent('.*(')}`);
    expect(meta.status).toBe(200);
    expect(meta.body.data.trucks).toEqual([]);

    expect((await board(ownerToken, '?state=bogus')).status).toBe(400);
    expect((await board(ownerToken, '?page=0')).status).toBe(400);
    expect((await board(ownerToken, '?pageSize=9')).status).toBe(400);
    expect((await board(ownerToken, '?pageSize=101')).status).toBe(400);
    expect((await board(ownerToken, `?q=${'x'.repeat(101)}`)).status).toBe(400);
    expect((await board(ownerToken, '?q[]=a')).status).toBe(400);

    const p = (await board(ownerToken, '?pageSize=10&page=2')).body.data;
    expect(p.trucks).toEqual([]);
    expect(p.totalPages).toBe(1);
  });

  test('loads without a truck (none, or a truck no longer in the fleet) are listed and counted', async () => {
    await book(null, { title: 'no truck' });
    await book('GONE-9', { title: 'ghost truck' });
    await book('T1');
    const d = (await board(ownerToken)).body.data;
    expect(d.summary.unassigned).toBe(2);
    expect(d.unassigned.total).toBe(2);
    expect(d.unassigned.loads.map((l) => l.title).sort()).toEqual(['ghost truck', 'no truck']);
    expect(d.unassigned.loads[0]).not.toHaveProperty('postedBy');
    expect(d.unassigned.loads[0]).not.toHaveProperty('rate');
  });

  test('query count is constant and a 1000-truck fleet is fast', async () => {
    const fleet = Array.from({ length: 1000 }, (_, i) => ({ truckId: `X${i}`, driverName: `Driver ${i}` }));
    const big = await createTestUser({ role: 'carrier', fleet });
    const loads = Array.from({ length: 600 }, (_, i) => ({
      title: `Bulk ${i}`, commodity: 'x', equipmentType: 'Dry Van', loadWeight: 1, rate: 100,
      origin: 'A, IL', destination: 'B, WI', postedBy: shipper._id, status: 'accepted', acceptedBy: big._id,
      assignedTruckId: `X${i}`, pickupTimeWindow: { start: new Date(Date.now() + 3600000), end: new Date(Date.now() + 7200000) },
    }));
    await Load.insertMany(loads);

    let ops = 0;
    const count = () => { ops++; };
    mongoose.set('debug', count);
    try {
      const small = await board(ownerToken);
      expect(small.status).toBe(200);
      const smallOps = ops;
      ops = 0;
      const t0 = Date.now();
      const res = await board(generateToken(big), '?pageSize=100');
      const elapsed = Date.now() - t0;
      expect(res.status).toBe(200);
      // eslint-disable-next-line no-console
      console.log(`[dispatch] 1000 trucks / 600 loads: ${elapsed} ms, ${ops} db ops (4-truck fleet: ${smallOps})`);
      expect(ops).toBe(smallOps);
      expect(ops).toBeLessThanOrEqual(3);
      expect(elapsed).toBeLessThan(3000);
      expect(res.body.data.totalTrucks).toBe(1000);
      expect(res.body.data.trucks).toHaveLength(100);
      expect(res.body.data.summary.booked).toBe(600);
      expect(res.body.data.summary.idle).toBe(400);
      expect(res.body.data.truncated).toBe(false);
    } finally {
      mongoose.set('debug', false);
    }
  }, 30000);
});
