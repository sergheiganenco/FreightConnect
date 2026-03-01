/**
 * Shared freight industry option constants.
 * Used by ShipperPostLoad, LoadDetailsModal, filters, and contract forms.
 */

// Equipment types — aligned with backend rateSuggestionService BASE_CPM keys
export const EQUIPMENT_TYPES = [
  'Dry Van',
  'Reefer',
  'Flatbed',
  'Step Deck',
  'Lowboy',
  'RGN',
  'Conestoga',
  'Tanker',
  'Hopper Bottom',
  'Box Truck',
  'Power Only',
  'Car Hauler',
  'Hotshot',
  'Sprinter Van',
  'Intermodal Container',
  'Partial (LTL)',
];

// Equipment types that need dimension fields shown prominently
export const DIMENSION_PROMINENT_TYPES = [
  'Flatbed', 'Step Deck', 'Lowboy', 'RGN', 'Conestoga', 'Hotshot', 'Power Only',
];

// Max legal cargo weight (lbs) per equipment type.
// Based on 80,000 lb federal GVW limit minus typical tare weight of truck + trailer.
// Used to warn shippers before posting overweight loads.
export const EQUIPMENT_WEIGHT_LIMITS = {
  'Dry Van':              45000,
  'Reefer':               43000,  // reefer unit adds ~2,000 lbs
  'Flatbed':              48000,
  'Step Deck':            48000,
  'Lowboy':               42000,  // heavier trailer
  'RGN':                  42000,
  'Conestoga':            44000,
  'Tanker':               45000,
  'Hopper Bottom':        46000,
  'Box Truck':            10000,  // 26 ft box truck
  'Power Only':           48000,
  'Car Hauler':           44000,
  'Hotshot':              16500,  // 40 ft gooseneck
  'Sprinter Van':         3500,
  'Intermodal Container': 44000,
  'Partial (LTL)':       20000,  // practical partial limit
};

// Commodity categories
export const COMMODITY_CATEGORIES = [
  'Electronics',
  'Food & Beverage',
  'Pharma & Medical',
  'Furniture',
  'Automotive',
  'Agriculture',
  'Construction & Building',
  'Chemical & Industrial',
  'Retail & Consumer',
  'Mining & Raw Materials',
  'Plastics & Packaging',
  'Recycling & Waste',
  'Machinery & Equipment',
  'Textiles & Apparel',
  'Paper & Print',
  'Other',
];

// Sub-types per category (cascading dropdown)
export const COMMODITY_TYPES_BY_CATEGORY = {
  'Electronics':              ['Consumer Electronics', 'Industrial Electronics', 'Semiconductors', 'Computers & IT', 'Telecom Equipment', 'Cables & Wiring'],
  'Food & Beverage':          ['Refrigerated', 'Frozen', 'Dry Goods', 'Beverages', 'Produce', 'Dairy', 'Meat & Poultry', 'Canned Goods', 'Bakery', 'Seafood'],
  'Pharma & Medical':         ['Prescription Drugs', 'OTC Medications', 'Medical Devices', 'Lab Equipment', 'Vaccines (Cold Chain)', 'PPE & Supplies'],
  'Furniture':                ['Household Furniture', 'Office Furniture', 'Mattresses', 'Fixtures & Cabinets', 'Outdoor / Patio'],
  'Automotive':               ['Auto Parts', 'Vehicles', 'Tires', 'Batteries', 'Engines', 'Heavy Equipment Parts'],
  'Agriculture':              ['Grain & Corn', 'Livestock Feed', 'Fertilizer', 'Seeds', 'Cotton', 'Produce (Bulk)', 'Hay & Straw'],
  'Construction & Building':  ['Lumber', 'Steel Beams', 'Concrete / Cement', 'Roofing', 'Glass & Windows', 'Pipe & Tubing', 'Aggregate'],
  'Chemical & Industrial':    ['Hazmat Chemicals', 'Non-Hazmat Chemicals', 'Paint & Coatings', 'Lubricants', 'Solvents', 'Industrial Gases'],
  'Retail & Consumer':        ['General Merchandise', 'Apparel', 'Household Goods', 'Sporting Goods', 'Toys'],
  'Mining & Raw Materials':   ['Coal', 'Sand & Gravel', 'Ore', 'Salt', 'Limestone', 'Scrap Metal'],
  'Plastics & Packaging':     ['Plastic Resin', 'Packaging Materials', 'Containers', 'Film & Wrap'],
  'Recycling & Waste':        ['Recyclables', 'E-Waste', 'Industrial Waste', 'Scrap'],
  'Machinery & Equipment':    ['Farm Equipment', 'Construction Equipment', 'Industrial Machinery', 'Generators', 'HVAC Equipment'],
  'Textiles & Apparel':       ['Fabric Rolls', 'Finished Garments', 'Leather Goods', 'Yarn & Thread'],
  'Paper & Print':            ['Paper Products', 'Printed Materials', 'Cardboard', 'Packaging'],
  'Other':                    ['General Freight', 'Mixed Pallets', 'Samples', 'Trade Show', 'Personal / Household Moving'],
};

// Payment terms
export const PAYMENT_TERMS = [
  'Net 15', 'Net 30', 'Net 45', 'Net 60',
  'Quick Pay', 'Prepaid', 'COD',
  'Upon Delivery', 'Factoring Accepted',
];

// Multi-select: special handling requirements
export const SPECIAL_HANDLING_OPTIONS = [
  'Fragile',
  'Do Not Stack',
  'Keep Upright',
  'Keep Dry',
  'Team Drivers Required',
  'Tarp Required',
  'Chains Required',
  'White Glove / Inside Placement',
  'Floor Loaded (No Pallets)',
  'Over-Dimensional',
  'High Value',
  'Time-Critical / Expedited',
  'No Double Brokering',
  'Driver Assist Required',
  'Temperature Sensitive (Non-Reefer)',
];

// Multi-select: accessorial charges / services
export const ACCESSORIAL_OPTIONS = [
  'Liftgate Pickup',
  'Liftgate Delivery',
  'Inside Pickup',
  'Inside Delivery',
  'Residential Pickup',
  'Residential Delivery',
  'Limited Access Pickup',
  'Limited Access Delivery',
  'Detention (Pickup)',
  'Detention (Delivery)',
  'Lumper Service',
  'Pallet Jack Required',
  'Driver Count / Tally',
  'Appointment Required',
  'Sort & Segregate',
  'Layover',
  'TWIC Card Required',
  'Scale / Weight Ticket',
  'Customs Bond',
  'Cross-Dock',
];

// Hazmat classification (shown when hazardousMaterial is toggled on)
export const HAZMAT_CLASSES = [
  { value: '1',   label: 'Class 1 — Explosives' },
  { value: '2.1', label: 'Class 2.1 — Flammable Gas' },
  { value: '2.2', label: 'Class 2.2 — Non-Flammable Gas' },
  { value: '2.3', label: 'Class 2.3 — Toxic Gas' },
  { value: '3',   label: 'Class 3 — Flammable Liquid' },
  { value: '4.1', label: 'Class 4.1 — Flammable Solid' },
  { value: '4.2', label: 'Class 4.2 — Spontaneously Combustible' },
  { value: '4.3', label: 'Class 4.3 — Dangerous When Wet' },
  { value: '5.1', label: 'Class 5.1 — Oxidizer' },
  { value: '5.2', label: 'Class 5.2 — Organic Peroxide' },
  { value: '6.1', label: 'Class 6.1 — Toxic Substance' },
  { value: '6.2', label: 'Class 6.2 — Infectious Substance' },
  { value: '7',   label: 'Class 7 — Radioactive' },
  { value: '8',   label: 'Class 8 — Corrosive' },
  { value: '9',   label: 'Class 9 — Miscellaneous Dangerous' },
];

// Hazmat packing groups
export const HAZMAT_PACKING_GROUPS = [
  { value: 'I',   label: 'PG I — Great Danger' },
  { value: 'II',  label: 'PG II — Medium Danger' },
  { value: 'III', label: 'PG III — Minor Danger' },
];

// Insurance coverage levels
export const INSURANCE_LEVELS = [
  { value: '',        label: 'No specific requirement' },
  { value: '100000',  label: '$100,000' },
  { value: '250000',  label: '$250,000' },
  { value: '500000',  label: '$500,000' },
  { value: '750000',  label: '$750,000' },
  { value: '1000000', label: '$1,000,000' },
  { value: '2000000', label: '$2,000,000' },
  { value: '5000000', label: '$5,000,000' },
  { value: 'custom',  label: 'Custom amount...' },
];

// Documents that may be required
export const DOCUMENTS_REQUIRED_OPTIONS = [
  'BOL (Bill of Lading)',
  'POD (Proof of Delivery)',
  'Customs Paperwork',
  'Oversize / Overweight Permit',
  'Hazmat Placards & Paperwork',
  'Temperature Log / Reefer Printout',
  'Lumper Receipt',
  'Weight / Scale Ticket',
  'Delivery Receipt (Signed)',
  'Photos at Pickup',
  'Photos at Delivery',
  'Seal Number Verification',
  'Insurance Certificate',
];
