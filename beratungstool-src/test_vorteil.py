import asyncio, json, subprocess, pathlib, base64
from playwright.async_api import async_playwright
OUT = pathlib.Path('/home/claude/test'); FILE = '/home/claude/out/beratungstool.html'
res = []
def check(name, cond, detail=''):
    res.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (' | ' + str(detail) if detail else ''))

def pdftext(path):
    return subprocess.run(['pdftotext', '-layout', str(path), '-'], capture_output=True, text=True).stdout

async def main():
    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        # ---------- A: Bedienung offline (file://) ----------
        ctx = await br.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True); page = await ctx.new_page()
        reqs, errs = [], []
        page.on('request', lambda r: reqs.append(r.url)); page.on('pageerror', lambda e: errs.append(str(e)))
        page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        page.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await page.goto('file://' + FILE); await page.wait_for_selector('[data-act="new"]')
        await page.click('[data-act="new"]')
        await page.fill('#f-person-vorname', 'Erika'); await page.fill('#f-person-nachname', 'Mustermann')
        await page.click('[data-tab="vorteil"]')
        check('Tab Vorteilsregal: 4 Reiter, Kapitel 1 mit 16 Maßnahmen sichtbar', await page.locator('.vt-tab').count() == 4 and await page.locator('.vt-row').count() == 16 and await page.locator('.vt-kap').count() == 1)
        cnt = []
        for k in (2, 3, 4):
            await page.click(f'.vt-tab[data-k="{k}"]'); cnt.append(await page.locator('.vt-row').count())
        check('Kapitel 2/3/4 einzeln: 5, 6, 15 Maßnahmen', cnt == [5, 6, 15], cnt)
        await page.click('.vt-tab[data-k="1"]')
        check('Ohne Geburtsdatum: Hinweis statt Hochrechnung', 'Geburtsdatum' in await page.inner_text('#vt-sum') and await page.inner_text('#vt-kapital') == '–')
        check('Start: nichts angekreuzt, Summe 0 €', (await page.inner_text('#vt-monat')).startswith('0'), await page.inner_text('#vt-monat'))
        check('Vorher mit Richtwert vorbelegt (Strom 25)', await page.input_value('[data-vid="v01"][data-vf="v"]') == '25')
        check('Enveko als tecis-Partner markiert', 'tecis-Partner' in await page.inner_text('#vt-v01'))
        check('Kein Link im Vorteilsregal', await page.locator('#vorteil a').count() == 0)

        # Geburtsdatum setzen -> 32 Jahre (wie Haupttest), 35 Jahre bis 67
        await page.click('[data-tab="bogen"]'); await page.fill('#f-person-geburtsdatum', '1994-05-17'); await page.click('[data-tab="vorteil"]')
        await page.check('[data-vid="v01"][data-vf="c"]')
        check('Ankreuzen Strom: 25 € pro Monat', (await page.inner_text('#vt-monat')).startswith('25'), await page.inner_text('#vt-monat'))
        await page.fill('[data-vid="v01"][data-vf="v"]', '95'); await page.fill('[data-vid="v01"][data-vf="n"]', '70')
        check('Vorher 95 / Nachher 70: Zeile zeigt 25 €', (await page.inner_text('#vte-v01')).endswith('25 €'), await page.inner_text('#vte-v01'))
        await page.click('[data-act="vt-kap"][data-k="2"].btn')
        check('Weiter-Knopf führt zu Kapitel 2', await page.get_attribute('.vt-tab[data-k="2"]', 'aria-selected') == 'true')
        await page.fill('[data-vid="v17"][data-vf="b"]', '100')
        check('Betrag bei Anschlussfinanzierung wird automatisch übernommen', await page.is_checked('[data-vid="v17"][data-vf="c"]'))
        await page.fill('[data-vid="v17"][data-vf="note"]', 'Forward-Darlehen bis 03/2027 anfragen')
        await page.click('.vt-tab[data-k="1"]')
        check('Reiter zeigt Zwischenstand je Kapitel', '100' in await page.inner_text('.vt-tab[data-k="2"]'), await page.inner_text('.vt-tab[data-k="2"]'))
        await page.fill('[data-vid="v11"][data-vf="n"]', '20')  # Unnötige Versicherungen 50 -> 20 = 30
        check('Nachher eintragen übernimmt die Zeile', await page.is_checked('[data-vid="v11"][data-vf="c"]'))
        m = await page.inner_text('#vt-monat')
        check('Summe 25 + 100 + 30 = 155 €', m.startswith('155'), m)
        exp = await page.evaluate("(()=>{const t=vTotals();return {j:t.jahre,k:Math.round(t.kapital),r:Math.round(t.rente),p:Math.round(project(0,155,35))}})()")
        check('Hochrechnung: 35 Jahre, Kapital = project(0, 155, 35) mit 6 %', exp['j'] == 35 and exp['k'] == exp['p'] and exp['r'] == round(exp['p'] / 216), exp)
        shown = await page.inner_text('#vt-kapital')
        check('Kapital wird angezeigt', ''.join(c for c in shown if c.isdigit()) == str(exp['k']), shown)
        await page.uncheck('[data-vid="v01"][data-vf="c"]')
        check('Abwählen nimmt Strom wieder raus: 130 €', (await page.inner_text('#vt-monat')).startswith('130'), await page.inner_text('#vt-monat'))
        check('Zustand liegt in K.vorteil', await page.evaluate("K.vorteil.v17.b==='100' && K.vorteil.v01.c===false && K.vorteil.v11.c===true"))
        check('Ungespeichert-Markierung gesetzt', 'Nicht gespeichert' in await page.inner_text('#save-state'))
        await page.check('[data-vid="v01"][data-vf="c"]')
        await page.evaluate("scrollTo(0,0)"); await page.screenshot(path=str(OUT/'11_vorteil_oben.png'))
        await page.click('.vt-tab[data-k="2"]'); await page.evaluate('scrollTo(0,0)'); await page.screenshot(path=str(OUT/'12_vorteil_kap2.png')); await page.click('.vt-tab[data-k="1"]')
        # PDF-Download über Button
        async with page.expect_download() as dl:
            await page.click('[data-act="pdf-vorteil"]')
        d = await dl.value; p = OUT/'Sparpotenzial_test.pdf'; await d.save_as(str(p))
        txt = pdftext(p)
        check('PDF: Titel, Summe 155 €, Kapital', 'Sparpotenzial' in txt and '155 €' in txt and f"{exp['k']:,}".replace(',', '.') in txt, '')
        check('PDF: übernommene Maßnahmen + Notiz + Partner', all(s in txt for s in ['Strom- oder Gasanbieter wechseln', 'Anschlussfinanzierungen optimieren', 'Unnötige Versicherungen checken', 'Forward-Darlehen', 'Enveko']))
        check('PDF: nicht angekreuzte Maßnahmen fehlen', 'Router kaufen' not in txt and 'GKV Wechsel' not in txt)
        check('PDF: keine URLs, kein Ruehlii, Annahmen-Hinweis', 'http' not in txt and 'ruehlii' not in txt.lower() and '6 % Rendite' in txt and 'keine Empfehlung einzelner Anbieter' in txt)
        subprocess.run(['pdftoppm', '-png', '-r', '70', str(p), str(OUT/'pdf_Sparpotenzial')])
        check('Offline: keine Netzwerkanfrage', all(u.startswith('file://') or u.startswith('blob:') or u.startswith('data:') for u in reqs), [u for u in reqs if not u.startswith('file://')][:3])
        check('Keine Konsolenfehler', not errs, errs[:3])
        state = await page.evaluate("JSON.stringify(K)")
        await ctx.close()

        # ---------- B: Speichern/Laden (OPFS als Kundenordner) ----------
        ctx = await br.new_context(viewport={'width': 1440, 'height': 900}); page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e))); page.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await page.goto('http://localhost:8765/beratungstool.html'); await page.wait_for_selector('[data-act="new"]')
        await page.evaluate("async () => { const r = await navigator.storage.getDirectory(); for await (const [n] of r.entries()) await r.removeEntry(n, {recursive:true}); }")
        await page.evaluate("async (st) => { dirHandle = await navigator.storage.getDirectory(); dirState = 'ok'; loadJson(st); }", state)
        await page.evaluate("saveAll()"); await page.wait_for_timeout(1500)
        files = await page.evaluate("""async () => { const out=[]; const r=await navigator.storage.getDirectory(); const d=await r.getDirectoryHandle('Mustermann_Erika'); for await (const [n,h] of d.entries()) out.push(n); return out.sort(); }""")
        check('Speichern legt Sparpotenzial-PDF im Kundenordner ab', any(f.startswith('Sparpotenzial_') for f in files), files)
        saved = await page.evaluate("""async () => { const r=await navigator.storage.getDirectory(); const d=await r.getDirectoryHandle('Mustermann_Erika'); return await (await (await d.getFileHandle('kunde.json')).getFile()).text(); }""")
        kj = json.loads(saved)
        check('kunde.json enthält Vorteilsregal', kj['vorteil']['v17']['b'] == '100' and kj['vorteil']['v01']['c'] is True and kj['vorteil']['v17']['note'].startswith('Forward'))
        await page.evaluate("newClient()"); await page.evaluate("(s) => loadJson(s)", saved)
        await page.click('[data-tab="vorteil"]')
        check('Laden stellt Vorteilsregal wieder her', (await page.inner_text('#vt-monat')).startswith('155') and await page.input_value('[data-vid="v01"][data-vf="v"]') == '95' and await page.is_checked('[data-vid="v11"][data-vf="c"]'))
        # alter Kunde ohne vorteil-Feld lädt sauber
        old = json.loads(saved); del old['vorteil']
        await page.evaluate("(s) => loadJson(s)", json.dumps(old)); await page.click('[data-tab="vorteil"]')
        check('Ältere kunde.json ohne Vorteilsregal lädt sauber', (await page.inner_text('#vt-monat')).startswith('0') and await page.locator('.vt-row').count() == 16)
        check('Keine Fehler beim Speichern/Laden', not errs, errs[:3])
        await br.close()
    print(f"\n{sum(1 for _, ok in res if ok)}/{len(res)} bestanden")

asyncio.run(main())
