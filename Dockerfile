# Playwright + extras for git-spice extension E2E and snapshot tests.
# Used by docker-compose.test.yml. Same image runs locally and on CI so
# snapshot PNGs are byte-identical across hosts.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

# git-lfs to materialize the snapshot PNGs from .gitattributes pointers, plus a
# modern git (>= 2.38) from the git-core PPA. Jammy's default git is 2.34, which
# lacks `git merge-tree --write-tree` — the command shamhub's MergeChange runs to
# merge a CR — so `shamhub merge` fails with "merge-tree: exit status 128".
RUN apt-get update \
 && apt-get install -y --no-install-recommends software-properties-common gnupg ca-certificates curl \
 && add-apt-repository -y ppa:git-core/ppa \
 && apt-get update \
 && apt-get install -y --no-install-recommends git git-lfs \
 && rm -rf /var/lib/apt/lists/* \
 && git lfs install --skip-repo

# Install Go from go.dev — Ubuntu Jammy's default golang package is 1.18,
# which can't parse the modern `go 1.26.x` directive in the gs source's
# go.mod. Keep this version aligned with whatever .gs-version's gs source
# expects.
ARG GO_VERSION=1.25.3
RUN ARCH=$(dpkg --print-architecture) \
 && case "$ARCH" in \
      amd64) GOARCH=amd64 ;; \
      arm64) GOARCH=arm64 ;; \
      *) echo "unsupported arch $ARCH" && exit 1 ;; \
    esac \
 && curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${GOARCH}.tar.gz" \
      | tar -C /usr/local -xz \
 && ln -s /usr/local/go/bin/go /usr/local/bin/go \
 && ln -s /usr/local/go/bin/gofmt /usr/local/bin/gofmt

WORKDIR /work
