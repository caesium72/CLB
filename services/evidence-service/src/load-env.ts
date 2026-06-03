import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

function applyEnvFile(envPath: string): void {
  const contents = readFileSync(envPath, "utf8");

  for (const line of contents.split(/\r?\n/u)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function loadMonorepoEnv(): void {
  const candidates = [
    resolve(moduleDir, "../../../.env"),
    resolve(moduleDir, "../../.env"),
    resolve(process.cwd(), ".env"),
  ];

  for (const envPath of candidates) {
    if (!existsSync(envPath)) {
      continue;
    }

    applyEnvFile(envPath);
    return;
  }
}
