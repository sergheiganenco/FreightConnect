/**
 * Hours of service: a status that runs past midnight, special statuses, corrections with history,
 * the company settings, the 8-day record, and the hours check when a driver is assigned to a load.
 */
require('../setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const ELDLog = require('../../models/ELDLog');
const { createTestUser, generateToken, createTestLoad } = require('../helpers');
const { dateIn } = require('../../services/hosRules');

jest.mock('axios');
jest.mock('node-fetch');

const mockIo = { to: () => ({ emit: () => {} }), emit: () => {} };
const app = express();
app.use(express.json());
app.use('/api/eld', require('../../routes/eldRoutes'));
app.use('/api/loads', require('../../routes/loadRoutes')(mockIo));

const bearer = (u) => ({ Authorization: `Bearer ${generateToken(u)}` });
const HOUR = 3600000;
const TZ = 'America/Chicago';
const ago = (h) => new Date(Date.now() - h * HOUR);

async function company() {
  const owner = await createTestUser({ role: 'carrier', drivers: [{ driverId: 'drv_1', name: 'Ann Driver' }] });
  const driver = await createTestUser({ role: 'carrier', name: 'Ann Driver', parentAccountId: owner._id, companyRole: 'driver', mustChangePassword: false });
  await User.updateOne({ _id: owner._id, 'drivers.driverId': 'drv_1' }, { $set: { 'drivers.$.loginUserId': driver._id } });
  const dTok = { Authorization: `Bearer ${jwt.sign({ userId: driver._id, role: 'carrier', companyRole: 'driver', companyOwnerId: String(owner._id) }, process.env.JWT_SECRET)}` };
  return { owner, driver, dTok };
}
// A log holding the given entries; the last one is left running.
const seedLog = (driver, owner, entries) => ELDLog.create({
  carrier: driver._id, companyId: owner._id, date: dateIn(entries[0][1], TZ),
  events: entries.map(([status, startTime], i) => ({ status, startTime, endTime: entries[i + 1] ? entries[i + 1][1] : undefined })),
});

describe('the duty-status log', () => {
  test('a status started on an earlier day keeps running and is closed by the next change', async () => {
    const { owner, driver, dTok } = await company();
    // Bucketed on an old day on purpose: the day an entry is filed under must not matter.
    await ELDLog.create({ carrier: driver._id, companyId: owner._id, date: dateIn(ago(50), TZ), events: [{ status: 'DRIVING', startTime: ago(2) }] });

    const today = await request(app).get('/api/eld/today').set(dTok);
    expect(today.body.currentStatus).toBe('DRIVING');
    expect(today.body.clock.driveMinutesUsed).toBe(120);
    expect(today.body.remaining.driveMinutes).toBe(540);

    const off = await request(app).post('/api/eld/status').set(dTok).send({ status: 'OFF_DUTY' });
    expect(off.status).toBe(200);
    expect(off.body.currentStatus).toBe('OFF_DUTY');
    const logs = await ELDLog.find({ carrier: driver._id });
    expect(logs.flatMap((l) => l.events).filter((e) => !e.endTime)).toHaveLength(1); // only the new one is open
    expect(off.body.clock.driveMinutesUsed).toBe(120);

    // The same status again changes nothing.
    await request(app).post('/api/eld/status').set(dTok).send({ status: 'OFF_DUTY' });
    expect((await ELDLog.find({ carrier: driver._id })).flatMap((l) => l.events)).toHaveLength(2);
  });

  test('personal conveyance and yard moves need a reason', async () => {
    const { dTok } = await company();
    expect((await request(app).post('/api/eld/status').set(dTok).send({ status: 'PERSONAL_CONVEYANCE' })).status).toBe(400);
    const pc = await request(app).post('/api/eld/status').set(dTok).send({ status: 'PERSONAL_CONVEYANCE', notes: 'to safe parking' });
    expect(pc.status).toBe(200);
    expect(pc.body.clock.onShift).toBe(false);
    expect((await request(app).post('/api/eld/status').set(dTok).send({ status: 'BOGUS' })).status).toBe(400);
  });

  test('a correction needs a reason, keeps the original, and un-certifies the day; nobody else can make it', async () => {
    const { owner, driver, dTok } = await company();
    const log = await seedLog(driver, owner, [['ON_DUTY_NOT_DRIVING', ago(3)], ['OFF_DUTY', ago(1)]]);
    await ELDLog.updateOne({ _id: log._id }, { $set: { certified: true } });
    const id = log.events[0]._id;

    expect((await request(app).put(`/api/eld/events/${id}`).set(dTok).send({ status: 'DRIVING' })).status).toBe(400); // no reason
    expect((await request(app).put(`/api/eld/events/${id}`).set(bearer(owner)).send({ status: 'DRIVING', note: 'fixing it for her' })).status).toBe(404);
    expect((await request(app).put(`/api/eld/events/${id}`).set(dTok).send({ startTime: ago(0.5).toISOString(), note: 'wrong time' })).status).toBe(400); // after the next entry

    const ok = await request(app).put(`/api/eld/events/${id}`).set(dTok).send({ status: 'DRIVING', note: 'picked the wrong button' });
    expect(ok.status).toBe(200);
    expect(ok.body.clock.driveMinutesUsed).toBe(120);
    const after = await ELDLog.findById(log._id);
    expect(after.certified).toBe(false);
    expect(after.edits).toHaveLength(1);
    expect(after.edits[0].from.status).toBe('ON_DUTY_NOT_DRIVING');
    expect(after.edits[0].note).toBe('picked the wrong button');
  });

  test('settings: only a manager changes them, and the weekly limit follows', async () => {
    const { owner, dTok } = await company();
    expect((await request(app).put('/api/eld/settings').set(dTok).send({ cycle: '60_7', timeZone: TZ })).status).toBe(403);
    expect((await request(app).put('/api/eld/settings').set(bearer(owner)).send({ cycle: '60_7', timeZone: 'Mars/Olympus' })).status).toBe(400);
    expect((await request(app).put('/api/eld/settings').set(bearer(owner)).send({ cycle: '60_7', timeZone: 'America/Denver' })).status).toBe(200);
    const today = await request(app).get('/api/eld/today').set(dTok);
    expect(today.body.clock.cycleHours).toBe(60);
    expect(today.body.settings.timeZone).toBe('America/Denver');
  });

  test('the 8-day record: the driver and their manager can open it, another company cannot', async () => {
    const { owner, driver, dTok } = await company();
    await seedLog(driver, owner, [['DRIVING', ago(5)], ['OFF_DUTY', ago(2)]]);
    const mine = await request(app).get('/api/eld/record').set(dTok);
    expect(mine.body.data.days).toHaveLength(8);
    expect(mine.body.data.days.reduce((n, d) => n + d.totals.drivingMinutes, 0)).toBe(180);

    const boss = await request(app).get(`/api/eld/record?driverId=${driver._id}`).set(bearer(owner));
    expect(boss.body.data.driver.name).toBe('Ann Driver');
    const stranger = await createTestUser({ role: 'carrier' });
    expect((await request(app).get(`/api/eld/record?driverId=${driver._id}`).set(bearer(stranger))).status).toBe(403);
    const other = await company();
    expect((await request(app).get(`/api/eld/record?driverId=${driver._id}`).set(other.dTok)).status).toBe(403);

    const pdf = await request(app).get('/api/eld/record/pdf').set(dTok).buffer(true).parse((res, cb) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.headers['content-type']).toMatch(/pdf/);
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');

    const fleet = await request(app).get('/api/eld/fleet').set(bearer(owner));
    expect(fleet.body.drivers).toHaveLength(1);
    expect(fleet.body.drivers[0].currentStatus).toBe('OFF_DUTY');
  });
});

describe('assigning a driver checks their hours', () => {
  const assign = (owner, load) => request(app).put(`/api/loads/${load._id}/assign-driver`).set(bearer(owner)).send({ driverId: 'drv_1' });
  const booked = async (owner, pickupInHours) => {
    const shipper = await createTestUser({ role: 'shipper' });
    return createTestLoad(shipper._id, {
      status: 'accepted', acceptedBy: owner._id,
      pickupTimeWindow: { start: new Date(Date.now() + pickupInHours * HOUR), end: new Date(Date.now() + (pickupInHours + 1) * HOUR) },
    });
  };

  test('a driver who is out of hours is refused for a pickup they cannot legally reach, and allowed for a later one', async () => {
    const { owner, driver } = await company();
    await seedLog(driver, owner, [['DRIVING', ago(11.5)]]); // 11.5h straight: no driving time left

    const soon = await assign(owner, await booked(owner, 2));
    expect(soon.status).toBe(409);
    expect(soon.body.code).toBe('driver_out_of_hours');

    const later = await assign(owner, await booked(owner, 14)); // 10h of rest fits before pickup
    expect(later.status).toBe(200);
    expect(later.body.hosWarning).toMatch(/out of hours now/);
  });

  test('no log, or a working status left running for a day, is a warning and not a block', async () => {
    const { owner, driver } = await company();
    const none = await assign(owner, await booked(owner, 2));
    expect(none.status).toBe(200);
    expect(none.body.hosWarning).toMatch(/no recent hours-of-service log/);

    await seedLog(driver, owner, [['DRIVING', ago(30)]]);
    const stale = await assign(owner, await booked(owner, 2));
    expect(stale.status).toBe(200);
    expect(stale.body.hosWarning).toMatch(/no recent hours-of-service log/);
  });

  test('a rested driver is assigned with no warning', async () => {
    const { owner, driver } = await company();
    await seedLog(driver, owner, [['DRIVING', ago(20)], ['OFF_DUTY', ago(12)]]);
    const res = await assign(owner, await booked(owner, 2));
    expect(res.status).toBe(200);
    expect(res.body.hosWarning).toBeNull();
  });
});
