// BOLT desktop launcher. The whole game (HTML, JS, and all ten music tracks)
// is embedded in this executable. On launch it serves the game on a random
// localhost port, opens the default browser, and exits by itself shortly
// after the game tab is closed (the page heartbeats back to us).
package main

import (
	"embed"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"strings"
	"sync/atomic"
	"time"
)

//go:embed game
var gameFS embed.FS

// heartbeat injected into index.html so we know when the tab is gone
const beacon = `<script>setInterval(function(){fetch('/__alive').catch(function(){})},2000)</script>`

func main() {
	sub, err := fs.Sub(gameFS, "game")
	if err != nil {
		panic(err)
	}

	var lastPing atomic.Int64
	lastPing.Store(time.Now().Unix())

	mux := http.NewServeMux()
	mux.HandleFunc("/__alive", func(w http.ResponseWriter, r *http.Request) {
		lastPing.Store(time.Now().Unix())
		w.WriteHeader(http.StatusNoContent)
	})
	fileServer := http.FileServer(http.FS(sub))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			b, err := fs.ReadFile(sub, "index.html")
			if err != nil {
				http.Error(w, "missing index", 500)
				return
			}
			html := strings.Replace(string(b), "</body>", beacon+"</body>", 1)
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprint(w, html)
			return
		}
		fileServer.ServeHTTP(w, r)
	})

	// loopback only: no firewall prompt, nothing exposed to the network
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	url := fmt.Sprintf("http://%s/", ln.Addr().String())
	go http.Serve(ln, mux)

	openBrowser(url)

	// generous grace for the browser to appear, then exit ~15s after the last
	// heartbeat (tab closed / browser quit)
	grace := time.Now().Add(60 * time.Second)
	for {
		time.Sleep(3 * time.Second)
		idle := time.Now().Unix()-lastPing.Load() > 15
		if idle && time.Now().After(grace) {
			return
		}
	}
}

func openBrowser(url string) {
	switch runtime.GOOS {
	case "windows":
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		exec.Command("open", url).Start()
	default:
		exec.Command("xdg-open", url).Start()
	}
}
