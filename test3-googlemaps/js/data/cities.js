/* ============================================================
   TERRA — data/cities.js
   Hand-authored city database (coordinates from general
   knowledge, no downloaded data). `detail:true` cities get
   full procedural 3D districts (see js/cities.js).
   ============================================================ */
(function () {
  'use strict';
  var T = window.TERRA;

  // [id, name, country, lat, lon, population(millions), utcOffset, detail]
  var rows = [
    ['nyc', 'New York', 'United States', 40.7128, -74.0060, 8.3, -5, true],
    ['tokyo', 'Tokyo', 'Japan', 35.6762, 139.6503, 14.0, 9, true],
    ['paris', 'Paris', 'France', 48.8566, 2.3522, 2.2, 1, true],
    ['london', 'London', 'United Kingdom', 51.5074, -0.1278, 9.0, 0],
    ['losangeles', 'Los Angeles', 'United States', 34.0522, -118.2437, 3.9, -8],
    ['sanfrancisco', 'San Francisco', 'United States', 37.7749, -122.4194, 0.87, -8],
    ['chicago', 'Chicago', 'United States', 41.8781, -87.6298, 2.7, -6],
    ['seattle', 'Seattle', 'United States', 47.6062, -122.3321, 0.74, -8],
    ['miami', 'Miami', 'United States', 25.7617, -80.1918, 0.44, -5],
    ['boston', 'Boston', 'United States', 42.3601, -71.0589, 0.68, -5],
    ['washington', 'Washington D.C.', 'United States', 38.9072, -77.0369, 0.7, -5],
    ['lasvegas', 'Las Vegas', 'United States', 36.1699, -115.1398, 0.64, -8],
    ['denver', 'Denver', 'United States', 39.7392, -104.9903, 0.72, -7],
    ['neworleans', 'New Orleans', 'United States', 29.9511, -90.0715, 0.38, -6],
    ['honolulu', 'Honolulu', 'United States', 21.3069, -157.8583, 0.35, -10],
    ['anchorage', 'Anchorage', 'United States', 61.2181, -149.9003, 0.29, -9],
    ['toronto', 'Toronto', 'Canada', 43.6532, -79.3832, 2.9, -5],
    ['vancouver', 'Vancouver', 'Canada', 49.2827, -123.1207, 0.66, -8],
    ['mexicocity', 'Mexico City', 'Mexico', 19.4326, -99.1332, 9.2, -6],
    ['havana', 'Havana', 'Cuba', 23.1136, -82.3666, 2.1, -5],
    ['bogota', 'Bogotá', 'Colombia', 4.7110, -74.0721, 7.4, -5],
    ['lima', 'Lima', 'Peru', -12.0464, -77.0428, 9.7, -5],
    ['santiago', 'Santiago', 'Chile', -33.4489, -70.6693, 6.2, -4],
    ['buenosaires', 'Buenos Aires', 'Argentina', -34.6037, -58.3816, 3.1, -3],
    ['saopaulo', 'São Paulo', 'Brazil', -23.5505, -46.6333, 12.3, -3],
    ['rio', 'Rio de Janeiro', 'Brazil', -22.9068, -43.1729, 6.7, -3],
    ['reykjavik', 'Reykjavík', 'Iceland', 64.1466, -21.9426, 0.13, 0],
    ['dublin', 'Dublin', 'Ireland', 53.3498, -6.2603, 1.4, 0],
    ['lisbon', 'Lisbon', 'Portugal', 38.7223, -9.1393, 0.55, 0],
    ['madrid', 'Madrid', 'Spain', 40.4168, -3.7038, 3.2, 1],
    ['barcelona', 'Barcelona', 'Spain', 41.3874, 2.1686, 1.6, 1],
    ['rome', 'Rome', 'Italy', 41.9028, 12.4964, 2.8, 1],
    ['milan', 'Milan', 'Italy', 45.4642, 9.1900, 1.4, 1],
    ['berlin', 'Berlin', 'Germany', 52.5200, 13.4050, 3.6, 1],
    ['munich', 'Munich', 'Germany', 48.1351, 11.5820, 1.5, 1],
    ['amsterdam', 'Amsterdam', 'Netherlands', 52.3676, 4.9041, 0.9, 1],
    ['brussels', 'Brussels', 'Belgium', 50.8503, 4.3517, 1.2, 1],
    ['zurich', 'Zürich', 'Switzerland', 47.3769, 8.5417, 0.42, 1],
    ['vienna', 'Vienna', 'Austria', 48.2082, 16.3738, 1.9, 1],
    ['prague', 'Prague', 'Czechia', 50.0755, 14.4378, 1.3, 1],
    ['warsaw', 'Warsaw', 'Poland', 52.2297, 21.0122, 1.8, 1],
    ['stockholm', 'Stockholm', 'Sweden', 59.3293, 18.0686, 1.0, 1],
    ['oslo', 'Oslo', 'Norway', 59.9139, 10.7522, 0.7, 1],
    ['copenhagen', 'Copenhagen', 'Denmark', 55.6761, 12.5683, 0.8, 1],
    ['helsinki', 'Helsinki', 'Finland', 60.1699, 24.9384, 0.65, 2],
    ['athens', 'Athens', 'Greece', 37.9838, 23.7275, 0.66, 2],
    ['istanbul', 'Istanbul', 'Türkiye', 41.0082, 28.9784, 15.5, 3],
    ['moscow', 'Moscow', 'Russia', 55.7558, 37.6173, 12.5, 3],
    ['stpetersburg', 'Saint Petersburg', 'Russia', 59.9343, 30.3351, 5.4, 3],
    ['kyiv', 'Kyiv', 'Ukraine', 50.4501, 30.5234, 3.0, 2],
    ['cairo', 'Cairo', 'Egypt', 30.0444, 31.2357, 9.5, 2],
    ['casablanca', 'Casablanca', 'Morocco', 33.5731, -7.5898, 3.4, 1],
    ['lagos', 'Lagos', 'Nigeria', 6.5244, 3.3792, 15.4, 1],
    ['nairobi', 'Nairobi', 'Kenya', -1.2921, 36.8219, 4.4, 3],
    ['addisababa', 'Addis Ababa', 'Ethiopia', 9.0320, 38.7469, 3.4, 3],
    ['capetown', 'Cape Town', 'South Africa', -33.9249, 18.4241, 4.6, 2],
    ['johannesburg', 'Johannesburg', 'South Africa', -26.2041, 28.0473, 5.6, 2],
    ['dubai', 'Dubai', 'United Arab Emirates', 25.2048, 55.2708, 3.3, 4],
    ['riyadh', 'Riyadh', 'Saudi Arabia', 24.7136, 46.6753, 7.7, 3],
    ['telaviv', 'Tel Aviv', 'Israel', 32.0853, 34.7818, 0.46, 2],
    ['tehran', 'Tehran', 'Iran', 35.6892, 51.3890, 8.7, 3.5],
    ['karachi', 'Karachi', 'Pakistan', 24.8607, 67.0011, 14.9, 5],
    ['mumbai', 'Mumbai', 'India', 19.0760, 72.8777, 12.5, 5.5],
    ['delhi', 'Delhi', 'India', 28.7041, 77.1025, 11.0, 5.5],
    ['bengaluru', 'Bengaluru', 'India', 12.9716, 77.5946, 8.4, 5.5],
    ['kolkata', 'Kolkata', 'India', 22.5726, 88.3639, 4.5, 5.5],
    ['kathmandu', 'Kathmandu', 'Nepal', 27.7172, 85.3240, 1.0, 5.75],
    ['dhaka', 'Dhaka', 'Bangladesh', 23.8103, 90.4125, 8.9, 6],
    ['bangkok', 'Bangkok', 'Thailand', 13.7563, 100.5018, 8.3, 7],
    ['singapore', 'Singapore', 'Singapore', 1.3521, 103.8198, 5.7, 8],
    ['kualalumpur', 'Kuala Lumpur', 'Malaysia', 3.1390, 101.6869, 1.8, 8],
    ['jakarta', 'Jakarta', 'Indonesia', -6.2088, 106.8456, 10.6, 7],
    ['manila', 'Manila', 'Philippines', 14.5995, 120.9842, 1.8, 8],
    ['hanoi', 'Hanoi', 'Vietnam', 21.0278, 105.8342, 8.1, 7],
    ['hochiminh', 'Ho Chi Minh City', 'Vietnam', 10.8231, 106.6297, 9.0, 7],
    ['shanghai', 'Shanghai', 'China', 31.2304, 121.4737, 24.9, 8],
    ['beijing', 'Beijing', 'China', 39.9042, 116.4074, 21.5, 8],
    ['seoul', 'Seoul', 'South Korea', 37.5665, 126.9780, 9.7, 9],
    ['osaka', 'Osaka', 'Japan', 34.6937, 135.5023, 2.7, 9],
    ['sydney', 'Sydney', 'Australia', -33.8688, 151.2093, 5.3, 10],
    ['melbourne', 'Melbourne', 'Australia', -37.8136, 144.9631, 5.0, 10],
    ['brisbane', 'Brisbane', 'Australia', -27.4698, 153.0251, 2.5, 10],
    ['perth', 'Perth', 'Australia', -31.9505, 115.8605, 2.1, 8],
    ['auckland', 'Auckland', 'New Zealand', -36.8509, 174.7645, 1.6, 12]
  ];

  T.data = T.data || {};
  T.data.cities = rows.map(function (r) {
    return {
      id: r[0], name: r[1], country: r[2], lat: r[3], lon: r[4],
      pop: r[5], tz: r[6], detail: !!r[7]
    };
  });
  T.data.byId = {};
  T.data.cities.forEach(function (c) { T.data.byId[c.id] = c; });

  // Hero-city generation briefs consumed by js/cities.js
  T.data.heroes = {
    nyc: {
      seed: 1901,
      tagline: 'The city that never sleeps',
      district: 'Manhattan grid · Hudson & East rivers',
      arrival: { altitudeM: 900, elevationDeg: 18, sunHours: 17.8 }
    },
    tokyo: {
      seed: 1603,
      tagline: 'Neon rain and endless blocks',
      district: 'Shinjuku towers · neon alleys',
      arrival: { altitudeM: 600, elevationDeg: 12, sunHours: 21.4 }
    },
    paris: {
      seed: 1889,
      tagline: 'The city of light',
      district: 'Haussmann blocks · the Seine',
      arrival: { altitudeM: 320, elevationDeg: 14, sunHours: 6.3, azimuthDeg: 115 }
    }
  };
})();