// Package intake reads repository data; it never executes repository code.
package intake

import "time"

const (
	SchemaVersion    = 1
	MaxArchiveBytes  = 32 << 20
	MaxExpandedBytes = 64 << 20
	MaxFileBytes     = 512 << 10
	MaxEntries       = 10000
	MaxSkills        = 200
)

type Repository struct {
	URL   string `json:"url"`
	Owner string `json:"owner"`
	Name  string `json:"name"`
}

// Snapshot contains regular, bounded files with normalized repository-relative
// paths, with no archive wrapper directory. Symlinks are never followed.
type Snapshot struct {
	Repository    Repository
	Commit        string
	ArchiveSHA256 string
	Files         map[string][]byte
}

type Finding struct {
	Code     string `json:"code"`
	Severity string `json:"severity"`
	Path     string `json:"path"`
	Line     int    `json:"line"`
	Message  string `json:"message"`
}

type FileEvidence struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Bytes  int    `json:"bytes"`
}

type Candidate struct {
	ID           string         `json:"id"`
	Path         string         `json:"path"`
	Name         string         `json:"name"`
	Description  string         `json:"description"`
	SourceURL    string         `json:"sourceUrl"`
	BundleSHA256 string         `json:"bundleSha256"`
	License      string         `json:"license"`
	QualityScore int            `json:"qualityScore"`
	Status       string         `json:"status"`
	Findings     []Finding      `json:"findings"`
	Files        []FileEvidence `json:"files"`
	// ReviewText is private untrusted evidence, not a prompt or executable.
	ReviewText string `json:"reviewText"`
}

type PackageEvidence struct {
	Kind           string `json:"kind"`
	ID             int64  `json:"id"`
	Tag            string `json:"tag"`
	Name           string `json:"name"`
	SourceURL      string `json:"sourceUrl"`
	DigestVerified bool   `json:"digestVerified"`
	RunID          int64  `json:"runId,omitempty"`
	WorkflowID     int64  `json:"workflowId,omitempty"`
	WorkflowPath   string `json:"workflowPath,omitempty"`
	RunAttempt     int    `json:"runAttempt,omitempty"`
}

type Report struct {
	Package       *PackageEvidence `json:"package,omitempty"`
	SchemaVersion int              `json:"schemaVersion"`
	Repository    Repository       `json:"repository"`
	Commit        string           `json:"commit"`
	ArchiveSHA256 string           `json:"archiveSha256"`
	GeneratedAt   time.Time        `json:"generatedAt"`
	Skills        []Candidate      `json:"skills"`
}

type Description struct {
	Title        string   `json:"title"`
	Summary      string   `json:"summary"`
	Purpose      string   `json:"purpose"`
	Capabilities []string `json:"capabilities"`
	Steps        []string `json:"steps"`
	Permissions  string   `json:"permissions"`
}

type Review struct {
	ID              string      `json:"id"`
	BundleSHA256    string      `json:"bundleSha256"`
	Decision        string      `json:"decision"`
	Reviewer        string      `json:"reviewer"`
	ReviewedAt      time.Time   `json:"reviewedAt"`
	Category        string      `json:"category"`
	RightsConfirmed bool        `json:"rightsConfirmed"`
	Notes           string      `json:"notes"`
	EN              Description `json:"en"`
	RU              Description `json:"ru"`
}

type Reviews struct {
	SchemaVersion int      `json:"schemaVersion"`
	Repository    string   `json:"repository"`
	Commit        string   `json:"commit"`
	Reviews       []Review `json:"reviews"`
}

// CatalogEntry is the public build contract. It contains no repository code,
// private evidence, secrets, fabricated compatibility or installation commands.
type CatalogEntry struct {
	ID           string      `json:"id"`
	Repository   string      `json:"repository"`
	Commit       string      `json:"commit"`
	Path         string      `json:"path"`
	SourceURL    string      `json:"sourceUrl"`
	BundleSHA256 string      `json:"bundleSha256"`
	License      string      `json:"license"`
	Category     string      `json:"category"`
	ReviewedAt   time.Time   `json:"reviewedAt"`
	Reviewer     string      `json:"reviewer"`
	QualityScore int         `json:"qualityScore"`
	ReviewNotes  string      `json:"reviewNotes"`
	EN           Description `json:"en"`
	RU           Description `json:"ru"`
}
