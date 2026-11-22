/** Integration: bulk import of trucks (/users/fleet/bulk) and drivers (/drivers/bulk). */
require('../setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const { createTestUser, generateToken } = require('../helpers');

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/users', require('../../routes/userRoutes'));
  app.use('/api/drivers', require('../../routes/driverRoutes'));
  return app;
}

describe('bulk import', () => {
  let app, owner, ownerToken;
  const post = (url, token, body) =>
    request(app).post(url).set('Authorization', `Bearer ${token}`).send(body);
  const fleetOf = async () => (await User.findById(owner._id)).fleet;
  const rosterOf = async () => (await User.findById(owner._id)).drivers;

  beforeEach(async () => {
    app = buildApp();
    owner = await createTestUser({ role: 'carrier', companyRole: 'owner' });
    ownerToken = generateToken(owner);
  });

  async function subToken(companyRole) {
    const u = await createTestUser({ role: 'carrier', companyRole, parentAccountId: owner._id });
    return jwt.sign(
      { userId: u._id, role: 'carrier', companyRole, companyOwnerId: owner._id },
      process.env.JWT_SECRET, { expiresIn: '1d' }
    );
  }

  describe('trucks', () => {
    const url = '/api/users/fleet/bulk';

    test('valid import adds all rows with defaults', async () => {
      const res = await post(url, ownerToken, { trucks: [
        { truckId: 'T-1', driverName: 'Ann', status: 'Maintenance' },
        { truckId: ' T-2 ' },
      ] });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ added: 2 });
      const fleet = await fleetOf();
      expect(fleet.map((t) => t.truckId)).toEqual(['T-1', 'T-2']);
      expect(fleet[1].status).toBe('Available');
      expect(fleet[0].available).toBe(true);
    });

    test('one bad row -> 400, nothing written, error names row and field', async () => {
      const res = await post(url, ownerToken, { trucks: [
        { truckId: 'A' }, { truckId: 'B', status: 'Flying' }, { driverName: 'x' },
      ] });
      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ row: 2, field: 'status' }),
        expect.objectContaining({ row: 3, field: 'truckId' }),
      ]));
      expect(await fleetOf()).toHaveLength(0);
    });

    test('rejects non-string values', async () => {
      const res = await post(url, ownerToken, { trucks: [{ truckId: { $gt: '' } }] });
      expect(res.status).toBe(400);
      expect(res.body.errors[0]).toMatchObject({ row: 1, field: 'truckId' });
    });

    test('duplicate within the file (case-insensitive)', async () => {
      const res = await post(url, ownerToken, { trucks: [{ truckId: 'abc' }, { truckId: 'ABC ' }] });
      expect(res.status).toBe(400);
      expect(res.body.errors[0]).toMatchObject({ row: 2, field: 'truckId' });
      expect(res.body.errors[0].message).toMatch(/duplicated in the file/);
      expect(await fleetOf()).toHaveLength(0);
    });

    test('duplicate against existing fleet', async () => {
      await post(url, ownerToken, { trucks: [{ truckId: 'T-1' }] });
      const res = await post(url, ownerToken, { trucks: [{ truckId: 'new' }, { truckId: 't-1' }] });
      expect(res.status).toBe(400);
      expect(res.body.errors[0]).toMatchObject({ row: 2, field: 'truckId' });
      expect(res.body.errors[0].message).toMatch(/already exists/);
      expect(await fleetOf()).toHaveLength(1);
    });

    test('dryRun writes nothing and reports', async () => {
      const ok = await post(`${url}?dryRun=true`, ownerToken, { trucks: [{ truckId: 'T-1' }] });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ dryRun: true, valid: true, count: 1, errors: [] });
      const bad = await post(`${url}?dryRun=true`, ownerToken, { trucks: [{}] });
      expect(bad.body.valid).toBe(false);
      expect(bad.body.errors[0]).toMatchObject({ row: 1, field: 'truckId' });
      expect(await fleetOf()).toHaveLength(0);
    });

    test('more than 2000 rows rejected; 2000 accepted', async () => {
      const mk = (n) => Array.from({ length: n }, (_, i) => ({ truckId: `T${i}` }));
      const big = await post(url, ownerToken, { trucks: mk(2001) });
      expect(big.status).toBe(400);
      expect(big.body.error).toMatch(/2000/);
      const ok = await post(url, ownerToken, { trucks: mk(2000) });
      expect(ok.status).toBe(201);
      expect(await fleetOf()).toHaveLength(2000);
    });

    test('total fleet cap of 5000 enforced', async () => {
      const mk = (p, n) => Array.from({ length: n }, (_, i) => ({ truckId: `${p}${i}` }));
      await post(url, ownerToken, { trucks: mk('a', 2000) });
      await post(url, ownerToken, { trucks: mk('b', 2000) });
      await post(url, ownerToken, { trucks: mk('c', 1000) });
      expect(await fleetOf()).toHaveLength(5000);
      const res = await post(url, ownerToken, { trucks: [{ truckId: 'overflow' }] });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/5000/);
    });

    test('driver sub-account 403; dispatcher lands on OWNER fleet; shipper 403', async () => {
      const drv = await post(url, await subToken('driver'), { trucks: [{ truckId: 'X' }] });
      expect(drv.status).toBe(403);

      const disp = await post(url, await subToken('dispatcher'), { trucks: [{ truckId: 'D-1' }] });
      expect(disp.status).toBe(201);
      expect((await fleetOf()).map((t) => t.truckId)).toEqual(['D-1']);

      const shipper = await createTestUser({ role: 'shipper' });
      const sh = await post(url, generateToken(shipper), { trucks: [{ truckId: 'S' }] });
      expect(sh.status).toBe(403);
    });
  });

  describe('drivers', () => {
    const url = '/api/drivers/bulk';

    test('valid import: generated ids, encrypted CDL, normalized fields', async () => {
      const res = await post(url, ownerToken, { drivers: [
        { name: ' Bob ', licenseNumber: 'D1234567', licenseState: 'tx', licenseExpiry: '2027-05-01',
          endorsements: ['Hazmat', 'tanker'], status: 'on_leave' },
        { name: 'Cy', driverId: 'EMP-9' },
      ] });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ added: 2 });
      const r = await rosterOf();
      expect(r[0].name).toBe('Bob');
      expect(r[0].driverId).toMatch(/^drv_/);
      expect(r[0].licenseNumber).not.toBe('D1234567'); // encrypted at rest
      expect(r[0].licenseState).toBe('TX');
      expect(r[0].endorsements).toEqual(['hazmat', 'tanker']);
      expect(r[0].status).toBe('on_leave');
      expect(r[1].driverId).toBe('EMP-9');
      expect(r[1].status).toBe('active');
    });

    test('bad rows -> 400 with row/field, nothing written', async () => {
      const res = await post(url, ownerToken, { drivers: [
        { name: 'ok' },
        { name: 'b', licenseState: 'TEX' },
        { name: 'c', licenseExpiry: '2027-02-30' },
        { name: 'd', endorsements: ['jetpack'] },
        { name: 'e', status: 'suspended' },
        {},
      ] });
      expect(res.status).toBe(400);
      const got = res.body.errors.map((e) => `${e.row}:${e.field}`);
      expect(got).toEqual(expect.arrayContaining(['2:licenseState', '3:licenseExpiry', '4:endorsements', '5:status', '6:name']));
      expect(await rosterOf()).toHaveLength(0);
    });

    test('duplicate endorsements collapse; an oversized list is rejected', async () => {
      const ok = await post(url, ownerToken, { drivers: [{ name: 'a', endorsements: ['Hazmat', 'hazmat', ' HAZMAT '] }] });
      expect(ok.status).toBe(201);
      expect((await rosterOf())[0].endorsements).toEqual(['hazmat']);

      const many = Array(6).fill('hazmat'); // allowed set has 5 values
      const bad = await post(url, ownerToken, { drivers: [{ name: 'b', endorsements: many }] });
      expect(bad.status).toBe(400);
      expect(bad.body.errors.map((e) => `${e.row}:${e.field}`)).toContain('1:endorsements');
    });

    test('duplicate driverId in file and against roster', async () => {
      const dup = await post(url, ownerToken, { drivers: [{ name: 'a', driverId: 'X1' }, { name: 'b', driverId: 'x1' }] });
      expect(dup.status).toBe(400);
      expect(dup.body.errors[0]).toMatchObject({ row: 2, field: 'driverId' });
      await post(url, ownerToken, { drivers: [{ name: 'a', driverId: 'X1' }] });
      const again = await post(url, ownerToken, { drivers: [{ name: 'b', driverId: 'X1' }] });
      expect(again.status).toBe(400);
      expect(again.body.errors[0].message).toMatch(/already exists/);
      expect(await rosterOf()).toHaveLength(1);
    });

    test('dryRun writes nothing; >2000 rejected', async () => {
      const dry = await post(`${url}?dryRun=true`, ownerToken, { drivers: [{ name: 'a' }] });
      expect(dry.body).toMatchObject({ valid: true, count: 1 });
      expect(await rosterOf()).toHaveLength(0);
      const big = await post(url, ownerToken, { drivers: Array.from({ length: 2001 }, (_, i) => ({ name: `n${i}` })) });
      expect(big.status).toBe(400);
    });

    test('driver 403; dispatcher lands on owner roster; shipper 403', async () => {
      expect((await post(url, await subToken('driver'), { drivers: [{ name: 'a' }] })).status).toBe(403);
      const disp = await post(url, await subToken('dispatcher'), { drivers: [{ name: 'a' }] });
      expect(disp.status).toBe(201);
      expect(await rosterOf()).toHaveLength(1);
      const shipper = await createTestUser({ role: 'shipper' });
      expect((await post(url, generateToken(shipper), { drivers: [{ name: 'a' }] })).status).toBe(403);
    });
  });
});
