/**
 * GET /api/config
 *
 * Returns basic configuration/feature flags.
 * Also used by Frontend-InputForm to read the auth mode and Azure config.
 */
export default async function config(req, res) {
  const smtpAvailable = Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );

  function isEnabled(key) {
    const val = (process.env[key] || "").toLowerCase();
    return val === "true" || val === "1" || val === "yes";
  }

  const azureEnabled = isEnabled("AUTH_AZURE_ENABLED") && Boolean(process.env.AZURE_CLIENT_ID);
  const betterAuthEnabled = isEnabled("AUTH_BETTERAUTH_ENABLED");

  const tenantId = process.env.AZURE_TENANT_ID || "common";

  res.json({
    environment: process.env.NODE_ENV || "development",
    demoMode: process.env.DEMO_MODE === "true",
    features: {
      smtpAvailable,
      authProviders: {
        azure: Boolean(process.env.OIDC_ISSUER),
        auth0: Boolean(process.env.AUTH0_OIDC_ISSUER),
      },
    },
    auth: {
      azure: azureEnabled ? {
        enabled: true,
        clientId: process.env.AZURE_CLIENT_ID,
        tenantId,
        authority: process.env.AZURE_AUTHORITY || `https://login.microsoftonline.com/${tenantId}/v2.0/`,
      } : { enabled: false },
      betterAuth: {
        enabled: betterAuthEnabled,
      },
    },
  });
}
