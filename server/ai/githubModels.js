// GitHub Models provider (https://docs.github.com/en/github-models).
// In a Codespace, GITHUB_TOKEN is set automatically and usage counts against that user's allowance.

export function createGitHubModelsProvider({ token = "", model, endpoint, fetchImpl = fetch } = {}) {
  return {
    name: "github-models",
    model,
    account: "",

    async start() {
      if (!token) throw new Error("No GITHUB_TOKEN is set, so GitHub Models can't be used.");
    },

    async complete({ system, user }) {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: AbortSignal.timeout(90_000),
      });

      if (res.status === 429) throw new Error("The GitHub Models rate limit has been reached. Please try again later.");
      if (res.status === 401 || res.status === 403) throw new Error("GitHub Models refused the token. Check it has the models permission.");
      if (!res.ok) throw new Error(`GitHub Models returned an error (${res.status}).`);

      const data = await res.json();
      return data?.choices?.[0]?.message?.content ?? "";
    },

    async stop() {},
  };
}
