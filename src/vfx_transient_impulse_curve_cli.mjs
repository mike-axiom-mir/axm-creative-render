#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { observeVisualEffectTransientImpulseCurve } from "./vfx_transient_impulse_curve_bridge.mjs";

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) { out._.push(token); continue; }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    out[key] = value;
    i += 1;
  }
  return out;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a._[0] !== "build") throw new Error("expected build command");
  const required = [
    "vfx-root", "vfx-revision", "event", "field", "base-envelope", "noop-curve", "shaped-curve",
    "noop-envelope", "shaped-envelope", "noop-state", "shaped-state", "base-scene", "noop-scene",
    "shaped-scene", "receipt",
  ];
  for (const key of required) if (!a[key]) throw new Error(`missing --${key}`);

  const result = await observeVisualEffectTransientImpulseCurve(a["vfx-root"], { vfxRevision: a["vfx-revision"] });
  const outputs = [
    [a.event, result.eventBytes],
    [a.field, result.fieldBytes],
    [a["base-envelope"], result.baseEnvelopeBytes],
    [a["noop-curve"], result.noopCurveBytes],
    [a["shaped-curve"], result.shapedCurveBytes],
    [a["noop-envelope"], result.noopEnvelopeBytes],
    [a["shaped-envelope"], result.shapedEnvelopeBytes],
    [a["noop-state"], result.noopStateBytes],
    [a["shaped-state"], result.shapedStateBytes],
    [a["base-scene"], result.baseSceneBytes],
    [a["noop-scene"], result.noopSceneBytes],
    [a["shaped-scene"], result.shapedSceneBytes],
    [a.receipt, Buffer.from(`${JSON.stringify(result.receipt, null, 2)}\n`, "utf8")],
  ];
  for (const [path, bytes] of outputs) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  console.log("vfx_transient_impulse_curve_native=PASS");
  console.log(`canonical_event_hash=${result.receipt.canonical_event.hash}`);
  console.log(`base_envelope_hash=${result.receipt.base_derived_state.envelope_hash}`);
  console.log(`noop_curve_hash=${result.receipt.curve_sources.noop.hash}`);
  console.log(`shaped_curve_hash=${result.receipt.curve_sources.shaped.hash}`);
  console.log(`observation_t=${result.receipt.observation.t}`);
  console.log(`base_intensity=${result.receipt.observation.base.intensity}`);
  console.log(`shaped_intensity=${result.receipt.observation.shaped.intensity}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
