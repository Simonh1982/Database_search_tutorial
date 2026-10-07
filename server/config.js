// Runtime configuration, read from environment variables.
// In a Codespace these can be set as Codespaces secrets or in the terminal
// before running `npm start`, e.g. `AI_PROVIDER=github-models npm start`.

function list(value, fallback) {
  return (value ?? fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function int(value, fallback) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function loadConfig(env = process.env) {
  const repo = env.GITHUB_REPOSITORY || "Simonh1982/Database_search_tutorial";
  const [owner, name] = repo.split("/");
  const pagesUrl = env.PAGES_URL || `https://${owner.toLowerCase()}.github.io/${name}/`;

  return {
    port: int(env.PORT, 3000),

    // Providers are tried in order; the first one that starts is used.
    // "copilot"       – GitHub Copilot SDK, billed to the signed-in Copilot user
    // "github-models" – GitHub Models API using GITHUB_TOKEN (automatic in Codespaces)
    // "mock"          – canned responses, no AI (for development and tests)
    providers: list(env.AI_PROVIDER, "copilot,github-models"),

    copilot: {
      token: env.COPILOT_GITHUB_TOKEN || "",
      model: env.COPILOT_MODEL || "",
    },
    githubModels: {
      token: env.GITHUB_MODELS_TOKEN || env.GITHUB_TOKEN || "",
      model: env.GITHUB_MODELS_MODEL || "openai/gpt-4.1-mini",
      endpoint: env.GITHUB_MODELS_ENDPOINT || "https://models.github.ai/inference/chat/completions",
    },
    ncbiApiKey: env.NCBI_API_KEY || "",

    // Who may call the API from a browser. The Pages site and local use are allowed by default.
    allowedOrigins: list(env.ALLOWED_ORIGINS, `${new URL(pagesUrl).origin},http://localhost:3000,http://127.0.0.1:3000`),
    pagesUrl,

    // Guard rails so a public link cannot use up your Copilot allowance.
    passcode: env.DEMO_PASSCODE || "",
    aiPerIpLimit: int(env.AI_PER_IP_LIMIT, 40),        // AI requests per visitor...
    aiPerIpWindowMinutes: int(env.AI_PER_IP_WINDOW, 60), // ...per this many minutes
    aiDailyLimit: int(env.AI_DAILY_LIMIT, 300),        // AI requests per day, all visitors combined
    lookupPerIpPerMinute: int(env.LOOKUP_PER_MINUTE, 60),

    codespaceName: env.CODESPACE_NAME || "",
    portForwardingDomain: env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || "app.github.dev",
  };
}

// The public URL of this server when it runs in a Codespace (port must be set to Public).
export function codespaceUrl(config) {
  if (!config.codespaceName) return "";
  return `https://${config.codespaceName}-${config.port}.${config.portForwardingDomain}`;
}
