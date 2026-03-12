#!/usr/bin/env bash
# PR context fetcher for contextual re-reviews.
# Provides functions to fetch PR comments and commits since a given SHA.
# Usage: source "$SCRIPT_DIR/lib/pr-context.sh"
#
# Functions:
#   fetch_pr_comments    <repo> <number>
#   fetch_commits_since  <repo> <number> <since_sha>
#
# Requires: ORG from lib/config.sh, gh CLI authenticated

# Fetch all PR comments formatted for inclusion in a re-review prompt.
# Args:
#   $1 - repo name (e.g. "visionking-backend")
#   $2 - PR number
# Output: formatted comments to stdout, one per comment block
fetch_pr_comments() {
    local repo="$1"
    local number="$2"

    local json
    json=$(gh pr view "$number" --repo "${ORG}/${repo}" --json comments 2>/dev/null) || {
        echo "(Unable to fetch PR comments)"
        return 1
    }

    node -e "
        const data = JSON.parse(process.argv[1]);
        const comments = data.comments || [];
        if (comments.length === 0) {
            console.log('No comments on this PR.');
            process.exit(0);
        }
        comments.forEach(c => {
            const author = c.author?.login || 'unknown';
            const date = c.createdAt ? c.createdAt.substring(0, 10) : 'unknown';
            const body = (c.body || '').trim();
            console.log('**' + author + '** (' + date + '): ' + body);
            console.log('');
        });
    " "$json" 2>/dev/null || echo "(Unable to parse PR comments)"
}

# Fetch commits on a PR that come after a given SHA.
# Args:
#   $1 - repo name
#   $2 - PR number
#   $3 - since_sha (the SHA of the last reviewed commit)
# Output: formatted commit list to stdout
fetch_commits_since() {
    local repo="$1"
    local number="$2"
    local since_sha="$3"

    local json
    json=$(gh pr view "$number" --repo "${ORG}/${repo}" --json commits 2>/dev/null) || {
        echo "(Unable to fetch PR commits)"
        return 1
    }

    node -e "
        const data = JSON.parse(process.argv[1]);
        const sinceSha = process.argv[2];
        const commits = data.commits || [];

        if (commits.length === 0) {
            console.log('No commits found.');
            process.exit(0);
        }

        // Find the index of the since_sha commit
        // Commits are ordered oldest-first in the gh output
        let startIdx = -1;
        for (let i = 0; i < commits.length; i++) {
            const sha = commits[i].oid || commits[i].sha || '';
            if (sha.startsWith(sinceSha) || sinceSha.startsWith(sha)) {
                startIdx = i;
                break;
            }
        }

        // Take commits AFTER the since_sha
        const newCommits = startIdx >= 0
            ? commits.slice(startIdx + 1)
            : commits;  // If SHA not found, show all commits as context

        if (newCommits.length === 0) {
            console.log('No new commits since ' + sinceSha.substring(0, 7) + '.');
            process.exit(0);
        }

        newCommits.forEach(c => {
            const sha = (c.oid || c.sha || '').substring(0, 7);
            const msg = (c.messageHeadline || c.message || '').split('\n')[0];
            console.log('- ' + sha + ' ' + msg);
        });
    " "$json" "$since_sha" 2>/dev/null || echo "(Unable to parse PR commits)"
}
