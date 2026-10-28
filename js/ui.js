/* LocalTruck – petits utilitaires d'interface (sans framework). */
(function () {
  'use strict';
  const MFT = (window.MFT = window.MFT || {});
  const C = MFT.core;

  /* ---------------------------------------------------------- DOM */
  // Les méthodes natives convertissent null/false en texte « null » : on les rend tolérantes.
  const flat = (a) => a.reduce((r, x) => (Array.isArray(x) ? r.concat(flat(x)) : (x == null || x === false ? r : r.concat([x]))), []);
  ['replaceChildren', 'append', 'prepend'].forEach((m) => { const orig = Element.prototype[m]; Element.prototype[m] = function (...a) { return orig.apply(this, flat(a)); }; });
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') { if (typeof v === 'string') el.style.cssText = v; else Object.assign(el.style, v); }
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else if (k === 'disabled') el.disabled = !!v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'ref') v(el);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    append(el, kids);
    return el;
  }
  function append(el, kids) {
    for (const k of kids) {
      if (k == null || k === false) continue;
      if (Array.isArray(k)) append(el, k);
      else if (k instanceof Node) el.appendChild(k);
      else el.appendChild(document.createTextNode(String(k)));
    }
    return el;
  }
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

  /* ---------------------------------------------------------- icônes (24×24, trait) */
  const P = {
    back: 'M15 5l-7 7 7 7', close: 'M6 6l12 12M18 6L6 18', search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
    pin: 'M12 21s-7-6.2-7-11.5A7 7 0 0112 2.5a7 7 0 017 7C19 14.800 12 21 12 21zM12 7.500a2.500 2.500 0 100 5 2.500 2.500 0 000-5z',
    route: 'M5 19a2 2 0 100-4 2 2 0 000 4zM19 9a2 2 0 100-4 2 2 0 000 4zM7 17h6a3 3 0 003-3v0a3 3 0 00-3-3h-2a3 3 0 01-3-3v0a3 3 0 013-3h4',
    heart: 'M12 20s-7.500-4.600-7.500-10.200A4.300 4.300 0 0112 7.300a4.300 4.300 0 017.500 2.500C19.500 15.400 12 20 12 20z',
    bell: 'M6 16V11a6 6 0 1112 0v5l1.500 2h-15L6 16zM10 21h4', user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 3.500-6 8-6s8 2 8 6',
    map: 'M9 4L3 6.500v14L9 18l6 2.500 6-2.500v-14L15 6.500 9 4zM9 4v14M15 6.500v14', list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', check: 'M5 12.500l4.500 4.500L19 7', alert: 'M12 3l10 18H2L12 3zM12 10v5M12 18h.01',
    share: 'M12 15V3M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7', more: 'M5 12h.01M12 12h.01M19 12h.01', clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
    truck: 'M2 6h11v10H2zM13 9h4l4 4v3h-8zM6 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z', edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.500 6.500l4 4',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.500 3.500 0 100-7 3.500 3.500 0 000 7z',
    locate: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M2 12h3M19 12h3', calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4', chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
    logout: 'M10 4H5v16h5M16 8l4 4-4 4M20 12H9', shield: 'M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6l8-3z', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z', eyeoff: 'M3 3l18 18M10.600 5.100A9.800 9.800 0 0112 5c6 0 10 7 10 7a17.500 17.500 0 01-3.200 4.100M6.500 6.700C3.700 8.500 2 12 2 12s4 7 10 7c1.800 0 3.400-.5 4.800-1.300M9.900 9.900a3 3 0 004.200 4.200',
    copy: 'M9 9h11v11H9zM5 15V4h11', flag: 'M5 21V4M5 4h12l-2 4 2 4H5', send: 'M21 3L3 11l7 3 3 7 8-18z', right: 'M9 5l7 7-7 7', down: 'M5 9l7 7 7-7', up: 'M5 15l7-7 7 7',
    sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4', image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9.500a1 1 0 100-2 1 1 0 000 2z',
    leaf: 'M5 19C5 10 10 5 20 4c0 10-5 15-13 15M5 19c2-5 5-8 9-10', qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h3v3h-3zM20 14v3M14 20h3M20 20h0', users: 'M9 11a3.500 3.500 0 100-7 3.500 3.500 0 000 7zM2 20c0-3.500 3-5.500 7-5.500s7 2 7 5.500M17 11a3 3 0 100-6M18 14.600c2.500.600 4 2.200 4 5.400',
    home: 'M3 11l9-8 9 8M5 10v10h14V10', download: 'M12 3v12M7.500 10.500L12 15l4.500-4.500M5 20h14', pause: 'M8 5v14M16 5v14', stop: 'M6 6h12v12H6z', play: 'M7 4l13 8-13 8z', cloud: 'M7 18a4 4 0 010-8 5.500 5.500 0 0110.500 1.500A3.300 3.300 0 0117 18z',
    moon: 'M20 14A8 8 0 019.500 4 8 8 0 1020 14z', sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 2v2M12 20v2M4.900 4.900l1.400 1.400M17.700 17.700l1.400 1.400M2 12h2M20 12h2M4.900 19.100l1.400-1.400M17.700 6.300l1.400-1.400', gift: 'M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9s-1-5-4-5a2.500 2.500 0 000 5M12 9s1-5 4-5a2.500 2.500 0 010 5', tag: 'M3 12V4h8l10 10-8 8L3 12zM7.500 8.500h.01',
    instagram: 'M7 3h10a4 4 0 014 4v10a4 4 0 01-4 4H7a4 4 0 01-4-4V7a4 4 0 014-4zM12 8.500a3.500 3.500 0 100 7 3.500 3.500 0 000-7zM17.500 6.500h.01', facebook: 'M14 8.500h3V4h-3a4.500 4.500 0 00-4.500 4.500V11H7v4.500h2.500V21H14v-5.500h3l.500-4.500H14V9a.5.500 0 01.500-.500z',
    refresh: 'M20 11a8 8 0 00-14.500-3.500L4 9M4 4v5h5M4 13a8 8 0 0014.500 3.500L20 15M20 20v-5h-5', swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7', info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.500h.01',
  };
  const NS = 'http://www.w3.org/2000/svg';
  function icon(name, size, cls) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'i' + (cls ? ' ' + cls : ''));
    if (size) { s.style.width = size + 'px'; s.style.height = size + 'px'; }
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', P[name] || P.info); s.appendChild(p);
    return s;
  }
  function starIcon(filled) {
    const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24');
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', 'M12 2.500l2.900 6 6.600.9-4.800 4.600 1.200 6.500L12 17.400 6.100 20.500l1.200-6.500L2.500 9.400l6.600-.9z');
    p.setAttribute('fill', filled ? 'currentColor' : 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '1.8'); p.setAttribute('stroke-linejoin', 'round');
    s.appendChild(p); return s;
  }
  function stars(avg, size) {
    const w = h('span', { class: 'stars' }); const r = Math.round(avg);
    for (let i = 1; i <= 5; i++) { const s = starIcon(i <= r); if (i > r) s.classList.add('off'); if (size) { s.style.width = size + 'px'; s.style.height = size + 'px'; } w.appendChild(s); }
    return w;
  }

  /* ---------------------------------------------------------- éléments communs */
  function avatar(truck, cls) {
    const el = h('div', { class: 'avatar' + (cls ? ' ' + cls : '') });
    if (truck.logo) { el.style.backgroundImage = 'url(' + truck.logo + ')'; el.style.background = '#222 center/cover url(' + truck.logo + ')'; }
    else { el.style.background = truck.color || '#FF6A3D'; el.textContent = (truck.name || '?').trim().charAt(0).toUpperCase(); }
    return el;
  }
  function statusTag(status, slot) {
    if (status === 'open') return h('span', { class: 'tag open' }, h('span', { class: 'pulse' }), 'Ouvert');
    if (status === 'soon') return h('span', { class: 'tag soon' }, 'Dès ' + C.fmtHM(slot.start));
    if (status === 'later') return h('span', { class: 'tag' }, 'Dès ' + C.fmtHM(slot.start));
    if (status === 'cancelled') return h('span', { class: 'tag cancelled' }, 'Fermé ce soir');
    return h('span', { class: 'tag' }, 'Terminé');
  }
  function verifyTag(truck) {
    return truck.verified ? h('span', { class: 'tag ver' }, icon('check', 12), 'Vérifié') : h('span', { class: 'tag unv' }, 'Pas encore vérifié');
  }
  const suspectIcon = (sz) => h('span', { class: 'sus-ico', title: 'Food truck signalé plusieurs fois : soyez vigilant', style: sz ? { width: sz + 'px', height: sz + 'px' } : null }, '!');
  function suspectTag() { return h('span', { class: 'tag sus', title: 'Signalé plusieurs fois' }, h('b', null, '!'), 'Suspect'); }

  function ago(ts, now) {
    const d = Math.max(0, (+now || Date.now()) - ts); const m = Math.round(d / 60000);
    if (m < 1) return 'à l’instant'; if (m < 60) return 'il y a ' + m + ' min';
    const hh = Math.round(m / 60); if (hh < 24) return 'il y a ' + hh + ' h';
    const dd = Math.round(hh / 24); return 'il y a ' + dd + ' j';
  }
  const money = (n) => (n == null || n === '' ? '' : Number(n).toFixed(2).replace('.', ',').replace(',00', '') + ' €');

  function setRange(inp) { const min = +inp.min || 0, max = +inp.max || 100; inp.style.setProperty('--p', ((inp.value - min) / (max - min) * 100) + '%'); }
  function slider(min, max, value, onInput) {
    const inp = h('input', { type: 'range', min, max, step: 1, value });
    setRange(inp); inp.addEventListener('input', () => { setRange(inp); onInput(+inp.value); });
    return inp;
  }
  /** Curseur de rayon : de 100 m à 50 km par paliers (C.RADIUS_STEPS). La valeur du champ est la position du palier, pas des km : utiliser C.RADIUS_STEPS[+champ.value]. */
  function radiusSlider(km, onInput) { return slider(0, C.RADIUS_STEPS.length - 1, C.radiusIndex(km), (i) => onInput(C.RADIUS_STEPS[i])); }
  function toggle(checked, onChange) {
    const inp = h('input', { type: 'checkbox', checked }); inp.addEventListener('change', () => onChange(inp.checked));
    return h('label', { class: 'switch' }, inp, h('i'));
  }
  function field(label, input, hint) { return h('div', { class: 'field' }, label ? h('label', null, label) : null, input, hint ? h('div', { class: 'hint' }, hint) : null); }
  /** Champ mot de passe avec un œil pour vérifier ce qu'on a tapé (le champ reste le même élément : lecture, événements et sélecteurs inchangés). */
  function pwdField(input) {
    let shown = false;
    input.setAttribute('autocapitalize', 'off'); input.setAttribute('autocorrect', 'off'); input.setAttribute('spellcheck', 'false');
    const btn = h('button', { type: 'button', class: 'pw-eye', 'aria-label': 'Afficher le mot de passe', 'aria-pressed': 'false' }, icon('eye', 20));
    btn.addEventListener('click', () => {
      shown = !shown; input.type = shown ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(shown)); btn.setAttribute('aria-label', shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
      btn.replaceChildren(icon(shown ? 'eyeoff' : 'eye', 20)); input.focus();
    });
    return h('div', { class: 'pw' }, input, btn);
  }
  function empty(big, title, text, action) { return h('div', { class: 'empty' }, h('div', { class: 'big' }, big), h('h3', null, title), h('div', null, text), action ? h('div', { class: 'mt16' }, action) : null); }
  function chipRow(options, selected, onPick, opts) {
    opts = opts || {};
    const row = h('div', { class: 'chips' + (opts.wrap ? ' wrap' : '') });
    const sel = new Set(Array.isArray(selected) ? selected : [selected]);
    options.forEach((o) => {
      const v = typeof o === 'object' ? o.value : o, lab = typeof o === 'object' ? o.label : o;
      const b = h('button', { class: 'chip' + (opts.cls ? ' ' + opts.cls : '') + (sel.has(v) ? ' on' : ''), type: 'button' }, lab);
      b.addEventListener('click', () => onPick(v, b));
      row.appendChild(b);
    });
    return row;
  }

  /* ---------------------------------------------------------- toasts, feuilles, dialogues */
  function appRoot() { return document.getElementById('app'); }
  function toast(msg, kind) {
    let box = appRoot().querySelector('.toasts');
    if (!box) { box = h('div', { class: 'toasts' }); appRoot().appendChild(box); }
    const t = h('div', { class: 'toast' + (kind ? ' ' + kind : ''), role: 'status' }, msg);
    box.appendChild(t); setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, kind === 'err' ? 4200 : 2600);
  }
  function openSheet(title, content, opts) {
    opts = opts || {};
    const body = h('div', { class: 'sh-body' }, content);
    const close = () => { ov.remove(); if (opts.onClose) opts.onClose(); };
    const sheet = h('div', { class: 'sheet', style: opts.full ? { height: '92%' } : null },
      h('div', { class: 'sh-hd' }, h('h2', null, title), h('button', { class: 'icon-btn', 'aria-label': 'Fermer', onClick: close }, icon('close'))), body);
    const ov = h('div', { class: 'overlay', onMousedown: (e) => { if (e.target === ov) close(); } }, sheet);
    appRoot().appendChild(ov);
    // hide/show : permet de masquer temporairement la feuille (ex. pendant qu'un écran plein format, comme la carte de choix du lieu, est ouvert par-dessus)
    return { close, body, el: sheet, hide: () => { ov.style.display = 'none'; }, show: () => { ov.style.display = ''; } };
  }
  function confirmDialog(o) {
    return new Promise((res) => {
      const done = (v) => { ov.remove(); res(v); };
      const ov = h('div', { class: 'overlay center', onMousedown: (e) => { if (e.target === ov) done(false); } },
        h('div', { class: 'dialog', role: 'dialog' }, h('h2', null, o.title), o.text ? h('p', null, o.text) : null,
          o.content || null,
          h('div', { class: 'row gap8 mt16', style: { justifyContent: 'flex-end' } },
            h('button', { class: 'btn ghost', onClick: () => done(false) }, o.cancelLabel || 'Annuler'),
            h('button', { class: 'btn ' + (o.danger ? 'danger' : 'primary'), onClick: () => done(true) }, o.okLabel || 'Confirmer'))));
      appRoot().appendChild(ov);
    });
  }

  /* ---------------------------------------------------------- images : réduction avant stockage */
  function pickImage(maxSide, quality) {
    return new Promise((resolve, reject) => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = () => {
        const f = inp.files && inp.files[0]; if (!f) return resolve(null);
        const url = URL.createObjectURL(f); const img = new Image();
        img.onload = () => {
          const k = Math.min(1, maxSide / Math.max(img.width, img.height));
          const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
          resolve(c.toDataURL('image/jpeg', quality || 0.82));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible.')); };
        img.src = url;
      };
      inp.click();
    });
  }
  function squareLogo(maxSide) {
    return new Promise((resolve, reject) => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
      inp.onchange = () => {
        const f = inp.files && inp.files[0]; if (!f) return resolve(null);
        const url = URL.createObjectURL(f); const img = new Image();
        img.onload = () => {
          const s = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = maxSide;
          c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, maxSide, maxSide); URL.revokeObjectURL(url);
          resolve(c.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible.')); };
        img.src = url;
      };
      inp.click();
    });
  }

  MFT.ui = { h, append, clear, icon, pwdField, starIcon, stars, avatar, statusTag, verifyTag, suspectIcon, suspectTag, ago, money, slider, radiusSlider, setRange, toggle, field, empty, chipRow, toast, openSheet, confirmDialog, pickImage, squareLogo, appRoot };
})();
