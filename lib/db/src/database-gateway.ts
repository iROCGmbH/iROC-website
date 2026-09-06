import type { DatabaseScope } from "./database-scope";

const scopedUrlEnvironmentNames: Record<DatabaseScope, string> = {
  public: "DATABASE_URL_PUBLIC",
  patients: "DATABASE_URL_PATIENTS",
  doctors: "DATABASE_URL_DOCTORS",
  internal: "DATABASE_URL_INTERNAL",
};

export function isDatabaseGatewayEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.MULTI_DOMAIN_GATEWAY_ENABLED === "true";
}

export function validateProductionDatabaseGatewayConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const internalUrl =
    environment.DATABASE_URL_INTERNAL ?? environment.DATABASE_URL;
  const internalEnvironmentName =
    environment.DATABASE_URL_INTERNAL === undefined
      ? "DATABASE_URL"
      : "DATABASE_URL_INTERNAL";

  if (!internalUrl) {
    throw new Error(
      "DATABASE_URL_INTERNAL or DATABASE_URL must be set for the internal database role.",
    );
  }

  const configuredUrls: Array<[string, string]> = [
    [internalEnvironmentName, internalUrl],
  ];

  for (const scope of ["public", "patients", "doctors"] as const) {
    const environmentName = scopedUrlEnvironmentNames[scope];
    const url = environment[environmentName];

    if (!url) {
      throw new Error(
        `${environmentName} must be set when the database gateway is enabled.`,
      );
    }

    for (const [configuredEnvironmentName, configuredUrl] of configuredUrls) {
      if (url === configuredUrl) {
        throw new Error(
          `${environmentName} must not use the same database connector as ${configuredEnvironmentName}.`,
        );
      }
    }

    configuredUrls.push([environmentName, url]);
  }
}