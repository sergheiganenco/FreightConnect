/**
 * loadParserService — heuristic (no-API-key) parsing of free-text load offers.
 *
 * These exercise the deterministic path only. The Claude path is a fail-safe
 * seam that is exercised only when ANTHROPIC_API_KEY is set; with no key,
 * parseLoads() must always return the heuristic result.
 */

const svc = require('../../services/loadParserService');

describe('equipment normalization', () => {
  const cases = [
    ['dry van', 'Dry Van'],
    ['53ft van', 'Dry Van'],
    ['reefer', 'Reefer'],
    ['refrigerated', 'Reefer'],
    ['temp control', 'Reefer'],
    ['flatbed', 'Flatbed'],
    ['flat bed', 'Flatbed'],
    ['step deck', 'Step Deck'],
    ['stepdeck', 'Step Deck'],
    ['lowboy', 'Lowboy'],
    ['tanker', 'Tanker'],
    ['box truck', 'Box Truck'],
    ['straight truck', 'Box Truck'],
    ['power only', 'Power Only'],
    ['power-only', 'Power Only'],
    ['conestoga', 'Conestoga'],
    ['RGN', 'RGN'],
  ];
  test.each(cases)('%s → %s', (input, expected) => {
    expect(svc.normalizeEquipment(input)).toBe(expected);
  });

  test('unknown equipment → null', () => {
    expect(svc.normalizeEquipment('spaceship')).toBeNull();
    expect(svc.normalizeEquipment('')).toBeNull();
  });

  test('specific types beat generic ones', () => {
    expect(svc.normalizeEquipment('step deck trailer')).toBe('Step Deck'); // not "Dry Van" via "deck"
    expect(svc.normalizeEquipment('dry van 53')).toBe('Dry Van');          // "van" not misread
  });
});

describe('rate detection', () => {
  test('keyed rate wins', () => {
    expect(svc.parseRateDollars('weight 42,000 lbs, rate $2,400')).toBe(2400);
  });
  test('largest $ amount when no keyword', () => {
    expect(svc.parseRateDollars('$50 lumper, $1,850 total move')).toBe(1850);
  });
  test('rejects implausible figures (weights, refs)', () => {
    expect(svc.parseRateDollars('order 123456, weight 45000 lbs')).toBeNull();
  });
  test('no money → null', () => {
    expect(svc.parseRateDollars('Chicago to Dallas dry van')).toBeNull();
  });
});

describe('weight detection', () => {
  test.each([
    ['42,000 lbs', 42000],
    ['38000 pounds', 38000],
    ['44000#', 44000],
  ])('%s → %d', (input, expected) => {
    expect(svc.parseWeightLbs(input)).toBe(expected);
  });
  test('no weight → null', () => {
    expect(svc.parseWeightLbs('dry van $2,000')).toBeNull();
  });
});

describe('lane extraction', () => {
  test.each([
    'Chicago, IL to Dallas, TX',
    'Chicago, IL -> Dallas, TX',
    'Chicago, IL → Dallas, TX',
    'Chicago, IL - Dallas, TX',
  ])('connector: %s', (line) => {
    const lane = svc.extractLane(line);
    expect(lane).toEqual({ origin: 'Chicago, IL', destination: 'Dallas, TX' });
  });

  test('two bare city/state tokens (no connector)', () => {
    const lane = svc.extractLane('PU Atlanta, GA  DEL Miami, FL');
    expect(lane).toEqual({ origin: 'Atlanta, GA', destination: 'Miami, FL' });
  });

  test('title-cases city and uppercases state on lowercase input', () => {
    expect(svc.extractLane('reno, nv to boise, id')).toEqual({ origin: 'Reno, NV', destination: 'Boise, ID' });
  });

  test('strips sentence filler before the city', () => {
    expect(svc.extractLane('going from Denver, CO to Phoenix, AZ')).toEqual({ origin: 'Denver, CO', destination: 'Phoenix, AZ' });
  });

  test('no lane → null', () => {
    expect(svc.extractLane('thanks, John')).toBeNull();
    expect(svc.extractLane('')).toBeNull();
  });
});

describe('external reference extraction', () => {
  test.each([
    ['load #A123', 'A123'],
    ['Ref: BX-9981', 'BX-9981'],
    ['order # 55A7', '55A7'],
    ['shipment SH100', 'SH100'],
  ])('%s → %s', (input, expected) => {
    expect(svc.extractExternalRef(input)).toBe(expected);
  });
});

describe('heuristicParse — flat broker-email list', () => {
  const email = `Hi team, loads available today:

1. Chicago, IL to Dallas, TX - Dry Van - 42,000 lbs - $2,400 - load #A123
2. Atlanta, GA -> Miami, FL, Reefer, $1,900, ref BX-9981
3. Reno, NV to Boise, ID | Flatbed | $1,250

Thanks,
Dispatch`;

  const result = svc.heuristicParse(email);

  test('finds all three loads, ignores greeting/signature', () => {
    expect(result.source).toBe('heuristic');
    expect(result.loads).toHaveLength(3);
  });

  test('load 1 fully parsed → high confidence', () => {
    const l = result.loads[0];
    expect(l.origin).toBe('Chicago, IL');
    expect(l.destination).toBe('Dallas, TX');
    expect(l.equipmentType).toBe('Dry Van');
    expect(l.rate).toBe(2400);
    expect(l.loadWeight).toBe(42000);
    expect(l.externalRef).toBe('A123');
    expect(l.source).toBe('email');
    expect(l.confidence).toBe('high');
    expect(l.title).toContain('Chicago, IL → Dallas, TX');
  });

  test('load 2 parsed with reefer + ref', () => {
    const l = result.loads[1];
    expect(l.equipmentType).toBe('Reefer');
    expect(l.rate).toBe(1900);
    expect(l.externalRef).toBe('BX-9981');
  });
});

describe('heuristicParse — single load in a paragraph (block mode)', () => {
  const text = `We have a load going from Denver, CO to Phoenix, AZ.
Equipment: reefer. Weight about 40,000 lbs. Rate is $2,100 all-in.`;
  const result = svc.heuristicParse(text);

  test('extracts one complete load', () => {
    expect(result.loads).toHaveLength(1);
    const l = result.loads[0];
    expect(l.origin).toBe('Denver, CO');
    expect(l.destination).toBe('Phoenix, AZ');
    expect(l.equipmentType).toBe('Reefer');
    expect(l.rate).toBe(2100);
    expect(l.confidence).toBe('high');
  });
});

describe('heuristicParse — missing fields produce warnings, not failures', () => {
  const result = svc.heuristicParse('Kansas City, MO to Omaha, NE');
  test('lane-only load is medium/low confidence with warnings', () => {
    expect(result.loads).toHaveLength(1);
    const l = result.loads[0];
    expect(l.rate).toBeNull();
    expect(l.equipmentType).toBeNull();
    expect(l.warnings).toEqual(expect.arrayContaining(['rate not detected', 'equipment type not detected']));
    expect(l.confidence).toBe('low');
  });
});

describe('heuristicParse — no parseable load', () => {
  test('returns empty with a helpful warning', () => {
    const result = svc.heuristicParse('Just checking in — any updates?');
    expect(result.loads).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/no loads detected/i);
  });
});

describe('parseLoads engine selection (no API key)', () => {
  const original = process.env.ANTHROPIC_API_KEY;
  afterAll(() => { if (original === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = original; });

  test('auto with no key → heuristic', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await svc.parseLoads('Dallas, TX to Houston, TX dry van $900');
    expect(result.source).toBe('heuristic');
    expect(result.loads).toHaveLength(1);
  });

  test('explicit heuristic engine → heuristic even if a key were present', async () => {
    const result = await svc.parseLoads('Dallas, TX to Houston, TX flatbed $1,100', { engine: 'heuristic' });
    expect(result.source).toBe('heuristic');
    expect(result.loads[0].equipmentType).toBe('Flatbed');
  });

  test('empty input → empty result', async () => {
    const result = await svc.parseLoads('   ');
    expect(result.loads).toHaveLength(0);
    expect(result.warnings).toContain('empty input');
  });
});
