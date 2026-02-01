const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const cheerio = require('cheerio');
const stemmer = require('porter-stemmer').stemmer;

const execAsync = promisify(exec);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

// Configuration
const REPOS_CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '../repos.config.json'), 'utf8'));
const REPOS_DIR = path.join(__dirname, '../repos');
const DIST_DIR = path.join(__dirname, '../public');
const GITHUB_ORG = 'enronarchive';
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'have', 'has',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she',
  'it', 'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how'
]);

let documentId = 0;
const documents = [];
const invertedIndex = {};

// Ensure directories exist
if (!fs.existsSync(REPOS_DIR)) fs.mkdirSync(REPOS_DIR, { recursive: true });
if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });

/**
 * Clone or update repository from GitHub
 */
async function ensureRepoCloned(repo) {
  const repoPath = path.join(REPOS_DIR, repo.id);
  
  if (fs.existsSync(repoPath)) {
    console.log(`Repository ${repo.id} already exists, pulling latest...`);
    try {
      await execAsync(`git -C "${repoPath}" pull origin main`);
    } catch (err) {
      console.warn(`Warning: Could not pull updates for ${repo.id}:`, err.message);
    }
  } else {
    console.log(`Cloning repository ${repo.id}...`);
    const repoUrl = `https://github.com/${GITHUB_ORG}/${repo.repoName}.git`;
    try {
      await execAsync(`git clone "${repoUrl}" "${repoPath}"`);
    } catch (err) {
      throw new Error(`Failed to clone ${repo.id} from ${repoUrl}: ${err.message}`);
    }
  }
  
  return repoPath;
}

/**
 * Resolve repository path
 */
function resolveRepoPath(repo) {
  // Return the path where the repo should be/is cloned
  return path.join(REPOS_DIR, repo.id);
}

/**
 * Extract modified date from HTML metadata
 */
function extractModifiedDate(html, filePath) {
  const $ = cheerio.load(html);
  
  // Try meta tags first
  let modified = $('meta[name="last-modified"]').attr('content') ||
                $('meta[name="date"]').attr('content') ||
                $('meta[http-equiv="last-modified"]').attr('content');
  
  // Try to find date in HTML comments (common pattern)
  if (!modified) {
    const comments = $('*').contents().filter(function() {
      return this.type === 'comment';
    }).toArray();
    
    for (const comment of comments) {
      const text = comment.data;
      // Look for date patterns like "28-Feb-2002" or "Feb 28, 2002"
      const dateMatch = text.match(/(\d{1,2}[-\/]\w{3}[-\/]\d{2,4})|(\w{3}\s+\d{1,2},?\s+\d{4})/);
      if (dateMatch) {
        modified = dateMatch[0];
        break;
      }
    }
  }
  
  // Fallback to file system modified time
  if (!modified) {
    try {
      const stats = fs.statSync(filePath);
      const date = new Date(stats.mtime);
      modified = date.toLocaleDateString('en-US', { 
        day: '2-digit', 
        month: 'short', 
        year: 'numeric' 
      });
    } catch (e) {
      modified = 'N/A';
    }
  }
  
  return modified;
}

/**
 * Extract text content from HTML, removing scripts and styles
 */
function extractText(html) {
  const $ = cheerio.load(html);
  
  // Remove script and style elements
  $('script').remove();
  $('style').remove();
  
  // Get text content
  let text = $.text();
  
  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

/**
 * Extract title from HTML
 */
function extractTitle(html) {
  const $ = cheerio.load(html);
  
  // Try <title> first
  let title = $('title').text().trim();
  
  // Fallback to first h1
  if (!title) {
    title = $('h1').first().text().trim();
  }
  
  // Fallback to generic
  if (!title) {
    title = 'Untitled Document';
  }
  
  return title;
}

/**
 * Extract breadcrumb/path from HTML (best effort)
 */
function extractBreadcrumb(html, urlPath) {
  const $ = cheerio.load(html);
  
  // Look for breadcrumb element
  let breadcrumb = $('.breadcrumb').text().trim();
  if (!breadcrumb) {
    breadcrumb = $('[class*="bread"]').text().trim();
  }
  
  // Fallback to URL path
  if (!breadcrumb) {
    breadcrumb = urlPath.split('/').filter(p => p).join(' > ');
  }
  
  return breadcrumb || urlPath;
}

/**
 * Tokenize and stem text
 */
function tokenizeAndStem(text) {
  // Convert to lowercase and split into words
  const tokens = text.toLowerCase().match(/\b\w+\b/g) || [];
  
  // Filter stop words and stem
  return tokens
    .filter(token => token.length > 2 && !STOP_WORDS.has(token))
    .map(token => stemmer(token));
}

/**
 * Index a single HTML file
 */
async function indexFile(filePath, basePath, repoId, tags) {
  try {
    const html = await readFile(filePath, 'utf8');
    const relativePath = path.relative(basePath, filePath);
    const urlPath = '/' + relativePath.replace(/\\/g, '/').replace(/index\.html$/, '');
    
    const title = extractTitle(html);
    const text = extractText(html);
    const breadcrumb = extractBreadcrumb(html, urlPath);
    const modified = extractModifiedDate(html, filePath);
    const tokens = tokenizeAndStem(text);
    
    if (tokens.length === 0) {
      // Skip documents with no indexable content
      return;
    }
    
    const docId = documentId++;
    
    // Create document entry
    documents.push({
      id: docId,
      url: urlPath,
      title: title,
      snippet: text.substring(0, 200) + '...',
      text: text,
      breadcrumb: breadcrumb,
      modified: modified,
      size: html.length,
      tags: tags,
      repoId: repoId
    });
    
    // Add to inverted index
    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      if (!invertedIndex[token]) {
        invertedIndex[token] = [];
      }
      if (Array.isArray(invertedIndex[token])) {
        invertedIndex[token].push(docId);
      }
    }
    
    console.log(`    Indexed: ${urlPath}`);
  } catch (e) {
    console.warn(`    Error indexing ${filePath}:`, e.message);
  }
}

/**
 * Recursively crawl directory for HTML files
 */
async function crawlDirectory(dir, basePath, repoId, tags, ignore = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(basePath, fullPath);
    
    // Check ignore patterns
    if (ignore.some(pattern => relativePath.includes(pattern))) {
      continue;
    }
    
    if (entry.isDirectory()) {
      await crawlDirectory(fullPath, basePath, repoId, tags, ignore);
    } else if (entry.name.endsWith('.html')) {
      await indexFile(fullPath, basePath, repoId, tags);
    }
  }
}

/**
 * Index a single repository
 */
async function indexRepo(repo) {
  console.log(`\nIndexing ${repo.name}...`);
  
  // Ensure repository is cloned
  const repoPath = await ensureRepoCloned(repo);
  
  const ignore = repo.ignore || [];
  await crawlDirectory(repoPath, repoPath, repo.id, repo.tags, ignore);
}

/**
 * Build the complete index
 */
async function buildIndex() {
  console.log('Starting Enron Search Index Build...\n');
  
  // Clone all repositories first
  console.log('Setting up repositories...');
  for (const repo of REPOS_CONFIG.repos.filter(r => !r.parentRepo)) {
    await ensureRepoCloned(repo);
  }
  
  // Index repositories
  console.log('\nIndexing repositories...');
  for (const repo of REPOS_CONFIG.repos.filter(r => !r.parentRepo)) {
    await indexRepo(repo);
  }
  
  // Index sub-paths from parent repos
  for (const repo of REPOS_CONFIG.repos.filter(r => r.parentRepo)) {
    const parentPath = resolveRepoPath(REPOS_CONFIG.repos.find(r => r.id === repo.parentRepo));
    const fullPath = path.join(parentPath, repo.path);
    
    console.log(`\nIndexing ${repo.name}...`);
    if (fs.existsSync(fullPath)) {
      await crawlDirectory(fullPath, parentPath, repo.id, repo.tags, repo.ignore || []);
    } else {
      console.warn(`  Path not found: ${fullPath}`);
    }
  }
  
  // Step 4: Save index
  console.log('\nSaving index...');
  const index = {
    timestamp: new Date().toISOString(),
    totalDocuments: documents.length,
    indexSize: Object.keys(invertedIndex).length,
    documents: documents,
    index: invertedIndex
  };
  
  const indexPath = path.join(DIST_DIR, 'search-index.json');
  await writeFile(indexPath, JSON.stringify(index, null, 2));
  
  // Also copy index to functions directory for Netlify Functions access
  const functionsIndexPath = path.join(__dirname, '../functions/search-index.json');
  await writeFile(functionsIndexPath, JSON.stringify(index, null, 2));
  
  console.log(`\nBuild complete!`);
  console.log(`  Documents indexed: ${documents.length}`);
  console.log(`  Unique terms: ${Object.keys(invertedIndex).length}`);
  console.log(`  Index file: ${indexPath}`);
  console.log(`  Index size: ${(fs.statSync(indexPath).size / 1024 / 1024).toFixed(2)} MB`);
}

// Run the build
buildIndex().catch(e => {
  console.error('Build failed:', e);
  process.exit(1);
});
