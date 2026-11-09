/* LocalTruck – l'affiche (A4, A5 ou A6) « version jour » : mise en page, aperçu (SVG) et PDF vectoriel.
 *
 * Une seule mise en page (build) produit une liste de formes en coordonnées de la maquette (794 × 1123, origine en haut à gauche) ;
 * l'aperçu à l'écran (toSVG) et le PDF d'impression (toPDF) la dessinent à l'identique.
 * PDF : A4, aucune police embarquée (les lettres sont des courbes), QR code en carrés vectoriels, aucune donnée personnelle
 * (seulement le nom du food truck et son adresse courte). Les contours des lettres viennent de poster-data.js, chargé à la demande.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(() => require('./poster-data.js'), require('./qr.js'), null);
  else { root.MFT = root.MFT || {}; root.MFT.poster = factory(() => root.MFT.posterData, root.MFT.qr, root); }
})(typeof self !== 'undefined' ? self : this, function (getData, qr, win) {
  'use strict';
  const W = 794, H = 1123, PAD_X = 56, PAD_Y = 48, BASE = 'https://localtruck.fr/t/';
  /** Formats d'impression : même mise en page (série A, mêmes proportions), page PDF à la bonne taille (points). */
  const FORMATS = {
    A4: { pw: 595.276, ph: 841.89, cm: [21, 29.7], label: '21 × 29,7 cm' },
    A5: { pw: 419.528, ph: 595.276, cm: [14.8, 21], label: '14,8 × 21 cm' },
    A6: { pw: 297.638, ph: 419.528, cm: [10.5, 14.8], label: '10,5 × 14,8 cm' },
  };
  const fmtOf = (f) => (FORMATS[f] ? f : 'A4');
  /** Textes de chaque modèle : l'affiche d'un food truck, ou une affiche générique (inviter les food trucks, ou les clients). */
  const KINDS = {
    truck: { pills: ['SANS PUBLICITÉ', 'GRATUIT'], label: 'RETROUVEZ', chip: 'SUR LOCALTRUCK.FR', scan: 'UN SCAN, ET VOUS SAVEZ',
      points: [['pin', 'OÙ NOUS SOMMES CE SOIR'], ['clock', 'NOS HORAIRES ET NOTRE MENU'], ['bell', 'UNE ALERTE SI ON CHANGE DE LIEU']] },
    join: { pills: ['SANS COMMISSION', 'GRATUIT'], label: 'VOUS ÊTES UN FOOD TRUCK ?', title: 'REJOIGNEZ LOCALTRUCK', chip: 'INSCRIPTION GRATUITE', scan: 'UN SCAN, ET VOUS Y ÊTES',
      url: 'https://localtruck.fr/pour-les-food-trucks/', points: [['pin', 'VOS CLIENTS VOUS TROUVENT'], ['clock', 'ANNONCEZ OÙ VOUS SEREZ'], ['bell', 'VOS HABITUÉS SONT PRÉVENUS']] },
    clients: { pills: ['SANS PUBLICITÉ', 'GRATUIT'], label: 'OÙ MANGER CE SOIR ?', title: 'LES FOOD TRUCKS PRÈS DE CHEZ VOUS', chip: 'SUR LOCALTRUCK.FR', scan: 'UN SCAN, ET VOUS SAVEZ',
      url: 'https://localtruck.fr/', points: [['pin', 'QUI EST OUVERT MAINTENANT'], ['clock', 'OÙ ET À QUELLE HEURE'], ['bell', 'UNE ALERTE QUAND IL ARRIVE']] },
  };
  const INK = '#0B0B0D', ORANGE = '#FF6A3D', PAPER = '#F7F5F1', WHITE = '#FFFFFF';
  const SOFT = '#4D4D4D', DASH = '#757474';            // l'encre à 72 % et à 55 % sur le papier, sans transparence (impression plus sûre)
  const K = 0.5522847498;

  /* ------------------------------------------------------------ chargement des contours (navigateur) */
  let loading = null;
  function load() {
    if (getData()) return Promise.resolve();
    if (!win || !win.document) return Promise.reject(new Error('Données de l’affiche indisponibles.'));
    if (!loading) loading = new Promise((ok, ko) => {
      const s = win.document.createElement('script'); s.src = 'js/poster-data.js';
      s.onload = () => (getData() ? ok() : ko(new Error('Données de l’affiche invalides.')));
      s.onerror = () => { loading = null; ko(new Error('Impossible de charger les données de l’affiche. Vérifiez votre connexion.')); };
      win.document.head.appendChild(s);
    });
    return loading;
  }
  const ready = () => !!getData();

  /* ------------------------------------------------------------ géométrie : listes plates [code, coordonnées…] (0 M, 1 L, 2 C, 3 Z) */
  const ARITY = [2, 2, 6, 0];
  function mapOps(ops, fn) {
    const out = new Array(ops.length);
    for (let i = 0; i < ops.length;) { const c = ops[i]; out[i] = c; const n = ARITY[c]; for (let j = 0; j < n; j += 2) { const p = fn(ops[i + 1 + j], ops[i + 2 + j]); out[i + 1 + j] = p[0]; out[i + 2 + j] = p[1]; } i += 1 + n; }
    return out;
  }
  const place = (ops, sx, sy, tx, ty) => mapOps(ops, (x, y) => [x * sx + tx, y * sy + ty]);
  function rrect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2); const k = K * r;
    return [0, x + r, y, 1, x + w - r, y, 2, x + w - r + k, y, x + w, y + r - k, x + w, y + r, 1, x + w, y + h - r,
      2, x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h, 1, x + r, y + h, 2, x + r - k, y + h, x, y + h - r + k, x, y + h - r,
      1, x, y + r, 2, x, y + r - k, x + r - k, y, x + r, y, 3];
  }
  const rect = (x, y, w, h) => [0, x, y, 1, x + w, y, 1, x + w, y + h, 1, x, y + h, 3];

  /* ------------------------------------------------------------ texte en courbes */
  function metrics(D) { return { A: D.asc / D.upm, Dn: D.desc / D.upm, upm: D.upm }; }
  /** Largeur d'un texte (px), espacement des lettres compris (comme le navigateur : il s'ajoute aussi après la dernière lettre). */
  function textWidth(D, font, text, size, ls) {
    const f = D.fonts[font], k = size / D.upm; let w = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]; w += (f.adv[ch] !== undefined ? f.adv[ch] : f.adv[' ']) * k + ls * size;
      if (i + 1 < text.length) w += (f.kern[ch + text[i + 1]] || 0) * k;
    }
    return w;
  }
  /** Contours d'un texte, la ligne de base à y = base, le bord gauche à x. */
  function textOps(D, font, text, x, base, size, ls) {
    const f = D.fonts[font], k = size / D.upm; let out = [], pen = x;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], g = f.g[ch];
      if (g) out = out.concat(place(g, k, -k, pen, base));
      pen += (f.adv[ch] !== undefined ? f.adv[ch] : f.adv[' ']) * k + ls * size;
      if (i + 1 < text.length) pen += (f.kern[ch + text[i + 1]] || 0) * k;
    }
    return out;
  }
  /** Ligne de base d'une ligne de texte centrée dans sa boîte (comme le navigateur : (hauteur de ligne − hauteur des lettres) / 2). */
  const baseIn = (m, top, lineH, size) => top + (lineH - (m.A + m.Dn) * size) / 2 + m.A * size;

  /** Découpe en lignes, mot à mot ; un mot trop long est coupé. maxW en px. */
  function wrap(D, font, text, size, ls, maxW) {
    const words = text.split(' ').filter(Boolean), lines = []; let cur = '';
    const w = (t) => textWidth(D, font, t, size, ls) - ls * size;                      // sans l'espacement final : seule l'encre compte pour tenir dans la boîte
    for (let word of words) {
      while (w(word) > maxW && word.length > 1) {                                       // mot plus large que la boîte : coupé au dernier caractère qui tient
        let n = word.length - 1; while (n > 1 && w(word.slice(0, n)) > maxW) n--;
        if (cur) { lines.push(cur); cur = ''; }
        lines.push(word.slice(0, n)); word = word.slice(n);
      }
      const t = cur ? cur + ' ' + word : word;
      if (!cur || w(t) <= maxW) cur = t; else { lines.push(cur); cur = word; }
    }
    if (cur) lines.push(cur);
    return lines;
  }
  /** « text-wrap: balance » : même nombre de lignes, mais de longueurs voisines. */
  function balance(D, font, text, size, ls, maxW) {
    const first = wrap(D, font, text, size, ls, maxW); if (first.length < 2) return first;
    let lo = 0, hi = maxW, best = first;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; const l = wrap(D, font, text, size, ls, mid); if (l.length <= first.length && l.every((t) => textWidth(D, font, t, size, ls) - ls * size <= mid + 0.01)) { best = l; hi = mid; } else lo = mid; }
    return best;
  }

  /** Nom tel qu'il sera imprimé : majuscules, caractères que la police sait dessiner, espaces nets. */
  function cleanName(D, name) {
    const f = D.fonts.title; let s = String(name == null ? '' : name).replace(/\s+/g, ' ').trim().toUpperCase();
    s = s.replace(/['‘‛′]/g, '’').replace(/″/g, '”').replace(/[‐‑‒]/g, '-');
    let out = ''; for (const ch of s) if (f.adv[ch] !== undefined) out += ch;
    return out.replace(/ +/g, ' ').trim();
  }
  const cleanSlug = (slug) => String(slug == null ? '' : slug).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);

  /* ------------------------------------------------------------ la mise en page */
  /**
   * @param {{name?:string, slug?:string, kind?:'truck'|'join'|'clients', format?:'A4'|'A5'|'A6'}} o
   * @returns {{w:number,h:number,name:string,slug:string,url:string,kind:string,format:string,items:object[]}}
   */
  function build(o) {
    const D = getData(); if (!D) throw new Error('Données de l’affiche non chargées.');
    o = o || {}; const kind = KINDS[o.kind] ? o.kind : 'truck'; const K = KINDS[kind]; const format = fmtOf(o.format);
    let name, slug, url;
    if (kind === 'truck') { name = cleanName(D, o.name) || 'MON FOOD TRUCK'; slug = cleanSlug(o.slug); if (!slug) throw new Error('Adresse courte manquante.'); url = BASE + slug; }
    else { name = cleanName(D, K.title); slug = kind === 'join' ? 'rejoindre' : 'localtruck'; url = K.url; }
    const m = metrics(D), items = [];
    const fill = (ops, color) => items.push({ ops, fill: color });
    const stroke = (ops, color, lw, extra) => items.push(Object.assign({ ops, stroke: color, lw }, extra || {}));
    const left = PAD_X, right = W - PAD_X, inner = right - left;

    fill(rect(0, 0, W, H), PAPER);

    /* ---- hauteurs des quatre blocs, pour répartir l'espace comme la maquette (justify-content: space-between) */
    /* lisibilité : aucun texte imprimé sous 8 points. Une unité de la maquette vaut 0,75 pt en A4, 0,53 pt en A5, 0,375 pt en A6.
       En A6, l'affiche passe en version courte : sans pastilles ni liste, le QR code au centre et plus grand. */
    const SCALE = { A4: 1, A5: Math.SQRT1_2, A6: 0.5 }[format], MINPX = 8 / (0.75 * SCALE), fz = (x) => Math.max(x, MINPX);
    const compact = format === 'A6', fPill = fz(12), fLogo = fz(16), fScan = fz(13), fPoint = fz(18), fTap = fz(12), fUrl = fz(24);
    const hHeader = compact ? Math.max(42, fLogo * 1.4) : Math.max(42, fPill * 3.5);      // les pastilles : 38 px + 2 × 2 px de bordure en A4
    const SZ = [68, 60, 54, 48, 42, 38, 34]; let size = SZ[SZ.length - 1], lines = null, tracking = -0.01;
    for (const s of SZ) { const l = balance(D, 'title', name, s, tracking, inner); if (l.length <= 3 && l.every((t) => textWidth(D, 'title', t, s, tracking) - tracking * s <= inner + 0.01)) { size = s; lines = l; break; } }
    if (!lines) lines = wrap(D, 'title', name, size, tracking, inner);
    const lhTitle = size * 0.95, hLabel = (m.A + m.Dn) * 22, hChip = 34 * 1.1 + 24;
    const hName = hLabel + 18 + lines.length * lhTitle + 18 + hChip;
    const QR = compact ? 440 : 352, hQr = QR, hFoot = Math.max(124, fUrl * 1.25 + fTap * 1.25 + 4 + 26 + 8);
    const gap = (H - 2 * PAD_Y - hHeader - hName - hQr - hFoot) / 3;
    const yHeader = PAD_Y, yName = yHeader + hHeader + gap, yQr = yName + hName + gap, yFoot = H - PAD_Y - hFoot;

    /* ---- en-tête : LocalTruck + deux pastilles */
    fill(textOps(D, 'logo', 'LOCALTRUCK', left, baseIn(m, yHeader, hHeader, fLogo), fLogo, 0.3), INK);
    let px = right;
    for (const label of compact ? [] : K.pills) {
      const tw = textWidth(D, 'pill', label, fPill, 0.09), pw = tw + fPill * 2.7 + 4; px -= pw;
      stroke(rrect(px + 1, yHeader + 1, pw - 2, hHeader - 2, (hHeader - 2) / 2), INK, 2);
      fill(textOps(D, 'pill', label, px + fPill * 1.5, baseIn(m, yHeader, hHeader, fPill), fPill, 0.09), INK);
      px -= 10;
    }

    /* ---- nom du food truck */
    let y = yName;
    fill(textOps(D, 'label', K.label, left, y + m.A * 22, 22, kind === 'truck' ? 0.26 : 0.16), INK); y += hLabel + 18;
    lines.forEach((t, i) => fill(textOps(D, 'title', t, left, baseIn(m, y + i * lhTitle, lhTitle, size), size, tracking), INK));
    y += lines.length * lhTitle + 18;
    const chipW = textWidth(D, 'title', K.chip, 34, 0.02) + 44;
    fill(rrect(left, y, chipW, hChip, 16), ORANGE);
    fill(textOps(D, 'title', K.chip, left + 22, baseIn(m, y + 12, 34 * 1.1, 34), 34, 0.02), INK);

    /* ---- QR code et trois points forts */
    const fx = compact ? (W - QR) / 2 : left, fy = yQr;
    fill(rrect(fx, fy, QR, QR, 28), WHITE);
    stroke(rrect(fx + 1.5, fy + 1.5, QR - 3, QR - 3, 26.5), INK, 3);
    const mat = qr.build(url), N = mat.length, u = (QR - 40) / (N + 4), ox = fx + 20 + 2 * u, oy = fy + 20 + 2 * u; let q = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      if (!mat[r][c]) continue; let e = c; while (e + 1 < N && mat[r][e + 1]) e++;
      q = q.concat(rect(ox + c * u, oy + r * u, (e - c + 1) * u, u)); c = e;
    }
    fill(q, INK);
    const cx = fx + QR + 36, textW = right - cx - 48 - 14, lhP = fPoint * 1.2;
    const rows = compact ? [] : K.points.map(([ic, t]) => { const l = wrap(D, 'point', t, fPoint, 0.04, textW); return { ic, l, h: Math.max(48, l.length * lhP) }; });
    const hLab = (m.A + m.Dn) * fScan, colH = hLab + rows.reduce((a, r) => a + 22 + r.h, 0);
    let cy = fy + (QR - colH) / 2;
    if (!compact) { fill(textOps(D, 'label', K.scan, cx, cy + m.A * fScan, fScan, 0.13), INK); cy += hLab; }
    for (const r of rows) {
      cy += 22;
      fill(rrect(cx, cy + (r.h - 48) / 2, 48, 48, 24), ORANGE);
      const ic = place(D.icons[r.ic], 1, 1, cx + 12, cy + (r.h - 48) / 2 + 12);
      stroke(ic, INK, 2, { cap: 1, join: 1 });
      const th = r.l.length * lhP, top = cy + (r.h - th) / 2;
      r.l.forEach((t, i) => fill(textOps(D, 'point', t, cx + 48 + 14, baseIn(m, top + i * lhP, lhP, fPoint), fPoint, 0.04), INK));
      cy += r.h;
    }

    /* ---- pied : camion, pointillés, adresse à taper */
    const ts = Math.min(160 / 140, 103 / 90), tx = left, ty = yFoot + hFoot - 8 - 103 + (103 - 90 * ts) / 2;
    for (const s of D.truck) {
      const ops = place(s.ops, ts, ts, tx, ty);
      if (s.fill) fill(ops, s.fill);
      if (s.stroke) stroke(ops, s.stroke, s.lw * ts, { cap: 1, join: 1 });
    }
    stroke([0, left, yFoot + hFoot - 3, 1, right, yFoot + hFoot - 3], DASH, 3, { dash: [14, 12] });
    const shown = url.replace(/^https:\/\//, '').replace(/\/$/, ''), uw = textWidth(D, 'url', shown, fUrl, 0.01);
    const blockTop = yFoot + hFoot - 26 - ((m.A + m.Dn) * fTap + 4 + (m.A + m.Dn) * fUrl);
    const lw = textWidth(D, 'label', 'OU TAPEZ', fTap, 0.13);
    fill(textOps(D, 'label', 'OU TAPEZ', right - lw, blockTop + m.A * fTap, fTap, 0.13), SOFT);
    fill(textOps(D, 'url', shown, right - uw, blockTop + (m.A + m.Dn) * fTap + 4 + m.A * fUrl, fUrl, 0.01), INK);

    return { w: W, h: H, name, slug, url, kind, format, items };
  }

  /* ------------------------------------------------------------ sorties */
  const num = (v) => { const r = Math.round(v * 100) / 100; return String(r === 0 ? 0 : r); };
  function pathD(ops) {
    let d = '';
    for (let i = 0; i < ops.length;) {
      const c = ops[i], n = ARITY[c];
      d += 'MLCZ'[c]; for (let j = 0; j < n; j++) d += (j ? ' ' : '') + num(ops[i + 1 + j]); i += 1 + n;
    }
    return d;
  }
  /** Aperçu : un SVG (texte) à la taille de la maquette. */
  function toSVG(ir, label) {
    const body = ir.items.map((it) => '<path d="' + pathD(it.ops) + '"' + (it.fill ? ' fill="' + it.fill + '"' : ' fill="none"')
      + (it.stroke ? ' stroke="' + it.stroke + '" stroke-width="' + num(it.lw) + '"' + (it.cap ? ' stroke-linecap="round"' : '') + (it.join ? ' stroke-linejoin="round"' : '') + (it.dash ? ' stroke-dasharray="' + it.dash.join(' ') + '"' : '') : '') + '/>').join('');
    const t = String(label || 'Affiche ' + ir.name).replace(/[<>&"]/g, '');
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + ir.w + ' ' + ir.h + '" role="img" aria-label="' + t + '" shape-rendering="geometricPrecision">' + body + '</svg>';
  }

  const rgb = (hex) => [1, 3, 5].map((i) => num(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ');
  function pdfPath(ops) {
    let s = '';
    for (let i = 0; i < ops.length;) {
      const c = ops[i], n = ARITY[c]; const a = []; for (let j = 0; j < n; j++) a.push(num(ops[i + 1 + j]));
      s += (c === 3 ? 'h' : a.join(' ') + ' ' + 'mlc'[c]) + '\n'; i += 1 + n;
    }
    return s;
  }
  function pageStream(ir) {
    const F = FORMATS[fmtOf(ir.format)]; const sx = F.pw / ir.w, sy = F.ph / ir.h;      // à 0,2 % près les mêmes proportions : la page tombe pile au format papier
    let out = 'q\n' + [sx, 0, 0, -sy, 0, F.ph].map((v) => +v.toFixed(6)).join(' ') + ' cm\n';
    for (const it of ir.items) {
      out += 'q\n';
      if (it.stroke) out += rgb(it.stroke) + ' RG\n' + num(it.lw) + ' w\n' + (it.cap ? '1 J\n' : '') + (it.join ? '1 j\n' : '') + (it.dash ? '[' + it.dash.join(' ') + '] 0 d\n' : '');
      if (it.fill) out += rgb(it.fill) + ' rg\n';
      out += pdfPath(it.ops) + (it.fill && it.stroke ? 'B' : it.fill ? 'f' : 'S') + '\nQ\n';
    }
    return out + 'Q\n';
  }
  /** PDF vectoriel, une page par affiche, chacune à son format (A4, A5 ou A6). Retourne un Uint8Array. */
  function toPDF(irs) {
    irs = Array.isArray(irs) ? irs : [irs]; if (!irs.length) throw new Error('Aucune affiche.');
    const objs = [];                                                             // objs[i] = texte de l'objet n° i + 1
    objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[1] = '<< /Type /Pages /Kids [' + irs.map((_, i) => (4 + 2 * i) + ' 0 R').join(' ') + '] /Count ' + irs.length + ' >>';
    const title = irs.length === 1 ? 'Affiche LocalTruck - ' + irs[0].slug : 'Affiches LocalTruck - ' + irs.length + ' pages';
    objs[2] = '<< /Title (' + title.replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '') + ') /Producer (LocalTruck) >>';
    irs.forEach((ir, i) => {
      const stream = pageStream(ir);
      objs[3 + 2 * i] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + FORMATS[fmtOf(ir.format)].pw + ' ' + FORMATS[fmtOf(ir.format)].ph + '] /Resources << >> /Contents ' + (5 + 2 * i) + ' 0 R >>';
      objs[4 + 2 * i] = '<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream';
    });
    let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'; const offs = [];
    objs.forEach((o, i) => { offs.push(pdf.length); pdf += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    const xref = pdf.length;
    pdf += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    pdf += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    const bytes = new Uint8Array(pdf.length); for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
    return bytes;
  }

  const fileName = (slug, format) => 'affiche-' + cleanSlug(slug) + (format && fmtOf(format) !== 'A4' ? '-' + fmtOf(format).toLowerCase() : '') + '.pdf';
  return { load, ready, build, toSVG, toPDF, fileName, FORMATS, KINDS, cleanName: (n) => cleanName(getData(), n), cleanSlug, url: (slug) => BASE + cleanSlug(slug), W, H };
});
