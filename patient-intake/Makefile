## Dev startup
## Run `make dev` to start everything

.PHONY: dev mcp api stop

dev: ## Start MCP servers + FastAPI + crisis notifier together
	@echo "Killing any processes on MCP ports..."
	@lsof -ti:5001,5002,5003,5004,5005,5006,8000,8001 | xargs kill -9 2>/dev/null || true
	@sleep 1
	@echo "Starting crisis notifier..."
	@python crisis_notifier.py &
	@sleep 1
	@echo "Starting MCP servers..."
	@python3 start_mcp_servers.py &
	@sleep 2
	@echo "Starting FastAPI..."
	@cd backend && uvicorn main:app --reload --port 8000

mcp: ## Start only MCP servers
	python3 start_mcp_servers.py

api: ## Start only FastAPI (assumes MCP servers already running)
	cd backend && uvicorn main:app --reload --port 8000

stop: ## Stop everything
	@pkill -f crisis_notifier.py || true
	@pkill -f start_mcp_servers.py || true
	@pkill -f uvicorn || true
	@echo "All stopped."

install: ## Install dependencies
	pip3 install anthropic mcp fastmcp fastapi uvicorn redis pydantic python-dotenv requests pandas httpx