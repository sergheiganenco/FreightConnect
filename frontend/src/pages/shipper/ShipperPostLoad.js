import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  TextField, Button, Grid, Typography, Box, Paper, Snackbar, Alert, Select, MenuItem,
  FormControl, InputLabel, FormControlLabel, Switch, Divider, Chip, IconButton,
  CircularProgress, Collapse, Tooltip,
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
};

export default function ShipperPostLoad() {
  const navigate = useNavigate();
  const [newLoad, setNewLoad] = useState(initialLoad);
  const [openSnackbar, setOpenSnackbar] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [uploadNames, setUploadNames] = useState({
    cargoPhotos: [],
    rateConfirmationUpload: [],
    customsDocsUpload: [],
  });

  // ── Auto-title ───────────────────────────────────────────────────────────
  const [autoTitleEnabled, setAutoTitleEnabled] = useState(true);
  const titleManuallyEdited = useRef(false);

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

  const handleFileChange = (field, files) => {
    setNewLoad((prev) => ({ ...prev, [field]: files }));
    setUploadNames((prev) => ({ ...prev, [field]: Array.from(files).map(f => f.name) }));
  };

  // ── Validation ───────────────────────────────────────────────────────────
  const requiredFields = [
    "title", "commodityType", "commodityCategory", "weight",
    "equipmentType", "origin", "pickupWindowStart",
    "destination", "deliveryFacilityName", "deliveryAddress",
    "deliveryContactName", "deliveryContactPhone", "deliveryWindowStart",
    "rate", "currency", "paymentTerms", "termsAccepted",
  ];

  const validateFields = () => {
    let errors = {};
    requiredFields.forEach((k) => {
      if (!newLoad[k]) errors[k] = true;
    });
    if (
      newLoad.pickupWindowStart &&
      newLoad.deliveryWindowStart &&
      new Date(newLoad.pickupWindowStart) >= new Date(newLoad.deliveryWindowStart)
    ) {
      errors["pickupWindowStart"] = true;
      errors["deliveryWindowStart"] = true;
    }
    // Block submission when overweight and not acknowledged
    if (newLoad.weight && newLoad.equipmentType) {
      const maxLbs = EQUIPMENT_WEIGHT_LIMITS[newLoad.equipmentType];
      if (maxLbs && Number(newLoad.weight) > maxLbs && !newLoad.overweightAcknowledged) {
        errors["overweightAcknowledged"] = true;
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateFields()) {
      // Check overweight specifically for a targeted error message
      const maxLbs = EQUIPMENT_WEIGHT_LIMITS[newLoad.equipmentType];
      const isOverweightBlocked = maxLbs && Number(newLoad.weight) > maxLbs && !newLoad.overweightAcknowledged;
      setError(isOverweightBlocked
        ? "This load exceeds the weight limit. Please acknowledge the overweight permit requirement before posting."
        : "Please fill all required fields correctly.");
      setOpenSnackbar(true);
      return;
    }
    try {
      const token = localStorage.getItem("token");

      // Resolve insurance: if "custom", use the custom amount
      const resolvedInsurance = newLoad.insuranceRequired === 'custom'
        ? newLoad.customInsuranceAmount
        : newLoad.insuranceRequired;

      const hasFiles =
        newLoad.cargoPhotos.length ||
        newLoad.rateConfirmationUpload.length ||
        newLoad.customsDocsUpload.length;

      let payload, headers;
      if (hasFiles) {
        payload = new FormData();
        const skipKeys = ['cargoPhotos', 'rateConfirmationUpload', 'customsDocsUpload', 'customInsuranceAmount', 'termsAccepted'];
        Object.entries(newLoad).forEach(([k, v]) => {
          if (['cargoPhotos', 'rateConfirmationUpload', 'customsDocsUpload'].includes(k)) {
            for (let file of v) payload.append(k, file);
          } else if (skipKeys.includes(k)) {
            // skip
          } else if (Array.isArray(v)) {
            payload.append(k, JSON.stringify(v));
          } else {
            payload.append(k, v ?? "");
          }
        });
        payload.set('insuranceRequired', resolvedInsurance || '');
        if (stops.length > 0) payload.append('stops', JSON.stringify(stops));
        headers = { "Authorization": `Bearer ${token}` };
      } else {
        payload = {
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
        headers = { "Authorization": `Bearer ${token}` };
      }
      await api.post("/loads", payload, { headers });
      navigate("/dashboard/shipper/loads");
    } catch (err) {
      setError("Failed to post load. Please check all fields and try again.");
      setOpenSnackbar(true);
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
          borderColor: "#e91e63"
        }
      }}
    >
      <Typography variant="h4" fontWeight={900} color="#fff" mb={4} align="center" letterSpacing={1.4}
        sx={{ textShadow: "0 2px 16px #6a1fcf66" }}>
        Post a New Load
      </Typography>

      <Box component="form" onSubmit={handleSubmit}>

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
              error={fieldErrors.title}
              helperText={
                <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {autoTitleEnabled
                    ? <><AutoFixHighIcon sx={{ fontSize: 14, color: '#22d3ee' }} /> Auto-fills as you select Equipment, Cities & Weight</>
                    : `${newLoad.title.length}/${limits.title}`
                  }
                </Box>
              }
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
                  />
                }
                label={<Typography variant="body2" color="rgba(255,255,255,0.7)">Auto-generate title</Typography>}
              />
            </Box>
          </Grid>

          {/* Commodity Category (dropdown) */}
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth error={fieldErrors.commodityCategory}>
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
            </FormControl>
          </Grid>

          {/* Commodity Type (cascading dropdown) */}
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth error={fieldErrors.commodityType}>
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
              error={fieldErrors.weight}
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
        {/* 2. PICKUP LOCATION                                                 */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <SectionHeader icon={<PlaceIcon fontSize="large" sx={{ color: "#22d3ee" }} />} label="Pickup Location" />
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} sm={6}>
            <Autocomplete
              options={cities}
              getOptionLabel={opt => opt.label}
              onChange={(_, val) => handleChange("origin", val ? val.label : "")}
              renderInput={params =>
                <TextField {...params} label="Pickup City" required error={fieldErrors.origin} />
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
              error={fieldErrors.pickupWindowStart}
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
              helperText="Optional"
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
              options={cities}
              getOptionLabel={opt => opt.label}
              onChange={(_, val) => handleChange("destination", val ? val.label : "")}
              renderInput={params =>
                <TextField {...params} label="Delivery City" required error={fieldErrors.destination} />
              }
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Delivery Facility Name"
              required
              fullWidth
              value={newLoad.deliveryFacilityName}
              onChange={e => handleChange("deliveryFacilityName", e.target.value, limits.deliveryFacilityName)}
              inputProps={{ maxLength: limits.deliveryFacilityName }}
              error={fieldErrors.deliveryFacilityName}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Delivery Address"
              required
              fullWidth
              value={newLoad.deliveryAddress}
              onChange={e => handleChange("deliveryAddress", e.target.value, limits.deliveryAddress)}
              inputProps={{ maxLength: limits.deliveryAddress }}
              error={fieldErrors.deliveryAddress}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Delivery Contact Name"
              required
              fullWidth
              value={newLoad.deliveryContactName}
              onChange={e => handleChange("deliveryContactName", e.target.value, limits.deliveryContactName)}
              inputProps={{ maxLength: limits.deliveryContactName }}
              error={fieldErrors.deliveryContactName}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Delivery Contact Phone"
              required
              fullWidth
              value={newLoad.deliveryContactPhone}
              onChange={e => handleChange("deliveryContactPhone", e.target.value, limits.deliveryContactPhone)}
              inputProps={{ maxLength: limits.deliveryContactPhone }}
              error={fieldErrors.deliveryContactPhone}
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
              error={fieldErrors.deliveryWindowStart}
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
              helperText="Optional"
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

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* 5. CARGO & EQUIPMENT                                               */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <SectionHeader icon={<LocalShippingIcon fontSize="large" sx={{ color: "#fbbf24" }} />} label="Cargo & Equipment" />
        <Grid container spacing={2} sx={{ mb: 2 }}>
          {/* Equipment Type (expanded dropdown) */}
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth error={fieldErrors.equipmentType}>
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
            </FormControl>
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
              error={fieldErrors.rate}
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
            <FormControl fullWidth error={fieldErrors.paymentTerms}>
              <InputLabel required>Payment Terms</InputLabel>
              <Select
                required
                value={newLoad.paymentTerms}
                label="Payment Terms"
                onChange={e => handleChange("paymentTerms", e.target.value)}
              >
                <MenuItem value="">Select</MenuItem>
                {PAYMENT_TERMS.map(t => (
                  <MenuItem value={t} key={t}>{t}</MenuItem>
                ))}
              </Select>
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
              </Select>
            </FormControl>
          </Grid>
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
        <SectionHeader icon={<AssignmentOutlinedIcon fontSize="large" sx={{ color: "#fff" }} />} label="Notes & Attachments (Optional)" />
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
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} sm={4}>
            <Typography color="#eee" fontSize="0.97em">Cargo Photos (.jpg, .png, .pdf)</Typography>
            <input type="file" accept=".jpg,.jpeg,.png,.pdf" multiple
              onChange={e => handleFileChange("cargoPhotos", e.target.files)}
              style={{ color: "#fff", marginBottom: 12 }} />
            {uploadNames.cargoPhotos.length > 0 && (
              <Box>
                {uploadNames.cargoPhotos.map((name, idx) => (
                  <Chip key={idx} label={name} size="small" sx={{ mr: 1, mb: 1, bgcolor: "#4527a0", color: "#fff" }} />
                ))}
              </Box>
            )}
          </Grid>
          <Grid item xs={12} sm={4}>
            <Typography color="#eee" fontSize="0.97em">Rate Confirmation (.pdf)</Typography>
            <input type="file" accept=".pdf" multiple
              onChange={e => handleFileChange("rateConfirmationUpload", e.target.files)}
              style={{ color: "#fff", marginBottom: 12 }} />
            {uploadNames.rateConfirmationUpload.length > 0 && (
              <Box>
                {uploadNames.rateConfirmationUpload.map((name, idx) => (
                  <Chip key={idx} label={name} size="small" sx={{ mr: 1, mb: 1, bgcolor: "#6347a0", color: "#fff" }} />
                ))}
              </Box>
            )}
          </Grid>
          <Grid item xs={12} sm={4}>
            <Typography color="#eee" fontSize="0.97em">Customs Docs (.pdf)</Typography>
            <input type="file" accept=".pdf" multiple
              onChange={e => handleFileChange("customsDocsUpload", e.target.files)}
              style={{ color: "#fff", marginBottom: 12 }} />
            {uploadNames.customsDocsUpload.length > 0 && (
              <Box>
                {uploadNames.customsDocsUpload.map((name, idx) => (
                  <Chip key={idx} label={name} size="small" sx={{ mr: 1, mb: 1, bgcolor: "#8b59f7", color: "#fff" }} />
                ))}
              </Box>
            )}
          </Grid>
        </Grid>

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
        <FormControlLabel
          control={
            <Switch
              checked={newLoad.termsAccepted}
              onChange={e => handleChange("termsAccepted", e.target.checked)}
              required
              color="primary"
            />
          }
          label="I agree to platform Terms & Conditions"
          sx={{ color: "#fff", mb: 2 }}
        />
        {fieldErrors.termsAccepted && (
          <Typography color="error" fontSize="0.9em">You must accept Terms & Conditions</Typography>
        )}

        <Button
          variant="contained"
          color="primary"
          type="submit"
          fullWidth
          sx={{
            fontWeight: 900,
            borderRadius: 3.2,
            mt: 2,
            py: 1.28,
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
          Post Load
        </Button>
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
