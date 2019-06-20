/**
 * Auxiliary support code for the core file, which assumes it's running in a Travis build. Used by
 * the CLI for separation of concerns.
 */

import { checkArtifacts, putArtifacts } from './core';
import { postComment } from '@mixmaxhq/post-github-comment-from-travis';

// TODO: move this to @mixmaxhq/travis-utils
const rRange = /^((?:(?!\.\.\.).)+?)\.\.\.((?:(?!\.\.\.).)+)$/;
function parseRange(range) {
  const match = rRange.exec(range);
  return match ? match.slice(1, 3) : null;
}

function formatComment({ patches, files }) {
  const comment = ['groundskeeper: the following artifacts have changed:\n'];
  if (patches) {
    comment.push('```patch');
    // Iterate over sorted files instead of the arbitrarily-ordered patches Map.
    for (const file of files) {
      // No need to worry about escaping - patch format won't let there be three backticks at the
      // start of a line.
      comment.push(patches.get(file));
    }
    comment.push('```');
  } else {
    comment.push('```', ...files, '```');
  }
  return comment.join('\n');
}

export async function pull({ files, postNegative, postPositive, diff, mode, storage }) {
  const [baseCommit = null] = parseRange(process.env.TRAVIS_COMMIT_RANGE) || [];
  const baseBranch = process.env.TRAVIS_BRANCH;
  if (!baseCommit) {
    throw new Error('could not identify the base commit for pull request');
  }
  if (!baseBranch) {
    throw new Error('could not identify the base branch for the pull request');
  }
  const { result, ...output } = await checkArtifacts(
    { files, diff, mode, storage },
    { baseBranch: process.env.TRAVIS_BRANCH, baseCommit }
  );

  if (result) {
    if (postPositive) {
      await postComment('groundskeeper: no artifacts have changed', {
        purpose: '@mixmaxhq/groundskeeper:report/artifacts',
      });
    }
    return { result };
  }

  if (postNegative) {
    await postComment(formatComment(output), {
      purpose: '@mixmaxhq/groundskeeper:report/artifacts',
    });
  }
  return { action: 'pull', result, ...output };
}

export async function push({ files, storage }) {
  const baseCommit = process.env.TRAVIS_COMMIT;
  if (!baseCommit) {
    throw new Error('could not identify base commit for push build');
  }
  const { uri } = await putArtifacts(
    {
      files,
      storage,
    },
    {
      baseCommit,
    }
  );
  return { action: 'push', result: true, uri };
}

export async function defaultCommand(options) {
  switch (process.env.TRAVIS_EVENT_TYPE) {
    case 'pull_request':
      return pull(options);
    case 'push':
      return push(options);
    default:
      // No action.
      return null;
  }
}
