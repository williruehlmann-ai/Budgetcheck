
/* =====================================================================
   Beratungstool: Rahmen um Budgetcheck (Abfragebogen, Bestand, Speichern)
   ===================================================================== */
const SCHEMA = 1;
const ADVISOR = { name: 'Max Rühlmann', phone: '0173 8903097', mail: 'max.ruehlmann@tecis.de' };
const advContact = () => [ADVISOR.phone, ADVISOR.mail].filter(Boolean).join(' · ');
const pad2 = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const deDate = (iso) => { const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso || ''); return m ? (m[3] ? `${m[3]}.${m[2]}.${m[1]}` : `${m[2]}.${m[1]}`) : ''; };
const isEmpty = (v) => v === '' || v == null;
const getP = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function setP(o, p, v) { const ks = p.split('.'), last = ks.pop(); const t = ks.reduce((a, k) => (a[k] ??= {}), o); t[last] = v; }

/* ---------- Datenmodell ---------- */
function newKunde() {
  return {
    app: 'beratungstool', schemaVersion: SCHEMA, erstellt: new Date().toISOString(), geaendert: '',
    termine: [], naechsterService: '', notizen: '',
    person: { anrede: '', vorname: '', nachname: '', geburtsdatum: '', staatsangehoerigkeit: 'deutsch',
      adresse: { strasse: '', plz: '', ort: '' }, kontakt: { mobil: '', email: '' },
      familienstand: '', partnerName: '', kinder: [], kinderwunsch: { status: '', horizont: '' },
      wohnen: { art: '', flaeche: '' }, steuerklasse: '' },
    beruf: { schulabschluss: '', ausbildung: '', ausbildungStatus: '', bezeichnung: '', status: '', beamtenstatus: '',
      anteile: { buero: '', koerperlich: '', reisen: '' }, personal: { ja: null, anzahl: '' }, brutto: '' },
    gesundheit: { aktiv: false, groesse: '', gewicht: '', raucher: '',
      ambulant: { ja: null, liste: [] }, stationaer: { ja: null, liste: [] }, psyche: { ja: null, liste: [] }, medikamente: { ja: null, liste: [] },
      allergien: { ja: null, text: '' }, ruecken: { ja: null, text: '' }, schwerbehinderung: { ja: null, gdb: '' },
      sehstaerke: { links: '', rechts: '' }, antraege: { ja: null, text: '' }, hobbys: { ja: null, text: '' }, ausland: { ja: null, text: '' }, aerzte: [] },
    vertraege: [], kv: { art: '', anbieter: '' },
    rente: { vorhanden: null, erreicht: '', hochgerechnet: '', stand: '' },
    bav: { ja: null, eigen: '', arbeitgeber: '' }, vl: { arbeitgeberZahlt: null, betrag: '', genutzt: null },
    budget: emptyState(), vorherNachher: null, vnAuto: [], bestand: {}, ziele: [], empfehlungen: [],
  };
}
function merge(def, src) {
  if (Array.isArray(def) || def === null || typeof def !== 'object') return src === undefined ? def : src;
  if (src === null || typeof src !== 'object' || Array.isArray(src)) return def;
  const out = {};
  new Set([...Object.keys(def), ...Object.keys(src)]).forEach((k) => { out[k] = k in def ? merge(def[k], src[k]) : src[k]; });
  return out;
}
let K = newKunde();
S = K.budget;
let dirtyFlag = false, showMiss = false, mainTab = 'bogen';

/* ---------- Auswahllisten ---------- */
const OPT = {
  anrede: [['frau', 'Frau'], ['herr', 'Herr'], ['keine', 'keine Angabe']],
  familienstand: [['ledig', 'ledig'], ['partnerschaft', 'in Partnerschaft'], ['verheiratet', 'verheiratet'], ['geschieden', 'geschieden'], ['verwitwet', 'verwitwet']],
  kinderwunsch: [['ja', 'ja'], ['nein', 'nein'], ['offen', 'offen']],
  wohnen: [['miete', 'Miete'], ['eigentum', 'Eigentum'], ['eltern', 'bei den Eltern']],
  steuerklasse: [1, 2, 3, 4, 5, 6].map((n) => [n, String(n)]),
  schulabschluss: [['hauptschule', 'Hauptschule'], ['mittlere-reife', 'Mittlere Reife'], ['fachabitur', 'Fachabitur'], ['abitur', 'Abitur'], ['keiner', 'keiner']],
  ausbildungStatus: [['abgeschlossen', 'abgeschlossen'], ['laufend', 'laufend']],
  status: [['angestellt', 'angestellt'], ['beamter', 'Beamter'], ['selbststaendig', 'selbstständig'], ['azubi', 'Azubi'], ['student', 'Student']],
  beamtenstatus: [['widerruf', 'auf Widerruf'], ['probe', 'auf Probe'], ['lebenszeit', 'auf Lebenszeit']],
  raucher: [['nichtraucher', 'Nichtraucher'], ['raucher', 'Raucher'], ['e-zigarette', 'E-Zigarette']],
  kv: [['gkv', 'GKV'], ['pkv', 'PKV'], ['beihilfe', 'Beihilfe + PKV'], ['heilfuersorge', 'freie Heilfürsorge']],
  horizont: [['kurz', 'kurz (bis 3 Jahre)'], ['mittel', 'mittel (3 bis 10 Jahre)'], ['lang', 'lang (über 10 Jahre)']],
  zahlweise: [['m', 'monatlich'], ['q', 'vierteljährlich'], ['h', 'halbjährlich'], ['j', 'jährlich']],
};
const optLabel = (list, v) => { const o = OPT[list].find((x) => String(x[0]) === String(v)); return o ? o[1] : ''; };
const ZWD = { m: 1, q: 3, h: 6, j: 12 };

/* ---------- Verträge: Sparten aus Vorher-Nachher, Zuordnung zum Budgetcheck ---------- */
const NO_CONTRACT = ['Gesetzliche KV', 'Gesetzliche Rente', 'Einmalanlage', 'Termingeld', 'Tagesgeld', 'Notreserve'];
const SPARTEN = VN_GROUPS.filter((g) => g.id !== 'opt').map((g) => ({ id: g.id, name: g.name, items: g.items.filter((n) => !NO_CONTRACT.includes(n)) })).filter((g) => g.items.length);
const spartenGruppe = (name) => (SPARTEN.find((g) => g.items.includes(name)) || { id: 'sonst' }).id;
const BC_MAP = {
  'Privathaftpflicht': 'liability', 'Hausrat': 'household', 'Berufsunfähigkeit': 'bu', 'Dienstunfähigkeit': 'bu', 'Risikoleben': 'term_life',
  'Unfallversicherung': 'accident', 'Rechtsschutz': 'legal', 'Private KV': 'health', 'Beihilfeergänzung': 'health', 'Krankenzusatz ambulant': 'health',
  'Krankenzusatz stationär': 'health', 'Krankentagegeld': 'health', 'Zahnzusatz': 'dental', 'Pflegezusatz': 'care', 'Wohngebäude': 'building',
  'Kfz-Versicherung': 'car_ins', 'Kfz-Versicherung 2': 'car_ins', 'Motorrad': 'car_ins',
  'Flexible Rente': 'pension', 'Rürup-Rente': 'pension', 'Riester-Rente': 'pension', 'Betriebliche AV': 'pension', 'Kapitallebensversicherung': 'pension',
  'Altersvorsorgedepot': 'avd_rate', 'Fondssparen': 'savings', 'Vermögenswirksame Leistungen': 'savings', 'Bausparvertrag': 'savings',
};
const bcKey = (c) => 'ex-' + (BC_MAP[c.sparte] || 'insurance');
const CONTRACT_KEYS = GROUPS.find((g) => g.id === 'protect').items.map((f) => 'ex-' + f.id).concat(['ex-pension', 'ex-avd_rate', 'ex-savings']);
const contractMonthly = (c) => (parseFloat(c.beitrag) || 0) / (ZWD[c.zahlweise] || 1);

/* Vertragsliste ist die einzige Quelle: Budgetcheck-Zeilen werden daraus berechnet */
function syncContracts() {
  const sum = {}, co = {};
  K.vertraege.forEach((c) => {
    if (!c.sparte) return;
    const k = bcKey(c); sum[k] = (sum[k] || 0) + contractMonthly(c);
    const g = (c.gesellschaft || '').trim(); if (g) (co[k] = co[k] || new Set()).add(g);
  });
  CONTRACT_KEYS.forEach((k) => {
    delete S.iv[k];
    if (sum[k] > 0) S.v[k] = String(Math.round(sum[k] * 100) / 100); else delete S.v[k];
    if (co[k]) S.co[k] = [...co[k]].join(', '); else delete S.co[k];
  });
}
function lockContractRows() {
  CONTRACT_KEYS.forEach((k) => {
    const inp = $(k); if (!inp) return;
    inp.disabled = true; inp.title = 'Kommt aus der Vertragsliste im Abfragebogen';
    const wrap = inp.parentElement; wrap.querySelector('.x').hidden = true;
    const iv = wrap.querySelector('.iv'); if (iv) iv.disabled = true;
    const co = document.querySelector(`[data-co="${k}"]`); if (co) co.disabled = true;
  });
  [['ex:protect', 'Die Beiträge kommen aus der Vertragsliste im Abfragebogen.'], ['ex:saving', 'Sparplan, Altersvorsorge und Altersvorsorgedepot kommen aus der Vertragsliste im Abfragebogen.']].forEach(([g, txt]) => {
    const head = document.querySelector(`[data-g="${g}"] .group-head`);
    if (head) head.insertAdjacentHTML('afterend', `<p class="lock-note">${txt} <button type="button" class="link" data-act="goto" data-sec="s4">Verträge bearbeiten</button></p>`);
  });
}

/* ---------- Budgetcheck-Anbindung ---------- */
function save() { markDirty(); }
function syncName() { S.name = `${K.person.vorname} ${K.person.nachname}`.trim(); S.notes = ''; }
function applyState() { K.budget = S; syncContracts(); buildForms(); lockContractRows(); render(); }
let current = 'budget';
function placeIndicator() {
  const t = document.querySelector('.tab[aria-selected="true"]'), ind = $('seg-ind');
  if (!t) return;
  ind.style.width = t.offsetWidth + 'px'; ind.style.transform = `translateX(${t.offsetLeft}px)`;
}
function show(view) {
  current = view;
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === view)));
  ['budget', 'wealth'].forEach((v) => {
    const el = $('view-' + v), on = v === view; el.hidden = !on;
    if (on) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); }
  });
  placeIndicator();
}
addEventListener('resize', placeIndicator);
document.querySelectorAll('.right').forEach((rc) => rc.addEventListener('scroll', () => rc.classList.toggle('scrolled', rc.scrollTop > 4), { passive: true }));

/* ---------- Berechnete Werte ---------- */
function alter() {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(K.person.geburtsdatum || ''); if (!m) return null;
  const n = new Date(); let a = n.getFullYear() - +m[1];
  if (n.getMonth() + 1 < +m[2] || (n.getMonth() + 1 === +m[2] && n.getDate() < +m[3])) a--;
  return a >= 0 && a < 130 ? a : null;
}
function bmi() {
  const g = parseFloat(K.gesundheit.groesse), w = parseFloat(K.gesundheit.gewicht);
  if (!(g > 0) || !(w > 0)) return null;
  return Math.round(w / Math.pow(g / 100, 2) * 10) / 10;
}
const de1 = (n) => n.toFixed(1).replace('.', ',');
function anteilSumme() {
  const a = K.beruf.anteile, vals = [a.buero, a.koerperlich, a.reisen];
  if (vals.every(isEmpty)) return null;
  return vals.reduce((s, v) => s + (parseFloat(v) || 0), 0);
}
const nettoMonat = () => { const v = S.v['in-salary']; if (isEmpty(v)) return ''; const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? (S.iv['in-salary'] === 'y' ? Math.round(n / 12 * 100) / 100 : n) : ''; };

/* ---------- Bestandsübersicht ---------- */
const BESTAND = [
  { id: 'haftpflicht', label: 'Privathaftpflicht', sp: ['Privathaftpflicht', 'Diensthaftpflicht'], def: () => 'fehlt' },
  { id: 'hausrat', label: 'Hausrat', sp: ['Hausrat'], def: () => (K.person.wohnen.art === 'eltern' ? 'pruefen' : 'fehlt') },
  { id: 'arbeitskraft', label: 'Arbeitskraft (IAA)', sp: ['Berufsunfähigkeit', 'Dienstunfähigkeit', 'Grundfähigkeit', 'Erwerbsunfähigkeit', 'Schwere Krankheiten'], def: () => 'fehlt' },
  { id: 'kv', label: 'Krankenversicherung', auto: () => (K.kv.art ? 'vorhanden' : 'pruefen'), info: () => (K.kv.art ? [optLabel('kv', K.kv.art), K.kv.anbieter].filter(Boolean).join(' · ') : '') },
  { id: 'krankenzusatz', label: 'Krankenzusatz', sp: ['Zahnzusatz', 'Krankenzusatz ambulant', 'Krankenzusatz stationär', 'Beihilfeergänzung'], def: () => 'pruefen' },
  { id: 'pflege', label: 'Pflegezusatz', sp: ['Pflegezusatz'], def: () => 'pruefen' },
  { id: 'unfall', label: 'Unfall', sp: ['Unfallversicherung'], def: () => 'pruefen' },
  { id: 'risikoleben', label: 'Risikoleben', sp: ['Risikoleben'], def: () => (K.person.kinder.length || num('w-mortgage') > 0 ? 'fehlt' : 'pruefen') },
  { id: 'rechtsschutz', label: 'Rechtsschutz', sp: ['Rechtsschutz'], def: () => 'pruefen' },
  { id: 'wohngebaeude', label: 'Wohngebäude', sp: ['Wohngebäude'], def: () => 'fehlt', hide: () => K.person.wohnen.art !== 'eigentum' },
  { id: 'kfz', label: 'Kfz', sp: ['Kfz-Versicherung', 'Kfz-Versicherung 2', 'Motorrad'], def: () => 'pruefen' },
  { id: 'altersvorsorge', label: 'Altersvorsorge', sp: ['Flexible Rente', 'Rürup-Rente', 'Riester-Rente', 'Betriebliche AV', 'Altersvorsorgedepot', 'Kapitallebensversicherung'], def: () => 'fehlt' },
  { id: 'investment', label: 'Investment', sp: ['Fondssparen', 'Vermögenswirksame Leistungen', 'Bausparvertrag'], def: () => 'fehlt' },
  { id: 'notreserve', label: 'Notreserve', auto: () => { const rm = reserveMonths(calcBudget(), calcWealth()); return rm != null && rm >= 3 ? 'vorhanden' : 'pruefen'; },
    info: () => { const rm = reserveMonths(calcBudget(), calcWealth()); return rm == null ? 'aus dem Budgetcheck, noch keine Angaben' : `reicht für ${fmtMonths(rm)}`; } },
];
const ST_LABEL = { vorhanden: 'vorhanden', fehlt: 'fehlt', pruefen: 'prüfen' };
function bestandRows() {
  const valid = K.vertraege.filter((c) => c.sparte);
  const covered = new Set(BESTAND.flatMap((b) => b.sp || []));
  const rows = BESTAND.map((b) => {
    const mine = b.sp ? valid.filter((c) => b.sp.includes(c.sparte)) : [];
    const auto = b.auto ? b.auto() : (mine.length ? 'vorhanden' : b.def());
    const man = K.bestand[b.id];
    const info = b.info ? b.info() : mine.map((c) => [c.sparte, (c.gesellschaft || '').trim()].filter(Boolean).join(' · ')).join(', ');
    return { id: b.id, label: b.label, auto, status: man && man.manuell ? man.status : auto, manuell: !!(man && man.manuell), info, hidden: !!(b.hide && b.hide() && !mine.length) };
  }).filter((r) => !r.hidden);
  const other = valid.filter((c) => !covered.has(c.sparte));
  if (other.length) rows.push({ id: 'weitere', label: 'Weitere', auto: 'vorhanden', status: 'vorhanden', manuell: false, fixed: true, info: other.map((c) => c.sparte).join(', ') });
  return rows;
}
const themen = () => { const r = bestandRows(); return r.filter((x) => x.status === 'fehlt').concat(r.filter((x) => x.status === 'pruefen')); };

/* ---------- Vollständigkeitscheck ---------- */
const iaa = () => K.gesundheit.aktiv;
const REQ = [
  ['person.vorname', 'Vorname', 's1'], ['person.nachname', 'Nachname', 's1'], ['person.geburtsdatum', 'Geburtsdatum', 's1'],
  ['person.staatsangehoerigkeit', 'Staatsangehörigkeit', 's1'], ['person.adresse.strasse', 'Straße und Hausnummer', 's1'],
  ['person.adresse.plz', 'PLZ', 's1'], ['person.adresse.ort', 'Ort', 's1'], ['person.kontakt.mobil', 'Mobilnummer', 's1'], ['person.kontakt.email', 'E-Mail', 's1'],
  ['person.familienstand', 'Familienstand', 's1'], ['person.wohnen.art', 'Wohnsituation', 's1'],
  ['person.steuerklasse', 'Steuerklasse', 's1', () => K.beruf.status !== 'selbststaendig'],
  ['beruf.bezeichnung', 'Genaue Berufsbezeichnung', 's2'], ['beruf.status', 'Berufsstatus', 's2'], ['beruf.brutto', 'Brutto pro Monat', 's2'], ['budget.v.in-salary', 'Netto pro Monat', 's2'],
  ['beruf.anteile.buero', 'Tätigkeit Büro in %', 's2', iaa], ['beruf.anteile.koerperlich', 'Tätigkeit körperlich in %', 's2', iaa], ['beruf.anteile.reisen', 'Tätigkeit Reisen in %', 's2', iaa],
  ['gesundheit.groesse', 'Größe', 's3', iaa], ['gesundheit.gewicht', 'Gewicht', 's3', iaa], ['gesundheit.raucher', 'Raucher', 's3', iaa],
  ['gesundheit.ambulant.ja', 'Ambulante Behandlungen', 's3', iaa], ['gesundheit.stationaer.ja', 'Stationäre Behandlungen', 's3', iaa],
  ['gesundheit.psyche.ja', 'Psyche / Therapie', 's3', iaa], ['gesundheit.medikamente.ja', 'Regelmäßige Medikamente', 's3', iaa],
  ['gesundheit.allergien.ja', 'Allergien', 's3', iaa], ['gesundheit.ruecken.ja', 'Rücken / Gelenke', 's3', iaa],
  ['gesundheit.schwerbehinderung.ja', 'Schwerbehinderung', 's3', iaa], ['gesundheit.antraege.ja', 'Abgelehnte oder laufende Anträge', 's3', iaa],
  ['gesundheit.hobbys.ja', 'Gefährliche Hobbys', 's3', iaa],
  ['kv.art', 'Krankenversicherung', 's4'],
];
const SEC_NAME = { s1: 'Persönliche Daten', s2: 'Beruf & Ausbildung', s3: 'IAA-Gesundheit', s4: 'Bestand & Finanzen' };
const isReq = (p) => { const r = REQ.find((x) => x[0] === p); return !!r && (!r[3] || r[3]()); };
function missing() {
  const out = REQ.filter((r) => (!r[3] || r[3]()) && isEmpty(getP(K, r[0]))).map((r) => ({ label: r[1], sec: r[2], p: r[0] }));
  const plz = K.person.adresse.plz; if (!isEmpty(plz) && !/^\d{5}$/.test(String(plz).trim())) out.push({ label: 'PLZ hat keine 5 Ziffern', sec: 's1', p: 'person.adresse.plz' });
  const sum = anteilSumme(); if (sum != null && Math.round(sum) !== 100) out.push({ label: `Tätigkeitsanteile ergeben ${Math.round(sum)} % statt 100 %`, sec: 's2', p: 'beruf.anteile.buero' });
  K.vertraege.forEach((c, i) => { if (!c.sparte || isEmpty(c.beitrag)) out.push({ label: `Vertrag ${i + 1}: Sparte und Beitrag`, sec: 's4', el: 'l-vertraege' }); });
  if (!K.ziele.some((z) => (z.text || '').trim())) out.push({ label: 'Mindestens ein Ziel, Wunsch oder Traum', sec: 's4', el: 'l-ziele' });
  return out;
}

/* ---------- Formular-Bausteine ---------- */
const fid = (p) => 'f-' + p.replace(/[.]/g, '-');
function fld(p, label, type = 'text', o = {}) {
  let v = p === 'budget.v.in-salary' ? nettoMonat() : (getP(K, p) ?? '');
  const req = isReq(p), miss = showMiss && req && isEmpty(v), id = fid(p);
  let ctl;
  if (type === 'select') {
    ctl = `<select class="inp" id="${id}" data-p="${p}"><option value="">Bitte wählen</option>${OPT[o.opt].map(([val, lab]) => `<option value="${esc(val)}"${String(v) === String(val) ? ' selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
  } else if (type === 'yn') {
    ctl = `<div class="yn" role="group" aria-label="${esc(label)}" id="${id}"><button type="button" data-act="yn" data-p="${p}" data-v="1" class="${v === true ? 'on' : ''}" aria-pressed="${v === true}">Ja</button><button type="button" data-act="yn" data-p="${p}" data-v="0" class="${v === false ? 'on' : ''}" aria-pressed="${v === false}">Nein</button></div>`;
  } else {
    const num = type === 'number';
    ctl = `<input class="inp" id="${id}" data-p="${p}" data-t="${type}" type="${num ? 'number' : type}"${num ? ` inputmode="decimal" step="${o.step || 'any'}" min="${o.min ?? 0}"${o.max != null ? ` max="${o.max}"` : ''}` : ''} value="${esc(v)}"${o.ph ? ` placeholder="${esc(o.ph)}"` : ''}${o.ac ? ` autocomplete="${o.ac}"` : ' autocomplete="off"'}>`;
  }
  const lab = type === 'yn' ? `<span class="lab">${esc(label)}${req ? ' <i>*</i>' : ''}</span>` : `<label for="${id}">${esc(label)}${req ? ' <i>*</i>' : ''}</label>`;
  return `<div class="f${o.span ? ' s' + o.span : ''}${miss ? ' miss' : ''}" data-f="${p}">${lab}${ctl}${o.note ? `<small>${o.note}</small>` : ''}</div>`;
}
const LISTS = {
  'person.kinder': { cols: [['vorname', 'Vorname'], ['geburtsjahr', 'Geburtsjahr', 'number']], grid: 'minmax(0,1fr) 140px', add: '+ Kind', empty: 'Keine Kinder erfasst.', blank: () => ({ vorname: '', geburtsjahr: '' }) },
  'vertraege': { cols: [['sparte', 'Sparte *', 'sparte'], ['gesellschaft', 'Gesellschaft'], ['beitrag', 'Beitrag in € *', 'number'], ['zahlweise', 'Zahlweise', 'select', 'zahlweise'], ['beginn', 'Beginn', 'month'], ['ablauf', 'Ablauf', 'date'], ['leistung', 'Leistung, z. B. BU-Rente 1.500 €']],
    grid: 'minmax(170px,1.3fr) minmax(120px,1fr) 110px 130px 140px 145px minmax(150px,1.2fr)', minw: '1040px', add: '+ Vertrag', empty: 'Noch kein Vertrag erfasst.',
    blank: () => ({ id: Math.random().toString(36).slice(2, 8), sparte: '', gruppe: '', gesellschaft: '', beitrag: '', zahlweise: 'm', beginn: '', ablauf: '', leistung: '' }) },
  'ziele': { cols: [['text', 'Ziel, Wunsch oder Traum'], ['horizont', 'Zeithorizont', 'select', 'horizont'], ['betrag', 'Betrag in € (optional)', 'number']], grid: 'minmax(0,1fr) 220px 180px', add: '+ Ziel', empty: 'Noch kein Ziel erfasst.', blank: () => ({ text: '', horizont: '', betrag: '' }) },
  'empfehlungen': { cols: [['name', 'Name *'], ['kontakt', 'Kontakt (optional)'], ['bezug', 'Bezug zum Kunden'], ['notiz', 'Notiz'], ['einverstaendnis', 'Einverständnis liegt vor', 'check']], grid: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.3fr) 150px', minw: '860px', add: '+ Empfehlung', empty: 'Noch keine Empfehlung erfasst.', blank: () => ({ name: '', kontakt: '', bezug: '', notiz: '', einverstaendnis: false }) },
  'gesundheit.ambulant.liste': { cols: [['diagnose', 'Diagnose'], ['zeitraum', 'Zeitraum'], ['ausgeheilt', 'ausgeheilt', 'check']], grid: 'minmax(0,1.4fr) minmax(0,1fr) 90px', add: '+ Behandlung', blank: () => ({ diagnose: '', zeitraum: '', ausgeheilt: false }) },
  'gesundheit.stationaer.liste': { cols: [['grund', 'Grund'], ['jahr', 'Jahr', 'number'], ['dauer', 'Dauer']], grid: 'minmax(0,1.4fr) 110px minmax(0,1fr)', add: '+ Aufenthalt', blank: () => ({ grund: '', jahr: '', dauer: '' }) },
  'gesundheit.psyche.liste': { cols: [['anlass', 'Anlass'], ['zeitraum', 'Zeitraum'], ['abgeschlossen', 'abgeschlossen', 'check']], grid: 'minmax(0,1.4fr) minmax(0,1fr) 110px', add: '+ Eintrag', blank: () => ({ anlass: '', zeitraum: '', abgeschlossen: false }) },
  'gesundheit.medikamente.liste': { cols: [['name', 'Medikament'], ['wofuer', 'Wofür']], grid: 'minmax(0,1fr) minmax(0,1fr)', add: '+ Medikament', blank: () => ({ name: '', wofuer: '' }) },
  'gesundheit.aerzte': { cols: [['name', 'Name'], ['fach', 'Fachrichtung'], ['ort', 'Ort']], grid: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)', add: '+ Arzt / Ärztin', empty: 'Keine Ärzte erfasst.', blank: () => ({ name: '', fach: '', ort: '' }) },
};
function cellHTML(path, i, row, [k, label, type = 'text', opt]) {
  const v = row[k] ?? '', a = `data-list="${path}" data-i="${i}" data-k="${k}" aria-label="${esc(label)}"`;
  if (type === 'check') return `<span class="chk"><input type="checkbox" ${a}${v ? ' checked' : ''}></span>`;
  if (type === 'select') return `<select class="inp" ${a}><option value="">Bitte wählen</option>${OPT[opt].map(([val, lab]) => `<option value="${esc(val)}"${String(v) === String(val) ? ' selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
  if (type === 'sparte') {
    if (row.custom) return `<input class="inp" type="text" ${a} value="${esc(v)}" placeholder="Eigene Sparte" autocomplete="off">`;
    return `<select class="inp" ${a}><option value="">Bitte wählen</option>${SPARTEN.map((g) => `<optgroup label="${esc(g.name)}">${g.items.map((n) => `<option${v === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`).join('')}<option value="__custom">Eigene Sparte …</option></select>`;
  }
  const num = type === 'number';
  return `<input class="inp" type="${num ? 'number' : type}" ${a} data-t="${type}"${num ? ' inputmode="decimal" step="any" min="0"' : ''} value="${esc(v)}" autocomplete="off">`;
}
function listHTML(path) {
  const L = LISTS[path], rows = getP(K, path) || [];
  return `<div class="lst" id="l-${path.replace(/[.]/g, '-')}" style="--cols:${L.grid}${L.minw ? `;--minw:${L.minw}` : ''}">
    ${rows.length ? `<div class="lh">${L.cols.map((c) => `<span>${esc(c[1])}</span>`).join('')}<span></span></div>` : (L.empty ? `<div class="lst-empty">${L.empty}</div>` : '')}
    ${rows.map((r, i) => `<div class="lr">${L.cols.map((c) => cellHTML(path, i, r, c)).join('')}<button type="button" class="rm" data-act="rm" data-list="${path}" data-i="${i}" aria-label="Zeile entfernen">−</button></div>`).join('')}
    <button type="button" class="link add" data-act="add" data-list="${path}">${L.add}</button></div>`;
}
const secHead = (n, title, sub, tools = '') => `<div class="sec-head"><span class="n">${n}</span><div><div class="card-title">${title}</div><div class="card-sub">${sub}</div></div>${tools ? `<div class="tools">${tools}</div>` : ''}</div>`;
const sub = (t) => `<div class="sub">${t}</div>`;
const ynList = (p, label, listPath, span = 4) => { const on = getP(K, p) === true; return fld(p, label, 'yn', { span: on ? span : 0 }) + (on && listPath ? `<div class="f s4">${listHTML(listPath)}</div>` : ''); };
const ynText = (p, label, textPath, ph) => { const on = getP(K, p) === true; return fld(p, label, 'yn') + (on ? fld(textPath, 'Details', 'text', { span: 2, ph }) : ''); };

/* ---------- Abfragebogen ---------- */
function renderBogen() {
  const P = K.person, B = K.beruf, G = K.gesundheit;
  const partner = P.familienstand === 'partnerschaft' || P.familienstand === 'verheiratet';
  const s1 = `<section class="panel glass sec" id="s1">${secHead(1, 'Persönliche Daten', 'Wer du bist und wie du wohnst')}
    <div class="fg">
      ${fld('person.anrede', 'Anrede', 'select', { opt: 'anrede' })}${fld('person.vorname', 'Vorname')}${fld('person.nachname', 'Nachname')}
      ${fld('person.geburtsdatum', 'Geburtsdatum', 'date', { note: '<span id="d-alter"></span>' })}
      ${fld('person.adresse.strasse', 'Straße und Hausnummer', 'text', { span: 2 })}${fld('person.adresse.plz', 'PLZ', 'text', { ph: '5 Ziffern' })}${fld('person.adresse.ort', 'Ort')}
      ${fld('person.kontakt.mobil', 'Mobilnummer', 'tel')}${fld('person.kontakt.email', 'E-Mail', 'email')}${fld('person.staatsangehoerigkeit', 'Staatsangehörigkeit')}${fld('person.steuerklasse', 'Steuerklasse', 'select', { opt: 'steuerklasse' })}
      ${fld('person.familienstand', 'Familienstand', 'select', { opt: 'familienstand' })}${partner ? fld('person.partnerName', 'Partner: Name') : ''}
      ${fld('person.wohnen.art', 'Wohnsituation', 'select', { opt: 'wohnen' })}${fld('person.wohnen.flaeche', 'Wohnfläche in m²', 'number')}
    </div>
    ${sub('Kinder')}${listHTML('person.kinder')}
    <div class="fg" style="margin-top:12px">${fld('person.kinderwunsch.status', 'Kinderwunsch', 'select', { opt: 'kinderwunsch' })}${P.kinderwunsch.status === 'ja' ? fld('person.kinderwunsch.horizont', 'Zeithorizont', 'text', { ph: 'z. B. in 2 bis 3 Jahren' }) : ''}</div>
  </section>`;

  const s2 = `<section class="panel glass sec" id="s2">${secHead(2, 'Beruf & Ausbildung', 'Was du gelernt hast und was du heute machst')}
    <div class="fg">
      ${fld('beruf.schulabschluss', 'Höchster Schulabschluss', 'select', { opt: 'schulabschluss' })}${fld('beruf.ausbildung', 'Ausbildung / Studium', 'text', { span: 2 })}${fld('beruf.ausbildungStatus', 'Stand', 'select', { opt: 'ausbildungStatus' })}
      ${fld('beruf.bezeichnung', 'Genaue Berufsbezeichnung', 'text', { span: 2 })}${fld('beruf.status', 'Berufsstatus', 'select', { opt: 'status' })}${B.status === 'beamter' ? fld('beruf.beamtenstatus', 'Beamtenstatus', 'select', { opt: 'beamtenstatus' }) : ''}
      ${B.status === 'beamter' ? '<div class="f s4"><div class="hint"><span><b>DU-Klausel prüfen.</b> Bei Beamten zählt die Dienstunfähigkeitsklausel, nicht nur die BU.</span></div></div>' : ''}
      ${fld('beruf.brutto', 'Brutto pro Monat in €', 'number')}${fld('budget.v.in-salary', 'Netto pro Monat in €', 'number', { note: 'fließt in den Budgetcheck' })}
      ${fld('beruf.personal.ja', 'Personalverantwortung', 'yn')}${B.personal.ja === true ? fld('beruf.personal.anzahl', 'Anzahl Mitarbeiter', 'number', { step: 1 }) : ''}
    </div>
    ${sub('Tätigkeitsanteile')}
    <div class="fg">
      ${fld('beruf.anteile.buero', 'Büro in %', 'number', { max: 100, step: 1 })}${fld('beruf.anteile.koerperlich', 'körperlich in %', 'number', { max: 100, step: 1 })}${fld('beruf.anteile.reisen', 'Reisen in %', 'number', { max: 100, step: 1 })}
      <div class="f"><span class="lab">Summe</span><div class="derived" id="d-sum"></div></div>
    </div>
  </section>`;

  const iaaSwitch = `<button type="button" class="switch" role="switch" aria-checked="${G.aktiv}" data-act="iaa"><span class="tr"></span><span>${G.aktiv ? 'IAA-Teil ist an' : 'IAA-Teil ist aus'}</span></button>`;
  const s3 = `<section class="panel glass sec" id="s3">${secHead(3, 'IAA-Gesundheit', 'Gesundheitsangaben für die Arbeitskraftabsicherung', iaaSwitch)}
    ${!G.aktiv ? '<div class="hint"><span><b>Ausgeschaltet.</b> Schalte diesen Teil erst ein, wenn die Compliance-Freigabe von tecis vorliegt. Bis zum Passwortschutz liegen die Daten unverschlüsselt in der kunde.json.</span></div>' : `
    <div class="hint" style="margin-bottom:14px"><span><b>Gesundheitsdaten.</b> Diese Angaben stehen in keinem Kunden-PDF. Bis zum Passwortschutz liegen die Daten unverschlüsselt in der kunde.json. Einwilligung und Ampel folgen in Phase 4.</span></div>
    <div class="fg">
      ${fld('gesundheit.groesse', 'Größe in cm', 'number', { step: 1 })}${fld('gesundheit.gewicht', 'Gewicht in kg', 'number')}
      <div class="f"><span class="lab">BMI</span><div class="derived" id="d-bmi"></div></div>
      ${fld('gesundheit.raucher', 'Raucher', 'select', { opt: 'raucher' })}
    </div>
    ${sub('Behandlungen')}
    <div class="fg">
      ${ynList('gesundheit.ambulant.ja', 'Ambulante Behandlungen in den letzten 5 Jahren', 'gesundheit.ambulant.liste')}
      ${ynList('gesundheit.stationaer.ja', 'Stationäre Behandlungen in den letzten 10 Jahren', 'gesundheit.stationaer.liste')}
      ${ynList('gesundheit.psyche.ja', 'Psyche / Therapie in den letzten 10 Jahren', 'gesundheit.psyche.liste')}
      ${ynList('gesundheit.medikamente.ja', 'Regelmäßige Medikamente', 'gesundheit.medikamente.liste')}
    </div>
    ${sub('Weitere Angaben')}
    <div class="fg">
      ${ynText('gesundheit.allergien.ja', 'Allergien', 'gesundheit.allergien.text')}
      ${ynText('gesundheit.ruecken.ja', 'Rücken / Gelenke', 'gesundheit.ruecken.text')}
      ${fld('gesundheit.schwerbehinderung.ja', 'Schwerbehinderung', 'yn')}${G.schwerbehinderung.ja === true ? fld('gesundheit.schwerbehinderung.gdb', 'Grad der Behinderung', 'number', { max: 100, step: 10 }) : ''}
      ${ynText('gesundheit.antraege.ja', 'Abgelehnte oder laufende Anträge', 'gesundheit.antraege.text')}
      ${ynText('gesundheit.hobbys.ja', 'Gefährliche Hobbys', 'gesundheit.hobbys.text')}
      ${ynText('gesundheit.ausland.ja', 'Auslandsaufenthalte', 'gesundheit.ausland.text', 'Land, Dauer')}
      ${fld('gesundheit.sehstaerke.links', 'Sehstärke links in dpt', 'number', { min: -30, step: 0.25 })}${fld('gesundheit.sehstaerke.rechts', 'Sehstärke rechts in dpt', 'number', { min: -30, step: 0.25 })}
    </div>
    ${sub('Behandelnde Ärzte')}${listHTML('gesundheit.aerzte')}`}
  </section>`;

  const R = K.rente;
  const s4 = `<section class="panel glass sec" id="s4">${secHead(3, 'Bestand & Finanzen', 'Was du schon hast und wohin du willst')}
    ${sub('Bestehende Verträge')}${listHTML('vertraege')}
    ${sub('Krankenversicherung & Rente')}
    <div class="fg">
      ${fld('kv.art', 'Krankenversicherung', 'select', { opt: 'kv' })}${fld('kv.anbieter', 'Kasse / Gesellschaft')}
      ${fld('rente.vorhanden', 'Renteninfo liegt vor', 'yn')}${R.vorhanden === true ? fld('rente.stand', 'Stand (Jahr)', 'number', { step: 1, min: 1990 }) : ''}
      ${R.vorhanden === true ? fld('rente.erreicht', 'Bisher erreichte Rente in € pro Monat', 'number') + fld('rente.hochgerechnet', 'Hochgerechnete Rente in € pro Monat', 'number') : ''}
    </div>
    <div class="fg" style="margin-top:12px">
      ${fld('bav.ja', 'Betriebliche Altersvorsorge (bAV)', 'yn')}${K.bav.ja === true ? fld('bav.eigen', 'Eigenbeitrag in € pro Monat', 'number') + fld('bav.arbeitgeber', 'Arbeitgeberzuschuss in € pro Monat', 'number') : ''}
    </div>
    <div class="fg" style="margin-top:12px">
      ${fld('vl.arbeitgeberZahlt', 'Arbeitgeber zahlt VL', 'yn')}${K.vl.arbeitgeberZahlt === true ? fld('vl.betrag', 'VL-Betrag in € pro Monat', 'number') + fld('vl.genutzt', 'VL wird genutzt', 'yn') : ''}
    </div>
    ${sub('Bestandsübersicht nach Sparte')}
    <div class="two"><div id="d-bestand"></div><div class="box"><div class="card-title">Themen für den Folgetermin</div><div class="card-sub">Entsteht automatisch aus „fehlt“ und „prüfen“</div><div id="d-themen"></div></div></div>
    ${sub('Einnahmen & Ausgaben')}
    <div id="d-budget"></div>
    ${sub('Ziele, Wünsche, Träume')}${listHTML('ziele')}
  </section>`;

  const keep = document.activeElement && document.activeElement.id, y = scrollY;
  $('bogen').innerHTML = s1 + s2 + s4; // IAA-Gesundheit (s3) ist fest ausgeschaltet
  updateDerived();
  if (keep && $(keep) && $('bogen').contains($(keep))) $(keep).focus({ preventScroll: true });
  scrollTo(0, y);
}
function renderBestand() {
  const el = $('d-bestand'); if (!el) return;
  el.innerHTML = bestandRows().map((r) => `<div class="best"><div class="bl">${esc(r.label)}${r.info ? `<small>${esc(r.info)}</small>` : ''}</div>
    <div style="display:flex;gap:8px;align-items:center">${r.manuell ? `<button type="button" class="link" data-act="best-auto" data-id="${r.id}" title="Zurück zum automatischen Status">automatisch</button>` : ''}
    ${r.fixed ? '<span class="chip ok">vorhanden</span>' : `<div class="seg3" role="group" aria-label="Status ${esc(r.label)}">${['vorhanden', 'fehlt', 'pruefen'].map((s) => `<button type="button" data-act="best" data-id="${r.id}" data-s="${s}" class="${s}${r.status === s ? ' on' : ''}" aria-pressed="${r.status === s}">${ST_LABEL[s]}</button>`).join('')}</div>`}</div></div>`).join('');
  const t = themen();
  $('d-themen').innerHTML = t.length ? `<ul class="themen">${t.map((r) => `<li><span class="chip ${r.status === 'fehlt' ? 'bad' : 'warn'}">${ST_LABEL[r.status]}</span>${esc(r.label)}</li>`).join('')}</ul>` : '<p class="empty">Aktuell ist nichts offen.</p>';
}
function updateDerived() {
  const a = alter(); if ($('d-alter')) $('d-alter').textContent = a == null ? '' : `${a} Jahre alt`;
  const s = anteilSumme(), ds = $('d-sum');
  if (ds) { ds.textContent = s == null ? '–' : (Math.round(s) === 100 ? '100 % ✓' : `${Math.round(s)} %, muss 100 % ergeben`); ds.style.color = s == null ? '' : (Math.round(s) === 100 ? 'var(--ok)' : 'var(--bad)'); }
  const b = bmi(); if ($('d-bmi')) $('d-bmi').textContent = b == null ? '–' : de1(b);
  renderBestand();
  const bd = $('d-budget');
  if (bd) { const c = calcBudget(); bd.innerHTML = `<div class="card-sub">Du erfasst alle Posten im Tab Budgetcheck. Das Netto von oben ist dort schon eingetragen.</div>
    <div class="bsum"><div><div class="l">Einnahmen</div><div class="v num">${eur(c.incomeTotal)}</div></div><div><div class="l">Ausgaben inkl. Sparen</div><div class="v num">${eur(c.total)}</div></div><div><div class="l">Übrig am Monatsende</div><div class="v num ${c.rest < 0 ? 'negd' : 'posd'}">${signed(c.rest)}</div></div></div>
    <button type="button" class="btn navy" style="margin-top:12px" data-act="tab" data-tab="budget">Zum Budgetcheck</button>`; }
  const nm = `${K.person.vorname} ${K.person.nachname}`.trim(); $('top-name').textContent = nm || 'Neuer Kunde';
  if (showMiss) document.querySelectorAll('#bogen .f[data-f]').forEach((f) => { const p = f.dataset.f; f.classList.toggle('miss', isReq(p) && isEmpty(p === 'budget.v.in-salary' ? nettoMonat() : getP(K, p))); });
}

/* ---------- Tabs, Start, Status ---------- */
function showTab(t) {
  mainTab = t;
  document.querySelectorAll('.mtab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  ['bogen', 'budget', 'vn'].forEach((p) => { $('pane-' + p).hidden = p !== t; });
  if (t === 'budget') { applyState(); show(current); }
  if (t === 'bogen') renderBogen();
  document.body.classList.toggle('tab-vn', t === 'vn');
  scrollTo(0, 0);
  if (t === 'vn') { vnPush(false, true); vnSize(); }
}
function markDirty() { dirtyFlag = true; const s = $('save-state'); s.textContent = 'Nicht gespeichert'; s.classList.add('dirty'); }
function markClean(txt) { dirtyFlag = false; const s = $('save-state'); s.textContent = txt; s.classList.remove('dirty'); }
function openApp() {
  $('start').hidden = true; $('app').hidden = false; $('top-actions').hidden = false; showMiss = false;
  applyState(); vnPush(true); showTab('bogen');
}
function goHome() {
  if (dirtyFlag && !confirm('Es gibt ungespeicherte Änderungen. Trotzdem zur Startseite?')) return;
  $('app').hidden = true; $('top-actions').hidden = true; $('start').hidden = false; dirtyFlag = false; renderStart(); scrollTo(0, 0);
}
function newClient() { K = newKunde(); S = K.budget; openApp(); markClean('Noch nicht gespeichert'); }
addEventListener('beforeunload', (e) => { if (dirtyFlag) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- Kundenordner (File System Access API, Zugriff in IndexedDB gemerkt) ---------- */
let dirHandle = null, dirState = 'none'; // none | prompt | ok
const idb = {
  open() { return new Promise((res, rej) => { const r = indexedDB.open('beratungstool', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async get(k) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
};
async function initDir() {
  try { const h = await idb.get('kundenDir'); if (h) { dirHandle = h; dirState = (await h.queryPermission({ mode: 'readwrite' })) === 'granted' ? 'ok' : 'prompt'; } } catch (e) {}
  renderStart();
}
async function pickDir() {
  if (!window.showDirectoryPicker) { toast('Dieser Browser kann keinen Ordner verbinden. Speichern läuft dann als Download.'); return false; }
  try { const h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'kunden' }); dirHandle = h; dirState = 'ok'; try { await idb.set('kundenDir', h); } catch (e) {} renderStart(); return true; }
  catch (e) { return false; }
}
async function ensureDir() {
  if (!dirHandle) return false;
  if (dirState === 'ok') return true;
  try { dirState = (await dirHandle.requestPermission({ mode: 'readwrite' })) === 'granted' ? 'ok' : 'prompt'; } catch (e) {}
  return dirState === 'ok';
}
async function fileExists(dir, name) { try { await dir.getFileHandle(name); return true; } catch (e) { return false; } }
async function writeFile(dir, name, data) { const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(data); await w.close(); }
async function freeName(dir, base, ext) { let n = base + ext, i = 1; while (await fileExists(dir, n)) { i++; n = `${base}_v${i}${ext}`; } return n; }
const safeName = (s) => String(s).trim().replace(/[\/\\:*?"<>|.]+/g, '').replace(/\s+/g, '-');
const folderName = () => `${safeName(K.person.nachname)}_${safeName(K.person.vorname)}`;
async function listClients() {
  const out = [];
  for await (const [name, h] of dirHandle.entries()) { if (h.kind !== 'directory') continue; try { await h.getFileHandle('kunde.json'); out.push(name); } catch (e) {} }
  return out.sort((a, b) => a.localeCompare(b, 'de'));
}
function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }

async function renderStart() {
  const dirTxt = dirState === 'ok' ? `<span class="dot-s ok"></span>Verbunden: ${esc(dirHandle.name)}` : dirState === 'prompt' ? `<span class="dot-s warn"></span>${esc(dirHandle.name)}: Zugriff bestätigen` : '<span class="dot-s"></span>Noch kein Ordner verbunden';
  const dirBtn = dirState === 'prompt' ? '<button type="button" class="btn navy" data-act="dir-confirm">Zugriff bestätigen</button>' : `<button type="button" class="btn line" data-act="dir-pick">${dirState === 'ok' ? 'Anderen Ordner wählen' : 'Ordner „Kunden“ wählen'}</button>`;
  $('start').innerHTML = `<div class="start">
    <div><h2>Beratungstool</h2><p class="lead">Abfragebogen, Budgetcheck und Vorher-Nachher an einem Ort. Alles bleibt auf diesem Mac.</p></div>
    <div class="start-btns">
      <button type="button" class="bigbtn gold" data-act="new"><b>Neuer Kunde</b><span>Leeren Abfragebogen starten</span></button>
      <button type="button" class="bigbtn glass" data-act="load"><b>Kunde laden</b><span>kunde.json aus dem Kundenordner öffnen</span></button>
    </div>
    <div class="dirbox glass"><div class="st"><b>Kundenordner</b>${dirTxt}</div>${dirBtn}</div>
    <div id="clients"></div>
    <input type="file" id="json-in" accept=".json,application/json" hidden>
  </div>`;
  if (dirState === 'ok') {
    let list = []; try { list = await listClients(); } catch (e) {}
    const c = $('clients'); if (!c) return;
    c.innerHTML = `<div class="clients glass"><h3>Kunden im Ordner</h3>${list.length ? list.map((n) => `<button type="button" class="client" data-act="open-client" data-name="${esc(n)}">${esc(n.replace(/_/g, ', ').replace(/-/g, ' '))}<small>öffnen</small></button>`).join('') : '<p class="empty">In diesem Ordner liegt noch kein Kunde.</p>'}<button type="button" class="link" style="margin:4px 8px 8px" data-act="load-file">Einzelne kunde.json öffnen</button></div>`;
  }
}
function loadJson(txt) {
  let o; try { o = JSON.parse(txt); } catch (e) { toast('Die Datei ist kein gültiges JSON.'); return false; }
  if (!o || o.app !== 'beratungstool') { toast('Das ist keine kunde.json aus dem Beratungstool.'); return false; }
  if (o.verschluesselt) { toast('Diese Datei ist verschlüsselt. Das Entsperren kommt mit dem Passwortschutz.'); return false; }
  if (o.schemaVersion > SCHEMA) { toast('Die Datei stammt aus einer neueren Version des Tools.'); return false; }
  K = merge(newKunde(), o); K.schemaVersion = SCHEMA; K.gesundheit.aktiv = false; K.budget = Object.assign(emptyState(), K.budget); S = K.budget;
  openApp(); markClean('Geladen'); return true;
}
async function openClient(name) {
  try { const dir = await dirHandle.getDirectoryHandle(name); const txt = await (await (await dir.getFileHandle('kunde.json')).getFile()).text(); if (loadJson(txt)) toast(`${name.replace(/_/g, ', ')} geladen`); }
  catch (e) { toast('Der Kunde konnte nicht geladen werden.'); }
}

/* ---------- Speichern ---------- */
function trySave() {
  if (!K.person.vorname.trim() || !K.person.nachname.trim()) {
    showMiss = true; showTab('bogen'); toast('Zum Speichern brauche ich Vor- und Nachname. Daraus entsteht der Ordnername.');
    const f = $(fid(!K.person.vorname.trim() ? 'person.vorname' : 'person.nachname')); if (f) f.focus(); return;
  }
  const m = missing();
  if (!m.length) { saveAll(); return; }
  showMiss = true; if (mainTab === 'bogen') updateDerived();
  $('dlg-list').innerHTML = m.map((x, i) => `<li><button type="button" data-act="miss-jump" data-i="${i}">${esc(x.label)}<small>${SEC_NAME[x.sec]}</small></button></li>`).join('');
  $('dlg-count').textContent = m.length === 1 ? 'Ein Pflichtfeld ist noch offen.' : `${m.length} Pflichtfelder sind noch offen.`;
  $('dlg')._miss = m; $('dlg').showModal();
}
function jumpTo(x) {
  $('dlg').close();
  showTab('bogen');
  const el = x.p ? $(fid(x.p)) : $(x.el);
  const target = el || $(x.sec);
  if (target) { target.scrollIntoView({ block: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' }); if (el && el.focus) el.focus({ preventScroll: true }); }
}
async function saveAll() {
  if (!window.jspdf) { toast('Das PDF-Modul fehlt. Speichern abgebrochen.'); return false; }
  const d = today(), n = new Date();
  syncName(); syncContracts();
  try {
    if (mainTab !== 'vn') vnPush();
    const pdfs = [['Abfragebogen', buildBogenPdf()], ['Budgetcheck', buildPdf().blob]];
    if (vnReady && vnHasNachher()) pdfs.push(['Vorher-Nachher', buildVnPdf()]);
    const useDir = await ensureDir();
    if (useDir) {
      const dir = await dirHandle.getDirectoryHandle(folderName(), { create: true });
      const names = []; for (const [b] of pdfs) names.push(await freeName(dir, `${b}_${d}`, '.pdf'));
      if (await fileExists(dir, 'kunde.json')) { // alte Fassung sichern, nie überschreiben
        const old = await (await (await dir.getFileHandle('kunde.json')).getFile()).text();
        const ar = await dir.getDirectoryHandle('archiv', { create: true });
        await writeFile(ar, await freeName(ar, `kunde_${d}_${pad2(n.getHours())}${pad2(n.getMinutes())}`, '.json'), old);
      }
      K.geaendert = n.toISOString(); K.termine.push({ datum: d, art: '', dateien: names });
      await writeFile(dir, 'kunde.json', JSON.stringify(K, null, 1));
      for (let i = 0; i < pdfs.length; i++) await writeFile(dir, names[i], pdfs[i][1]);
      markClean(`Gespeichert ${pad2(n.getHours())}:${pad2(n.getMinutes())}`); toast(`Gespeichert im Ordner „${folderName()}“`);
    } else {
      const names = pdfs.map(([b]) => `${b}_${d}.pdf`);
      K.geaendert = n.toISOString(); K.termine.push({ datum: d, art: '', dateien: names });
      download(`${folderName()}_kunde.json`, new Blob([JSON.stringify(K, null, 1)], { type: 'application/json' }));
      pdfs.forEach(([, blob], i) => download(names[i], blob));
      markClean(`Als Download gespeichert ${pad2(n.getHours())}:${pad2(n.getMinutes())}`); toast('Kein Kundenordner verbunden. Die Dateien liegen in deinen Downloads.');
    }
    return true;
  } catch (e) { console.error(e); toast('Speichern hat nicht geklappt: ' + (e && e.message ? e.message : 'unbekannter Fehler')); return false; }
}

/* ---------- PDF Abfragebogen (gleicher Aufbau wie das Budgetcheck-PDF) ---------- */
function buildBogenPdf() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const NAVY = [10, 31, 68], GOLD = [201, 162, 74], GOLDI = [138, 103, 25], INK = [11, 27, 54], INK2 = [51, 65, 92], INK3 = [98, 112, 138], LINE = [226, 231, 240], OK = [30, 138, 99], WARN = [180, 101, 26], BAD = [178, 58, 58];
  const T = (txt, x, y, o) => doc.text(pdfText(txt), x, y, o);
  const P = K.person, B = K.beruf, name = `${P.vorname} ${P.nachname}`.trim();
  const dateStr = deDate(today());
  function header(title) {
    doc.setFillColor(...NAVY); doc.rect(0, 0, W, 78, 'F');
    doc.setFillColor(...GOLD); doc.rect(0, 78, W, 2.5, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); T(title, 40, 36);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(230, 199, 126);
    T(name ? `Kunde: ${name}` : 'Kunde: ohne Namen', 40, 54); T(`Erstellt am ${dateStr}`, 40, 66);
    doc.setTextColor(210, 218, 232);
    T(`Berater: ${ADVISOR.name} · tecis`, W - 40, 42, { align: 'right' }); T(advContact(), W - 40, 56, { align: 'right' });
  }
  let y;
  function ensure(h) { if (y + h > H - 50) { doc.addPage(); header('Abfragebogen (Fortsetzung)'); y = 108; } }
  function section(title, color) {
    if (y > 130) y += 8;
    ensure(40);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...color); T(title.toUpperCase(), 40, y);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.7); doc.line(40 + doc.getTextWidth(pdfText(title.toUpperCase())) + 8, y - 3, W - 40, y - 3);
    y += 16;
  }
  function line(label, value, opts = {}) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
    const empty = isEmpty(value), vals = empty ? ['-'] : doc.splitTextToSize(pdfText(String(value)), opts.mid || opts.tag ? 150 : 330);
    ensure(4 + vals.length * 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...INK2); T(label, 48, y);
    if (opts.mid) T(opts.mid, 250, y);
    if (opts.tag) { doc.setFontSize(8); doc.setTextColor(...INK3); T(opts.tag, 385, y); }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...(empty ? INK3 : (opts.color || INK)));
    vals.forEach((v, i) => doc.text(v, W - 40, y + i * 12, { align: 'right' }));
    y += (vals.length - 1) * 12;
    doc.setDrawColor(...LINE); doc.line(40, y + 5, W - 40, y + 5);
    y += 16;
  }
  function sumLine(label, value, color) { ensure(20); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...color); T(label, 40, y + 2); T(value, W - 40, y + 2, { align: 'right' }); y += 22; }
  function para(txt, color = INK2, size = 9.5) { doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...color); doc.splitTextToSize(pdfText(txt), W - 96).forEach((l) => { ensure(14); doc.text(l, 48, y); y += 13; }); }
  const yn = (v) => (v === true ? 'ja' : v === false ? 'nein' : '');
  const money = (v) => (isEmpty(v) ? '' : eur(parseFloat(v)));

  header('Abfragebogen'); y = 112;
  section('Persönliche Daten', NAVY);
  const a = alter();
  line('Name', [optLabel('anrede', P.anrede) === 'keine Angabe' ? '' : optLabel('anrede', P.anrede), name].filter(Boolean).join(' '));
  line('Geburtsdatum', P.geburtsdatum ? `${deDate(P.geburtsdatum)}${a != null ? ` (${a} Jahre)` : ''}` : '');
  line('Staatsangehörigkeit', P.staatsangehoerigkeit);
  line('Adresse', [P.adresse.strasse, [P.adresse.plz, P.adresse.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '));
  line('Mobilnummer', P.kontakt.mobil); line('E-Mail', P.kontakt.email);
  line('Familienstand', optLabel('familienstand', P.familienstand));
  if (P.partnerName && (P.familienstand === 'partnerschaft' || P.familienstand === 'verheiratet')) line('Partner', P.partnerName);
  line('Kinder', P.kinder.length ? P.kinder.map((k) => `${k.vorname || 'Kind'}${k.geburtsjahr ? ` (${k.geburtsjahr})` : ''}`).join(', ') : 'keine');
  if (P.kinderwunsch.status) line('Kinderwunsch', [optLabel('kinderwunsch', P.kinderwunsch.status), P.kinderwunsch.status === 'ja' ? P.kinderwunsch.horizont : ''].filter(Boolean).join(', '));
  line('Wohnsituation', [optLabel('wohnen', P.wohnen.art), P.wohnen.flaeche ? `${P.wohnen.flaeche} m²` : ''].filter(Boolean).join(', '));
  line('Steuerklasse', P.steuerklasse);

  section('Beruf & Ausbildung', NAVY);
  line('Schulabschluss', optLabel('schulabschluss', B.schulabschluss));
  line('Ausbildung / Studium', [B.ausbildung, optLabel('ausbildungStatus', B.ausbildungStatus)].filter(Boolean).join(', '));
  line('Berufsbezeichnung', B.bezeichnung);
  line('Berufsstatus', [optLabel('status', B.status), B.status === 'beamter' ? optLabel('beamtenstatus', B.beamtenstatus) : ''].filter(Boolean).join(' '));
  if (anteilSumme() != null) line('Tätigkeit', `Büro ${B.anteile.buero || 0} % · körperlich ${B.anteile.koerperlich || 0} % · Reisen ${B.anteile.reisen || 0} %`);
  if (B.personal.ja != null) line('Personalverantwortung', B.personal.ja ? `ja${B.personal.anzahl ? `, ${B.personal.anzahl} Mitarbeiter` : ''}` : 'nein');
  line('Brutto pro Monat', money(B.brutto)); line('Netto pro Monat', money(nettoMonat()));

  section('Krankenversicherung & Rente', NAVY);
  line('Krankenversicherung', [optLabel('kv', K.kv.art), K.kv.anbieter].filter(Boolean).join(' · '));
  if (K.rente.vorhanden != null) line('Renteninfo', K.rente.vorhanden ? [`liegt vor${K.rente.stand ? ` (Stand ${K.rente.stand})` : ''}`, K.rente.erreicht !== '' ? `erreicht ${money(K.rente.erreicht)}` : '', K.rente.hochgerechnet !== '' ? `hochgerechnet ${money(K.rente.hochgerechnet)}` : ''].filter(Boolean).join(' · ') : 'liegt nicht vor');
  if (K.bav.ja != null) line('Betriebliche Altersvorsorge', K.bav.ja ? [`ja`, K.bav.eigen !== '' ? `Eigenbeitrag ${money(K.bav.eigen)}` : '', K.bav.arbeitgeber !== '' ? `Arbeitgeber ${money(K.bav.arbeitgeber)}` : ''].filter(Boolean).join(' · ') : 'nein');
  if (K.vl.arbeitgeberZahlt != null) line('Vermögenswirksame Leistungen', K.vl.arbeitgeberZahlt ? [`Arbeitgeber zahlt${K.vl.betrag !== '' ? ` ${money(K.vl.betrag)}` : ''}`, K.vl.genutzt != null ? (K.vl.genutzt ? 'wird genutzt' : 'wird nicht genutzt') : ''].filter(Boolean).join(' · ') : 'Arbeitgeber zahlt nicht');

  const vt = K.vertraege.filter((c) => c.sparte);
  const vsum = vt.reduce((s, c) => s + contractMonthly(c), 0);
  section(`Bestehende Verträge  (${eur(vsum)} / Monat)`, GOLDI);
  if (vt.length) {
    ensure(16); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...INK3);
    T('SPARTE', 48, y); T('GESELLSCHAFT', 250, y); T('LAUFZEIT', 385, y); T('BEITRAG / MONAT', W - 40, y, { align: 'right' }); y += 12;
    vt.forEach((c) => {
      const lz = [c.beginn ? `ab ${deDate(c.beginn)}` : '', c.ablauf ? `bis ${deDate(c.ablauf)}` : ''].filter(Boolean).join(' ');
      line(c.sparte, eur(contractMonthly(c)), { mid: (c.gesellschaft || '-').slice(0, 26), tag: lz || (c.zahlweise !== 'm' ? optLabel('zahlweise', c.zahlweise) : ' ') });
      if ((c.leistung || '').trim()) { y -= 6; para(`Leistung: ${c.leistung.trim()}`, INK3, 8); y += 3; }
    });
  } else para('Keine Verträge erfasst.', INK3);

  section('Bestandsübersicht nach Sparte', NAVY);
  const col = { vorhanden: OK, fehlt: BAD, pruefen: WARN };
  bestandRows().forEach((r) => line(r.label, ST_LABEL[r.status], { color: col[r.status], tag: (r.info || '').slice(0, 30) || undefined }));

  const th = themen();
  section('Themen für den Folgetermin', GOLDI);
  if (th.length) th.forEach((r, i) => para(`${i + 1}.  ${r.label}  (${ST_LABEL[r.status]})`)); else para('Aktuell ist nichts offen.', INK3);
  y += 4;

  const c = calcBudget();
  section('Einnahmen & Ausgaben', NAVY);
  line('Einnahmen pro Monat', eur(c.incomeTotal)); line('Ausgaben inkl. Sparen', eur(c.total));
  line('Übrig am Monatsende', signed(c.rest), { color: c.rest < 0 ? BAD : OK });
  para('Alle Einzelposten stehen im Budgetcheck-PDF.', INK3, 8); y += 4;

  section('Ziele, Wünsche, Träume', GOLDI);
  const zl = K.ziele.filter((z) => (z.text || '').trim());
  if (zl.length) zl.forEach((z) => {
    para(`•  ${z.text.trim()}`, INK);
    const meta = [z.horizont ? `Zeithorizont: ${optLabel('horizont', z.horizont)}` : '', !isEmpty(z.betrag) ? `Betrag: ${money(z.betrag)}` : ''].filter(Boolean).join(' · ');
    if (meta) { y -= 2; para(`    ${meta}`, INK3, 8); } y += 3;
  }); else para('Noch keine Ziele erfasst.', INK3);

  const pages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...INK3);
    T(`tecis · ${ADVISOR.name} · ${advContact()}`, 40, H - 24); T(`Seite ${p} / ${pages}`, W - 40, H - 24, { align: 'right' });
  }
  doc.setProperties({ title: 'Abfragebogen' + (name ? ' ' + pdfText(name) : '') });
  return doc.output('blob');
}


/* ---------- Vorher-Nachher: bestehendes Tool im eigenen Rahmen, Daten kommen aus kunde.json ---------- */
let vnWin = null, vnReady = false, vnPushing = false;
const THEMA_SPARTE = { haftpflicht: 'Privathaftpflicht', hausrat: 'Hausrat', arbeitskraft: () => (K.beruf.status === 'beamter' ? 'Dienstunfähigkeit' : 'Berufsunfähigkeit'),
  risikoleben: 'Risikoleben', wohngebaeude: 'Wohngebäude', altersvorsorge: 'Altersvorsorgedepot', investment: 'Fondssparen' };
const de2 = (n) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function vnInit() {
  const f = $('vn-frame');
  f.addEventListener('load', () => { vnWin = f.contentWindow; if (!vnWin || !vnWin.__vn) return; vnWin.__vnChanged = vnChanged; vnReady = true; vnPush(true); });
  f.srcdoc = VN_SRC;
}
function vnChanged() { if (vnPushing || !vnReady) return; K.vorherNachher = JSON.parse(JSON.stringify(vnWin.__vn.get())); markDirty(); }
function vnSize() { const f = $('vn-frame'); f.style.height = Math.max(420, innerHeight - f.getBoundingClientRect().top - 8) + 'px'; }
addEventListener('resize', () => { if (mainTab === 'vn') vnSize(); });
function vnPresent() {
  if (!vnReady) return; vnWin.__vn.togglePresent();
  const on = vnWin.__vn.presenting(), b = $('vn-present'); b.textContent = on ? 'Bearbeiten' : 'Präsentieren'; b.setAttribute('aria-pressed', String(on));
}
/* Verträge in die Vorher-Spalte, fehlende Themen einmalig als „neu“ vorauswählen */
function vnPush(reset, mitThemen) {
  if (!vnReady) return;
  const V = vnWin.__vn; vnPushing = true;
  try {
    if (reset && V.presenting()) vnPresent();
    V.set(K.vorherNachher);
    const T = V.get(); if (reset) T.view = K.vorherNachher ? T.view : 'pick';
    T.name = `${K.person.vorname} ${K.person.nachname}`.trim(); T.date = today();
    K.vnAuto = Array.isArray(K.vnAuto) ? K.vnAuto : [];
    const by = new Map();
    K.vertraege.forEach((c) => { const n = (c.sparte || '').trim(); if (!n) return; if (!by.has(n)) by.set(n, []); by.get(n).push(c); });
    T.items.forEach((i) => { if (i.src === 'vertrag' && !by.has(i.name)) { i.p[0] = ''; i.z[0] = 'm'; i.t[0] = ''; delete i.src; if (i.st === 'hat') i.st = ''; } });
    const locked = new Set();
    by.forEach((list, name) => {
      let it = T.items.find((i) => i.name === name);
      if (!it) { it = { id: Math.random().toString(36).slice(2, 9), g: list[0].gruppe || 'sonst', name, on: false, custom: true, st: '', c: false, p: ['', '', ''], z: ['m', 'm', 'm'], t: ['', '', ''], r: '' }; T.items.push(it); }
      const one = list.length === 1, has = list.some((c) => !isEmpty(c.beitrag));
      it.p[0] = !has ? '' : de2(one ? parseFloat(list[0].beitrag) || 0 : list.reduce((s, c) => s + contractMonthly(c), 0));
      it.z[0] = one ? (list[0].zahlweise || 'm') : 'm';
      it.t[0] = list.map((c) => [c.gesellschaft, c.leistung].map((x) => (x || '').trim()).filter(Boolean).join(' · ')).filter(Boolean).join('\n');
      if (it.st !== 'hat' && it.r === 'Neu') it.r = '';
      it.src = 'vertrag'; it.st = 'hat';
      if (!K.vnAuto.includes(name)) { it.on = true; K.vnAuto.push(name); }
      locked.add(it.id);
    });
    if (mitThemen) themen().filter((r) => r.status === 'fehlt').forEach((r) => {
      const key = 'thema:' + r.id; if (K.vnAuto.includes(key)) return;
      const nm = typeof THEMA_SPARTE[r.id] === 'function' ? THEMA_SPARTE[r.id]() : THEMA_SPARTE[r.id]; if (!nm) return;
      const it = T.items.find((i) => i.name === nm);
      if (it && !it.on) { it.on = true; if (!it.st) { it.st = 'neu'; if (!it.r) it.r = 'Neu'; } }
      K.vnAuto.push(key);
    });
    vnWin.__vnLocked = locked;
    K.vorherNachher = JSON.parse(JSON.stringify(T));
    V.refresh();
  } finally { vnPushing = false; }
}
function vnHasNachher() {
  const v = K.vorherNachher; if (!v || !Array.isArray(v.items)) return false;
  return v.items.some((i) => i.on && (i.p[1] !== '' || (i.t[1] || '').trim() || (v.v2 && (i.p[2] !== '' || (i.t[2] || '').trim())))) || (v.vort || []).some((x) => (x || '').trim());
}

/* ---------- PDF Vorher-Nachher (Querformat, gleicher Aufbau wie die anderen PDFs) ---------- */
function buildVnPdf() {
  const V = vnWin.__vn, T = V.get(), { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const NAVY = [10, 31, 68], GOLD = [201, 162, 74], GOLDI = [138, 103, 25], INK = [11, 27, 54], INK2 = [51, 65, 92], INK3 = [98, 112, 138], LINE = [226, 231, 240], OK = [30, 138, 99], WARN = [180, 101, 26], BAD = [178, 58, 58], INFO = [47, 94, 158];
  const Tx = (txt, x, y, o) => doc.text(pdfText(txt), x, y, o);
  const name = `${K.person.vorname} ${K.person.nachname}`.trim(), dateStr = deDate(today());
  const veur = V.eur, sgn = V.sgn, pm = V.pm, mon = V.mon;
  function header(title) {
    doc.setFillColor(...NAVY); doc.rect(0, 0, W, 70, 'F'); doc.setFillColor(...GOLD); doc.rect(0, 70, W, 2.5, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); Tx(title, 40, 34);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(230, 199, 126);
    Tx(`${name ? `Kunde: ${name}` : 'Kunde: ohne Namen'}  ·  Erstellt am ${dateStr}  ·  alle Beiträge pro Monat`, 40, 54);
    doc.setTextColor(210, 218, 232); Tx(`Berater: ${ADVISOR.name} · tecis`, W - 40, 34, { align: 'right' }); Tx(advContact(), W - 40, 48, { align: 'right' });
  }
  const v2 = !!T.v2 && V.sel().some((i) => i.p[2] !== '' || (i.t[2] || '').trim()), ks = v2 ? [0, 1, 2] : [0, 1]; // Variante 2 nur, wenn sie ausgefüllt ist
  const { t } = V.totals(), d1 = t[1] - t[0], d2 = t[2] - t[0], kv = v2 ? T.variant : 1, dk = kv === 2 ? d2 : d1, sp = V.split(kv), vt = v2 ? ' · Variante ' + kv : '';
  header('Vorher-Nachher'); let y = 90;
  const tiles = [['Vorher', veur(t[0]), `pro Jahr ${veur(t[0] * 12, 0)}`, INK3], ['Nachher · Variante 1', veur(t[1]), `${sgn(d1)} pro Monat`, GOLD]];
  if (v2) tiles.push(['Nachher · Variante 2', veur(t[2]), `${sgn(d2)} pro Monat`, NAVY]);
  tiles.push(sp.save < -0.004
    ? ['Ersparnis bestehende Verträge' + vt, veur(-sp.save) + ' / Monat', sp.neu > 0.004 ? `neu ${pm(sp.neu)} · unterm Strich ${pm(sp.net)}` : veur(-sp.save * 12, 0) + ' im Jahr', null]
    : [(dk <= 0 ? 'Ersparnis' : 'Neue Absicherung') + vt, veur(Math.abs(dk)) + ' / Monat', veur(Math.abs(dk) * 12, 0) + ' im Jahr', null]);
  const tw = (W - 80 - (tiles.length - 1) * 12) / tiles.length;
  tiles.forEach(([l, val, s, c], i) => {
    const x = 40 + i * (tw + 12), dark = c === null;
    if (dark) { doc.setFillColor(...NAVY); doc.roundedRect(x, y, tw, 58, 5, 5, 'F'); doc.setFillColor(...GOLD); doc.rect(x, y, 3, 58, 'F'); }
    else { doc.setFillColor(255, 255, 255); doc.setDrawColor(...LINE); doc.roundedRect(x, y, tw, 58, 5, 5, 'FD'); doc.setFillColor(...c); doc.rect(x, y, 3, 58, 'F'); }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); doc.setTextColor(...(dark ? [230, 199, 126] : INK3));
    const ll = doc.splitTextToSize(pdfText(l.toUpperCase()), tw - 20).slice(0, 2), two = ll.length > 1;
    ll.forEach((ln, li) => doc.text(ln, x + 11, y + (two ? 12 : 14) + li * 8));
    doc.setFontSize(14); doc.setTextColor(...(dark ? [255, 255, 255] : INK)); Tx(val, x + 11, y + (two ? 38 : 34));
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...(dark ? [210, 218, 232] : INK3)); Tx(s, x + 11, y + (two ? 50 : 48));
  });
  y += 74;

  // Tabelle
  const cols = v2 ? [['Sparte', 112], ['Vorher', 62], ['Gesellschaft / Leistung', 130], ['Variante 1', 62], ['Gesellschaft / Leistung', 130], ['Variante 2', 62], ['Gesellschaft / Leistung', 130], ['Bewertung', 74]]
    : [['Sparte', 150], ['Vorher', 72], ['Gesellschaft / Leistung', 199], ['Variante 1', 72], ['Gesellschaft / Leistung', 199], ['Bewertung', 70]];
  const xs = []; cols.reduce((x, c) => { xs.push(x); return x + c[1]; }, 40);
  const TW = cols.reduce((s, c) => s + c[1], 0), LH = 9.5;
  const isV1 = (ci) => ci === 3 || ci === 4;
  function thead() {
    doc.setFillColor(...NAVY); doc.rect(40, y, TW, 17, 'F');
    doc.setFillColor(...GOLD); doc.rect(xs[3], y, cols[3][1] + cols[4][1], 17, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    cols.forEach((c, ci) => { doc.setTextColor(...(isV1(ci) ? NAVY : [255, 255, 255])); const amt = ci % 2 === 1 && ci < cols.length - 1; Tx(c[0], amt ? xs[ci] + c[1] - 6 : xs[ci] + 6, y + 11.5, amt ? { align: 'right' } : undefined); });
    y += 17;
  }
  function ensure(h) { if (y + h > H - 44) { doc.addPage(); header('Vorher-Nachher (Fortsetzung)'); y = 90; thead(); } }
  thead();
  const rcol = { 'Besser': OK, 'Gleich': INFO, 'Neu': GOLDI, 'Gekündigt': BAD, 'Prüfen': WARN };
  const selItems = V.sel();
  V.GROUPS.forEach((g) => {
    const its = selItems.filter((i) => i.g === g.id); if (!its.length) return;
    ensure(15 + 24);
    doc.setFillColor(238, 242, 248); doc.rect(40, y, TW, 15, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...NAVY); Tx(g.name.toUpperCase(), 46, y + 10.5); y += 15;
    its.forEach((i) => {
      doc.setFontSize(8);
      const cells = [doc.splitTextToSize(pdfText(i.name), cols[0][1] - 10)];
      ks.forEach((k) => {
        const a = i.p[k] === '' ? ['–'] : [i.z[k] === 'e' ? '–' : veur(mon(i, k))];
        if (i.p[k] !== '' && i.z[k] !== 'm') a.push(`${veur(V.num(i.p[k]))} ${V.ZW[i.z[k]].s}`);
        cells.push(a); cells.push(doc.splitTextToSize(pdfText(i.t[k] || ''), cols[2 + k * 2][1] - 10));
      });
      cells.push([i.r || '']);
      const h = Math.max(...cells.map((c) => c.length)) * LH + 7;
      ensure(h);
      doc.setFillColor(251, 246, 233); doc.rect(xs[3], y, cols[3][1] + cols[4][1], h, 'F');
      cells.forEach((lines, ci) => {
        const last = ci === cells.length - 1, amt = ci % 2 === 1 && !last;
        lines.forEach((ln, li) => {
          if (ci === 0) { doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...INK); }
          else if (amt) { doc.setFont('helvetica', li ? 'normal' : 'bold'); doc.setFontSize(li ? 6.5 : 8); doc.setTextColor(...(li ? INK3 : INK)); }
          else if (last) { doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...(rcol[ln] || INK3)); }
          else { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...INK2); }
          if (amt) Tx(ln, xs[ci] + cols[ci][1] - 6, y + 10 + li * LH, { align: 'right' }); else doc.text(pdfText(ln), xs[ci] + 6, y + 10 + li * LH);
        });
      });
      y += h; doc.setDrawColor(...LINE); doc.setLineWidth(0.6); doc.line(40, y, 40 + TW, y);
    });
  });
  ensure(20);
  doc.setFillColor(...NAVY); doc.rect(40, y, TW, 18, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255);
  Tx('Aufwand pro Monat', 46, y + 12); ks.forEach((k) => Tx(veur(t[k]), xs[1 + k * 2] + cols[1 + k * 2][1] - 6, y + 12, { align: 'right' }));
  y += 34;

  const vort = (T.vort || []).map((x) => (x || '').trim()).filter(Boolean);
  if (vort.length) {
    ensure(30 + 14);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...GOLDI); Tx('DEINE VORTEILE', 40, y);
    doc.setDrawColor(...LINE); doc.line(40 + doc.getTextWidth('DEINE VORTEILE') + 8, y - 3, W - 40, y - 3); y += 16;
    vort.forEach((x) => { doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...INK);
      doc.splitTextToSize(pdfText(x), W - 110).forEach((ln, li) => { ensure(14); if (!li) { doc.setTextColor(...OK); doc.setFont('helvetica', 'bold'); doc.text('•', 46, y); doc.setTextColor(...INK); doc.setFont('helvetica', 'normal'); } doc.text(ln, 58, y); y += 13; }); y += 2; });
    y += 6;
  }
  ensure(14); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...INK3);
  Tx('Alle Angaben ohne Gewähr. Maßgeblich sind die jeweiligen Versicherungsbedingungen. Werte mit „Schätzung“ beruhen auf Annahmen.', 40, y);
  const pages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...INK3);
    Tx(`tecis · ${ADVISOR.name} · ${advContact()}`, 40, H - 22); Tx(`Seite ${p} / ${pages}`, W - 40, H - 22, { align: 'right' }); }
  doc.setProperties({ title: 'Vorher-Nachher' + (name ? ' ' + pdfText(name) : '') });
  return doc.output('blob');
}

/* ---------- Ereignisse ---------- */
function conv(t) { if (t.type === 'checkbox') return t.checked; if (t.dataset.t === 'number') { const n = parseFloat(t.value); return t.value === '' || !isFinite(n) ? '' : n; } return t.value; }
document.addEventListener('input', (e) => {
  const t = e.target; if (!t.closest || !t.closest('#bogen')) return;
  if (t.dataset.p === 'budget.v.in-salary') { if (t.value === '') delete S.v['in-salary']; else S.v['in-salary'] = t.value; delete S.iv['in-salary']; }
  else if (t.dataset.p) setP(K, t.dataset.p, conv(t));
  else if (t.dataset.list) {
    const row = getP(K, t.dataset.list)[+t.dataset.i]; if (!row) return;
    if (t.dataset.k === 'sparte' && t.tagName === 'SELECT') { if (t.value === '__custom') { row.custom = true; row.sparte = ''; row.gruppe = 'sonst'; } else { row.sparte = t.value; row.gruppe = t.value ? spartenGruppe(t.value) : ''; } }
    else row[t.dataset.k] = conv(t);
    if (t.dataset.list === 'vertraege') syncContracts();
  } else return;
  markDirty(); updateDerived();
});
document.addEventListener('change', (e) => {
  const t = e.target; if (t.tagName !== 'SELECT' || !t.closest('#bogen')) return;
  if (t.dataset.p || t.dataset.k === 'sparte') renderBogen();
});
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act;
  if (act === 'tab') showTab(t.dataset.tab);
  else if (act === 'new') newClient();
  else if (act === 'home') goHome();
  else if (act === 'save') trySave();
  else if (act === 'dir-pick') pickDir();
  else if (act === 'dir-confirm') ensureDir().then(renderStart);
  else if (act === 'load') { if (dirState === 'prompt') ensureDir().then((ok) => { renderStart(); if (!ok) $('json-in').click(); }); else if (dirState === 'ok') { const c = $('clients'); if (c) c.scrollIntoView({ block: 'center', behavior: 'smooth' }); toast('Wähle den Kunden aus der Liste.'); } else $('json-in').click(); }
  else if (act === 'load-file') $('json-in').click();
  else if (act === 'open-client') openClient(t.dataset.name);
  else if (act === 'yn') { setP(K, t.dataset.p, t.dataset.v === '1'); markDirty(); renderBogen(); }
  else if (act === 'iaa') { K.gesundheit.aktiv = !K.gesundheit.aktiv; markDirty(); renderBogen(); }
  else if (act === 'add') { const L = LISTS[t.dataset.list]; getP(K, t.dataset.list).push(L.blank()); markDirty(); rerenderList(t.dataset.list, true); }
  else if (act === 'rm') { getP(K, t.dataset.list).splice(+t.dataset.i, 1); if (t.dataset.list === 'vertraege') syncContracts(); markDirty(); rerenderList(t.dataset.list); }
  else if (act === 'best') { K.bestand[t.dataset.id] = { status: t.dataset.s, manuell: true }; markDirty(); renderBestand(); }
  else if (act === 'best-auto') { delete K.bestand[t.dataset.id]; markDirty(); renderBestand(); }
  else if (act === 'goto') { showTab('bogen'); const s = $(t.dataset.sec); if (s) s.scrollIntoView({ block: 'start' }); const l = $('l-vertraege'); if (l) l.scrollIntoView({ block: 'center' }); }
  else if (act === 'pdf-bogen') { syncName(); download(`Abfragebogen_${today()}.pdf`, buildBogenPdf()); }
  else if (act === 'pdf-budget') { syncName(); syncContracts(); download(`Budgetcheck_${today()}.pdf`, buildPdf().blob); }
  else if (act === 'vn-present') vnPresent();
  else if (act === 'pdf-vn') { if (!vnReady) return; download(`Vorher-Nachher_${today()}.pdf`, buildVnPdf()); }
  else if (act === 'dlg-back') $('dlg').close();
  else if (act === 'dlg-save') { $('dlg').close(); saveAll(); }
  else if (act === 'miss-jump') jumpTo($('dlg')._miss[+t.dataset.i]);
});
function rerenderList(path, focusLast) {
  renderBogen();
  if (focusLast) { const el = $('l-' + path.replace(/[.]/g, '-')); const rows = el ? el.querySelectorAll('.lr') : []; const f = rows.length ? rows[rows.length - 1].querySelector('.inp') : null; if (f) f.focus({ preventScroll: true }); }
}
document.addEventListener('change', (e) => { if (e.target.id === 'json-in') { const f = e.target.files[0]; e.target.value = ''; if (f) f.text().then(loadJson); } });

/* ---------- Start ---------- */
buildForms(); lockContractRows(); render();
vnInit(); renderStart(); initDir();
