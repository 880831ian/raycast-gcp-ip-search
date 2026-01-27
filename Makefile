.PHONY: help setup start

help:
	@echo "First-time setup (lowest friction):"
	@echo "  1) make setup"
	@echo "  2) make start"
	@echo ""
	@echo "Notes:"
	@echo "  - Requires Node.js v18+"
	@echo "  - Raycast will show the command: \"Search IP Address\""
	@echo ""
	@echo "Targets:"
	@echo "  make setup    Install gcloud and login"
	@echo "  make start    Install deps then run dev"

setup:
	@if ! command -v gcloud >/dev/null 2>&1; then \
		echo "gcloud not found. Installing Google Cloud SDK..."; \
		brew install google-cloud-sdk; \
	else \
		echo "gcloud already installed."; \
	fi
	gcloud auth login

start:
	npm install
	npm run dev
