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

function cleanUrlCandidate(candidate) {
  return candidate.replace(/[),.;\]}]+$/g, '');
}

function githubUrlRow(candidate, workflow, line) {
  let parsed;
  try {
    parsed = new URL(cleanUrlCandidate(candidate));
  } catch {
    return null;
  }
  const parts = parsed.pathname.split('/').filter(Boolean);

  if (parsed.hostname === 'raw.githubusercontent.com' && parts.length >= 4) {
    return {
      workflow,
      line,
      kind: 'RAW_GITHUB_CONTENT',
      repository: `${parts[0]}/${parts[1]}`,
      ref: parts[2],
      url: parsed.toString(),
    };
  }

  if (parsed.hostname === 'github.com' && parts.length >= 5 && parts[2] === 'raw') {
    return {
      workflow,
      line,
      kind: 'GITHUB_RAW_PATH',
      repository: `${parts[0]}/${parts[1]}`,
      ref: parts[3],
      url: parsed.toString(),
    };
  }

  if (parsed.hostname === 'github.com' && parts.length >= 4 && parts[2] === 'archive') {
    const archiveTail = parts.slice(3).join('/').replace(/\.(?:zip|tar\.gz)$/i, '');
    return {
      workflow,
      line,
      kind: 'GITHUB_ARCHIVE',
      repository: `${parts[0]}/${parts[1]}`,
      ref: archiveTail,
      url: parsed.toString(),
    };
  }

  if (
    parsed.hostname === 'api.github.com'
    && parts.length >= 5
    && parts[0] === 'repos'
    && parts[3] === 'contents'
  ) {
    return {
      workflow,
      line,
      kind: 'GITHUB_CONTENTS_API',
      repository: `${parts[1]}/${parts[2]}`,
      ref: parsed.searchParams.get('ref'),
      url: parsed.toString(),
    };
  }

  return null;
}

function extractCloneRow(lineText, workflow, line) {
  const code = lineText.replace(/\s+#.*$/, '');
  const httpsClone = code.match(/\bgit\s+clone\b[^\n]*?https:\/\/github\.com\/([^/\s'";]+)\/([^\s'";]+?)(?:\.git)?(?:\s|$)/i);
  if (httpsClone) {
    return {
      workflow,
      line,
      kind: 'GIT_CLONE',
      repository: `${httpsClone[1]}/${httpsClone[2].replace(/\.git$/i, '')}`,
      ref: null,
      url: `https://github.com/${httpsClone[1]}/${httpsClone[2].replace(/\.git$/i, '')}.git`,
    };
  }
  const sshClone = code.match(/\bgit\s+clone\b[^\n]*?git@github\.com:([^/\s'";]+)\/([^\s'";]+?)(?:\.git)?(?:\s|$)/i);
  if (sshClone) {
    return {
      workflow,
      line,
      kind: 'GIT_CLONE',
      repository: `${sshClone[1]}/${sshClone[2].replace(/\.git$/i, '')}`,
      ref: null,
      url: `git@github.com:${sshClone[1]}/${sshClone[2].replace(/\.git$/i, '')}.git`,
    };
  }
  const ghClone = code.match(/\bgh\s+repo\s+clone\s+([^/\s'";]+)\/([^\s'";]+)(?:\s|$)/i);
  if (ghClone) {
    return {
      workflow,
      line,
      kind: 'GH_REPO_CLONE',
      repository: `${ghClone[1]}/${ghClone[2].replace(/\.git$/i, '')}`,
      ref: null,
      url: `gh repo clone ${ghClone[1]}/${ghClone[2].replace(/\.git$/i, '')}`,
    };
  }
  return null;
}

export function extractGithubNetworkRefs(text, workflow = '<memory>') {
  const lines = text.split(/\r?\n/);
  const rows = [];
  const urlRe = /https:\/\/(?:raw\.githubusercontent\.com|github\.com|api\.github\.com)\/[^\s'"<>]+/g;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const candidate of line.matchAll(urlRe)) {
      const row = githubUrlRow(candidate[0], workflow, i + 1);
      if (row) rows.push(row);
    }
    const cloneRow = extractCloneRow(line, workflow, i + 1);
    if (cloneRow) rows.push(cloneRow);
  }
  return rows;
}

export function classifyGithubNetworkRefs(rows) {
  return rows.map((row) => {
    let issue = null;
    if (row.kind === 'GIT_CLONE' || row.kind === 'GH_REPO_CLONE') issue = 'UNBOUND_GIT_CLONE';
    else if (row.ref == null || row.ref === '') issue = 'MISSING_REF';
    else if (!FULL_SHA_RE.test(row.ref)) issue = 'MUTABLE_OR_NONEXACT_REF';
    return {
      ...row,
      immutable: issue == null,
      issue,
    };
  });
}

async function workflowFiles(workflowDir) {
  const names = (await readdir(workflowDir)).filter((name) => /\.ya?ml$/i.test(name)).sort();
  const files = [];
  for (const name of names) {
    const full = resolve(workflowDir, name);
    const bytes = await readFile(full);
    files.push({ name, bytes, text: bytes.toString('utf8') });
  }
  return files;
}

export async function collectCheckoutPins(workflowDir) {
  const files = await workflowFiles(workflowDir);
  return {
    workflows: files.map(({ name, bytes }) => ({ workflow: name, bytes_sha256: sha256(bytes) })),
    rows: classifyCheckoutPins(files.flatMap(({ name, text }) => extractCheckoutPins(text, name))),
  };
}

export async function collectDonorReferences(workflowDir) {
  const files = await workflowFiles(workflowDir);
  return {
    workflows: files.map(({ name, bytes }) => ({ workflow: name, bytes_sha256: sha256(bytes) })),
    checkouts: classifyCheckoutPins(files.flatMap(({ name, text }) => extractCheckoutPins(text, name))),
    github_network_refs: classifyGithubNetworkRefs(
      files.flatMap(({ name, text }) => extractGithubNetworkRefs(text, name)),
    ),
  };
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
  const scanned = await collectDonorReferences(workflowDir);
  const checkoutSyntaxFailures = scanned.checkouts.filter((row) => !row.immutable);
  const networkSyntaxFailures = scanned.github_network_refs.filter((row) => !row.immutable);
  const immutableReferences = [...scanned.checkouts, ...scanned.github_network_refs]
    .filter((row) => row.immutable);
  const remote = resolveRemote
    ? await resolvePins(immutableReferences, { fetchImpl, token })
    : { repo_heads: {}, pins: [] };
  const resolutionFailures = remote.pins.filter((row) => !row.ok);
  const historicalPinCount = remote.pins.filter((row) => row.ok && !row.equals_current_main_head).length;
  return {
    contract: 'AXM_CREATIVE_DONOR_PIN_AUDIT',
    version: 2,
    boundary: {
      exact_commit_pins_are_required: true,
      github_hosted_network_refs_must_be_exact_commit_addressed: true,
      unbound_github_clone_fails_closed: true,
      current_head_drift_is_evidence_not_failure: true,
      remote_resolution_proves_commit_addressability_not_semantic_correctness: true,
      donor_source_remains_authoritative: true,
      audit_output_is_derived_replaceable_evidence: true,
    },
    workflows: scanned.workflows,
    checkouts: scanned.checkouts,
    github_network_refs: scanned.github_network_refs,
    remote,
    summary: {
      workflow_count: scanned.workflows.length,
      external_checkout_count: scanned.checkouts.length,
      immutable_checkout_count: scanned.checkouts.length - checkoutSyntaxFailures.length,
      mutable_or_missing_ref_count: checkoutSyntaxFailures.length,
      github_network_ref_count: scanned.github_network_refs.length,
      immutable_github_network_ref_count: scanned.github_network_refs.length - networkSyntaxFailures.length,
      mutable_or_unbound_github_network_ref_count: networkSyntaxFailures.length,
      unique_resolved_pin_count: remote.pins.length,
      resolution_failure_count: resolutionFailures.length,
      historical_pin_count: historicalPinCount,
      ok: checkoutSyntaxFailures.length === 0
        && networkSyntaxFailures.length === 0
        && resolutionFailures.length === 0,
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
      version: 2,
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
