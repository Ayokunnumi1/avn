/**
 * Browser end-to-end test across all four PWAs (Playwright, fake camera, emulated GPS).
 * Prerequisites: seeded dev stack running (API :4000, worker, apps :3000-3003).
 * Run: node e2e/full-flow.cjs   (E2E_VERIFIER=verifierNN@avn.local to pick an idle verifier)
 */
// Browser end-to-end run across the four AVN PWAs (development data only).
const { chromium, devices } = require('playwright');
const { execSync } = require('child_process');
const OUT = process.env.E2E_OUT ?? __dirname + '/screenshots';
require('fs').mkdirSync(OUT, { recursive: true });
const psql = (sql) => execSync(`psql ${process.env.E2E_PSQL ?? '-h localhost -U avn avn_dev'} -tAc "${sql.replace(/"/g, '\\"')}"`).toString().trim();
const log = (...a) => console.log('•', ...a);

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
  const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  const errors = [];
  global.__pages = [];
  const watch = (page, tag) => { global.__pages.push([tag, page]); page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`)); page.on('console', (m) => m.type() === 'error' && errors.push(`${tag} console: ${m.text()}`)); };

  // 1. Institution creates a request.
  const biz = await browser.newContext(desktop);
  const b = await biz.newPage();
  watch(b, 'business');
  await b.goto('http://localhost:3002/sign-in');
  await b.getByLabel('Email').fill('officer@demobank.test');
  await b.getByLabel('Password').fill('AvnDemo2026!');
  await b.getByRole('button', { name: 'Sign in' }).click();
  await b.waitForURL('**/dashboard');
  await b.getByText('Total requests').waitFor();
  await shot(b, '01-business-dashboard');
  log('business dashboard ok');
  await b.goto('http://localhost:3002/requests/new');
  await b.getByLabel('Applicant full name').fill('Browser Test Applicant (fictional)');
  await b.getByLabel('Applicant phone').fill('08029990001');
  await b.getByLabel('Customer reference').fill(`E2E-${Date.now()}`);
  await b.getByRole('button', { name: 'Create request' }).click();
  await b.getByText('Secure invitation link').waitFor();
  const invite = await b.locator('input.mono').inputValue();
  await shot(b, '02-business-created');
  log('request created', invite);

  // 2. Applicant completes the wizard on a phone.
  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  const a = await phone.newPage();
  watch(a, 'applicant');
  await a.goto(invite);
  await a.getByRole('button', { name: 'Text me a code' }).click();
  const code = (await a.locator('strong.mono').innerText()).trim();
  await a.getByLabel('6-digit code').fill(code);
  await a.getByRole('button', { name: 'Continue' }).click();
  await a.waitForURL('**/verifications/**');
  await a.getByText('Step 1 of 9').waitFor();
  await shot(a, '03-applicant-wizard-step1');
  const next = () => a.getByRole('button', { name: 'Continue', exact: true }).click();
  await next();
  await next();
  await a.getByLabel('City / town').fill('Ikeja');
  await a.getByLabel('Street').fill('Browser Test Street (sample)');
  await a.getByLabel('House / plot number').fill('7');
  await shot(a, '04-applicant-address');
  await next();
  await a.locator('.map').waitFor();
  await a.waitForTimeout(1200);
  const box = await a.locator('.map').boundingBox();
  await a.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await a.getByText(/^\d+\.\d{6}, \d+\.\d{6}$/).waitFor();
  await shot(a, '05-applicant-pin');
  await next();
  await next();
  await next();
  for (const label of ['I have read the privacy notice', /authorise an approved AVN verifier/, /authorise AVN to share/]) await a.getByText(label).click();
  await next();
  await next();
  await a.getByRole('button', { name: 'Submit for verification' }).click();
  await a.getByText('Progress').waitFor({ timeout: 15000 });
  await shot(a, '06-applicant-tracking');
  const requestId = a.url().split('/').pop();
  const [lat, lng] = psql(`select ad.lat||','||ad.lng from "VerificationRequest" r join "Address" ad on ad.id=r."addressId" where r.id='${requestId}'`).split(',').map(Number);
  log('applicant submitted', requestId, lat, lng);

  // 3. Agent goes on duty near the property, accepts, visits and submits.
  psql(`update "VerifierAvailability" set "isAvailable"=false`);
  const agentCtx = await browser.newContext({ ...devices['Pixel 7'], geolocation: { latitude: lat + 0.003, longitude: lng + 0.002, accuracy: 9 }, permissions: ['geolocation', 'camera'] });
  const g = await agentCtx.newPage();
  watch(g, 'agent');
  await g.goto('http://localhost:3001/sign-in');
  await g.getByLabel('Email').fill((process.env.E2E_VERIFIER ?? 'verifier10@avn.local'));
  await g.getByLabel('Password').fill('AvnDemo2026!');
  await g.getByRole('button', { name: 'Sign in' }).click();
  await g.waitForURL('**/dashboard');
  await g.getByRole('button', { name: 'Go available' }).click();
  await g.getByText('On duty — keep this app open').waitFor();
  await shot(g, '07-agent-on-duty');
  log('agent on duty');
  await g.goto('http://localhost:3001/jobs');
  await g.getByRole('button', { name: 'Accept' }).first().waitFor({ timeout: 20000 });
  await shot(g, '08-agent-offer');
  await g.getByRole('button', { name: 'Accept' }).first().click();
  await g.waitForURL('**/assignments/**');
  await g.getByRole('heading', { name: 'Property' }).waitFor();
  await agentCtx.setGeolocation({ latitude: lat + 0.0001, longitude: lng, accuracy: 6 });
  await g.getByRole('button', { name: "I'm on my way" }).click();
  await g.getByRole('button', { name: 'I have arrived' }).click();
  await g.getByRole('heading', { name: 'Evidence' }).waitFor();
  log('arrived');
  for (const cat of ['BUILDING_EXTERIOR', 'BUILDING_ENTRANCE', 'STREET_ENVIRONMENT']) {
    await g.getByLabel('What are you photographing?').selectOption(cat);
    await g.getByRole('button', { name: /^Capture:/ }).click();
    await g.waitForTimeout(1500);
    await g.getByRole('button', { name: 'Take photo' }).click();
    await g.waitForTimeout(2500);
  }
  await g.getByText('Required captured').waitFor({ timeout: 20000 });
  log('evidence uploaded');
  const yes = async (q) => g.getByRole('group', { name: q }).getByRole('button', { name: 'Yes' }).click();
  await yes('Is the applicant personally available?');
  await yes('Did the applicant confirm they live here?');
  await g.getByRole('group', { name: 'Did another occupant confirm the applicant lives here?' }).getByRole('button', { name: 'Unsure' }).click();
  await yes('Was anyone available at the property?');
  await g.getByRole('group', { name: 'Was contact refused?' }).getByRole('button', { name: 'No' }).click();
  await yes('Is the property accessible?');
  await yes('Does the physical address match the description?');
  await yes('Does the building exist at the pin?');
  await g.getByRole('group', { name: 'Signs of occupation?' }).getByRole('button', { name: 'Occupied' }).click();
  await yes('House number visible?');
  await shot(g, '09-agent-visit');
  await g.getByRole('button', { name: 'Submit visit' }).click();
  await g.getByText('Visit submitted').waitFor({ timeout: 20000 });
  log('visit submitted');
  await g.waitForTimeout(3000);
  log('final status', psql(`select status||' / '||coalesce(outcome::text,'-') from "VerificationRequest" where id='${requestId}'`));

  // 4. Applicant sees the report; institution sees findings; admin sees overview.
  await a.reload();
  await a.getByRole('heading', { name: 'Report' }).waitFor({ timeout: 20000 });
  await shot(a, '10-applicant-report');
  await b.goto(`http://localhost:3002/requests/${requestId}`);
  await b.getByText('Field findings').waitFor();
  await shot(b, '11-business-request-detail');
  const adm = await browser.newContext(desktop);
  const d = await adm.newPage();
  watch(d, 'admin');
  await d.goto('http://localhost:3003/sign-in');
  await d.getByLabel('Email').fill('super@avn.local');
  await d.getByLabel('Password').fill('AvnDemo2026!');
  await d.getByRole('button', { name: 'Sign in' }).click();
  await d.waitForURL('**/dashboard');
  await d.getByText('Platform overview').waitFor();
  await shot(d, '12-admin-overview');
  await d.goto('http://localhost:3003/reviews');
  await d.waitForTimeout(1500);
  await shot(d, '13-admin-reviews');
  // Marketing home on mobile.
  const m = await phone.newPage();
  await m.goto('http://localhost:3000/');
  await shot(m, '14-marketing-mobile');
  console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'No page errors');
  await browser.close();
})().catch(async (e) => {
  console.error('E2E FAILED:', e.message);
  for (const [t, pg] of global.__pages || []) await pg.screenshot({ path: `${OUT}/FAIL-${t}.png`, fullPage: true }).catch(() => {});
  process.exit(1);
});
