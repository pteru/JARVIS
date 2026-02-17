import { readFileSync, writeFileSync } from 'fs';

// Load access data
const lines = readFileSync('/tmp/gh-access-data.tsv', 'utf-8').trim().split('\n');
const data = {};
const users = new Set();
const repos = new Set();

for (const line of lines) {
  const [repo, user, role] = line.split('\t');
  repos.add(repo);
  users.add(user);
  data[repo + '|' + user] = role;
}

// Load branch protection data
const protLines = readFileSync('/tmp/gh-branch-protection.tsv', 'utf-8').trim().split('\n');
const protection = {}; // repo -> { develop: bool, master: bool }

for (const line of protLines) {
  const [repo, branch, prRequired] = line.split('\t');
  if (!protection[repo]) protection[repo] = {};
  protection[repo][branch] = prRequired === 'yes';
}

const userList = [...users].sort();
const repoList = [...repos].sort();

const roleMap = { admin: '**A**', maintain: '**M**', write: '**W**', triage: '**T**', read: '**R**' };

const orgOwners = ['PoletoSkm', 'teruelskm', 'williamabe-strokmatic'];
const orgMembers = ['arthurmallmann-strokmatic', 'gui-strokmatic', 'viniciusfigueredo-dev', 'viniciussotero', 'VVS-skm'];

const orgAll = new Set([...orgOwners, ...orgMembers]);
const outsiders = userList.filter(u => !orgAll.has(u));

let md = '# Strokmatic GitHub Access Matrix\n\n';
md += '> Generated: ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + '\n\n';

md += '## Organization Owners\n\n';
orgOwners.forEach(u => { md += '- ' + u + '\n'; });
md += '\n## Organization Members\n\n';
orgMembers.forEach(u => { md += '- ' + u + '\n'; });

if (outsiders.length) {
  md += '\n## Outside Collaborators\n\n';
  outsiders.forEach(u => { md += '- ' + u + '\n'; });
}

// Branch Protection Summary
const protectedRepos = Object.entries(protection).filter(([, p]) => p.develop && p.master);
const partialRepos = Object.entries(protection).filter(([, p]) => (p.develop || p.master) && !(p.develop && p.master));
const unprotectedService = repoList.filter(r => !protection[r]);

md += '\n## Branch Protection Status\n\n';
md += 'Rules: `develop` and `master` require Pull Requests — no direct commits allowed.\n\n';
md += `- **Fully protected** (develop + master): ${protectedRepos.length} repos\n`;
if (partialRepos.length) {
  md += `- **Partially protected**: ${partialRepos.length} repos\n`;
  partialRepos.forEach(([repo, p]) => {
    const branches = [];
    if (p.develop) branches.push('develop');
    if (p.master) branches.push('master');
    md += `  - ${repo} (${branches.join(', ')} only)\n`;
  });
}
md += `- **No branch protection**: ${unprotectedService.length} repos\n`;

// Per-Repository Access Table
md += '\n## Per-Repository Access\n\n';
md += 'Legend: **A** = Admin, **M** = Maintain, **W** = Write, **T** = Triage, **R** = Read, `-` = No direct access\n\n';
md += 'Branch protection: PR = PRs required on develop & master, `-` = no protection\n\n';

md += '| Repository | Protection | ' + userList.join(' | ') + ' |\n';
md += '|:-----------|:---:|' + userList.map(() => ':---:').join('|') + '|\n';

for (const repo of repoList) {
  const prot = protection[repo];
  let protCell = '-';
  if (prot && prot.develop && prot.master) {
    protCell = 'PR';
  } else if (prot) {
    const branches = [];
    if (prot.develop) branches.push('dev');
    if (prot.master) branches.push('master');
    protCell = branches.join('+');
  }

  const cells = userList.map(u => {
    const role = data[repo + '|' + u];
    return role ? (roleMap[role] || role) : '-';
  });
  md += '| ' + repo + ' | ' + protCell + ' | ' + cells.join(' | ') + ' |\n';
}

writeFileSync('/home/teruel/JARVIS/reports/github-access-matrix.md', md);
console.log(`Users: ${userList.length}, Repos: ${repoList.length}, Entries: ${lines.length}`);
console.log(`Protected: ${protectedRepos.length}, Partial: ${partialRepos.length}, Unprotected: ${unprotectedService.length}`);
