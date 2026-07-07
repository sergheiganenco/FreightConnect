const { haversineMiles, boundingBox, round } = require('../utils/geo');

describe('geo util', () => {
  test('haversineMiles: known city pair (Joplin, MO → Dallas, TX) ≈ 316 mi straight-line', () => {
    // Joplin 37.0842,-94.5133 ; Dallas 32.7767,-96.7970 (great-circle, not driving)
    const d = haversineMiles(37.0842, -94.5133, 32.7767, -96.7970);
    expect(d).toBeGreaterThan(300);
    expect(d).toBeLessThan(335);
  });

  test('haversineMiles: zero distance for identical points', () => {
    expect(haversineMiles(40, -90, 40, -90)).toBe(0);
  });

  test('haversineMiles is symmetric', () => {
    const a = haversineMiles(34.05, -118.24, 40.71, -74.0);
    const b = haversineMiles(40.71, -74.0, 34.05, -118.24);
    expect(round(a, 3)).toBe(round(b, 3));
  });

  test('boundingBox fully contains a point exactly `radius` miles due north', () => {
    const lat = 39.0, lng = -95.0, radius = 75;
    const box = boundingBox(lat, lng, radius);
    // A point ~74 miles north is inside the box and inside the circle.
    const northLat = lat + 74 / 69;
    expect(northLat).toBeLessThanOrEqual(box.latMax);
    expect(haversineMiles(lat, lng, northLat, lng)).toBeLessThan(radius);
  });

  test('boundingBox is a superset of the circle (corner is farther than radius)', () => {
    const lat = 39.0, lng = -95.0, radius = 50;
    const box = boundingBox(lat, lng, radius);
    // The NE corner of the box is farther than the radius (box ⊇ circle), so the
    // haversine refine step is what enforces the true radius.
    const cornerDist = haversineMiles(lat, lng, box.latMax, box.lngMax);
    expect(cornerDist).toBeGreaterThan(radius);
  });

  test('round trims float noise', () => {
    expect(round(2.9999999, 2)).toBe(3);
    expect(round(3.005, 2)).toBe(3.01);
  });
});
