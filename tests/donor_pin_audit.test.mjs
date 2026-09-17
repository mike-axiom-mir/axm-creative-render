import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildAudit,
  classifyCheckoutPins,
  classifyGithubNetworkRefs,
  extractCheckoutPins,
  extractGithubNetworkRefs,
  resolvePins,
} from '../src/donor_pin_audit.mjs';

const PIN_A = 'a'.repeat(40);
const PIN_B = 'b'.repeat(40);

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test('extracts external checkout pins without treating the local checkout as a donor', () => {
  const rows = extractCheckoutPins(`
steps:
  - uses: actions/checkout@v4
  - name: donor
    uses: actions/checkout@v4
    with:
      repository: mike-axiom-mir/axm-render-fabric
      ref: ${PIN_A}
      path: render-fabric
`, 'lane.yml');
  assert.deepEqual(classifyCheckoutPins(rows), [{
    workflow: 'lane.yml',
    line: 5,
    repository: 'mike-axiom-mir/axm-render-fabric',
    ref: PIN_A,
    path: 'render-fabric',
    immutable: true,
    issue: null,
  }]);
});

test('mutable or missing external refs fail the checkout syntax boundary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'axm-donor-audit-'));
  await writeFile(join(dir, 'mutable.yml'), `
steps:
  - uses: actions/checkout@v4
    with:
      repository: mike-axiom-mir/axm-visual-effect-fabric
      ref: main
  - uses: actions/checkout@v4
    with:
      repository: mike-axiom-mir/axm-universal-creation
`);
  const report = await buildAudit({ workflowDir: dir });
  assert.equal(report.version, 2);
  assert.equal(report.summary.ok, false);
  assert.equal(report.summary.mutable_or_missing_ref_count, 2);
  assert.deepEqual(
    report.checkouts.map((row) => row.issue),
    ['MUTABLE_OR_NONEXACT_REF', 'MISSING_REF'],
  );
});

test('classifies exact raw GitHub content and contents API refs as immutable donor evidence', () => {
  const rows = classifyGithubNetworkRefs(extractGithubNetworkRefs(`
steps:
  - run: curl -fsS https://raw.githubusercontent.com/mike-axiom-mir/axm-render-fabric/${PIN_A}/README.md
  - run: curl -fsS 'https://api.github.com/repos/mike-axiom-mir/axm-universal-creation/contents/package.json?ref=${PIN_B}'
`, 'network.yml'));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [row.kind, row.repository, row.ref, row.issue]), [
    ['RAW_GITHUB_CONTENT', 'mike-axiom-mir/axm-render-fabric', PIN_A, null],
    ['GITHUB_CONTENTS_API', 'mike-axiom-mir/axm-universal-creation', PIN_B, null],
  ]);
  assert.equal(rows.every((row) => row.immutable), true);
});

test('mutable raw URLs and unbound GitHub clones fail closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'axm-donor-network-audit-'));
  await writeFile(join(dir, 'network.yml'), `
steps:
  - run: curl -fsS https://raw.githubusercontent.com/mike-axiom-mir/axm-render-fabric/main/README.md
  - run: git clone https://github.com/mike-axiom-mir/axm-visual-effect-fabric.git donor-vfx
  - run: gh repo clone mike-axiom-mir/axm-universal-creation uc
`);
  const report = await buildAudit({ workflowDir: dir });
  assert.equal(report.summary.ok, false);
  assert.equal(report.summary.github_network_ref_count, 3);
  assert.equal(report.summary.mutable_or_unbound_github_network_ref_count, 3);
  assert.deepEqual(
    report.github_network_refs.map((row) => row.issue),
    ['MUTABLE_OR_NONEXACT_REF', 'UNBOUND_GIT_CLONE', 'UNBOUND_GIT_CLONE'],
  );
});

test('remote resolution accepts historical exact pins but fails an unresolved pin', async () => {
  const rows = classifyCheckoutPins([
    { workflow: 'a.yml', line: 1, repository: 'mike-axiom-mir/one', ref: PIN_A, path: 'one' },
    { workflow: 'b.yml', line: 1, repository: 'mike-axiom-mir/two', ref: PIN_B, path: 'two' },
  ]);
  const fetchImpl = async (url) => {
    if (url.endsWith('/mike-axiom-mir/one/commits/main')) return response(200, { sha: 'c'.repeat(40) });
    if (url.endsWith(`/mike-axiom-mir/one/commits/${PIN_A}`)) return response(200, { sha: PIN_A });
    if (url.endsWith('/mike-axiom-mir/two/commits/main')) return response(200, { sha: PIN_B });
    if (url.endsWith(`/mike-axiom-mir/two/commits/${PIN_B}`)) return response(404, { message: 'Not Found' });
    throw new Error(`unexpected url ${url}`);
  };
  const remote = await resolvePins(rows, { fetchImpl, token: '' });
  assert.equal(remote.pins[0].ok, true);
  assert.equal(remote.pins[0].equals_current_main_head, false);
  assert.equal(remote.pins[1].ok, false);
  assert.equal(remote.pins[1].status, 404);
});

test('exact network refs join checkout pins in remote resolution without weakening history rules', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'axm-donor-network-resolve-'));
  await writeFile(join(dir, 'combined.yml'), `
steps:
  - uses: actions/checkout@v4
    with:
      repository: mike-axiom-mir/one
      ref: ${PIN_A}
  - run: curl -fsS https://raw.githubusercontent.com/mike-axiom-mir/two/${PIN_B}/README.md
`);
  const fetchImpl = async (url) => {
    if (url.endsWith('/mike-axiom-mir/one/commits/main')) return response(200, { sha: 'c'.repeat(40) });
    if (url.endsWith(`/mike-axiom-mir/one/commits/${PIN_A}`)) return response(200, { sha: PIN_A });
    if (url.endsWith('/mike-axiom-mir/two/commits/main')) return response(200, { sha: PIN_B });
    if (url.endsWith(`/mike-axiom-mir/two/commits/${PIN_B}`)) return response(200, { sha: PIN_B });
    throw new Error(`unexpected url ${url}`);
  };
  const report = await buildAudit({ workflowDir: dir, resolveRemote: true, fetchImpl, token: '' });
  assert.equal(report.summary.ok, true);
  assert.equal(report.summary.external_checkout_count, 1);
  assert.equal(report.summary.github_network_ref_count, 1);
  assert.equal(report.summary.unique_resolved_pin_count, 2);
  assert.equal(report.summary.historical_pin_count, 1);
});
