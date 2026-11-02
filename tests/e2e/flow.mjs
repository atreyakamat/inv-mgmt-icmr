// End-to-end run against the offline Docker stack. Every role signs in and does its part.
// Usage: docker compose up -d --build && node tests/e2e/flow.mjs
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const PASS = 'Inventory-Demo-2026';
const OUT = process.env.E2E_OUT || new URL('./artifacts', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const DEMO = 'STOREREGISTERDEMOAUTHENTICATOR22';
const secrets = Object.fromEntries(['admin','super','validator','store','anil','sneha','kevin'].map(k => [k, DEMO]));

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = crypto.createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}


// Screenshots are evidence, not assertions: a capture glitch on a CI runner
// must not fail the run.
async function shot(page, name, opts = {}) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
  } catch (e) {
    console.log(`  (screenshot ${name} skipped: ${e.message.split('\n')[0]})`);
  }
}

const errors = [];
async function signIn(browser, who, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${who}: pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('status of 404')) errors.push(`${who}: console ${m.text()}`); });
  await page.goto(BASE + '/login');
  await page.fill('input[name=email]', `${who}@inventory.local`);
  await page.fill('input[name=password]', opts.password ?? PASS);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/mfa/, { timeout: 15000 });
  if (page.url().includes('/mfa/setup')) {
    await page.click('text=Can\'t scan? Show the key');
    const secret = (await page.textContent('code')).trim();
    secrets[who] = secret;
    if (opts.shotSetup) await shot(page, 'mfa-setup');
    await page.locator('input[name=code]').fill(totp(secret));
  } else {
    if (opts.shotVerify) await shot(page, 'mfa-verify');
    await page.locator('input[name=code]').fill(totp(secrets[who]));
  }
  await page.waitForURL(BASE + '/', { timeout: 15000 });
  await handleTour(page, who, opts.tour ?? 'skip');
  return { ctx, page };
}

// First sign-in shows the guided tour; later sign-ins must not.
async function handleTour(page, who, mode) {
  const tour = page.locator('[data-testid=tour]');
  const shown = await tour.waitFor({ timeout: 4000 }).then(() => true, () => false);
  if (mode === 'none') {
    if (shown) throw new Error(`${who}: tour shown again after it was finished`);
    return;
  }
  if (!shown) throw new Error(`${who}: tour did not start on first sign-in`);
  if (mode === 'skip') {
    await tour.locator('button:has-text("Skip tour")').click();
    await tour.waitFor({ state: 'detached' });
    return;
  }
  // walk through every step
  const total = Number((await tour.locator('text=/\\d+ of \\d+/').innerText()).split(' of ')[1]);
  for (let i = 1; i <= total; i++) {
    await tour.locator(`text=${i} of ${total}`).waitFor();
    if (i === 1 || i === 3 || i === total) { await page.waitForTimeout(450); await shot(page, `tour-${who}-${i}`); }
    await tour.locator(`button:has-text("${i === 1 ? 'Start' : i === total ? 'Finish' : 'Next'}")`).click();
  }
  await tour.waitFor({ state: 'detached' });
  return total;
}

const step = (msg) => console.log('✓', msg);

(async () => {
  const browser = await chromium.launch();

  // ---------------- login page
  {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(BASE + '/');
    await shot(p, '01-login');
    await p.click('aside button:has-text("Store Manager")');
    if ((await p.inputValue('input[name=email]')) !== 'store@inventory.local') throw new Error('demo fill failed');
    step('demo panel fills the sign-in form');
    await p.fill('input[name=email]', 'store@inventory.local');
    await p.fill('input[name=password]', 'wrong-password-123');
    await p.click('button[type=submit]');
    await p.waitForSelector('text=Email or password is incorrect');
    step('wrong password rejected');
    await p.close();
  }

  // ---------------- store manager
  const store = await signIn(browser, 'store', { shotVerify: true, tour: 'walk' });
  step('store manager signed in and walked through the role tour');
  await shot(store.page, '02-overview-store');
  await store.page.goto(BASE + '/inventory');
  await shot(store.page, '03-inventory', { fullPage: true });
  await store.page.goto(BASE + '/catalog');
  await shot(store.page, '04-catalog');
  await store.page.goto(BASE + '/stock');
  await shot(store.page, '05-stock');
  // receive a delivery on its own page: one known item + one brand-new item
  const deliveryRef = `E2E invoice ${Date.now().toString(36).toUpperCase()}`;
  const newItemName = `Parafilm roll ${Date.now().toString(36).toUpperCase()}`;
  await store.page.goto(BASE + '/stock/receive');
  const receiveText = await store.page.locator('main').innerText();
  if (/in stock/i.test(receiveText)) throw new Error('receive page should not show current stock');
  await store.page.selectOption('main select >> nth=0', { label: 'Main store' });
  await store.page.fill('input[placeholder^="e.g. Invoice"]', deliveryRef);
  await store.page.fill('input[aria-label="Item for line 1"]', 'Nitrile gloves (M)');
  await store.page.fill('input[aria-label="Quantity for line 1"]', '25');
  await store.page.click('button:has-text("Add another item")');
  await store.page.fill('input[aria-label="Item for line 2"]', newItemName);
  await store.page.selectOption('select[aria-label="Category for new item on line 2"]', { label: 'Lab consumables' });
  await store.page.fill('input[aria-label="Unit for new item on line 2"]', 'roll');
  await store.page.fill('input[aria-label="Quantity for line 2"]', '3');
  await shot(store.page, '05a-receive-form');
  await store.page.click('button:has-text("Receive delivery")');
  await store.page.waitForSelector('text=Delivery recorded');
  await store.page.waitForSelector('text=added to catalog');
  await shot(store.page, '05b-received');
  step('store manager received a 2-line delivery, adding a new item on the way');
  await store.page.goto(BASE + '/stock?q=' + encodeURIComponent(newItemName));
  await store.page.waitForSelector(`text=${deliveryRef}`);
  await shot(store.page, '05c-ledger');
  step('delivery appears in the stock movements ledger');
  await store.page.goto(BASE + '/stock/adjust');
  await store.page.selectOption('section:has-text("Correct a count") select[name=item_id]', { label: 'Nitrile gloves (M) [GLV-M] (box)' });
  await store.page.selectOption('section:has-text("Correct a count") select[name=location_id]', { label: 'Main store' });
  await store.page.fill('input[name=delta]', '-1');
  await store.page.fill('section:has-text("Correct a count") textarea[name=note]', 'E2E: one box torn');
  await store.page.click('button:has-text("Record correction")');
  await store.page.waitForSelector('text=Adjusted by -1.');
  step('store manager recorded a count correction');
  // add a catalog item
  await store.page.goto(BASE + '/catalog?tab=items');
  const runTag = Date.now().toString(36).toUpperCase();
  await store.page.fill('input[name=name]', `Parafilm roll ${runTag}`);
  await store.page.fill('input[name=sku]', `PARAFILM-${runTag}`);
  await store.page.selectOption('select[name=category_id]', { label: 'Lab consumables' });
  await store.page.fill('input[name=unit]', 'roll');
  await store.page.click('button:has-text("Add item")');
  await store.page.waitForSelector('text=Added.');
  step('store manager added a catalog item');
  // hand over an approved request
  await store.page.goto(BASE + '/hand-over');
  await shot(store.page, '06-hand-over-queue');
  const firstApproved = store.page.locator('table.register tbody tr td a').first();
  const handId = (await firstApproved.textContent()).trim();
  await firstApproved.click();
  await store.page.waitForURL(/\/requests\/\d+/);
  await store.page.click('button:has-text("Mark handed over")');
  await store.page.waitForSelector('.stamp:has-text("Handed over")');
  await shot(store.page, '07-request-handed-over');
  step(`store manager handed over request #${handId}`);
  // can't see admin / people
  await store.page.goto(BASE + '/people');
  if (!store.page.url().endsWith('/')) throw new Error('store manager reached /people');
  step('store manager bounced from People');
  await store.page.goto(BASE + '/requests/999999');
  await store.page.waitForSelector('h1:has-text("Not found")');
  step('unknown request shows the not-found page');
  const health = await fetch(BASE + '/api/health');
  if (health.status !== 200 || !(await health.json()).ok) throw new Error('health endpoint not ok');
  step('health endpoint reachable without signing in');

  // ---------------- validator reviews a submitted request
  const val = await signIn(browser, 'validator');
  await val.page.goto(BASE + '/review');
  await shot(val.page, '08-review-queue');
  await val.page.locator('table.register tbody tr td a').first().click();
  await val.page.waitForURL(/\/requests\/\d+/);
  const reviewedUrl = val.page.url();
  await val.page.fill('textarea[name=note]', 'Needed for the culture run, quantities fine');
  await val.page.click('button:has-text("Send to approver as recommended")');
  await val.page.waitForSelector('.stamp:has-text("Recommended")');
  step('validator recommended ' + reviewedUrl.split('/').pop());

  // ---------------- super user approves with a modified quantity
  const sup = await signIn(browser, 'super');
  await sup.page.goto(reviewedUrl);
  const qtyInputs = sup.page.locator('input[name^="approved["]');
  const first = await qtyInputs.first().inputValue();
  await qtyInputs.first().fill(String(Math.max(1, Number(first) - 1)));
  await sup.page.fill('textarea[name=note]', 'Trimmed by one');
  await shot(sup.page, '09-approve-panel');
  await sup.page.click('button:has-text("Approve and send to store")');
  await sup.page.waitForSelector('.stamp:has-text("Approved")');
  await shot(sup.page, '10-request-approved');
  step('super user approved with a modified quantity');
  await sup.page.goto(BASE + '/people');
  const supSeesAdmin = await sup.page.locator('text=admin@inventory.local').count();
  step(`super user sees hidden admin in People: ${supSeesAdmin > 0}`);
  // audit log: seal, sign-ins, filters, CSV
  await sup.page.goto(BASE + '/audit');
  await sup.page.click('button:has-text("Check the seal")');
  await sup.page.waitForSelector('text=/Intact: all [\\d,]+ entries match their seal/');
  await shot(sup.page, '16a-audit-sealed');
  step('super user reads the audit log and the seal is intact');
  await sup.page.click('nav[aria-label="Kind of entry"] >> text=Sign-ins');
  await sup.page.waitForSelector('td:has-text("Signed in")');
  await shot(sup.page, '16b-audit-signins');
  step('sign-ins are recorded with device');
  await sup.page.click('nav[aria-label="Kind of entry"] >> text=Direct database edits');
  // a fresh stack has seed rows written straight to the database; an upgraded one may have none yet
  await sup.page.waitForSelector('text=/Directly in the database as|Nothing matches these filters/');
  step('changes made outside the app have their own view');
  await sup.page.goto(BASE + '/audit?item=' + encodeURIComponent('Nitrile gloves (M)'));
  await sup.page.waitForSelector('text=E2E: one box torn');
  step('audit filters by item');
  const csv = await sup.page.request.get(BASE + '/audit/export?view=signins');
  const csvText = await csv.text();
  if (csv.status() !== 200 || !csvText.includes('"Entry","When (IST)"') || !csvText.includes('Signed in')) throw new Error('CSV export failed: ' + csv.status());
  step('audit CSV export downloads');

  // ---------------- user raises a request
  const anil = await signIn(browser, 'anil');
  await anil.page.goto(BASE + '/requests/new');
  await anil.page.fill('input[aria-label="Quantity of Pipette tips 200 µl"]', '2');
  await anil.page.fill('input[aria-label="Quantity of Lab notebook A4"]', '1');
  await anil.page.selectOption('select[name=location_id]', { label: 'Main store' });
  await anil.page.fill('textarea[name=purpose]', 'ELISA plates for Thursday');
  await shot(anil.page, '11-new-request');
  await anil.page.click('button:has-text("Submit request")');
  await anil.page.waitForURL(/\/requests\/\d+\?submitted=1/);
  await anil.page.waitForTimeout(500);
  await shot(anil.page, '12-request-submitted');
  step('user submitted a request');
  const navText = await anil.page.locator('nav[aria-label=Main]').innerText();
  if (/Approve|People|Catalog|Audit|Review|Hand over/.test(navText) || !/My items/.test(navText)) throw new Error('user nav shows privileged items: ' + navText);
  step('user nav shows only their own sections');
  await anil.page.goto(BASE + '/my-items');
  await anil.page.waitForSelector('text=units of');
  const myRows = await anil.page.locator('table.register tbody tr').count();
  if (myRows === 0) throw new Error('My items shows no rows for a user with handed-over requests');
  await shot(anil.page, '12b-my-items', { fullPage: true });
  step(`user sees what the store handed them (${myRows} items)`);
  const peopleNames = await anil.page.goto(BASE + '/requests').then(() => anil.page.content());
  if (peopleNames.includes('Atreya Kamat')) throw new Error('user sees admin name somewhere on requests');
  // guide shows only what a user can do
  await anil.page.goto(BASE + '/guide');
  const topics = await anil.page.locator('main section h2').allInnerTexts();
  const guide = await anil.page.locator('main').innerText();
  if (!topics.includes('Raising a request') || topics.some((t) => ['Accounts', 'The audit log', 'Receiving a delivery', 'Approving requests'].includes(t)) || /\bAdmin\b/.test(guide)) {
    throw new Error('user guide shows the wrong sections: ' + topics.join(', '));
  }
  await shot(anil.page, '12c-guide', { fullPage: true });
  step('user guide covers only their own tasks');
  const csvDenied = await anil.page.request.get(BASE + '/audit/export');
  if (csvDenied.status() !== 403) throw new Error('user could download the audit log');
  step('user cannot download the audit log');

  // ---------------- admin: invite a new person, roles, audit
  const adm = await signIn(browser, 'admin');
  await shot(adm.page, '13-overview-admin');
  await adm.page.goto(BASE + '/people');
  const inviteEmail = `neha.${Date.now().toString(36)}@inventory.local`;
  await adm.page.fill('input[name=full_name]', 'Neha Parab');
  await adm.page.fill('input[name=email]', inviteEmail);
  await adm.page.selectOption('select[name=role_id]', { label: 'User' });
  await adm.page.click('button:has-text("Create account and send invite")');
  await adm.page.waitForSelector(`text=Invite sent to ${inviteEmail}`);
  await shot(adm.page, '14-people');
  step('admin created an account and sent an invite');
  await adm.page.goto(BASE + '/roles');
  await shot(adm.page, '15-roles', { fullPage: true });
  await adm.page.goto(BASE + '/audit');
  await shot(adm.page, '16-audit');
  step('admin opened roles and audit');

  // ---------------- the invite email -> set password -> MFA
  const msgs = await (await fetch((process.env.E2E_MAIL_URL || 'http://localhost:8025') + '/api/v1/messages')).json();
  const invite = msgs.messages.find((m) => m.To.some((t) => t.Address === inviteEmail));
  const body = await (await fetch(`${process.env.E2E_MAIL_URL || 'http://localhost:8025'}/api/v1/message/${invite.ID}`)).json();
  const link = body.HTML.match(/href="([^"]+verify[^"]+)"/)[1].replace(/&amp;/g, '&');
  const nctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const np = await nctx.newPage();
  np.on('pageerror', (e) => errors.push(`neha: pageerror ${e.message}`));
  await np.goto(link);
  await np.waitForURL(/\/auth\/set-password/, { timeout: 15000 });
  await shot(np, '17-set-password');
  await np.fill('input[name=password]', 'Neha-Strong-Pass-2026');
  await np.fill('input[name=confirm]', 'Neha-Strong-Pass-2026');
  await np.click('button:has-text("Save password and continue")');
  await np.waitForURL(/\/mfa\/setup/, { timeout: 15000 });
  await np.click('text=Can\'t scan? Show the key');
  const nsecret = (await np.textContent('code')).trim();
  await np.locator('input[name=code]').fill(totp(nsecret));
  await np.waitForURL(BASE + '/', { timeout: 15000 });
  step('invited person: email link -> set password -> MFA -> dashboard');

  // ---------------- returning user sees the code screen
  await store.ctx.clearCookies();
  const again = await signIn(browser, 'store', { shotVerify: true, tour: 'none' });
  step('returning user prompted for a code and signed in');

  // mobile
  await again.page.setViewportSize({ width: 390, height: 844 });
  await again.page.goto(BASE + '/');
  await shot(again.page, '18-mobile');
  await again.page.goto(BASE + '/guide');
  await again.page.click('button:has-text("Replay the tour")');
  const mtour = again.page.locator('[data-testid=tour]');
  await mtour.locator('button:has-text("Start")').click();
  await mtour.locator('text=/^2 of/').waitFor();
  await again.page.waitForTimeout(400);
  await shot(again.page, '19-mobile-tour');
  await mtour.locator('button:has-text("Skip tour")').click();
  step('tour replays from the Guide on a phone');

  await browser.close();
  console.log('\nbrowser errors:', errors.length ? '\n  ' + errors.join('\n  ') : 'none');
  if (errors.length) process.exit(1);
  console.log('ALL E2E CHECKS PASSED');
})().catch(async (e) => { console.error('FAILED:', e.message); console.log('errors so far:', errors); process.exit(1); });
