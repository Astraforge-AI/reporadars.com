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
	"time"
)

func TestActionsChecksArtifactWorkflowOriginExpiryAndDigest(t *testing.T) {
	repo := Repository{URL: "https://github.com/o/r", Owner: "o", Name: "r"}
	commit := strings.Repeat("a", 40)
	bundle := archive(t, map[string]string{"safe/SKILL.md": "---\nname: safe\ndescription: An isolated workflow.\nlicense: MIT\n---\n\n1. Read inputs.\n2. Validate outputs.\n"})
	sum := sha256.Sum256(bundle)
	for _, mode := range []string{"good", "expired", "workflow", "fork", "pull_request", "digest", "sha", "status"} {
		t.Run(mode, func(t *testing.T) {
			run := map[string]any{"id": 21, "workflow_id": 4, "run_attempt": 1, "status": "completed", "conclusion": "success", "event": "push", "head_sha": commit,
				"path": ".github/workflows/build.yml", "repository": map[string]any{"id": 1, "html_url": repo.URL}, "head_repository": map[string]any{"id": 1}}
			asset := map[string]any{"id": 11, "name": "skills", "size_in_bytes": len(bundle), "expired": false, "expires_at": time.Now().Add(time.Hour).Format(time.RFC3339),
				"digest": "sha256:" + hex.EncodeToString(sum[:]), "workflow_run": map[string]any{"id": 21, "repository_id": 1, "head_repository_id": 1, "head_sha": commit}}
			switch mode {
			case "expired":
				asset["expired"] = true
			case "workflow":
				run["workflow_id"] = 5
			case "fork":
				run["head_repository"] = map[string]any{"id": 2}
			case "pull_request":
				run["event"] = "pull_request_target"
			case "digest":
				asset["digest"] = "sha256:" + strings.Repeat("0", 64)
			case "sha":
				run["head_sha"] = strings.Repeat("b", 40)
			case "status":
				run["conclusion"] = "failure"
			}
			client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				value := any(asset)
				if strings.HasSuffix(req.URL.Path, "/actions/runs/21") {
					value = run
				}
				data, _ := json.Marshal(value)
				return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(bytes.NewReader(data))}, nil
			})}
			report, err := fetchActionsWithClient(context.Background(), repo, 11, 4, client, func(context.Context, *http.Client, string) ([]byte, error) { return bundle, nil })
			if mode != "good" {
				if err == nil {
					t.Fatal("untrusted artifact accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if report.Package.Kind != "actions" || !report.Package.DigestVerified || report.Package.RunID != 21 || report.Commit != commit || len(report.Skills) != 1 {
				t.Fatal("missing Actions evidence")
			}
		})
	}
}

func TestActionsCredentialsCannotReachDownloadHosts(t *testing.T) {
	calls := 0
	transport := &githubTokenTransport{token: "fixture-private-token", base: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		if req.Header.Get("Authorization") != "Bearer fixture-private-token" {
			t.Fatal("API credential missing")
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(""))}, nil
	})}
	req, _ := http.NewRequest("GET", "https://api.github.com/repos/o/r/actions/artifacts", nil)
	if _, err := transport.RoundTrip(req); err != nil {
		t.Fatal(err)
	}
	req, _ = http.NewRequest("GET", "https://example.blob.core.windows.net/artifact?signature=fixture", nil)
	if _, err := transport.RoundTrip(req); err == nil {
		t.Fatal("credential sent to download host")
	}
	if calls != 1 {
		t.Fatal("unexpected requests")
	}
	for _, raw := range []string{"http://127.0.0.1/private", "https://github.com.evil.test/file", "https://user@objects.githubusercontent.com/file", "https://objects.githubusercontent.com:444/file"} {
		if _, err := actionsDownloadURL(raw); err == nil {
			t.Errorf("accepted %s", raw)
		}
	}
}

func TestActionsExpandsOneLevelOfReadyMadeSkillPackages(t *testing.T) {
	inner := archive(t, map[string]string{"SKILL.md": "workflow"})
	outer := archive(t, map[string]string{"ready.skill": string(inner)})
	snapshot, err := ReadPackageArchive(Repository{}, strings.Repeat("a", 40), outer)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err = expandActionsPackages(snapshot)
	if err != nil || string(snapshot.Files["ready.skill!/SKILL.md"]) != "workflow" {
		t.Fatalf("wrapped .skill: %v", err)
	}
	nested := archive(t, map[string]string{"nested.skill": string(inner)})
	tooDeep, err := ReadPackageArchive(Repository{}, strings.Repeat("a", 40), archive(t, map[string]string{"ready.skill": string(nested)}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = expandActionsPackages(tooDeep); err == nil {
		t.Fatal("accepted recursive packages")
	}
}
