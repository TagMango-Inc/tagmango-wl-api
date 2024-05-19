#!/bin/bash

# Extract MEILI_MASTER_KEY from ecosystem.config.js using sed
MEILI_MASTER_KEY=$(sed -n 's/.*MEILI_MASTER_KEY:[[:space:]]*"\([^"]*\)".*/\1/p' ecosystem.config.js)

# Build the project
pnpm build

# Function to run commands in new terminal tabs
run_in_new_tab() {
  local command="$1"
  osascript -e "tell application \"Terminal\" to do script \"$command\""
}

# Run the server in a new terminal tab
run_in_new_tab "cd "$PWD" && pm2 start ecosystem.config.js"

# Run the worker for the background jobs in a new terminal tab
# run_in_new_tab "cd "$PWD" && node dist/src/job/worker.js"

# Run the MeiliSearch server in a new terminal tab
run_in_new_tab "cd "$PWD" && meilisearch --master-key=$MEILI_MASTER_KEY"
