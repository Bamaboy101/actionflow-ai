import { test, expect } from '@playwright/test'
import { instrument, openApp, shoot, dumpDiagnostics, WORKER } from './helpers'
import fs from 'node:fs'
import path from 'node:path'

/** A genuine, text-based PDF written by this test — not a mocked response. */
function buildPdf(text: string): Buffer {
  const content = `BT /F1 12 Tf 60 720 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((o, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf, 'latin1')
}

test.describe('ActionFlow AI — live public acceptance', () => {
  test('paste → extract → review → approve → ICS export; real PDF upload extracts text', async ({ page, browser }, testInfo) => {
    const probe = instrument(page)
    const project = testInfo.project.name

    await openApp(page)
    await expect(page).toHaveTitle(/ActionFlow/i)
    await expect(page.getByText('Interview invitation').first()).toBeVisible({ timeout: 45_000 })
    expect(probe.workerCalls.some((c) => c.url.endsWith('/api/samples') && c.status === 200)).toBeTruthy()
    await shoot(page, '01-samples', project)

    // Consent genuinely gates extraction.
    const extractBtn = page.getByRole('button', { name: /Extract Actions/ })
    await page.getByPlaceholder(/Paste email, notice/).fill(
      'Please attend the review meeting on Friday, November 20 at 2:00pm EST. Bring a photo ID.'
    )
    await expect(extractBtn).toBeDisabled()
    await page.getByTestId('consent').check()
    await expect(extractBtn).toBeEnabled()
    await extractBtn.click()

    await expect(page.getByRole('heading', { name: 'Review & Approve' })).toBeVisible({ timeout: 45_000 })
    await expect(page.getByText(/Identified \d+ action item/)).toBeVisible()
    expect(probe.workerCalls.some((c) => c.url.includes('/api/extract') && c.status === 200)).toBeTruthy()
    await shoot(page, '02-extracted', project)

    // Review then approve — approval must really change state.
    await page.getByRole('button', { name: 'Review', exact: true }).first().click()
    await expect(page.getByText('reviewed').first()).toBeVisible({ timeout: 45_000 })
    await page.getByRole('button', { name: 'Approve', exact: true }).first().click()
    await expect(page.getByText('approved').first()).toBeVisible({ timeout: 45_000 })
    const approveCall = probe.workerCalls.find((c) => c.url.includes('/api/approve'))
    expect(approveCall, 'approval must hit the Worker').toBeTruthy()
    expect(approveCall!.status).toBe(200)
    await shoot(page, '03-approved', project)

    // ICS export must download a valid calendar file.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export ICS Calendar' }).click(),
    ])
    const icsPath = path.join(testInfo.outputDir, 'export.ics')
    await download.saveAs(icsPath)
    const ics = fs.readFileSync(icsPath, 'utf8')
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('END:VCALENDAR')
    fs.mkdirSync('diagnostics', { recursive: true })
    fs.writeFileSync('diagnostics/actionflow-export.ics', ics)
    await shoot(page, '04-exported', project)

    // Real PDF upload through the UI.
    await page.getByRole('button', { name: '← Back' }).click()
    const pdf = buildPdf('Dentist appointment with Dr. Lee on Tuesday, December 2 at 10:30am.')
    const pdfPath = path.join(testInfo.outputDir, 'appointment.pdf')
    fs.writeFileSync(pdfPath, pdf)
    await page.locator('input[type=file]').setInputFiles(pdfPath)
    await page.getByTestId('consent').check()
    await page.getByRole('button', { name: /Extract Actions/ }).click()
    await expect(page.getByRole('heading', { name: 'Review & Approve' })).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText(/Dr\. Lee/)).toBeVisible({ timeout: 45_000 })
    await shoot(page, '05-pdf-extracted', project)

    // Timezone ambiguity must be surfaced, never silently guessed.
    await expect(page.getByText(/timezone/i).first()).toBeVisible()

    // Second visitor cannot read this visitor's records.
    const session = await page.evaluate(() => localStorage.getItem('demo-session-id'))
    const probeRes = await page.request.post(`${WORKER}/api/extract`, {
      headers: { 'x-demo-session': session || '', 'Content-Type': 'application/json' },
      data: { source_text: 'Probe on Monday, January 5 at 9am.', processing_consent: true, source_type: 'paste' },
    })
    expect(probeRes.status()).toBe(200)
    const probeId = (await probeRes.json()).request_id

    const mine = await (await page.request.get(`${WORKER}/api/actions/${probeId}`, {
      headers: { 'x-demo-session': session || '' },
    })).json()
    expect(mine.length).toBeGreaterThan(0)

    const otherCtx = await browser.newContext()
    const other = await otherCtx.newPage()
    await openApp(other)
    const otherSession = await other.evaluate(() => localStorage.getItem('demo-session-id'))
    expect(otherSession).not.toEqual(session)
    const theirs = await (await other.request.get(`${WORKER}/api/actions/${probeId}`, {
      headers: { 'x-demo-session': otherSession || '' },
    })).json()
    expect(theirs.length, 'another visitor must not read my actions').toBe(0)
    await shoot(other, '06-isolated-visitor', project)
    await otherCtx.close()

    dumpDiagnostics(`${project}-network`, probe)
    expect(probe.failedRequests, probe.failedRequests.join(' | ')).toEqual([])
    expect(probe.consoleErrors, probe.consoleErrors.join(' | ')).toEqual([])
  })
})
