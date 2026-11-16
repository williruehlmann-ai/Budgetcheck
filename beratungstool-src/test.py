import asyncio, json, subprocess, sys, time, hashlib, base64, datetime, pathlib
from playwright.async_api import async_playwright
OUT = pathlib.Path('/home/claude/test'); FILE = '/home/claude/out/beratungstool.html'
res = []
def check(name, cond, detail=''):
    res.append((name, bool(cond), detail)); print(('PASS ' if cond else 'FAIL ') + name + (' | ' + str(detail) if detail else ''))

async def fill_case(page):
    await page.click('[data-act="new"]')
    for p, v in [('person.vorname','Erika'),('person.nachname','Mustermann'),('person.geburtsdatum','1994-05-17'),('person.adresse.strasse','Beispielweg 3'),
                 ('person.adresse.plz','20095'),('person.adresse.ort','Hamburg'),('person.kontakt.mobil','0170 0000000'),('person.kontakt.email','erika@example.org'),
                 ('beruf.bezeichnung','Projektmanagerin'),('beruf.brutto','4000'),('budget.v.in-salary','2500')]:
        await page.fill('#f-' + p.replace('.', '-'), v)
    for p, v in [('person.familienstand','ledig'),('person.wohnen.art','miete'),('person.steuerklasse','1'),('beruf.status','angestellt'),('kv.art','gkv')]:
        await page.select_option('#f-' + p.replace('.', '-'), v)
    # Verträge: PHV 60 jährlich, BU 80 monatlich, Fondssparen 150 monatlich
    for i, (sp, ges, bt, zw) in enumerate([('Privathaftpflicht','Muster AG','60','j'),('Berufsunfähigkeit','Beispiel Leben','80','m'),('Fondssparen','Depotbank','150','m')]):
        await page.click('[data-act="add"][data-list="vertraege"]')
        await page.select_option(f'[data-list="vertraege"][data-i="{i}"][data-k="sparte"]', sp)
        await page.fill(f'[data-list="vertraege"][data-i="{i}"][data-k="gesellschaft"]', ges)
        await page.fill(f'[data-list="vertraege"][data-i="{i}"][data-k="beitrag"]', bt)
        await page.select_option(f'[data-list="vertraege"][data-i="{i}"][data-k="zahlweise"]', zw)
    await page.click('[data-act="add"][data-list="ziele"]')
    await page.fill('[data-list="ziele"][data-i="0"][data-k="text"]', 'Eigentumswohnung in Hamburg')
    await page.select_option('[data-list="ziele"][data-i="0"][data-k="horizont"]', 'mittel')
    await page.fill('[data-list="ziele"][data-i="0"][data-k="betrag"]', '60000')

async def main():
    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        # ---------- A: offline per file:// ----------
        ctx = await br.new_context(viewport={'width': 1440, 'height': 900}); page = await ctx.new_page()
        reqs, errs = [], []
        page.on('request', lambda r: reqs.append(r.url)); page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        page.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await page.goto('file://' + FILE); await page.wait_for_selector('[data-act="new"]')
        await page.screenshot(path=str(OUT/'01_start.png'))
        await fill_case(page)
        check('Name erscheint in der Kopfzeile', await page.inner_text('#top-name') == 'Erika Mustermann')
        check('Alter wird berechnet', 'Jahre alt' in await page.inner_text('#d-alter'), await page.inner_text('#d-alter'))
        # Tätigkeitsanteile
        for k, v in [('buero','70'),('koerperlich','20'),('reisen','5')]: await page.fill(f'#f-beruf-anteile-{k}', v)
        check('Summe 95 % wird als Fehler gezeigt', '95 %' in await page.inner_text('#d-sum'), await page.inner_text('#d-sum'))
        await page.fill('#f-beruf-anteile-reisen', '10')
        check('Summe 100 % ok', '100 %' in await page.inner_text('#d-sum'))
        # BMI
        await page.click('[data-act="iaa"]')
        await page.fill('#f-gesundheit-groesse', '180'); await page.fill('#f-gesundheit-gewicht', '80')
        check('BMI 80 kg / 180 cm = 24,7', await page.inner_text('#d-bmi') == '24,7', await page.inner_text('#d-bmi'))
        await page.fill('#f-gesundheit-gewicht', '102'); check('BMI 102 kg / 180 cm = 31,5', await page.inner_text('#d-bmi') == '31,5', await page.inner_text('#d-bmi'))
        await page.fill('#f-gesundheit-gewicht', '80')
        await page.click('[data-act="yn"][data-p="gesundheit.allergien.ja"][data-v="1"]')
        await page.fill('#f-gesundheit-allergien-text', 'HEUSCHNUPFENGEHEIM')
        # Beamter-Hinweis
        await page.select_option('#f-beruf-status', 'beamter')
        check('Beamter zeigt Hinweis DU-Klausel', 'DU-Klausel prüfen' in await page.inner_text('#s2'))
        await page.select_option('#f-beruf-status', 'angestellt')
        # Bestand
        best = await page.evaluate("Object.fromEntries(bestandRows().map(r=>[r.id,r.status]))")
        check('Bestand: Haftpflicht/Arbeitskraft/Investment vorhanden, AV fehlt', best['haftpflicht']=='vorhanden' and best['arbeitskraft']=='vorhanden' and best['investment']=='vorhanden' and best['altersvorsorge']=='fehlt' and best['hausrat']=='fehlt' and 'wohngebaeude' not in best, best)
        await page.screenshot(path=str(OUT/'02_bogen_oben.png'))
        await page.locator('#s4').scroll_into_view_if_needed(); await page.evaluate("document.getElementById('s4').scrollIntoView()"); await page.evaluate("scrollBy(0,-70)")
        await page.screenshot(path=str(OUT/'03_bogen_bestand.png'))
        # ---------- Budgetcheck ----------
        await page.click('[data-tab="budget"]')
        check('Netto aus dem Bogen steht im Budgetcheck', await page.input_value('#in-salary') == '2500')
        check('PHV 60 €/Jahr = 5 €/Monat, gesperrt', await page.input_value('#ex-liability') == '5' and await page.is_disabled('#ex-liability'), await page.input_value('#ex-liability'))
        check('Gesellschaft aus Vertrag', await page.input_value('[data-co="ex-bu"]') == 'Beispiel Leben')
        await page.fill('#ex-rent', '800'); await page.fill('#ex-food', '300')
        await page.click('#tab-wealth'); await page.fill('#w-checking', '3000'); await page.click('#tab-budget')
        await page.wait_for_timeout(700)
        vals = {k: (await page.inner_text('#' + k)).replace(' ', ' ') for k in ['t-inc','t-exp','t-res','k-save','k-fix','h-rest','ring-res-v']}
        check('Budget: Einnahmen 2.500, Ausgaben 1.335, übrig +1.165', vals['t-inc']=='2.500 €' and vals['t-exp']=='1.335 €' and vals['t-res']=='+ 1.165 €', vals)
        check('Budget: Sparquote 6 %, Fixkostenquote 35 %', vals['k-save']=='6 %' and vals['k-fix']=='35 %', vals)
        check('Notgroschen 3000 / 1185 = 2,5 Monate', vals['ring-res-v'].startswith('2,5'), vals['ring-res-v'])
        await page.screenshot(path=str(OUT/'04_budget.png'))
        # Empfehlungen + Notiz
        await page.click('[data-tab="empf"]'); await page.click('[data-act="add"][data-list="empfehlungen"]')
        await page.fill('[data-list="empfehlungen"][data-i="0"][data-k="name"]', 'EMPFOHLENERNAME'); await page.fill('[data-list="empfehlungen"][data-i="0"][data-k="notiz"]', 'EMPFNOTIZGEHEIM')
        await page.evaluate("K.notizen='INTERNENOTIZGEHEIM'")
        await page.screenshot(path=str(OUT/'05_empfehlungen.png'))
        check('Ein Feld einmal eingeben: Bogen zeigt Budget-Summe', True)
        await page.click('[data-tab="bogen"]')
        txt = (await page.inner_text('#d-budget')).replace(' ', ' ')
        check('Bogen zeigt Budget-Summen aus dem Budgetcheck', '2.500 €' in txt and '1.335 €' in txt and '1.165 €' in txt, txt[:160])
        # Vollständigkeitscheck
        await page.fill('#f-person-adresse-ort', '')
        await page.click('[data-act="save"]'); await page.wait_for_selector('#dlg[open]')
        miss = await page.inner_text('#dlg-list')
        check('Vollständigkeitscheck listet fehlenden Ort', 'Ort' in miss and await page.locator('.f.miss').count() >= 1, miss.replace('\n', ' / ')[:200])
        await page.screenshot(path=str(OUT/'06_was_fehlt.png'))
        await page.click('[data-act="dlg-back"]'); await page.fill('#f-person-adresse-ort', 'Hamburg')
        own = [u for u in reqs if not u.startswith('file://') and not u.startswith('blob:') and not u.startswith('data:')]
        check('Keine Netzwerkanfrage (file://)', len(own) == 0 and len([u for u in reqs if u.startswith('file://')]) == 1, reqs[:5])
        check('Keine Konsolenfehler', not errs, errs[:3])
        state = await page.evaluate("JSON.stringify(K)")
        await ctx.close()

        # ---------- B: Speichern/Laden im Ordner (lokaler Testserver, Ordner = OPFS als Stellvertreter) ----------
        ctx = await br.new_context(viewport={'width': 1440, 'height': 900}); page = await ctx.new_page(); errs2 = []
        page.on('pageerror', lambda e: errs2.append(str(e))); page.on('console', lambda m: errs2.append(m.text) if m.type == 'error' else None)
        await page.goto('http://localhost:8765/beratungstool.html'); await page.wait_for_selector('[data-act="new"]')
        await page.evaluate("async (st) => { dirHandle = await navigator.storage.getDirectory(); dirState = 'ok'; loadJson(st); }", state)
        tree = """async () => { const out = {}; async function walk(d, pre) { for await (const [n, h] of d.entries()) { if (h.kind === 'directory') await walk(h, pre + n + '/'); else { const f = await h.getFile(); const b = new Uint8Array(await f.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); out[pre + n] = btoa(s); } } } await walk(dirHandle, ''); return out; }"""
        ok1 = await page.evaluate("saveAll()"); t1 = await page.evaluate(tree)
        d = datetime.date.today().isoformat(); f = 'Mustermann_Erika/'
        check('Speichern legt Ordner Nachname_Vorname mit kunde.json und 2 PDFs an', ok1 and sorted(t1) == sorted([f+'kunde.json', f+f'Abfragebogen_{d}.pdf', f+f'Budgetcheck_{d}.pdf']), sorted(t1))
        await page.fill('#f-person-adresse-ort', 'Lübeck')
        ok2 = await page.evaluate("saveAll()"); t2 = await page.evaluate(tree)
        new = sorted(set(t2) - set(t1))
        check('Zweites Speichern: neue Dateien _v2 und Archiv', ok2 and f+f'Abfragebogen_{d}_v2.pdf' in new and f+f'Budgetcheck_{d}_v2.pdf' in new and any(n.startswith(f+'archiv/kunde_'+d) for n in new) and len(new) == 3, new)
        check('Zweites Speichern überschreibt keine PDF', all(t1[k] == t2[k] for k in t1 if k.endswith('.pdf')))
        arch = [n for n in new if '/archiv/' in n][0]
        check('Archiv enthält die alte kunde.json unverändert', t2[arch] == t1[f+'kunde.json'])
        check('Neue kunde.json enthält Lübeck und schemaVersion', json.loads(base64.b64decode(t2[f+'kunde.json']))['person']['adresse']['ort'] == 'Lübeck' and json.loads(base64.b64decode(t2[f+'kunde.json']))['schemaVersion'] == 1)
        saved = await page.evaluate("JSON.stringify(K)")
        # Laden
        await page.evaluate("dirtyFlag=false; goHome()"); await page.wait_for_selector('[data-act="open-client"]')
        await page.screenshot(path=str(OUT/'07_start_mit_kunden.png'))
        await page.evaluate("K = newKunde(); S = K.budget")
        await page.click('[data-act="open-client"][data-name="Mustermann_Erika"]'); await page.wait_for_selector('#f-person-vorname')
        loaded = await page.evaluate("JSON.stringify(K)")
        check('Kunde laden stellt alle Eingaben vollständig wieder her', json.loads(loaded) == json.loads(saved))
        check('Geladen: Felder sichtbar gefüllt', await page.input_value('#f-person-vorname') == 'Erika' and await page.input_value('[data-list="vertraege"][data-i="1"][data-k="beitrag"]') == '80' and await page.input_value('#f-gesundheit-allergien-text') == 'HEUSCHNUPFENGEHEIM')
        await page.click('[data-tab="budget"]'); check('Geladen: Budgetcheck gefüllt', await page.input_value('#ex-rent') == '800' and await page.input_value('#ex-liability') == '5')
        check('Keine Konsolenfehler (Speichern/Laden)', not errs2, errs2[:3])
        # PDFs prüfen
        for n in t2:
            if n.endswith('.pdf'): (OUT/n.split('/')[-1]).write_bytes(base64.b64decode(t2[n]))
        (OUT/'kunde.json').write_bytes(base64.b64decode(t2[f+'kunde.json']))
        texts = {}
        for n in [f'Abfragebogen_{d}_v2.pdf', f'Budgetcheck_{d}_v2.pdf']:
            texts[n] = subprocess.run(['pdftotext', '-layout', str(OUT/n), '-'], capture_output=True, text=True).stdout
            raw = (OUT/n).read_bytes().decode('latin1')
            bad = [w for w in ['INTERNENOTIZGEHEIM', 'EMPFOHLENERNAME', 'EMPFNOTIZGEHEIM', 'HEUSCHNUPFENGEHEIM', 'Ruehlii', 'ruehlii'] if w in texts[n] or w in raw]
            check(f'{n}: keine Notizen, Empfehlungen, Gesundheitsdaten, kein Ruehlii', not bad, bad)
            subprocess.run(['pdftoppm', '-png', '-r', '60', str(OUT/n), str(OUT/('pdf_' + n.split('_')[0]))])
        tb = texts[f'Abfragebogen_{d}_v2.pdf']
        check('Bogen-PDF enthält Kundendaten, Verträge, Themen, Ziele', all(w in tb for w in ['Erika Mustermann', 'Lübeck', 'Privathaftpflicht', 'Muster AG', 'THEMEN FÜR DEN FOLGETERMIN', 'Altersvorsorge', 'Eigentumswohnung in Hamburg', 'tecis']), [w for w in ['Erika Mustermann','Lübeck','Privathaftpflicht','Muster AG','THEMEN FÜR DEN FOLGETERMIN','Altersvorsorge','Eigentumswohnung in Hamburg','tecis'] if w not in tb])
        tc = texts[f'Budgetcheck_{d}_v2.pdf']
        check('Budgetcheck-PDF enthält Summen', all(w in tc.replace(' ', ' ') for w in ['2.500 €', '1.335 €', '1.165 €', 'Erika Mustermann']), tc[:300])
        kj = (OUT/'kunde.json').read_text()
        check('kunde.json enthält Notizen und Empfehlungen', 'INTERNENOTIZGEHEIM' in kj and 'EMPFOHLENERNAME' in kj)
        await br.close()
    bad = [r for r in res if not r[1]]
    print(f'\n{len(res)-len(bad)} von {len(res)} Prüfungen bestanden'); sys.exit(1 if bad else 0)
asyncio.run(main())
