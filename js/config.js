/* LocalTruck – réglages de l'application.
 * La clé « publishable » est PUBLIQUE par conception (elle est visible dans toute application mobile ou web) :
 * c'est la sécurité de la base (règles RLS, voir supabase/1-schema.sql) qui protège les données, pas cette clé.
 * Ne jamais mettre ici la clé « secret » / « service_role ». */
window.MFT = window.MFT || {};
window.MFT.VERSION = '0.3';
window.MFT_CONFIG = {
  supabaseUrl: 'https://jclwzfzmomzrpwfddglb.supabase.co',
  supabaseKey: 'sb_publishable_aPI7DJ0nXZyXdYOv64Z99g_8JD96jtD',
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',   // fond de carte (voir la politique d'utilisation d'OpenStreetMap)
  geocoder: 'https://data.geopf.fr/geocodage',                 // recherche d'adresses : Géoplateforme de l'IGN (gratuit, France)
  shareBase: 'https://localtruck.fr/',                        // adresse publique du site (liens de partage) ; vide = adresse courante
};
