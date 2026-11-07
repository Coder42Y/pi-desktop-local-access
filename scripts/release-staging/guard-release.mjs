const { GITHUB_API_URL, GITHUB_REPOSITORY, GH_TOKEN, RELEASE_TAG, RELEASE_ID, SOURCE_SHA } = process.env;
const headers = { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json' };
const get = path => fetch(`${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/${path}`, { headers });
const tag = await get(`git/ref/tags/${RELEASE_TAG}`);
if (tag.status !== 404) throw new Error(`Expected an unused tag, got HTTP ${tag.status}`);
const release = await get(`releases/${RELEASE_ID}`);
if (!release.ok) throw new Error(`Draft lookup returned HTTP ${release.status}`);
const draft = await release.json();
if (!draft.draft || !draft.prerelease || draft.tag_name !== RELEASE_TAG || draft.target_commitish !== SOURCE_SHA) {
  throw new Error('Expected the existing local.4 draft at the pinned source commit');
}
