#!/bin/sh
# Build the standalone desktop executable (game + music embedded).
# Requires Go. From the repo root:  sh desktop/build.sh
set -e
cd "$(dirname "$0")"
rm -rf game && mkdir game
cp -r ../index.html ../js ../assets game/
[ -f go.mod ] || go mod init bolt
GOOS=windows GOARCH=amd64 go build -ldflags "-s -w -H windowsgui" -o BOLT.exe .
go build -o bolt-linux . 2>/dev/null || true
rm -rf game
echo "built: desktop/BOLT.exe (Windows x64)"
