'use strict';
// Drives the intake page end to end with headless Chromium and reports what it saw.
const { chromium } = require('/Users/propai/nuhai/node_modules/playwright');
const OUT = '/private/tmp/claude-501/-Users-propai/17b96ef5-0cfa-4f57-b023-79eafcee0e64/scratchpad';
const URL = 'http://localhost:8765/';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(URL, { waitUntil: 'networkidle' });
  const log = (...a) => console.log(...a);
  log('title:', await page.title());
  log('banner visible:', await page.isVisible('#notConnected'));
  log('toc items:', await page.locator('#toc li').count());
  await page.screenshot({ path: OUT + '/01-welcome.png', fullPage: true });

  await page.click('#startBtn');
  log('section title:', await page.textContent('#secTitle'));
  log('crumb:', await page.textContent('#crumb'));
  log('questions in s1:', await page.locator('#qs .q').count());
  await page.waitForTimeout(600); await page.screenshot({ path: OUT + "/02-section1.png", fullPage: true });

  // Validation: Continue with nothing filled → required questions flagged, first one scrolled to.
  await page.click('#nextBtn');
  const missing = await page.locator('.q.missing').count();
  log('missing after empty continue:', missing, '| still section:', await page.textContent('#secTitle'));

  // Fill section 1 required fields.
  await page.fill('#f-full_name', 'Joanna Test');
  await page.fill('#f-email', 'not-an-email');
  await page.fill('#f-phone', '+971501234567');
  await page.fill('#f-nationality', 'Lebanese');
  await page.click('#f-uae_status .pill >> nth=1');
  await page.fill('#f-why_this', 'It started in a hotel bathroom in Kyoto.');
  await page.click('#nextBtn');
  log('bad email blocks continue:', (await page.locator('#q-email.missing').count()) === 1);
  await page.fill('#f-email', 'joanna@jorituel.com');
  await page.click('#nextBtn');
  log('now on:', await page.textContent('#secTitle'));

  // Section 2: multi with max 3 → 4th pill disabled.
  await page.fill('#f-business_in_own_words', 'A scented shower filter brand.');
  const prio = page.locator('#f-priorities .pill');
  await prio.nth(0).click(); await prio.nth(1).click(); await prio.nth(2).click();
  log('4th priority pill disabled (off):', await prio.nth(3).evaluate(el => el.classList.contains('off')));
  await prio.nth(1).click(); // deselect → re-enabled
  log('after deselect, 4th re-enabled:', !(await prio.nth(3).evaluate(el => el.classList.contains('off'))));
  await prio.nth(3).click();
  await page.fill('#f-what_makes_different', 'Real perfume, not a clinical filter.');
  // "Other" text satisfies required? (competitors_seen not required, just check it saves)
  await page.fill('#q-competitors_seen .other input', 'A Korean brand on TikTok');
  await page.click('#nextBtn');
  log('now on:', await page.textContent('#secTitle'));

  // Reload mid-way → restored to same section with values intact.
  await page.reload({ waitUntil: 'networkidle' });
  log('start button after reload:', await page.textContent('#startBtn'));
  await page.click('#startBtn');
  log('restored section:', await page.textContent('#secTitle'));
  await page.click('#backBtn');
  log('back to:', await page.textContent('#secTitle'));
  log('restored value:', await page.inputValue('#f-business_in_own_words'));
  log('restored pills on:', await page.locator('#f-priorities .pill.on').count());
  log('restored other:', await page.inputValue('#q-competitors_seen .other input'));
  await page.click('#nextBtn');

  // Walk remaining sections filling only required questions.
  const req = {
    product: async () => { await page.fill('#f-product_description', 'Inline filter with a scent capsule.'); await page.click('#f-samples_status .pill >> nth=0'); },
    phases: async () => {},
    customer: async () => { await page.fill('#f-customer_description', 'Sara, 34, villa in Dubai.'); },
    market: async () => { await page.click('#f-first_channels .pill >> nth=0'); await page.click('#f-first_channels .pill >> nth=2'); },
    brand: async () => { await page.fill('#f-name_story', 'Jo + rituel, a daily ritual.'); await page.fill('#f-personality_words', 'calm, sensual, precise'); },
    legal: async () => { await page.click('#f-licence_status .pill >> nth=0'); },
    money: async () => { await page.click('#f-launch_budget .pill >> nth=2'); },
    together: async () => { await page.click('#f-involvement .pill >> nth=1'); },
    links: async () => { await page.fill('#f-link_moodboard', 'https://pinterest.com/joanna/board'); },
  };
  for (const id of Object.keys(req)) {
    const title = await page.textContent('#secTitle');
    await req[id]();
    await page.click('#nextBtn');
    const next = await page.textContent('#secTitle');
    log(`section ${id} (${title.trim()}) → next: ${next.trim()} | screen review visible: ${await page.isVisible('#s-review')}`);
  }
  await page.waitForTimeout(600); await page.screenshot({ path: OUT + "/03-review.png", fullPage: true });
  log('review blocks:', await page.locator('#review .rev').count(), '| skipped blocks:', await page.locator('#review .empty').count());
  log('review shows other:', (await page.textContent('#review')).includes('Other: A Korean brand on TikTok'));

  // Payload shape.
  const p = await page.evaluate(() => payload());
  log('payload keys:', Object.keys(p).join(','));
  log('answers count:', Object.keys(p.answers).length, '| schema count:', p.schema.length, '| same order:', Object.keys(p.answers).join() === p.schema.map(s => s.key).join());
  log('priorities:', JSON.stringify(p.answers.priorities), '| competitors_seen_other:', p.answers.competitors_seen_other);
  log('bytes:', JSON.stringify(p).length);

  // Edit from review → jumps to that section, then back to review.
  await page.click('#review [data-edit="6"]');
  log('edit jumps to:', await page.textContent('#secTitle'));
  await page.click('#nextBtn'); await page.click('#nextBtn'); await page.click('#nextBtn'); await page.click('#nextBtn'); await page.click('#nextBtn');
  log('back on review:', await page.isVisible('#s-review'));

  // Send (ENDPOINT '' → test mode).
  await page.click('#sendBtn');
  await page.waitForSelector('#s-done.on');
  log('done title:', await page.textContent('#doneTitle'), '|', await page.textContent('#doneCopy'));
  await page.screenshot({ path: OUT + '/04-done.png', fullPage: true });
  await page.reload({ waitUntil: 'networkidle' });
  log('after reload, start button:', await page.textContent('#startBtn'));
  await page.click('#startBtn');
  log('submitted → start goes to review:', await page.isVisible('#s-review'), '| send label:', await page.textContent('#sendBtn'));

  // Mobile pass.
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  await mp.goto(URL, { waitUntil: 'networkidle' });
  await mp.screenshot({ path: OUT + '/05-mobile-welcome.png', fullPage: true });
  await mp.click('#startBtn');
  await mp.waitForTimeout(600); await mp.screenshot({ path: OUT + "/06-mobile-section.png", fullPage: false });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  log('mobile horizontal overflow:', overflow);

  log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error('WALK FAILED:', e); process.exit(1); });
