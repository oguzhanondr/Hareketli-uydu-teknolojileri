// Recapture the four app screenshots used in the KTR source document in LIGHT mode.
// Drives the live deployment, forcing theme=light via localStorage before load.
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'http://localhost:5174/'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '../screenshots')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2,
  })
  // Force light theme before the app's JS runs.
  await context.addInitScript(() => {
    try { localStorage.setItem('ares-theme', 'light') } catch {}
  })
  const page = await context.newPage()
  page.setDefaultTimeout(60000)

  async function waitMap() {
    await page.waitForSelector('.leaflet-tile-loaded', { timeout: 45000 }).catch(() => {})
    await sleep(2800)
  }
  async function assertLight(label) {
    const cls = await page.evaluate(() => document.documentElement.className)
    console.log(`[${label}] <html> class = "${cls}"`)
  }

  // ---- 01: empty initial analysis view ----
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.getByText('Demo Senaryolar').first().waitFor()
  await assertLight('01')
  await waitMap()
  await page.screenshot({ path: path.join(OUT, '01-analiz-genel-gorunum.png') })
  console.log('saved 01')

  // ---- 02: scenario inputs marked (merkez = 12 depremzede, 4 enkaz), pre-analysis ----
  await page.goto(BASE + '?demo=merkez', { waitUntil: 'domcontentloaded' })
  await assertLight('02')
  // wait until the toolbar counters show the loaded inputs
  await page
    .waitForFunction(() => /ENKAZ\s*[1-9]/.test(document.body.innerText), { timeout: 60000 })
    .catch(() => console.log('02: counter wait timed out, capturing anyway'))
  await waitMap()
  await sleep(2500)
  const counts = await page.evaluate(() => {
    const m = document.body.innerText.match(/DEPREMZEDE\s*\d+|ENKAZ\s*\d+/g)
    return m ? m.join(' / ') : 'n/a'
  })
  console.log('02 counters:', counts)
  await page.screenshot({ path: path.join(OUT, '02-senaryo-girdileri.png') })
  console.log('saved 02')

  // ---- 06a + 07: Project Details page ----
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.getByText('Proje Detayları').first().click()
  await page.getByText(/enkaz gölgesinde kalan/i).first().waitFor({ timeout: 20000 })
  await assertLight('06a')
  await page.evaluate(() => window.scrollTo(0, 0))
  await sleep(1000)
  await page.screenshot({ path: path.join(OUT, '06a-proje-detaylari-ust.png') })
  console.log('saved 06a')

  // 07: scroll the GÖREV cards row near the top, keep a thin sliver above (like original)
  await page.getByText('Dar bant hayat koridoru').first().scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, -95))
  await sleep(900)
  await page.screenshot({ path: path.join(OUT, '07-sistem-islem-akisi.png') })
  console.log('saved 07')

  await browser.close()
  console.log('DONE')
}

main().catch((e) => {
  console.error('CAPTURE FAILED:', e)
  process.exit(1)
})
