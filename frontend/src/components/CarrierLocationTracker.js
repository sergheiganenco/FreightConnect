// src/components/CarrierLocationTracker.js
import { useEffect } from "react";
import { io } from "socket.io-client";

const socket = io('http://localhost:5000'); // Adjust URL based on your environment

function CarrierLocationTracker({ loadId }) {
  useEffect(() => {
    if (!loadId) return;

    if ("geolocation" in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        ({ coords }) => {
          const { latitude, longitude } = coords;

          socket.emit("updateCarrierLocation", { loadId, latitude, longitude });
          console.log(`Location updated: [${latitude}, ${longitude}]`);
        },
        (error) => {
          console.error("Geolocation error:", error);
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 60000 }
      );

      return () => navigator.geolocation.clearWatch(watchId);
    } else {
      console.error("Geolocation not supported.");
    }
  }, [loadId]);

  return null; // This component renders no UI
}

export default CarrierLocationTracker;
