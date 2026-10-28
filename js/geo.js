/* LocalTruck – recherche d'adresses (Géoplateforme de l'IGN, gratuite, France). Les résultats sont mis sous la forme
 * attendue par l'application (champs « address » à la manière d'OpenStreetMap). */
(function () {
  'use strict';
  const MFT = (window.MFT = window.MFT || {});
  const base = () => String((MFT.config && MFT.config.geocoder) || (window.MFT_CONFIG && window.MFT_CONFIG.geocoder) || 'https://data.geopf.fr/geocodage').replace(/\/+$/, '');
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  const sig = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(9000) : undefined);

  function mapFeature(f) {
    const p = f && f.properties || {}; const g = f && f.geometry && f.geometry.coordinates; if (!g || g.length < 2) return null;
    const city = first(p.city) || first(p.municipality) || ''; const postcode = first(p.postcode) || '';
    const poi = first(p.toponym) || '';
    const isAddr = ['housenumber', 'street'].includes(p.type);
    const line = isAddr ? (p.name || [p.housenumber, p.street].filter(Boolean).join(' ')) : '';
    const name = poi || (p.type === 'locality' ? (first(p.name) || '') : '');
    const label = [p.label || poi || first(p.name) || city, p.context].filter(Boolean).join(', ');
    return { name, label, lat: +g[1], lng: +g[0], type: p.type || first(p.category) || '', address: { road: line, postcode, city } };
  }
  async function call(path, params) {
    const res = await fetch(base() + path + '?' + new URLSearchParams(params).toString(), { signal: sig(), headers: { Accept: 'application/json' } });
    if (!res.ok) { const e = new Error('geocodage ' + res.status); e.status = res.status; throw e; }
    return res.json();
  }
  async function search(q) {
    q = String(q || '').trim(); if (q.length < 3) return [];
    let d;
    try { d = await call('/search', { q, limit: '6', autocomplete: '1', index: 'address,poi' }); }
    catch (e) { if (e.status === 400) d = await call('/search', { q, limit: '6', autocomplete: '1' }); else throw e; }
    return (d.features || []).map(mapFeature).filter(Boolean);
  }
  async function reverse(lat, lng) {
    const d = await call('/reverse', { lat: String(lat), lon: String(lng), limit: '1', index: 'address' });
    const r = (d.features || []).map(mapFeature).filter(Boolean)[0]; return r || null;
  }
  MFT.geo = { search, reverse, mapFeature };
})();
