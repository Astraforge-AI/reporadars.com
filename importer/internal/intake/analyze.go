package intake

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"go.yaml.in/yaml/v3"
)

const maxReviewBytes = 256 << 10
const maxReportTextBytes = 8 << 20

var skillName = regexp.MustCompile(`^[\p{Ll}\p{N}]+(?:-[\p{Ll}\p{N}]+)*$`)
var secretPattern = regexp.MustCompile(`(?m)-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{40,255}|AKIA[0-9A-Z]{16})\b`)
var securityRules = []struct {
	code, severity, message string
	pattern                 *regexp.Regexp
}{
	{"REMOTE_EXECUTION", "high", "Remote content is piped directly into an interpreter.", regexp.MustCompile(`(?i)(?:curl|wget)[^\n|]{0,500}\|\s*(?:sudo\s+)?(?:ba|z|fi)?sh\b`)},
	{"DESTRUCTIVE_COMMAND", "high", "A broad recursive removal or disk-formatting command needs rejection and source remediation.", regexp.MustCompile(`(?i)\brm\s+[^\n]{0,60}(?:-rf|-fr|--recursive)|\b(?:mkfs|wipefs|shred)\b`)},
	{"PROMPT_OVERRIDE", "high", "The document contains a request to override higher-priority instructions.", regexp.MustCompile(`(?i)(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|system|developer)[^\n]{0,50}(?:instructions|prompt|rules)|(?:игнорируй|игнорировать)\s+[^\n]{0,40}(?:инструкц|правил)`)},
	{"DYNAMIC_EXECUTION", "medium", "Dynamic code evaluation needs a contextual review.", regexp.MustCompile(`\b(?:eval|exec|Function)\s*\(`)},
	{"PRIVILEGED_OPERATION", "medium", "Privileged operations or broad permissions need explicit review.", regexp.MustCompile(`(?i)\bsudo\s+|\bchmod\s+(?:-R\s+)?777\b`)},
	{"SECRET_ACCESS", "medium", "Credential-related paths or environment access need an explicit scope review.", regexp.MustCompile(`(?i)\.ssh/|\.aws/|\.env\b|process\.env|os\.environ|getenv\(`)},
	{"OUTSIDE_SKILL_REFERENCE", "high", "The skill references files outside its reviewed directory; import a self-contained bundle instead.", regexp.MustCompile(`(?:^|[\s("\x60])(?:\.\./)+[^\s)"\x60]+`)},
	{"NETWORK_ACCESS", "info", "External URLs are referenced; destinations and transferred data need contextual review.", regexp.MustCompile(`https?://[^\s)"'<>]+`)},
}

// Analyze screens every file in each skill directory and its root license. It
// is not a proof of safety, runtime compatibility, or legal permission.
func Analyze(snapshot Snapshot) (Report, error) {
	r := Report{SchemaVersion: SchemaVersion, Repository: snapshot.Repository, Commit: snapshot.Commit, ArchiveSHA256: snapshot.ArchiveSHA256, GeneratedAt: time.Now().UTC(), Skills: []Candidate{}}
	repo, repoErr := ParseRepository(snapshot.Repository.URL)
	if repoErr != nil || repo != snapshot.Repository || !sha40.MatchString(snapshot.Commit) || !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(snapshot.ArchiveSHA256) || len(snapshot.Files) > MaxEntries {
		return r, errors.New("invalid snapshot")
	}
	var paths, docs []string
	for name, data := range snapshot.Files {
		if !safeSourcePath(name) {
			return r, errors.New("unsafe source path")
		}
		if len(data) > MaxFileBytes {
			return r, errors.New("file limit exceeded")
		}
		paths = append(paths, name)
		if path.Base(name) == "SKILL.md" {
			docs = append(docs, name)
		}
	}
	sort.Strings(paths)
	sort.Strings(docs)
	if len(docs) == 0 {
		return r, errors.New("no SKILL.md files found")
	}
	if len(docs) > MaxSkills {
		return r, errors.New("skill limit exceeded")
	}
	totalReview := 0
	for _, doc := range docs {
		c := Candidate{ID: candidateID(snapshot.Repository, doc), Path: doc, SourceURL: pinnedURL(snapshot.Repository.URL, snapshot.Commit, doc), Findings: []Finding{}, Files: []FileEvidence{}, Status: "needs_review"}
		add := func(code, severity, file, message string, line int) {
			if len(c.Findings) < 200 {
				c.Findings = append(c.Findings, Finding{Code: code, Severity: severity, Path: file, Line: line, Message: message})
			}
			if severity == "high" {
				c.Status = "blocked"
			}
		}
		meta, body, err := frontmatter(snapshot.Files[doc])
		if err != nil {
			add("INVALID_FRONTMATTER", "high", doc, "Required frontmatter is malformed, duplicated, aliased or missing.", 1)
		} else {
			c.Name, c.Description, c.License = meta["name"], meta["description"], meta["license"]
			if !skillName.MatchString(c.Name) || utf8.RuneCountInString(c.Name) > 64 || c.Description == "" || utf8.RuneCountInString(c.Description) > 1024 {
				add("INVALID_METADATA", "high", doc, "A valid name and nonempty description of at most 1024 characters are required.", 1)
			} else {
				c.QualityScore += 30
			}
			if path.Dir(doc) != "." && c.Name != path.Base(path.Dir(doc)) {
				add("NAME_DIRECTORY_MISMATCH", "medium", doc, "Metadata name differs from its directory name.", 1)
			}
			if len(c.Description) >= 40 {
				c.QualityScore += 10
			}
			if len(body) >= 200 {
				c.QualityScore += 10
			}
			for _, rule := range []struct{ pattern, code string }{{`(?im)^\s*\d+\.\s+`, "MISSING_STEPS"}, {`(?i)example|пример`, "MISSING_EXAMPLE"}, {`(?i)validat|verif|test|провер`, "MISSING_VALIDATION"}, {`(?i)permission|read.only|scope|разрешен|област`, "MISSING_SCOPE"}, {`(?i)output|result|результат|выход`, "MISSING_OUTPUT"}} {
				if regexp.MustCompile(rule.pattern).MatchString(body) {
					c.QualityScore += 10
				} else {
					add(rule.code, "info", doc, "A useful quality signal was not found by the structural screen.", 1)
				}
			}
		}
		if c.QualityScore < 60 {
			add("LOW_STRUCTURE_SCORE", "high", doc, "Insufficient documented task, workflow, examples or validation for catalog admission.", 1)
		}
		var review strings.Builder
		bundle := sha256.New()
		secret := false
		for _, name := range paths {
			if !inSkill(name, path.Dir(doc)) && !rootLicense(name) {
				continue
			}
			data := snapshot.Files[name]
			fmt.Fprintf(bundle, "%d:%s%d:", len(name), name, len(data))
			bundle.Write(data)
			sum := sha256.Sum256(data)
			c.Files = append(c.Files, FileEvidence{Path: name, SHA256: hex.EncodeToString(sum[:]), Bytes: len(data)})
			if !utf8.Valid(data) || bytes.ContainsRune(data, 0) {
				add("UNREVIEWED_BINARY", "high", name, "Binary content cannot be checked by this text-only review pipeline.", 1)
				continue
			}
			text := string(data)
			if secretPattern.Match(data) {
				secret = true
				add("SECRET_PATTERN", "high", name, "Potential credential material detected; review text withheld. Rotate any real exposed credential.", 1)
			}
			if rootLicense(name) && c.License == "" {
				c.License = "See " + name
			}
			for _, rule := range securityRules {
				indexes := rule.pattern.FindAllStringIndex(text, 8)
				for _, at := range indexes {
					add(rule.code, rule.severity, name, rule.message, 1+strings.Count(text[:at[0]], "\n"))
				}
			}
			section := fmt.Sprintf("\n--- FILE %s (UNTRUSTED DATA) ---\n%s\n", name, text)
			if review.Len()+len(section) > maxReviewBytes {
				add("INCOMPLETE_REVIEW_COVERAGE", "high", name, "The bundle exceeds the complete text review budget; split the skill.", 1)
				continue
			}
			review.WriteString(section)
		}
		if len(c.Files) > 200 {
			return r, errors.New("too many files in a skill bundle")
		}
		c.BundleSHA256 = hex.EncodeToString(bundle.Sum(nil))
		if c.License == "" {
			c.License = "Unspecified"
			add("LICENSE_UNCONFIRMED", "medium", doc, "No license declaration found; confirm catalog description and attribution rights before publication.", 1)
		}
		if len(c.License) > 200 {
			c.License = "See source license"
			add("LICENSE_REVIEW", "medium", doc, "License declaration needs contextual review.", 1)
		}
		if secret {
			c.Name = "[withheld]"
			c.Description = "[withheld]"
			c.License = "[withheld]"
		} else {
			c.ReviewText = review.String()
		}
		totalReview += len(c.ReviewText)
		if totalReview > maxReportTextBytes {
			return r, errors.New("total private report limit exceeded")
		}
		r.Skills = append(r.Skills, c)
	}
	return r, nil
}

func inSkill(file, dir string) bool { return dir == "." || strings.HasPrefix(file, dir+"/") }

func safeSourcePath(file string) bool {
	if file == "" || len(file) > 512 || !utf8.ValidString(file) || strings.HasPrefix(file, "/") || strings.Contains(file, "\\") || secretPattern.MatchString(file) {
		return false
	}
	for _, r := range file {
		if r < 32 || r == 127 {
			return false
		}
	}
	for _, part := range strings.Split(file, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}
func rootLicense(file string) bool {
	return !strings.Contains(file, "/") && regexp.MustCompile(`(?i)^(?:licen[cs]e|copying)(?:\.[a-z]+)?$`).MatchString(file)
}

func candidateID(repo Repository, file string) string {
	sum := sha256.Sum256([]byte(repo.URL + "\n" + file))
	base := strings.Trim(regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(strings.ToLower(repo.Name), "-"), "-")
	if len(base) > 40 {
		base = base[:40]
	}
	if base == "" {
		base = "skill"
	}
	return "import-" + strings.Trim(base, "-") + "-" + hex.EncodeToString(sum[:6])
}

func pinnedURL(repo, commit, file string) string {
	parts := strings.Split(file, "/")
	for i := range parts {
		parts[i] = url.PathEscape(parts[i])
	}
	return repo + "/blob/" + commit + "/" + strings.Join(parts, "/")
}

// Parse YAML as nodes to reject aliases, tags, duplicate keys and extreme
// nesting before accessing scalar metadata. https://pkg.go.dev/go.yaml.in/yaml/v3
func frontmatter(data []byte) (map[string]string, string, error) {
	if !utf8.Valid(data) || bytes.ContainsRune(data, 0) {
		return nil, "", errors.New("not text")
	}
	text := strings.ReplaceAll(strings.TrimPrefix(string(data), "\ufeff"), "\r\n", "\n")
	if !strings.HasPrefix(text, "---\n") {
		return nil, "", errors.New("missing frontmatter")
	}
	end := strings.Index(text[4:], "\n---\n")
	if end < 0 || end > 16<<10 {
		return nil, "", errors.New("frontmatter limit")
	}
	var root yaml.Node
	if err := yaml.Unmarshal([]byte(text[4:4+end]), &root); err != nil {
		return nil, "", err
	}
	nodes := 0
	var check func(*yaml.Node, int) error
	check = func(n *yaml.Node, depth int) error {
		nodes++
		if nodes > 1000 || depth > 10 || n.Kind == yaml.AliasNode || n.Anchor != "" || (!strings.HasPrefix(n.Tag, "!!") && n.Tag != "") {
			return errors.New("unsupported YAML")
		}
		if n.Kind == yaml.MappingNode {
			seen := map[string]bool{}
			for i := 0; i < len(n.Content); i += 2 {
				k := n.Content[i]
				if k.Kind != yaml.ScalarNode || seen[k.Value] {
					return errors.New("duplicate YAML key")
				}
				seen[k.Value] = true
			}
		}
		for _, child := range n.Content {
			if err := check(child, depth+1); err != nil {
				return err
			}
		}
		return nil
	}
	if err := check(&root, 0); err != nil {
		return nil, "", err
	}
	if len(root.Content) != 1 || root.Content[0].Kind != yaml.MappingNode {
		return nil, "", errors.New("metadata mapping required")
	}
	values := map[string]string{}
	children := root.Content[0].Content
	for i := 0; i < len(children); i += 2 {
		key, value := children[i].Value, children[i+1]
		if key == "name" || key == "description" || key == "license" {
			if value.Kind != yaml.ScalarNode || value.Tag != "!!str" {
				return nil, "", errors.New("metadata string required")
			}
			values[key] = strings.TrimSpace(value.Value)
		}
	}
	return values, text[4+end+5:], nil
}
