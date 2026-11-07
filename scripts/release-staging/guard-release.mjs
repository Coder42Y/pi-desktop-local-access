const { GITHUB_API_URL, GITHUB_REPOSITORY, GH_TOKEN, RELEASE_TAG } = process.env;
const headers = { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json' };
const get = path => fetch(`${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/${path}`, { headers });
const tag = await get(`git/ref/tags/${RELEASE_TAG}`);
if (tag.status !== 404) throw new Error(`Expected an unused tag, got HTTP ${tag.status}`);
for (let page = 1; ; page++) {
  const releases = await get(`releases?per_page=100&page=${page}`);
  if (!releases.ok) throw new Error(`Release listing returned HTTP ${releases.status}`);
  const items = await releases.json();
  if (items.some(item => item.tag_name === RELEASE_TAG)) throw new Error('Release tag already used');
  if (items.length < 100) break;
}
