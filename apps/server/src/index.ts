import { readServerConfig } from "./config.ts";
import { createServer } from "./server.ts";

const config = readServerConfig();
const server = await createServer();

try {
  await server.listen({
    host: config.host,
    port: config.port,
  });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
