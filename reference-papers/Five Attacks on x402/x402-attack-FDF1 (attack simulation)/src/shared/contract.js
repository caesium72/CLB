import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load compiled contract ABI
const artifactPath = join(__dirname, "../../artifacts/contracts/MockUSDC.sol/MockUSDC.json");

let _artifact = null;

export function getContractArtifact() {
  if (!_artifact) {
    _artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
  }
  return _artifact;
}
