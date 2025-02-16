import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const MapComponent = ({ position }) => {
  const [mapPosition, setMapPosition] = useState(position || [40.7128, -74.0060]); // Default to New York City

  useEffect(() => {
    if (position) {
      setMapPosition(position);
    }
  }, [position]);

  return (
    <MapContainer center={mapPosition} zoom={10} style={{ height: '400px', width: '100%', borderRadius: '10px' }}>
      {/* OpenStreetMap Tile Layer */}
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {/* Marker for the Load Location */}
      <Marker position={mapPosition}>
        <Popup>Load Location</Popup>
      </Marker>
    </MapContainer>
  );
};

export default MapComponent;
