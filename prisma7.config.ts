import "dotenv/config";
import { defineConfig, env } from "prisma/config";

const directUrl = process.env["DIRECT_URL"];

if (!directUrl) {
  throw new Error(
    [
      "DIRECT_URL is not set.",
      "Copy .env.example to .env and set DIRECT_URL to a direct PostgreSQL connection string,",
      "for example:",
      "  DIRECT_URL=\"postgresql://user:password@localhost:5432/todo_dev?schema=public\"",
    ].join("\n"),
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
