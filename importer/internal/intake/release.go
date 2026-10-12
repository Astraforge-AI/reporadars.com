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
	"strings"
	"time"
)

// FetchRelease reads a bounded skill package uploaded by the repository owner. A release tag
// identifies source history, not proof that the package was built from it.
func FetchRelease(ctx context.Context, raw, tag string, assetID int64) (Report, error) {
	return FetchReleaseAuthenticated(ctx, raw, tag, assetID, "")
}

// API-only credentials do not cross to release storage or redirects.
func FetchReleaseAuthenticated(ctx context.Context, raw, tag string, assetID int64, token string) (Report, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	repo, err := ParseRepository(raw)
	if err != nil {
		return Report{}, err
	}
	client, err := secureClientFor(ctx, []string{"api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"})
	if err != nil {
		return Report{}, err
	}
	defer client.CloseIdleConnections()
	if token != "" {
		client.Transport = &githubTokenTransport{base: client.Transport, token: token}
	}
	return fetchReleaseWithClient(ctx, repo, tag, assetID, client)
}

func fetchReleaseWithClient(ctx context.Context, repo Repository, tag string, assetID int64, client *http.Client) (Report, error) {
	if assetID < 1 || (tag != "latest" && !validRef(tag)) {
		return Report{}, errors.New("invalid release selector")
	}
	endpoint := "https://api.github.com/repos/" + repo.Owner + "/" + repo.Name
	selector := "/releases/latest"
	if tag != "latest" {
		selector = "/releases/tags/" + url.PathEscape(tag)
	}
	data, err := getLimited(ctx, client, endpoint+selector, apiBodyLimit)
	if err != nil {
		return Report{}, err
	}
	var release struct {
		Tag        string `json:"tag_name"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
		Assets     []struct {
			ID     int64  `json:"id"`
			Name   string `json:"name"`
			Size   int64  `json:"size"`
			Digest string `json:"digest"`
			State  string `json:"state"`
			URL    string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if json.Unmarshal(data, &release) != nil || release.Draft || release.Prerelease || !validRef(release.Tag) {
		return Report{}, errors.New("invalid or unpublished release")
	}
	commitData, err := getLimited(ctx, client, endpoint+"/commits/"+url.PathEscape(release.Tag), apiBodyLimit)
	if err != nil {
		return Report{}, err
	}
	var commit struct {
		SHA string `json:"sha"`
	}
	if json.Unmarshal(commitData, &commit) != nil || !sha40.MatchString(commit.SHA) {
		return Report{}, errors.New("invalid tag commit")
	}
	for _, asset := range release.Assets {
		if asset.ID != assetID {
			continue
		}
		if asset.Size < 1 || asset.Size > MaxArchiveBytes || !packageName(asset.Name) || asset.State != "uploaded" {
			return Report{}, errors.New("only bounded uploaded ZIP, .skill and tar.gz assets are supported")
		}
		expectedURL := repo.URL + "/releases/download/" + url.PathEscape(release.Tag) + "/" + url.PathEscape(asset.Name)
		if len(asset.URL) < len(repo.URL) || !strings.EqualFold(asset.URL[:len(repo.URL)], repo.URL) || asset.URL[len(repo.URL):] != expectedURL[len(repo.URL):] {
			return Report{}, errors.New("asset URL does not match repository, tag and name")
		}
		archive, err := downloadReleaseAsset(ctx, client, endpoint+fmt.Sprintf("/releases/assets/%d", assetID))
		if err != nil {
			return Report{}, err
		}
		if int64(len(archive)) != asset.Size {
			return Report{}, errors.New("asset size mismatch")
		}
		digest := sha256.Sum256(archive)
		digestHex := hex.EncodeToString(digest[:])
		verified := asset.Digest != ""
		if verified && asset.Digest != "sha256:"+digestHex {
			return Report{}, errors.New("asset digest mismatch")
		}
		snapshot, err := ReadPackageArchive(repo, commit.SHA, archive)
		if err != nil {
			return Report{}, err
		}
		report, err := Analyze(snapshot)
		if err != nil {
			return Report{}, err
		}
		report.Package = &PackageEvidence{Kind: "release", ID: assetID, Tag: release.Tag, Name: asset.Name, SourceURL: expectedURL, DigestVerified: verified}
		for i := range report.Skills {
			report.Skills[i].SourceURL = expectedURL
		}
		return report, nil
	}
	return Report{}, errors.New("asset does not belong to selected release")
}

func packageName(name string) bool {
	name = strings.ToLower(name)
	return strings.HasSuffix(name, ".zip") || strings.HasSuffix(name, ".skill") || strings.HasSuffix(name, ".tar.gz") || strings.HasSuffix(name, ".tgz")
}

func downloadReleaseAsset(ctx context.Context, client *http.Client, raw string) ([]byte, error) {
	copyClient := *client
	copyClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	for hop := 0; hop < 4; hop++ {
		parsed, err := url.Parse(raw)
		if err != nil || parsed.Scheme != "https" || parsed.User != nil || parsed.Port() != "" || !releaseHost(parsed.Hostname()) {
			return nil, errors.New("unsafe asset download URL")
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Accept", "application/octet-stream")
		req.Header.Set("Accept-Encoding", "identity")
		resp, err := copyClient.Do(req)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode == 302 || resp.StatusCode == 301 || resp.StatusCode == 307 {
			location := resp.Header.Get("Location")
			resp.Body.Close()
			next, err := parsed.Parse(location)
			if err != nil || location == "" {
				return nil, errors.New("invalid asset redirect")
			}
			raw = next.String()
			continue
		}
		if resp.StatusCode != 200 || resp.ContentLength > MaxArchiveBytes || (resp.Header.Get("Content-Encoding") != "" && resp.Header.Get("Content-Encoding") != "identity") {
			resp.Body.Close()
			return nil, fmt.Errorf("asset HTTP status %d", resp.StatusCode)
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, MaxArchiveBytes+1))
		resp.Body.Close()
		if err != nil || len(body) > MaxArchiveBytes {
			return nil, errors.New("asset exceeds download limit")
		}
		return body, nil
	}
	return nil, errors.New("too many asset redirects")
}

func releaseHost(host string) bool {
	return host == "api.github.com" || host == "github.com" || host == "release-assets.githubusercontent.com" || host == "objects.githubusercontent.com"
}
