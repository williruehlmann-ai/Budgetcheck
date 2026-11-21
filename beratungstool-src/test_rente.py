import asyncio, json, subprocess, pathlib
from playwright.async_api import async_playwright
OUT = pathlib.Path('/home/claude/test'); FILE = '/home/claude/out/beratungstool.html'
res = []
def check(name, cond, detail=''):
    res.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (' | ' + str(detail) if detail else ''))
def pdftext(p): return subprocess.run(['pdftotext', '-layout', str(p), '-'], capture_output=True, text=True).stdout
digits = lambda s: int(''.join(c for c in s if c.isdigit()) or 0)

async def main():
    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await br.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True); page = await ctx.new_page()
        reqs, errs = [], []
        page.on('request', lambda r: reqs.append(r.url)); page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        page.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await page.goto('file://' + FILE); await page.wait_for_selector('[data-act="new"]')
        await page.click('[data-act="new"]')
        tabs = [await page.inner_text(f'.mtab:nth-child({i})') for i in range(1, 6)]
        check('Reihenfolge: Bogen, Budgetcheck, Rentenlücke, Vorteilsregal, Vorher-Nachher', [t.split('\n')[-1].strip() for t in tabs] == ['Abfragebogen', 'Budgetcheck', 'Rentenlücke', 'Vorteilsregal', 'Vorher-Nachher'], tabs)
        await page.click('[data-tab="rente"]')
        check('Ohne Netto/Geburtsdatum: Platzhalter statt Rechnung', 'Noch keine Rechnung' in await page.inner_text('#rl-out'))
        await page.click('[data-tab="bogen"]')
        for p, v in [('person.vorname', 'Erika'), ('person.nachname', 'Mustermann'), ('person.geburtsdatum', '1994-05-17'), ('budget.v.in-salary', '2500')]:
            await page.fill('#f-' + p.replace('.', '-'), v)
        await page.click('[data-tab="rente"]')
        check('Wunschrente-Vorschlag 80 % vom Netto = 2000', '2000' in (await page.get_attribute('#rl-wunsch', 'placeholder')))
        await page.fill('#rl-hoch', '1400')
        exp = await page.evaluate("(()=>{const c=rlCalc();return {j:c.jahre,w:c.wunsch,g:c.gesNetto,l:c.luecke,lrb:Math.round(c.lueckeRB),k:Math.round(c.kapital),r:Math.round(c.sparrate),pr:Math.round(c.lueckeRB*216/project(0,1,35))}})()")
        check('Rechnung: 35 Jahre, Wunsch 2000, gesetzlich netto 1120 (1400 − 20 %), Lücke 880', exp['j'] == 35 and exp['w'] == 2000 and abs(exp['g'] - 1120) < 0.01 and abs(exp['l'] - 880) < 0.01, exp)
        check('Lücke bei Rentenbeginn = 880 × 1,02^35', exp['lrb'] == round(880 * 1.02 ** 35), (exp['lrb'], round(880 * 1.02 ** 35)))
        check('Kapitalbedarf = Lücke × 12 × 18, Sparrate über project() mit 6 %', exp['k'] == round(880 * 1.02 ** 35 * 216) and exp['r'] == exp['pr'], exp)
        check('Anzeige Lücke heute 880 €', digits(await page.inner_text('#rl-luecke')) == 880, await page.inner_text('#rl-luecke'))
        check('Anzeige Sparplan', digits(await page.inner_text('#rl-rate')) == exp['r'], await page.inner_text('#rl-rate'))
        check('Renteninfo landet im Abfragebogen-Feld', await page.evaluate("K.rente.hochgerechnet===1400 && K.rente.vorhanden===true"))
        check('Ohne Einsparungen: Hinweis aufs Vorteilsregal', 'Noch keine Einsparungen' in await page.inner_text('#rl-out'))
        # eigene Wunschrente + weitere Rente
        await page.fill('#rl-wunsch', '2200'); await page.fill('#rl-weitere', '100')
        check('Eigene Wunschrente 2200 und weitere 100: Lücke 980', digits(await page.inner_text('#rl-luecke')) == 980, await page.inner_text('#rl-luecke'))
        # Einsparungen im Vorteilsregal -> Deckung
        await page.click('[data-tab="vorteil"]'); await page.check('[data-vid="v01"][data-vf="c"]'); await page.fill('[data-vid="v11"][data-vf="n"]', '0')  # 25 + 50 = 75
        await page.click('[data-tab="rente"]')
        dk = await page.evaluate("Math.round(rlCalc().deckung*100)"); rate = await page.evaluate("rlCalc().sparrate")
        check('Einsparungen 75 € decken Anteil des Sparplans', dk == round(75 / rate * 100) and f'{dk} %' in await page.inner_text('#rl-out'), (dk, rate))
        await page.evaluate("scrollTo(0,0)"); await page.screenshot(path=str(OUT / '13_rentenluecke.png'), full_page=True)
        # PDF
        async with page.expect_download() as dl: await page.click('[data-act="pdf-rente"]')
        p = OUT / 'Rentenluecke_test.pdf'; await (await dl.value).save_as(str(p)); txt = pdftext(p)
        check('PDF Rentenlücke: Titel, Lücke, Annahmen, Finanzierung', all(x in txt for x in ['Rentenlücke', '980 €', '80 % vom heutigen Netto', '20 % Abzug', '2 % pro Jahr', 'FINANZIERT AUS DEINEN EINSPARUNGEN', '75 €']), '')
        check('PDF Rentenlücke: kein Link, kein Ruehlii', 'http' not in txt and 'ruehlii' not in txt.lower())
        subprocess.run(['pdftoppm', '-png', '-r', '70', str(p), str(OUT / 'pdf_Rentenluecke')])
        # Vorher-Nachher: Gegenfinanzierung
        await page.click('[data-tab="vn"]'); await page.wait_for_timeout(600)
        await page.evaluate("""(()=>{const V=vnWin.__vn,T=V.get();const it=T.items.find(i=>i.name==='Hausrat');it.on=true;it.p[1]='12,00';it.z[1]='m';V.refresh();vnChanged();})()""")
        fin = await page.evaluate("vnFinCalc()")
        check('Vorher-Nachher: Leiste zeigt Einsparungen und Netto', fin['ersp'] == 75 and abs(fin['netto'] - (fin['d'] - 75)) < 0.01 and 'Vorteilsregal' in await page.inner_text('#vn-fin'), fin)
        check('Unterm Strich richtig beschriftet', ('sparst du' if fin['netto'] <= 0 else 'zahlst du mehr') in await page.inner_text('#vn-fin'))
        await page.evaluate("scrollTo(0,0)"); await page.screenshot(path=str(OUT / '14_vn_gegenfinanzierung.png'))
        async with page.expect_download() as dl: await page.click('[data-act="pdf-vn"]')
        p2 = OUT / 'VN_test.pdf'; await (await dl.value).save_as(str(p2)); t2 = pdftext(p2)
        check('Vorher-Nachher-PDF enthält Gegenfinanzierung', 'GEGENFINANZIERT AUS DEINEN EINSPARUNGEN' in t2 and 'Vorteilsregal' in t2)
        subprocess.run(['pdftoppm', '-png', '-r', '70', '-f', '1', '-l', '1', str(p2), str(OUT / 'pdf_VN_fin')])
        # Laden/Speichern-Daten
        st = json.loads(await page.evaluate("JSON.stringify(K)"))
        check('kunde.json enthält Rentenlücke-Eingaben', st['rentenluecke'] == {'wunsch': '2200', 'weitere': '100'})
        old = dict(st); del old['rentenluecke']
        await page.evaluate("(s)=>loadJson(s)", json.dumps(old)); await page.click('[data-tab="rente"]')
        check('Ältere kunde.json ohne Rentenlücke lädt, Vorschlag 80 % greift', digits(await page.inner_text('#rl-luecke')) == 880, await page.inner_text('#rl-luecke'))
        check('Offline: keine Netzwerkanfrage', all(u.startswith(('file://', 'blob:', 'data:', 'about:')) for u in reqs), [u for u in reqs if not u.startswith('file://')][:3])
        check('Keine Konsolenfehler', not errs, errs[:3])
        await br.close()
    print(f"\n{sum(1 for _, ok in res if ok)}/{len(res)} bestanden")
asyncio.run(main())
