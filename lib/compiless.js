/*jshint -W082 */ // Fix this after #10 has been merged
var Path = require('path'),
    crypto = require('crypto'),
    fs = require('fs'),
    async = require('async'),
    csserror = require('csserror'),
    passError = require('passerror'),
    interceptor = require('express-interceptor');

module.exports = function compiless(options) {
    if (!options || !options.root) {
        throw new Error('options.root is mandatory');
    }

    var less = options.less || require('less');
    var plugins = options.plugins || [];

    return interceptor(function (req, res) {
        // Prevent If-None-Match revalidation with the downstream middleware with ETags that aren't suffixed with "-compiless":
        var ifNoneMatch = req.headers['if-none-match'];

        if (ifNoneMatch) {
            var validIfNoneMatchTokens = ifNoneMatch.split(" ").filter(function (etag) {
                return /-compiless\"$/.test(etag);
            });

            if (validIfNoneMatchTokens.length > 0) {
                req.headers['if-none-match'] = validIfNoneMatchTokens.join(" ");
            } else {
                delete req.headers['if-none-match'];
            }
        }
        delete req.headers['if-modified-since']; // Prevent false positive conditional GETs after enabling compiless

        return {
            isInterceptable: function () {
                return true;
            },
            intercept: function (body, send) {
                var contentType = res.getHeader('Content-Type'),
                    matchContentType = contentType && contentType.match(/^text\/less(?:;\s*charset=([a-z0-9\-]+))?$/i);

                // The mime module doesn't support less yet, so we fall back:
                if (matchContentType || (/\.less(?:\?.*)?$/.test(req.url) && contentType === 'application/octet-stream')) {
                    function formatError(err) { // err can either be a string or an error object
                        if (typeof err === 'string') {
                            return err;
                        } else {
                            // Assume error object
                            return err.message + ('line' in err ? ' at line ' + err.line + ('column' in err ? ', column ' + err.column : '') : '') +
                                ('extract' in err ? ':\n' + err.extract.join('\n') : '');
                        }
                    }

                    function sendErrorResponse(err, cssText) {
                        var errorMessage = "express-compiless: Error compiling " + req.originalUrl + ":\n" + formatError(err);
                        res.removeHeader('Content-Length');
                        res.removeHeader('ETag');
                        res.setHeader('Content-Type', 'text/css; charset=utf-8');
                        send(csserror(errorMessage) + '\n' + (cssText || ''));
                    }

                    var lessText = body,
                        baseDir = Path.resolve(options.root, req.url.replace(/\/[^\/]*(?:\?.*)?$/, '/').substr(1)),
                        filename = Path.resolve(options.root, req.url.substr(1)),
                        lessOptions = {
                            paths: [baseDir],
                            filename: filename,
                            plugins: plugins,
                            relativeUrls: true
                        };

                    less.render(lessText, lessOptions, passError(sendErrorResponse, function (output) {
                        var importedFileNames = output.imports || [],
                            statsByFileName = {};
                        async.eachLimit(importedFileNames, 10, function (importedFileName, cb) {
                            fs.stat(importedFileName, passError(cb, function (stats) {
                                statsByFileName[importedFileName] = stats;
                                cb();
                            }));
                        }, passError(sendErrorResponse, function () {
                            var oldETag = res.getHeader('ETag');

                            if (oldETag) {
                                var oldETagIsWeak = oldETag && /^W\//.test(oldETag),
                                    etagFragments = [oldETag.replace(/^(?:W\/)?"|"$/g, '')];

                                if (importedFileNames.length) {
                                    var importedFileStats = [];

                                    importedFileNames.sort().forEach(function (importedFileName) {
                                        var stats = statsByFileName[importedFileName];
                                        importedFileStats.push(importedFileName, String(stats.mtime.getTime()), String(stats.size));
                                    }, this);

                                    etagFragments.push(crypto.createHash('md5').update(importedFileStats.join('-')).digest('hex').substr(0, 16));
                                }

                                var newETag = (oldETagIsWeak ? 'W/' : '') + '"' + etagFragments.join('-') + '-compiless"';
                                res.setHeader('ETag', newETag);

                                if (ifNoneMatch && ifNoneMatch.indexOf(newETag) !== -1) {
                                    return res.status(304).send();
                                }
                            }

                            var rootCSS;
                            try {
                                rootCSS = output.css;
                            } catch (e) {
                                return sendErrorResponse(e);
                            }

                            var cssText = importedFileNames.map(function (importedFileName) {
                                return ".compilessinclude {background-image: url(" + Path.relative(baseDir, importedFileName) + "); display: none;}\n";
                            }).join("") + rootCSS;

                            res.setHeader('Content-Type', 'text/css; charset=utf-8');
                            res.setHeader('Content-Length', Buffer.byteLength(cssText));
                            send(cssText);
                        }));
                    }));
                } else {
                    send(body);
                }
            }
        };
    });
};
