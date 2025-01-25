import React, { useEffect, useState } from 'react';
import api from '../services/api';
import Notifications from '../components/Notifications';

function CarrierDashboard() {
  const [loads, setLoads] = useState([]);
  const [error, setError] = useState(null);

  // Fetch all loads for the carrier
  useEffect(() => {
    const fetchLoads = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await api.get('/loads', {
          headers: { Authorization: `Bearer ${token}` },
        });
        setLoads(response.data);
      } catch (err) {
        console.error('Error fetching loads:', err.response?.data || err.message);
        setError('Failed to fetch loads');
      }
    };

    fetchLoads();
  }, []);

  // Handle accepting a load
  const handleAccept = async (loadId) => {
    try {
      const token = localStorage.getItem('token');
      await api.put(`/loads/${loadId}/accept`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // Update the status of the load to 'accepted'
      setLoads((prevLoads) =>
        prevLoads.map((load) =>
          load._id === loadId ? { ...load, status: 'accepted' } : load
        )
      );
    } catch (err) {
      console.error('Error accepting load:', err.response?.data || err.message);
      setError('Failed to accept load');
    }
  };

  // Handle marking a load as delivered
  const handleDeliver = async (loadId) => {
    try {
      const token = localStorage.getItem('token');
      await api.put(`/loads/${loadId}/deliver`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // Update the status of the load to 'delivered'
      setLoads((prevLoads) =>
        prevLoads.map((load) =>
          load._id === loadId ? { ...load, status: 'delivered' } : load
        )
      );
    } catch (err) {
      console.error('Error delivering load:', err.response?.data || err.message);
      setError('Failed to mark load as delivered');
    }
  };

  return (
    <div>
      <h2>Carrier Dashboard</h2>
      <Notifications />
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loads.length === 0 ? (
        <p>No loads available.</p>
      ) : (
        <ul>
          {loads.map((load) => (
            <li key={load._id}>
              {load.title} — {load.origin} to {load.destination} — ${load.rate} — Status: {load.status}
              {load.status === 'open' && (
                <button onClick={() => handleAccept(load._id)}>Accept</button>
              )}
              {load.status === 'accepted' && (
                <button onClick={() => handleDeliver(load._id)}>Mark as Delivered</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default CarrierDashboard;
