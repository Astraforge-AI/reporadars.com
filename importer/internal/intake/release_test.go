package intake

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestFlatPackageSupportsCollectionsAndRejectsTraversal(t *testing.T) {
	repo := Repository{URL: "https://github.com/o/r", Owner: "o", Name: "r"}
	commit := strings.Repeat("a", 40)
	snap, err := ReadPackageArchive(repo, commit, archive(t, map[string]string{"SKILL.md": "root", "other/SKILL.md": "nested"}))
	if err != nil || len(snap.Files) != 2 {
		t.Fatalf("flat collection: %v", err)
	}
	for _, name := range []string{"../SKILL.md", "/SKILL.md", "a\\SKILL.md"} {
		if _, err := ReadPackageArchive(repo, commit, archive(t, map[string]string{name: "bad"})); err == nil {
			t.Errorf("accepted %s", name)
		}
	}
}

func TestReleaseChecksOwnershipDigestRedirectAndPackageFiles(t *testing.T) {
	repo := Repository{URL: "https://github.com/o/r", Owner: "o", Name: "r"}
	commit := strings.Repeat("a", 40)
	bundle := archive(t, map[string]string{"safe/SKILL.md": "---\nname: safe\ndescription: A static workflow.\nlicense: MIT\n---\n\n# Workflow\n\n1. Read inputs.\n2. Validate results.\n"})
	sum := sha256.Sum256(bundle)
	digest := "sha256:" + hex.EncodeToString(sum[:])
	for _, mode := range []string{"good", "case", "digest", "owner", "redirect"} {
		t.Run(mode, func(t *testing.T) {
			client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				body := []byte{}
				headers := http.Header{}
				status := 200
				switch req.URL.Path {
				case "/repos/o/r/releases/latest":
					assetURL := repo.URL + "/releases/download/v1/skills.zip"
					assetDigest := digest
					if mode == "case" {
						assetURL = "https://github.com/O/R/releases/download/v1/skills.zip"
					}
					if mode == "owner" {
						assetURL = "https://github.com/evil/r/releases/download/v1/skills.zip"
					}
					if mode == "digest" {
						assetDigest = "sha256:" + strings.Repeat("0", 64)
					}
					body, _ = json.Marshal(map[string]any{"tag_name": "v1", "assets": []any{map[string]any{"id": 1, "name": "skills.zip", "size": len(bundle), "state": "uploaded", "digest": assetDigest, "browser_download_url": assetURL}}})
				case "/repos/o/r/commits/v1":
					body = []byte(`{"sha":"` + commit + `"}`)
				case "/repos/o/r/releases/assets/1":
					status = 302
					headers.Set("Location", "https://release-assets.githubusercontent.com/build.zip")
					if mode == "redirect" {
						headers.Set("Location", "http://127.0.0.1/private")
					}
				case "/build.zip":
					body = bundle
				default:
					t.Fatalf("unexpected URL: %s", req.URL)
				}
				return &http.Response{StatusCode: status, Header: headers, ContentLength: int64(len(body)), Body: io.NopCloser(bytes.NewReader(body))}, nil
			})}
			report, err := fetchReleaseWithClient(context.Background(), repo, "latest", 1, client)
			if mode != "good" && mode != "case" {
				if err == nil {
					t.Fatal("unsafe release accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if report.Package == nil || !report.Package.DigestVerified || len(report.Skills) != 1 || report.Skills[0].SourceURL != report.Package.SourceURL {
				t.Fatal("package evidence missing")
			}
		})
	}
}
