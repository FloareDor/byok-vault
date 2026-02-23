import { defineConfig } from "vitepress";

export default defineConfig({
  title: "byok-vault",
  description: "Browser-native BYOK vault for local-first AI apps.",
  base: "/byok-vault/",
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "Get Started", link: "/guide/getting-started" },
      { text: "Comparison", link: "/guide/comparisons" },
      { text: "API", link: "/guide/api" },
      { text: "GitHub", link: "https://github.com/FloareDor/byok-vault" }
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "Security Notes", link: "/guide/security" },
          { text: "OpenRouter Comparison", link: "/guide/comparisons" },
          { text: "API", link: "/guide/api" }
        ]
      }
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/FloareDor/byok-vault" }
    ],
    footer: {
      message: "Released under MIT.",
      copyright: "Copyright (c) 2026 Ra"
    }
  }
});
