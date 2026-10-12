package intake

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"strings"
	"testing"
)

func tarBundle(t *testing.T, headers []*tar.Header, content string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for _, header := range headers {
		if err := tw.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		if header.Size > 0 {
			if _, err := tw.Write([]byte(strings.Repeat(content, int(header.Size))[:header.Size])); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestTarPackageReadsCollectionsAndPreservesArchiveHash(t *testing.T) {
	repo := Repository{URL: "https://github.com/o/r", Owner: "o", Name: "r"}
	commit := strings.Repeat("a", 40)
	bundle := tarBundle(t, []*tar.Header{
		{Name: "./", Typeflag: tar.TypeDir, Mode: 0755},
		{Name: "./SKILL.md", Mode: 0644, Size: 1},
		{Name: "./nested/SKILL.md", Mode: 0644, Size: 1},
	}, "x")
	snap, err := ReadPackageArchive(repo, commit, bundle)
	if err != nil || len(snap.Files) != 2 || string(snap.Files["nested/SKILL.md"]) != "x" || len(snap.ArchiveSHA256) != 64 {
		t.Fatalf("collection: %v", err)
	}
	zip := archive(t, map[string]string{"SKILL.md": "x"})
	if _, err := ReadPackageArchive(repo, commit, zip); err != nil {
		t.Fatal(".skill ZIP: ", err)
	}
}

func TestTarPackageRejectsUnsafeEntriesAndPaths(t *testing.T) {
	repo, commit := Repository{}, strings.Repeat("a", 40)
	for _, name := range []string{"../SKILL.md", "/SKILL.md", "a/../SKILL.md", "a\\SKILL.md", "C:SKILL.md", "a//SKILL.md"} {
		bundle := tarBundle(t, []*tar.Header{{Name: name, Mode: 0644, Size: 1}}, "x")
		if _, err := ReadPackageArchive(repo, commit, bundle); err == nil {
			t.Errorf("accepted %s", name)
		}
	}
	for _, kind := range []byte{tar.TypeSymlink, tar.TypeLink, tar.TypeFifo, tar.TypeChar, tar.TypeBlock} {
		bundle := tarBundle(t, []*tar.Header{{Name: "SKILL.md", Typeflag: kind, Linkname: "../private"}}, "x")
		if _, err := ReadPackageArchive(repo, commit, bundle); err == nil {
			t.Errorf("accepted type %d", kind)
		}
	}
}

func TestTarPackageRejectsDuplicatesOversizeCorruptionAndConcatenation(t *testing.T) {
	repo, commit := Repository{}, strings.Repeat("a", 40)
	good := tarBundle(t, []*tar.Header{{Name: "SKILL.md", Mode: 0644, Size: 1}}, "x")
	bad := [][]byte{
		tarBundle(t, []*tar.Header{{Name: "SKILL.md", Size: 1}, {Name: "skill.md", Size: 1}}, "x"),
		tarBundle(t, []*tar.Header{{Name: "SKILL.md", Size: MaxFileBytes + 1}}, "x"),
		good[:len(good)-1],
		append(append([]byte{}, good...), good...),
		[]byte("not an archive"),
	}
	for i, bundle := range bad {
		if _, err := ReadPackageArchive(repo, commit, bundle); err == nil {
			t.Errorf("accepted case %d", i)
		}
	}
	for _, name := range []string{"a.zip", "a.skill", "a.tar.gz", "a.tgz", "A.SKILL"} {
		if !packageName(name) {
			t.Errorf("unsupported name %s", name)
		}
	}
	if packageName("a.sh") {
		t.Fatal("accepted executable asset")
	}
}
