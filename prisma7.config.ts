import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl = process.env["DATABASE_URL"];

if (!databaseUrl) {
  throw new Error(
    [
      "DATABASE_URL is not set.",
      "Copy .env.example to .env and set DATABASE_URL to a PostgreSQL connection string,",
      "for example:",
      "  DATABASE_URL=\"postgresql://user:password@localhost:5432/todo_dev?schema=public\"",
    ].join("\n"),
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
