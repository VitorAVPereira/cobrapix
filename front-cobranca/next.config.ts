import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The payment link carries its token in the URL: never sent as referrer nor
  // indexed, also as HTTP headers (the page repeats both in its metadata).
  async headers() {
    return [
      {
        source: "/pagar/:signedToken",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
