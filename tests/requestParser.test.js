const assert = require("assert");

const { parseBuildRequest } = require("../builder/requestParser");

assert.strictEqual(parseBuildRequest("build something cool"), null);
assert.strictEqual(parseBuildRequest("maybe later we should build a bridge"), null);
assert.strictEqual(parseBuildRequest("don't build near spawn"), null);
assert.strictEqual(
  parseBuildRequest("build something cool at this anchor", "Sage", {
    anchor: { id: "anchor-1" },
    target: { x: 10, y: 64, z: -20 }
  }),
  null
);

const parsedAnchorBuild = parseBuildRequest("build a small wooden hut at this anchor", "Sage", {
  anchor: { id: "anchor-1" },
  target: { x: 10, y: 64, z: -20 }
});

assert.ok(parsedAnchorBuild);
assert.strictEqual(parsedAnchorBuild.type, "compose_structure");
assert.strictEqual(parsedAnchorBuild.style, "hut");
assert.strictEqual(parsedAnchorBuild.size, "small");
assert.deepStrictEqual(parsedAnchorBuild.location, { x: 10, y: 64, z: -20, source: "anchor", anchorId: "anchor-1" });
assert.strictEqual(parsedAnchorBuild.anchorId, "anchor-1");

const parsedCoordinateBuild = parseBuildRequest("build a tower at x 10 y 64 z -20", "Sage");

assert.ok(parsedCoordinateBuild);
assert.strictEqual(parsedCoordinateBuild.type, "compose_structure");
assert.strictEqual(parsedCoordinateBuild.style, "tower");
assert.deepStrictEqual(parsedCoordinateBuild.location, { x: 10, y: 64, z: -20, source: "coordinates", anchorId: null });

console.log("requestParser tests passed");
