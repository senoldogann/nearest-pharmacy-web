const state = {
  map: null,
  originMarker: null,
  markers: [],
  origin: null,
  pharmacies: [],
  controller: null,
};

const els = {
  locate: document.getElementById('locate'),
  form: document.getElementById('search-form'),
  address: document.getElementById('address'),
  matches: document.getElementById('matches'),
  radius: document.getElementById('radius'),
  status: document.getElementById('status'),
  results: document.getElementById('results'),
  map: document.getElementById('map'),
};

const HAS_LEAFLET = typeof window.L !== 'undefined';

init();

function init() {
  if (HAS_LEAFLET) {
    state.map = L.map(els.map, { zoomControl: true, attributionControl: true }).setView([60.17, 24.94], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(state.map);
  } else {
    els.map.textContent = 'The map could not load. The list still works.';
  }

  els.locate.addEventListener('click', locate);
  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    searchAddress(els.address.value);
  });
  els.radius.addEventListener('change', () => {
    if (state.origin) loadPharmacies(state.origin);
  });

  const shared = sharedLocation();
  if (shared) {
    startSearch(shared, 'Shared location');
    return;
  }

  if (navigator.permissions?.query) {
    navigator.permissions.query({ name: 'geolocation' }).then((permission) => {
      if (permission.state === 'granted') locate({ quiet: true });
    }).catch(() => {});
  }
}

function locate({ quiet = false } = {}) {
  if (!('geolocation' in navigator)) {
    setStatus('This browser cannot share your location. Search for an address instead.', 'error');
    return;
  }
  setStatus(quiet ? '' : 'Finding your location…', 'busy');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      startSearch({ lat: latitude, lon: longitude }, 'Your location');
    },
    (error) => {
      const messages = {
        1: 'Location permission was denied. Type an address to search instead.',
        2: 'Your location is not available right now. Type an address instead.',
        3: 'Finding your location took too long. Type an address instead.',
      };
      setStatus(messages[error.code] ?? 'Could not get your location. Type an address instead.', 'error');
    },
    { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
  );
}

async function searchAddress(query) {
  const q = query.trim();
  if (q.length < 2) {
    setStatus('Type at least two characters, or share your location.', 'error');
    return;
  }
  hideMatches();
  setStatus('Looking up that address…', 'busy');
  try {
    const response = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Address lookup failed');
    const results = data.results ?? [];
    if (results.length === 0) {
      setStatus(`No place found for “${q}”. Try a city and a street name.`, 'error');
      return;
    }
    if (results.length === 1) {
      startSearch(results[0], results[0].label);
    } else {
      showMatches(results);
      setStatus('Pick the right place from the list.');
    }
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

function showMatches(results) {
  els.matches.hidden = false;
  els.matches.replaceChildren(
    ...results.map((result) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = result.label;
      button.addEventListener('click', () => {
        hideMatches();
        startSearch(result, result.label);
      });
      return button;
    }),
  );
}

function hideMatches() {
  els.matches.hidden = true;
  els.matches.replaceChildren();
}

function sharedLocation() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('lat') || !params.has('lon')) return null;
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (params.has('radius')) els.radius.value = String(Math.min(10_000, Math.max(500, Number(params.get('radius')) || 2000)));
  return { lat, lon };
}

function rememberInUrl(origin) {
  const params = new URLSearchParams({ lat: origin.lat.toFixed(5), lon: origin.lon.toFixed(5), radius: els.radius.value });
  history.replaceState(null, '', `${window.location.pathname}?${params}`);
}

async function startSearch(origin, label) {
  state.origin = origin;
  rememberInUrl(origin);
  state.controller?.abort();
  state.controller = new AbortController();
  els.address.value = label === 'Your location' || label === 'Shared location' ? '' : label;
  drawOrigin(origin, label);

  const radius = Number(els.radius.value);
  setStatus('Finding pharmacies nearby…', 'busy');
  try {
    const response = await fetch(
      `/api/pharmacies?lat=${origin.lat}&lon=${origin.lon}&radius=${radius}`,
      { signal: state.controller.signal },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Could not load pharmacies');
    state.pharmacies = data.pharmacies;
    render(data);
  } catch (error) {
    if (error.name === 'AbortError') return;
    setStatus(error.message, 'error');
  }
}

function render(data) {
  const { pharmacies } = data;
  els.results.replaceChildren(...pharmacies.map((pharmacy, index) => resultCard(pharmacy, index)));
  drawMarkers(pharmacies);

  if (pharmacies.length === 0) {
    setStatus(`No pharmacy within ${formatDistance(data.radius)}. Try a larger radius.`, 'error');
    return;
  }
  const nearest = pharmacies[0];
  const viaAddressIndex = data.source === 'nominatim'
    ? ' The map index is busy, so these come from the address index.'
    : '';
  setStatus(
    `${pharmacies.length} ${pharmacies.length === 1 ? 'pharmacy' : 'pharmacies'} within ${formatDistance(data.radius)}. ` +
    `Nearest: ${nearest.name}, ${formatDistance(nearest.distanceMeters)} away.${viaAddressIndex}`,
  );
}

function resultCard(pharmacy, index) {
  const item = document.createElement('li');
  item.className = 'result';

  const head = document.createElement('div');
  head.className = 'head';
  const title = document.createElement('h3');
  title.textContent = pharmacy.name;
  const distance = document.createElement('span');
  distance.className = 'distance';
  distance.textContent = formatDistance(pharmacy.distanceMeters);
  head.append(title, distance);

  const meta = document.createElement('p');
  meta.className = 'meta';
  const address = document.createElement('span');
  address.textContent = pharmacy.address ?? 'Address not in OpenStreetMap';
  meta.append(address);

  if (pharmacy.openingHours) {
    const hours = document.createElement('p');
    hours.className = 'meta hours';
    hours.textContent = `Hours: ${pharmacy.openingHours}`;
    item.append(head, meta, hours);
  } else {
    item.append(head, meta);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';

  const show = document.createElement('button');
  show.type = 'button';
  show.textContent = 'Show on map';
  show.addEventListener('click', () => focusPharmacy(index));
  actions.append(show);

  const directions = document.createElement('a');
  directions.href = directionsUrl(pharmacy);
  directions.target = '_blank';
  directions.rel = 'noopener';
  directions.textContent = 'Directions';
  actions.append(directions);

  if (pharmacy.website) {
    const site = document.createElement('a');
    site.href = pharmacy.website;
    site.target = '_blank';
    site.rel = 'noopener noreferrer';
    site.textContent = 'Website';
    actions.append(site);
  }

  item.append(actions);
  return item;
}

function directionsUrl(pharmacy) {
  return `https://www.google.com/maps/dir/?api=1&destination=${pharmacy.lat},${pharmacy.lon}&travelmode=walking`;
}

function drawOrigin(origin, label) {
  if (!state.map) return;
  state.originMarker?.remove();
  state.originMarker = L.marker([origin.lat, origin.lon], {
    icon: L.divIcon({ className: '', html: '<div class="pin origin" title="Your location"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
    keyboard: false,
    title: label,
  }).addTo(state.map);
  state.map.setView([origin.lat, origin.lon], zoomForRadius(Number(els.radius.value)));
}

function drawMarkers(pharmacies) {
  if (!state.map) return;
  for (const marker of state.markers) marker.remove();
  state.markers = pharmacies.map((pharmacy) =>
    L.marker([pharmacy.lat, pharmacy.lon], {
      icon: L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [18, 18], iconAnchor: [9, 18] }),
      title: pharmacy.name,
    })
      .addTo(state.map)
      .bindPopup(popupHtml(pharmacy)),
  );

  if (pharmacies.length > 0 && state.origin) {
    const bounds = L.latLngBounds([
      [state.origin.lat, state.origin.lon],
      ...pharmacies.map((p) => [p.lat, p.lon]),
    ]);
    state.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }
}

function popupHtml(pharmacy) {
  const wrap = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'popup-name';
  name.textContent = pharmacy.name;
  const meta = document.createElement('div');
  meta.className = 'popup-meta';
  meta.textContent = [formatDistance(pharmacy.distanceMeters), pharmacy.address].filter(Boolean).join(' · ');
  wrap.append(name, meta);
  return wrap;
}

function focusPharmacy(index) {
  const pharmacy = state.pharmacies[index];
  if (!state.map) return;
  state.map.setView([pharmacy.lat, pharmacy.lon], 17);
  state.markers[index]?.openPopup();
}

function zoomForRadius(meters) {
  if (meters <= 500) return 16;
  if (meters <= 1000) return 15;
  if (meters <= 2000) return 15;
  if (meters <= 5000) return 14;
  return 13;
}

function setStatus(text, kind = '') {
  els.status.textContent = text;
  els.status.className = `status ${kind}`.trim();
}

function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}
