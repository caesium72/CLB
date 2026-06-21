/**
 * Web-demo merchant-agent helpers. The actual signed-artifact delivery lives in
 * the orchestrator's `merchant` module (single source of truth, shared with the
 * in-process flow); here we only add the web-specific ERC-8004 `registration-v1`
 * card builders and the self-referencing base URL.
 */
import {
  agentAddress,
  deliverServiceReport,
  weatherForecast,
  type ServiceKind,
} from "@clb-acel/agent-orchestrator/inproc";
import { ensureMonorepoEnv } from "./env";

ensureMonorepoEnv();

export { agentAddress, deliverServiceReport, weatherForecast, type ServiceKind };

export type RegistrationCard = {
  type: string;
  name: string;
  description: string;
  image: string;
  services: { name: string; endpoint: string }[];
  x402Support: boolean;
  active: boolean;
  supportedTrust: string[];
};

const REGISTRATION_V1 = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";

export function grammarCard(baseUrl: string): RegistrationCard {
  return {
    type: REGISTRATION_V1,
    name: "CLB-ACEL Grammar Agent",
    description:
      "A trustless agent that proofreads and corrects English text — fixing grammar, spelling, and " +
      "punctuation. Paid per check over x402; its identity lives on the canonical ERC-8004 Identity " +
      "Registry and its cross-layer-binding verification certificates are recorded on-chain.",
    image: "",
    services: [{ name: "grammar", endpoint: `${baseUrl}/api/agents/grammar` }],
    x402Support: true,
    active: true,
    supportedTrust: ["cross-layer-binding"],
  };
}

export function weatherCard(baseUrl: string): RegistrationCard {
  return {
    type: REGISTRATION_V1,
    name: "CLB-ACEL Weather Agent",
    description:
      "A trustless agent that returns a weather update for a city. Paid per request over x402; its " +
      "identity lives on the canonical ERC-8004 Identity Registry and its cross-layer-binding " +
      "verification certificates are recorded on-chain as ERC-8004 validation entries.",
    image: "",
    services: [{ name: "weather", endpoint: `${baseUrl}/api/agents/weather` }],
    x402Support: true,
    active: true,
    supportedTrust: ["cross-layer-binding"],
  };
}

/** Self-referencing base URL so cards work on any Vercel domain. */
export function requestBaseUrl(request: Request): string {
  const host = request.headers.get("host");
  if (host) {
    const proto =
      request.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return new URL(request.url).origin;
}
