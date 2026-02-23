# Why not use OpenRouter BYOK?

OpenRouter is a fantastic platform for LLM routing, and their Bring-Your-Own-Key feature is great if you want managed infrastructure. However, it is fundamentally a **server-side proxy**.

Use `byok-vault` instead of OpenRouter BYOK if you are building a **local-first** application and need:

1. **Zero Middlemen:** OpenRouter requires users to store their API keys on OpenRouter's servers, and all API calls are routed through their backend. `byok-vault` keeps the key strictly inside the user's browser. It never touches a server.
2. **Zero Onboarding Friction:** OpenRouter BYOK requires your users to leave your app, create an OpenRouter account, paste their OpenAI/Anthropic key into OpenRouter's dashboard, generate a *new* proxy key, and paste that back into your app. With `byok-vault`, users paste their key directly into your app and start working immediately.
3. **Zero Proxy Fees:** While OpenRouter offers a generous free tier for BYOK, high-volume apps eventually hit a 5% routing tax just to use their own keys. `byok-vault` talks directly to the LLM provider: no proxy, no tax.

