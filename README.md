# Enron Archive Search System

Centralized search system for the Enron Archive restoration project. Provides full-text search across multiple Enron subsidiary websites while maintaining IE5 compatibility and original 2001-era UI/UX. A part of the **Enron Archive**.

## Features

- Full-text search across all Enron subsidiary sites
- **TF-IDF ranking** for relevance-based results
- **Phrase search** support with quoted queries (e.g., `"press release"`)
- Porter stemming for intelligent word matching
- **Highlighted search terms** in result snippets
- Filter by operating company or search all
- **Modified date extraction** from HTML metadata
- IE5-compatible (uses XMLHttpRequest, no ES6 features)
- Original AltaVista-style results page
- Serverless API via Netlify Functions

## Project Structure

```
enron-search/
├── src/                    Build scripts
│   ├── build-index.js      Generates search index from all repos
├── functions/              Netlify Functions (serverless API)
│   └── search.js           Search API endpoint
├── public/                 Website files (published by Netlify)
│   ├── index.html          Search form page
│   ├── results.html        Search results page
│   └── search-index.json   Generated search index
├── netlify.toml            Netlify build configuration
├── repos.config.json       Repository index configuration
└── package.json            NPM dependencies and scripts
```

## Development

### Prerequisites

- Node.js 18+
- Git (for cloning repositories)
- Internet access (to clone repos from GitHub)

### Setup

```bash
npm install
```

### Building the Index

```bash
npm run build
```

This will:
1. Clone/pull all configured Enron repos from GitHub (into `repos/` directory)
2. Crawl all HTML files in each repository
3. Extract and tokenize content
4. Apply Porter stemming
5. Build inverted index
6. Output to `public/search-index.json`

Note: Cloned repositories are stored in `repos/` which is git-ignored and deleted after deployment.

### Rebuilding the Index After Content Changes

If pages are updated or added in any source repo, trigger a rebuild on Netlify to update search results:

1. Update content in the source repository (e.g., push new HTML files to GitHub)
2. Trigger a rebuild in Netlify:
   - Go to the Deploys tab
   - Click "Trigger deploy" → "Deploy site"
3. Netlify will automatically clone the latest repo versions and rebuild the index

Notes:
- The index is generated from GitHub repository files specified in `repos.config.json`
- The `repos/` directory is created during build and automatically cleaned up after deployment
- No local repository clones are required; everything is pulled from GitHub during the build process
- If adding a new repository, update `repos.config.json` first (ensure the `repoName` matches the GitHub repo name)

### Testing

Use the testing procedures in the consolidated documentation section below.

### Local Development

The site is designed to be deployed on Netlify. For local testing:

1. Build the index: `npm run build`
2. Use Netlify CLI: `netlify dev`
3. Visit `http://localhost:8888` to access the search form
4. Search results will call the serverless function at `/api/search`

## Search Usage

### Via Web Interface

1. Visit the search form at `index.html`
2. Choose a search option:
   - **Search all of Enron** - searches across all repositories
   - **Search by operating company** - filter by specific subsidiary
   - **Search Press Releases only** - PR content only
3. Enter keywords and click Search
4. Results display with title, URL, breadcrumb, highlighted snippet, modified date, and file size

### Search Features

**Phrase Search:**
- Use quotes for exact phrase matching: `"enron energy services"`
- Without quotes, finds documents containing any of the words

**Stemming:**
- Searches automatically find word variants
- Example: searching "running" will also find "run", "runner", "runs"

**Highlighting:**
- Search terms are **bolded** in result snippets
- Context shown around matched terms

**Ranking:**
- Results ranked by relevance using TF-IDF algorithm
- Documents with more/rarer query terms appear first

### Via API

Direct API calls:
```
GET /api/search?q=energy
GET /api/search?q=press+release&filter=corp
GET /api/search?q=announce&filter=pr
GET /api/search?q="exact+phrase"     # Phrase search with quotes
```

Query Parameters:
- `q` (required) - Search query
  - Regular terms will be stemmed automatically
  - Use quotes for exact phrase matching: `"press release"`
- `filter` (optional) - Filter by tag: `all`, `corp`, `pr`, `ees`, `ect`, `ets`, `fgt`, `wind`, `credit`, `direct`, `direct-canada`, `direct-spain`

Response format:
```json
{
  "query": "energy",
  "filter": "all",
  "total": 1136,
  "results": [
    {
      "title": "Page Title",
      "url": "https://enronarchive.org/corp/path/to/page.html",
      "breadcrumb": "Section > Subsection",
      "snippet": "Context with <b>highlighted</b> terms...",
      "size": 12345,
      "modified": "28-Feb-2002",
      "tags": ["all", "corp"]
    }
  ]
}
```

**Note:** Snippets may contain HTML `<b>` tags for highlighting matched terms.

## Indexed Repositories

- **Enron Corp. Website**
- **Enron Energy Services**
- **Enron Wholesale Services**
- **Enron Transportation Services**
- **Enron Credit**
- **Enron Direct**

## Configuration

Edit `repos.config.json` to add/remove repositories from the index.
Edit `url-mappings.json` to configure deployed URL mappings.

## Deployment

Deploys automatically to Netlify on push to main branch.

Build command: `node src/build-index.js`  
Publish directory: `public`

---

## License

Archival project for historical research. Original content © their respective owners.

## About the Enron Archive
The Enron Archive aims to preserve the information about Enron Corp. and its activities worldwide before the company's eventual demise. For more information, visit https://enronarchive.org