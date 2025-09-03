// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      "pdf-parse",
      "@qdrant/js-client-rest",
      "@google/generative-ai",
      "langchain",
      "@langchain/google-genai",
      "@langchain/community",
      "@langchain/qdrant",
      "@langchain/core",
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Handle pdf-parse and its dependencies on the server side
      config.resolve.alias = {
        ...config.resolve.alias,
        canvas: false,
        jsdom: false,
        "sharp$": false,
        "onnxruntime-node$": false,
      };

      // Exclude problematic modules from bundling
      config.externals = config.externals || [];
      config.externals.push({
        "pdf-parse": "commonjs pdf-parse",
        canvas: "commonjs canvas",
        jsdom: "commonjs jsdom",
      });
    }

    // Handle ESM modules
    config.module.rules.push({
      test: /\.m?js$/,
      type: "javascript/auto",
      resolve: {
        fullySpecified: false,
      },
    });

    return config;
  },
  // Handle large file uploads
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
  // Disable static optimization for API routes
  output: "standalone",
};

export default nextConfig;
