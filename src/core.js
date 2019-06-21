/**
 * Core build verification functionality - does not assume that it's running in a Travis build.
 */

import AWS from 'aws-sdk';
import fs from 'fs';
import globby from 'globby';
import PromisePool from '@mixmaxhq/promise-pool';
import tar from 'tar';
import { join as pathJoin, sep as pathSep } from 'path';
import { createTwoFilesPatch } from 'diff';
import { promisify } from 'util';
import { dir } from 'tmp-promise';
import { PassThrough } from 'stream';

const readFile = promisify(fs.readFile);

const TAR_PREFIX = 'artifacts';

const maybeReadFile = (file, ...options) =>
  readFile(file, ...options).catch((err) => (err.code === 'ENOENT' ? null : Promise.reject(err)));

const maybePrefix = (prefix, path) => (prefix ? pathJoin(prefix, path) : path);
const getKey = (options, context) =>
  maybePrefix(options.prefix, `groundskeeper-artifacts-${context.baseCommit}.tar.gz`);
const getBaseObject = (options, context) => ({
  Bucket: options.bucket,
  Key: getKey(options, context),
});

const stripPrefix = (filePath, prefix) =>
  filePath.startsWith(prefix + pathSep) ? filePath.slice(prefix.length + pathSep.length) : filePath;

function* prefixPad(...items) {
  const length = items.reduce((a, b) => Math.max(a.length, b.length));
  for (const item of items) {
    yield item.length === length ? item : item.padStart(length);
  }
}

function getDiff({ file, pre, post }, context) {
  const files = [pre, post];
  const patch = createTwoFilesPatch(
      ...files.map((content) => (content === null ? '/dev/null' : file)),
      ...files.map((text) => text || ''),
      ...prefixPad(`(${context.baseBranch} version)`, '(new version)')
    ),
    // Remove the newline comment if the patch represents a new or deleted file.
    p2 = files.includes(null) ? patch.replace(/^\\.+$/m, '') : patch,
    index = p2.search(/^---/m);
  return index === -1 ? p2 : p2.slice(index);
}

export async function checkArtifacts(policy, context) {
  const inputFiles = await globby(policy.files);
  const allFiles = new Set(inputFiles);

  const { path, cleanup } = await dir({
    // We just want it to blow away our temp directory when we're done - no need to preserve
    // anything.
    unsafeCleanup: true,
  });
  try {
    const { options } = policy.storage;
    const s3 = new AWS.S3({
      apiVersion: '2006-03-01',
      region: options.region,
    });

    const source = s3.getObject(getBaseObject(options, context)).createReadStream();

    await new Promise((resolve, reject) => {
      const sink = source.pipe(
        tar.extract({
          cwd: path,
          strict: true,
          unlink: true,
          noMtime: true,
          onentry(entry) {
            // TODO: is path sanitized?
            allFiles.add(stripPrefix(entry.path, 'artifacts'));
          },
        })
      );

      // Track whether we've been interrupted to avoid infinite recursion on abort's error events.
      let interrupted = false;

      function interrupt(err, ErrorType = Error) {
        if (interrupted) return;
        interrupted = true;
        reject(typeof err === 'string' ? new ErrorType(err) : err);
        source.unpipe(sink);
        source.destroy();
        sink.abort();
      }

      // TODO: handle ENOENT (equivalent) errors from the source!
      source.on('error', interrupt);
      sink.on('error', interrupt);
      sink.on('finish', resolve);
    });

    // TODO: it'd be neat if this were 100% streaming from the tar stream.
    const pool = new PromisePool(8),
      patches = new Map();
    for (const filePath of allFiles) {
      await pool.start(async () => {
        const [newCopy, baseCopy] = await Promise.all([
          maybeReadFile(filePath, { encoding: 'utf8' }),
          maybeReadFile(pathJoin(path, TAR_PREFIX, filePath), { encoding: 'utf8' }),
        ]);
        if ((baseCopy === null) !== (newCopy === null) || baseCopy !== newCopy) {
          patches.set(
            filePath,
            !!policy.diff && getDiff({ file: filePath, pre: baseCopy, post: newCopy }, context)
          );
        }
      });
    }

    for (const err of await pool.flush()) {
      throw err;
    }

    return patches.size
      ? {
          result: false,
          files: [...patches.keys()].sort(),
          ...(!policy.diff || { patches }),
        }
      : { result: true };
  } finally {
    cleanup();
  }
}

export async function putArtifacts(policy, context) {
  const files = await globby(policy.files);
  if (!files.length) {
    throw new Error('cannot evaluate artifact policy: no files to check');
  }

  const source = tar.create(
    {
      gzip: true,
      portable: true,
      prefix: TAR_PREFIX,
      preserveOwner: false,
    },
    files
  );

  const { options } = policy.storage;

  const s3 = new AWS.S3({
    apiVersion: '2006-03-01',
    region: options.region,
  });

  const base = getBaseObject(options, context);
  await s3
    .upload({
      // TODO: ACL?
      ...base,
      // For whatever reason aws-sdk refuses to identify source as a stream. Happily, there's a
      // built-in PassThrough implementation provided by Node so we can just re-interpret the
      // underlying datastream as a proper Stream. Note that this will come with a small performance
      // penalty.
      Body: source.pipe(new PassThrough()),
      ContentType: 'application/gzip',
    })
    .promise();

  return {
    uri: `s3://${base.Bucket}/${base.Key}`,
  };
}
