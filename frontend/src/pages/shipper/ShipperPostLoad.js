import React, { useState } from "react";
import {
  TextField, Button, Grid, Typography, Box, Paper, Snackbar, Alert, Select, MenuItem,
  FormControl, InputLabel, FormControlLabel, Switch, Divider, Chip
} from "@mui/material";
import Autocomplete from "@mui/material/Autocomplete";
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import PlaceIcon from '@mui/icons-material/Place';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import MonetizationOnIcon from '@mui/icons-material/MonetizationOn';
import VisibilityIcon from '@mui/icons-material/Visibility';
import api from '../../services/api';
import cities from '../../data/usCities.json';

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
  autoOfferPreferred: false,
  // Attachments
  cargoPhotos: [],
  rateConfirmationUpload: [],
  customsDocsUpload: [],
  // Advanced/enterprise (optional)
  pickupFacilityName: "",
  pickupAddress: "",
  pickupContactName: "",
  pickupContactPhone: "",
  poNumber: "",
  shipperReferenceNumber: "",
  consigneeReference: "",
  brokerReference: "",
  cargoValue: "",
  insuranceRequired: "",
  hazardousMaterial: false,
  dangerousGoodsUN: "",
  temperatureMin: "",
  temperatureMax: "",
  temperatureUnit: "F",
  specialHandling: "",
  accessorials: "",
  carrierInstructions: "",
  documentsRequired: [],
};

const equipmentTypes = ["Dry Van", "Reefer", "Flatbed", "Box Truck", "Car Hauler"];
const paymentTermsOptions = ["Net 30", "Prepaid", "COD", "Quick Pay"];
const commodityCategories = ["Electronics", "Food", "Pharma", "Furniture", "Automotive", "Other"];
const docsOptions = ["BOL", "POD", "Customs", "Permit", "Other"];

export default function ShipperPostLoad() {
  const [newLoad, setNewLoad] = useState(initialLoad);
  const [openSnackbar, setOpenSnackbar] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [uploadNames, setUploadNames] = useState({
    cargoPhotos: [],
    rateConfirmationUpload: [],
    customsDocsUpload: [],
  });

  const handleChange = (field, value, maxLen) => {
    setNewLoad((prev) => ({
      ...prev,
      [field]: typeof maxLen === "number" ? value.slice(0, maxLen) : value
    }));
    setFieldErrors((fe) => ({ ...fe, [field]: false }));
  };

  const handleArrayChange = (field, value) => {
    setNewLoad((prev) => ({
      ...prev,
      [field]: prev[field].includes(value)
        ? prev[field].filter((v) => v !== value)
        : [...prev[field], value]
    }));
  };

  const handleFileChange = (field, files) => {
    setNewLoad((prev) => ({
      ...prev,
      [field]: files
    }));
    setUploadNames((prev) => ({
      ...prev,
      [field]: Array.from(files).map(f => f.name)
    }));
  };

  // All required for validation
  const requiredFields = [
    "title", "commodityType", "commodityCategory", "weight",
    "equipmentType", "origin", "pickupWindowStart",
    "destination", "deliveryFacilityName", "deliveryAddress",
    "deliveryContactName", "deliveryContactPhone", "deliveryWindowStart",
    "rate", "currency", "paymentTerms", "termsAccepted"
  ];

  const validateFields = () => {
    let errors = {};
    requiredFields.forEach((k) => {
      if (!newLoad[k]) errors[k] = true;
    });
    // Pickup/delivery date order validation
    if (
      newLoad.pickupWindowStart &&
      newLoad.deliveryWindowStart &&
      new Date(newLoad.pickupWindowStart) >= new Date(newLoad.deliveryWindowStart)
    ) {
      errors["pickupWindowStart"] = true;
      errors["deliveryWindowStart"] = true;
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateFields()) {
      setError("Please fill all required fields correctly.");
      setOpenSnackbar(true);
      return;
    }
    try {
      const token = localStorage.getItem("token");
      const hasFiles =
        newLoad.cargoPhotos.length ||
        newLoad.rateConfirmationUpload.length ||
        newLoad.customsDocsUpload.length;
      let payload, headers;
      if (hasFiles) {
        payload = new FormData();
        Object.entries(newLoad).forEach(([k, v]) => {
          if (
            ["cargoPhotos", "rateConfirmationUpload", "customsDocsUpload"].includes(k)
          ) {
            for (let file of v) payload.append(k, file);
          } else if (Array.isArray(v)) {
            payload.append(k, JSON.stringify(v));
          } else {
            payload.append(k, v ?? "");
          }
        });
        headers = {
          "Authorization": `Bearer ${token}`,
        };
      } else {
        payload = { ...newLoad };
        headers = { "Authorization": `Bearer ${token}` };
      }
      await api.post("/loads", payload, { headers });
      setNewLoad(initialLoad);
      setError("");
      setFieldErrors({});
      setUploadNames({
        cargoPhotos: [],
        rateConfirmationUpload: [],
        customsDocsUpload: [],
      });
      setOpenSnackbar(true);
    } catch (err) {
      setError("Failed to post load. Please check all fields and try again.");
      setOpenSnackbar(true);
    }
  };

  const SectionHeader = ({ icon, label }) => (
    <Box sx={{ display: "flex", alignItems: "center", mb: 2, mt: 4 }}>
      {icon}
      <Typography variant="h6" fontWeight={800} color="#fff" ml={1.5} letterSpacing={1}>
        {label}
      </Typography>
      <Divider sx={{ flex: 1, ml: 2, borderColor: "rgba(255,255,255,0.12)" }} />
    </Box>
  );

  // Character limits
  const limits = {
    title: 80,
    commodityType: 80,
    commodityCategory: 40,
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
    brokerReference: 40,
    cargoValue: 12,
    insuranceRequired: 12,
    dangerousGoodsUN: 20,
    temperatureMin: 8,
    temperatureMax: 8,
    specialHandling: 200,
    accessorials: 200,
    carrierInstructions: 200,
  };

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
        {/* Load Details */}
        <SectionHeader icon={<AssignmentOutlinedIcon fontSize="large" sx={{ color: "#22d3ee" }} />} label="Load Details" />
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Title"
              required
              fullWidth
              value={newLoad.title}
              onChange={e => handleChange("title", e.target.value, limits.title)}
              inputProps={{ maxLength: limits.title }}
              error={fieldErrors.title}
              helperText={`${newLoad.title.length}/${limits.title}`}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth error={fieldErrors.commodityCategory}>
              <InputLabel required>Commodity Category</InputLabel>
              <Select
                required
                value={newLoad.commodityCategory}
                label="Commodity Category"
                onChange={e => handleChange("commodityCategory", e.target.value, limits.commodityCategory)}
                inputProps={{ maxLength: limits.commodityCategory }}
              >
                <MenuItem value="">Select</MenuItem>
                {commodityCategories.map(cat => (
                  <MenuItem value={cat} key={cat}>{cat}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Commodity Type"
              required
              fullWidth
              value={newLoad.commodityType}
              onChange={e => handleChange("commodityType", e.target.value, limits.commodityType)}
              inputProps={{ maxLength: limits.commodityType }}
              error={fieldErrors.commodityType}
              helperText={`${newLoad.commodityType.length}/${limits.commodityType}`}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Weight (lbs)"
              required
              type="number"
              fullWidth
              value={newLoad.weight}
              onChange={e => handleChange("weight", e.target.value, limits.weight)}
              inputProps={{ maxLength: limits.weight }}
              error={fieldErrors.weight}
              helperText={`${newLoad.weight.length}/${limits.weight}`}
            />
          </Grid>
        </Grid>

        {/* Pickup Section (Required: City & Window; Optional: rest) */}
        <SectionHeader icon={<PlaceIcon fontSize="large" sx={{ color: "#22d3ee" }} />} label="Pickup Location" />
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} sm={6}>
            <Autocomplete
              options={cities}
              getOptionLabel={opt => opt.label}
              onChange={(_, val) => handleChange("origin", val ? val.label : "", 80)}
              renderInput={params =>
                <TextField
                  {...params}
                  label="Pickup City"
                  required
                  error={fieldErrors.origin}
                />}
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
          {/* Optional Pickup Fields */}
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
              helperText="Optional. Can add after booking."
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Pickup Contact Phone"
              fullWidth
              value={newLoad.pickupContactPhone}
              onChange={e => handleChange("pickupContactPhone", e.target.value, limits.pickupContactPhone)}
              inputProps={{ maxLength: limits.pickupContactPhone }}
              helperText="Optional. Can add after booking."
            />
          </Grid>
        </Grid>

        {/* Delivery Section (ALL REQUIRED) */}
        <SectionHeader icon={<PlaceIcon fontSize="large" sx={{ color: "#a78bfa" }} />} label="Delivery Location" />
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} sm={6}>
            <Autocomplete
              options={cities}
              getOptionLabel={opt => opt.label}
              onChange={(_, val) => handleChange("destination", val ? val.label : "", 80)}
              renderInput={params =>
                <TextField
                  {...params}
                  label="Delivery City"
                  required
                  error={fieldErrors.destination}
                />}
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

        {/* Rate, Payment, Marketplace, Attachments, Advanced */}
        <SectionHeader icon={<LocalShippingIcon fontSize="large" sx={{ color: "#fbbf24" }} />} label="Cargo & Equipment" />
        <Grid container spacing={2} sx={{ mb: 2 }}>
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
                {equipmentTypes.map(eq => (
                  <MenuItem value={eq} key={eq}>{eq}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Special Instructions"
              fullWidth
              multiline
              minRows={2}
              value={newLoad.specialInstructions}
              onChange={e => handleChange("specialInstructions", e.target.value, limits.specialInstructions)}
              inputProps={{ maxLength: limits.specialInstructions }}
              helperText={`Optional. Max ${limits.specialInstructions} chars.`}
            />
          </Grid>
        </Grid>

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
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <FormControl fullWidth>
              <InputLabel>Currency</InputLabel>
              <Select
                value={newLoad.currency}
                label="Currency"
                onChange={e => handleChange("currency", e.target.value)}
              >
                <MenuItem value="USD">USD</MenuItem>
                <MenuItem value="CAD">CAD</MenuItem>
                <MenuItem value="EUR">EUR</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={4}>
            <FormControl fullWidth>
              <InputLabel required>Payment Terms</InputLabel>
              <Select
                required
                value={newLoad.paymentTerms}
                label="Payment Terms"
                onChange={e => handleChange("paymentTerms", e.target.value)}
                error={fieldErrors.paymentTerms}
              >
                <MenuItem value="">Select</MenuItem>
                {paymentTermsOptions.map(t => (
                  <MenuItem value={t} key={t}>{t}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
        </Grid>

        <SectionHeader icon={<VisibilityIcon fontSize="large" sx={{ color: "#a259f7" }} />} label="Marketplace/Board Settings" />
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} sm={4}>
            <FormControl fullWidth>
              <InputLabel>Load Visibility</InputLabel>
              <Select
                value={newLoad.loadVisibility}
                label="Load Visibility"
                onChange={e => handleChange("loadVisibility", e.target.value)}
              >
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

        {/* Attachments and Notes */}
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
          helperText={`Optional. Max ${limits.notes} characters.`}
        />
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} sm={6}>
            <Typography color="#eee" fontSize="0.97em">Cargo Photos (.jpg, .png, .pdf)</Typography>
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.pdf"
              multiple
              onChange={e => handleFileChange("cargoPhotos", e.target.files)}
              style={{ color: "#fff", marginBottom: 12 }}
            />
            {uploadNames.cargoPhotos.length > 0 && (
              <Box>
                {uploadNames.cargoPhotos.map((name, idx) => (
                  <Chip key={idx} label={name} size="small" sx={{ mr: 1, mb: 1, bgcolor: "#4527a0", color: "#fff" }} />
                ))}
              </Box>
            )}
          </Grid>
        </Grid>

        {/* Enterprise/Advanced Fields */}
        <Divider sx={{ my: 3, borderColor: "#b8b8b822" }}>Advanced/Enterprise Fields (Optional)</Divider>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} sm={6}>
            <TextField label="PO Number" fullWidth value={newLoad.poNumber}
              onChange={e => handleChange("poNumber", e.target.value, limits.poNumber)}
              inputProps={{ maxLength: limits.poNumber }}
              helperText="Optional."
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Shipper Reference Number" fullWidth value={newLoad.shipperReferenceNumber}
              onChange={e => handleChange("shipperReferenceNumber", e.target.value, limits.shipperReferenceNumber)}
              inputProps={{ maxLength: limits.shipperReferenceNumber }}
              helperText="Optional."
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Consignee Reference" fullWidth value={newLoad.consigneeReference}
              onChange={e => handleChange("consigneeReference", e.target.value, limits.consigneeReference)}
              inputProps={{ maxLength: limits.consigneeReference }}
              helperText="Optional."
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Broker Reference" fullWidth value={newLoad.brokerReference}
              onChange={e => handleChange("brokerReference", e.target.value, limits.brokerReference)}
              inputProps={{ maxLength: limits.brokerReference }}
              helperText="Optional."
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Cargo Value ($)" fullWidth value={newLoad.cargoValue}
              onChange={e => handleChange("cargoValue", e.target.value, limits.cargoValue)}
              inputProps={{ maxLength: limits.cargoValue }}
              helperText="Optional. Declared value for insurance."
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Insurance Required ($)" fullWidth value={newLoad.insuranceRequired}
              onChange={e => handleChange("insuranceRequired", e.target.value, limits.insuranceRequired)}
              inputProps={{ maxLength: limits.insuranceRequired }}
              helperText="Optional."
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <FormControlLabel
              control={
                <Switch
                  checked={newLoad.hazardousMaterial}
                  onChange={e => handleChange("hazardousMaterial", e.target.checked)}
                />
              }
              label="Hazardous Material"
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="UN # (Hazmat/Dangerous Goods)" fullWidth value={newLoad.dangerousGoodsUN}
              onChange={e => handleChange("dangerousGoodsUN", e.target.value, limits.dangerousGoodsUN)}
              inputProps={{ maxLength: limits.dangerousGoodsUN }}
              helperText="Optional."
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Temperature Min" fullWidth value={newLoad.temperatureMin}
              onChange={e => handleChange("temperatureMin", e.target.value, limits.temperatureMin)}
              inputProps={{ maxLength: limits.temperatureMin }}
              helperText="Optional."
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Temperature Max" fullWidth value={newLoad.temperatureMax}
              onChange={e => handleChange("temperatureMax", e.target.value, limits.temperatureMax)}
              inputProps={{ maxLength: limits.temperatureMax }}
              helperText="Optional."
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel>Temperature Unit</InputLabel>
              <Select
                value={newLoad.temperatureUnit}
                label="Temperature Unit"
                onChange={e => handleChange("temperatureUnit", e.target.value)}
              >
                <MenuItem value="F">Fahrenheit (°F)</MenuItem>
                <MenuItem value="C">Celsius (°C)</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Special Handling" fullWidth value={newLoad.specialHandling}
              onChange={e => handleChange("specialHandling", e.target.value, limits.specialHandling)}
              inputProps={{ maxLength: limits.specialHandling }}
              helperText="Optional."
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Accessorials" fullWidth value={newLoad.accessorials}
              onChange={e => handleChange("accessorials", e.target.value, limits.accessorials)}
              inputProps={{ maxLength: limits.accessorials }}
              helperText="Optional."
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Carrier Instructions" fullWidth value={newLoad.carrierInstructions}
              onChange={e => handleChange("carrierInstructions", e.target.value, limits.carrierInstructions)}
              inputProps={{ maxLength: limits.carrierInstructions }}
              helperText="Optional."
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth>
              <InputLabel>Documents Required</InputLabel>
              <Select
                multiple
                value={newLoad.documentsRequired}
                onChange={e => handleArrayChange("documentsRequired", e.target.value)}
                renderValue={selected => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {selected.map(value => (
                      <Chip key={value} label={value} />
                    ))}
                  </Box>
                )}
              >
                {docsOptions.map(doc => (
                  <MenuItem key={doc} value={doc}>{doc}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
        </Grid>

        {/* Attachments */}
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} sm={4}>
            <Typography color="#eee" fontSize="0.97em">Rate Confirmation (.pdf)</Typography>
            <input
              type="file"
              accept=".pdf"
              multiple
              onChange={e => handleFileChange("rateConfirmationUpload", e.target.files)}
              style={{ color: "#fff", marginBottom: 12 }}
            />
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
            <input
              type="file"
              accept=".pdf"
              multiple
              onChange={e => handleFileChange("customsDocsUpload", e.target.files)}
              style={{ color: "#fff", marginBottom: 12 }}
            />
            {uploadNames.customsDocsUpload.length > 0 && (
              <Box>
                {uploadNames.customsDocsUpload.map((name, idx) => (
                  <Chip key={idx} label={name} size="small" sx={{ mr: 1, mb: 1, bgcolor: "#8b59f7", color: "#fff" }} />
                ))}
              </Box>
            )}
          </Grid>
        </Grid>

        {/* Terms Acceptance */}
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
        {fieldErrors.termsAccepted && <Typography color="error" fontSize="0.9em">You must accept Terms & Conditions</Typography>}

        {/* Submit */}
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
