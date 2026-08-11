import puppeteer from 'puppeteer';
import path from 'path';

const ARTIFACT_DIR = '/home/mayuresh/.gemini/antigravity/brain/b83d93fe-c523-485e-8d64-6d998e1c3ff6';

async function capture() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  console.log('Navigating to AMASS Security Console at http://localhost:5176 ...');
  await page.goto('http://localhost:5176', { waitUntil: 'networkidle0' });

  console.log('Opening + New Scan modal...');
  await page.waitForSelector('button');
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const text = await page.evaluate((el) => el.textContent, btn);
    if (text && text.includes('New Scan')) {
      await btn.click();
      break;
    }
  }

  await new Promise((r) => setTimeout(r, 800));

  console.log('Submitting Run Autonomous Scan...');
  const modalButtons = await page.$$('button');
  for (const btn of modalButtons) {
    const text = await page.evaluate((el) => el.textContent, btn);
    if (text && text.includes('Run Autonomous Scan')) {
      await btn.click();
      break;
    }
  }

  // 1. ~1 Second (Analyzer Phase)
  console.log('Waiting 1.5s (Analyzer phase)...');
  await new Promise((r) => setTimeout(r, 1500));
  const step1 = path.join(ARTIFACT_DIR, 'step1_analyzer_1s.png');
  await page.screenshot({ path: step1, fullPage: false });
  console.log(`Saved Step 1 screenshot: ${step1}`);

  // 2. ~28 Seconds (Scanner Phase Complete)
  console.log('Waiting 26.5s additional (Scanner phase complete)...');
  await new Promise((r) => setTimeout(r, 26500));
  const step2 = path.join(ARTIFACT_DIR, 'step2_scanner_done_28s.png');
  await page.screenshot({ path: step2, fullPage: false });
  console.log(`Saved Step 2 screenshot: ${step2}`);

  // 3. ~82 Seconds (Planner Phase Complete)
  console.log('Waiting 54s additional (Planner phase complete)...');
  await new Promise((r) => setTimeout(r, 54000));
  const step3 = path.join(ARTIFACT_DIR, 'step3_planner_done_82s.png');
  await page.screenshot({ path: step3, fullPage: false });
  console.log(`Saved Step 3 screenshot: ${step3}`);

  // 4. ~105 Seconds (Sniper Phase Complete & Exploit Confirmed)
  console.log('Waiting 23s additional (Sniper phase complete)...');
  await new Promise((r) => setTimeout(r, 23000));
  const step4 = path.join(ARTIFACT_DIR, 'step4_sniper_done_105s.png');
  await page.screenshot({ path: step4, fullPage: false });
  console.log(`Saved Step 4 screenshot: ${step4}`);

  await browser.close();
}

capture().catch(console.error);
