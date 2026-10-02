// Diary – talking to GitHub (REST API).
// For now: check the private data repo and read files from it.
// The token is sent only to api.github.com and is never written into code.

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

async function request(github, path) {
  try {
    return await fetch(API + path, {
      headers: {
        Authorization: `Bearer ${github.token}`,
        Accept: 'application/vnd.github+json'
      },
      cache: 'no-store'
    });
  } catch {
    throw new GitHubError(0, 'No connection to GitHub.');
  }
}

function errorFor(response) {
  switch (response.status) {
    case 401:
      return new GitHubError(401, 'GitHub did not accept the token (wrong, expired or revoked).');
    case 403:
      return new GitHubError(403, response.headers.get('x-ratelimit-remaining') === '0'
        ? 'GitHub rate limit reached. Try again later.'
        : 'The token is not allowed to do this. It needs Contents: Read and write on the data repo.');
    case 404:
      return new GitHubError(404, 'Repo not found. Check the username and repo name, and that the token includes this repo.');
    default:
      return new GitHubError(response.status, `GitHub answered with error ${response.status}.`);
  }
}

function repoPath(github) {
  return `/repos/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repo)}`;
}

// Checks that the token can open the repo. Returns { private: true/false }.
export async function checkRepo(github) {
  const response = await request(github, repoPath(github));
  if (!response.ok) throw errorFor(response);
  const data = await response.json();
  return { private: data.private === true };
}

// Reads a text file from the repo. Returns { sha, text }, or null if the file doesn't exist.
export async function getFile(github, path) {
  const response = await request(github, `${repoPath(github)}/contents/${path}`);
  if (response.status === 404) return null;
  if (!response.ok) throw errorFor(response);
  const data = await response.json();
  return { sha: data.sha, text: decodeBase64(data.content) };
}

function decodeBase64(base64) {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
