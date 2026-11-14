// The bundled catalog of the 100 most popular MCP connectors. Every local entry
// was verified against npm or PyPI; every remote entry is an official hosted
// endpoint documented by its vendor. Names follow validateMcp's rules so each
// entry can be added as an MCP server without edits. Adding one still goes
// through the confirmation dialog: Relay never runs a command silently.
import type { ConnectorCatalogEntry } from '../shared/contracts.js';

export interface CatalogConnector {
  id: string;
  name: string;
  description: string;
  category: string;
  type: 'local' | 'remote';
  command?: string[];
  url?: string;
}

const NPX = (pkg: string): string[] => ['npx', '-y', pkg];
const UVX = (pkg: string): string[] => ['uvx', pkg];

export const CONNECTOR_CATALOG: CatalogConnector[] = [
  // Development
  { id: 'filesystem', name: 'Filesystem', description: 'Read, write, and search files and folders on this Mac with configurable access boundaries.', category: 'Development', type: 'local', command: [...NPX('@modelcontextprotocol/server-filesystem'), '.'] },
  { id: 'git', name: 'Git', description: 'Work with Git repositories: status, diffs, log, branches, and commits.', category: 'Development', type: 'local', command: UVX('mcp-server-git') },
  { id: 'github', name: 'GitHub', description: 'The official GitHub server: issues, pull requests, code search, Actions runs, and security alerts over OAuth.', category: 'Development', type: 'remote', url: 'https://api.githubcopilot.com/mcp/' },
  { id: 'gitlab', name: 'GitLab', description: 'Work with GitLab projects, merge requests, issues, pipelines, and releases.', category: 'Development', type: 'local', command: NPX('@zereight/mcp-gitlab') },
  { id: 'azure-devops', name: 'AzureDevOps', description: 'The Azure DevOps reference server: work items, pull requests, and builds.', category: 'Development', type: 'local', command: NPX('mcp-server-azure-devops') },
  { id: 'fetch', name: 'Fetch', description: 'Fetch any web page and convert it to clean markdown for the agent to read.', category: 'Development', type: 'local', command: UVX('mcp-server-fetch') },
  { id: 'memory', name: 'Memory', description: 'A persistent knowledge graph the agent can record facts in and recall across tasks.', category: 'Development', type: 'local', command: NPX('@modelcontextprotocol/server-memory') },
  { id: 'sequential-thinking', name: 'SequentialThinking', description: 'Structured step-by-step thinking for planning and problem solving.', category: 'Development', type: 'local', command: NPX('@modelcontextprotocol/server-sequential-thinking') },
  { id: 'desktop-commander', name: 'DesktopCommander', description: 'Terminal commands and file editing with fuzzy search across this Mac.', category: 'Development', type: 'local', command: NPX('@wonderwhy-er/desktop-commander') },
  { id: 'commands', name: 'Commands', description: 'Run shell commands as agent tools with output capture.', category: 'Development', type: 'local', command: NPX('mcp-server-commands') },
  { id: 'gitingest', name: 'GitIngester', description: 'Turn a Git repository into a text digest of its code and docs sized for a model.', category: 'Development', type: 'local', command: NPX('gitingest-mcp') },
  { id: 'linear-local', name: 'LinearLocal', description: 'Work with Linear issues, projects, and cycles using your own API key.', category: 'Development', type: 'local', command: NPX('mcp-linear') },
  { id: 'time', name: 'Time', description: 'Current time lookups and timezone conversion.', category: 'Development', type: 'local', command: UVX('mcp-server-time') },
  { id: 'next-devtools', name: 'NextjsDevtools', description: 'Next.js development helpers: route inspection, docs search, and runtime checks.', category: 'Development', type: 'local', command: NPX('next-devtools-mcp') },
  { id: 'mermaid', name: 'Mermaid', description: 'Generate Mermaid diagrams and charts from descriptions.', category: 'Development', type: 'local', command: NPX('mcp-mermaid') },
  { id: 'calculator', name: 'Calculator', description: 'Exact arithmetic evaluation so math in the middle of a task stays correct.', category: 'Development', type: 'local', command: UVX('mcp-server-calculator') },

  // Browsers & testing
  { id: 'playwright', name: 'Playwright', description: 'Drive a real browser: navigate, click, fill forms, and take accessibility snapshots.', category: 'Browsers & testing', type: 'local', command: NPX('@playwright/mcp@latest') },
  { id: 'puppeteer', name: 'Puppeteer', description: 'Browser automation and screenshots with a headless Chrome.', category: 'Browsers & testing', type: 'local', command: NPX('@modelcontextprotocol/server-puppeteer') },
  { id: 'chrome-devtools', name: 'ChromeDevTools', description: 'Control Chrome through DevTools: inspect the DOM, trace performance, and profile pages.', category: 'Browsers & testing', type: 'local', command: NPX('chrome-devtools-mcp@latest') },
  { id: 'browserbase', name: 'Browserbase', description: 'Cloud browser automation with proxies and stealth sessions.', category: 'Browsers & testing', type: 'local', command: NPX('@browserbasehq/mcp') },
  { id: 'selenium', name: 'Selenium', description: 'Web automation through Selenium WebDriver.', category: 'Browsers & testing', type: 'local', command: UVX('mcp-server-selenium') },
  { id: 'everything', name: 'Everything', description: 'The reference demo server that exercises every MCP feature, handy for testing setups.', category: 'Browsers & testing', type: 'local', command: NPX('@modelcontextprotocol/server-everything') },

  // Communication
  { id: 'slack', name: 'Slack', description: 'Read channels and send messages in your Slack workspace over OAuth.', category: 'Communication', type: 'remote', url: 'https://mcp.slack.com/mcp' },
  { id: 'discord', name: 'Discord', description: 'Read and manage Discord servers, channels, and messages.', category: 'Communication', type: 'local', command: NPX('discord-mcp') },
  { id: 'telegram', name: 'Telegram', description: 'Read and send Telegram messages through your account.', category: 'Communication', type: 'local', command: UVX('mcp-telegram') },
  { id: 'gmail', name: 'Gmail', description: 'Read, draft, and send Gmail with an automatic OAuth setup.', category: 'Communication', type: 'local', command: NPX('@gongrzhe/server-gmail-autoauth-mcp') },
  { id: 'intercom', name: 'Intercom', description: 'Customer conversations and the support inbox from Intercom over OAuth.', category: 'Communication', type: 'remote', url: 'https://mcp.intercom.com/mcp' },
  { id: 'twilio', name: 'Twilio', description: 'Send SMS and manage Twilio messaging over OAuth.', category: 'Communication', type: 'remote', url: 'https://mcp.twilio.com/mcp' },

  // Productivity & knowledge
  { id: 'notion', name: 'Notion', description: 'Search, read, and write Notion pages and databases over OAuth.', category: 'Productivity & knowledge', type: 'remote', url: 'https://mcp.notion.com/mcp' },
  { id: 'notion-local', name: 'NotionLocal', description: 'Work with Notion using your own integration token instead of OAuth.', category: 'Productivity & knowledge', type: 'local', command: NPX('@suekou/mcp-notion-server') },
  { id: 'linear', name: 'Linear', description: 'The official Linear server: issues, projects, and cycles over OAuth.', category: 'Productivity & knowledge', type: 'remote', url: 'https://mcp.linear.app/mcp' },
  { id: 'asana', name: 'Asana', description: 'Tasks, projects, and portfolios in Asana over OAuth.', category: 'Productivity & knowledge', type: 'remote', url: 'https://mcp.asana.com/sse' },
  { id: 'atlassian', name: 'Atlassian', description: 'Jira issues and Confluence pages through Atlassian\u2019s hosted server.', category: 'Productivity & knowledge', type: 'remote', url: 'https://mcp.atlassian.com/v2/mcp' },
  { id: 'trello', name: 'Trello', description: 'Boards, lists, and cards in Trello.', category: 'Productivity & knowledge', type: 'local', command: NPX('mcp-trello') },
  { id: 'todoist', name: 'Todoist', description: 'Tasks, projects, and labels in Todoist.', category: 'Productivity & knowledge', type: 'local', command: NPX('todoist-mcp') },
  { id: 'airtable', name: 'Airtable', description: 'Read and write records in Airtable bases.', category: 'Productivity & knowledge', type: 'local', command: NPX('airtable-mcp-server') },
  { id: 'obsidian', name: 'Obsidian', description: 'Read and search notes in your Obsidian vaults.', category: 'Productivity & knowledge', type: 'local', command: NPX('mcp-obsidian') },
  { id: 'apple-notes', name: 'AppleNotes', description: 'Read, search, and create notes in the Apple Notes app.', category: 'Productivity & knowledge', type: 'local', command: NPX('apple-notes-mcp') },
  { id: 'apple-reminders', name: 'AppleReminders', description: 'Create and complete reminders in the Apple Reminders app.', category: 'Productivity & knowledge', type: 'local', command: NPX('apple-reminders-mcp') },
  { id: 'google-calendar', name: 'GoogleCalendar', description: 'Read and create events in Google Calendar.', category: 'Productivity & knowledge', type: 'local', command: NPX('mcp-google-calendar') },
  { id: 'google-drive', name: 'GoogleDrive', description: 'Search and read files in your Google Drive.', category: 'Productivity & knowledge', type: 'local', command: NPX('@modelcontextprotocol/server-gdrive') },
  { id: 'zapier', name: 'Zapier', description: 'Reach thousands of Zapier app actions from a single server.', category: 'Productivity & knowledge', type: 'remote', url: 'https://mcp.zapier.com/api/mcp/mcp' },
  { id: 'box', name: 'Box', description: 'Search and manage files in Box over OAuth.', category: 'Productivity & knowledge', type: 'remote', url: 'https://mcp.box.com' },

  // Databases
  { id: 'postgres', name: 'Postgres', description: 'Inspect schemas and run read-only SQL against PostgreSQL.', category: 'Databases', type: 'local', command: NPX('@modelcontextprotocol/server-postgres') },
  { id: 'mysql', name: 'MySQL', description: 'Query MySQL databases with schema browsing and SQL.', category: 'Databases', type: 'local', command: NPX('@benborla29/mcp-server-mysql') },
  { id: 'sqlite', name: 'SQLite', description: 'Query and analyze a local SQLite database file.', category: 'Databases', type: 'local', command: UVX('mcp-server-sqlite') },
  { id: 'mongodb', name: 'MongoDB', description: 'Query MongoDB collections and documents with the official server.', category: 'Databases', type: 'local', command: NPX('mongodb-mcp-server') },
  { id: 'clickhouse', name: 'ClickHouse', description: 'Run SQL and inspect data in ClickHouse.', category: 'Databases', type: 'local', command: NPX('clickhouse-mcp-server') },
  { id: 'duckdb', name: 'DuckDB', description: 'Query and analyze local CSV and Parquet files with DuckDB.', category: 'Databases', type: 'local', command: UVX('duckdb-mcp-server') },
  { id: 'elasticsearch', name: 'Elasticsearch', description: 'Search and manage documents in Elasticsearch indices.', category: 'Databases', type: 'local', command: NPX('@elastic/mcp-server-elasticsearch') },
  { id: 'redis', name: 'Redis', description: 'Manage Redis keys, data structures, and clusters.', category: 'Databases', type: 'local', command: NPX('mcp-redis') },
  { id: 'snowflake', name: 'Snowflake', description: 'Run SQL against Snowflake warehouses.', category: 'Databases', type: 'local', command: UVX('mcp_snowflake_server') },
  { id: 'bigquery', name: 'BigQuery', description: 'Query Google BigQuery datasets.', category: 'Databases', type: 'local', command: UVX('bigquery-mcp-server') },
  { id: 'supabase', name: 'Supabase', description: 'Manage Supabase projects, tables, and edge functions over OAuth.', category: 'Databases', type: 'remote', url: 'https://mcp.supabase.com/mcp' },
  { id: 'neon', name: 'Neon', description: 'Manage Neon Postgres databases, branches, and migrations over OAuth.', category: 'Databases', type: 'remote', url: 'https://mcp.neon.com/mcp' },

  // Search & research
  { id: 'brave-search', name: 'BraveSearch', description: 'Web search through the Brave Search API. Needs a free API key from Brave.', category: 'Search & research', type: 'local', command: NPX('@modelcontextprotocol/server-brave-search') },
  { id: 'exa', name: 'Exa', description: 'Neural web search and content retrieval from Exa over OAuth.', category: 'Search & research', type: 'remote', url: 'https://mcp.exa.ai/mcp' },
  { id: 'exa-local', name: 'ExaLocal', description: 'Exa web search with your own API key instead of OAuth.', category: 'Search & research', type: 'local', command: NPX('exa-mcp-server') },
  { id: 'tavily', name: 'Tavily', description: 'Deep web search and extraction tuned for agents.', category: 'Search & research', type: 'remote', url: 'https://mcp.tavily.com/mcp' },
  { id: 'tavily-local', name: 'TavilyLocal', description: 'Tavily search with your own API key instead of OAuth.', category: 'Search & research', type: 'local', command: NPX('tavily-mcp') },
  { id: 'perplexity', name: 'Perplexity', description: 'Ask Perplexity for researched answers with citations.', category: 'Search & research', type: 'remote', url: 'https://mcp.perplexity.ai/mcp' },
  { id: 'duckduckgo', name: 'DuckDuckGo', description: 'Search the web with DuckDuckGo, no API key needed.', category: 'Search & research', type: 'local', command: NPX('duckduckgo-mcp-server') },
  { id: 'arxiv', name: 'Arxiv', description: 'Search and read academic papers on arXiv.', category: 'Search & research', type: 'local', command: UVX('arxiv-mcp-server') },
  { id: 'wikipedia', name: 'Wikipedia', description: 'Search and read Wikipedia articles.', category: 'Search & research', type: 'local', command: UVX('mcp-server-wikipedia') },
  { id: 'firecrawl', name: 'Firecrawl', description: 'Scrape, crawl, and extract clean markdown from any website.', category: 'Search & research', type: 'local', command: NPX('firecrawl-mcp') },
  { id: 'context7', name: 'Context7', description: 'Up-to-date documentation for thousands of libraries and frameworks.', category: 'Search & research', type: 'remote', url: 'https://mcp.context7.com/mcp' },
  { id: 'context7-local', name: 'Context7Local', description: 'Library documentation lookups with your own Context7 API key.', category: 'Search & research', type: 'local', command: NPX('@upstash/context7-mcp') },
  { id: 'deepwiki', name: 'DeepWiki', description: 'Ask questions about any public GitHub repository, no sign-in needed.', category: 'Search & research', type: 'remote', url: 'https://mcp.deepwiki.com/mcp' },
  { id: 'huggingface', name: 'HuggingFace', description: 'Search models, datasets, and spaces on Hugging Face.', category: 'Search & research', type: 'remote', url: 'https://huggingface.co/mcp' },
  { id: 'google-maps', name: 'GoogleMaps', description: 'Places, directions, and distances through the Google Maps API.', category: 'Search & research', type: 'local', command: NPX('@modelcontextprotocol/server-google-maps') },
  { id: 'hacker-news', name: 'HackerNews', description: 'Read stories and comments from Hacker News.', category: 'Search & research', type: 'local', command: NPX('mcp-hacker-news') },
  { id: 'reddit', name: 'Reddit', description: 'Read posts and comments from Reddit.', category: 'Search & research', type: 'local', command: NPX('mcp-reddit') },

  // Cloud & DevOps
  { id: 'sentry', name: 'Sentry', description: 'Query errors, stack traces, and release health from Sentry over OAuth.', category: 'Cloud & DevOps', type: 'remote', url: 'https://mcp.sentry.dev/mcp' },
  { id: 'cloudflare', name: 'Cloudflare', description: 'Manage the whole Cloudflare API over OAuth.', category: 'Cloud & DevOps', type: 'remote', url: 'https://mcp.cloudflare.com/mcp' },
  { id: 'cloudflare-local', name: 'CloudflareLocal', description: 'Manage Cloudflare with your own API token instead of OAuth.', category: 'Cloud & DevOps', type: 'local', command: NPX('@cloudflare/mcp-server-cloudflare') },
  { id: 'cloudflare-docs', name: 'CloudflareDocs', description: 'Search Cloudflare developer documentation.', category: 'Cloud & DevOps', type: 'remote', url: 'https://docs.mcp.cloudflare.com/mcp' },
  { id: 'vercel', name: 'Vercel', description: 'Deployments, projects, and logs on Vercel.', category: 'Cloud & DevOps', type: 'remote', url: 'https://mcp.vercel.com' },
  { id: 'netlify', name: 'Netlify', description: 'Manage Netlify sites, deploys, and functions.', category: 'Cloud & DevOps', type: 'remote', url: 'https://netlify-mcp.netlify.app/mcp' },
  { id: 'kubernetes', name: 'Kubernetes', description: 'Work with Kubernetes clusters through kubectl.', category: 'Cloud & DevOps', type: 'local', command: NPX('mcp-server-kubernetes') },
  { id: 'docker', name: 'Docker', description: 'Manage containers, images, and volumes through Docker.', category: 'Cloud & DevOps', type: 'local', command: NPX('mcp-server-docker') },
  { id: 'grafana', name: 'Grafana', description: 'Query dashboards and incidents from Grafana.', category: 'Cloud & DevOps', type: 'remote', url: 'https://mcp.grafana.com/mcp' },
  { id: 'firebase', name: 'Firebase', description: 'Work with Firestore and Firebase services.', category: 'Cloud & DevOps', type: 'local', command: NPX('@gannonh/firebase-mcp') },
  { id: 'aws-core', name: 'AWSCore', description: 'AWS account context, documentation search, and regional info.', category: 'Cloud & DevOps', type: 'local', command: UVX('awslabs-core-mcp-server') },
  { id: 'aws-cdk', name: 'AWSCdk', description: 'AWS CDK guidance, examples, and construct documentation.', category: 'Cloud & DevOps', type: 'local', command: UVX('awslabs-cdk-mcp-server') },
  { id: 'aws-cost', name: 'AWSCost', description: 'Analyze AWS costs through Cost Explorer.', category: 'Cloud & DevOps', type: 'local', command: UVX('awslabs-cost-explorer-mcp-server') },
  { id: 's3', name: 'S3', description: 'List buckets, browse objects, and upload files to S3.', category: 'Cloud & DevOps', type: 'local', command: NPX('mcp-server-s3') },
  { id: 'github-actions', name: 'GitHubActions', description: 'View workflow runs, read logs, and re-run GitHub Actions.', category: 'Cloud & DevOps', type: 'local', command: NPX('mcp-server-github-actions') },
  { id: 'home-assistant', name: 'HomeAssistant', description: 'Check and control devices in your Home Assistant smart home.', category: 'Cloud & DevOps', type: 'local', command: UVX('mcp-server-home-assistant') },

  // Design & media
  { id: 'figma', name: 'Figma', description: 'Design file context from Figma for coding agents over OAuth.', category: 'Design & media', type: 'remote', url: 'https://mcp.figma.com/mcp' },
  { id: 'figma-developer', name: 'FigmaDeveloper', description: 'Read Figma frames code-first with your own API token.', category: 'Design & media', type: 'local', command: NPX('figma-developer-mcp') },
  { id: 'canva', name: 'Canva', description: 'Search designs and export assets from Canva over OAuth.', category: 'Design & media', type: 'remote', url: 'https://mcp.canva.com/mcp' },
  { id: 'blender', name: 'Blender', description: 'Create and edit 3D scenes in Blender.', category: 'Design & media', type: 'local', command: UVX('blender-mcp') },
  { id: 'spotify', name: 'Spotify', description: 'Control playback and manage playlists through the Spotify Web API.', category: 'Design & media', type: 'local', command: NPX('spotify-mcp') },
  { id: 'youtube', name: 'YouTube', description: 'Search videos and work with your YouTube integrations.', category: 'Design & media', type: 'local', command: NPX('mcp-server-youtube') },
  { id: 'youtube-transcript', name: 'YouTubeTranscript', description: 'Fetch transcripts of YouTube videos.', category: 'Design & media', type: 'local', command: NPX('@kimtaeyoon83/mcp-server-youtube-transcript') },

  // Business & commerce
  { id: 'stripe', name: 'Stripe', description: 'Customers, payments, subscriptions, and invoice queries over OAuth.', category: 'Business & commerce', type: 'remote', url: 'https://mcp.stripe.com' },
  { id: 'paypal', name: 'PayPal', description: 'Payments, invoicing, and disputes through PayPal\u2019s hosted server.', category: 'Business & commerce', type: 'remote', url: 'https://mcp.paypal.com/mcp' },
  { id: 'shopify', name: 'Shopify', description: 'Shopify developer documentation and storefront helpers.', category: 'Business & commerce', type: 'remote', url: 'https://shopify.dev/mcp' },
  { id: 'hubspot', name: 'HubSpot', description: 'CRM contacts, companies, and deals over OAuth.', category: 'Business & commerce', type: 'remote', url: 'https://mcp.hubspot.com/anthropic' },
  { id: 'qrcodes', name: 'QRCodes', description: 'Generate QR codes as SVG strings or PNG data URLs.', category: 'Business & commerce', type: 'local', command: NPX('mcp-server-qrcode') },
];

export function connectorCatalogCategories(): string[] {
  const seen = new Set<string>();
  for (const entry of CONNECTOR_CATALOG) seen.add(entry.category);
  return [...seen];
}

// The view the renderer gets: catalog rows plus which server names are already configured.
export function catalogView(entries: CatalogConnector[], configuredNames: ReadonlySet<string>): ConnectorCatalogEntry[] {
  return entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    category: entry.category,
    type: entry.type,
    command: entry.command,
    url: entry.url,
    configured: configuredNames.has(entry.name),
  }));
}
