// The self-update helper on Windows (src/main/resolve/autoUpdater.ts). The app copies this program
// out of the install folder, starts it as
//
//	noctur-run.exe update <app pid> <installer> <app exe> <new version> <log file>
//
// and quits. The helper waits for the app to exit, runs the installer silently and waits for it,
// and opens the current version again unless the new version is installed. Every step goes to the
// log file.
//
// It replaces a PowerShell helper: Node starts detached processes without a console, and Windows
// PowerShell 5.1 then exits with code 0 before running its command, so the installer never ran.
// This program needs no console. It must not run from the install folder: the installer closes
// every process started from there and replaces the files.
//
// The steps are kept apart from the Windows calls (update_windows.go) so they can be tested on any
// system (update_test.go).
package main

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"
)

// installerArgs: silent, as an update (the installer closes the app if it still runs), and open the
// new version when done.
var installerArgs = []string{"/S", "--updated", "--force-run"}

// How long to wait for the app to quit before the installer runs anyway; it closes the app itself.
const appExitTimeout = 60 * time.Second

// errCancelled: the UAC prompt was declined.
var errCancelled = errors.New("the administrator prompt was declined")

type system interface {
	// waitExit reports whether the process is gone within the timeout.
	waitExit(pid int, timeout time.Duration) bool
	// runAsAdmin starts the program as administrator and returns its exit code once it has exited.
	runAsAdmin(file string, args []string) (int, error)
	// fileVersion is the version of a program, as "major.minor.patch".
	fileVersion(file string) (string, error)
	start(file string) error
}

type updateJob struct {
	pid       int
	installer string
	app       string
	version   string
}

// update runs the steps and reports whether it opened the current version again.
func update(job updateJob, sys system, logf func(format string, a ...any)) bool {
	if sys.waitExit(job.pid, appExitTimeout) {
		logf("app (pid %d) exited", job.pid)
	} else {
		logf("app (pid %d) still running after %s, starting the installer anyway", job.pid, appExitTimeout)
	}

	logf("starting %s %v", job.installer, installerArgs)
	code, err := sys.runAsAdmin(job.installer, installerArgs)
	switch {
	case err != nil:
		logf("installer did not start: %v", err)
	case code != 0:
		logf("installer exited with code %d", code)
	default:
		logf("installer exited with code 0")
		// A silent install that gives up (the app's files are in use) can also exit with 0.
		v, err := sys.fileVersion(job.app)
		switch {
		case err != nil:
			logf("could not read the installed version: %v", err)
		case v != job.version:
			logf("installed version is %s, expected %s", v, job.version)
		default:
			logf("version %s installed", v)
			return false
		}
	}

	logf("opening %s again", job.app)
	if err := sys.start(job.app); err != nil {
		logf("could not open it: %v", err)
	}
	return true
}

// runUpdate parses the arguments, opens the log and runs the update. The exit code is 0 when the
// new version was installed.
func runUpdate(args []string, sys system) int {
	if len(args) != 5 {
		return 2
	}
	pid, err := strconv.Atoi(args[0])
	if err != nil {
		return 2
	}
	job := updateJob{pid: pid, installer: args[1], app: args[2], version: args[3]}

	logFile, err := os.OpenFile(args[4], os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	logf := func(format string, a ...any) {
		if logFile != nil {
			fmt.Fprintf(logFile, "%s %s\n", time.Now().Format("2006-01-02 15:04:05.000"), fmt.Sprintf(format, a...))
		}
	}
	if err != nil {
		logFile = nil
	} else {
		defer logFile.Close()
	}

	logf("update to %s started", job.version)
	reopened := update(job, sys, logf)
	// The installer is not needed again either way; a new attempt downloads it again.
	if err := os.Remove(job.installer); err != nil && !os.IsNotExist(err) {
		logf("could not remove the installer: %v", err)
	}
	if reopened {
		return 1
	}
	return 0
}
