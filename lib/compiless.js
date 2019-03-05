const Path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const async = require('async');
const csserror = require('csserror');
const passError = require('passerror');
const hijackResponse = require('hijackresponse');

module.exports = function compiless(options) {
  if (!options || !options.root) {
    throw new Error('options.root is mandatory');
  }

  const less = options.less || require('less');
  const isOldLessApi = !less.version || less.version[0] < 2;
  const plugins = options.plugins || [];
  if (plugins.length > 0 && isOldLessApi) {
    throw new Error('Less version < 2.0.0 does not support plugins');
  }
  const toCSSOptions = options.toCSSOptions || {};

  function formatError(err) {
    // err can either be a string or an error object
    if (typeof err === 'string') {
      return err;
    } else {
      // Assume error object
      return (
        err.message +
        ('line' in err
          ? ' at line ' +
            err.line +
            ('column' in err ? ', column ' + err.column : '')
          : '') +
        ('extract' in err ? ':\n' + err.extract.join('\n') : '')
      );
    }
  }

  return (req, res, next) => {
    // Prevent If-None-Match revalidation with the downstream middleware with ETags that aren't suffixed with "-compiless":
    const ifNoneMatch = req.headers['if-none-match'];

    // only hijack requests for .less files
    if (/\.less$/.test(req.originalUrl)) {
      if (ifNoneMatch) {
        const validIfNoneMatchTokens = ifNoneMatch
          .split(' ')
          .filter(etag => /-compiless"$/.test(etag));

        if (validIfNoneMatchTokens.length > 0) {
          req.headers['if-none-match'] = validIfNoneMatchTokens.join(' ');
        } else {
          delete req.headers['if-none-match'];
        }
      }
      delete req.headers['if-modified-since']; // Prevent false positive conditional GETs after enabling compiless

      hijackResponse(
        res,
        (err, res) => {
          if (err) {
            res.unhijack();
            return next(err);
          }

          const contentType = res.getHeader('Content-Type');
          const matchContentType =
            contentType &&
            contentType.match(/^text\/less(?:;\s*charset=([a-z0-9-]+))?$/i);

          // The mime module doesn't support less yet, so we fall back:
          if (
            !(matchContentType || contentType === 'application/octet-stream')
          ) {
            return res.unhijack();
          }

          const baseDir = Path.resolve(
            options.root,
            req.url.replace(/\/[^/]*(?:\?.*)?$/, '/').substr(1)
          );
          const filename = Path.resolve(options.root, req.url.substr(1));
          const lessOptions = {
            paths: [baseDir],
            filename,
            plugins,
            relativeUrls: true
          };

          function sendErrorResponse(err, cssText) {
            const errorMessage =
              'express-compiless: Error compiling ' +
              req.originalUrl +
              ':\n' +
              formatError(err);
            res.removeHeader('Content-Length');
            res.removeHeader('ETag');
            res.setHeader('Content-Type', 'text/css; charset=utf-8');
            res.end(csserror(errorMessage) + '\n' + (cssText || ''));
          }

          function respondWithCss(css, importedFileNames) {
            importedFileNames = importedFileNames || [];
            const statsByFileName = {};
            async.eachLimit(
              importedFileNames,
              10,
              (importedFileName, cb) => {
                fs.stat(
                  importedFileName,
                  passError(cb, stats => {
                    statsByFileName[importedFileName] = stats;
                    cb();
                  })
                );
              },
              passError(sendErrorResponse, function() {
                const oldETag = res.getHeader('ETag');

                if (oldETag) {
                  const oldETagIsWeak = oldETag && /^W\//.test(oldETag);
                  const etagFragments = [oldETag.replace(/^(?:W\/)?"|"$/g, '')];

                  if (importedFileNames.length) {
                    const importedFileStats = [];

                    importedFileNames
                      .sort()
                      .forEach(importedFileName => {
                        const stats = statsByFileName[importedFileName];
                        importedFileStats.push(
                          importedFileName,
                          String(stats.mtime.getTime()),
                          String(stats.size)
                        );
                      }, this);

                    etagFragments.push(
                      crypto
                        .createHash('md5')
                        .update(importedFileStats.join('-'))
                        .digest('hex')
                        .substr(0, 16)
                    );
                  }

                  const newETag =
                    (oldETagIsWeak ? 'W/' : '') +
                    '"' +
                    etagFragments.join('-') +
                    '-compiless"';
                  res.setHeader('ETag', newETag);

                  if (ifNoneMatch && ifNoneMatch.indexOf(newETag) !== -1) {
                    return res.status(304).send();
                  }
                }

                const cssText =
                  importedFileNames
                    .map(importedFileName => '.compilessinclude {background-image: url(' +
                  Path.relative(baseDir, importedFileName) +
                  '); display: none;}\n')
                    .join('') + css;

                res.setHeader('Content-Type', 'text/css; charset=utf-8');
                res.setHeader('Content-Length', Buffer.byteLength(cssText));
                res.end(cssText);
              })
            );
          }

          const chunks = [];
          res
            .on('data', chunk => {
              chunks.push(chunk);
            })
            .on('end', () => {
              const lessText = Buffer.concat(chunks).toString();

              if (isOldLessApi) {
                const parser = new less.Parser(lessOptions);
                parser.parse(
                  lessText,
                  passError(sendErrorResponse, root => {
                    let css;
                    try {
                      css = root.toCSS(toCSSOptions);
                    } catch (e) {
                      return sendErrorResponse(e);
                    }
                    respondWithCss(
                      css,
                      parser.imports &&
                        parser.imports.files &&
                        Object.keys(parser.imports.files)
                    );
                  })
                );
              } else {
                less.render(
                  lessText,
                  lessOptions,
                  passError(sendErrorResponse, output => {
                    respondWithCss(output.css, output.imports);
                  })
                );
              }
            });
        },
        { disableBackpressure: true }
      );
    }
    next();
  };
};
