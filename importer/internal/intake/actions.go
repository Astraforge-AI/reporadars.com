package intake

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"
)

func ReadGitHubToken(path string) (string, error) {
	if path == "" {
		return "", nil
	}
	if !filepath.IsAbs(path) {
		return "", errors.New("GitHub credential path must be absolute")
	}
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return "", errors.New("GitHub credential unavailable")
	}
	defer f.Close()
	meta, err := f.Stat()
	if err != nil || !meta.Mode().IsRegular() || meta.Size() > 4096 || meta.Mode().Perm()&0037 != 0 {
		return "", errors.New("GitHub credential must be a private regular file")
	}
	if stat, ok := meta.Sys().(*syscall.Stat_t); !ok || (stat.Uid != 0 && stat.Uid != uint32(os.Getuid())) {
		return "", errors.New("GitHub credential owner is invalid")
	}
	data, err := io.ReadAll(io.LimitReader(f, 4097))
	token := strings.TrimSpace(string(data))
	if err != nil || len(token) < 20 || len(data) > 4096 || strings.ContainsAny(token, "\r\n\t ") {
		return "", errors.New("Invalid GitHub credential")
	}
	return token, nil
}

// An Actions run SHA records workflow context, not a build attestation.
func FetchActions(ctx context.Context, raw string, artifactID, workflowID int64, token string) (Report, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	repo, err := ParseRepository(raw)
	if err != nil {
		return Report{}, err
	}
	client, err := secureClientFor(ctx, []string{"api.github.com"})
	if err != nil {
		return Report{}, err
	}
	defer client.CloseIdleConnections()
	client.Transport = &githubTokenTransport{base: client.Transport, token: token}
	return fetchActionsWithClient(ctx, repo, artifactID, workflowID, client, downloadActionsArchive)
}

type githubTokenTransport struct {
	base  http.RoundTripper
	token string
}

func (t *githubTokenTransport) CloseIdleConnections() {
	if closer, ok := t.base.(interface{ CloseIdleConnections() }); ok {
		closer.CloseIdleConnections()
	}
}

func (t *githubTokenTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	if req.URL.Scheme != "https" || req.URL.Host != "api.github.com" {
		return nil, errors.New("GitHub credentials require the API host")
	}
	if t.token != "" {
		req.Header.Set("Authorization", "Bearer "+t.token)
	}
	req.Header.Set("User-Agent", "Reporadars-intake/1")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	return t.base.RoundTrip(req)
}

type artifactDownload func(context.Context, *http.Client, string) ([]byte, error)

func fetchActionsWithClient(ctx context.Context, repo Repository, artifactID, workflowID int64, client *http.Client, download artifactDownload) (Report, error) {
	if artifactID < 1 || workflowID < 1 {
		return Report{}, errors.New("explicit artifact and approved workflow are required")
	}
	endpoint := "https://api.github.com/repos/" + repo.Owner + "/" + repo.Name
	data, err := getLimited(ctx, client, endpoint+fmt.Sprintf("/actions/artifacts/%d", artifactID), apiBodyLimit)
	if err != nil {
		return Report{}, err
	}
	var asset struct {
		ID      int64  `json:"id"`
		Name    string `json:"name"`
		Size    int64  `json:"size_in_bytes"`
		Expired bool   `json:"expired"`
		Expires string `json:"expires_at"`
		Digest  string `json:"digest"`
		Run     struct {
			ID               int64  `json:"id"`
			RepositoryID     int64  `json:"repository_id"`
			HeadRepositoryID int64  `json:"head_repository_id"`
			SHA              string `json:"head_sha"`
		} `json:"workflow_run"`
	}
	if json.Unmarshal(data, &asset) != nil {
		return Report{}, errors.New("invalid artifact metadata")
	}
	expires, err := time.Parse(time.RFC3339, asset.Expires)
	if err != nil || asset.Expired || !expires.After(time.Now()) {
		return Report{}, errors.New("artifact expired or unavailable")
	}
	if asset.ID != artifactID || asset.Size < 1 || asset.Size > MaxArchiveBytes || len(asset.Name) > 255 || asset.Name == "" ||
		asset.Run.ID < 1 || asset.Run.RepositoryID < 1 || asset.Run.RepositoryID != asset.Run.HeadRepositoryID || !sha40.MatchString(asset.Run.SHA) {
		return Report{}, errors.New("invalid or foreign artifact metadata")
	}
	data, err = getLimited(ctx, client, endpoint+fmt.Sprintf("/actions/runs/%d", asset.Run.ID), apiBodyLimit)
	if err != nil {
		return Report{}, err
	}
	var run struct {
		ID         int64  `json:"id"`
		WorkflowID int64  `json:"workflow_id"`
		Attempt    int    `json:"run_attempt"`
		Status     string `json:"status"`
		Conclusion string `json:"conclusion"`
		Event      string `json:"event"`
		SHA        string `json:"head_sha"`
		Path       string `json:"path"`
		Repository struct {
			ID  int64  `json:"id"`
			URL string `json:"html_url"`
		} `json:"repository"`
		HeadRepository struct {
			ID int64 `json:"id"`
		} `json:"head_repository"`
	}
	if json.Unmarshal(data, &run) != nil || run.ID != asset.Run.ID || run.WorkflowID != workflowID || run.Attempt < 1 ||
		run.Status != "completed" || run.Conclusion != "success" || (run.Event != "push" && run.Event != "workflow_dispatch" && run.Event != "schedule") ||
		run.SHA != asset.Run.SHA || run.Repository.ID != asset.Run.RepositoryID || run.HeadRepository.ID != run.Repository.ID ||
		!strings.EqualFold(run.Repository.URL, repo.URL) || !strings.HasPrefix(run.Path, ".github/workflows/") || len(run.Path) > 512 {
		return Report{}, errors.New("unapproved or untrusted workflow run")
	}
	archive, err := download(ctx, client, endpoint+fmt.Sprintf("/actions/artifacts/%d/zip", artifactID))
	if err != nil {
		return Report{}, err
	}
	if int64(len(archive)) != asset.Size {
		return Report{}, errors.New("artifact size mismatch")
	}
	sum := sha256.Sum256(archive)
	verified := asset.Digest != ""
	if verified && asset.Digest != "sha256:"+hex.EncodeToString(sum[:]) {
		return Report{}, errors.New("artifact digest mismatch")
	}
	snapshot, err := ReadPackageArchive(repo, run.SHA, archive)
	if err != nil {
		return Report{}, err
	}
	snapshot, err = expandActionsPackages(snapshot)
	if err != nil {
		return Report{}, err
	}
	report, err := Analyze(snapshot)
	if err != nil {
		return Report{}, err
	}
	source := repo.URL + fmt.Sprintf("/actions/runs/%d", run.ID)
	report.Package = &PackageEvidence{Kind: "actions", ID: artifactID, Name: asset.Name, SourceURL: source,
		DigestVerified: verified, RunID: run.ID, WorkflowID: run.WorkflowID, WorkflowPath: run.Path, RunAttempt: run.Attempt}
	for i := range report.Skills {
		report.Skills[i].SourceURL = source
	}
	return report, nil
}

// Artifacts commonly wrap ready-made .skill files rather than loose SKILL.md.
// Expand one level only, while keeping a shared file/byte budget.
func expandActionsPackages(snapshot Snapshot) (Snapshot, error) {
	var total int64
	names := make([]string, 0, len(snapshot.Files))
	for name, data := range snapshot.Files {
		total += int64(len(data))
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		data := snapshot.Files[name]
		if !packageName(name) {
			continue
		}
		nested, err := ReadPackageArchive(snapshot.Repository, snapshot.Commit, data)
		if err != nil {
			return Snapshot{}, err
		}
		for path, body := range nested.Files {
			if packageName(path) {
				return Snapshot{}, errors.New("artifact packages exceed nesting limit")
			}
			if _, exists := snapshot.Files[name+"!/"+path]; exists {
				return Snapshot{}, errors.New("artifact packages contain duplicate paths")
			}
			total += int64(len(body))
			if total > MaxExpandedBytes || len(snapshot.Files) >= MaxEntries {
				return Snapshot{}, errors.New("artifact packages expand beyond limits")
			}
			snapshot.Files[name+"!/"+path] = body
		}
	}
	return snapshot, nil
}

func actionsDownloadURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" || u.Fragment != "" {
		return nil, errors.New("unsafe artifact redirect")
	}
	host := u.Hostname()
	if host != "objects.githubusercontent.com" && host != "results-receiver.actions.githubusercontent.com" &&
		!strings.HasSuffix(host, ".blob.core.windows.net") && !strings.HasSuffix(host, ".actions.githubusercontent.com") {
		return nil, errors.New("unapproved artifact download host")
	}
	return u, nil
}

func downloadActionsArchive(ctx context.Context, api *http.Client, endpoint string) ([]byte, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	resp, err := api.Do(req)
	if err != nil {
		return nil, err
	}
	resp.Body.Close()
	if resp.StatusCode == 404 || resp.StatusCode == 410 {
		return nil, errors.New("artifact expired or unavailable")
	}
	if resp.StatusCode != 302 {
		return nil, fmt.Errorf("artifact download HTTP %d", resp.StatusCode)
	}
	raw := resp.Header.Get("Location")
	for redirects := 0; redirects < 4; redirects++ {
		u, err := actionsDownloadURL(raw)
		if err != nil {
			return nil, err
		}
		// Pin the exact public IP from GitHub's short-lived redirect. No API token
		// is passed to this separate transport, and the signed URL is never saved.
		client, err := secureClientFor(ctx, []string{u.Hostname()})
		if err != nil {
			return nil, errors.New("artifact download host unavailable")
		}
		req, _ = http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
		req.Header.Set("Accept-Encoding", "identity")
		resp, err = client.Do(req)
		if err != nil {
			client.CloseIdleConnections()
			return nil, errors.New("artifact download failed")
		}
		if resp.StatusCode == 302 || resp.StatusCode == 301 || resp.StatusCode == 307 {
			next, e := u.Parse(resp.Header.Get("Location"))
			resp.Body.Close()
			client.CloseIdleConnections()
			if e != nil {
				return nil, errors.New("invalid artifact redirect")
			}
			raw = next.String()
			continue
		}
		if resp.StatusCode != 200 || resp.ContentLength > MaxArchiveBytes || (resp.Header.Get("Content-Encoding") != "" && resp.Header.Get("Content-Encoding") != "identity") {
			resp.Body.Close()
			client.CloseIdleConnections()
			return nil, errors.New("artifact download unavailable or too large")
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, MaxArchiveBytes+1))
		resp.Body.Close()
		client.CloseIdleConnections()
		if err != nil || len(body) > MaxArchiveBytes {
			return nil, errors.New("artifact download exceeds limit")
		}
		return body, nil
	}
	return nil, errors.New("too many artifact redirects")
}
