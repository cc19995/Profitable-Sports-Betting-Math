import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Cloud Agent tunnels (trycloudflare / localtunnel) so you can open the desk
  // in a normal browser. Dev-only; Next blocks unknown Host headers otherwise.
  allowedDevOrigins: ["*.trycloudflare.com", "*.loca.lt"],
};

export default nextConfig;
