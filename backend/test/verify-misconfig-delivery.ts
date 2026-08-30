/**
 * Real E2E Verification Script for SECURITY_MISCONFIGURATION Remediation & PR Delivery.
 */

import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

process.env.LLM_MAX_RETRIES = '5';
process.env.EMBEDDING_PROVIDER = 'noop';
process.env.GEMINI_MODEL = 'gemini-3.6-flash';

import { prisma } from '../src/config/database';
import { createApplicationInfrastructure } from '../src/application/application-root';

const REPO_URL = 'https://github.com/Mayuresh1004/owasp-vuln-lab.git';
const SCAN_ID = `scan_misconfig_pr_${Date.now()}`;

async function runMisconfigVerification() {
  console.log(`=================================================================`);
  console.log(`🚀 STARTING REAL SECURITY_MISCONFIGURATION PIPELINE RUN: ${SCAN_ID}`);
  console.log(`Target Repo: ${REPO_URL}`);
  console.log(`=================================================================\n`);

  if (!process.env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is missing from environment.');
  }

  const app = createApplicationInfrastructure({ db: prisma });

  app.events.bus.subscribe(SCAN_ID, (evt) => {
    const level = evt.level === 'ERROR' ? '❌' : evt.level === 'WARN' ? '⚠️' : 'ℹ️';
    console.log(`[EVENT ${evt.sequence}] ${level} [${evt.phase.toUpperCase()}] ${evt.eventType}: ${evt.message}`);
  });

  const repoRecord = await prisma.repository.upsert({
    where: { url_branch: { url: REPO_URL, branch: 'main' } },
    update: { name: 'owasp-vuln-lab' },
    create: { url: REPO_URL, name: 'owasp-vuln-lab', branch: 'main' },
  });

  const scanRecord = await prisma.scan.create({
    data: {
      id: SCAN_ID,
      name: `Real Misconfig PR Remediation Scan ${SCAN_ID}`,
      status: 'RUNNING',
      startedAt: new Date(),
    },
  });

  await prisma.scanRepository.create({
    data: {
      scanId: SCAN_ID,
      repositoryId: repoRecord.id,
    },
  });

  // Execute Autonomous Pipeline
  console.log(`\n▶ Invoking AutonomousPipelineService.runPipeline()...\n`);
  const startTime = Date.now();

  try {
    await app.pipeline.runPipeline({
      scanId: SCAN_ID,
      repositoryUrl: REPO_URL,
    });
    console.log(`\n✓ AutonomousPipelineService completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  } catch (error) {
    console.error(`\n❌ AutonomousPipelineService failed:`, error);
    throw error;
  }

  // Inspect patches
  const patches = await prisma.patch.findMany({
    where: { vulnerability: { scanId: SCAN_ID } },
    include: { vulnerability: true },
  });

  console.log(`Found ${patches.length} patch(es) in database:`);
  for (const p of patches) {
    console.log(`- Patch [${p.id}]: vulnType=${p.vulnerability.type}, filePath=${p.filePath}, status=${p.status}, PR #${p.prNumber}`);
  }

  const deliveredPatch = patches.find((p) => p.prNumber !== null && p.prUrl !== null);
  if (!deliveredPatch) {
    throw new Error('No patch reached DELIVERED state with valid prNumber and prUrl');
  }

  console.log(`\n✓ Delivered Patch verified in DB:`);
  console.log(`  - Patch ID: ${deliveredPatch.id}`);
  console.log(`  - Status: ${deliveredPatch.status}`);
  console.log(`  - PR Number: #${deliveredPatch.prNumber}`);
  console.log(`  - PR URL: ${deliveredPatch.prUrl}`);

  // External GitHub REST API Verification
  const ghApiUrl = `https://api.github.com/repos/Mayuresh1004/owasp-vuln-lab/pulls/${deliveredPatch.prNumber}`;
  const ghResponse = await fetch(ghApiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'AMASS-Verification-Runner',
    },
  });

  if (!ghResponse.ok) {
    throw new Error(`GitHub API returned ${ghResponse.status} for PR #${deliveredPatch.prNumber}`);
  }

  const prData = (await ghResponse.json()) as { number: number; html_url: string; state: string };
  console.log(`GitHub API Response for PR #${prData.number}: State=${prData.state}, URL=${prData.html_url}`);

  console.log(`\n🎉 REAL E2E VERIFICATION PASSED!`);
  process.exit(0);
}

runMisconfigVerification().catch((err) => {
  console.error('\n❌ REAL E2E VERIFICATION FAILED:', err);
  process.exit(1);
});
