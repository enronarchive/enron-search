const fs = require('fs');
const path = require('path');
const stemmer = require('porter-stemmer').stemmer;

// Load URL mappings
const URL_MAPPINGS = JSON.parse(fs.readFileSync(path.join(__dirname, '../url-mappings.json'), 'utf8')).urlMappings;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'have', 'has',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she',
  'it', 'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how'
]);

// Cache the index in memory
let searchIndex = null;

function loadIndex() {
  if (searchIndex) return searchIndex;
  
  try {
    const indexPath = path.join(__dirname, '../public/search-index.json');
    const indexData = fs.readFileSync(indexPath, 'utf8');
    searchIndex = JSON.parse(indexData);
    return searchIndex;
  } catch (e) {
    console.error('Failed to load search index:', e);
    return null;
  }
}

function tokenizeQuery(query) {
  // Tokenize and stem query terms
  const tokens = query.toLowerCase().match(/\b\w+\b/g) || [];
  return tokens
    .filter(token => token.length > 2 && !STOP_WORDS.has(token))
    .map(token => stemmer(token));
}

function buildContextSnippet(text, query) {
  if (!text) return '';

  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  // Extract phrase if quoted
  const phraseMatch = query.match(/^"(.+)"$/);
  const searchTerms = phraseMatch 
    ? [phraseMatch[1].toLowerCase()]
    : Array.from(new Set(
        (query.toLowerCase().match(/\b\w+\b/g) || [])
          .filter(token => token.length > 2 && !STOP_WORDS.has(token))
      ));

  if (searchTerms.length === 0) {
    return cleaned.length > 200 ? cleaned.substring(0, 200) + '...' : cleaned;
  }

  const lower = cleaned.toLowerCase();
  const hits = [];

  // Find all occurrences of search terms
  for (const term of searchTerms) {
    let idx = lower.indexOf(term);
    while (idx !== -1) {
      hits.push({ start: idx, end: idx + term.length, term: term });
      idx = lower.indexOf(term, idx + term.length);
    }
  }

  if (hits.length === 0) {
    return cleaned.length > 200 ? cleaned.substring(0, 200) + '...' : cleaned;
  }

  // Sort hits by position
  hits.sort((a, b) => a.start - b.start);

  // Create context windows around hits
  const windows = [];
  const contextSize = 80; // Increased for better context

  for (const hit of hits) {
    const winStart = Math.max(0, hit.start - contextSize);
    const winEnd = Math.min(cleaned.length, hit.end + contextSize);

    if (windows.length === 0) {
      windows.push({ start: winStart, end: winEnd, hits: [hit] });
      continue;
    }

    const last = windows[windows.length - 1];
    // Merge overlapping windows
    if (winStart <= last.end + 20) {
      last.end = Math.max(last.end, winEnd);
      last.hits.push(hit);
    } else {
      windows.push({ start: winStart, end: winEnd, hits: [hit] });
    }
  }

  // Limit to best 2 windows
  const limited = windows.slice(0, 2);
  const parts = [];

  for (const win of limited) {
    let part = cleaned.substring(win.start, win.end);
    
    // Add ellipsis
    if (win.start > 0) part = '...' + part;
    if (win.end < cleaned.length) part = part + '...';
    
    // Highlight matched terms with <b> tags
    const relativeHits = win.hits
      .map(h => ({ start: h.start - win.start + (win.start > 0 ? 3 : 0), end: h.end - win.start + (win.start > 0 ? 3 : 0) }))
      .sort((a, b) => b.start - a.start); // Sort in reverse for replacement
    
    for (const hit of relativeHits) {
      const before = part.substring(0, hit.start);
      const match = part.substring(hit.start, hit.end);
      const after = part.substring(hit.end);
      part = before + '<b>' + match + '</b>' + after;
    }
    
    parts.push(part);
  }

  return parts.join(' ... ');
}

function getRawQueryTerms(query) {
  return Array.from(new Set(
    (query.toLowerCase().match(/\b\w+\b/g) || [])
      .filter(token => token.length > 2 && !STOP_WORDS.has(token))
  ));
}

function hasExactQueryMatch(text, query) {
  if (!text) return false;
  const terms = getRawQueryTerms(query);
  if (terms.length === 0) return false;
  const lower = text.toLowerCase();

  for (const term of terms) {
    const re = new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(lower)) return true;
  }

  return false;
}

// Convert local URLs to deployed URLs
function mapToDeployedUrl(localUrl, tags) {
  // Determine which repo this belongs to based on tags and URL patterns
  let repoKey = null;
  
  // Check tags to determine repo
  if (tags.includes('corp')) repoKey = 'corp';
  else if (tags.includes('ees')) repoKey = 'ees';
  else if (tags.includes('ect')) repoKey = 'ect';
  else if (tags.includes('ets')) repoKey = 'ets';
  else if (tags.includes('fgt')) repoKey = 'fgt';
  else if (tags.includes('wind')) repoKey = 'wind';
  else if (tags.includes('credit')) repoKey = 'credit';
  else if (tags.includes('direct-canada')) repoKey = 'direct-canada';
  else if (tags.includes('direct-spain')) repoKey = 'direct-spain';
  else if (tags.includes('direct')) repoKey = 'direct';
  
  if (!repoKey || !URL_MAPPINGS[repoKey]) {
    return localUrl; // fallback to original URL
  }
  
  const baseUrl = URL_MAPPINGS[repoKey];
  
  // Handle special cases
  if (repoKey === 'fgt') {
    // FGT URLs already include /fgt/ prefix in the base URL
    return baseUrl + localUrl.replace(/^\/fgt\//, '');
  } else if (repoKey === 'direct-canada') {
    // Remove /ca/ prefix since it's included in base URL
    return baseUrl + localUrl.replace(/^\/ca\//, '/');
  } else if (repoKey === 'direct-spain') {
    // Remove /es/ prefix since it's included in base URL
    return baseUrl + localUrl.replace(/^\/es\//, '/');
  } else {
    // Standard mapping - just prepend the base URL
    return baseUrl + localUrl;
  }
}

function searchDocuments(query, filter) {
  const index = loadIndex();
  if (!index) {
    return { error: 'Search index not available' };
  }
  
  // Check for phrase search (quoted query)
  const phraseMatch = query.match(/^"(.+)"$/);
  const isPhrase = !!phraseMatch;
  const searchQuery = isPhrase ? phraseMatch[1] : query;
  
  // Tokenize query
  const queryTerms = tokenizeQuery(searchQuery);
  if (queryTerms.length === 0) {
    return { query, total: 0, results: [] };
  }
  
  const totalDocs = index.documents.length;
  
  // Calculate TF-IDF scores
  const docScores = {};
  
  for (const term of queryTerms) {
    const docIds = index.index[term];
    if (docIds) {
      // IDF = log(total docs / docs containing term)
      const idf = Math.log(totalDocs / docIds.length);
      
      for (const docId of docIds) {
        // TF = term frequency in document (simple count for now)
        const tf = 1; // Could be enhanced by storing term counts
        const tfidf = tf * idf;
        
        docScores[docId] = (docScores[docId] || 0) + tfidf;
      }
    }
  }
  
  // Get matching documents
  let results = Object.entries(docScores)
    .map(([docId, score]) => ({
      doc: index.documents[parseInt(docId)],
      score: score
    }));

  // For phrase search, require exact phrase match
  if (isPhrase) {
    const phraseText = phraseMatch[1].toLowerCase();
    results = results.filter(r => {
      const text = (r.doc.text || r.doc.snippet || '').toLowerCase();
      return text.indexOf(phraseText) !== -1;
    });
  } else {
    // Require at least one exact query term match to avoid overstemming noise
    results = results.filter(r => hasExactQueryMatch(r.doc.text || r.doc.snippet || '', query));
  }
  
  // Filter by tag if specified
  if (filter && filter !== 'all') {
    if (filter === 'pr') {
      results = results.filter(r =>
        r.doc && r.doc.url && r.doc.url.indexOf('/corp/pressroom/releases/') === 0
      );
    } else {
      results = results.filter(r => r.doc.tags.includes(filter));
    }
  }
  
  // Sort by score (descending)
  results.sort((a, b) => b.score - a.score);
  
  // Format results
  const formattedResults = results.map(r => ({
    title: r.doc.title,
    url: mapToDeployedUrl(r.doc.url, r.doc.tags),
    localUrl: r.doc.url, // Keep original for reference
    breadcrumb: r.doc.breadcrumb,
    snippet: buildContextSnippet(r.doc.text || r.doc.snippet || '', query),
    size: r.doc.size,
    modified: r.doc.modified || 'N/A',
    tags: r.doc.tags
  }));
  
  return {
    query: query,
    filter: filter || 'all',
    total: results.length,
    results: formattedResults
  };
}

exports.handler = async (event) => {
  try {
    // Parse query parameters
    const params = event.queryStringParameters || {};
    const query = params.q || '';
    const filter = params.filter || 'all';
    
    // Validate query
    if (!query || query.trim().length === 0) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'Query parameter required'
        })
      };
    }
    
    // Perform search
    const results = searchDocuments(query.trim(), filter);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(results)
    };
    
  } catch (error) {
    console.error('Search error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Internal server error'
      })
    };
  }
};

