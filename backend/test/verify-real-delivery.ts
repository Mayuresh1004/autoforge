/**
 * Real End-to-End Runtime Verification Script for AMASS Autonomous Pipeline & GitHub PR Delivery.
 *
 * Verifies real end-to-end execution against https://github.com/Mayuresh1004/owasp-vuln-lab.git:
 *   1. Real Runtime Sandbox Provisioning
 *   2. Real Scout Recon
 *   3. Real Planner
 *   4. Real Sniper Verification (Confirmed SQLi)
 *   5. Real Engineer Remediation Patch Generation (GENERATED)
 *   6. Real Critic Validation (APPROVED)
 *   7. Real Remediation Delivery & GitHub PR Creation (REMEDIATION_PR_CREATED)
 *   8. External GitHub REST API Verification of created PR
 *   9. Post-run integrity & security assertions
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
import type { AmassEvent } from '../src/observability/domain/events/amass-event';

const REPO_URL = 'https://github.com/Mayuresh1004/owasp-vuln-lab.git';
const SCAN_ID = `scan_real_pr_${Date.now()}`;

async function runVerification() {
  console.log(`=================================================================`);
  console.log(`🚀 STARTING REAL AUTONOMOUS PIPELINE RUN: ${SCAN_ID}`);
  console.log(`Target Repo: ${REPO_URL}`);
  console.log(`=================================================================\n`);

  if (!process.env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is missing from environment. Real verification requires a configured GITHUB_TOKEN.');
  }

  // 1. Initialize App Infrastructure
  const app = createApplicationInfrastructure({ db: prisma });

  app.events.bus.subscribe(SCAN_ID, (evt) => {
    const level = evt.level === 'ERROR' ? '❌' : evt.level === 'WARN' ? '⚠️' : 'ℹ️';
    console.log(`[EVENT ${evt.sequence}] ${level} [${evt.phase.toUpperCase()}] ${evt.eventType}: ${evt.message}`);
  });

  // 2. Prepare Database Records
  const repoRecord = await prisma.repository.upsert({
    where: { url_branch: { url: REPO_URL, branch: 'main' } },
    update: { name: 'owasp-vuln-lab' },
    create: { url: REPO_URL, name: 'owasp-vuln-lab', branch: 'main' },
  });

  const scanRecord = await prisma.scan.create({
    data: {
      id: SCAN_ID,
      name: `Real PR Remediation Scan ${SCAN_ID}`,
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

  console.log(`✓ Scan record created in Postgres: ${scanRecord.id}`);

  // 3. Execute Autonomous Pipeline
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

  // 4. Inspect Database State & Results
  console.log(`\n=================================================================`);
  console.log(`🔍 VERIFYING DATABASE PERSISTENCE & RESULTS`);
  console.log(`=================================================================\n`);

  const updatedScan = await prisma.scan.findUnique({ where: { id: SCAN_ID } });
  console.log(`Scan Status: ${updatedScan?.status}`);
  if (updatedScan?.status !== 'COMPLETED') {
    throw new Error(`Expected Scan.status to be COMPLETED, got ${updatedScan?.status}`);
  }

  const vulnerabilities = await prisma.vulnerability.findMany({
    where: { scanId: SCAN_ID },
    include: {
      patches: { orderBy: { createdAt: 'desc' } },
      exploits: true,
    },
  });

  console.log(`Found ${vulnerabilities.length} vulnerabilities in scan`);

  const confirmedVulns = vulnerabilities.filter((v) => v.status === 'CONFIRMED');
  console.log(`Confirmed Vulnerabilities: ${confirmedVulns.length}`);

  if (vulnerabilities.length === 0) {
    throw new Error('No vulnerabilities were created during scan');
  }

  // Check that Vulnerability.status is NOT changed to PATCHED
  for (const v of vulnerabilities) {
    console.log(`- Vuln [${v.id}]: title="${v.title}", status="${v.status}"`);
    if (v.status === 'PATCHED') {
      throw new Error(`Vulnerability ${v.id} status was changed to PATCHED, expected CONFIRMED or DETECTED`);
    }
  }

  const patches = await prisma.patch.findMany({
    where: { vulnerability: { scanId: SCAN_ID } },
  });

  console.log(`Found ${patches.length} patch(es) in database:`);
  for (const p of patches) {
    console.log(JSON.stringify({
      id: p.id,
      status: p.status,
      filePath: p.filePath,
      prNumber: p.prNumber,
      prUrl: p.prUrl,
      prBranch: p.prBranch,
      prCommitSha: p.prCommitSha,
      prStatus: p.prStatus,
      prDeliveredAt: p.prDeliveredAt,
      prError: p.prError,
    }, null, 2));
  }

  if (patches.length === 0) {
    throw new Error('No patches were generated during autonomous pipeline run');
  }

  const deliveredPatch = patches.find((p) => p.prNumber !== null && p.prUrl !== null);
  if (!deliveredPatch) {
    throw new Error('No patch reached DELIVERED state with valid prNumber and prUrl');
  }

  // Assertion: Patch.status remains APPROVED
  if (deliveredPatch.status !== 'APPROVED') {
    throw new Error(`Expected delivered Patch.status to remain APPROVED, got '${deliveredPatch.status}'`);
  }

  console.log(`\n✓ Delivered Patch verified in DB:`);
  console.log(`  - Patch ID: ${deliveredPatch.id}`);
  console.log(`  - Status: ${deliveredPatch.status}`);
  console.log(`  - PR Number: #${deliveredPatch.prNumber}`);
  console.log(`  - PR URL: ${deliveredPatch.prUrl}`);
  console.log(`  - PR Branch: ${deliveredPatch.prBranch}`);
  console.log(`  - Commit SHA: ${deliveredPatch.prCommitSha}`);
  console.log(`  - PR Status: ${deliveredPatch.prStatus}`);

  // 5. External GitHub REST API Verification
  console.log(`\n=================================================================`);
  console.log(`🌐 VERIFYING PR EXTERNALLY AGAINST GITHUB REST API`);
  console.log(`=================================================================\n`);

  const ghApiUrl = `https://api.github.com/repos/Mayuresh1004/owasp-vuln-lab/pulls/${deliveredPatch.prNumber}`;
  const ghResponse = await fetch(ghApiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'AMASS-Verification-Runner',
    },
  });

  if (!ghResponse.ok) {
    const errBody = await ghResponse.text().catch(() => '');
    throw new Error(`GitHub API returned ${ghResponse.status} for PR #${deliveredPatch.prNumber}: ${errBody}`);
  }

  const prData = (await ghResponse.json()) as {
    number: number;
    html_url: string;
    state: string;
    merged: boolean;
    head: { ref: string; sha: string };
    base: { ref: string };
    title: string;
  };

  console.log(`GitHub API Response for PR #${prData.number}:`);
  console.log(`  - Title: "${prData.title}"`);
  console.log(`  - State: ${prData.state}`);
  console.log(`  - Head Ref: ${prData.head.ref}`);
  console.log(`  - Base Ref: ${prData.base.ref}`);
  console.log(`  - Merged: ${prData.merged}`);
  console.log(`  - HTML URL: ${prData.html_url}`);

  if (prData.number !== deliveredPatch.prNumber) {
    throw new Error(`GitHub PR number mismatch: API gave ${prData.number}, DB has ${deliveredPatch.prNumber}`);
  }
  if (prData.head.ref !== deliveredPatch.prBranch) {
    throw new Error(`GitHub PR branch mismatch: API gave ${prData.head.ref}, DB has ${deliveredPatch.prBranch}`);
  }
  if (prData.merged) {
    throw new Error(`PR #${prData.number} was automatically merged, expected unmerged / OPEN`);
  }
  if (prData.base.ref !== 'main') {
    throw new Error(`PR base ref is ${prData.base.ref}, expected main`);
  }

  console.log(`\n✓ GitHub API External Verification PASSED!`);

  // 6. Security & Secret Leaks Audit
  console.log(`\n=================================================================`);
  console.log(`🔒 SECURITY & LOG AUDIT VERIFICATION`);
  console.log(`=================================================================\n`);

  const capturedEvents = app.events.bus.replay(SCAN_ID, 0);
  const token = process.env.GITHUB_TOKEN;
  let tokenLeaked = false;

  for (const evt of capturedEvents) {
    if (token && evt.message.includes(token)) {
      tokenLeaked = true;
      console.error(`❌ SECRET LEAK DETECTED in event ${evt.eventId} message!`);
    }
    if (evt.metadata && JSON.stringify(evt.metadata).includes(token)) {
      tokenLeaked = true;
      console.error(`❌ SECRET LEAK DETECTED in event ${evt.eventId} metadata!`);
    }
  }

  if (tokenLeaked) {
    throw new Error('SECURITY VIOLATION: GITHUB_TOKEN was found unredacted in event logs!');
  }
  console.log(`✓ GITHUB_TOKEN secret redaction verified (no leaks found in logs/events).`);

  // 7. Event Sequence Verification
  console.log(`\n=================================================================`);
  console.log(`📋 EVENT SEQUENCE VERIFICATION`);
  console.log(`=================================================================\n`);

  const eventTypes = capturedEvents.map((e) => e.eventType);
  console.log('All Captured Event Types:', JSON.stringify(eventTypes, null, 2));

  const requiredSequence = [
    'CRITIC_STARTED',
    'CRITIC_APPROVED',
    'REMEDIATION_PR_CREATED',
  ];

  for (const reqType of requiredSequence) {
    const found = eventTypes.includes(reqType as any);
    console.log(`  [${found ? '✓' : '❌'}] ${reqType}`);
    if (!found) {
      throw new Error(`Required event '${reqType}' was not emitted in pipeline sequence`);
    }
  }

  const prEvent = capturedEvents.find((e) => e.eventType === 'REMEDIATION_PR_CREATED');
  console.log(`\nREMEDIATION_PR_CREATED Event Metadata:`, JSON.stringify(prEvent?.metadata, null, 2));

  if (prEvent?.metadata?.prNumber !== deliveredPatch.prNumber) {
    throw new Error('REMEDIATION_PR_CREATED event metadata prNumber does not match database patch prNumber');
  }

  console.log(`\n=================================================================`);
  console.log(`🎉 ALL REAL VERIFICATION CHECKS PASSED SUCCESSFULLY!`);
  console.log(`REAL GitHub PR Created & Verified: ${deliveredPatch.prUrl}`);
  console.log(`=================================================================\n`);

  process.exit(0);
}

runVerification().catch((err) => {
  console.error('\n❌ VERIFICATION FAILED:', err);
  process.exit(1);
});
