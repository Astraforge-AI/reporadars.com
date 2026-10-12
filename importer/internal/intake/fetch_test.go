package intake

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"os"
	"strings"
	"testing"
)

func archive(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	for n, s := range entries {
		f, err := w.Create(n)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write([]byte(s)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestParseRepositoryRejectsUnsafeURLs(t *testing.T) {
	bad := []string{"http://github.com/o/r", "https://github.com:443/o/r", "https://u@github.com/o/r", "https://github.com/o/r?x=1", "https://github.com/o/../r", "https://github.com/o/r/"}
	for _, raw := range bad {
		if _, err := ParseRepository(raw); err == nil {
			t.Errorf("accepted %q", raw)
		}
	}
	r, err := ParseRepository("https://github.com/owner/repo.git")
	if err != nil || r.URL != "https://github.com/owner/repo" {
		t.Fatalf("got %#v, %v", r, err)
	}
}

func TestReadArchiveRejectsUnsafeEntries(t *testing.T) {
	repo := Repository{URL: "https://github.com/o/r", Owner: "o", Name: "r"}
	commit := "0123456789012345678901234567890123456789"
	for _, name := range []string{"root/../x", "root\\x", "/root/x"} {
		if _, err := ReadArchive(repo, commit, archive(t, map[string]string{name: "x"})); err == nil {
			t.Errorf("accepted %q", name)
		}
	}
	if _, err := ReadArchive(repo, commit, archive(t, map[string]string{"a/x": "1", "b/y": "2"})); err == nil {
		t.Error("accepted mixed wrappers")
	}
	if _, err := ReadArchive(repo, commit, archive(t, map[string]string{"root/A": "1", "root/a": "2"})); err == nil {
		t.Error("accepted case-fold duplicate")
	}
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	h := &zip.FileHeader{Name: "root/link"}
	h.SetMode(os.ModeSymlink | 0755)
	f, err := w.CreateHeader(h)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write([]byte("target")); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadArchive(repo, commit, b.Bytes()); err == nil {
		t.Error("accepted symlink")
	}
}

func TestReadArchiveLimitsAndFiles(t *testing.T) {
	repo := Repository{URL: "https://github.com/o/r", Owner: "o", Name: "r"}
	commit := "0123456789012345678901234567890123456789"
	entries := map[string]string{"root/skill/SKILL.md": "hello"}
	for i := 0; i < 40; i++ {
		entries[fmt.Sprintf("root/skills/skill-%02d/SKILL.md", i)] = "bytes"
	}
	data := archive(t, entries)
	got, err := ReadArchive(repo, commit, data)
	if err != nil || len(got.Files) != 41 || string(got.Files["skill/SKILL.md"]) != "hello" || got.ArchiveSHA256 == "" {
		t.Fatalf("snapshot %#v, %v", got, err)
	}
	big := string(make([]byte, MaxFileBytes+1))
	if _, err := ReadArchive(repo, commit, archive(t, map[string]string{"root/big": big})); err == nil {
		t.Error("accepted oversized expanded file")
	}
}

func TestPublicIPRejectsPrivateAndReserved(t *testing.T) {
	for _, s := range []string{"127.0.0.1", "10.0.0.1", "192.0.2.1", "::1", "fc00::1", "2001:db8::1"} {
		if publicIP(netip.MustParseAddr(s)) {
			t.Errorf("accepted %s", s)
		}
	}
	if !publicIP(netip.MustParseAddr("8.8.8.8")) {
		t.Error("rejected public IPv4")
	}
}

func TestFetchRejectsBadRefBeforeNetwork(t *testing.T) {
	if _, err := fetchWithClient(context.Background(), "https://github.com/o/r", "../main", nil); err == nil {
		t.Error("accepted traversal ref")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestFetchPinsResolvedCommitWithOfflineHTTP(t *testing.T) {
	commit := "0123456789012345678901234567890123456789"
	zipBody := archive(t, map[string]string{"repo-" + commit + "/SKILL.md": "safe"})
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		var body []byte
		switch r.URL.String() {
		case "https://api.github.com/repos/o/r/commits/main":
			body = []byte(`{"sha":"` + commit + `"}`)
		case "https://codeload.github.com/o/r/zip/" + commit:
			body = zipBody
		default:
			t.Fatalf("unexpected request %s", r.URL)
		}
		return &http.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(body)), ContentLength: int64(len(body)), Request: r}, nil
	})}
	got, err := fetchWithClient(context.Background(), "https://github.com/o/r", "main", client)
	if err != nil || string(got.Files["SKILL.md"]) != "safe" {
		t.Fatalf("snapshot %#v, %v", got, err)
	}
}

func TestGetLimitedRejectsCompressedResponse(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		h := make(http.Header)
		h.Set("Content-Encoding", "gzip")
		return &http.Response{StatusCode: 200, Status: "200 OK", Header: h, Body: io.NopCloser(strings.NewReader("x"))}, nil
	})}
	if _, err := getLimited(context.Background(), client, "https://api.github.com/x", 10); err == nil {
		t.Error("accepted compressed response")
	}
}
