#!/usr/bin/env python3
"""Baut beratungstool.html aus dem bestehenden Budgetcheck-Code (unverändert übernommen) plus Rahmen."""
import re, sys, pathlib
repo = pathlib.Path(sys.argv[1]); out = pathlib.Path(sys.argv[2]); here = pathlib.Path(__file__).parent
idx = (repo/'index.html').read_text(encoding='utf-8')
vn = (repo/'vorher-nachher.html').read_text(encoding='utf-8')
jspdf = (repo/'vendor/jspdf.umd.min.js').read_text(encoding='utf-8')
assert '</script' not in jspdf.lower()

def cut(s, a, b, incl_b=False):
    i = s.index(a); j = s.index(b, i)
    return s[i:j + (len(b) if incl_b else 0)]
def sub(s, a, b, count=1):
    assert s.count(a) == count, (a, s.count(a))
    return s.replace(a, b)

css = cut(idx, '<style>', '</style>')[len('<style>'):]

# Markup: Schritte + Ansichten Budget und Vermögen
mk = cut(idx, '<div class="stepbar">', '</main>', True)
mk = mk[:mk.index('    <!-- 3 Abschluss -->')] + '  </main>'
mk = sub(mk, '<main>', '<div class="bc-main">'); mk = sub(mk, '</main>', '</div>')
t3 = cut(mk, '      <button class="tab" role="tab" id="tab-finish"', '</button>\n', True); mk = sub(mk, t3, '')
mk = sub(mk, '          <div class="next"><button class="btn navy" type="button" data-go="finish">Weiter zum Abschluss →</button></div>\n', '')

# JS: Daten, Formulare, Rechnen, Anzeige, Hinweis, Gruppe leeren, PDF, Ereignisse
js = '\n'.join([
    cut(idx, 'const INC = {', '/* ---------- Speichern ---------- */'),
    cut(idx, '/* ---------- Hinweis mit Rückgängig ---------- */', 'function clearAll()'),
    cut(idx, 'function clearGroup(', '/* ---------- Check öffnen / speichern ---------- */'),
    cut(idx, "const DATA_TAG = ", '\n', True),
    cut(idx, 'function packState()', '\n', True),
    cut(idx, '/* ---------- PDF ---------- */', 'async function onPdf()'),
    cut(idx, '/* ---------- Ereignisse ---------- */', "$('reset-btn')"),
])
js = sub(js, "  $('client-name').value = S.name || '';\n  $('client-notes').value = S.notes || '';\n", '')
js = sub(js, 'T(`Bitte senden an: ${to}`, 40, H - 24)', 'T(`tecis · ${to}`, 40, H - 24)')

# Ansprache per Du
du = [
 ('Tragen Sie links Ihre Einnahmen und Ausgaben ein.', 'Trag links deine Einnahmen und Ausgaben ein.'),
 ('Sie geben ${eur(-b.rest)} mehr aus, als reinkommt.', 'Du gibst ${eur(-b.rest)} mehr aus, als reinkommt.'),
 ('Sobald Sie Ausgaben eintragen, erscheint', 'Sobald du Ausgaben einträgst, erscheint'),
 ('Ihre Fixkosten liegen im gesunden Bereich.', 'Deine Fixkosten liegen im gesunden Bereich.'),
 ('Sie erreichen das empfohlene Ziel.', 'Du erreichst das empfohlene Ziel.'),
 ('Konten tragen Sie in Schritt 2 ein.', 'Konten trägst du unter „Vermögen“ ein.'),
 ('Tragen Sie Ihre Ausgaben ein.', 'Trag deine Ausgaben ein.'),
 ('Tragen Sie Ihre Konten, Anlagen und Schulden ein.', 'Trag deine Konten, Anlagen und Schulden ein.'),
 ('Wie lange Ihre liquiden Mittel reichen', 'Wie lange deine liquiden Mittel reichen'),
]
for a, b in du:
    n = js.count(a) + mk.count(a); assert n >= 1, a
    js = js.replace(a, b); mk = mk.replace(a, b)

# Vorher-Nachher: ganzes Tool unverändert in einen eigenen Rahmen (iframe), nur Speicherung und Kopf angepasst
import json
vnp = vn
vnp = sub(vnp, "function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) {} }", "function save() { if (window.__vnChanged) window.__vnChanged(); }")
vnp = sub(vnp, "  try { const raw = localStorage.getItem(STORE_KEY); if (raw) { const o = JSON.parse(raw); if (valid(o)) { S = normalize(o); return; } } } catch (e) {}\n", "")
vnp = sub(vnp, "const ADVISOR = (() => { const d = {name:'', phone:'', mail:''}; try { return Object.assign(d, JSON.parse(localStorage.getItem(ADV_KEY) || '{}')); } catch (e) { return d; } })();", "const ADVISOR = {name:'Max Rühlmann', phone:'0173 8903097', mail:'max.ruehlmann@tecis.de'};")
vnp = sub(vnp, " try { localStorage.setItem(ADV_KEY, JSON.stringify(ADVISOR)); } catch (err) {}", "")
ft = cut(vnp, '  <footer>', '</footer>\n', True); vnp = sub(vnp, ft, '')
vnp = sub(vnp, '</style>', (here/'vn_inject.css').read_text(encoding='utf-8') + '</style>')
vnp = sub(vnp, '</body>', '<script>\n' + (here/'vn_bridge.js').read_text(encoding='utf-8') + '</script>\n</body>')
assert 'localStorage' not in vnp and 'href=' not in vnp, 'vn rest'
vn_src = 'const VN_SRC = ' + json.dumps(vnp, ensure_ascii=False).replace('<', '\\u003c').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029') + ';\n'

groups = cut(vn, 'const GROUPS = [', '\n];', True).replace('const GROUPS', 'const VN_GROUPS', 1)
bc_js = groups + '\n' + vn_src + js
app_js = (here/'app.js').read_text(encoding='utf-8')
app_css = (here/'app.css').read_text(encoding='utf-8')

own = mk + groups + js + vnp + app_js + (here/'shell.html').read_text(encoding='utf-8')
left = re.findall(r'[^\n]{0,40}\b(?:Sie|Ihr|Ihre[nmrs]?)\b[^\n]{0,40}', own)
assert not left, left
assert 'ruehlii' not in own.lower()
for bad in ('http://', 'https://', 'localStorage', 'fetch(', 'XMLHttpRequest', 'sendBeacon'):
    assert bad not in own.replace('http://www.w3.org/2000/svg', ''), bad

html = (here/'shell.html').read_text(encoding='utf-8')
for k, v in (('/*@@BC_CSS@@*/', css), ('/*@@APP_CSS@@*/', app_css), ('<!--@@BC_MARKUP@@-->', mk), ('/*@@JSPDF@@*/', jspdf), ('/*@@BC_JS@@*/', bc_js), ('/*@@APP_JS@@*/', app_js)):
    assert html.count(k) == 1, k
    html = html.replace(k, v)
out.write_text(html, encoding='utf-8')
print('ok', out, len(html.encode('utf-8')) // 1024, 'KB')
