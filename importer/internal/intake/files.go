package intake

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"syscall"
)

const maxJSONBytes = 8 << 20

func LoadReport(path string) (Report, error) {
	var value Report
	return value, loadJSON(path, &value, '{')
}

func LoadReviews(path string) (Reviews, error) {
	var value Reviews
	return value, loadJSON(path, &value, '{')
}

func LoadCatalog(path string) ([]CatalogEntry, error) {
	var value []CatalogEntry
	return value, loadJSON(path, &value, '[')
}

// LoadProviderOutput preserves the provider envelope for the draft validator.
func LoadProviderOutput(path string) ([]byte, error) {
	var value json.RawMessage
	err := loadJSON(path, &value, '{')
	return value, err
}

// WriteJSON creates a private JSON file once. It never replaces an existing file.
func WriteJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("encode JSON: %w", err)
	}
	data = append(data, '\n')
	if len(data) > maxJSONBytes {
		return errors.New("JSON output exceeds limit")
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return fmt.Errorf("create output: %w", err)
	}
	ok := false
	defer func() {
		f.Close()
		if !ok {
			os.Remove(path)
		}
	}()
	if _, err := f.Write(data); err != nil {
		return fmt.Errorf("write output: %w", err)
	}
	if err := f.Sync(); err != nil {
		return fmt.Errorf("sync output: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("close output: %w", err)
	}
	ok = true
	return nil
}

func loadJSON(path string, out any, expected byte) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("inspect JSON input: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() > maxJSONBytes {
		return errors.New("JSON input must be a bounded regular file")
	}
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return fmt.Errorf("open JSON input: %w", err)
	}
	defer f.Close()
	info, err = f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxJSONBytes {
		return errors.New("JSON input must be a bounded regular file")
	}
	data, err := io.ReadAll(io.LimitReader(f, maxJSONBytes+1))
	if err != nil || len(data) > maxJSONBytes {
		return errors.New("JSON input exceeds limit")
	}
	if data = bytes.TrimSpace(data); len(data) == 0 || data[0] != expected {
		return errors.New("JSON input has an invalid top-level value")
	}
	if err := rejectDuplicateJSONKeys(data); err != nil {
		return err
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		return errors.New("invalid JSON input")
	}
	if dec.Decode(&struct{}{}) != io.EOF {
		return errors.New("JSON input has trailing data")
	}
	return nil
}

func rejectDuplicateJSONKeys(data []byte) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	depth := 0
	var read func() error
	read = func() error {
		depth++
		defer func() { depth-- }()
		if depth > 64 {
			return errors.New("JSON nesting limit")
		}
		tok, err := dec.Token()
		if err != nil {
			return errors.New("invalid JSON input")
		}
		switch start := tok.(type) {
		case json.Delim:
			switch start {
			case '{':
				seen := map[string]bool{}
				for dec.More() {
					key, err := dec.Token()
					if err != nil {
						return errors.New("invalid JSON input")
					}
					s, ok := key.(string)
					if !ok || seen[s] {
						return errors.New("JSON input has duplicate keys")
					}
					seen[s] = true
					if err := read(); err != nil {
						return err
					}
				}
				if end, err := dec.Token(); err != nil || end != json.Delim('}') {
					return errors.New("invalid JSON input")
				}
			case '[':
				for dec.More() {
					if err := read(); err != nil {
						return err
					}
				}
				if end, err := dec.Token(); err != nil || end != json.Delim(']') {
					return errors.New("invalid JSON input")
				}
			default:
				return errors.New("invalid JSON input")
			}
		}
		return nil
	}
	if err := read(); err != nil {
		return err
	}
	if dec.More() {
		return errors.New("JSON input has trailing data")
	}
	if _, err := dec.Token(); err != io.EOF {
		return errors.New("JSON input has trailing data")
	}
	return nil
}
