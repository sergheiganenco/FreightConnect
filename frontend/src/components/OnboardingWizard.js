import React, { useState, useCallback } from 'react';
import {
  Box, Stepper, Step, StepLabel, Button, Typography, TextField, Paper,
  Checkbox, FormControlLabel, FormGroup, Grid, Select, MenuItem,
  InputLabel, FormControl, IconButton, Alert, CircularProgress,
  StepConnector, Chip
} from '@mui/material';
import { Add, Delete, CloudUpload, CheckCircle } from '@mui/icons-material';
import { styled } from '@mui/material/styles';
import api from '../services/api';
import { surface, text, brand, gradient, darkFieldSx, shadow } from '../theme/tokens';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY'
];

const EQUIPMENT_TYPES = ['Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Lowboy', 'Tanker', 'Intermodal', 'Power Only'];
const WEIGHT_RANGES = ['< 10,000 lbs', '10,000 - 25,000 lbs', '25,000 - 40,000 lbs', '40,000+ lbs'];
const FREQUENCY_OPTIONS = ['Daily', 'Weekly', 'Bi-Weekly', 'Monthly', 'Occasional'];

const GlassPaper = styled(Paper)(() => ({
  background: surface.cardBg,
  backdropFilter: 'blur(20px)',
  border: `1px solid ${surface.glassBorder}`,
  borderRadius: 16,
  padding: 32,
  boxShadow: shadow.card,
}));

const CustomConnector = styled(StepConnector)(() => ({
  '& .MuiStepConnector-line': {
    borderColor: surface.glassBorder,
  },
}));

const CARRIER_STEPS = ['Company Info', 'Equipment', 'Preferred Lanes', 'Fleet', 'Documents', 'Payments'];
const SHIPPER_STEPS = ['Company Info', 'Shipment Types', 'Primary Lanes', 'Payment Setup'];

export default function OnboardingWizard({ role, onComplete }) {
  const [activeStep, setActiveStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Carrier state
  const [companyInfo, setCompanyInfo] = useState({
    name: '', dotNumber: '', mcNumber: '', address: '', city: '', state: '', zip: ''
  });
  const [equipmentTypes, setEquipmentTypes] = useState([]);
  const [lanes, setLanes] = useState([{ origin: '', destination: '' }]);
  const [trucks, setTrucks] = useState([{ year: '', make: '', type: 'Dry Van', vin: '' }]);
  const [documents, setDocuments] = useState({ insurance: null, authority: null });

  // Shipper state
  const [shipperCompany, setShipperCompany] = useState({
    name: '', address: '', city: '', state: '', zip: '', industry: ''
  });
  const [shipmentTypes, setShipmentTypes] = useState({
    equipment: [], weightRanges: [], frequency: ''
  });

  const steps = role === 'carrier' ? CARRIER_STEPS : SHIPPER_STEPS;

  const handleCompanyField = useCallback((field, value) => {
    if (role === 'carrier') {
      setCompanyInfo(prev => ({ ...prev, [field]: value }));
    } else {
      setShipperCompany(prev => ({ ...prev, [field]: value }));
    }
  }, [role]);

  const toggleEquipment = useCallback((type) => {
    setEquipmentTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  }, []);

  const addLane = useCallback(() => {
    setLanes(prev => [...prev, { origin: '', destination: '' }]);
  }, []);

  const removeLane = useCallback((index) => {
    setLanes(prev => prev.filter((_, i) => i !== index));
  }, []);

  const updateLane = useCallback((index, field, value) => {
    setLanes(prev => prev.map((lane, i) => i === index ? { ...lane, [field]: value } : lane));
  }, []);

  const addTruck = useCallback(() => {
    setTrucks(prev => [...prev, { year: '', make: '', type: 'Dry Van', vin: '' }]);
  }, []);

  const removeTruck = useCallback((index) => {
    setTrucks(prev => prev.filter((_, i) => i !== index));
  }, []);

  const updateTruck = useCallback((index, field, value) => {
    setTrucks(prev => prev.map((truck, i) => i === index ? { ...truck, [field]: value } : truck));
  }, []);

  const saveProgress = useCallback(async (stepData) => {
    setSaving(true);
    setError('');
    try {
      await api.put('/users/me/onboarding', {
        step: activeStep,
        role,
        data: stepData,
      });
      setSuccess('Progress saved');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save progress');
    } finally {
      setSaving(false);
    }
  }, [activeStep, role]);

  const handleNext = async () => {
    let stepData = {};

    if (role === 'carrier') {
      switch (activeStep) {
        case 0: stepData = { companyInfo }; break;
        case 1: stepData = { equipmentTypes }; break;
        case 2: stepData = { preferredLanes: lanes.filter(l => l.origin && l.destination) }; break;
        case 3: stepData = { fleet: trucks.filter(t => t.year && t.make) }; break;
        case 4: stepData = { documentsUploaded: { insurance: !!documents.insurance, authority: !!documents.authority } }; break;
        case 5: stepData = { paymentSetup: true }; break;
        default: break;
      }
    } else {
      switch (activeStep) {
        case 0: stepData = { companyInfo: shipperCompany }; break;
        case 1: stepData = { shipmentTypes }; break;
        case 2: stepData = { primaryLanes: lanes.filter(l => l.origin && l.destination) }; break;
        case 3: stepData = { paymentSetup: true }; break;
        default: break;
      }
    }

    await saveProgress(stepData);

    if (activeStep === steps.length - 1) {
      // Final step - mark onboarding complete
      try {
        await api.put('/users/me/onboarding', { complete: true, role });
        if (onComplete) onComplete();
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to complete onboarding');
      }
    } else {
      setActiveStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    setActiveStep(prev => prev - 1);
  };

  const handleFileUpload = async (type, file) => {
    if (!file) return;
    const formData = new FormData();
    formData.append('document', file);
    formData.append('type', type);
    try {
      await api.post('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setDocuments(prev => ({ ...prev, [type]: file.name }));
      setSuccess(`${type} uploaded successfully`);
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setError(`Failed to upload ${type}`);
    }
  };

  // --- Step renderers ---

  const renderCarrierCompanyInfo = () => (
    <Grid container spacing={2}>
      <Grid item xs={12}>
        <Typography variant="h6" sx={{ color: text.primary, mb: 1 }}>Company Information</Typography>
      </Grid>
      <Grid item xs={12} sm={6}>
        <TextField fullWidth label="Company Name" value={companyInfo.name}
          onChange={e => handleCompanyField('name', e.target.value)} sx={darkFieldSx} />
      </Grid>
      <Grid item xs={12} sm={3}>
        <TextField fullWidth label="DOT #" value={companyInfo.dotNumber}
          onChange={e => handleCompanyField('dotNumber', e.target.value)} sx={darkFieldSx} />
      </Grid>
      <Grid item xs={12} sm={3}>
        <TextField fullWidth label="MC #" value={companyInfo.mcNumber}
          onChange={e => handleCompanyField('mcNumber', e.target.value)} sx={darkFieldSx} />
      </Grid>
      <Grid item xs={12}>
        <TextField fullWidth label="Street Address" value={companyInfo.address}
          onChange={e => handleCompanyField('address', e.target.value)} sx={darkFieldSx} />
      </Grid>
      <Grid item xs={12} sm={5}>
        <TextField fullWidth label="City" value={companyInfo.city}
          onChange={e => handleCompanyField('city', e.target.value)} sx={darkFieldSx} />
      </Grid>
      <Grid item xs={12} sm={3}>
        <FormControl fullWidth sx={darkFieldSx}>
          <InputLabel sx={{ color: text.secondary }}>State</InputLabel>
          <Select value={companyInfo.state} label="State"
            onChange={e => handleCompanyField('state', e.target.value)}>
            {US_STATES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </Select>
        </FormControl>
      </Grid>
      <Grid item xs={12} sm={4}>
        <TextField fullWidth label="ZIP Code" value={companyInfo.zip}
          onChange={e => handleCompanyField('zip', e.target.value)} sx={darkFieldSx} />
      </Grid>
    </Grid>
  );

  const renderEquipmentStep = () => (
    <Box>
      <Typography variant="h6" sx={{ color: text.primary, mb: 2 }}>Select Your Equipment Types</Typography>
      <FormGroup>
        <Grid container spacing={1}>
          {EQUIPMENT_TYPES.map(type => (
            <Grid item xs={6} sm={4} key={type}>
              <FormControlLabel
                control={
                  <Checkbox checked={equipmentTypes.includes(type)}
                    onChange={() => toggleEquipment(type)}
                    sx={{ color: text.secondary, '&.Mui-checked': { color: brand.primary } }} />
                }
                label={<Typography sx={{ color: text.primary }}>{type}</Typography>}
              />
            </Grid>
          ))}
        </Grid>
      </FormGroup>
    </Box>
  );

  const renderLanesStep = () => (
    <Box>
      <Typography variant="h6" sx={{ color: text.primary, mb: 2 }}>
        {role === 'carrier' ? 'Preferred Lanes' : 'Primary Shipping Lanes'}
      </Typography>
      {lanes.map((lane, idx) => (
        <Box key={idx} sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
          <FormControl sx={{ minWidth: 140, ...darkFieldSx }}>
            <InputLabel sx={{ color: text.secondary }}>Origin</InputLabel>
            <Select value={lane.origin} label="Origin"
              onChange={e => updateLane(idx, 'origin', e.target.value)}>
              {US_STATES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </Select>
          </FormControl>
          <Typography sx={{ color: text.secondary }}>to</Typography>
          <FormControl sx={{ minWidth: 140, ...darkFieldSx }}>
            <InputLabel sx={{ color: text.secondary }}>Destination</InputLabel>
            <Select value={lane.destination} label="Destination"
              onChange={e => updateLane(idx, 'destination', e.target.value)}>
              {US_STATES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </Select>
          </FormControl>
          {lanes.length > 1 && (
            <IconButton onClick={() => removeLane(idx)} sx={{ color: text.secondary }}>
              <Delete />
            </IconButton>
          )}
        </Box>
      ))}
      <Button startIcon={<Add />} onClick={addLane}
        sx={{ color: brand.primary, mt: 1 }}>
        Add Lane
      </Button>
    </Box>
  );

  const renderFleetStep = () => (
    <Box>
      <Typography variant="h6" sx={{ color: text.primary, mb: 2 }}>Fleet Information</Typography>
      {trucks.map((truck, idx) => (
        <Box key={idx} sx={{
          p: 2, mb: 2, borderRadius: 2,
          background: surface.glass, border: `1px solid ${surface.glassBorder}`
        }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={2}>
              <TextField fullWidth label="Year" value={truck.year}
                onChange={e => updateTruck(idx, 'year', e.target.value)} sx={darkFieldSx} />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField fullWidth label="Make" value={truck.make}
                onChange={e => updateTruck(idx, 'make', e.target.value)} sx={darkFieldSx} />
            </Grid>
            <Grid item xs={12} sm={3}>
              <FormControl fullWidth sx={darkFieldSx}>
                <InputLabel sx={{ color: text.secondary }}>Type</InputLabel>
                <Select value={truck.type} label="Type"
                  onChange={e => updateTruck(idx, 'type', e.target.value)}>
                  {EQUIPMENT_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField fullWidth label="VIN" value={truck.vin}
                onChange={e => updateTruck(idx, 'vin', e.target.value)} sx={darkFieldSx} />
            </Grid>
            <Grid item xs={12} sm={1}>
              {trucks.length > 1 && (
                <IconButton onClick={() => removeTruck(idx)} sx={{ color: text.secondary }}>
                  <Delete />
                </IconButton>
              )}
            </Grid>
          </Grid>
        </Box>
      ))}
      <Button startIcon={<Add />} onClick={addTruck}
        sx={{ color: brand.primary }}>
        Add Truck
      </Button>
    </Box>
  );

  const renderDocumentsStep = () => (
    <Box>
      <Typography variant="h6" sx={{ color: text.primary, mb: 2 }}>Upload Documents</Typography>
      <Grid container spacing={3}>
        <Grid item xs={12} sm={6}>
          <Box sx={{
            p: 3, borderRadius: 2, textAlign: 'center',
            background: surface.glass, border: `1px dashed ${surface.glassBorder}`
          }}>
            <CloudUpload sx={{ fontSize: 48, color: text.secondary, mb: 1 }} />
            <Typography sx={{ color: text.primary, mb: 1 }}>Insurance Certificate</Typography>
            {documents.insurance ? (
              <Chip label={documents.insurance} color="success" size="small"
                icon={<CheckCircle />} sx={{ mb: 1 }} />
            ) : null}
            <Button variant="outlined" component="label"
              sx={{ color: brand.primary, borderColor: brand.primary }}>
              Choose File
              <input type="file" hidden accept=".pdf,.jpg,.png"
                onChange={e => handleFileUpload('insurance', e.target.files[0])} />
            </Button>
          </Box>
        </Grid>
        <Grid item xs={12} sm={6}>
          <Box sx={{
            p: 3, borderRadius: 2, textAlign: 'center',
            background: surface.glass, border: `1px dashed ${surface.glassBorder}`
          }}>
            <CloudUpload sx={{ fontSize: 48, color: text.secondary, mb: 1 }} />
            <Typography sx={{ color: text.primary, mb: 1 }}>Operating Authority</Typography>
            {documents.authority ? (
              <Chip label={documents.authority} color="success" size="small"
                icon={<CheckCircle />} sx={{ mb: 1 }} />
            ) : null}
            <Button variant="outlined" component="label"
              sx={{ color: brand.primary, borderColor: brand.primary }}>
              Choose File
              <input type="file" hidden accept=".pdf,.jpg,.png"
                onChange={e => handleFileUpload('authority', e.target.files[0])} />
            </Button>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );

  const renderPaymentStep = () => (
    <Box sx={{ textAlign: 'center', py: 4 }}>
      <Typography variant="h6" sx={{ color: text.primary, mb: 2 }}>
        {role === 'carrier' ? 'Set Up Stripe Connect' : 'Set Up Payment Method'}
      </Typography>
      <Typography sx={{ color: text.secondary, mb: 3, maxWidth: 500, mx: 'auto' }}>
        {role === 'carrier'
          ? 'Connect your Stripe account to receive payments directly. You can also set this up later from your profile.'
          : 'Add a payment method to escrow funds for your shipments. You can also set this up later from your payments page.'}
      </Typography>
      <Button variant="contained"
        sx={{
          background: gradient.primary, color: text.primary,
          px: 4, py: 1.5, borderRadius: 3, fontWeight: 600
        }}
        onClick={() => {
          // Redirect to Stripe setup - handled in profile/payments pages
          handleNext();
        }}>
        Set Up Now
      </Button>
      <Typography variant="body2" sx={{ color: text.muted, mt: 2 }}>
        You can skip this step and set it up later.
      </Typography>
    </Box>
  );

  const renderShipperCompanyInfo = () => (
    <Grid container spacing={2}>
      <Grid item xs={12}>
        <Typography variant="h6" sx={{ color: text.primary, mb: 1 }}>Company Information</Typography>
      </Grid>
      <Grid item xs={12} sm={8}>
        <TextField fullWidth label="Company Name" value={shipperCompany.name}
          onChange={e => handleCompanyField('name', e.target.value)} sx={darkFieldSx} />
      </Grid>
      <Grid item xs={12} sm={4}>
        <TextField fullWidth label="Industry" value={shipperCompany.industry}
          onChange={e => handleCompanyField('industry', e.target.value)} sx={darkFieldSx}
          placeholder="e.g., Manufacturing, Agriculture" />
      </Grid>
      <Grid item xs={12}>
        <TextField fullWidth label="Street Address" value={shipperCompany.address}
          onChange={e => handleCompanyField('address', e.target.value)} sx={darkFieldSx} />
      </Grid>
      <Grid item xs={12} sm={5}>
        <TextField fullWidth label="City" value={shipperCompany.city}
          onChange={e => handleCompanyField('city', e.target.value)} sx={darkFieldSx} />
      </Grid>
      <Grid item xs={12} sm={3}>
        <FormControl fullWidth sx={darkFieldSx}>
          <InputLabel sx={{ color: text.secondary }}>State</InputLabel>
          <Select value={shipperCompany.state} label="State"
            onChange={e => handleCompanyField('state', e.target.value)}>
            {US_STATES.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </Select>
        </FormControl>
      </Grid>
      <Grid item xs={12} sm={4}>
        <TextField fullWidth label="ZIP Code" value={shipperCompany.zip}
          onChange={e => handleCompanyField('zip', e.target.value)} sx={darkFieldSx} />
      </Grid>
    </Grid>
  );

  const renderShipmentTypes = () => (
    <Box>
      <Typography variant="h6" sx={{ color: text.primary, mb: 2 }}>Typical Shipment Types</Typography>
      <Typography variant="subtitle2" sx={{ color: text.secondary, mb: 1 }}>Equipment Needed</Typography>
      <FormGroup>
        <Grid container spacing={1} sx={{ mb: 3 }}>
          {EQUIPMENT_TYPES.map(type => (
            <Grid item xs={6} sm={4} key={type}>
              <FormControlLabel
                control={
                  <Checkbox checked={shipmentTypes.equipment.includes(type)}
                    onChange={() => setShipmentTypes(prev => ({
                      ...prev,
                      equipment: prev.equipment.includes(type)
                        ? prev.equipment.filter(t => t !== type)
                        : [...prev.equipment, type]
                    }))}
                    sx={{ color: text.secondary, '&.Mui-checked': { color: brand.primary } }} />
                }
                label={<Typography sx={{ color: text.primary }}>{type}</Typography>}
              />
            </Grid>
          ))}
        </Grid>
      </FormGroup>
      <Typography variant="subtitle2" sx={{ color: text.secondary, mb: 1 }}>Weight Ranges</Typography>
      <FormGroup>
        <Grid container spacing={1} sx={{ mb: 3 }}>
          {WEIGHT_RANGES.map(range => (
            <Grid item xs={6} key={range}>
              <FormControlLabel
                control={
                  <Checkbox checked={shipmentTypes.weightRanges.includes(range)}
                    onChange={() => setShipmentTypes(prev => ({
                      ...prev,
                      weightRanges: prev.weightRanges.includes(range)
                        ? prev.weightRanges.filter(r => r !== range)
                        : [...prev.weightRanges, range]
                    }))}
                    sx={{ color: text.secondary, '&.Mui-checked': { color: brand.primary } }} />
                }
                label={<Typography sx={{ color: text.primary }}>{range}</Typography>}
              />
            </Grid>
          ))}
        </Grid>
      </FormGroup>
      <FormControl fullWidth sx={{ ...darkFieldSx, maxWidth: 300 }}>
        <InputLabel sx={{ color: text.secondary }}>Shipping Frequency</InputLabel>
        <Select value={shipmentTypes.frequency} label="Shipping Frequency"
          onChange={e => setShipmentTypes(prev => ({ ...prev, frequency: e.target.value }))}>
          {FREQUENCY_OPTIONS.map(f => <MenuItem key={f} value={f}>{f}</MenuItem>)}
        </Select>
      </FormControl>
    </Box>
  );

  const renderCurrentStep = () => {
    if (role === 'carrier') {
      switch (activeStep) {
        case 0: return renderCarrierCompanyInfo();
        case 1: return renderEquipmentStep();
        case 2: return renderLanesStep();
        case 3: return renderFleetStep();
        case 4: return renderDocumentsStep();
        case 5: return renderPaymentStep();
        default: return null;
      }
    } else {
      switch (activeStep) {
        case 0: return renderShipperCompanyInfo();
        case 1: return renderShipmentTypes();
        case 2: return renderLanesStep();
        case 3: return renderPaymentStep();
        default: return null;
      }
    }
  };

  return (
    <Box sx={{
      minHeight: '100vh',
      background: gradient.background,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      p: 3
    }}>
      <GlassPaper sx={{ maxWidth: 800, width: '100%' }}>
        <Typography variant="h4" sx={{
          color: text.primary, fontWeight: 700, mb: 1, textAlign: 'center'
        }}>
          Welcome to FreightConnect
        </Typography>
        <Typography sx={{ color: text.secondary, mb: 4, textAlign: 'center' }}>
          Let's get your {role} account set up
        </Typography>

        <Stepper activeStep={activeStep} alternativeLabel connector={<CustomConnector />}
          sx={{ mb: 4 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel
                StepIconProps={{
                  sx: {
                    color: surface.glassBorder,
                    '&.Mui-active': { color: brand.primary },
                    '&.Mui-completed': { color: brand.primary },
                  }
                }}
                sx={{
                  '& .MuiStepLabel-label': { color: text.secondary, fontSize: '0.8rem' },
                  '& .MuiStepLabel-label.Mui-active': { color: text.primary },
                  '& .MuiStepLabel-label.Mui-completed': { color: text.strong },
                }}>
                {label}
              </StepLabel>
            </Step>
          ))}
        </Stepper>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

        <Box sx={{ minHeight: 300 }}>
          {renderCurrentStep()}
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 4 }}>
          <Button disabled={activeStep === 0} onClick={handleBack}
            sx={{ color: text.secondary }}>
            Back
          </Button>
          <Box sx={{ display: 'flex', gap: 2 }}>
            {activeStep < steps.length - 1 && (
              <Button onClick={() => {
                if (activeStep === steps.length - 2) {
                  // Skip to finish
                  setActiveStep(steps.length - 1);
                } else {
                  setActiveStep(prev => prev + 1);
                }
              }} sx={{ color: text.muted }}>
                Skip
              </Button>
            )}
            <Button variant="contained" onClick={handleNext} disabled={saving}
              sx={{
                background: gradient.primary, color: text.primary,
                px: 4, borderRadius: 3, fontWeight: 600,
                '&:disabled': { opacity: 0.5 }
              }}>
              {saving ? <CircularProgress size={22} sx={{ color: text.primary }} /> :
                activeStep === steps.length - 1 ? 'Complete Setup' : 'Next'}
            </Button>
          </Box>
        </Box>
      </GlassPaper>
    </Box>
  );
}
