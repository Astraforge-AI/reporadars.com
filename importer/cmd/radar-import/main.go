// radar-import stages reviewed repository metadata; it never executes imported code.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"reflect"
	"strings"

	"github.com/Astraforge-AI/reporadars.com/importer/internal/intake"
)

var fetchSnapshot = intake.Fetch

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "radar-import:", bounded(err.Error()))
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return errors.New("expected scan, review-template, export, or merge")
	}
	switch args[0] {
	case "help", "--help", "-h":
		fmt.Println("radar-import: scan | review-template | draft-request | apply-draft | export | merge\nAll commands create new private files. Export/merge stage metadata only; they do not deploy.\nSee docs/skill-importer.md for commands, limits and review requirements.")
		return nil
	case "version", "--version":
		fmt.Println("radar-import 0.1.0 (schema 1)")
		return nil
	case "scan-release":
		return scanRelease(args[1:])
	case "scan-actions":
		return scanActions(args[1:])
	case "scan":
		return scan(args[1:])
	case "review-template":
		return reviewTemplate(args[1:])
	case "draft-request":
		return draftRequest(args[1:])
	case "apply-draft":
		return applyDraft(args[1:])
	case "export":
		return exportPack(args[1:])
	case "merge":
		return mergePack(args[1:])
	default:
		return errors.New("unknown command")
	}
}

func draftRequest(args []string) error {
	fs := flag.NewFlagSet("draft-request", flag.ContinueOnError)
	fs.SetOutput(ioDiscard{})
	reportPath, id, out := fs.String("report", "", ""), fs.String("id", "", ""), fs.String("out", "", "")
	if err := fs.Parse(args); err != nil || fs.NArg() != 0 || *reportPath == "" || *id == "" || *out == "" {
		return errors.New("usage: draft-request --report FILE --id ID --out FILE")
	}
	report, err := intake.LoadReport(*reportPath)
	if err != nil {
		return errors.New("read report failed")
	}
	request, err := intake.DraftRequest(report, *id)
	if err != nil {
		return errors.New("candidate cannot be sent for a draft")
	}
	return intake.WriteJSON(*out, json.RawMessage(request))
}

func applyDraft(args []string) error {
	fs := flag.NewFlagSet("apply-draft", flag.ContinueOnError)
	fs.SetOutput(ioDiscard{})
	reportPath, reviewsPath, id, responsePath, out := fs.String("report", "", ""), fs.String("reviews", "", ""), fs.String("id", "", ""), fs.String("response", "", ""), fs.String("out", "", "")
	if err := fs.Parse(args); err != nil || fs.NArg() != 0 || *reportPath == "" || *reviewsPath == "" || *id == "" || *responsePath == "" || *out == "" {
		return errors.New("usage: apply-draft --report FILE --reviews FILE --id ID --response FILE --out FILE")
	}
	report, err := intake.LoadReport(*reportPath)
	if err != nil {
		return errors.New("read report failed")
	}
	reviews, err := intake.LoadReviews(*reviewsPath)
	if err != nil {
		return errors.New("read reviews failed")
	}
	response, err := intake.LoadProviderOutput(*responsePath)
	if err != nil {
		return errors.New("read provider output failed")
	}
	updated, err := intake.ApplyAntigravityDraft(report, reviews, *id, response)
	if err != nil {
		return errors.New("provider draft rejected")
	}
	return intake.WriteJSON(*out, updated)
}

func scan(args []string) error {
	fs := flag.NewFlagSet("scan", flag.ContinueOnError)
	fs.SetOutput(ioDiscard{})
	repo, ref, out := fs.String("repo", "", ""), fs.String("ref", "", ""), fs.String("out", "", "")
	credential := fs.String("github-token-file", "", "")
	if err := fs.Parse(args); err != nil || fs.NArg() != 0 || *repo == "" || *out == "" {
		return errors.New("usage: scan --repo URL [--ref REF] --out FILE")
	}
	token, err := intake.ReadGitHubToken(*credential)
	if err != nil {
		return err
	}
	var snapshot intake.Snapshot
	if token == "" {
		snapshot, err = fetchSnapshot(context.Background(), *repo, *ref)
	} else {
		snapshot, err = intake.FetchAuthenticated(context.Background(), *repo, *ref, token)
	}
	if err != nil {
		return errors.New("scan fetch failed: " + bounded(err.Error()))
	}
	report, err := intake.Analyze(snapshot)
	if err != nil {
		return errors.New("scan analysis failed: " + bounded(err.Error()))
	}
	return intake.WriteJSON(*out, report)
}

func reviewTemplate(args []string) error {
	fs := flag.NewFlagSet("review-template", flag.ContinueOnError)
	fs.SetOutput(ioDiscard{})
	reportPath, out := fs.String("report", "", ""), fs.String("out", "", "")
	if err := fs.Parse(args); err != nil || fs.NArg() != 0 || *reportPath == "" || *out == "" {
		return errors.New("usage: review-template --report FILE --out FILE")
	}
	report, err := intake.LoadReport(*reportPath)
	if err != nil {
		return errors.New("read report failed")
	}
	return intake.WriteJSON(*out, intake.ReviewTemplate(report))
}

func exportPack(args []string) error {
	fs := flag.NewFlagSet("export", flag.ContinueOnError)
	fs.SetOutput(ioDiscard{})
	reportPath, reviewsPath, out := fs.String("report", "", ""), fs.String("reviews", "", ""), fs.String("out", "", "")
	if err := fs.Parse(args); err != nil || fs.NArg() != 0 || *reportPath == "" || *reviewsPath == "" || *out == "" {
		return errors.New("usage: export --report FILE --reviews FILE --out FILE")
	}
	report, err := intake.LoadReport(*reportPath)
	if err != nil {
		return errors.New("read report failed")
	}
	reviews, err := intake.LoadReviews(*reviewsPath)
	if err != nil {
		return errors.New("read reviews failed")
	}
	freshSnapshot, err := fetchSnapshot(context.Background(), report.Repository.URL, report.Commit)
	if err != nil {
		return errors.New("export fetch failed")
	}
	fresh, err := intake.Analyze(freshSnapshot)
	if err != nil {
		return errors.New("export analysis failed")
	}
	if report.ArchiveSHA256 != fresh.ArchiveSHA256 || report.Commit != fresh.Commit || report.Repository != fresh.Repository || !reflect.DeepEqual(report.Skills, fresh.Skills) {
		return errors.New("report is stale or forged")
	}
	entries, err := intake.Publication(fresh, reviews)
	if err != nil {
		return errors.New("reviews cannot be published")
	}
	pack, err := intake.MergeCatalog(nil, entries)
	if err != nil {
		return errors.New("publication pack invalid")
	}
	return intake.WriteJSON(*out, pack)
}

func mergePack(args []string) error {
	fs := flag.NewFlagSet("merge", flag.ContinueOnError)
	fs.SetOutput(ioDiscard{})
	catalogPath, packPath, out := fs.String("catalog", "", ""), fs.String("pack", "", ""), fs.String("out", "", "")
	if err := fs.Parse(args); err != nil || fs.NArg() != 0 || *catalogPath == "" || *packPath == "" || *out == "" {
		return errors.New("usage: merge --catalog FILE --pack FILE --out FILE")
	}
	existing, err := intake.LoadCatalog(*catalogPath)
	if err != nil {
		return errors.New("read catalog failed")
	}
	pack, err := intake.LoadCatalog(*packPath)
	if err != nil {
		return errors.New("read pack failed")
	}
	merged, err := intake.MergeCatalog(existing, pack)
	if err != nil {
		return errors.New("merge rejected")
	}
	return intake.WriteJSON(*out, merged)
}

type ioDiscard struct{}

func (ioDiscard) Write(p []byte) (int, error) { return len(p), nil }
func bounded(s string) string {
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > 240 {
		return s[:240]
	}
	return s
}

func scanRelease(args []string) error {
	fs := flag.NewFlagSet("scan-release", flag.ContinueOnError)
	fs.SetOutput(ioDiscard{})
	repo, tag, asset, out := fs.String("repo", "", ""), fs.String("tag", "latest", ""), fs.Int64("asset-id", 0, ""), fs.String("out", "", "")
	credential := fs.String("github-token-file", "", "")
	if err := fs.Parse(args); err != nil || fs.NArg() != 0 || *repo == "" || *asset < 1 || *out == "" {
		return errors.New("usage: scan-release --repo URL [--tag TAG] --asset-id ID --out FILE")
	}
	token, err := intake.ReadGitHubToken(*credential)
	if err != nil {
		return err
	}
	report, err := intake.FetchReleaseAuthenticated(context.Background(), *repo, *tag, *asset, token)
	if err != nil {
		return errors.New("release scan failed: " + bounded(err.Error()))
	}
	return intake.WriteJSON(*out, report)
}

func scanActions(args []string) error {
	fs := flag.NewFlagSet("scan-actions", flag.ContinueOnError)
	fs.SetOutput(ioDiscard{})
	repo, out, tokenFile := fs.String("repo", "", ""), fs.String("out", "", ""), fs.String("github-token-file", "", "")
	asset, workflow := fs.Int64("artifact-id", 0, ""), fs.Int64("workflow-id", 0, "")
	if err := fs.Parse(args); err != nil || fs.NArg() != 0 || *repo == "" || *asset < 1 || *workflow < 1 || *out == "" {
		return errors.New("usage: scan-actions --repo URL --artifact-id ID --workflow-id ID [--github-token-file PATH] --out FILE")
	}
	token, err := intake.ReadGitHubToken(*tokenFile)
	if err != nil {
		return err
	}
	report, err := intake.FetchActions(context.Background(), *repo, *asset, *workflow, token)
	if err != nil {
		return errors.New("Actions scan failed: " + bounded(err.Error()))
	}
	return intake.WriteJSON(*out, report)
}
