import asyncio, pathlib
from playwright.async_api import async_playwright
OUT = pathlib.Path('/home/claude/test'); FILE = '/home/claude/out/beratungstool.html'
res = []
def check(name, cond, detail=''):
    res.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + (' | ' + str(detail) if detail else ''))

async def main():
    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        page = await (await br.new_context(viewport={'width': 1440, 'height': 1000})).new_page()
        errs = []; page.on('pageerror', lambda e: errs.append(str(e))); page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        page.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await page.goto('file://' + FILE); await page.click('[data-act="new"]')
        for p, v in [('person.vorname', 'Erika'), ('person.nachname', 'Mustermann'), ('person.geburtsdatum', '1994-05-17'), ('budget.v.in-salary', '2500')]:
            await page.fill('#f-' + p.replace('.', '-'), v)
        await page.click('[data-tab="rente"]'); await page.fill('#rl-hoch', '1400')
        await page.click('[data-tab="vorteil"]'); await page.check('[data-vid="v01"][data-vf="c"]'); await page.fill('[data-vid="v11"][data-vf="n"]', '0')
        await page.fill('[data-vid="v01"][data-vf="note"]', 'Termin mit Enveko vereinbaren')
        await page.click('[data-tab="bogen"]')
        # an
        await page.click('[data-act="present"]')
        vis = lambda sel: page.locator(sel).first.is_visible()
        check('Präsentieren: Abfragebogen-Tab weg, springt in den Budgetcheck', not await vis('.mtab[data-tab="bogen"]') and not await page.locator('#pane-budget').is_hidden())
        check('Kopfzeile: Speichern/Mappe/Startseite weg, Knopf heißt Bearbeiten', not await vis('[data-act="save"]') and not await vis('[data-act="pdf-mappe"]') and not await vis('[data-act="home"]') and (await page.inner_text('#present-btn')).strip() == 'Bearbeiten')
        check('Budgetcheck: nur Auswertung, keine Eingaben', not await vis('#budget-inputs') and await vis('#h-rest') and not await vis('[data-act="pdf-budget"]'))
        await page.screenshot(path=str(OUT / '15_present_budget.png'))
        await page.click('[data-tab="rente"]')
        check('Rentenlücke: Eingaben weg, Auswertung sichtbar', not await vis('#rl-wunsch') and await vis('#rl-luecke') and not await vis('.rl-fin .btn'))
        await page.screenshot(path=str(OUT / '16_present_rente.png'))
        await page.click('[data-tab="vorteil"]')
        on_vis = await page.locator('.vt-row:visible').count()
        check('Vorteilsregal: nur die 2 übernommenen Maßnahmen sichtbar', on_vis == 2, on_vis)
        check('Vorteilsregal: keine Kästchen, leere Notizen weg, gefüllte Notiz bleibt', not await vis('.vt-chk') and await page.locator('.vt-note:visible').count() == 1)
        check('Alle Eingaben gesperrt', await page.evaluate("[...document.querySelectorAll('#app input,#app select,#app textarea')].every(e=>e.disabled)"))
        await page.screenshot(path=str(OUT / '17_present_vorteil.png'))
        await page.click('.vt-tab[data-k="3"]')
        check('Kapitel ohne Übernahme zeigt Hinweis, Eingaben bleiben gesperrt', await vis('.vt-empty') and await page.evaluate("[...document.querySelectorAll('#vorteil input')].every(e=>e.disabled)"))
        await page.click('[data-tab="vn"]'); await page.wait_for_timeout(500)
        check('Vorher-Nachher schaltet in seinen Präsentationsmodus', await page.evaluate("vnWin.__vn.presenting()") and not await vis('.vn-bar'))
        await page.click('[data-tab="rente"]')
        check('Wechsel weg vom Vorher-Nachher beendet dessen Präsentation', not await page.evaluate("vnWin.__vn.presenting()"))
        # aus per Esc
        await page.keyboard.press('Escape')
        check('Esc beendet: Eingaben wieder offen, Knöpfe zurück', await vis('#rl-wunsch') and await page.is_enabled('#rl-wunsch') and await vis('[data-act="save"]') and await vis('.mtab[data-tab="bogen"]'))
        await page.click('[data-tab="vorteil"]')
        check('Vorteilsregal nach Ende wieder bearbeitbar (Kapitel 3: 6 Zeilen)', await page.locator('.vt-row').count() == 6 and await page.evaluate("[...document.querySelectorAll('#vorteil input')].every(e=>!e.disabled)") and not await vis('.vt-empty'))
        await page.click('[data-tab="budget"]')
        check('Budgetcheck nach Ende wieder bearbeitbar', await vis('#budget-inputs') and await page.is_enabled('#in-salary'))
        check('Daten unverändert', await page.evaluate("K.vorteil.v01.c===true && K.rente.hochgerechnet===1400 && S.v['in-salary']==='2500'"))
        check('Keine Konsolenfehler', not errs, errs[:3])
        await br.close()
    print(f"\n{sum(1 for _, ok in res if ok)}/{len(res)} bestanden")
asyncio.run(main())
