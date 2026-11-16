/* Brücke zum Beratungstool: Zustand lesen/setzen, Vorher-Felder aus der Vertragsliste sperren */
window.__vn = {
  get: () => S,
  set(o) { S = o && valid(o) ? normalize(JSON.parse(JSON.stringify(o))) : blankState(); query = ''; $('search').value = ''; $('search-clr').hidden = true; },
  refresh() { syncHead(); show(S.view || 'pick'); },
  sel, totals, split, mon, num, eur, sgn, pm, GROUPS, ZW,
  presenting: () => document.body.classList.contains('present'),
  togglePresent: () => $('present-btn').click(),
};
(function () {
  const orig = buildCompare;
  buildCompare = function () {
    orig();
    const L = window.__vnLocked; if (!L) return;
    document.querySelectorAll('#cards .vcard').forEach(c => {
      if (!L.has(c.dataset.id)) return;
      const s = c.querySelector('.side.v0'); if (!s) return; s.classList.add('locked');
      s.querySelectorAll('input.money, textarea').forEach(el => { el.readOnly = true; el.title = 'Kommt aus der Vertragsliste im Abfragebogen'; });
      const z = s.querySelector('select.zw'); if (z) z.disabled = true;
      s.querySelector('.side-h span').insertAdjacentHTML('beforeend', ' <em class="lk">aus Vertragsliste</em>');
    });
  };
})();
