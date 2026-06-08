# evaltool — developer & deployment shortcuts
.DEFAULT_GOAL := help
.PHONY: help install dev start up down build logs

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

install: ## Install Node dependencies
	npm install

dev: ## Run locally with auto-reload (http://localhost:3000)
	npm run dev

start: ## Run locally without auto-reload
	npm start

build: ## Build the Docker image
	docker compose build

up: ## Start via docker compose (detached)
	@test -f .llmcredentials || { echo "ERROR: .llmcredentials missing. Run: cp .llmcredentials.example .llmcredentials  then add your LLM proxy token."; exit 1; }
	docker compose up -d

down: ## Stop the docker compose stack
	docker compose down

logs: ## Tail container logs
	docker compose logs -f
