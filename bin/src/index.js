import yargs from 'yargs';
import { defaultCommand, pull, push } from '../dist/support';

const alwaysValues = new Set(['any', 'all', 'always', 'every', 'yes']);
const positiveValues = new Set([
  'positive',
  'match',
  'matched',
  'matching',
  'equal',
  'same',
  ...alwaysValues,
]);
const negativeValues = new Set([
  'fail',
  'failing',
  'mismatched',
  'differ',
  'differing',
  'negative',
  ...alwaysValues,
]);
const neverValues = new Set(['never', 'no']);
const allFlags = new Set([...positiveValues, ...negativeValues, ...neverValues]);

const pullOptions = {
  diff: {
    type: 'boolean',
    default: true,
    describe: 'whether to compute the diff between current and prior build artifacts',
  },
  post: {
    default: 'always',
    choices: [...allFlags],
    describe: 'when to post a comment describing the verification outcome',
  },
};

const complete = new Map(
  Object.entries({
    pull({ result, files }, { fail }) {
      if (result) {
        console.log('groundskeeper: no artifacts have changed');
      } else {
        // TODO: report additions and deletes more clearly here - those are just reported as
        // "changed" files (but are represented as patches in the comments correctly)
        console.warn(
          `groundskeeper: the following artifacts have changed:\n${files
            .map((line) => `- ${line}`)
            .join('\n')}`
        );
      }
      process.exit(!result && fail ? 1 : 0);
    },
    push({ uri }) {
      console.log(`groundskeeper: uploaded ${uri}`);
    },
  })
);

function handle(promise, { fail }) {
  promise.then(
    (output) => {
      if (output) {
        const { action, ...rest } = output;
        complete.get(action)(rest, { fail });
      } else {
        // TODO: respect fail flag
        console.warn('groundskeeper: unable to determine travis context');
        process.exit(fail ? 1 : 0);
      }
    },
    (err) => {
      console.error(`groundskeeper: ${(err && err.stack) || err}`);
      process.exit(2);
    }
  );
}

function bail(message) {
  console.error('groundskeeper:', message);
  process.exit(1);
}

const interpretOptions = ({ bucket, region, prefix, _: files }) => ({
  storage: {
    options: {
      bucket: bucket || process.env.S3_BUCKET || bail('no S3 bucket specified'),
      region,
      prefix,
    },
  },
  files,
});

const interpretPullOptions = ({ diff, post }) => ({
  diff,
  postPositive: positiveValues.has(post),
  postNegative: negativeValues.has(post),
});

yargs
  .usage('verify-build-artifacts')
  .options({
    fail: {
      type: 'boolean',
      default: true,
      describe: 'whether to output a failing exit code when build artifacts differ',
    },
    bucket: {
      type: 'string',
      describe: 'the S3 bucket for build artifact storage',
    },
    region: {
      type: 'string',
      describe: 'the AWS region for build artifact storage',
    },
    prefix: {
      type: 'string',
      describe: 'the S3 key prefix to use for build artifact storage',
    },
  })
  .command('$0', 'the default context-sensitive command', pullOptions, (argv) => {
    handle(
      defaultCommand({
        ...interpretOptions(argv),
        ...interpretPullOptions(argv),
      }),
      { fail: argv.fail }
    );
  })
  .command('push', 'push the artifact files to S3', {}, (argv) => {
    handle(push(interpretOptions(argv)), { fail: argv.fail });
  })
  .command('pull', 'pull and verify the artifact files against S3', pullOptions, (argv) => {
    handle(
      pull({
        ...interpretOptions(argv),
        ...interpretPullOptions(argv),
      }),
      { fail: argv.fail }
    );
  })
  .demandCommand()
  .help('h')
  .alias('h', 'help').argv;
