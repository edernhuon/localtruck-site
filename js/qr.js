/* LocalTruck – générateur de QR code (mode octets, correction d'erreur M, versions 1 à 10). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.MFT = root.MFT || {}; root.MFT.qr = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // [données totales, octets EC par bloc, [nb blocs, octets de données]…]
  const VERS = [null,
    [16, 10, [[1, 16]]], [28, 16, [[1, 28]]], [44, 26, [[1, 44]]], [64, 18, [[2, 32]]], [86, 24, [[2, 43]]],
    [108, 16, [[4, 27]]], [124, 18, [[4, 31]]], [154, 22, [[2, 38], [2, 39]]], [182, 22, [[3, 36], [2, 37]]], [216, 26, [[4, 43], [1, 44]]],
  ];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  const EXP = new Array(512), LOG = new Array(256);
  (function () { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
  const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
  function rsGen(n) { let g = [1]; for (let i = 0; i < n; i++) { const ng = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= gmul(g[j], EXP[i]); } g = ng; } return g; }
  function rsEncode(data, n) {
    const g = rsGen(n), res = new Array(n).fill(0);
    for (const b of data) { const f = b ^ res[0]; res.shift(); res.push(0); if (f) for (let i = 0; i < n; i++) res[i] ^= gmul(g[i + 1], f); }
    return res;
  }
  function utf8(s) { return Array.from(new TextEncoder().encode(s)); }

  function bch(value, poly, bitsData, bitsTotal) {
    let v = value << (bitsTotal - bitsData);
    const polyLen = poly.toString(2).length;
    for (let i = bitsData - 1; i >= 0; i--) if (v & (1 << (i + bitsTotal - bitsData))) v ^= poly << i;
    return (value << (bitsTotal - bitsData)) | v;
  }
  function formatBits(mask) { return (bch((0 << 3) | mask, 0x537, 5, 15)) ^ 0x5412; }   // niveau M = 00
  function versionBits(v) { return bch(v, 0x1f25, 6, 18); }

  function encode(text) {
    const bytes = utf8(text);
    let ver = 0;
    for (let v = 1; v <= 10; v++) { const cc = v < 10 ? 8 : 16; if (4 + cc + 8 * bytes.length <= VERS[v][0] * 8) { ver = v; break; } }
    if (!ver) throw new Error('Texte trop long pour le QR code.');
    const [dataCw, ecLen, groups] = VERS[ver];
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach((b) => put(b, 8));
    for (let i = 0; i < 4 && bits.length < dataCw * 8; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const cw = []; for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; cw.push(b); }
    for (let pad = 0xec; cw.length < dataCw; pad ^= 0xec ^ 0x11) cw.push(pad);
    // blocs
    const blocks = []; let pos = 0;
    groups.forEach(([count, len]) => { for (let i = 0; i < count; i++) { const d = cw.slice(pos, pos + len); pos += len; blocks.push({ d, e: rsEncode(d, ecLen) }); } });
    const out = []; const maxD = Math.max(...blocks.map((b) => b.d.length));
    for (let i = 0; i < maxD; i++) blocks.forEach((b) => { if (i < b.d.length) out.push(b.d[i]); });
    for (let i = 0; i < ecLen; i++) blocks.forEach((b) => out.push(b.e[i]));
    return { ver, codewords: out };
  }

  function build(text) {
    const { ver, codewords } = encode(text);
    const N = 17 + 4 * ver;
    const base = Array.from({ length: N }, () => new Array(N).fill(0));      // 0 clair, 1 sombre
    const fn = Array.from({ length: N }, () => new Array(N).fill(false));    // modules « fonction »
    const set = (r, c, v) => { if (r >= 0 && r < N && c >= 0 && c < N) { base[r][c] = v ? 1 : 0; fn[r][c] = true; } };
    const finder = (r0, c0) => { for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) { const on = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)); set(r0 + r, c0 + c, on); } };
    finder(0, 0); finder(0, N - 7); finder(N - 7, 0);
    for (let i = 8; i < N - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const ap = ALIGN[ver];
    ap.forEach((r) => ap.forEach((c) => {
      if ((r === 6 && c === 6) || (r === 6 && c === ap[ap.length - 1]) || (r === ap[ap.length - 1] && c === 6)) return;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }));
    set(N - 8, 8, true);                                                    // module sombre
    for (let i = 0; i < 9; i++) { if (!fn[8][i]) set(8, i, false); if (!fn[i][8]) set(i, 8, false); }
    for (let i = 0; i < 8; i++) { if (!fn[8][N - 1 - i]) set(8, N - 1 - i, false); if (!fn[N - 1 - i][8]) set(N - 1 - i, 8, false); }
    if (ver >= 7) { const vb = versionBits(ver); for (let i = 0; i < 18; i++) { const bit = (vb >> i) & 1; const a = Math.floor(i / 3), b = i % 3 + N - 11; set(a, b, bit); set(b, a, bit); } }
    // données en zigzag
    const bitsArr = []; codewords.forEach((b) => { for (let i = 7; i >= 0; i--) bitsArr.push((b >> i) & 1); });
    const place = (maskFn) => {
      const m = base.map((row) => row.slice()); let bi = 0, up = true;
      for (let c = N - 1; c > 0; c -= 2) {
        if (c === 6) c = 5;
        for (let k = 0; k < N; k++) {
          const r = up ? N - 1 - k : k;
          for (let dc = 0; dc < 2; dc++) {
            const cc = c - dc; if (fn[r][cc]) continue;
            let bit = bi < bitsArr.length ? bitsArr[bi] : 0; bi++;
            if (maskFn(r, cc)) bit ^= 1; m[r][cc] = bit;
          }
        }
        up = !up;
      }
      return m;
    };
    const MASKS = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
      (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
      (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0, (r, c) => (((r + c) % 2) + (r * c) % 3) % 2 === 0];
    const applyFormat = (m, mask) => {
      const f = formatBits(mask); const g = (i) => (f >> i) & 1;
      for (let i = 0; i <= 5; i++) m[i][8] = g(i);
      m[7][8] = g(6); m[8][8] = g(7); m[8][7] = g(8);
      for (let i = 9; i < 15; i++) m[8][14 - i] = g(i);
      for (let i = 0; i < 8; i++) m[8][N - 1 - i] = g(i);
      for (let i = 8; i < 15; i++) m[N - 15 + i][8] = g(i);
      m[N - 8][8] = 1;
    };
    let best = null, bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const m = place(MASKS[mask]); applyFormat(m, mask);
      const s = penalty(m, N); if (s < bestScore) { bestScore = s; best = m; }
    }
    return best;
  }

  function penalty(m, N) {
    let p = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < N; a++) {
        let run = 1;
        for (let b = 1; b < N; b++) {
          const cur = pass ? m[b][a] : m[a][b], prev = pass ? m[b - 1][a] : m[a][b - 1];
          if (cur === prev) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; } else run = 1;
        }
      }
    }
    for (let r = 0; r < N - 1; r++) for (let c = 0; c < N - 1; c++) { const v = m[r][c]; if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3; }
    const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const match = (get) => { for (let i = 0; i + 11 <= N; i++) { let a = true, b = true; for (let k = 0; k < 11; k++) { const v = get(i + k); if (v !== pat1[k]) a = false; if (v !== pat2[k]) b = false; } if (a) p += 40; if (b) p += 40; } };
    for (let r = 0; r < N; r++) match((i) => m[r][i]);
    for (let c = 0; c < N; c++) match((i) => m[i][c]);
    let dark = 0; for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) dark += m[r][c];
    p += Math.floor(Math.abs(dark * 100 / (N * N) - 50) / 5) * 10;
    return p;
  }

  function draw(canvas, text, scale) {
    const m = build(text), N = m.length, q = 4; scale = scale || 6;
    canvas.width = canvas.height = (N + 2 * q) * scale;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#000';
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (m[r][c]) ctx.fillRect((c + q) * scale, (r + q) * scale, scale, scale);
    return canvas;
  }
  return { build, draw, encode };
});
