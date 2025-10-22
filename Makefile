.PHONY: setup-gvisor-macos verify-gvisor restart-docker debug-gvisor help

help:
	@echo "Ray Agents - gVisor Setup"
	@echo ""
	@echo "Available targets:"
	@echo "  make setup-gvisor-macos  - Install gVisor on macOS (Docker Desktop)"
	@echo "  make restart-docker      - Restart Docker Desktop"
	@echo "  make verify-gvisor       - Verify gVisor installation"
	@echo "  make debug-gvisor        - Debug gVisor installation issues"
	@echo "  make help                - Show this help message"

setup-gvisor-macos:
	@echo "==> Step 1: Installing gVisor binaries to persistent storage..."
	@docker run -i --rm --privileged --pid=host debian nsenter -t 1 -m -u -n -i sh < scripts/install-gvisor-persistent.sh
	@echo ""
	@echo "==> Step 2: Configuring Docker Desktop daemon.json..."
	@bash scripts/configure-docker-desktop.sh
	@echo ""
	@echo "==> Installation complete!"
	@echo ""
	@echo "CRITICAL: You MUST quit and restart Docker Desktop:"
	@echo ""
	@echo "    1. Click Docker whale icon → 'Quit Docker Desktop'"
	@echo "    2. Wait 10 seconds"
	@echo "    3. Open Docker Desktop from Applications"
	@echo "    4. Wait for it to fully start"
	@echo "    5. Run: make verify-gvisor"

restart-docker:
	@echo "==> Restarting Docker Desktop..."
	@osascript -e 'quit app "Docker"' 2>/dev/null || true
	@echo "==> Waiting for Docker to quit..."
	@sleep 5
	@echo "==> Starting Docker Desktop..."
	@open -a Docker
	@echo "==> Waiting for Docker to start (checking every 5 seconds, max 2 minutes)..."
	@attempts=0; \
	while [ $$attempts -lt 24 ]; do \
		if docker info >/dev/null 2>&1; then \
			echo "==> Docker is ready! Run 'make verify-gvisor' to test."; \
			exit 0; \
		fi; \
		attempts=$$((attempts + 1)); \
		printf "."; \
		sleep 5; \
	done; \
	echo ""; \
	echo "==> Docker is taking longer than expected. Please check Docker Desktop manually."

debug-gvisor:
	@echo "==> Running debug checks inside Docker Desktop VM..."
	@docker run -i --rm --privileged --pid=host debian nsenter -t 1 -m -u -n -i sh < scripts/debug-gvisor.sh

verify-gvisor:
	@echo "==> Verifying gVisor installation..."
	@docker run --rm --runtime=runsc hello-world
	@echo ""
	@echo "==> Success! gVisor is working correctly."
