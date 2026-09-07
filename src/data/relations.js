export const articleSkillRelations = Object.freeze({
  "seo-audit-boundaries": ["seo-audit"],
  "reviewing-signal-quality": ["security-review"],
  "retiring-legacy-analytics": [
    "evaluation-frameworks",
    "vector-store-hygiene",
  ],
  "rollback-readiness-notes": ["release-readiness"],
  "agent-compatibility-notes": ["api-contract", "browser-testing"],
});

export function skillIdsForArticle(articleId) {
  return articleSkillRelations[articleId] || [];
}

export function articleIdsForSkill(skillId) {
  return Object.entries(articleSkillRelations)
    .filter(([, skillIds]) => skillIds.includes(skillId))
    .map(([articleId]) => articleId);
}

export function peerSkillsFor(skill, skills, limit = 2) {
  const otherSkills = skills.filter((candidate) => candidate.id !== skill.id);
  return [
    ...otherSkills.filter((candidate) => candidate.category === skill.category),
    ...otherSkills.filter((candidate) => candidate.category !== skill.category),
  ].slice(0, limit);
}
