#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

remove_runtime_dir() {
  local target="$1"

  if [[ ! -d "$target" ]]; then
    return
  fi

  if rm -rf "$target" 2>/dev/null; then
    return
  fi

  echo "Normal remove failed; retrying after relaxing permissions." >&2
  chmod -R u+rwX "$target" 2>/dev/null || true
  if rm -rf "$target" 2>/dev/null; then
    return
  fi

  if [[ -d "$target" ]]; then
    if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
      echo "Removing container-owned files with sudo." >&2
      sudo rm -rf "$target"
      return
    fi

    echo "Environment directory still exists and contains files this worker cannot delete: $target" >&2
    echo "Run this once on the host, then retry: sudo rm -rf '$target'" >&2
    exit 13
  fi
}

PROJECT_IMAGE_IDS=()

add_project_image_id() {
  local image_ref="$1"
  local image_id
  local existing

  if [[ -z "$image_ref" || "$image_ref" == "<none>" ]]; then
    return
  fi

  image_id="$(docker image inspect -f '{{.Id}}' "$image_ref" 2>/dev/null || true)"
  if [[ -z "$image_id" || "$image_id" == "<no value>" ]]; then
    return
  fi

  if [[ "${#PROJECT_IMAGE_IDS[@]}" -gt 0 ]]; then
    for existing in "${PROJECT_IMAGE_IDS[@]}"; do
      if [[ "$existing" == "$image_id" ]]; then
        return
      fi
    done
  fi

  PROJECT_IMAGE_IDS+=("$image_id")
}

collect_project_image_ids() {
  local project_name="$1"
  local env_dir="$2"
  local repo
  local image_ref

  if [[ -d "$env_dir" ]]; then
    while IFS= read -r image_ref; do
      add_project_image_id "$image_ref"
    done < <((cd "$env_dir" && compose_cmd -p "$project_name" --env-file "$env_dir/.env" images -q) 2>/dev/null || true)
  fi

  while IFS= read -r image_ref; do
    add_project_image_id "$image_ref"
  done < <(docker image ls -a -q --filter "label=com.docker.compose.project=$project_name" 2>/dev/null || true)

  while read -r repo image_ref; do
    case "$repo" in
      "$project_name"-*|"$project_name"_*)
        add_project_image_id "$image_ref"
        ;;
    esac
  done < <(docker image ls -a --format '{{.Repository}} {{.ID}}' 2>/dev/null || true)
}

remove_project_containers() {
  local project_name="$1"
  local container_id

  while IFS= read -r container_id; do
    if [[ -n "$container_id" ]]; then
      echo "Removing leftover container $container_id"
      docker rm -f "$container_id" >/dev/null 2>&1 || true
    fi
  done < <(docker ps -a -q --filter "label=com.docker.compose.project=$project_name" 2>/dev/null || true)
}

remove_project_networks() {
  local project_name="$1"
  local network_id

  while IFS= read -r network_id; do
    if [[ -n "$network_id" ]]; then
      echo "Removing leftover network $network_id"
      docker network rm "$network_id" >/dev/null 2>&1 || true
    fi
  done < <(docker network ls -q --filter "label=com.docker.compose.project=$project_name" 2>/dev/null || true)
}

remove_project_volumes() {
  local project_name="$1"
  local volume_name

  while IFS= read -r volume_name; do
    if [[ -n "$volume_name" ]]; then
      echo "Removing leftover volume $volume_name"
      docker volume rm "$volume_name" >/dev/null 2>&1 || true
    fi
  done < <(docker volume ls -q --filter "label=com.docker.compose.project=$project_name" 2>/dev/null || true)
}

remove_project_images() {
  local project_name="$1"
  local image_id

  if [[ "${#PROJECT_IMAGE_IDS[@]}" -eq 0 ]]; then
    return
  fi

  for image_id in "${PROJECT_IMAGE_IDS[@]}"; do
    if ! docker image inspect "$image_id" >/dev/null 2>&1; then
      continue
    fi

    echo "Removing Docker image $image_id"
    docker image rm "$image_id" >/dev/null 2>&1 || echo "Docker image $image_id could not be removed, likely because it is still used by another container." >&2
  done

  docker image prune -a -f --filter "label=com.docker.compose.project=$project_name" >/dev/null 2>&1 || true
}

prune_project_build_cache() {
  local image_id
  local parent_filter=""

  if [[ "${#PROJECT_IMAGE_IDS[@]}" -eq 0 ]]; then
    echo "No project-owned Docker images found for build-cache pruning."
    return
  fi

  for image_id in "${PROJECT_IMAGE_IDS[@]}"; do
    if [[ -z "$parent_filter" ]]; then
      parent_filter="$image_id"
    else
      parent_filter="$parent_filter;$image_id"
    fi
  done

  echo "Pruning Docker build cache for project image parents."
  if docker buildx version >/dev/null 2>&1; then
    docker buildx prune --force --all --filter "parents=$parent_filter" || true
    return
  fi

  docker builder prune --force --all --filter "parents=$parent_filter" || true
}

ENV_NAME="${1:-}"
validate_env "$ENV_NAME"

echo "Removing environment $ENV_NAME"

# ENV_DIR="$(env_dir "$ENV_NAME")"
# PROJECT_NAME="$(project_name "$ENV_NAME")"

# collect_project_image_ids "$PROJECT_NAME" "$ENV_DIR"

# if [[ -d "$ENV_DIR" ]]; then
#   cd "$ENV_DIR"
#   compose_cmd -p "$PROJECT_NAME" --env-file "$ENV_DIR/.env" down --remove-orphans --volumes --rmi all || true
# fi

# remove_project_containers "$PROJECT_NAME"
# remove_project_networks "$PROJECT_NAME"
# remove_project_volumes "$PROJECT_NAME"
# remove_project_images "$PROJECT_NAME"
# prune_project_build_cache
# remove_runtime_dir "$ENV_DIR"
