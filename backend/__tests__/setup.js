const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.JWT_SECRET = 'test-secret-key-for-testing';
  process.env.NODE_ENV = 'test';
  // Tests run as if payments were switched on, so the payment-method rule is exercised.
  if (process.env.REQUIRE_SHIPPER_PAYMENT_METHOD === undefined) process.env.REQUIRE_SHIPPER_PAYMENT_METHOD = 'true';
  await mongoose.connect(mongoServer.getUri());
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});
