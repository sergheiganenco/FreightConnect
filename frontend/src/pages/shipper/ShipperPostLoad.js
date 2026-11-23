import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useParams, Link as RouterLink } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  TextField, Button, Grid, Typography, Box, Paper, Snackbar, Alert, Select, MenuItem,
  FormControl, FormHelperText, InputLabel, FormControlLabel, Switch, Checkbox, Divider, Chip, IconButton,
  CircularProgress, Collapse, Tooltip, Stepper, Step, StepLabel, Link,
} from "@mui/material";
import Autocomplete from "@mui/material/Autocomplete";
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import PlaceIcon from '@mui/icons-material/Place';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import MonetizationOnIcon from '@mui/icons-material/MonetizationOn';
import VisibilityIcon from '@mui/icons-material/Visibility';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import StopIcon from '@mui/icons-material/Stop';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import AcUnitIcon from '@mui/icons-material/AcUnit';
import StraightenIcon from '@mui/icons-material/Straighten';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import api from '../../services/api';
import { useDraftManager, DraftResumeDialog } from '../../components/DraftManager';
import cities from '../../data/usCities.json';
import {
  EQUIPMENT_TYPES, COMMODITY_CATEGORIES, COMMODITY_TYPES_BY_CATEGORY,
  PAYMENT_TERMS, SPECIAL_HANDLING_OPTIONS, ACCESSORIAL_OPTIONS,
  HAZMAT_CLASSES, HAZMAT_PACKING_GROUPS, INSURANCE_LEVELS,
  DOCUMENTS_REQUIRED_OPTIONS, DIMENSION_PROMINENT_TYPES, EQUIPMENT_WEIGHT_LIMITS,
} from '../../data/freightOptions';

const initialLoad = {
  // Core required
  title: "",
  commodityType: "",
  commodityCategory: "",
  weight: "",
  equipmentType: "",
  equipmentSubtype: "",
  requiredEndorsements: [],
  origin: "",
  pickupWindowStart: "",
  pickupWindowEnd: "",
  destination: "",
  deliveryFacilityName: "",
  deliveryAddress: "",
  deliveryContactName: "",
  deliveryContactPhone: "",
  deliveryWindowStart: "",
  deliveryWindowEnd: "",
  rate: "",
  currency: "USD",
  paymentTerms: "",
  termsAccepted: false,
  // Core optional
  specialInstructions: "",
  notes: "",
  loadVisibility: "public",
  expirationDateTime: "",
  allowCarrierBidding: true,
  // Attachments
  cargoPhotos: [],
  rateConfirmationUpload: [],
  customsDocsUpload: [],
  // Advanced / enterprise (optional)
  pickupFacilityName: "",
  pickupAddress: "",
  pickupContactName: "",
  pickupContactPhone: "",
  poNumber: "",
  shipperReferenceNumber: "",
  consigneeReference: "",
  cargoValue: "",
  insuranceRequired: "",
  customInsuranceAmount: "",
  hazardousMaterial: false,
  hazmatClass: "",
  hazmatPackingGroup: "",
  dangerousGoodsUN: "",
  temperatureMin: "",
  temperatureMax: "",
  temperatureUnit: "F",
  specialHandling: [],
  accessorials: [],
  carrierInstructions: "",
  documentsRequired: [],
  // Load dimensions
  loadLength: "",
  loadWidth: "",
  loadHeight: "",
  // Overweight acknowledgment
  overweightAcknowledged: false,
  overweightPermitNumber: "",
  // Pickup handshake: dock must verify the driver's code before pickup
  requirePickupVerification: false,
  // Photo evidence the driver must add before pickup / delivery can be completed
  requirePickupPhotos: false,
  requireDeliveryPhotos: false,
};

// ── Edit mode helpers ──────────────────────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, '0');
const toLocalInput = (iso) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const str = (v) => (v == null ? '' : String(v));
const INSURANCE_VALUES = INSURANCE_LEVELS.map((i) => i.value).filter((v) => v && v !== 'custom');

// A stored load -> the form's state (the inverse of formToApi).
function loadToForm(l) {
  const ins = l.insuranceRequired == null ? '' : String(l.insuranceRequired);
  const customIns = ins && !INSURANCE_VALUES.includes(ins);
  const reefer = l.reefer || {};
  const d = l.loadDimensions || {};
  const form = {
    ...initialLoad,
    title: str(l.title), commodityType: str(l.commodityType), commodityCategory: str(l.commodityCategory),
    weight: str(l.loadWeight), equipmentType: str(l.equipmentType),
    origin: str(l.origin), destination: str(l.destination),
    pickupWindowStart: toLocalInput(l.pickupTimeWindow?.start), pickupWindowEnd: toLocalInput(l.pickupTimeWindow?.end),
    deliveryWindowStart: toLocalInput(l.deliveryTimeWindow?.start), deliveryWindowEnd: toLocalInput(l.deliveryTimeWindow?.end),
    deliveryFacilityName: str(l.deliveryFacilityName), deliveryAddress: str(l.deliveryAddress),
    deliveryContactName: str(l.deliveryContactName), deliveryContactPhone: str(l.deliveryContactPhone),
    pickupFacilityName: str(l.pickupFacilityName), pickupAddress: str(l.pickupAddress),
    pickupContactName: str(l.pickupContactName), pickupContactPhone: str(l.pickupContactPhone),
    rate: str(l.rate), currency: l.currency || 'USD', paymentTerms: str(l.paymentTerms),
    termsAccepted: true, // agreed when the load was posted
    specialInstructions: str(l.specialInstructions), notes: str(l.notes), carrierInstructions: str(l.carrierInstructions),
    loadVisibility: l.loadVisibility || 'public', expirationDateTime: toLocalInput(l.expirationDateTime),
    allowCarrierBidding: l.allowCarrierBidding !== false,
    poNumber: str(l.poNumber), shipperReferenceNumber: str(l.shipperReferenceNumber), consigneeReference: str(l.consigneeReference),
    cargoValue: str(l.cargoValue),
    insuranceRequired: customIns ? 'custom' : ins, customInsuranceAmount: customIns ? ins : '',
    hazardousMaterial: l.hazardousMaterial === true,
    hazmatClass: str(l.hazmatClass), hazmatPackingGroup: str(l.hazmatPackingGroup), dangerousGoodsUN: str(l.dangerousGoodsUN),
    temperatureMin: str(reefer.targetMinC), temperatureMax: str(reefer.targetMaxC), temperatureUnit: 'C', // stored in Celsius
    specialHandling: l.specialHandling || [], accessorials: l.accessorials || [], documentsRequired: l.documentsRequired || [],
    loadLength: str(d.length), loadWidth: str(d.width), loadHeight: str(d.height),
    overweightAcknowledged: l.overweightAcknowledged === true, overweightPermitNumber: str(l.overweightPermitNumber),
    requirePickupVerification: l.pickupVerification?.required === true,
    requirePickupPhotos: l.evidenceRequired?.pickup === true, requireDeliveryPhotos: l.evidenceRequired?.delivery === true,
  };
  const stops = (l.stops || []).map((s, i) => ({
    sequence: s.sequence ?? i + 1, type: s.type || 'delivery', address: str(s.address),
    timeWindowStart: toLocalInput(s.timeWindow?.start), timeWindowEnd: toLocalInput(s.timeWindow?.end),
    contactName: str(s.contactName), contactPhone: str(s.contactPhone), notes: str(s.notes),
  }));
  return { form, stops };
}

// The form's state -> the body PUT /loads/:id takes (schema field names; '' / null clear an optional field).
function formToApi(f, stops, reeferBase) {
  const num = (v) => (v === '' || v == null ? null : Number(v));
  const txt = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const iso = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
  const win = (s, e) => (s ? { start: iso(s), end: e ? iso(e) : undefined } : null);
  const toC = (v) => {
    if (v === '' || v == null || Number.isNaN(parseFloat(v))) return undefined;
    return f.temperatureUnit === 'F' ? Math.round(((parseFloat(v) - 32) * 5) / 9 * 10) / 10 : parseFloat(v);
  };
  const hazmat = f.hazardousMaterial === true;
  const insurance = f.insuranceRequired === 'custom' ? f.customInsuranceAmount : f.insuranceRequired;
  const dims = { length: num(f.loadLength), width: num(f.loadWidth), height: num(f.loadHeight) };
  return {
    title: txt(f.title), origin: txt(f.origin), destination: txt(f.destination), rate: num(f.rate), equipmentType: txt(f.equipmentType),
    commodityType: txt(f.commodityType), commodityCategory: txt(f.commodityCategory), loadWeight: num(f.weight),
    loadDimensions: dims.length == null && dims.width == null && dims.height == null ? null : dims,
    pickupTimeWindow: win(f.pickupWindowStart, f.pickupWindowEnd), deliveryTimeWindow: win(f.deliveryWindowStart, f.deliveryWindowEnd),
    hazardousMaterial: hazmat,
    hazmatClass: hazmat ? txt(f.hazmatClass) : null, hazmatPackingGroup: hazmat ? txt(f.hazmatPackingGroup) : null,
    dangerousGoodsUN: hazmat ? txt(f.dangerousGoodsUN) : null,
    reefer: f.equipmentType === 'Reefer' ? { ...reeferBase, enabled: true, targetMinC: toC(f.temperatureMin), targetMaxC: toC(f.temperatureMax), alertOnDeviation: true } : null,
    stops: stops.map((s, i) => ({
      sequence: i + 1, type: s.type, address: s.address,
      timeWindow: s.timeWindowStart ? { start: iso(s.timeWindowStart), end: s.timeWindowEnd ? iso(s.timeWindowEnd) : undefined } : undefined,
      contactName: txt(s.contactName) || undefined, contactPhone: txt(s.contactPhone) || undefined, notes: txt(s.notes) || undefined,
    })),
    specialInstructions: txt(f.specialInstructions), specialHandling: f.specialHandling, accessorials: f.accessorials,
    insuranceRequired: num(insurance), cargoValue: num(f.cargoValue), paymentTerms: txt(f.paymentTerms), currency: txt(f.currency),
    loadVisibility: f.loadVisibility, allowCarrierBidding: f.allowCarrierBidding === true,
    expirationDateTime: f.expirationDateTime ? iso(f.expirationDateTime) : null,
    notes: txt(f.notes), carrierInstructions: txt(f.carrierInstructions), documentsRequired: f.documentsRequired,
    poNumber: txt(f.poNumber), shipperReferenceNumber: txt(f.shipperReferenceNumber), consigneeReference: txt(f.consigneeReference),
    pickupFacilityName: txt(f.pickupFacilityName), pickupAddress: txt(f.pickupAddress), pickupContactName: txt(f.pickupContactName), pickupContactPhone: txt(f.pickupContactPhone),
    deliveryFacilityName: txt(f.deliveryFacilityName), deliveryAddress: txt(f.deliveryAddress), deliveryContactName: txt(f.deliveryContactName), deliveryContactPhone: txt(f.deliveryContactPhone),
    overweightAcknowledged: f.overweightAcknowledged === true, overweightPermitNumber: txt(f.overweightPermitNumber),
    pickupVerification: { required: f.requirePickupVerification === true },
    evidenceRequired: { pickup: f.requirePickupPhotos === true, delivery: f.requireDeliveryPhotos === true },
  };
}

// Only what the shipper changed is sent, so untouched fields (and their exact stored values) are never rewritten.
const diffApi = (next, prev) => Object.fromEntries(Object.entries(next).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(prev[k])));

// Required to save an existing load: what the server requires (loads from EDI/import may lack the rest).
const EDIT_REQUIRED = ['title', 'equipmentType', 'origin', 'destination', 'rate'];
const REQUIRED_MSG = 'This field is required.';
const OVERWEIGHT_MSG = 'Acknowledge the overweight permit requirement.';
const FIELD_LABELS = {
  title: 'Title', commodityCategory: 'Commodity category', commodityType: 'Commodity type', weight: 'Weight',
  equipmentType: 'Equipment type', origin: 'Pickup city', pickupWindowStart: 'Pickup time', pickupWindowEnd: 'Pickup end',
  destination: 'Delivery city', deliveryWindowStart: 'Delivery time', deliveryWindowEnd: 'Delivery end', rate: 'Rate',
  currency: 'Currency', paymentTerms: 'Payment terms', termsAccepted: 'Terms', overweightAcknowledged: 'Overweight acknowledgement',
};

const EQUIPMENT_SUBTYPES = {
  Reefer:    [{ value: 'multi_temp', label: 'Multi-Temp' }, { value: 'frozen', label: 'Frozen' }, { value: 'produce', label: 'Produce' }],
  Flatbed:   [{ value: 'tarp', label: 'Tarp' }, { value: 'chains', label: 'Chains' }, { value: 'conestoga', label: 'Conestoga' }, { value: 'step_deck', label: 'Step Deck' }, { value: 'oversize', label: 'Oversize' }],
  'Dry Van': [{ value: 'power_only', label: 'Power Only' }, { value: 'drop_hook', label: 'Drop & Hook' }],
};
const GENERIC_SUBTYPES = [{ value: 'standard', label: 'Standard' }, { value: 'expedited', label: 'Expedited' }, { value: 'team', label: 'Team' }];

const REQUIRED_ENDORSEMENT_OPTIONS = [
  { value: 'hazmat',          label: 'Hazmat' },
  { value: 'tanker',          label: 'Tanker' },
  { value: 'doubles_triples', label: 'Doubles/Triples' },
];

export default function ShipperPostLoad() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id: editId } = useParams(); // present on /dashboard/shipper/loads/:id/edit: the same form edits an open load
  const isEdit = Boolean(editId);
  const [editLoading, setEditLoading] = useState(isEdit);
  const [editBlock, setEditBlock] = useState(''); // why the load cannot be edited (not open, not ours, not found)
  const editBase = useRef(null); // the loaded load as the PUT body would carry it, to send only the changes
  const [newLoad, setNewLoad] = useState(initialLoad);
  // A saved draft may predate fields added since: lay it over the defaults so every array/string exists.
  const restoreForm = (d) => setNewLoad(Object.fromEntries(Object.entries(initialLoad).map(([k, v]) => {
    const x = d?.[k];
    return [k, Array.isArray(v) ? (Array.isArray(x) ? x : v) : (x == null ? v : x)];
  })));
  const [stepSummary, setStepSummary] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [openSnackbar, setOpenSnackbar] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [activeStep, setActiveStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false); // sync guard: state updates are async
  const paymentRef = useRef(null);

  // ── Auto-tender (new loads only): offer to my carriers one at a time ─────
  const [tenderMinutes, setTenderMinutes] = useState(30);
  const [tenderFallback, setTenderFallback] = useState('public');
  const [network, setNetwork] = useState(null); // null = not loaded yet
  const wantsTender = !isEdit && newLoad.loadVisibility === 'tender';
  useEffect(() => {
    if (!wantsTender || network) return;
    api.get('/preferred-carriers')
      .then(({ data }) => setNetwork(Array.isArray(data) ? data.filter((e) => e.isActive) : []))
      .catch(() => setNetwork([]));
  }, [wantsTender, network]);
  const tenderBlocked = wantsTender && network !== null && network.length === 0;

  // ── Draft Manager ────────────────────────────────────────────────────────
  // Editing uses its own draft slot so it never touches (or offers) the new-load draft.
  const { hasDraft, draftData, resumeDraft, discardDraft, clearDraft, showResumeDialog } = useDraftManager(isEdit ? `shipperEditLoad_${editId}` : 'shipperPostLoad', newLoad, restoreForm);

  // ── Edit mode: load the load and prefill the form ────────────────────────
  useEffect(() => {
    if (!isEdit) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/loads/${editId}`);
        if (cancelled) return;
        if (data.status !== 'open') { setEditBlock('This load can no longer be edited.'); return; }
        const { form, stops: loadedStops } = loadToForm(data);
        editBase.current = { api: formToApi(form, loadedStops, data.reefer), reefer: data.reefer, pickupLocal: form.pickupWindowStart, pickupEndLocal: form.pickupWindowEnd }; // reefer: keeps its other settings on save
        setNewLoad(form);
        setStops(loadedStops);
      } catch (err) {
        if (!cancelled) setEditBlock(err.response?.data?.error || 'Could not load this load.');
      } finally {
        if (!cancelled) setEditLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [editId, isEdit]);

  // ── Auto-title ───────────────────────────────────────────────────────────
  const [autoTitleEnabled, setAutoTitleEnabled] = useState(!isEdit); // an existing title is never regenerated
  const titleManuallyEdited = useRef(isEdit);

  useEffect(() => {
    if (!autoTitleEnabled || titleManuallyEdited.current) return;
    const parts = [];
    if (newLoad.equipmentType) parts.push(newLoad.equipmentType);
    if (newLoad.commodityType) parts.push(newLoad.commodityType);
    const originCity = newLoad.origin ? newLoad.origin.split(',')[0].trim() : '';
    const destCity = newLoad.destination ? newLoad.destination.split(',')[0].trim() : '';
    if (originCity && destCity) parts.push(`${originCity} → ${destCity}`);
    else if (originCity) parts.push(`from ${originCity}`);
    else if (destCity) parts.push(`to ${destCity}`);
    if (newLoad.weight) parts.push(`${Number(newLoad.weight).toLocaleString()} lbs`);
    // Only update title when at least one key field is filled; clear back to empty if none are
    setNewLoad(prev => ({ ...prev, title: parts.length > 0 ? parts.join(' | ') : '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newLoad.equipmentType, newLoad.commodityType, newLoad.origin, newLoad.destination, newLoad.weight, autoTitleEnabled]);

  // ── Rate suggestion ──────────────────────────────────────────────────────
  const [rateSuggestion, setRateSuggestion] = useState(null);
  const [rateLoading, setRateLoading] = useState(false);

  useEffect(() => {
    if (!newLoad.origin || !newLoad.destination || !newLoad.equipmentType) {
      setRateSuggestion(null);
      return;
    }
    const timer = setTimeout(async () => {
      setRateLoading(true);
      try {
        const { data } = await api.post('/bids/rate-suggestion-preview', {
          origin: newLoad.origin,
          destination: newLoad.destination,
          equipmentType: newLoad.equipmentType,
        });
        setRateSuggestion(data);
      } catch {
        setRateSuggestion(null);
      }
      setRateLoading(false);
    }, 800);
    return () => clearTimeout(timer);
  }, [newLoad.origin, newLoad.destination, newLoad.equipmentType]);

  // ── Auto-add hazmat endorsement when hazmat toggle is on ─────────────────
  useEffect(() => {
    setNewLoad((prev) => {
      const has = prev.requiredEndorsements.includes('hazmat');
      if (prev.hazardousMaterial && !has) {
        return { ...prev, requiredEndorsements: [...prev.requiredEndorsements, 'hazmat'] };
      }
      return prev;
    });
  }, [newLoad.hazardousMaterial]);

  // ── Reset subtype if equipment type changes away from a valid option ─────
  useEffect(() => {
    setNewLoad((prev) => {
      const opts = EQUIPMENT_SUBTYPES[prev.equipmentType] || (prev.equipmentType ? GENERIC_SUBTYPES : []);
      if (prev.equipmentSubtype && !opts.some((o) => o.value === prev.equipmentSubtype)) {
        return { ...prev, equipmentSubtype: '' };
      }
      return prev;
    });
  }, [newLoad.equipmentType]);

  // ── Multi-Stop state ─────────────────────────────────────────────────────
  const [stops, setStops] = useState([]);

  const addStop = () => {
    setStops(prev => [...prev, {
      sequence: prev.length + 1,
      type: 'delivery',
      address: '',
      timeWindowStart: '',
      timeWindowEnd: '',
      contactName: '',
      contactPhone: '',
      notes: '',
    }]);
  };

  const updateStop = (index, field, value) => {
    setStops(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  };

  const removeStop = (index) => {
    setStops(prev => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, sequence: i + 1 })));
  };

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleChange = (field, value, maxLen) => {
    setNewLoad((prev) => ({
      ...prev,
      [field]: typeof maxLen === "number" ? String(value).slice(0, maxLen) : value,
    }));
    setFieldErrors((fe) => ({ ...fe, [field]: false }));
  };

  // ── Validation ───────────────────────────────────────────────────────────
  const requiredFields = isEdit ? EDIT_REQUIRED : [
    "title", "commodityType", "commodityCategory", "weight",
    "equipmentType", "origin", "pickupWindowStart",
    "destination", "deliveryWindowStart",
    "rate", "currency", "paymentTerms", "termsAccepted",
  ];

  // Same rules as the server (utils/windowValidation): pickup not already over, ends not before starts, delivery not before pickup.
  const dateProblems = () => {
    const e = {};
    const ms = (v) => (v ? new Date(v).getTime() : NaN);
    const ps = ms(newLoad.pickupWindowStart), pe = ms(newLoad.pickupWindowEnd);
    const ds = ms(newLoad.deliveryWindowStart), de = ms(newLoad.deliveryWindowEnd);
    const pickupUnchanged = isEdit && newLoad.pickupWindowStart === editBase.current?.pickupLocal && newLoad.pickupWindowEnd === editBase.current?.pickupEndLocal;
    const pLast = Number.isNaN(pe) ? ps : pe;
    if (!Number.isNaN(pLast) && !pickupUnchanged && pLast < Date.now() - 60 * 60 * 1000) e.pickupWindowStart = 'The pickup time is in the past.';
    if (!Number.isNaN(ps) && !Number.isNaN(pe) && pe < ps) e.pickupWindowEnd = 'Pickup end cannot be before pickup start.';
    if (!Number.isNaN(ds) && !Number.isNaN(de) && de < ds) e.deliveryWindowEnd = 'Delivery end cannot be before delivery start.';
    const dLast = Number.isNaN(de) ? ds : de;
    if (!Number.isNaN(ps) && !Number.isNaN(dLast) && dLast < ps) e.deliveryWindowStart = 'Delivery cannot be before pickup.';
    return e;
  };

  // Show the problems: red helper text per field, a summary by the buttons, and focus on the first bad field.
  const reportErrors = (errors, merge) => {
    setFieldErrors((prev) => (merge ? { ...prev, ...errors } : errors));
    const keys = Object.keys(errors);
    if (!keys.length) return;
    setStepSummary(`Fix ${keys.length} field${keys.length === 1 ? '' : 's'} to continue: ${keys.map((k) => FIELD_LABELS[k] || k).join(', ')}`);
    setTimeout(() => {
      const el = document.querySelector('form [aria-invalid="true"], form .Mui-error');
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus?.({ preventScroll: true });
    }, 60);
  };

  const validateFields = () => {
    let errors = {};
    requiredFields.forEach((k) => {
      if (!newLoad[k]) errors[k] = REQUIRED_MSG;
    });
    Object.assign(errors, dateProblems());
    // Block submission when overweight and not acknowledged
    if (newLoad.weight && newLoad.equipmentType) {
      const maxLbs = EQUIPMENT_WEIGHT_LIMITS[newLoad.equipmentType];
      if (maxLbs && Number(newLoad.weight) > maxLbs && !newLoad.overweightAcknowledged) {
        errors["overweightAcknowledged"] = OVERWEIGHT_MSG;
      }
    }
    reportErrors(errors, false);
    return Object.keys(errors).length === 0;
  };

  // ── Wizard ───────────────────────────────────────────────────────────────
  const STEP_LABELS = ['Load Basics', 'Route & Schedule', 'Pricing, Docs & Review'];

  // Required fields per step (subset of requiredFields). Step 3 is gated by the
  // full validateFields() in handleSubmit, so it has no separate "Next".
  const STEP_REQUIRED = [
    // Step 1 — Load Basics
    ['title', 'commodityCategory', 'commodityType', 'weight', 'equipmentType'],
    // Step 2 — Route & Schedule
    ['origin', 'pickupWindowStart', 'destination', 'deliveryWindowStart'],
  ];

  const validateStep = (step) => {
    let errors = {};
    (STEP_REQUIRED[step] || []).filter((k) => !isEdit || EDIT_REQUIRED.includes(k)).forEach((k) => {
      if (!newLoad[k]) errors[k] = REQUIRED_MSG;
    });
    // Step 1: block advancing while overweight is not acknowledged
    if (step === 0 && newLoad.weight && newLoad.equipmentType) {
      const maxLbs = EQUIPMENT_WEIGHT_LIMITS[newLoad.equipmentType];
      if (maxLbs && Number(newLoad.weight) > maxLbs && !newLoad.overweightAcknowledged) {
        errors["overweightAcknowledged"] = OVERWEIGHT_MSG;
      }
    }
    if (step === 1) Object.assign(errors, dateProblems());
    reportErrors(errors, true);
    return Object.keys(errors).length === 0;
  };

  const handleNext = () => {
    if (!validateStep(activeStep)) {
      const maxLbs = EQUIPMENT_WEIGHT_LIMITS[newLoad.equipmentType];
      const isOverweightBlocked = activeStep === 0 && maxLbs &&
        Number(newLoad.weight) > maxLbs && !newLoad.overweightAcknowledged;
      setError(isOverweightBlocked
        ? "This load exceeds the weight limit. Please acknowledge the overweight permit requirement before continuing."
        : "Please fill all required fields on this step before continuing.");
      setOpenSnackbar(true);
      return;
    }
    setStepSummary('');
    setActiveStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  };

  const handleBack = () => { setStepSummary(''); setActiveStep((s) => Math.max(s - 1, 0)); };

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    setSubmitError('');
    if (tenderBlocked || (wantsTender && network === null)) {
      setError('Add carriers to My Carriers first, or choose a different visibility.');
      setOpenSnackbar(true);
      return;
    }
    if (!validateFields()) {
      // Check overweight specifically for a targeted error message
      const maxLbs = EQUIPMENT_WEIGHT_LIMITS[newLoad.equipmentType];
      const isOverweightBlocked = maxLbs && Number(newLoad.weight) > maxLbs && !newLoad.overweightAcknowledged;
      // Jump back to the first step that has a missing/invalid field so the
      // shipper can see the highlighted error indicators.
      if (!validateStep(0)) setActiveStep(0);
      else if (!validateStep(1)) setActiveStep(1);
      setError(isOverweightBlocked
        ? "This load exceeds the weight limit. Please acknowledge the overweight permit requirement before posting."
        : "Please fill all required fields correctly.");
      setOpenSnackbar(true);
      if (!newLoad.paymentTerms) {
        setTimeout(() => paymentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
      }
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      if (isEdit) {
        // Same JSON the server validates for posting, but only the fields that changed.
        const changes = diffApi(formToApi(newLoad, stops, editBase.current?.reefer), editBase.current?.api || {});
        if (Object.keys(changes).length === 0) {
          navigate('/dashboard/shipper/loads', { state: { flash: 'No changes to save.' } });
          return;
        }
        const { data } = await api.put(`/loads/${editId}`, changes);
        clearDraft();
        queryClient.invalidateQueries({ queryKey: ['loads'] }); // the board shows the new values
        const notes = ['Load updated.'];
        if (data.voidedBids) notes.push(`${data.voidedBids} open bid${data.voidedBids === 1 ? ' was' : 's were'} withdrawn and the carrier${data.voidedBids === 1 ? ' was' : 's were'} asked to bid again.`);
        if (data.needsLocation) notes.push("We still couldn't find a location, so carriers can't see this load yet.");
        navigate('/dashboard/shipper/loads', { state: { flash: notes.join(' ') } });
        return;
      }

      const token = localStorage.getItem("token");

      // Resolve insurance: if "custom", use the custom amount
      const resolvedInsurance = newLoad.insuranceRequired === 'custom'
        ? newLoad.customInsuranceAmount
        : newLoad.insuranceRequired;

      const headers = { "Authorization": `Bearer ${token}` };
      {
        const payload = {
          ...newLoad,
          insuranceRequired: resolvedInsurance || undefined,
          stops: stops.length > 0 ? stops.map(s => ({
            sequence: s.sequence,
            type: s.type,
            address: s.address,
            timeWindow: s.timeWindowStart ? { start: s.timeWindowStart, end: s.timeWindowEnd || undefined } : undefined,
            contactName: s.contactName || undefined,
            contactPhone: s.contactPhone || undefined,
            notes: s.notes || undefined,
          })) : undefined,
        };
        // Remove fields not needed by backend
        delete payload.customInsuranceAmount;
        delete payload.termsAccepted;
        if (wantsTender) {
          // The server sets loadVisibility to 'tender' itself.
          delete payload.loadVisibility;
          payload.tender = { responseMinutes: tenderMinutes, fallback: tenderFallback };
        }
        await api.post("/loads", payload, { headers });
      }
      clearDraft();
      navigate("/dashboard/shipper/loads");
    } catch (err) {
      const d = err.response?.data;
      const msg = d?.error
        || (Array.isArray(d?.errors) && d.errors.map((x) => x.msg).filter(Boolean).join(' '))
        || (isEdit ? "Failed to save changes. Please check all fields and try again." : "Failed to post load. Please check all fields and try again.");
      // Server names the bad city: return to the step with that field and mark it.
      const lower = msg.toLowerCase();
      const bad = {};
      if (lower.includes('pickup') || lower.includes('origin')) bad.origin = true;
      if (lower.includes('delivery') || lower.includes('destination')) bad.destination = true;
      if (Object.keys(bad).length) {
        setFieldErrors((fe) => ({ ...fe, ...bad }));
        setActiveStep(1);
      }
      setError(msg);
      setSubmitError(msg);
      setOpenSnackbar(true);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  // ── UI Helpers ───────────────────────────────────────────────────────────
  const SectionHeader = ({ icon, label }) => (
    <Box sx={{ display: "flex", alignItems: "center", mb: 2, mt: 4 }}>
      {icon}
      <Typography variant="h6" fontWeight={800} color="#fff" ml={1.5} letterSpacing={1}>
        {label}
      </Typography>
      <Divider sx={{ flex: 1, ml: 2, borderColor: "rgba(255,255,255,0.12)" }} />
    </Box>
  );

  const limits = {
    title: 100,
    weight: 8,
    specialInstructions: 300,
    notes: 500,
    pickupFacilityName: 80,
    pickupAddress: 100,
    pickupContactName: 60,
    pickupContactPhone: 30,
    deliveryFacilityName: 80,
    deliveryAddress: 100,
    deliveryContactName: 60,
    deliveryContactPhone: 30,
    poNumber: 40,
    shipperReferenceNumber: 40,
    consigneeReference: 40,
    cargoValue: 12,
    customInsuranceAmount: 12,
    dangerousGoodsUN: 20,
    temperatureMin: 8,
    temperatureMax: 8,
    carrierInstructions: 300,
    loadLength: 6,
    loadWidth: 6,
    loadHeight: 6,
  };

  const showDimensionsProminent = DIMENSION_PROMINENT_TYPES.includes(newLoad.equipmentType);
  const isReefer = newLoad.equipmentType === 'Reefer';
  const subtypeOptions = EQUIPMENT_SUBTYPES[newLoad.equipmentType] || (newLoad.equipmentType ? GENERIC_SUBTYPES : []);

  // ── Dimension fields helper ──────────────────────────────────────────────
  const DimensionFields = () => (
    <>
      <Grid item xs={4} sm={2}>
        <TextField
          label="Length (ft)"
          type="number"
          fullWidth
          value={newLoad.loadLength}
          onChange={e => handleChange("loadLength", e.target.value, limits.loadLength)}
          inputProps={{ min: 0 }}
          helperText={showDimensionsProminent ? "Required for this trailer" : "Optional"}
        />
      </Grid>
      <Grid item xs={4} sm={2}>
        <TextField
          label="Width (ft)"
          type="number"
          fullWidth
          value={newLoad.loadWidth}
          onChange={e => handleChange("loadWidth", e.target.value, limits.loadWidth)}
          inputProps={{ min: 0 }}
        />
      </Grid>
      <Grid item xs={4} sm={2}>
        <TextField
          label="Height (ft)"
          type="number"
          fullWidth
          value={newLoad.loadHeight}
          onChange={e => handleChange("loadHeight", e.target.value, limits.loadHeight)}
          inputProps={{ min: 0 }}
        />
      </Grid>
    </>
  );

  if (isEdit && (editLoading || editBlock)) {
    return (
      <Paper sx={{ p: 4, maxWidth: 880, mx: "auto", textAlign: "center" }}>
        {editLoading ? <CircularProgress /> : (
          <>
            <Alert severity="warning" sx={{ mb: 2, textAlign: "left" }}>{editBlock}</Alert>
            <Button variant="contained" onClick={() => navigate('/dashboard/shipper/loads')}>Back to my loads</Button>
          </>
        )}
      </Paper>
    );
  }

  return (
    <Paper
      sx={{
        p: { xs: 2, md: 4 },
        borderRadius: 5,
        boxShadow: "0 8px 32px #32159e55",
        background: "linear-gradient(120deg,#1f2dff 0%,#6a1fcf 40%,#e1129a 100%)",
        color: "#fff",
        backdropFilter: "blur(18px)",
        maxWidth: 880,
        mx: "auto",
        border: "2.2px solid rgba(255,255,255,0.10)",
        "& .MuiInputBase-root": {
          bgcolor: "rgba(255,255,255,0.11)",
          color: "#fff",
          borderRadius: 2,
          fontWeight: 600,
          boxShadow: "0 1px 7px #1f2dff11"
        },
        "& .MuiFormLabel-root": { color: "#e4e2f7" },
        "& .MuiInputLabel-root": { color: "#e4e2f7" },
        "& .MuiOutlinedInput-notchedOutline": {
          borderColor: "rgba(255,255,255,0.17)"
        },
        "& .Mui-focused .MuiOutlinedInput-notchedOutline": {
          borderColor: "#a48bf7"
        },
        "& .Mui-error .MuiOutlinedInput-notchedOutline": {
          borderColor: "#fca5a5"
        },
        "& .MuiFormHelperText-root.Mui-error, & .MuiInputLabel-root.Mui-error, & .MuiFormLabel-asterisk.Mui-error": {
          color: "#fecaca"
        }
      }}
    >
      {!isEdit && <DraftResumeDialog open={showResumeDialog && hasDraft} draft={draftData} onResume={resumeDraft} onDiscard={discardDraft} />}

      <Typography variant="h4" fontWeight={900} color="#fff" mb={isEdit ? 2 : 4} align="center" letterSpacing={1.4}
        sx={{ textShadow: "0 2px 16px #6a1fcf66" }}>
        {isEdit ? 'Edit load' : 'Post a New Load'}
      </Typography>
      {isEdit && (
        <Alert severity="info" sx={{ mb: 3 }}>
          Changing the route, rate, equipment, weight, dates, stops or commodity withdraws any open bids; those carriers are told to review the new terms and bid again.
        </Alert>
      )}

      {/* ── Wizard progress ─────────────────────────────────────────────── */}
      <Stepper
        activeStep={activeStep}
        alternativeLabel
        sx={{
          mb: 4,
          "& .MuiStepLabel-label": { color: "rgba(255,255,255,0.55)", fontWeight: 600 },
          "& .MuiStepLabel-label.Mui-active": { color: "#fff", fontWeight: 800 },
          "& .MuiStepLabel-label.Mui-completed": { color: "rgba(255,255,255,0.85)" },
          "& .MuiStepIcon-root": { color: "rgba(255,255,255,0.25)" },
          "& .MuiStepIcon-root.Mui-active": { color: "#22d3ee" },
          "& .MuiStepIcon-root.Mui-completed": { color: "#34d399" },
          "& .MuiStepConnector-line": { borderColor: "rgba(255,255,255,0.18)" },
        }}
      >
        {STEP_LABELS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      <Box component="form" onSubmit={handleSubmit}>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 1 — LOAD BASICS                                               */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {activeStep === 0 && (
        <Box>
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* 1. LOAD DETAILS                                                    */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <SectionHeader icon={<AssignmentOutlinedIcon fontSize="large" sx={{ color: "#22d3ee" }} />} label="Load Details" />
        <Grid container spacing={2} sx={{ mb: 2 }}>
          {/* Title with auto-generate toggle */}
          <Grid item xs={12} sm={6}>
            <TextField
              label="Title"
              required
              fullWidth
              value={newLoad.title}
              onChange={e => {
                if (autoTitleEnabled) {
                  setAutoTitleEnabled(false);
                  titleManuallyEdited.current = true;
                }
                handleChange("title", e.target.value, limits.title);
              }}
              inputProps={{ maxLength: limits.title }}
              placeholder={autoTitleEnabled ? 'e.g. Flatbed | Fertilizer | Dallas → NYC | 41,000 lbs' : ''}
              error={!!fieldErrors.title}
              helperText={fieldErrors.title ? fieldErrors.title : (
                <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {autoTitleEnabled
                    ? <><AutoFixHighIcon sx={{ fontSize: 14, color: '#22d3ee' }} /> Auto-fills as you select Equipment, Cities & Weight</>
                    : `${newLoad.title.length}/${limits.title}`
                  }
                </Box>
              )}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <Box sx={{ display: 'flex', alignItems: 'center', height: '100%', pt: 1 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={autoTitleEnabled}
                    onChange={e => {
                      setAutoTitleEnabled(e.target.checked);
                      if (e.target.checked) titleManuallyEdited.current = false;
                    }}
                    size="small"
                    sx={{
                      '& .MuiSwitch-switchBase': { color: '#fff' },
                      '& .MuiSwitch-track': { bgcolor: 'rgba(255,255,255,0.45)', opacity: 1, border: '1px solid rgba(255,255,255,0.7)' },
                      '& .Mui-checked + .MuiSwitch-track': { bgcolor: '#22d3ee', opacity: 1 },
                    }}
                  />
                }
                label={<Typography variant="body2" color="rgba(255,255,255,0.7)">Auto-generate title</Typography>}
              />
            </Box>
          </Grid>

          {/* Commodity Category (dropdown) */}
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth error={!!fieldErrors.commodityCategory}>
              <InputLabel required>Commodity Category</InputLabel>
              <Select
                required
                value={newLoad.commodityCategory}
                label="Commodity Category"
                onChange={e => {
                  handleChange("commodityCategory", e.target.value);
                  handleChange("commodityType", "");
                }}
              >
                <MenuItem value="">Select</MenuItem>
                {COMMODITY_CATEGORIES.map(cat => (
                  <MenuItem value={cat} key={cat}>{cat}</MenuItem>
                ))}
              </Select>
              {fieldErrors.commodityCategory && <FormHelperText>{fieldErrors.commodityCategory}</FormHelperText>}
            </FormControl>
          </Grid>

          {/* Commodity Type (cascading dropdown) */}
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth error={!!fieldErrors.commodityType}>
              <InputLabel required>Commodity Type</InputLabel>
              <Select
                required
                value={newLoad.commodityType}
                label="Commodity Type"
                onChange={e => handleChange("commodityType", e.target.value)}
                disabled={!newLoad.commodityCategory}
              >
                <MenuItem value="">Select</MenuItem>
                {(COMMODITY_TYPES_BY_CATEGORY[newLoad.commodityCategory] || []).map(ct => (
                  <MenuItem value={ct} key={ct}>{ct}</MenuItem>
                ))}
              </Select>
              {fieldErrors.commodityType && <FormHelperText>{fieldErrors.commodityType}</FormHelperText>}
            </FormControl>
          </Grid>

          {/* Weight */}
          <Grid item xs={12} sm={6}>
            <TextField
              label="Weight (lbs)"
              required
              type="number"
              fullWidth
              value={newLoad.weight}
              onChange={e => handleChange("weight", e.target.value, limits.weight)}
              inputProps={{ min: 0 }}
              error={!!fieldErrors.weight} helperText={fieldErrors.weight || undefined}
            />
            {/* Weight overload warning + acknowledgment gate */}
            {newLoad.weight && newLoad.equipmentType && (() => {
              const maxLbs = EQUIPMENT_WEIGHT_LIMITS[newLoad.equipmentType];
              const w = Number(newLoad.weight);
              if (!maxLbs || !w) return null;
              const pct = Math.round((w / maxLbs) * 100);
              if (w > maxLbs) {
                return (
                  <Box sx={{ mt: 1 }}>
                    <Alert severity="error" variant="outlined"
                      icon={<WarningAmberIcon sx={{ color: '#ef4444' }} />}
                      sx={{ bgcolor: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.4)', color: '#fff',
                        '& .MuiAlert-message': { color: '#fff' } }}>
                      <Typography variant="body2" fontWeight={700} color="#ef4444">
                        Overweight! {w.toLocaleString()} lbs exceeds the {newLoad.equipmentType} limit of {maxLbs.toLocaleString()} lbs by {(w - maxLbs).toLocaleString()} lbs
                      </Typography>
                      <Typography variant="caption" color="rgba(255,255,255,0.7)" display="block" mb={1}>
                        Federal GVW limit is 80,000 lbs. Without an overweight permit, drivers will be turned away at weigh stations.
                      </Typography>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={newLoad.overweightAcknowledged}
                            onChange={e => handleChange("overweightAcknowledged", e.target.checked)}
                            size="small"
                            sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#ef4444' },
                              '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#ef4444' } }}
                          />
                        }
                        label={
                          <Typography variant="body2" color="#fff" fontWeight={600}>
                            I confirm this load has or will have an overweight/oversize permit
                          </Typography>
                        }
                      />
                      <Collapse in={newLoad.overweightAcknowledged}>
                        <TextField
                          label="Permit Number (optional)"
                          fullWidth
                          size="small"
                          value={newLoad.overweightPermitNumber}
                          onChange={e => handleChange("overweightPermitNumber", e.target.value, 40)}
                          inputProps={{ maxLength: 40 }}
                          placeholder="e.g. OW-2026-TX-12345"
                          sx={{ mt: 1 }}
                          helperText="Carriers will see this load tagged as 'Overweight — Permit Required'"
                        />
                      </Collapse>
                    </Alert>
                  </Box>
                );
              }
              if (pct >= 90) {
                return (
                  <Alert severity="warning" variant="outlined"
                    sx={{ mt: 1, bgcolor: 'rgba(251,191,36,0.08)', borderColor: 'rgba(251,191,36,0.3)', color: '#fff',
                      '& .MuiAlert-message': { color: '#fff' } }}>
                    <Typography variant="body2" fontWeight={600} color="#fbbf24">
                      Near capacity: {pct}% of {newLoad.equipmentType} max ({maxLbs.toLocaleString()} lbs)
                    </Typography>
                    <Typography variant="caption" color="rgba(255,255,255,0.6)">
                      Close to legal limit. Actual capacity may vary by truck tare weight.
                    </Typography>
                  </Alert>
                );
              }
              return null;
            })()}
          </Grid>
        </Grid>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* 5. CARGO & EQUIPMENT                                               */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <SectionHeader icon={<LocalShippingIcon fontSize="large" sx={{ color: "#fbbf24" }} />} label="Cargo & Equipment" />
        <Grid container spacing={2} sx={{ mb: 2 }}>
          {/* Equipment Type (expanded dropdown) */}
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth error={!!fieldErrors.equipmentType}>
              <InputLabel required>Equipment Type</InputLabel>
              <Select
                required
                value={newLoad.equipmentType}
                label="Equipment Type"
                onChange={e => handleChange("equipmentType", e.target.value)}
              >
                <MenuItem value="">Select</MenuItem>
                {EQUIPMENT_TYPES.map(eq => (
                  <MenuItem value={eq} key={eq}>{eq}</MenuItem>
                ))}
              </Select>
              {fieldErrors.equipmentType && <FormHelperText>{fieldErrors.equipmentType}</FormHelperText>}
            </FormControl>
          </Grid>

          {/* Equipment Subtype (conditional on equipment type) */}
          {subtypeOptions.length > 0 && (
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Equipment Subtype</InputLabel>
                <Select
                  value={newLoad.equipmentSubtype}
                  label="Equipment Subtype"
                  onChange={e => handleChange("equipmentSubtype", e.target.value)}
                >
                  <MenuItem value="">None</MenuItem>
                  {subtypeOptions.map(s => (
                    <MenuItem value={s.value} key={s.value}>{s.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}

          {/* Required Endorsements (multi-select) */}
          <Grid item xs={12} sm={6}>
            <Autocomplete
              multiple
              options={REQUIRED_ENDORSEMENT_OPTIONS}
              getOptionLabel={(o) => o.label}
              isOptionEqualToValue={(o, v) => o.value === v.value}
              value={REQUIRED_ENDORSEMENT_OPTIONS.filter(o => newLoad.requiredEndorsements.includes(o.value))}
              onChange={(_, val) => handleChange("requiredEndorsements", val.map(v => v.value))}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip {...getTagProps({ index })} key={option.value} label={option.label} size="small"
                    sx={{ bgcolor: 'rgba(255,255,255,0.15)', color: '#fff' }} />
                ))
              }
              renderInput={(params) => (
                <TextField {...params} label="Required Endorsements" placeholder="Driver CDL endorsements..." />
              )}
            />
          </Grid>

          {/* Dimensions — shown prominently for flatbed/step deck/etc */}
          {showDimensionsProminent && <DimensionFields />}

          {/* Special Handling (multi-select chips) */}
          <Grid item xs={12} sm={6}>
            <Autocomplete
              multiple
              options={SPECIAL_HANDLING_OPTIONS}
              value={newLoad.specialHandling}
              onChange={(_, val) => handleChange("specialHandling", val)}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip {...getTagProps({ index })} key={option} label={option} size="small"
                    sx={{ bgcolor: 'rgba(255,255,255,0.15)', color: '#fff' }} />
                ))
              }
              renderInput={(params) => (
                <TextField {...params} label="Special Handling" placeholder="Select requirements..." />
              )}
            />
          </Grid>

          {/* Special Instructions (free text — intentionally kept) */}
          <Grid item xs={12}>
            <TextField
              label="Special Instructions"
              fullWidth
              multiline
              minRows={2}
              value={newLoad.specialInstructions}
              onChange={e => handleChange("specialInstructions", e.target.value, limits.specialInstructions)}
              inputProps={{ maxLength: limits.specialInstructions }}
              helperText={`Optional. ${newLoad.specialInstructions.length}/${limits.specialInstructions}`}
            />
          </Grid>
        </Grid>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* 5a. REEFER SETTINGS (conditional)                                  */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Collapse in={isReefer}>
          <SectionHeader icon={<AcUnitIcon fontSize="large" sx={{ color: "#38bdf8" }} />} label="Reefer / Temperature Control" />
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Temperature Min"
                type="number"
                fullWidth
                value={newLoad.temperatureMin}
                onChange={e => handleChange("temperatureMin", e.target.value, limits.temperatureMin)}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                label="Temperature Max"
                type="number"
                fullWidth
                value={newLoad.temperatureMax}
                onChange={e => handleChange("temperatureMax", e.target.value, limits.temperatureMax)}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormControl fullWidth>
                <InputLabel>Temperature Unit</InputLabel>
                <Select value={newLoad.temperatureUnit} label="Temperature Unit"
                  onChange={e => handleChange("temperatureUnit", e.target.value)}>
                  <MenuItem value="F">Fahrenheit (&deg;F)</MenuItem>
                  <MenuItem value="C">Celsius (&deg;C)</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </Collapse>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* 5b. HAZMAT (conditional)                                           */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Box sx={{ mt: 1, mb: 2 }}>
          <FormControlLabel
            control={
              <Switch
                checked={newLoad.hazardousMaterial}
                onChange={e => handleChange("hazardousMaterial", e.target.checked)}
              />
            }
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <WarningAmberIcon sx={{ color: '#fbbf24', fontSize: 20 }} />
                <Typography color="#fff">Hazardous Material</Typography>
              </Box>
            }
          />
        </Box>
        <Collapse in={newLoad.hazardousMaterial}>
          <Box sx={{ p: 2, mb: 2, borderRadius: 3, bgcolor: 'rgba(251,191,36,0.08)', border: '1.5px solid rgba(251,191,36,0.25)' }}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth>
                  <InputLabel>Hazard Class</InputLabel>
                  <Select value={newLoad.hazmatClass} label="Hazard Class"
                    onChange={e => handleChange("hazmatClass", e.target.value)}>
                    <MenuItem value="">Select</MenuItem>
                    {HAZMAT_CLASSES.map(h => (
                      <MenuItem value={h.value} key={h.value}>{h.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth>
                  <InputLabel>Packing Group</InputLabel>
                  <Select value={newLoad.hazmatPackingGroup} label="Packing Group"
                    onChange={e => handleChange("hazmatPackingGroup", e.target.value)}>
                    <MenuItem value="">Select</MenuItem>
                    {HAZMAT_PACKING_GROUPS.map(p => (
                      <MenuItem value={p.value} key={p.value}>{p.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField
                  label="UN Number"
                  fullWidth
                  value={newLoad.dangerousGoodsUN}
                  onChange={e => handleChange("dangerousGoodsUN", e.target.value, limits.dangerousGoodsUN)}
                  inputProps={{ maxLength: limits.dangerousGoodsUN }}
                  placeholder="e.g. UN1203"
                />
              </Grid>
            </Grid>
          </Box>
        </Collapse>
        </Box>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 2 — ROUTE & SCHEDULE                                          */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {activeStep === 1 && (
        <Box>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* 2. PICKUP LOCATION                                                 */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <SectionHeader icon={<PlaceIcon fontSize="large" sx={{ color: "#22d3ee" }} />} label="Pickup Location" />
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} sm={6}>
            <Autocomplete
              freeSolo
              options={cities}
              getOptionLabel={opt => (typeof opt === "string" ? opt : opt.label)}
              value={newLoad.origin || ""}
              inputValue={newLoad.origin || ""}
              onInputChange={(_, val) => handleChange("origin", val)}
              renderInput={params =>
                <TextField {...params} label="Pickup City" required error={!!fieldErrors.origin} helperText={fieldErrors.origin || "Pick a suggestion or type City, ST (e.g. Austin, TX)"} />
              }
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Pickup Window Start"
              required
              type="datetime-local"
              fullWidth
              InputLabelProps={{ shrink: true }}
              value={newLoad.pickupWindowStart}
              onChange={e => handleChange("pickupWindowStart", e.target.value)}
              error={!!fieldErrors.pickupWindowStart} helperText={fieldErrors.pickupWindowStart || undefined}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Pickup Window End"
              type="datetime-local"
              fullWidth
              InputLabelProps={{ shrink: true }}
              value={newLoad.pickupWindowEnd}
              onChange={e => handleChange("pickupWindowEnd", e.target.value)}
              error={!!fieldErrors.pickupWindowEnd}
              helperText={fieldErrors.pickupWindowEnd || "Optional"}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Pickup Facility Name"
              fullWidth
              value={newLoad.pickupFacilityName}
              onChange={e => handleChange("pickupFacilityName", e.target.value, limits.pickupFacilityName)}
              inputProps={{ maxLength: limits.pickupFacilityName }}
              helperText="Optional. Can add after booking."
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Pickup Address"
              fullWidth
              value={newLoad.pickupAddress}
              onChange={e => handleChange("pickupAddress", e.target.value, limits.pickupAddress)}
              inputProps={{ maxLength: limits.pickupAddress }}
              helperText="Optional. Can add after booking."
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Pickup Contact Name"
              fullWidth
              value={newLoad.pickupContactName}
              onChange={e => handleChange("pickupContactName", e.target.value, limits.pickupContactName)}
              inputProps={{ maxLength: limits.pickupContactName }}
              helperText="Optional"
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Pickup Contact Phone"
              fullWidth
              value={newLoad.pickupContactPhone}
              onChange={e => handleChange("pickupContactPhone", e.target.value, limits.pickupContactPhone)}
              inputProps={{ maxLength: limits.pickupContactPhone }}
              helperText="Optional"
            />
          </Grid>
        </Grid>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* 3. DELIVERY LOCATION                                               */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <SectionHeader icon={<PlaceIcon fontSize="large" sx={{ color: "#a78bfa" }} />} label="Delivery Location" />
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} sm={6}>
            <Autocomplete
              freeSolo
              options={cities}
              getOptionLabel={opt => (typeof opt === "string" ? opt : opt.label)}
              value={newLoad.destination || ""}
              inputValue={newLoad.destination || ""}
              onInputChange={(_, val) => handleChange("destination", val)}
              renderInput={params =>
                <TextField {...params} label="Delivery City" required error={!!fieldErrors.destination} helperText={fieldErrors.destination || "Pick a suggestion or type City, ST (e.g. Austin, TX)"} />
              }
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Delivery Facility Name"
              fullWidth
              value={newLoad.deliveryFacilityName}
              onChange={e => handleChange("deliveryFacilityName", e.target.value, limits.deliveryFacilityName)}
              inputProps={{ maxLength: limits.deliveryFacilityName }}
              error={!!fieldErrors.deliveryFacilityName} helperText={fieldErrors.deliveryFacilityName || "Optional"}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Delivery Address"
              fullWidth
              value={newLoad.deliveryAddress}
              onChange={e => handleChange("deliveryAddress", e.target.value, limits.deliveryAddress)}
              inputProps={{ maxLength: limits.deliveryAddress }}
              error={!!fieldErrors.deliveryAddress} helperText={fieldErrors.deliveryAddress || "Optional"}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Delivery Contact Name"
              fullWidth
              value={newLoad.deliveryContactName}
              onChange={e => handleChange("deliveryContactName", e.target.value, limits.deliveryContactName)}
              inputProps={{ maxLength: limits.deliveryContactName }}
              error={!!fieldErrors.deliveryContactName} helperText={fieldErrors.deliveryContactName || "Optional"}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Delivery Contact Phone"
              fullWidth
              value={newLoad.deliveryContactPhone}
              onChange={e => handleChange("deliveryContactPhone", e.target.value, limits.deliveryContactPhone)}
              inputProps={{ maxLength: limits.deliveryContactPhone }}
              error={!!fieldErrors.deliveryContactPhone} helperText={fieldErrors.deliveryContactPhone || "Optional"}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Delivery Window Start"
              required
              type="datetime-local"
              fullWidth
              InputLabelProps={{ shrink: true }}
              value={newLoad.deliveryWindowStart}
              onChange={e => handleChange("deliveryWindowStart", e.target.value)}
              error={!!fieldErrors.deliveryWindowStart} helperText={fieldErrors.deliveryWindowStart || undefined}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Delivery Window End"
              type="datetime-local"
              fullWidth
              InputLabelProps={{ shrink: true }}
              value={newLoad.deliveryWindowEnd}
              onChange={e => handleChange("deliveryWindowEnd", e.target.value)}
              error={!!fieldErrors.deliveryWindowEnd}
              helperText={fieldErrors.deliveryWindowEnd || "Optional"}
            />
          </Grid>
        </Grid>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* 4. INTERMEDIATE STOPS                                              */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <SectionHeader icon={<StopIcon fontSize="large" sx={{ color: "#fb923c" }} />} label="Intermediate Stops" />
        <Typography variant="body2" color="rgba(255,255,255,0.72)" mb={2}>
          Optional. Add pickup or delivery stops between the origin and final destination.
        </Typography>

        {stops.map((stop, idx) => (
          <Box
            key={idx}
            sx={{
              mb: 2, p: 2, borderRadius: 3,
              bgcolor: 'rgba(255,255,255,0.07)',
              border: '1.5px solid rgba(255,255,255,0.13)',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5, gap: 1 }}>
              <Typography fontWeight={700} color="#fb923c">Stop {stop.sequence}</Typography>
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <Select
                  value={stop.type}
                  onChange={e => updateStop(idx, 'type', e.target.value)}
                  sx={{ color: '#fff', '.MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.25)' } }}
                >
                  <MenuItem value="pickup">Pickup</MenuItem>
                  <MenuItem value="delivery">Delivery</MenuItem>
                </Select>
              </FormControl>
              <Box flex={1} />
              <IconButton size="small" onClick={() => removeStop(idx)} sx={{ color: '#f87171' }}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Box>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField label="Address" required fullWidth size="small" value={stop.address}
                  onChange={e => updateStop(idx, 'address', e.target.value)} placeholder="e.g. 123 Main St, Chicago, IL" />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField label="Time Window Start" type="datetime-local" fullWidth size="small"
                  InputLabelProps={{ shrink: true }} value={stop.timeWindowStart}
                  onChange={e => updateStop(idx, 'timeWindowStart', e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField label="Time Window End" type="datetime-local" fullWidth size="small"
                  InputLabelProps={{ shrink: true }} value={stop.timeWindowEnd}
                  onChange={e => updateStop(idx, 'timeWindowEnd', e.target.value)} helperText="Optional" />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField label="Contact Name" fullWidth size="small" value={stop.contactName}
                  onChange={e => updateStop(idx, 'contactName', e.target.value)} helperText="Optional" />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField label="Contact Phone" fullWidth size="small" value={stop.contactPhone}
                  onChange={e => updateStop(idx, 'contactPhone', e.target.value)} helperText="Optional" />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField label="Notes" fullWidth size="small" value={stop.notes}
                  onChange={e => updateStop(idx, 'notes', e.target.value)} helperText="Optional" />
              </Grid>
            </Grid>
          </Box>
        ))}

        <Button startIcon={<AddCircleOutlineIcon />} onClick={addStop} variant="outlined"
          sx={{ mb: 3, color: '#fb923c', borderColor: 'rgba(251,146,60,0.5)',
            '&:hover': { borderColor: '#fb923c', bgcolor: 'rgba(251,146,60,0.08)' } }}
        >
          Add Intermediate Stop
        </Button>
        </Box>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* STEP 3 — PRICING, DOCS & REVIEW                                    */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {activeStep === 2 && (
        <Box>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* 6. RATE & PAYMENT                                                  */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <SectionHeader icon={<MonetizationOnIcon fontSize="large" sx={{ color: "#34d399" }} />} label="Rate & Payment" />
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} sm={4}>
            <TextField
              label="Rate ($)"
              required
              type="number"
              fullWidth
              value={newLoad.rate}
              onChange={e => handleChange("rate", e.target.value)}
              error={!!fieldErrors.rate} helperText={fieldErrors.rate || undefined}
              inputProps={{ min: 0 }}
            />
            {/* Rate Suggestion */}
            {rateLoading && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                <CircularProgress size={16} sx={{ color: '#34d399' }} />
                <Typography variant="caption" color="rgba(255,255,255,0.6)">
                  Calculating market rate...
                </Typography>
              </Box>
            )}
            {rateSuggestion?.suggested && !rateLoading && (
              <Box sx={{ mt: 1, p: 1.5, borderRadius: 2, bgcolor: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
                  <AutoFixHighIcon sx={{ fontSize: 16, color: '#34d399' }} />
                  <Typography variant="caption" color="#34d399" fontWeight={700}>
                    Market Rate: ${rateSuggestion.suggested.toLocaleString()}
                  </Typography>
                  <Typography variant="caption" color="rgba(255,255,255,0.5)">
                    (${rateSuggestion.min?.toLocaleString()} – ${rateSuggestion.max?.toLocaleString()})
                  </Typography>
                  <Tooltip title="Use this rate">
                    <Button
                      size="small"
                      sx={{ ml: 0.5, color: '#34d399', textDecoration: 'underline', p: 0, minWidth: 0, fontSize: '0.75rem' }}
                      onClick={() => handleChange("rate", String(rateSuggestion.suggested))}
                    >
                      Use
                    </Button>
                  </Tooltip>
                </Box>
                <Typography variant="caption" display="block" color="rgba(255,255,255,0.4)" mt={0.5}>
                  {rateSuggestion.basis} &middot; {rateSuggestion.confidence} confidence
                </Typography>
              </Box>
            )}
          </Grid>
          <Grid item xs={12} sm={4}>
            <FormControl fullWidth>
              <InputLabel>Currency</InputLabel>
              <Select value={newLoad.currency} label="Currency"
                onChange={e => handleChange("currency", e.target.value)}>
                <MenuItem value="USD">USD</MenuItem>
                <MenuItem value="CAD">CAD</MenuItem>
                <MenuItem value="EUR">EUR</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={4}>
            <FormControl fullWidth error={!!fieldErrors.paymentTerms} ref={paymentRef}>
              <InputLabel required>Payment Terms</InputLabel>
              <Select
                value={newLoad.paymentTerms}
                label="Payment Terms"
                onChange={e => handleChange("paymentTerms", e.target.value)}
              >
                <MenuItem value="">Select</MenuItem>
                {PAYMENT_TERMS.map(t => (
                  <MenuItem value={t} key={t}>{t}</MenuItem>
                ))}
              </Select>
              {fieldErrors.paymentTerms && <FormHelperText>{fieldErrors.paymentTerms}</FormHelperText>}
            </FormControl>
          </Grid>

          {/* Accessorials (multi-select chips) */}
          <Grid item xs={12}>
            <Autocomplete
              multiple
              options={ACCESSORIAL_OPTIONS}
              value={newLoad.accessorials}
              onChange={(_, val) => handleChange("accessorials", val)}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip {...getTagProps({ index })} key={option} label={option} size="small"
                    sx={{ bgcolor: 'rgba(52,211,153,0.15)', color: '#fff' }} />
                ))
              }
              renderInput={(params) => (
                <TextField {...params} label="Accessorials" placeholder="Select services..." helperText="Optional. Extra services needed for this load." />
              )}
            />
          </Grid>
        </Grid>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* 7. MARKETPLACE SETTINGS                                            */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <SectionHeader icon={<VisibilityIcon fontSize="large" sx={{ color: "#a259f7" }} />} label="Marketplace / Board Settings" />
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} sm={4}>
            <FormControl fullWidth>
              <InputLabel>Load Visibility</InputLabel>
              <Select value={newLoad.loadVisibility} label="Load Visibility"
                onChange={e => handleChange("loadVisibility", e.target.value)}>
                <MenuItem value="public">Public (all carriers)</MenuItem>
                <MenuItem value="preferred">Preferred carriers only</MenuItem>
                <MenuItem value="private">Private (invite only)</MenuItem>
                {!isEdit && <MenuItem value="tender">Offer to my carriers one at a time</MenuItem>}
                {isEdit && editBase.current?.api?.loadVisibility === 'tender' && (
                  <MenuItem value="tender">Offering to your carriers one at a time</MenuItem>
                )}
              </Select>
              {isEdit && editBase.current?.api?.loadVisibility === 'tender' && (
                <FormHelperText>Choosing another option stops the offer.</FormHelperText>
              )}
            </FormControl>
          </Grid>
          {wantsTender && (
            <Grid item xs={12}>
              {tenderBlocked ? (
                <Alert severity="info">
                  You have no active carriers in your list yet.{' '}
                  <Link component={RouterLink} to="/dashboard/shipper/network">Add carriers in My Carriers</Link> to use this option.
                </Alert>
              ) : (
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={4}>
                    <FormControl fullWidth>
                      <InputLabel>Time to answer</InputLabel>
                      <Select value={tenderMinutes} label="Time to answer" onChange={(e) => setTenderMinutes(e.target.value)}>
                        {[[15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours']].map(([m, l]) => (
                          <MenuItem key={m} value={m}>{l}</MenuItem>
                        ))}
                      </Select>
                      <FormHelperText>Each carrier gets this long to accept before the next is asked.</FormHelperText>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <FormControl fullWidth>
                      <InputLabel>If nobody accepts</InputLabel>
                      <Select value={tenderFallback} label="If nobody accepts" onChange={(e) => setTenderFallback(e.target.value)}>
                        <MenuItem value="public">Public load board</MenuItem>
                        <MenuItem value="private">All my carriers at once</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <Typography variant="body2" sx={{ color: '#cbd5e1' }}>
                      Gold carriers are asked first, then silver, then standard.{' '}
                      <Link component={RouterLink} to="/dashboard/shipper/network">Manage My Carriers</Link>
                    </Typography>
                  </Grid>
                </Grid>
              )}
            </Grid>
          )}
          <Grid item xs={12} sm={4}>
            <TextField
              label="Expiration Date/Time"
              type="datetime-local"
              fullWidth
              InputLabelProps={{ shrink: true }}
              value={newLoad.expirationDateTime}
              onChange={e => handleChange("expirationDateTime", e.target.value)}
              helperText="Optional: auto-expires if not covered"
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <FormControlLabel
              control={
                <Switch
                  checked={newLoad.allowCarrierBidding}
                  onChange={e => handleChange("allowCarrierBidding", e.target.checked)}
                />
              }
              label="Allow carrier bidding"
            />
          </Grid>
        </Grid>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* 8. NOTES & ATTACHMENTS                                             */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <SectionHeader icon={<AssignmentOutlinedIcon fontSize="large" sx={{ color: "#fff" }} />} label="Notes (Optional)" />
        <TextField
          label="Additional Notes"
          fullWidth
          multiline
          minRows={2}
          value={newLoad.notes}
          onChange={e => handleChange("notes", e.target.value, limits.notes)}
          inputProps={{ maxLength: limits.notes }}
          sx={{ mb: 2 }}
          helperText={`Optional. ${newLoad.notes.length}/${limits.notes}`}
        />

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* 9. ADVANCED / ENTERPRISE FIELDS                                    */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Divider sx={{ my: 3, borderColor: "#b8b8b822" }}>Advanced / Enterprise Fields (Optional)</Divider>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          {/* Reference numbers */}
          <Grid item xs={12} sm={6}>
            <TextField label="PO Number" fullWidth value={newLoad.poNumber}
              onChange={e => handleChange("poNumber", e.target.value, limits.poNumber)}
              inputProps={{ maxLength: limits.poNumber }} helperText="Optional" />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Shipper Reference Number" fullWidth value={newLoad.shipperReferenceNumber}
              onChange={e => handleChange("shipperReferenceNumber", e.target.value, limits.shipperReferenceNumber)}
              inputProps={{ maxLength: limits.shipperReferenceNumber }} helperText="Optional" />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Consignee Reference" fullWidth value={newLoad.consigneeReference}
              onChange={e => handleChange("consigneeReference", e.target.value, limits.consigneeReference)}
              inputProps={{ maxLength: limits.consigneeReference }} helperText="Optional" />
          </Grid>

          {/* Cargo value */}
          <Grid item xs={12} sm={6}>
            <TextField label="Cargo Value ($)" fullWidth type="number" value={newLoad.cargoValue}
              onChange={e => handleChange("cargoValue", e.target.value, limits.cargoValue)}
              inputProps={{ min: 0 }} helperText="Optional. Declared value for insurance." />
          </Grid>

          {/* Insurance — dropdown */}
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel>Insurance Required</InputLabel>
              <Select value={newLoad.insuranceRequired} label="Insurance Required"
                onChange={e => handleChange("insuranceRequired", e.target.value)}>
                {INSURANCE_LEVELS.map(ins => (
                  <MenuItem value={ins.value} key={ins.value || 'none'}>{ins.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          {newLoad.insuranceRequired === 'custom' && (
            <Grid item xs={12} sm={6}>
              <TextField
                label="Custom Insurance Amount ($)"
                type="number"
                fullWidth
                value={newLoad.customInsuranceAmount}
                onChange={e => handleChange("customInsuranceAmount", e.target.value, limits.customInsuranceAmount)}
                inputProps={{ min: 0 }}
              />
            </Grid>
          )}

          {/* Carrier instructions */}
          <Grid item xs={12} sm={6}>
            <TextField label="Carrier Instructions" fullWidth multiline minRows={2}
              value={newLoad.carrierInstructions}
              onChange={e => handleChange("carrierInstructions", e.target.value, limits.carrierInstructions)}
              inputProps={{ maxLength: limits.carrierInstructions }}
              helperText={`Optional. ${newLoad.carrierInstructions.length}/${limits.carrierInstructions}`} />
          </Grid>

          {/* Pickup handshake (anti-impersonation) */}
          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={newLoad.requirePickupVerification}
                  onChange={e => handleChange("requirePickupVerification", e.target.checked)}
                />
              }
              label="Require pickup verification code at the dock"
              sx={{ color: "#fff" }}
            />
          </Grid>
          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={newLoad.requirePickupPhotos}
                  onChange={e => handleChange("requirePickupPhotos", e.target.checked)}
                />
              }
              label="Require pickup photos (freight or seal) before the driver can start the trip"
              sx={{ color: "#fff" }}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={newLoad.requireDeliveryPhotos}
                  onChange={e => handleChange("requireDeliveryPhotos", e.target.checked)}
                />
              }
              label="Require delivery photos before the load can be marked delivered"
              sx={{ color: "#fff" }}
            />
          </Grid>

          {/* Documents Required (expanded multi-select) */}
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel>Documents Required</InputLabel>
              <Select
                multiple
                value={newLoad.documentsRequired}
                label="Documents Required"
                onChange={e => handleChange("documentsRequired", e.target.value)}
                renderValue={selected => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {selected.map(value => (
                      <Chip key={value} label={value} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.15)', color: '#fff' }} />
                    ))}
                  </Box>
                )}
              >
                {DOCUMENTS_REQUIRED_OPTIONS.map(doc => (
                  <MenuItem key={doc} value={doc}>{doc}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          {/* Dimensions — shown here for non-flatbed types */}
          {!showDimensionsProminent && (
            <>
              <Grid item xs={12}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: -1 }}>
                  <StraightenIcon sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 18 }} />
                  <Typography variant="body2" color="rgba(255,255,255,0.6)">Load Dimensions (Optional)</Typography>
                </Box>
              </Grid>
              <DimensionFields />
            </>
          )}
        </Grid>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* 10. TERMS & SUBMIT                                                 */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {!isEdit && (
        <FormControlLabel
          control={
            <Switch
              checked={newLoad.termsAccepted}
              onChange={e => handleChange("termsAccepted", e.target.checked)}
              inputProps={{ 'aria-invalid': !!fieldErrors.termsAccepted }}
              color="primary"
            />
          }
          label="I agree to platform Terms & Conditions"
          sx={{ color: "#fff", mb: 2 }}
        />
        )}
        {!isEdit && fieldErrors.termsAccepted && (
          <Typography color="error" fontSize="0.9em">Accept the Terms & Conditions to post this load.</Typography>
        )}
        </Box>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* WIZARD FOOTER NAVIGATION                                           */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {stepSummary && (
          <Alert severity="error" sx={{ mt: 3, bgcolor: 'rgba(127,29,29,0.55)', color: '#fecaca', '& .MuiAlert-icon': { color: '#fecaca' } }}>
            {stepSummary}
          </Alert>
        )}
        {submitError && (
          <Alert severity="error" onClose={() => setSubmitError('')} sx={{ mt: 3, bgcolor: 'rgba(127,29,29,0.55)', color: '#fecaca', '& .MuiAlert-icon': { color: '#fecaca' } }}>
            {submitError}
          </Alert>
        )}
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, mt: 4 }}>
          <Button
            type="button"
            variant="outlined"
            disabled={activeStep === 0}
            onClick={handleBack}
            sx={{
              fontWeight: 700,
              borderRadius: 3.2,
              py: 1.1,
              px: 3,
              color: "#fff",
              borderColor: "rgba(255,255,255,0.4)",
              "&:hover": { borderColor: "#fff", bgcolor: "rgba(255,255,255,0.08)" },
              "&.Mui-disabled": { color: "rgba(255,255,255,0.3)", borderColor: "rgba(255,255,255,0.12)" },
            }}
          >
            Back
          </Button>
          <Box sx={{ flex: 1 }} />
          {activeStep < STEP_LABELS.length - 1 ? (
            <Button
              key="next"
              type="button"
              variant="contained"
              onClick={handleNext}
              sx={{
                fontWeight: 900,
                borderRadius: 3.2,
                py: 1.1,
                px: 4,
                fontSize: "1.02em",
                letterSpacing: "0.04em",
                background: "linear-gradient(90deg,#ec4899,#9333ea)",
                boxShadow: "0 8px 32px #e1129a44, 0 2px 12px #32159e22",
                "&:hover": {
                  boxShadow: "0 12px 40px #6a1fcf55, 0 4px 24px #e1129a33",
                  background: "linear-gradient(90deg,#e1129a 10%,#6a1fcf 90%)",
                  transform: "scale(1.015)",
                },
              }}
            >
              Next
            </Button>
          ) : (
            <Button
              key="post"
              variant="contained"
              color="primary"
              type="submit"
              disabled={submitting}
              startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : null}
              sx={{
                fontWeight: 900,
                borderRadius: 3.2,
                py: 1.28,
                px: 5,
                fontSize: "1.14em",
                background: "linear-gradient(90deg,#ec4899,#9333ea)",
                boxShadow: "0 8px 32px #e1129a44, 0 2px 12px #32159e22",
                letterSpacing: "0.06em",
                transition: "box-shadow 0.2s cubic-bezier(.21,1.11,.81,.99),transform 0.1s",
                "&:hover": {
                  boxShadow: "0 12px 40px #6a1fcf55, 0 4px 24px #e1129a33",
                  background: "linear-gradient(90deg,#e1129a 10%,#6a1fcf 90%)",
                  transform: "scale(1.015)"
                }
              }}
            >
              {isEdit ? (submitting ? 'Saving…' : 'Save changes') : (submitting ? 'Posting…' : 'Post Load')}
            </Button>
          )}
        </Box>
      </Box>

      {/* Snackbar */}
      <Snackbar
        open={openSnackbar}
        autoHideDuration={3500}
        onClose={() => setOpenSnackbar(false)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
      >
        <Alert severity={error ? "error" : "success"} sx={{ width: "100%" }}>
          {error ? error : "Load successfully posted!"}
        </Alert>
      </Snackbar>
    </Paper>
  );
}
