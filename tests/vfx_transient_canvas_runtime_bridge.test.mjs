import test from "node:test";
import assert from "node:assert/strict";

import { executeTransientImpulseCanvasRuntime } from "../src/vfx_transient_canvas_runtime_bridge.mjs";

function realization(content) {
  return {
    mediaType: "text/html",
    renderer: "axm.vfx.transient-impulse-canvas2d/v0.1",
    derivedFromStateHash: "state-hash",
    canonicalEventHash: "event-hash",
    fieldGeometryHash: "field-hash",
    oneShotDuration: 0.8,
    workingSet: {
      schema: "axm.render-working-set/v0.1",
      canonicalEventRetained: true,
      derivedFieldRebuildable: true,
      rendererStateDisposable: true,
      rings: 1,
      spokes: 1,
      fragments: 1,
      envelopeSamples: 17,
    },
    content,
  };
}

const executableHtml = `<!doctype html><canvas id="c"></canvas><script>(()=>{
  const c=document.querySelector('#c'),g=c.getContext('2d',{alpha:false});
  if(!g)throw Error('Canvas2D required');
  const started=performance.now();
  function frame(now){
    g.fillStyle='#03060b';g.fillRect(0,0,1000,600);g.save();
    g.strokeStyle='rgba(1,2,3,.5)';g.beginPath();g.ellipse(10,10,5,3,0,0,Math.PI*2);g.stroke();
    g.beginPath();g.moveTo(0,0);g.lineTo(10,10);g.stroke();
    g.fillStyle='rgba(3,2,1,.8)';g.beginPath();g.arc(5,5,2,0,Math.PI*2);g.fill();g.restore();
    if(now-started<700)requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})()</script>`;

test("generated transient Canvas2D JavaScript yields a bounded repeatable API trace", () => {
  const out = executeTransientImpulseCanvasRuntime(realization(executableHtml));
  assert.equal(out.observation.repeat_verification, "PASS");
  assert.equal(out.observation.frame_count, 3);
  assert.ok(out.observation.call_count > 20);
  for (const name of ["querySelector", "getContext", "fillRect", "ellipse", "lineTo", "arc", "fill"]) {
    assert.ok(out.observation.call_counts[name] > 0, `missing ${name}`);
  }
  assert.ok(out.observation.call_counts["set:fillStyle"] > 0);
  assert.equal(out.observation.truth_boundary.generated_renderer_javascript_executed, true);
  assert.equal(out.observation.truth_boundary.actual_browser_canvas_pixels_observed, false);
  const trace = JSON.parse(out.traceBytes.toString("utf8"));
  assert.equal(trace.canonical_event_hash, "event-hash");
  assert.equal(trace.field_geometry_hash, "field-hash");
  assert.equal(trace.call_count, out.observation.call_count);
});

test("Canvas2D runtime proof fails closed on ambiguous executable artifacts or authority drift", () => {
  assert.throws(
    () => executeTransientImpulseCanvasRuntime(realization(`${executableHtml}<script>void 0</script>`)),
    /exactly one inline script/,
  );
  assert.throws(
    () => executeTransientImpulseCanvasRuntime(realization(executableHtml), { frameTimes: [0, 100] }),
    /scheduled beyond bounded proof frames/,
  );
  const bad = realization(executableHtml);
  bad.workingSet.rendererStateDisposable = false;
  assert.throws(() => executeTransientImpulseCanvasRuntime(bad), /authority boundary drifted/);
});
