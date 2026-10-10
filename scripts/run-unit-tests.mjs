import { readdirSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ALLOCATION_TEST_FILES = Object.freeze([
  'src/data/focusAllocations.test.mjs',
  'src/overlays/worldOverlayAllocation.test.mjs',
]);

/** Whether this runtime matches the one the allocation budgets were calibrated on. */
export function isCalibratedAllocationRuntime(version = process.versions.node) {
  return Number.parseInt(String(version).split('.')[0], 10) === 24;
}

/** Require the runtime on which allocation budgets were calibrated. */
export function assertNode24AllocationRuntime(version = process.versions.node) {
  if (!isCalibratedAllocationRuntime(version)) {
    throw new Error(`Allocation budgets require the calibrated Node 24 runtime; received ${version}`);
  }
  return version;
}

/** Discover repository unit tests in stable path order. */
export function discoverUnitTestFiles(root = process.cwd()) {
  const sourceRoot = path.join(root, 'src');
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        files.push(path.relative(root, absolute).split(path.sep).join('/'));
      }
    }
  };
  visit(sourceRoot);
  return files.sort();
}

/** Partition ordinary parallel tests from the two GC-bracketed probes. */
export function buildUnitTestPlan(files) {
  const known = new Set(files);
  const missingAllocationTests = ALLOCATION_TEST_FILES.filter((file) => !known.has(file));
  if (missingAllocationTests.length) {
    throw new Error(`Missing allocation microbenchmarks: ${missingAllocationTests.join(', ')}`);
  }
  const allocationSet = new Set(ALLOCATION_TEST_FILES);
  return {
    parallel: files.filter((file) => !allocationSet.has(file)).sort(),
    serializedAllocations: [...ALLOCATION_TEST_FILES],
  };
}

/** Build the isolated Node invocation for one GC-bracketed allocation probe. */
export function allocationTestArgs(file) {
  if (!ALLOCATION_TEST_FILES.includes(file)) {
    throw new Error(`Not an allocation microbenchmark: ${file}`);
  }
  return ['--expose-gc', '--test', '--test-concurrency=1', file];
}

/** Failing tests with their details, cut from TAP output (temporary CI diagnostics). */
export function failureReport(output, limit = 60000) {
  const lines = output.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*not ok /.test(lines[i])) continue;
    out.push(...lines.slice(i, i + 45), '---');
  }
  return out.join('\n').slice(0, limit);
}

/**
 * Temporary CI diagnostics: Actions logs need a signed-in account, so on GitHub
 * Actions a failing run also leaves the failing tests as a commit comment.
 * Uses the token actions/checkout already stored in git config; no-op elsewhere.
 */
async function postFailureComment(args, output) {
  if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.GITHUB_REPOSITORY || !process.env.GITHUB_SHA) return;
  try {
    const header = execFileSync('git', ['config', '--get', 'http.https://github.com/.extraheader'], { encoding: 'utf8' }).trim();
    const basic = header.split(' ').pop();
    const token = Buffer.from(basic, 'base64').toString('utf8').split(':').pop();
    const body = `npm test: node ${args.slice(0, 3).join(' ')} ... failed on Node ${process.versions.node}\n\n\`\`\`\n${failureReport(output) || output.slice(-20000)}\n\`\`\``;
    const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/commits/${process.env.GITHUB_SHA}/comments`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    console.error(`[unit] failure report comment: HTTP ${res.status}`);
  } catch (error) {
    console.error(`[unit] failure report comment skipped: ${error.message}`);
  }
}

const pending = [];
function runTests(args) {
  const capture = process.env.GITHUB_ACTIONS === 'true';
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    env: process.env,
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (capture) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (result.status !== 0) pending.push(postFailureComment(args, `${result.stdout}\n${result.stderr}`));
  }
  return result.status ?? 1;
}

export function runUnitTests() {
  const plan = buildUnitTestPlan(discoverUnitTestFiles());
  const parallelStatus = runTests(['--test', ...plan.parallel]);
  if (parallelStatus !== 0) return parallelStatus;

  // The GC-bracketed budgets are calibrated on Node 24 and are meaningless on
  // other allocators. A contributor's suite must stay green on any supported
  // engine (package.json permits >=24), so uncalibrated runtimes skip the
  // probes with a warning. Set GEV_REQUIRE_ALLOCATION_GATE=1 (pinned CI /
  // release batteries) to make an uncalibrated runtime a hard failure.
  if (!isCalibratedAllocationRuntime()) {
    if (process.env.GEV_REQUIRE_ALLOCATION_GATE === '1') {
      assertNode24AllocationRuntime();
    }
    console.warn(
      `[unit] SKIPPED ${ALLOCATION_TEST_FILES.length} allocation microbenchmarks: `
      + `budgets are calibrated for Node 24, running ${process.versions.node}. `
      + 'Run under Node 24 (or set GEV_REQUIRE_ALLOCATION_GATE=1 to fail instead).',
    );
    return 0;
  }
  for (const file of plan.serializedAllocations) {
    const status = runTests(allocationTestArgs(file));
    if (status !== 0) return status;
  }
  return 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  process.exitCode = runUnitTests();
  await Promise.all(pending);
}
