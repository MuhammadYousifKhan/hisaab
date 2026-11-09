import type { NextConfig } from "next";

// Pages read the ledger on every request, so they render dynamically (no Cache Components).
// PGlite ships WebAssembly and data files, so it is loaded with Node's require, not bundled.
const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
