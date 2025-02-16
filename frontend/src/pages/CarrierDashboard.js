import React, { useState, useEffect } from 'react';
import { Typography, Box, Paper, Button } from '@mui/material';
import api from '../services/api';
import LoadCard from '../components/LoadCard';
import LoadDetailsModal from '../components/LoadDetailsModal';

function CarrierDashboard() {
    const [loads, setLoads] = useState([]);
    const [selectedLoad, setSelectedLoad] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchLoads = async () => {
            try {
                const token = localStorage.getItem('token');
                if (!token) throw new Error('No token found');
                const response = await api.get('/loads', {
                    headers: { Authorization: `Bearer ${token}` },
                });

                setLoads(response.data.filter(load => load.status === 'open')); // Show only open loads
            } catch (err) {
                console.error('Error fetching loads:', err.response?.data || err.message);
                setError('Failed to fetch loads.');
            }
        };

        fetchLoads();
    }, []);

    return (
        <Box sx={{ maxWidth: 1200, margin: '0 auto', p: 2 }}>
            <Typography variant="h4" gutterBottom>Carrier Dashboard</Typography>
            {error && <Typography color="error">{error}</Typography>}

            {/* Display Open Loads */}
            {loads.length > 0 ? (
                loads.map((load) => (
                    <LoadCard 
                        key={load._id} 
                        load={load} 
                        onViewDetails={() => setSelectedLoad(load)} 
                    />
                ))
            ) : (
                <Typography>No available loads.</Typography>
            )}

            {/* Load Details Modal */}
            {selectedLoad && (
                <LoadDetailsModal
                    load={selectedLoad}
                    onClose={() => setSelectedLoad(null)}
                />
            )}
        </Box>
    );
}

export default CarrierDashboard;
