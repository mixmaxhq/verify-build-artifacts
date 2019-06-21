#!/bin/bash -e

if [[ "$TRAVIS_EVENT_TYPE" != pull_request ]] || [[ "$TRAVIS_BRANCH" == dependabot/*npm* ]]; then
  node bin --no-fail --prefix artifacts/mixmaxhq/verify-build-artifacts
else
  echo $'groundskeeper: not verifying or producing build artifacts for non-\nmaster and non-dependabot build' >&2
fi
