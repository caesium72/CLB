import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // Serve the ERC-8004 agent card at the conventional well-known path too.
    return [{ source: "/.well-known/agent-card.json", destination: "/api/agent-card" }];
  },
};

export default nextConfig;
