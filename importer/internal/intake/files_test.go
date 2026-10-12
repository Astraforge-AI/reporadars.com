package intake

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadJSONRejectsUnknownTrailingDuplicateAndSymlink(t *testing.T) {
	dir := t.TempDir()
	for name, data := range map[string]string{
		"unknown.json":   `{"extra":true}`,
		"trailing.json":  `{}` + ` {}`,
		"duplicate.json": `{"schemaVersion":1,"schemaVersion":2}`,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := LoadReport(filepath.Join(dir, name)); err == nil {
			t.Errorf("accepted %s", name)
		}
	}
	target := filepath.Join(dir, "target.json")
	if err := os.WriteFile(target, []byte(`{}`), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "link.json")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadReport(link); err == nil {
		t.Error("accepted symlink")
	}
}

func TestWriteJSONIsPrivateAndNeverOverwrites(t *testing.T) {
	path := filepath.Join(t.TempDir(), "report.json")
	if err := WriteJSON(path, Report{SchemaVersion: SchemaVersion}); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("mode %o", info.Mode().Perm())
	}
	if err := WriteJSON(path, Report{}); err == nil {
		t.Error("overwrote existing output")
	}
}
