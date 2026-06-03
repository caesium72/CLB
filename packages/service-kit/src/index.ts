import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

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

/**
 * Load the nearest `.env` by walking up from a starting directory to the
 * filesystem root. Existing environment variables are never overwritten.
 */
export function loadMonorepoEnv(startDir: string = process.cwd()): void {
  let current = resolve(startDir);

  while (true) {
    const candidate = resolve(current, ".env");

    if (existsSync(candidate)) {
      applyEnvFile(candidate);
      return;
    }

    const parent = dirname(current);
    if (parent === current) {
      return;
    }

    current = parent;
  }
}

export type OpenApiOptions = {
  title: string;
  version?: string;
  description?: string;
};

/**
 * Register OpenAPI generation (`/docs/json`) and Swagger UI (`/docs`) on a
 * Fastify instance so every service exposes consistent, research-friendly docs.
 */
export async function registerOpenApi(
  app: FastifyInstance,
  options: OpenApiOptions,
): Promise<void> {
  await app.register(swagger, {
    openapi: {
      info: {
        title: options.title,
        version: options.version ?? "0.1.0",
        ...(options.description ? { description: options.description } : {}),
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
}
