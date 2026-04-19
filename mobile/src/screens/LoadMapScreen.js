import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Dimensions, Platform,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { Linking } from 'react-native';
import { COLORS } from '../constants/config';

const { width } = Dimensions.get('window');

export default function LoadMapScreen({ route }) {
  const { load } = route.params;
  const mapRef = useRef(null);

  // Parse coordinates from load — support multiple field layouts
  const origin = {
    latitude: load.originLat || load.originCoords?.lat || 0,
    longitude: load.originLng || load.originCoords?.lng || 0,
  };
  const destination = {
    latitude: load.destinationLat || load.destinationCoords?.lat || 0,
    longitude: load.destinationLng || load.destinationCoords?.lng || 0,
  };

  const hasValidCoords =
    origin.latitude !== 0 && origin.longitude !== 0 &&
    destination.latitude !== 0 && destination.longitude !== 0;

  // Fit map to show both markers
  useEffect(() => {
    if (mapRef.current && hasValidCoords) {
      setTimeout(() => {
        mapRef.current.fitToCoordinates([origin, destination], {
          edgePadding: { top: 100, right: 80, bottom: 200, left: 80 },
          animated: true,
        });
      }, 500);
    }
  }, [hasValidCoords]);

  // Open in Google Maps for turn-by-turn navigation
  const openNavigation = () => {
    const url = Platform.select({
      ios: `maps://app?saddr=${origin.latitude},${origin.longitude}&daddr=${destination.latitude},${destination.longitude}`,
      default: `https://www.google.com/maps/dir/?api=1&origin=${origin.latitude},${origin.longitude}&destination=${destination.latitude},${destination.longitude}&travelmode=driving`,
    });
    Linking.openURL(url).catch(() => {
      // Fallback to Google Maps web URL
      Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&origin=${origin.latitude},${origin.longitude}&destination=${destination.latitude},${destination.longitude}&travelmode=driving`
      );
    });
  };

  if (!hasValidCoords) {
    return (
      <View style={styles.container}>
        <View style={styles.noDataContainer}>
          <Text style={styles.noDataIcon}>📍</Text>
          <Text style={styles.noDataTitle}>No Coordinates Available</Text>
          <Text style={styles.noDataSub}>
            This load does not have GPS coordinates for the origin or destination.
          </Text>
        </View>
      </View>
    );
  }

  // Build a straight-line route polyline between origin and destination
  const routeCoords = [origin, destination];

  return (
    <View style={styles.container}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: (origin.latitude + destination.latitude) / 2,
          longitude: (origin.longitude + destination.longitude) / 2,
          latitudeDelta: Math.abs(origin.latitude - destination.latitude) * 1.5 || 5,
          longitudeDelta: Math.abs(origin.longitude - destination.longitude) * 1.5 || 5,
        }}
        customMapStyle={darkMapStyle}
      >
        {/* Origin marker */}
        <Marker coordinate={origin} title="Pickup" description={load.origin || 'Origin'}>
          <View style={styles.markerContainer}>
            <View style={[styles.markerDot, { backgroundColor: COLORS.success }]} />
            <Text style={styles.markerLabel}>P</Text>
          </View>
        </Marker>

        {/* Destination marker */}
        <Marker coordinate={destination} title="Delivery" description={load.destination || 'Destination'}>
          <View style={styles.markerContainer}>
            <View style={[styles.markerDot, { backgroundColor: COLORS.error }]} />
            <Text style={styles.markerLabel}>D</Text>
          </View>
        </Marker>

        {/* Route line */}
        <Polyline
          coordinates={routeCoords}
          strokeColor="#00C7B7"
          strokeWidth={3}
          lineDashPattern={[8, 4]}
        />
      </MapView>

      {/* Info overlay card */}
      <View style={styles.infoCard}>
        <Text style={styles.loadTitle} numberOfLines={1}>{load.title || 'Load'}</Text>

        <View style={styles.addressRow}>
          <View style={[styles.dot, { backgroundColor: COLORS.success }]} />
          <View style={styles.addressText}>
            <Text style={styles.addressLabel}>PICKUP</Text>
            <Text style={styles.addressValue} numberOfLines={1}>{load.origin || 'N/A'}</Text>
          </View>
        </View>

        <View style={styles.dividerLine} />

        <View style={styles.addressRow}>
          <View style={[styles.dot, { backgroundColor: COLORS.error }]} />
          <View style={styles.addressText}>
            <Text style={styles.addressLabel}>DELIVERY</Text>
            <Text style={styles.addressValue} numberOfLines={1}>{load.destination || 'N/A'}</Text>
          </View>
        </View>

        {/* Navigate button */}
        <TouchableOpacity style={styles.navButton} onPress={openNavigation}>
          <Text style={styles.navButtonText}>Navigate</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Dark map style (Google Maps compatible)
const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#0a1628' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0a1628' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#1a2744' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a2744' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0d1b2a' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2a3f5f' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d1b2a' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#111b2e' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#111b2e' }] },
];

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a1628',
  },
  map: {
    flex: 1,
  },
  // Marker
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#fff',
  },
  markerLabel: {
    position: 'absolute',
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
  },
  // Info card overlay
  infoCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0a1628',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 199, 183, 0.2)',
  },
  loadTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 16,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  addressText: {
    flex: 1,
  },
  addressLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 2,
  },
  addressValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  dividerLine: {
    height: 16,
    width: 2,
    backgroundColor: 'rgba(0, 199, 183, 0.3)',
    marginLeft: 4,
    marginVertical: 2,
  },
  navButton: {
    marginTop: 16,
    backgroundColor: '#00C7B7',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  navButtonText: {
    color: '#0a1628',
    fontSize: 16,
    fontWeight: '800',
  },
  // No data state
  noDataContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  noDataIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  noDataTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  noDataSub: {
    color: '#6b7280',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
