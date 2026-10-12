package intake

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

const apiBodyLimit = 1 << 20

var (
	namePart = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$`)
	sha40    = regexp.MustCompile(`^[0-9a-f]{40}$`)
	refPart  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$`)
)

// ParseRepository accepts only the canonical public GitHub HTTPS repository URL.
func ParseRepository(raw string) (Repository, error) {
	u, err := url.Parse(raw)
	if err != nil || u.String() != raw || u.Scheme != "https" || u.Host != "github.com" ||
		u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Port() != "" {
		return Repository{}, errors.New("repository must be an HTTPS github.com owner/repo URL")
	}
	parts := strings.Split(u.EscapedPath(), "/")
	if len(parts) != 3 || parts[0] != "" || parts[1] == "" || parts[2] == "" ||
		strings.Contains(parts[1], "%") || strings.Contains(parts[2], "%") {
		return Repository{}, errors.New("repository path must contain owner and repository only")
	}
	name := strings.TrimSuffix(parts[2], ".git")
	if !namePart.MatchString(parts[1]) || !namePart.MatchString(name) || name == "." || name == ".." {
		return Repository{}, errors.New("invalid GitHub owner or repository")
	}
	return Repository{URL: "https://github.com/" + parts[1] + "/" + name, Owner: parts[1], Name: name}, nil
}

// Fetch resolves a ref to an immutable commit and reads GitHub's zip archive.
func Fetch(ctx context.Context, raw, ref string) (Snapshot, error) {
	return FetchAuthenticated(ctx, raw, ref, "")
}

// FetchAuthenticated sends credentials only to GitHub API requests, never archives.
func FetchAuthenticated(ctx context.Context, raw, ref, token string) (Snapshot, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	if _, err := ParseRepository(raw); err != nil {
		return Snapshot{}, err
	}
	client, err := secureClient(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	defer client.CloseIdleConnections()
	if token != "" {
		client.Transport = &githubTokenTransport{base: client.Transport, token: token}
	}
	return fetchWithClient(ctx, raw, ref, client)
}

// fetchWithClient keeps network injection private to this package's tests.
func fetchWithClient(ctx context.Context, raw, ref string, client *http.Client) (Snapshot, error) {
	repo, err := ParseRepository(raw)
	if err != nil {
		return Snapshot{}, err
	}
	if ref == "" {
		ref = "HEAD"
	}
	if !validRef(ref) {
		return Snapshot{}, errors.New("invalid git ref")
	}
	commitURL := "https://api.github.com/repos/" + repo.Owner + "/" + repo.Name + "/commits/" + url.PathEscape(ref)
	body, err := getLimited(ctx, client, commitURL, apiBodyLimit)
	if err != nil {
		return Snapshot{}, fmt.Errorf("resolve commit: %w", err)
	}
	var commit struct {
		SHA string `json:"sha"`
	}
	if err := json.Unmarshal(body, &commit); err != nil || !sha40.MatchString(commit.SHA) {
		return Snapshot{}, errors.New("GitHub returned an invalid commit SHA")
	}
	archive, err := getLimited(ctx, client, "https://codeload.github.com/"+repo.Owner+"/"+repo.Name+"/zip/"+commit.SHA, MaxArchiveBytes)
	if err != nil {
		return Snapshot{}, fmt.Errorf("download archive: %w", err)
	}
	return ReadArchive(repo, commit.SHA, archive)
}

// ReadArchive validates and materializes a GitHub ZIP without extracting it.
func ReadArchive(repo Repository, commit string, archive []byte) (Snapshot, error) {
	return readArchive(repo, commit, archive, true)
}

// ReadPackageArchive detects ZIP/.skill and gzip-compressed TAR by content.
func ReadPackageArchive(repo Repository, commit string, archive []byte) (Snapshot, error) {
	if bytes.HasPrefix(archive, []byte{0x1f, 0x8b}) {
		return readTarPackage(repo, commit, archive)
	}
	return readArchive(repo, commit, archive, false)
}

func readArchive(repo Repository, commit string, archive []byte, stripWrapper bool) (Snapshot, error) {
	if !sha40.MatchString(commit) || len(archive) > MaxArchiveBytes {
		return Snapshot{}, errors.New("invalid commit or archive too large")
	}
	zr, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil || len(zr.File) > MaxEntries {
		return Snapshot{}, errors.New("invalid or excessive ZIP archive")
	}
	files := make(map[string][]byte)
	seen := make(map[string]struct{})
	wrapper := ""
	var total int64
	for _, f := range zr.File {
		name, isDir, err := zipPath(f)
		if err != nil {
			return Snapshot{}, err
		}
		first, rest, hasRest := strings.Cut(name, "/")
		if wrapper == "" {
			wrapper = first
		}
		if stripWrapper && (first != wrapper || (!hasRest && !isDir) || (hasRest && rest == "")) {
			return Snapshot{}, errors.New("ZIP archive has an inconsistent wrapper directory")
		}
		key := strings.ToLower(name)
		if _, exists := seen[key]; exists {
			return Snapshot{}, errors.New("ZIP archive has duplicate paths")
		}
		seen[key] = struct{}{}
		if stripWrapper && !hasRest {
			continue
		}
		if !stripWrapper {
			rest = name
		}
		if isDir {
			continue
		}
		if f.UncompressedSize64 > MaxFileBytes || total+int64(f.UncompressedSize64) > MaxExpandedBytes {
			return Snapshot{}, errors.New("ZIP archive expands beyond limits")
		}
		rc, err := f.Open()
		if err != nil {
			return Snapshot{}, fmt.Errorf("open ZIP file: %w", err)
		}
		data, readErr := io.ReadAll(io.LimitReader(rc, MaxFileBytes+1))
		closeErr := rc.Close()
		if readErr != nil || closeErr != nil || len(data) > MaxFileBytes || uint64(len(data)) != f.UncompressedSize64 {
			return Snapshot{}, errors.New("ZIP file is corrupt or exceeds limits")
		}
		total += int64(len(data))
		if total > MaxExpandedBytes {
			return Snapshot{}, errors.New("ZIP archive expands beyond limits")
		}
		files[rest] = data
	}
	if wrapper == "" {
		return Snapshot{}, errors.New("ZIP archive is empty")
	}
	sum := sha256.Sum256(archive)
	return Snapshot{Repository: repo, Commit: commit, ArchiveSHA256: hex.EncodeToString(sum[:]), Files: files}, nil
}

func zipPath(f *zip.File) (string, bool, error) {
	name, mode := f.Name, f.Mode()
	isDir := f.FileInfo().IsDir()
	if (isDir != strings.HasSuffix(name, "/")) ||
		(mode&os.ModeType != 0 && !isDir) {
		return "", false, errors.New("ZIP archive contains an unsafe entry")
	}
	trimmed, err := archivePath(name)
	return trimmed, isDir, err
}

func archivePath(name string) (string, error) {
	if name == "" || strings.ContainsAny(name, "\\\x00:") || strings.HasPrefix(name, "/") || strings.Contains(name, "//") {
		return "", errors.New("archive contains an unsafe path")
	}
	trimmed := strings.TrimSuffix(name, "/")
	for _, part := range strings.Split(trimmed, "/") {
		if part == "" || part == "." || part == ".." {
			return "", errors.New("archive contains an unsafe path")
		}
	}
	return trimmed, nil
}

func validRef(ref string) bool {
	if sha40.MatchString(ref) {
		return true
	}
	if !refPart.MatchString(ref) || strings.Contains(ref, "//") || strings.HasSuffix(ref, "/") {
		return false
	}
	for _, p := range strings.Split(ref, "/") {
		if p == "." || p == ".." {
			return false
		}
	}
	return true
}

func getLimited(ctx context.Context, client *http.Client, raw string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, raw, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept-Encoding", "identity")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK || (resp.ContentLength > limit) ||
		(resp.Header.Get("Content-Encoding") != "" && resp.Header.Get("Content-Encoding") != "identity") {
		return nil, fmt.Errorf("unexpected HTTP response: %s", resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil || int64(len(body)) > limit {
		return nil, errors.New("HTTP response exceeds limit")
	}
	return body, nil
}

func secureClient(ctx context.Context) (*http.Client, error) {
	return secureClientFor(ctx, []string{"api.github.com", "codeload.github.com"})
}

func secureClientFor(ctx context.Context, hosts []string) (*http.Client, error) {
	pinned := make(map[string][]netip.Addr, len(hosts))
	resolver := net.DefaultResolver
	for _, host := range hosts {
		ips, err := resolver.LookupNetIP(ctx, "ip", host)
		if err != nil || len(ips) == 0 {
			return nil, fmt.Errorf("resolve %s: %w", host, err)
		}
		for _, ip := range ips {
			if !publicIP(ip) {
				return nil, fmt.Errorf("unsafe address for %s", host)
			}
		}
		pinned[host] = ips
	}
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	transport := &http.Transport{Proxy: nil, DisableCompression: true, TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 15 * time.Second,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			ips, ok := pinned[host]
			if !ok {
				return nil, errors.New("disallowed HTTP host")
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
		},
	}
	return &http.Client{Transport: transport, Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirects are denied") }}, nil
}

func publicIP(ip netip.Addr) bool {
	if !ip.IsValid() || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return false
	}
	if ip.Is4() {
		v := ip.As4()
		return v[0] != 0 && v[0] != 100 && v[0] != 127 && !(v[0] == 169 && v[1] == 254) &&
			!(v[0] == 192 && v[1] == 0) && !(v[0] == 192 && v[1] == 88) && !(v[0] == 198 && (v[1] == 18 || v[1] == 19)) &&
			!(v[0] == 192 && v[1] == 0 && v[2] == 2) && !(v[0] == 198 && v[1] == 51 && v[2] == 100) && !(v[0] == 203 && v[1] == 0 && v[2] == 113)
	}
	if ip.Is6() {
		v := ip.As16()
		return !(v[0] == 0x20 && v[1] == 0x01 && v[2] == 0x0d && v[3] == 0xb8)
	}
	return false
}
