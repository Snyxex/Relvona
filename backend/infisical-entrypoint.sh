#!/bin/sh
set -eu

: "${INFISICAL_PROJECT_ID:?INFISICAL_PROJECT_ID must be configured}"
: "${INFISICAL_TOKEN:?INFISICAL_TOKEN must be supplied at runtime}"

exec infisical run --projectId "$INFISICAL_PROJECT_ID" --env "${INFISICAL_ENVIRONMENT:-production}" -- "$@"
