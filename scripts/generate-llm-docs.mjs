import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const docsRoot = path.join(projectRoot, "docs-site");
const publicRoot = path.join(docsRoot, "public");

const SITE_TITLE = "byok-vault";
const SITE_DESCRIPTION =
  "Browser-native BYOK vault for local-first/serverless AI apps.";
const BASE_URL = "https://floaredor.github.io/byok-vault";

const selectedPages = [
  {
    title: "Getting Started",
    source: "docs-site/guide/getting-started.md",
    url: "/guide/getting-started"
  },
  {
    title: "Security Notes",
    source: "docs-site/guide/security.md",
    url: "/guide/security"
  },
  {
    title: "OpenRouter Comparison",
    source: "docs-site/guide/comparisons.md",
    url: "/guide/comparisons"
  },
  { title: "API", source: "docs-site/guide/api.md", url: "/guide/api" }
];

function stripFrontmatter(markdown) {
  if (!markdown.startsWith("---")) return markdown;
  const end = markdown.indexOf("\n---", 3);
  if (end === -1) return markdown;
  return markdown.slice(end + 4).replace(/^\s*\n/, "");
}

function trimTrailingBlankLines(value) {
  return value.replace(/\s+$/, "") + "\n";
}

async function readPageContent(page) {
  const fullPath = path.join(projectRoot, page.source);
  const raw = await fs.readFile(fullPath, "utf8");
  return stripFrontmatter(raw).trim();
}

function buildLlmsTxt(pages) {
  const lines = [
    `# ${SITE_TITLE}`,
    "",
    SITE_DESCRIPTION,
    "",
    "## LLM-Friendly Docs",
    "",
    `- Canonical merged Markdown: ${BASE_URL}/llms-full.md`,
    "",
    "## Preferred Pages",
    ""
  ];

  for (const page of pages) {
    lines.push(`- ${page.title}: ${BASE_URL}${page.url}`);
  }

  lines.push(
    "",
    "## Guidance For Agents",
    "",
    "- Treat the VitePress docs as canonical for behavior and API shape.",
    "- Prefer `guide/api` for signatures and option defaults.",
    "- Do not claim active XSS protection; this package documents that limitation."
  );

  return trimTrailingBlankLines(lines.join("\n"));
}

function buildLlmsFull(pagesWithContent) {
  const lines = [
    `# ${SITE_TITLE} LLM Docs`,
    "",
    `Source site: ${BASE_URL}`,
    "",
    "This file is generated from VitePress Markdown and intended for LLM ingestion."
  ];

  for (const page of pagesWithContent) {
    lines.push(
      "",
      `## ${page.title}`,
      "",
      `Source: ${BASE_URL}${page.url}`,
      "",
      page.content
    );
  }

  return trimTrailingBlankLines(lines.join("\n"));
}

async function writeFile(targetPath, content) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, "utf8");
}

async function main() {
  const pagesWithContent = [];
  for (const page of selectedPages) {
    const content = await readPageContent(page);
    pagesWithContent.push({ ...page, content });
  }

  const llmsTxt = buildLlmsTxt(selectedPages);
  const llmsFull = buildLlmsFull(pagesWithContent);

  await writeFile(path.join(projectRoot, "llms.txt"), llmsTxt);
  await writeFile(path.join(publicRoot, "llms.txt"), llmsTxt);
  await writeFile(path.join(publicRoot, "llms-full.md"), llmsFull);

  process.stdout.write(
    "Generated LLM docs: llms.txt, docs-site/public/llms.txt, docs-site/public/llms-full.md\n"
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
