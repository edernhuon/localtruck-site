/* LocalTruck – données des pages « villes » du référencement : où trouver la liste des food trucks repérés.
 * Deux sources, dans cet ordre :
 *   1. un fichier JSON privé (variable SEO_PLACES=/chemin/fichier.json), jamais dans le dépôt public ;
 *   2. la base Supabase, par la fonction publique nearby_listings (la même que celle de la carte) : seulement les fiches visibles de tous.
 * Une fiche = { slug, name, cuisine, city, department, usual: [lieux habituels], usualSource, lat?, lng? }.
 * Aucune donnée personnelle ici : ni Instagram, ni téléphone, ni adresse précise (lat/lng ne servent qu'à classer les food trucks par distance). */
'use strict';
const fs = require('fs');
const path = require('path');

const DEPARTMENTS = {
  '01': 'Ain', '02': 'Aisne', '03': 'Allier', '04': 'Alpes-de-Haute-Provence', '05': 'Hautes-Alpes', '06': 'Alpes-Maritimes', '07': 'Ardèche', '08': 'Ardennes', '09': 'Ariège',
  '10': 'Aube', '11': 'Aude', '12': 'Aveyron', '13': 'Bouches-du-Rhône', '14': 'Calvados', '15': 'Cantal', '16': 'Charente', '17': 'Charente-Maritime', '18': 'Cher', '19': 'Corrèze',
  '2A': 'Corse-du-Sud', '2B': 'Haute-Corse', '21': 'Côte-d’Or', '22': 'Côtes-d’Armor', '23': 'Creuse', '24': 'Dordogne', '25': 'Doubs', '26': 'Drôme', '27': 'Eure', '28': 'Eure-et-Loir',
  '29': 'Finistère', '30': 'Gard', '31': 'Haute-Garonne', '32': 'Gers', '33': 'Gironde', '34': 'Hérault', '35': 'Ille-et-Vilaine', '36': 'Indre', '37': 'Indre-et-Loire', '38': 'Isère',
  '39': 'Jura', '40': 'Landes', '41': 'Loir-et-Cher', '42': 'Loire', '43': 'Haute-Loire', '44': 'Loire-Atlantique', '45': 'Loiret', '46': 'Lot', '47': 'Lot-et-Garonne', '48': 'Lozère',
  '49': 'Maine-et-Loire', '50': 'Manche', '51': 'Marne', '52': 'Haute-Marne', '53': 'Mayenne', '54': 'Meurthe-et-Moselle', '55': 'Meuse', '56': 'Morbihan', '57': 'Moselle', '58': 'Nièvre',
  '59': 'Nord', '60': 'Oise', '61': 'Orne', '62': 'Pas-de-Calais', '63': 'Puy-de-Dôme', '64': 'Pyrénées-Atlantiques', '65': 'Hautes-Pyrénées', '66': 'Pyrénées-Orientales', '67': 'Bas-Rhin',
  '68': 'Haut-Rhin', '69': 'Rhône', '70': 'Haute-Saône', '71': 'Saône-et-Loire', '72': 'Sarthe', '73': 'Savoie', '74': 'Haute-Savoie', '75': 'Paris', '76': 'Seine-Maritime', '77': 'Seine-et-Marne',
  '78': 'Yvelines', '79': 'Deux-Sèvres', '80': 'Somme', '81': 'Tarn', '82': 'Tarn-et-Garonne', '83': 'Var', '84': 'Vaucluse', '85': 'Vendée', '86': 'Vienne', '87': 'Haute-Vienne', '88': 'Vosges',
  '89': 'Yonne', '90': 'Territoire de Belfort', '91': 'Essonne', '92': 'Hauts-de-Seine', '93': 'Seine-Saint-Denis', '94': 'Val-de-Marne', '95': 'Val-d’Oise',
  '971': 'Guadeloupe', '972': 'Martinique', '973': 'Guyane', '974': 'La Réunion', '976': 'Mayotte',
};

/** Régions qui ont leur page (« /food-trucks/bretagne/ »). Les autres viendront avec leurs communes (voir communes-*.json). */
const REGIONS = [{ slug: 'bretagne', name: 'Bretagne', prep: 'en Bretagne', departments: ['22', '29', '35', '56'] }];

/** « Côtes-d’Armor » → « cotes-d-armor » */
const slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 120);

/** Garde les fiches utilisables (nom, ville, département connus, adresse courte valide) et retire les doublons. */
function normalize(list) {
  const seen = new Set(); const out = [];
  for (const r of Array.isArray(list) ? list : []) {
    const slug = clean(r && r.slug, 60).toLowerCase();
    const name = clean(r && r.name, 60); const city = clean(r && r.city, 60); const dep = clean(r && r.department, 3).toUpperCase();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || !name || !city || !DEPARTMENTS[dep] || seen.has(slug)) continue;
    seen.add(slug);
    const lat = Number(r.lat); const lng = Number(r.lng); const geo = r.lat != null && r.lng != null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    out.push({
      slug, name, city, department: dep, cuisine: clean(r.cuisine, 80),
      ...(geo ? { lat, lng } : {}),       // sert seulement à calculer « à proximité » (distances arrondies) : jamais écrit dans les pages
      usual: (Array.isArray(r.usual) ? r.usual : []).map((x) => clean(x, 120)).filter(Boolean).slice(0, 12),
      usualSource: /^https:\/\//.test(String(r.usual_source || r.usualSource || '')) ? clean(r.usual_source || r.usualSource, 200) : '',
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** Le site d'où viennent les habitudes d'un camion (par exemple « exemple.fr ») : on n'affiche que le nom de domaine. */
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

function fromFile(file) {
  return normalize(JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')));
}

/* Cercles de 300 km (maximum accepté par nearby_listings) qui couvrent la France ; chaque appel renvoie au plus 300 fiches. */
const CIRCLES = [[48.86, 2.35], [48.11, -1.68], [48.39, -4.49], [50.63, 3.06], [48.57, 7.75], [45.76, 4.84], [43.3, 5.37], [43.6, 1.44], [44.84, -0.58], [47.22, -1.55], [43.7, 7.26], [41.92, 8.74], [47.32, 5.04]];

async function fromSupabase(cfg) {
  if (!cfg || !cfg.url || !cfg.key) throw new Error('adresse ou clé Supabase absente');
  const all = []; let saturated = 0;
  for (const [lat, lng] of CIRCLES) {
    const res = await fetch(cfg.url + '/rest/v1/rpc/nearby_listings', {
      method: 'POST', headers: { apikey: cfg.key, authorization: 'Bearer ' + cfg.key, 'content-type': 'application/json' },
      body: JSON.stringify({ p_lat: lat, p_lng: lng, p_radius_km: 300 }), signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error('Supabase a répondu ' + res.status);
    const rows = await res.json(); if (!Array.isArray(rows)) throw new Error('réponse inattendue de Supabase');
    if (rows.length >= 300) saturated++;
    all.push(...rows);
  }
  const list = normalize(all);
  if (saturated) console.error('ATTENTION : ' + saturated + ' zone(s) ont atteint la limite de 300 fiches : liste peut-être incomplète (prévoir une fonction dédiée).');
  return list;
}

/** Adresse et clé publiques du projet, lues dans src/renderer/js/config.js (la clé « publishable » est publique par conception). */
function configFromRepo(root) {
  const t = fs.readFileSync(path.join(root, 'src/renderer/js/config.js'), 'utf8');
  const u = /supabaseUrl:\s*'([^']+)'/.exec(t); const k = /supabaseKey:\s*'([^']+)'/.exec(t);
  return { url: u && u[1], key: k && k[1] };
}

/** null si aucune source n'est disponible (pas de fichier, pas de réseau). */
async function loadPlaces(root, opts) {
  opts = opts || {};
  const file = opts.file || process.env.SEO_PLACES;
  if (file) return fromFile(file);
  if (opts.live === false) return null;
  try { return await fromSupabase(opts.config || configFromRepo(root)); }
  catch (e) { console.error('SEO : liste des food trucks non lue (' + e.message + ')'); return null; }
}

module.exports = { DEPARTMENTS, REGIONS, slugify, normalize, host, fromFile, fromSupabase, loadPlaces, configFromRepo };
