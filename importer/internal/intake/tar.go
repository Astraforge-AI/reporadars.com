package intake

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"strings"
)

func readTarPackage(repo Repository, commit string, archive []byte) (Snapshot, error) {
	if !sha40.MatchString(commit) || len(archive) > MaxArchiveBytes {
		return Snapshot{}, errors.New("invalid commit or archive too large")
	}
	input := bytes.NewReader(archive)
	gz, err := gzip.NewReader(input)
	if err != nil {
		return Snapshot{}, errors.New("invalid gzip archive")
	}
	defer gz.Close()
	gz.Multistream(false)
	// Counts headers, PAX metadata and trailing padding as well as file content.
	stream := &io.LimitedReader{R: gz, N: MaxExpandedBytes + MaxEntries*2048 + 1}
	reader := tar.NewReader(stream)
	files, seen := map[string][]byte{}, map[string]bool{}
	var total int64
	entries := 0
	for {
		header, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return Snapshot{}, errors.New("invalid TAR archive")
		}
		entries++
		if entries > MaxEntries {
			return Snapshot{}, errors.New("excessive TAR archive")
		}
		isDir := header.Typeflag == tar.TypeDir
		if !isDir && header.Typeflag != tar.TypeReg && header.Typeflag != tar.TypeRegA {
			return Snapshot{}, errors.New("TAR archive contains an unsafe entry")
		}
		if isDir && header.Size != 0 {
			return Snapshot{}, errors.New("invalid TAR directory")
		}
		if isDir && (header.Name == "." || header.Name == "./") {
			continue
		}
		name := strings.TrimPrefix(header.Name, "./")
		if !isDir && strings.HasSuffix(name, "/") {
			return Snapshot{}, errors.New("invalid TAR file path")
		}
		name, err = archivePath(name)
		if err != nil {
			return Snapshot{}, err
		}
		key := strings.ToLower(name)
		if seen[key] {
			return Snapshot{}, errors.New("TAR archive has duplicate paths")
		}
		seen[key] = true
		if isDir {
			continue
		}
		if header.Size < 0 || header.Size > MaxFileBytes || total+header.Size > MaxExpandedBytes {
			return Snapshot{}, errors.New("TAR archive expands beyond limits")
		}
		data, err := io.ReadAll(io.LimitReader(reader, MaxFileBytes+1))
		if err != nil || int64(len(data)) != header.Size {
			return Snapshot{}, errors.New("corrupt TAR file")
		}
		total += header.Size
		files[name] = data
	}
	// Read through gzip's checksum; reject hidden concatenated streams/payloads.
	buf := make([]byte, 32*1024)
	for {
		n, err := stream.Read(buf)
		for _, b := range buf[:n] {
			if b != 0 {
				return Snapshot{}, errors.New("TAR archive contains trailing data")
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return Snapshot{}, errors.New("corrupt gzip archive")
		}
	}
	if stream.N == 0 || input.Len() != 0 || len(files) == 0 {
		return Snapshot{}, errors.New("empty, excessive or concatenated TAR archive")
	}
	sum := sha256.Sum256(archive)
	return Snapshot{Repository: repo, Commit: commit, ArchiveSHA256: hex.EncodeToString(sum[:]), Files: files}, nil
}
