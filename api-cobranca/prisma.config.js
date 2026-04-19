require("dotenv/config");
const { defineConfig } = require("prisma/config");

module.exports = defineConfig({
  schema: "prisma/schema.prisma",
  seed: "ts-node prisma/seed.ts",
  datasource: {
    url: process.env.DIRECT_URL,
  },
});