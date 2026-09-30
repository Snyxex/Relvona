import assert from "node:assert/strict";

async function main() {
  const pipex = await import("pipex");

  assert.equal(typeof pipex.DataEngine, "function", "PipeX must expose DataEngine from its public package entrypoint");
  assert.equal(typeof pipex.runPipeline, "function", "PipeX must expose runPipeline from its public package entrypoint");

  console.log("PipeX public package import passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
