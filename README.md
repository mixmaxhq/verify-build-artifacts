# verify-build-artifacts

Designed for Travis usage first and foremost.

Security note: you'll need to include S3 credentials to store build artifacts for later
verification. As a result, you should follow Travis best practices to encrypt and/or secure those
credentials, and may want to configure your S3 bucket to be publically readable if your module is
public. Be sure to also consider how pull requests from forks of your repository will interact with
how you've configured build artifact verification.

## Install

```sh
$ npm i -D '@mixmaxhq/verify-build-artifacts'
```

## Quick start

The default command for the `@mixmaxhq/verify-build-artifacts` package assumes that it's running in
a Travis build, and expects that it should interpret the type of build (pull-request vs push build)
as a signal for whether it's checking acceptance or pushing build artifacts.

The `check-build` script determines whether it's running in a Travis PR build or a Travis push
build, and either `.tar.gz`s the provided files and pushes them to S3 or pulls down the relevant tgz
and compares it to the provided files.

```jsonc
// sample package.json
{
  "name": "example-module",
  "version": "1.0.0",
  "description": "It's a module that does things.",
  "main": "./dist/index.js",
  "files": ["dist"],
  "devDependencies": {
    "@babel/cli": "^7.4.4",
    "@babel/core": "^7.4.5"
  },
  "scripts": {
    "build": "babel src -d dist",
    "run-ci": "npm test && npm run build && npm run check-build && npx '@mixmaxhq/dependabot-automerge'",
    "check-build": "npx '@mixmaxhq/verify-build-artifacts' 'dist/**/*.js' --bucket my-artifact-s3-bucket"
  }
}
```

## Roadmap

Quality:

- Avoid writing to the filesystem entirely, and manipulate everything directly as streams

Features:

- add pluggable storage backends
- support configurable diffing tools
- support uploading hashes of the build artifacts to support faster acceptance testing
  - possibly in addition to diffs, to determine whether to bother downloading/diffing the content
  - optional salting, for unknown security needs?
