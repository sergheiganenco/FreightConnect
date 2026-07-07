/**
 * Integration: company sub-accounts (dispatchers & drivers under one company).
 *
 * v1 scope covered here: an owner provisions sub-accounts, those accounts log in
 * with their own credentials, deactivation blocks login, only owners manage the
 * team, and company-scoped reads (the load board) resolve to the company owner so
 * a dispatcher sees the company's loads.
 */

require('../setup');
const express = require('express');
const request = require('supertest');
const bcrypt = require('bcrypt');
const User = require('../../models/User');
const Load = require('../../models/Load');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {} };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/users', require('../../routes/userRoutes'));
  app.use('/api/loads', require('../../routes/loadRoutes')(mockIo));
  return app;
}

describe('company sub-accounts', () => {
  let app, owner, ownerToken;

  beforeEach(async () => {
    app = buildApp();
    owner = await createTestUser({ role: 'carrier', companyRole: 'owner', companyName: 'Acme Trucking' });
    ownerToken = generateToken(owner); // owner token: no companyOwnerId → falls back to own id
  });

  async function addDispatcher(overrides = {}) {
    return request(app)
      .post('/api/users/team')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Dan Dispatcher', email: `d-${Date.now()}@acme.com`, password: 'DispatchPass1', companyRole: 'dispatcher', ...overrides });
  }

  test('owner creates a dispatcher sub-account and it appears in the team list', async () => {
    const res = await addDispatcher();
    expect(res.status).toBe(201);
    expect(res.body.member.companyRole).toBe('dispatcher');

    const list = await request(app).get('/api/users/team').set('Authorization', `Bearer ${ownerToken}`);
    expect(list.status).toBe(200);
    expect(list.body.members).toHaveLength(1);

    // The sub-account inherits the owner's role + company and links via parentAccountId.
    const created = await User.findById(res.body.member._id);
    expect(created.role).toBe('carrier');
    expect(String(created.parentAccountId)).toBe(String(owner._id));
    expect(created.companyName).toBe('Acme Trucking');
  });

  test('a sub-account can log in and its token carries its company role', async () => {
    const email = `driver-${Date.now()}@acme.com`;
    await addDispatcher({ email, password: 'DriverPass12', companyRole: 'driver' });

    const login = await request(app).post('/api/users/login').send({ email, password: 'DriverPass12' });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
    expect(login.body.user.companyRole).toBe('driver');
  });

  test('deactivating a sub-account blocks its login', async () => {
    const email = `d2-${Date.now()}@acme.com`;
    const created = await addDispatcher({ email, password: 'DispatchPass1' });
    await request(app)
      .patch(`/api/users/team/${created.body.member._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ active: false });

    const login = await request(app).post('/api/users/login').send({ email, password: 'DispatchPass1' });
    expect(login.status).toBe(403);
  });

  test('a non-owner cannot manage the team', async () => {
    const email = `d3-${Date.now()}@acme.com`;
    await addDispatcher({ email, password: 'DispatchPass1' });
    const login = await request(app).post('/api/users/login').send({ email, password: 'DispatchPass1' });
    const dispToken = login.body.token;

    const res = await request(app)
      .post('/api/users/team')
      .set('Authorization', `Bearer ${dispToken}`)
      .send({ name: 'X', email: `x-${Date.now()}@acme.com`, password: 'whatever12', companyRole: 'driver' });
    expect(res.status).toBe(403);
  });

  test('a dispatcher BOOKS a load and it attributes to the company, not the sub-account', async () => {
    // Owner carrier must pass the booking gate: verified + a truck in the fleet.
    const bookingOwner = await createTestUser({
      role: 'carrier', companyRole: 'owner', companyName: 'Book Co',
      verification: { status: 'verified', insurance: { status: 'valid' } },
      fleet: [{ truckId: 'T1', status: 'Available' }],
    });
    const bookingOwnerToken = generateToken(bookingOwner);
    const shipper = await createTestUser({ role: 'shipper' });
    const load = await createTestLoad(shipper._id, { status: 'open', equipmentType: 'Dry Van' });

    // Create a dispatcher under the booking owner and log in as them.
    const email = `disp-${Date.now()}@bookco.com`;
    await request(app).post('/api/users/team')
      .set('Authorization', `Bearer ${bookingOwnerToken}`)
      .send({ name: 'Book Dispatcher', email, password: 'DispatchPass1', companyRole: 'dispatcher' });
    const login = await request(app).post('/api/users/login').send({ email, password: 'DispatchPass1' });
    const dispToken = login.body.token;

    const res = await request(app)
      .put(`/api/loads/${load._id}/accept`)
      .set('Authorization', `Bearer ${dispToken}`);
    expect(res.status).toBe(200);

    // The load is owned by the COMPANY (owner), not the acting dispatcher.
    const fresh = await Load.findById(load._id);
    expect(fresh.status).toBe('accepted');
    expect(String(fresh.acceptedBy)).toBe(String(bookingOwner._id));

    // The owner sees the load the dispatcher booked.
    const ownerView = await request(app).get('/api/loads/my-loads').set('Authorization', `Bearer ${bookingOwnerToken}`);
    expect(ownerView.body.map((l) => String(l._id))).toContain(String(load._id));
  });

  test('a dispatcher sees the company loads (board scoped to the owner)', async () => {
    // A load the OWNER accepted.
    await createTestLoad(owner._id /* shipper stand-in for postedBy */, {
      title: 'Company Load', status: 'accepted', acceptedBy: owner._id,
    });

    const email = `d4-${Date.now()}@acme.com`;
    await addDispatcher({ email, password: 'DispatchPass1' });
    const login = await request(app).post('/api/users/login').send({ email, password: 'DispatchPass1' });
    const dispToken = login.body.token;

    const res = await request(app).get('/api/loads/my-loads').set('Authorization', `Bearer ${dispToken}`);
    expect(res.status).toBe(200);
    expect(res.body.map((l) => l.title)).toContain('Company Load');
  });
});
