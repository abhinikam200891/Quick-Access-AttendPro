/**
 * Interactive Geofence Map Controller (Leaflet.js)
 * Provides Admin Geofence Coordinate Picker and Attendee Live Geofence Radar.
 */

import L from 'leaflet';
import '../css/geomap.css';
import { calculateDistanceMeters, formatDistance } from './haversine.js';

// OpenStreetMap & CartoDB Tile URL
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

/**
 * Custom SVG DivIcon for Venue Center
 */
function createVenueIcon() {
  return L.divIcon({
    className: 'custom-venue-pin-wrap',
    html: '<div class="custom-venue-pin"><span>📍</span></div>',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  });
}

/**
 * Custom SVG DivIcon for User / Attendee Location
 */
function createUserIcon() {
  return L.divIcon({
    className: 'custom-user-pin-wrap',
    html: '<div class="custom-user-pin"></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
}

/**
 * 1. ADMIN GEOFENCE PICKER
 * Allows clicking/dragging to set venue coordinates and visual geofence circle.
 */
export function initAdminGeofencePicker(containerId, initialCoords = {}, initialRadius = 50, onChange = null) {
  const container = document.getElementById(containerId);
  if (!container) return null;

  let lat = 28.6139;
  let lon = 77.2090;
  let radius = 50;
  let callback = typeof onChange === 'function' ? onChange : null;

  if (typeof initialCoords === 'object' && initialCoords !== null) {
    lat = initialCoords.latitude || initialCoords.initialLat || initialCoords.lat || 28.6139;
    lon = initialCoords.longitude || initialCoords.initialLng || initialCoords.lng || 77.2090;
    if (initialCoords.initialRadius) radius = initialCoords.initialRadius;
    if (typeof initialCoords.onLocationChange === 'function') callback = initialCoords.onLocationChange;
  }
  if (typeof initialRadius === 'number') radius = initialRadius;
  if (typeof initialRadius === 'function') callback = initialRadius;

  // Initialize Leaflet Map
  const map = L.map(container, {
    center: [lat, lon],
    zoom: 16,
    zoomControl: true,
    attributionControl: false
  });

  L.tileLayer(TILE_URL, {
    maxZoom: 19,
    attribution: TILE_ATTRIBUTION
  }).addTo(map);

  // Venue Center Marker
  const marker = L.marker([lat, lon], {
    icon: createVenueIcon(),
    draggable: true
  }).addTo(map);

  marker.bindPopup('<strong>Venue Center Point</strong><br>Drag pin or click map to change location.');

  // Circular Geofence Boundary
  const circle = L.circle([lat, lon], {
    radius: radius,
    color: '#6366f1',
    fillColor: '#818cf8',
    fillOpacity: 0.25,
    weight: 2
  }).addTo(map);

  function updatePosition(newLat, newLon, newRadius = null) {
    const curRadius = newRadius !== null ? newRadius : circle.getRadius();
    marker.setLatLng([newLat, newLon]);
    circle.setLatLng([newLat, newLon]);
    circle.setRadius(curRadius);

    if (callback) {
      callback({
        latitude: Math.round(newLat * 1000000) / 1000000,
        longitude: Math.round(newLon * 1000000) / 1000000,
        lat: Math.round(newLat * 1000000) / 1000000,
        lng: Math.round(newLon * 1000000) / 1000000,
        radius: curRadius
      });
    }
  }

  // Handle marker drag
  marker.on('dragend', () => {
    const pos = marker.getLatLng();
    updatePosition(pos.lat, pos.lng);
  });

  // Handle map click
  map.on('click', (e) => {
    updatePosition(e.latlng.lat, e.latlng.lng);
  });

  // Invalidate size on container visibility
  setTimeout(() => map.invalidateSize(), 300);

  return {
    map,
    setCoordinates: (cLat, cLon) => {
      updatePosition(cLat, cLon);
      map.setView([cLat, cLon], map.getZoom());
    },
    setRadius: (r) => {
      circle.setRadius(r);
    },
    invalidateSize: () => {
      map.invalidateSize();
    },
    destroy: () => map.remove()
  };
}

/**
 * 2. ATTENDEE / HOST LIVE RADAR MINI-MAP
 * Shows venue location, 50m geofence perimeter, user's current GPS pin, and live distance line.
 */
export function initAttendeeRadarMap(containerId, venueCoords, radiusMeters = 50, userCoords = null) {
  const container = document.getElementById(containerId);
  if (!container) return null;

  const vLat = venueCoords.latitude;
  const vLon = venueCoords.longitude;
  const radius = radiusMeters || 50;

  // Initialize Map
  const map = L.map(container, {
    center: [vLat, vLon],
    zoom: 17,
    zoomControl: false,
    attributionControl: false
  });

  L.tileLayer(TILE_URL, {
    maxZoom: 19
  }).addTo(map);

  // Venue Marker
  const venueMarker = L.marker([vLat, vLon], {
    icon: createVenueIcon()
  }).addTo(map);

  // Geofence Circle
  const geofenceCircle = L.circle([vLat, vLon], {
    radius: radius,
    color: '#10b981',
    fillColor: '#34d399',
    fillOpacity: 0.2,
    weight: 2
  }).addTo(map);

  // User Marker & Connecting Line
  let userMarker = null;
  let userAccuracyCircle = null;
  let distanceLine = null;

  function updateUserLocation(coords) {
    if (!coords || !coords.latitude || !coords.longitude) return;

    const uLat = coords.latitude;
    const uLon = coords.longitude;
    const accuracy = coords.accuracy || 15;

    const distance = calculateDistanceMeters(uLat, uLon, vLat, vLon);
    const isInside = distance <= radius;

    // Update Circle Color (Green if inside, Red if outside)
    geofenceCircle.setStyle({
      color: isInside ? '#10b981' : '#f43f5e',
      fillColor: isInside ? '#34d399' : '#fb7185'
    });

    // User Pin
    if (!userMarker) {
      userMarker = L.marker([uLat, uLon], { icon: createUserIcon() }).addTo(map);
    } else {
      userMarker.setLatLng([uLat, uLon]);
    }

    // Accuracy Circle
    if (!userAccuracyCircle) {
      userAccuracyCircle = L.circle([uLat, uLon], {
        radius: Math.min(accuracy, 60),
        color: '#0ea5e9',
        fillColor: '#38bdf8',
        fillOpacity: 0.15,
        weight: 1,
        dashArray: '3, 6'
      }).addTo(map);
    } else {
      userAccuracyCircle.setLatLng([uLat, uLon]);
      userAccuracyCircle.setRadius(Math.min(accuracy, 60));
    }

    // Connecting Distance Line
    const lineCoords = [[uLat, uLon], [vLat, vLon]];
    const distText = `${formatDistance(distance)} (Allowed: ${radius}m)`;

    if (!distanceLine) {
      distanceLine = L.polyline(lineCoords, {
        color: isInside ? '#059669' : '#e11d48',
        weight: 3,
        dashArray: '6, 8'
      }).addTo(map);

      distanceLine.bindTooltip(distText, {
        permanent: true,
        direction: 'center',
        className: 'distance-tooltip'
      });
    } else {
      distanceLine.setLatLngs(lineCoords);
      distanceLine.setStyle({
        color: isInside ? '#059669' : '#e11d48'
      });
      distanceLine.setTooltipContent(distText);
    }

    // Fit map bounds to view both venue and user comfortably
    const bounds = L.latLngBounds([
      [vLat, vLon],
      [uLat, uLon]
    ]).pad(0.35);

    map.fitBounds(bounds, { maxZoom: 18 });
  }

  if (userCoords) {
    updateUserLocation(userCoords);
  }

  setTimeout(() => map.invalidateSize(), 300);

  return {
    map,
    updateUserLocation,
    invalidateSize: () => map.invalidateSize(),
    destroy: () => map.remove()
  };
}
