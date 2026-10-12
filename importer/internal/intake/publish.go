package intake

import (
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

var unsafeCopy = regexp.MustCompile(`(?i)<[^>]*>|100\s*%\s*(?:safe|secure)|security certified|fully secure|полностью безопас|гарантированно безопас`)
var categorySet = map[string]bool{"research": true, "build": true, "review": true, "operate": true, "protect": true}

// Publication accepts a freshly rescanned report, not a report's claims of
// eligibility. The caller must obtain this report from the pinned snapshot.
func Publication(fresh Report, reviews Reviews) ([]CatalogEntry, error) {
	if reviews.SchemaVersion != SchemaVersion || reviews.Repository != fresh.Repository.URL || reviews.Commit != fresh.Commit {
		return nil, errors.New("review provenance mismatch")
	}
	byID := map[string]Candidate{}
	for _, c := range fresh.Skills {
		byID[c.ID] = c
	}
	seen := map[string]bool{}
	result := []CatalogEntry{}
	if len(reviews.Reviews) == 0 || len(reviews.Reviews) > MaxSkills {
		return nil, errors.New("review count out of bounds")
	}
	for _, v := range reviews.Reviews {
		c, ok := byID[v.ID]
		if !ok || seen[v.ID] || v.BundleSHA256 != c.BundleSHA256 {
			return nil, errors.New("unknown, duplicate or stale review")
		}
		seen[v.ID] = true
		if v.Decision == "reject" {
			continue
		}
		if v.Decision != "approve" || !v.RightsConfirmed || !validPublicText(v.Reviewer, 160) || !validPublicText(v.Notes, 2000) || v.ReviewedAt.IsZero() || v.ReviewedAt.After(time.Now().Add(time.Minute)) || v.ReviewedAt.Before(time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)) || !categorySet[v.Category] {
			return nil, fmt.Errorf("explicit complete curator approval required for %s", v.ID)
		}
		if c.Status != "needs_review" || c.QualityScore < 60 {
			return nil, fmt.Errorf("blocked source cannot be published: %s", v.ID)
		}
		for _, f := range c.Findings {
			if f.Severity == "high" {
				return nil, errors.New("blocking finding cannot be overridden")
			}
		}
		if err := ValidateDescription(v.EN); err != nil {
			return nil, err
		}
		if err := ValidateDescription(v.RU); err != nil {
			return nil, err
		}
		entry := CatalogEntry{ID: c.ID, Repository: fresh.Repository.URL, Commit: fresh.Commit, Path: c.Path, SourceURL: c.SourceURL, BundleSHA256: c.BundleSHA256, License: c.License, Category: v.Category, ReviewedAt: v.ReviewedAt.UTC(), Reviewer: v.Reviewer, QualityScore: c.QualityScore, ReviewNotes: v.Notes, EN: v.EN, RU: v.RU}
		if err := validateEntry(entry); err != nil {
			return nil, err
		}
		result = append(result, entry)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result, nil
}

func ValidateDescription(d Description) error {
	for _, v := range []struct {
		s string
		n int
	}{{d.Title, 160}, {d.Summary, 600}, {d.Purpose, 4000}, {d.Permissions, 2000}} {
		if !validPublicText(v.s, v.n) {
			return errors.New("invalid public description")
		}
	}
	for _, items := range [][]string{d.Capabilities, d.Steps} {
		if len(items) < 1 || len(items) > 20 {
			return errors.New("description list limit")
		}
		for _, s := range items {
			if !validPublicText(s, 500) {
				return errors.New("invalid description list text")
			}
		}
	}
	return nil
}

func validPublicText(s string, max int) bool {
	return utf8.ValidString(s) && len(s) <= max && strings.TrimSpace(s) != "" && !strings.ContainsAny(s, "\x00\r") && !secretPattern.MatchString(s) && !unsafeCopy.MatchString(s)
}

func MergeCatalog(existing, incoming []CatalogEntry) ([]CatalogEntry, error) {
	if len(existing)+len(incoming) > 2000 {
		return nil, errors.New("catalog limit")
	}
	byID := map[string]CatalogEntry{}
	for _, e := range existing {
		if _, ok := byID[e.ID]; ok {
			return nil, errors.New("duplicate existing catalog ID")
		}
		if err := validateEntry(e); err != nil {
			return nil, err
		}
		byID[e.ID] = e
	}
	seenIncoming := map[string]bool{}
	for _, e := range incoming {
		if seenIncoming[e.ID] {
			return nil, errors.New("duplicate incoming catalog ID")
		}
		seenIncoming[e.ID] = true
		if err := validateEntry(e); err != nil {
			return nil, err
		}
		if old, ok := byID[e.ID]; ok {
			a, _ := json.Marshal(old)
			b, _ := json.Marshal(e)
			if string(a) != string(b) {
				return nil, fmt.Errorf("existing catalog entry differs: %s; review an explicit replacement separately", e.ID)
			}
			continue
		}
		byID[e.ID] = e
	}
	result := make([]CatalogEntry, 0, len(byID))
	for _, e := range byID {
		result = append(result, e)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result, nil
}

func validateEntry(e CatalogEntry) error {
	repo, err := ParseRepository(e.Repository)
	if err != nil || repo.URL != e.Repository {
		return errors.New("invalid catalog repository")
	}
	if !safeSourcePath(e.Path) || path.Base(e.Path) != "SKILL.md" || e.ReviewedAt.After(time.Now().Add(time.Minute)) || e.ReviewedAt.Before(time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)) {
		return errors.New("invalid catalog path or review date")
	}
	if e.ID != candidateID(repo, e.Path) || e.SourceURL != pinnedURL(e.Repository, e.Commit, e.Path) || !regexp.MustCompile(`^[0-9a-f]{40}$`).MatchString(e.Commit) || !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(e.BundleSHA256) || !categorySet[e.Category] || !validPublicText(e.License, 200) || !validPublicText(e.Reviewer, 160) || !validPublicText(e.ReviewNotes, 2000) || e.QualityScore < 60 || e.QualityScore > 100 || e.ReviewedAt.IsZero() {
		return errors.New("invalid catalog provenance")
	}
	if err := ValidateDescription(e.EN); err != nil {
		return err
	}
	return ValidateDescription(e.RU)
}

// ReviewTemplate leaves decisions pending. Provider-generated drafts must never
// populate identity, rights confirmation, or an approval decision.
func ReviewTemplate(r Report) Reviews {
	result := Reviews{SchemaVersion: SchemaVersion, Repository: r.Repository.URL, Commit: r.Commit, Reviews: []Review{}}
	for _, c := range r.Skills {
		result.Reviews = append(result.Reviews, Review{ID: c.ID, BundleSHA256: c.BundleSHA256, Decision: "pending", Category: "review"})
	}
	return result
}
