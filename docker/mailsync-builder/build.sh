#!/bin/bash

docker compose -f docker/mailsync-builder/docker-compose.yml run --interactive --build mailsync-builder "$@"
