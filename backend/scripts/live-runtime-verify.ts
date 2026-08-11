/**
 * LIVE runtime-sandbox verification against a real repository
 * (https://github.com/OWASP/NodeGoat.git) with the real Docker backend.
 *
 * Exercises the exact production path that failed with EHOSTUNREACH:
 *   workspace → build → internal-net container → IN-NETWORK health probe → READY
 *
 * NodeGoat is DB-backed (MongoDB) and the sandbox has zero host/external
 * egress, so a sibling MongoDB container is attached to the sandbox's OWN
 * internal network (the architecture's sibling-on-internal-network pattern —
 * the same topology the Sniper E2E uses for its toolbox container). The app
 * reaches it over Docker DNS; it is never reachable from outside the network.
 *
 * Run from backend/:  npx tsx scripts/live-runtime-verify.ts
 * Requires: docker daemon, network access for base-image pulls, git.
 */
import { execFileSync } from 'node:child_process';
import { DockerSandboxBackend } from '../src/sandbox/infrastructure/docker/docker-sandbox-backend';
import { SandboxManagerService } from '../src/sandbox/application/services/sandbox-manager.service';
import { MemorySandboxStore } from '../src/sandbox/infrastructure/store/memory-sandbox-store';
import { DefaultRuntimeSandboxService } from '../src/sandbox/application/services/runtime-sandbox.service';
import { MemoryRuntimeSandboxRegistry } from '../src/sandbox/infrastructure/registry/memory-runtime-registry';
import { TcpHttpHealthProber } from '../src/sandbox/infrastructure/health/tcp-http-health-prober';
import { FsRuntimeWorkspaceProvider } from '../src/sandbox/infrastructure/workspace/fs-runtime-workspace-provider';
import { GitRepositoryCloner } from '../src/repository-analysis/infrastructure/git/git-repository-cloner';
import type { RuntimeSandboxConfig } from '../src/config';
import type { RuntimeScanGateway } from '../src/sandbox/domain/ports/runtime-scan-gateway';

const SCAN_ID = 'scan_live_nodegoat';
const REPO_URL = 'https://github.com/OWASP/NodeGoat.git';
const NETWORK = `amass-net-${SCAN_ID}`;
const MONGO = `amass-mongo-${SCAN_ID}`;
const MONGO_IMAGE = 'mongo:4.4';

function docker(args: string[], timeoutMs = 300_000): string {
  return execFileSync('docker', args, { timeout: timeoutMs, encoding: 'utf8', stdio: 'pipe' });
}

function sweep(): void {
  for (const id of docker(['ps', '-aq', '--filter', 'label=amass.manager=1']).trim().split(/\s+/).filter(Boolean)) {
    docker(['rm', '-f', id], 60_000);
  }
  for (const net of docker(['network', 'ls', '-q', '--filter', 'label=amass.manager=1']).trim().split(/\s+/).filter(Boolean)) {
    docker(['network', 'rm', net], 60_000);
  }
  for (const img of docker(['images', '-q', '--filter', 'label=amass.manager=1']).trim().split(/\s+/).filter(Boolean)) {
    docker(['rmi', '-f', img], 60_000);
  }
}

const config: RuntimeSandboxConfig = {
  maxConcurrent: 3,
  lifetimeMs: 30 * 60_000,
  buildTimeoutMs: 900_000,
  startTimeoutMs: 120_000,
  healthTimeoutMs: 30_000,
  allowHostExpose: false, // secure default: NO host path for the target
  probeImage: 'node:20-alpine',
  limits: { cpus: 0.5, memory: '512m', pids: 256 },
  runtime: 'docker',
};

const gateway: RuntimeScanGateway = {
  scanExists: async () => true,
  scanRepositoryRelation: async () => null,
};

async function main(): Promise<void> {
  console.log('\n=== LIVE RUNTIME SANDBOX VERIFICATION (NodeGoat, docker backend) ===');
  sweep();
  console.log('swept existing amass resources');

  // --- Sibling dependency: the sandbox's internal network exists and a
  // MongoDB container is attached to it (same-net topology as the E2E). ---
  docker(['network', 'create', '--label', 'amass.manager=1', '--label', `amass.scan=${SCAN_ID}`, '--internal', NETWORK]);
  console.log(`created internal network ${NETWORK}`);
  docker(['run', '-d', '--rm', '--name', MONGO, '--network', NETWORK, MONGO_IMAGE], 900_000);
  console.log(`started sibling ${MONGO} on the internal network`);

  const manager = new SandboxManagerService({
    backend: new DockerSandboxBackend(),
    store: new MemorySandboxStore(),
  });
  const service = new DefaultRuntimeSandboxService({
    manager,
    store: new (await import('../test/helpers/memory-runtime-sandbox-store')).MemoryRuntimeSandboxStore(),
    registry: new MemoryRuntimeSandboxRegistry(),
    prober: new TcpHttpHealthProber(),
    gateway,
    workspace: new FsRuntimeWorkspaceProvider(new GitRepositoryCloner()),
    config,
  });

  let sandboxId: string | undefined;
  try {
    // --- Create: build → start → in-network health probe → READY ----------
    const sandbox = await service.create({
      scanId: SCAN_ID,
      repository: { url: REPO_URL },
      name: 'nodegoat-live',
      env: { MONGODB_URI: `mongodb://${MONGO}:27017/nodegoat` },
    });
    sandboxId = sandbox.id;
    console.log(`\nSANDBOX READY: ${sandbox.id}`);
    console.log(`  status:        ${sandbox.status}`);
    console.log(`  image:         ${sandbox.imageName}`);
    console.log(`  network:       ${sandbox.networkId}`);
    console.log(`  internalHost:  ${sandbox.internalHost}:${sandbox.internalPort}`);
    console.log(`  exposedPort:   ${sandbox.exposedPort ?? 'none (isolated)'}`);
    console.log(`  targetUrl:     ${sandbox.targetUrl}`);
    if (!sandbox.sandboxId) throw new Error('no manager sandbox id');
    if (sandbox.status !== 'READY') throw new Error(`expected READY, got ${sandbox.status}`);

    // --- Re-verification health check through the same in-network path -----
    const health = await service.healthCheck(sandbox.id);
    console.log(`\nhealthCheck:    ${health.ok ? 'OK' : 'FAILED'} (status ${health.statusCode ?? '-'}, ${health.latencyMs ?? '-'}ms)`);
    if (!health.ok) throw new Error(`health check failed: ${health.detail}`);

    // --- The security boundary is intact --------------------------------
    // 1. No published ports — nothing listens on the host. (Resolve the real
    //    docker container name via the manager — `sandboxId` is the manager id.)
    const managerView = await manager.getSandbox(sandbox.sandboxId);
    const dockerName = managerView?.containerId ?? sandbox.sandboxId;
    const ports = docker(['port', dockerName]).trim();
    console.log(`published ports: ${ports || 'NONE (no host exposure)'}`);

    // 2. The internal network is --internal.
    const netInfo = docker(['network', 'inspect', '-f', '{{.Internal}}', NETWORK]).trim();
    console.log(`network internal flag: ${netInfo}`);
    if (netInfo !== 'true') throw new Error('network is NOT internal');

    // 3. A container on an UNRELATED network cannot reach the target (this is
    //    the exact failure topology from production: the backend container on
    //    the compose network could not reach 172.19.0.2:8080).
    const outsider = docker(
      ['run', '--rm', 'python:3.11-slim', 'python', '-c',
        `import socket,sys\ns=socket.socket(); s.settimeout(3)\ntry:\n s.connect(('${sandbox.internalHost}', ${sandbox.internalPort}))\n print('OUTSIDER CONNECT OK (unexpected!)'); sys.exit(0)\nexcept OSError as e:\n print('outsider connect blocked:', type(e).__name__); sys.exit(0)`],
      120_000,
    );
    console.log(`outsider net access:  ${outsider.trim().split('\n').pop()}`);

    // --- The target IS reachable through the intended boundary -----------
    // In-network probe container (the same mechanism the health check uses).
    const probeOut = docker(
      ['run', '--rm', '--network', NETWORK, 'python:3.11-slim', 'python', '-c',
        `import urllib.request\nr=urllib.request.urlopen('http://${sandbox.internalHost}:${sandbox.internalPort}/', timeout=10)\nprint('in-network HTTP status:', r.status)`],
      120_000,
    );
    console.log(`in-network probe:     ${probeOut.trim().split('\n').pop()}`);

    // --- Usable by the downstream pipeline -------------------------------
    // Sniper's SandboxToolRuntime executes INSIDE the sandbox; prove a
    // sandbox-bound command works (node http from within the app container —
    // NodeGoat's image is Node 12, so no global fetch).
    const execOut = await manager.execute(sandbox.sandboxId, {
      argv: ['node', '-e', `const http=require('http');http.get({host:'127.0.0.1',port:${sandbox.internalPort},path:'/'},r=>{console.log('sandbox-internal HTTP',r.statusCode);process.exit(0)}).on('error',e=>{console.error(e.message);process.exit(1)})`],
      timeoutMs: 15_000,
      envAllowlist: ['PATH', 'HOME'],
    });
    console.log(`sandbox-bound exec:   exit=${execOut.exitCode} ${execOut.stdout.trim().split('\n').pop()}`);
    if (execOut.exitCode !== 0) throw new Error(`sandbox-bound exec failed: ${execOut.stderr.trim()}`);

    // --- Cleanup ----------------------------------------------------------
    await service.destroy(sandbox.id);
    sandboxId = undefined;
    // Mongo is OUR sibling (not manager-owned): remove it first so the
    // sandbox network can go too.
    docker(['rm', '-f', MONGO], 60_000);
    console.log('\ncleanup: sandbox DESTROYED, mongo removed');
  } finally {
    // Our sibling Mongo holds the sandbox network open: remove it FIRST so
    // the manager-owned network can be torn down, then destroy the sandbox.
    try {
      docker(['rm', '-f', MONGO], 60_000);
    } catch {
      /* already gone */
    }
    if (sandboxId) await service.destroy(sandboxId).catch(() => undefined);
    // The auto-cleanup may have failed to remove the network while Mongo was
    // still attached — reclaim it explicitly before judging leftovers.
    try {
      docker(['network', 'rm', NETWORK], 60_000);
    } catch {
      /* already gone */
    }
    const leftoverContainers = docker(['ps', '-aq', '--filter', 'label=amass.manager=1']).trim();
    const leftoverNets = docker(['network', 'ls', '-q', '--filter', 'label=amass.manager=1']).trim();
    const leftoverImages = docker(['images', '-q', '--filter', 'label=amass.manager=1']).trim();
    console.log(`\nleftover containers: ${JSON.stringify(leftoverContainers.split(/\s+/).filter(Boolean))}`);
    console.log(`leftover networks:   ${JSON.stringify(leftoverNets.split(/\s+/).filter(Boolean))}`);
    console.log(`leftover images:     ${JSON.stringify(leftoverImages.split(/\s+/).filter(Boolean))}`);
    if (leftoverContainers || leftoverNets || leftoverImages) {
      console.log('WARNING: leftovers detected (sweeping)');
      sweep();
      process.exitCode = 1;
    } else {
      console.log('ZERO LEFTOVERS — cleanup verified');
    }
  }
}

main().catch((err) => {
  console.error('\nVERIFICATION FAILED:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
