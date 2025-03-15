import React, { useState } from 'react';
import { Autocomplete, TextField } from '@mui/material';
import axios from 'axios';

const LocationAutocomplete = ({ label, value, onChange }) => {
  const [options, setOptions] = useState([]);

  const fetchLocations = async (query) => {
    if (query.length < 3) return;

    try {
      const { data } = await axios.get(
        `https://nominatim.openstreetmap.org/search?city=${encodeURIComponent(
          query
        )}&countrycodes=us&format=json&addressdetails=1`
      );

      setOptions(data.map((location) => ({
        label: location.display_name,
        lat: location.lat,
        lng: location.lon,
      })));
    } catch (err) {
      console.error('Error fetching locations:', err);
    }
  };

  return (
    <Autocomplete
      options={options}
      getOptionLabel={(option) => option.label}
      value={value ? { label: value } : null}
      onInputChange={(e, newInput) => fetchLocations(newInput)}
      onChange={(e, newValue) => onChange(newValue)}
      renderInput={(params) => <TextField {...params} label={label} required />}
    />
  );
};

export default LocationAutocomplete;
