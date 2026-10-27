package main

import (
	"reflect"
	"testing"
	"time"
)

type fakeSystem struct {
	exitCode  int
	runErr    error
	installed string // the app's version after the installer ran
	ranArgs   []string
	started   []string
}

func (f *fakeSystem) waitExit(int, time.Duration) bool { return true }

func (f *fakeSystem) runAsAdmin(_ string, args []string) (int, error) {
	f.ranArgs = args
	return f.exitCode, f.runErr
}

func (f *fakeSystem) fileVersion(string) (string, error) { return f.installed, nil }

func (f *fakeSystem) start(file string) error {
	f.started = append(f.started, file)
	return nil
}

// When the update does not install, the app has already quit; if the helper does not open it again,
// the user is left without Noctur (and without its proxy) on the old version.
func TestOpensCurrentVersionWhenNotInstalled(t *testing.T) {
	cases := map[string]*fakeSystem{
		"installer fails":             {exitCode: 2, installed: "1.1.6"},
		"installer gives up silently": {exitCode: 0, installed: "1.1.6"},
		"UAC declined":                {runErr: errCancelled, installed: "1.1.6"},
	}
	for name, sys := range cases {
		t.Run(name, func(t *testing.T) {
			job := updateJob{pid: 1, installer: `C:\updates\setup.exe`, app: `C:\Noctur\Noctur.exe`, version: "1.1.7"}
			reopened := update(job, sys, func(string, ...any) {})
			if !reopened || !reflect.DeepEqual(sys.started, []string{job.app}) {
				t.Fatalf("reopened=%v started=%v, want the app opened once", reopened, sys.started)
			}
			if !reflect.DeepEqual(sys.ranArgs, []string{"/S", "--updated", "--force-run"}) {
				t.Fatalf("installer args %v", sys.ranArgs)
			}
		})
	}
}
