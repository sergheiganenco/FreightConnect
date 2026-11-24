/**
 * Next-load proposals: when a truck is close to delivery the office and the driver are told the best
 * next load, once; and a driver can ask the office to book a plan (a driver cannot book).
 */
require('../setup');
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const User = require('../../models/User');
const Load = require('../../models/Load');
const Notification = require('../../models/Notification');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const { runNextLoadProposals } = require('../../jobs/nextLoadProposer');

const CHI = { lat: 41.8781, lng: -87.6298 };
const MKE = { lat: 43.0389, lng: -87.9065 };
const STL = { lat: 38.627, lng: -90.1994 };
const HOUR = 3600000;

const app = express();
app.use(express.json());
app.use('/api/autopilot', require('../../routes/autopilotRoutes'));

async function setup(truckAt) {
  const shipper = await createTestUser({ role: 'shipper' });
  const owner = await createTestUser({
    role: 'carrier', companyRole: 'owner',
    fleet: [{ truckId: 'T1', driverName: 'Dan Driver' }],
    drivers: [{ driverId: 'D1', name: 'Dan Driver', assignedTruckId: 'T1' }],
    preferences: { equipmentTypes: ['Dry Van'] },
  });
  const driver = await createTestUser({ role: 'carrier', name: 'Dan Driver', parentAccountId: owner._id, companyRole: 'driver', mustChangePassword: false });
  await User.updateOne({ _id: owner._id, 'drivers.driverId': 'D1' }, { $set: { 'drivers.$.loginUserId': driver._id } });
  const dTok = { Authorization: `Bearer ${jwt.sign({ userId: String(driver._id), role: 'carrier', companyRole: 'driver', companyOwnerId: String(owner._id) }, process.env.JWT_SECRET)}` };

  // On the road to Chicago, due within the hour.
  const hauling = await createTestLoad(shipper._id, {
    title: 'Stl-Chi', status: 'in-transit', acceptedBy: owner._id, assignedTruckId: 'T1',
    origin: 'St. Louis, MO', destination: 'Chicago, IL',
    originLat: STL.lat, originLng: STL.lng, destinationLat: CHI.lat, destinationLng: CHI.lng,
    pickupTimeWindow: { start: new Date(Date.now() - 6 * HOUR), end: new Date(Date.now() - 5 * HOUR) },
    deliveryTimeWindow: { start: new Date(Date.now() - HOUR), end: new Date(Date.now() + HOUR) },
    carrierLocation: { latitude: truckAt.lat, longitude: truckAt.lng, updatedAt: new Date(), source: 'browser' },
  });
  // A load out of Chicago the truck could take next.
  const next = await createTestLoad(shipper._id, {
    title: 'Chi-Mke', origin: 'Chicago, IL', destination: 'Milwaukee, WI',
    originLat: CHI.lat, originLng: CHI.lng, destinationLat: MKE.lat, destinationLng: MKE.lng,
    distanceMiles: 92, rate: 400,
    pickupTimeWindow: { start: new Date(), end: new Date(Date.now() + 24 * HOUR) },
    deliveryTimeWindow: { start: new Date(), end: new Date(Date.now() + 72 * HOUR) },
  });
  return { shipper, owner, driver, dTok, hauling, next };
}

test('close to delivery: the office and the driver are told the best next load, once', async () => {
  const { owner, driver, hauling, next } = await setup({ lat: 41.6, lng: -87.9 }); // about 25 miles out

  expect((await runNextLoadProposals()).proposed).toBe(1);
  const office = await Notification.findOne({ userId: owner._id, type: 'autopilot:next_load' });
  expect(office.body).toMatch(/Chi-Mke/);
  expect(office.body).toMatch(/\$400/);
  expect(office.link).toBe('/dashboard/carrier/autopilot?truckId=T1');
  const forDriver = await Notification.findOne({ userId: driver._id, type: 'autopilot:next_load' });
  expect(forDriver.body).toMatch(/ask dispatch/);
  expect(forDriver.body).not.toMatch(/\$/); // the rate is the office's business
  expect((await Load.findById(hauling._id)).nextLoadProposal.loadIds).toEqual([String(next._id)]);

  // Same best option later: nobody is told twice.
  await runNextLoadProposals(new Date(Date.now() + 40 * 60000));
  expect(await Notification.countDocuments({ type: 'autopilot:next_load' })).toBe(2);
});

test('a truck still far from delivery is left alone', async () => {
  await setup(STL);
  expect((await runNextLoadProposals()).near).toBe(0);
  expect(await Notification.countDocuments({ type: 'autopilot:next_load' })).toBe(0);
});

test('a driver asks the office to book a plan; only a plan the planner offers can be asked for', async () => {
  const { owner, dTok, next, shipper } = await setup({ lat: 41.6, lng: -87.9 });
  const ask = (tok, loadIds) => request(app).post('/api/autopilot/request').set(tok).send({ truckId: 'T1', loadIds });

  const ok = await ask(dTok, [String(next._id)]);
  expect(ok.status).toBe(200);
  const told = await Notification.findOne({ userId: owner._id, type: 'autopilot:driver_request' });
  expect(told.title).toMatch(/Dan Driver asks/);
  expect(told.body).toMatch(/Chi-Mke/);

  expect((await ask(dTok, [String(next._id)])).body.data.alreadyAsked).toBe(true);
  expect(await Notification.countDocuments({ type: 'autopilot:driver_request' })).toBe(1);

  const hidden = await createTestLoad(shipper._id, { title: 'private', loadVisibility: 'private', originLat: CHI.lat, originLng: CHI.lng, destinationLat: MKE.lat, destinationLng: MKE.lng });
  expect((await ask(dTok, [String(hidden._id)])).status).toBe(404);

  const stranger = await createTestUser({ role: 'carrier' });
  expect((await ask({ Authorization: `Bearer ${generateToken(stranger)}` }, [String(next._id)])).status).toBe(404); // not their truck
});
