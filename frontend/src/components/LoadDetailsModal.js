import React, { useState, useEffect } from 'react';
import { Modal, Box, Typography, Button } from '@mui/material';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../services/api';

// 📌 Map Auto-fit Component
function FitMapView({ route }) {
    const map = useMap();
    useEffect(() => {
        if (route.length > 0) {
            map.fitBounds(route);
        }
    }, [route, map]);
    return null;
}

function LoadDetailsModal({ load, onClose }) {
    const [route, setRoute] = useState([]);
    const [mapCenter, setMapCenter] = useState([37.0902, -95.7129]); // Default: USA center
    const [distanceToOrigin, setDistanceToOrigin] = useState(null);
    const [distanceToDestination, setDistanceToDestination] = useState(null);
    const [estimatedTime, setEstimatedTime] = useState(null);
    const [currentLocation, setCurrentLocation] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (load) {
            getCurrentLocation();
            fetchRoute(load.origin, load.destination);
        }
    }, [load]);

    // 📌 Get Current Location of User
    const getCurrentLocation = () => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const coords = [position.coords.latitude, position.coords.longitude];
                    setCurrentLocation(coords);
                    console.log("📍 User Location:", coords);
                    fetchDistance(coords, load.origin, "toOrigin");
                },
                (error) => console.error("Error fetching location:", error)
            );
        }
    };

    // 🛣 Fetch Route Data
    const fetchRoute = async (origin, destination) => {
        try {
            const fetchCoords = async (location) => {
                const response = await fetch(
                    `https://nominatim.openstreetmap.org/search?format=json&q=${location}`
                );
                const data = await response.json();
                return data.length > 0 ? [parseFloat(data[0].lon), parseFloat(data[0].lat)] : null;
            };

            const originCoords = await fetchCoords(origin);
            const destinationCoords = await fetchCoords(destination);

            if (!originCoords || !destinationCoords) {
                throw new Error("Invalid location data received.");
            }

            console.log(`📍 Coordinates: ${origin} → ${originCoords}, ${destination} → ${destinationCoords}`);

            // Fetch route data from backend
            const response = await fetch(
                `http://localhost:5000/api/get-route?start=${originCoords.join(",")}&end=${destinationCoords.join(",")}`
            );

            if (!response.ok) {
                throw new Error("Failed to fetch route.");
            }

            const data = await response.json();
            console.log("🗺 Route Data:", data);

            if (data.features && data.features.length > 0) {
                const routeCoordinates = data.features[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
                setRoute(routeCoordinates);
                setMapCenter(originCoords);

                // Extract Distance & Time
                const routeDistance = data.features[0].properties.segments[0].distance / 1609; // Meters → Miles
                const estimatedTime = (data.features[0].properties.segments[0].duration / 3600).toFixed(2); // Seconds → Hours

                setDistanceToDestination(routeDistance);
                setEstimatedTime(estimatedTime);
            } else {
                console.error("No valid route found.");
                setRoute([]);
                setDistanceToDestination(null);
                setEstimatedTime(null);
            }

        } catch (err) {
            console.error("Error fetching route:", err.message);
            setRoute([]);
            setDistanceToDestination(null);
            setEstimatedTime(null);
        }
    };

    // 📍 Calculate Distance from Current Location to Load Origin
    const fetchDistance = async (start, end, type) => {
        try {
            const fetchCoords = async (location) => {
                const response = await fetch(
                    `https://nominatim.openstreetmap.org/search?format=json&q=${location}`
                );
                const data = await response.json();
                return data.length > 0 ? [parseFloat(data[0].lon), parseFloat(data[0].lat)] : null;
            };

            const endCoords = await fetchCoords(end);
            if (!start || !endCoords) {
                throw new Error("Invalid location data.");
            }

            const response = await fetch(
                `http://localhost:5000/api/get-route?start=${start.join(",")}&end=${endCoords.join(",")}`
            );
            const data = await response.json();

            if (data.features && data.features.length > 0) {
                const distance = data.features[0].properties.segments[0].distance / 1609; // Convert meters to miles
                if (type === "toOrigin") {
                    setDistanceToOrigin(distance);
                }
            }
        } catch (err) {
            console.error("Error calculating distance:", err.message);
        }
    };

    return (
        <Modal open={!!load} onClose={onClose}>
            <Box sx={{ p: 4, backgroundColor: 'white', borderRadius: 2, maxWidth: 600, margin: 'auto' }}>
                <Typography variant="h5" gutterBottom>Load Details</Typography>
                {error && <Typography color="error">{error}</Typography>}
                
                <Typography><strong>Title:</strong> {load.title}</Typography>
                <Typography><strong>Origin:</strong> {load.origin}</Typography>
                <Typography><strong>Destination:</strong> {load.destination}</Typography>
                <Typography><strong>Rate:</strong> ${load.rate}</Typography>
                <Typography><strong>Status:</strong> {load.status}</Typography>

                {route.length > 0 && (
                    <MapContainer center={mapCenter} zoom={6} style={{ height: "300px", width: "100%", marginTop: "10px" }}>
                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                        <FitMapView route={route} />
                        {currentLocation && <Marker position={currentLocation} />}
                        <Marker position={route[0]} />
                        <Marker position={route[route.length - 1]} />
                        <Polyline positions={route} color="blue" />
                    </MapContainer>
                )}

                <Typography sx={{ mt: 2 }}>
                    <strong>Current Location → Origin:</strong> {distanceToOrigin ? `${distanceToOrigin.toFixed(2)} miles` : "Calculating..."} <br />
                    <strong>Origin → Destination:</strong> {distanceToDestination ? `${distanceToDestination.toFixed(2)} miles` : "Calculating..."} <br />
                    <strong>Total Distance:</strong> {distanceToOrigin && distanceToDestination ? `${(distanceToOrigin + distanceToDestination).toFixed(2)} miles` : "To be calculated"} <br />
                    <strong>Estimated Time:</strong> {estimatedTime ? `${estimatedTime} hours` : "Calculating..."}
                </Typography>

                {load.status === 'open' && (
                    <Button variant="contained" color="primary" sx={{ mt: 2 }} onClick={() => alert("Load Accepted!")}>
                        Accept Load
                    </Button>
                )}

                <Button variant="contained" color="secondary" sx={{ mt: 2, ml: 2 }} onClick={onClose}>
                    Close
                </Button>
            </Box>
        </Modal>
    );
}

export default LoadDetailsModal;
