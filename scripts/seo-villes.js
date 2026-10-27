/* LocalTruck – pages « départements, villes et food trucks » pour Google : /food-trucks/, /food-trucks/<département>/, /food-trucks/<département>/<ville>/ et /food-truck/<nom>/.
 * Fabriquées à partir de la liste des fiches visibles de tous (voir seo-places.js) : aucune donnée personnelle, pas de compte Instagram, pas de téléphone.
 * Le gabarit (page, esc, SITE…) est fourni par build-seo.js. */
'use strict';
const { DEPARTMENTS, slugify, host } = require('./seo-places.js');

/** « à Lorient », « au Trévoux », « aux Sables-d’Olonne », « à La Rochelle ». */
function aVille(city) {
  if (/^Le\s/.test(city)) return 'au ' + city.slice(3);
  if (/^Les\s/.test(city)) return 'aux ' + city.slice(4);
  return 'à ' + city;
}
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/[\s,;:(–-]+\S*$/, '') + '…');
const fit = (max, ...c) => c.find((x) => x.length <= max) || clip(c[c.length - 1], max);
const plural = (n, un, plus) => n + ' ' + (n > 1 ? plus : un);

function buildVilles(places, T, today) {
  const { page, esc, SITE } = T;
  const files = {}; const urls = [];
  const dir = (...p) => p.join('/');
  const add = (d, p, priority) => { files[d + '/index.html'] = page(Object.assign({ dir: d }, p)); urls.push({ loc: SITE + '/' + d + '/', priority, ...(today ? { lastmod: today } : {}) }); };
  const crumbs = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, d], i) => ({ '@type': 'ListItem', position: i + 1, name, item: SITE + '/' + (d ? d + '/' : '') })) });
  const trail = (items) => '<nav class="crumbs" aria-label="Fil d’Ariane">' + items.map(([name, d]) => (d === null ? '<span>' + esc(name) + '</span>' : '<a href="/' + (d ? d + '/' : '') + '">' + esc(name) + '</a>')).join(' › ') + '</nav>';

  // regroupement département → ville → fiches
  const deps = new Map();
  const names = new Map(); // « Saint Malo » et « Saint-Malo » donnent la même adresse : on garde la première écriture
  for (const p0 of places) {
    const k = p0.department + '/' + slugify(p0.city); if (!names.has(k)) names.set(k, p0.city);
    const p = p0.city === names.get(k) ? p0 : Object.assign({}, p0, { city: names.get(k) });
    if (!deps.has(p.department)) deps.set(p.department, new Map());
    const cities = deps.get(p.department);
    if (!cities.has(p.city)) cities.set(p.city, []);
    cities.get(p.city).push(p);
  }
  const depSlug = (code) => slugify(DEPARTMENTS[code]);
  const citySlug = (c) => slugify(c);
  const depDir = (code) => dir('food-trucks', depSlug(code));
  const cityDir = (code, c) => dir('food-trucks', depSlug(code), citySlug(c));
  const truckDir = (p) => dir('food-truck', p.slug);
  const depList = [...deps.entries()].sort((a, b) => [...b[1].values()].flat().length - [...a[1].values()].flat().length || DEPARTMENTS[a[0]].localeCompare(DEPARTMENTS[b[0]], 'fr'));
  const count = (cities) => [...cities.values()].reduce((n, l) => n + l.length, 0);

  const itemList = (list) => ({ '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: list.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE + '/' + truckDir(p) + '/', name: p.name })) });
  const establishment = (p) => ({
    '@context': 'https://schema.org', '@type': 'FoodEstablishment', name: p.name, url: SITE + '/' + truckDir(p) + '/',
    address: { '@type': 'PostalAddress', addressLocality: p.city, addressRegion: DEPARTMENTS[p.department], addressCountry: 'FR' },
    ...(p.cuisine ? { servesCuisine: p.cuisine } : {}),
  });

  /* ---------- /food-trucks/ */
  add('food-trucks', {
    title: 'Food trucks en France : par département et par ville | LocalTruck',
    desc: 'Les food trucks de France par département et par ville : ce qu’ils servent, où les retrouver, et la carte pour savoir qui est ouvert ce soir. Gratuit, sans publicité.',
    h1: 'Food trucks par département et par ville',
    ld: [crumbs([['LocalTruck', ''], ['Food trucks', 'food-trucks']])],
    top: trail([['LocalTruck', ''], ['Food trucks', null]]), body: `
<p class="lead">LocalTruck recense <strong>${plural(places.length, 'food truck', 'food trucks')}</strong> dans <strong>${plural(depList.length, 'département', 'départements')}</strong>. Choisissez votre département, puis votre ville : vous verrez ce que chaque food truck sert et où le retrouver.</p>
<h2>Les départements</h2>
<ul class="cols">${depList.map(([code, cities]) => `<li><a href="/${depDir(code)}/">${esc(DEPARTMENTS[code])} (${code})</a> <span class="mu">· ${plural(count(cities), 'food truck', 'food trucks')}</span></li>`).join('')}</ul>
<h2>Savoir qui est ouvert ce soir</h2>
<p>Les listes ci-dessus donnent une idée de qui est près de chez vous. Pour voir <strong>qui est ouvert maintenant, à quelle heure et à quel endroit</strong>, ouvrez la carte : elle se base sur votre position (jamais enregistrée) et sur les emplacements annoncés par les food trucks eux-mêmes.</p>
<p class="cta-row"><a class="cta" href="/">Ouvrir la carte</a></p>
<h2>Vous tenez un food truck ?</h2>
<p>Référencez-vous gratuitement : vos clients vous trouvent et sont prévenus quand vous changez de lieu. <a href="/pour-les-food-trucks/">Voir comment faire</a>.</p>`,
  }, '0.7');

  /* ---------- départements et villes */
  for (const [code, cities] of depList) {
    const dn = DEPARTMENTS[code]; const nb = count(cities);
    const cityList = [...cities.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'fr'));
    add(depDir(code), {
      title: 'Food trucks – ' + dn + ' (' + code + ') : liste par ville | LocalTruck',
      desc: plural(nb, 'food truck repéré', 'food trucks repérés') + ' – ' + dn + ' (' + code + '), dans ' + plural(cities.size, 'ville', 'villes') + ' : cuisine, emplacements habituels et carte pour savoir qui est ouvert ce soir.',
      h1: 'Food trucks : ' + dn + ' (' + code + ')',
      ld: [crumbs([['LocalTruck', ''], ['Food trucks', 'food-trucks'], [dn, depDir(code)]])],
      top: trail([['LocalTruck', ''], ['Food trucks', 'food-trucks'], [dn, null]]), body: `
<p class="lead">${plural(nb, 'food truck', 'food trucks')} repéré${nb > 1 ? 's' : ''} – ${esc(dn)} (${code}), dans ${plural(cities.size, 'ville', 'villes')}. Touchez une ville pour voir qui y est et ce qu’il sert.</p>
<h2>Les villes</h2>
<ul class="cols">${cityList.map(([c, l]) => `<li><a href="/${cityDir(code, c)}/">${esc(c)}</a> <span class="mu">· ${plural(l.length, 'food truck', 'food trucks')}</span></li>`).join('')}</ul>
<h2>Les food trucks</h2>
<ul>${[...cities.values()].flat().sort((a, b) => a.name.localeCompare(b.name, 'fr')).map((p) => `<li><a href="/${truckDir(p)}/">${esc(p.name)}</a>${p.cuisine ? ' <span class="mu">· ' + esc(p.cuisine) + '</span>' : ''} <span class="mu">· ${esc(p.city)}</span></li>`).join('')}</ul>
<p class="cta-row"><a class="cta" href="/">Voir la carte en direct</a></p>`,
    }, '0.6');

    for (const [city, list] of cityList) {
      const av = aVille(city); const others = cityList.filter(([c]) => c !== city).slice(0, 12);
      add(cityDir(code, city), {
        title: fit(70, 'Food truck ' + av + ' (' + code + ') : liste et où les trouver | LocalTruck', 'Food truck ' + av + ' (' + code + ') | LocalTruck'),
        desc: clip(plural(list.length, 'food truck', 'food trucks') + ' ' + av + ' (' + dn + ') : ce qu’ils servent, leurs emplacements habituels, et la carte pour savoir qui est ouvert ce soir. Gratuit.', 170),
        h1: 'Food truck ' + av + ' (' + code + ')',
        ld: [crumbs([['LocalTruck', ''], ['Food trucks', 'food-trucks'], [dn, depDir(code)], [city, cityDir(code, city)]]), itemList(list)],
        top: trail([['LocalTruck', ''], ['Food trucks', 'food-trucks'], [dn, depDir(code)], [city, null]]), body: `
<p class="lead">Où trouver un food truck ${esc(av)} ? LocalTruck recense <strong>${plural(list.length, 'food truck', 'food trucks')}</strong> ${esc(av)} (${esc(dn)}). Voici qui ils sont, ce qu’ils servent et, quand ils l’annoncent, où les retrouver.</p>
${list.map((p) => `<section class="truck"><h2><a href="/${truckDir(p)}/">${esc(p.name)}</a></h2>${p.cuisine ? '<p class="mu">' + esc(p.cuisine) + '</p>' : ''}${p.usual.length ? '<ul>' + p.usual.slice(0, 4).map((u) => '<li>' + esc(u) + '</li>').join('') + '</ul>' : ''}<p><a href="/${truckDir(p)}/">Voir la fiche de ${esc(p.name)}</a></p></section>`).join('\n')}
<h2>Qui est ouvert ce soir ${esc(av)} ?</h2>
<p>Un food truck change souvent de lieu d’un jour à l’autre. La carte LocalTruck affiche <strong>qui est ouvert maintenant, à quelle heure et à quel endroit</strong>, d’après ce que chaque food truck annonce lui-même. Vous pouvez aussi suivre vos préférés et être prévenu s’ils changent de lieu.</p>
<p class="cta-row"><a class="cta" href="/">Ouvrir la carte</a></p>
${others.length ? '<h2>Autres villes – ' + esc(dn) + '</h2><ul class="cols">' + others.map(([c, l]) => `<li><a href="/${cityDir(code, c)}/">${esc(c)}</a> <span class="mu">· ${plural(l.length, 'food truck', 'food trucks')}</span></li>`).join('') + '</ul>' : ''}
<p>Un food truck ${esc(av)} n’est pas dans la liste ? <a href="/pour-les-food-trucks/">Il peut se référencer gratuitement</a>.</p>`,
      }, '0.6');

      for (const p of list) {
        const where = p.usual.length
          ? `<h2>Où le trouver</h2><p>Emplacements habituels${p.usualSource && host(p.usualSource) && !/instagram\.com$/.test(host(p.usualSource)) ? ' (source : ' + esc(host(p.usualSource)) + ')' : ''} :</p><ul>${p.usual.map((u) => '<li>' + esc(u) + '</li>').join('')}</ul><p class="mu">Ces emplacements peuvent changer : la carte LocalTruck montre ceux annoncés pour aujourd’hui.</p>`
          : '<h2>Où le trouver</h2><p>Les emplacements du jour s’affichent sur la carte LocalTruck dès que le food truck les annonce.</p>';
        add(truckDir(p), {
          title: fit(70, p.name + ' : food truck ' + av + ' | LocalTruck', p.name + ' | food truck ' + av, p.name + ' | LocalTruck'),
          desc: clip(p.name + ', food truck ' + av + ' (' + dn + ')' + (p.cuisine ? ' – ' + p.cuisine : '') + '. Où le trouver ce soir : emplacements habituels et carte en direct.', 170),
          h1: p.name,
          ld: [crumbs([['LocalTruck', ''], ['Food trucks', 'food-trucks'], [dn, depDir(code)], [city, cityDir(code, city)], [p.name, truckDir(p)]]), establishment(p)],
          top: trail([['LocalTruck', ''], ['Food trucks', 'food-trucks'], [dn, depDir(code)], [city, cityDir(code, city)], [p.name, null]]), body: `
<p class="lead">${esc(p.name)} est un food truck${p.cuisine ? ' (' + esc(p.cuisine.toLowerCase()) + ')' : ''} présent ${esc(av)} (${esc(dn)}).</p>
${where}
<p class="cta-row"><a class="cta" href="/#/t/${p.slug}">Voir la fiche sur la carte</a></p>
<p>Tous les <a href="/${cityDir(code, city)}/">food trucks ${esc(av)}</a> · <a href="/${depDir(code)}/">food trucks – ${esc(dn)}</a></p>
<p class="mu">Vous êtes ${esc(p.name)} ? <a href="/#/t/${p.slug}/reprendre">Reprenez gratuitement votre fiche</a> pour annoncer vos emplacements et prévenir vos clients.</p>`,
        }, '0.5');
      }
    }
  }
  return { files, urls };
}

module.exports = { buildVilles, aVille };
