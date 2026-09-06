import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  installGateway,
  installSpaFallback,
  type GatewayOptions,
  validateProductionGatewayConfiguration,
} from "./gateway";
import { validateProductionDatabaseGatewayConfiguration } from "@workspace/db";
import { replitAuthSessionMiddleware } from "./middlewares/replit-auth-session";

export function createApp(overrides: GatewayOptions = {}): Express {
  const app: Express = express();
  const production = process.env.NODE_ENV === "production";
  const gatewayEnabled = production
    ? process.env.MULTI_DOMAIN_GATEWAY_ENABLED === "true"
    : (overrides.enabled ?? false);
  const gatewayOptions: GatewayOptions = {
    enabled: gatewayEnabled,
    trustedProxyCidrs: overrides.trustedProxyCidrs ?? process.env.GATEWAY_TRUSTED_PROXY_CIDRS,
    assetsRoot: overrides.assetsRoot,
    interfaceAccessKey: overrides.interfaceAccessKey ?? process.env.INTERFACE_ACCESS_KEY,
    interfaceAllowedIps: overrides.interfaceAllowedIps ?? process.env.INTERFACE_ALLOWED_IPS,
  };
  if (production) {
    validateProductionGatewayConfiguration();
    validateProductionDatabaseGatewayConfiguration();
  }

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
installGateway(app, gatewayOptions);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(replitAuthSessionMiddleware);

app.use("/api", router);
installSpaFallback(app, gatewayOptions);

  return app;
}

export default createApp();
