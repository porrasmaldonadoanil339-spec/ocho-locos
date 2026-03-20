import type { Express } from "express";
import { createServer, type Server } from "node:http";
import authRouter from "./auth";
import { setupRooms } from "./rooms";

export async function registerRoutes(app: Express): Promise<Server> {
  app.use("/api/auth", authRouter);

  const httpServer = createServer(app);
  setupRooms(httpServer);

  return httpServer;
}
