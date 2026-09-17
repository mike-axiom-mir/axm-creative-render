import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function stepBoundary(line, usesIndent) {
  const match = line.match(/^(\s*)-\s+(?:name|uses|run):/);
  return Boolean(match && match[1].length <= usesIndent);
}

export function extractCheckoutPins(text, workflow = '<memory>') {
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (let i = 0; i < lines.length; i += 1) {
    const uses = lines[i].match(/^(\s*)-?\s*uses:\s*actions\/checkout@[^\s#]+\s*(?:#.*)?$/);
    if (!uses) continue;
    const usesIndent = uses[1].length;
    let repository = null;
    let ref = null;
    let path = null;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (stepBoundary(lines[j], usesIndent)) break;
      const repoMatch = lines[j].match(/^\s*repository:\s*([^#\s]+)\s*(?:#.*)?$/);
      if (repoMatch) repository = repoMatch[1].trim().replace(/^['"]|['"]$/g, '');
      const refMatch = lines[j].match(/^\s*ref:\s*([^#\s]+)\s*(?:#.*)?$/);
      if (refMatch) ref = refMatch[1].trim().replace(/^['"]|['"]$/g, '');
      const pathMatch = lines[j].match(/^\s*path:\s*([^#\s]+)\s*(?:#.*)?$/);
      if (pathMatch) path = pathMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }
    if (repository) rows.push({ workflow, line: i + 1, repository, ref, path });
  }
  return rows;
}

export function classifyCheckoutPins(rows) {
  return rows.map((row) => ({
    ...row,
    immutable: Boolean(row.ref && FULL_SHA_RE.test(row.ref)),
    issue: row.ref == null
      ? 'MISSING_REF'
      : FULL_SHA_RE.test(row.ref)
        ? null
        : 'MUTABLE_OR_NONEXACT_REF',
  }));
}

export async function collectCheckoutPins(workflowDir) {
  const names = (await readdir(workflowDir)).filter((name) => /\.ya?ml$/i.test(name)).sort();
  const workflows = [];
  const rows = [];
  for (const name of names) {
    const full = resolve(workflowDir, name);
    const bytes = await readFile(full);
    workflows.push({ workflow: name, bytes_sha256: sha256(bytes) });
    rows.push(...extractCheckoutPins(bytes.toString('utf8'), name));
  }
  return { workflows, rows: classifyCheckoutPins(rows) };
}

async function githubJson(url, fetchImpl, token) {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'axm-creative-render-donor-pin-audit',
    'x-github-api-version': '2022-11-28',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  let response = await fetchImpl(url, { headers });
  if ((response.status === 403 || response.status === 404) && token) {
    const fallbackHeaders = { ...headers };
    delete fallbackHeaders.authorization;
    response = await fetchImpl(url, { headers: fallbackHeaders });
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

export async function resolvePins(rows, {
  fetchImpl = globalThis.fetch,
  token = process.env.GITHUB_TOKEN || '',
  apiBase = 'https://api.github.com',
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation unavailable');
  const exactRows = rows.filter((row) => row.immutable);
  const repositories = [...new Set(exactRows.map((row) => row.repository))].sort();
  const repoHeads = {};
  const pinResults = [];

  for (const repository of repositories) {
    const headResponse = await githubJson(`${apiBase}/repos/${repository}/commits/main`, fetchImpl, token);
    repoHeads[repository] = {
      ok: headResponse.ok,
      status: headResponse.status,
      sha: headResponse.ok && FULL_SHA_RE.test(headResponse.body?.sha || '') ? headResponse.body.sha : null,
    };
  }

  const pairs = [...new Map(exactRows.map((row) => [`${row.repository}@${row.ref}`, row])).values()]
    .sort((a, b) => `${a.repository}@${a.ref}`.localeCompare(`${b.repository}@${b.ref}`));
  for (const row of pairs) {
    const response = await githubJson(`${apiBase}/repos/${row.repository}/commits/${row.ref}`, fetchImpl, token);
    const resolvedSha = response.ok && FULL_SHA_RE.test(response.body?.sha || '') ? response.body.sha : null;
    const currentHead = repoHeads[row.repository]?.sha || null;
    pinResults.push({
      repository: row.repository,
      pin: row.ref,
      ok: Boolean(response.ok && resolvedSha === row.ref),
      status: response.status,
      resolved_sha: resolvedSha,
      current_main_head: currentHead,
      equals_current_main_head: Boolean(currentHead && currentHead === row.ref),
    });
  }
  return { repo_heads: repoHeads, pins: pinResults };
}

export async function buildAudit({ workflowDir, resolveRemote = false, fetchImpl, token } = {}) {
  const scanned = await collectCheckoutPins(workflowDir);
  const syntaxFailures = scanned.rows.filter((row) => !row.immutable);
  const remote = resolveRemote
    ? await resolvePins(scanned.rows, { fetchImpl, token })
    : { repo_heads: {}, pins: [] };
  const resolutionFailures = remote.pins.filter((row) => !row.ok);
  const historicalPinCount = remote.pins.filter((row) => row.ok && !row.equals_current_main_head).length;
  return {
    contract: 'AXM_CREATIVE_DONOR_PIN_AUDIT',
    version: 1,
    boundary: {
      exact_commit_pins_are_required: true,
      current_head_drift_is_evidence_not_failure: true,
      remote_resolution_proves_commit_addressability_not_semantic_correctness: true,
      donor_source_remains_authoritative: true,
      audit_output_is_derived_replaceable_evidence: true,
    },
    workflows: scanned.workflows,
    checkouts: scanned.rows,
    remote,
    summary: {
      workflow_count: scanned.workflows.length,
      external_checkout_count: scanned.rows.length,
      immutable_checkout_count: scanned.rows.length - syntaxFailures.length,
      mutable_or_missing_ref_count: syntaxFailures.length,
      unique_resolved_pin_count: remote.pins.length,
      resolution_failure_count: resolutionFailures.length,
      historical_pin_count: historicalPinCount,
      ok: syntaxFailures.length === 0 && resolutionFailures.length === 0,
    },
  };
}

function parseArgs(argv) {
  const args = {
    workflowDir: '.github/workflows',
    out: 'build/donor-pin-audit/audit.json',
    resolveRemote: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--workflow-dir') args.workflowDir = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--resolve-remote') args.resolveRemote = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(dirname(args.out), { recursive: true });
  let report;
  try {
    report = await buildAudit(args);
  } catch (error) {
    report = {
      contract: 'AXM_CREATIVE_DONOR_PIN_AUDIT',
      version: 1,
      summary: { ok: false },
      fatal_error: String(error?.stack || error),
    };
  }
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  await writeFile(args.out, bytes);
  console.log(`donor_pin_audit_sha256=${sha256(bytes)}`);
  console.log(`donor_pin_audit_ok=${report.summary?.ok === true ? 'PASS' : 'FAIL'}`);
  if (report.summary?.ok !== true) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) await main();
